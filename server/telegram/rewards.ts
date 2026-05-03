import { storage } from "../storage";
import { log } from "../index";
import { computeContributorScoresByGroup, persistContributorScores, getPreviousPeriod } from "./reputation";
import { transferErc20, type RewardChain } from "../agent/erc20";
import { getRewardsBoostMultiplier } from "../limits";
import type { BotConfig, InsertRewardPayout } from "@shared/schema";

export async function runRewardsForBot(config: BotConfig, opts: { dryRun?: boolean; force?: boolean } = {}): Promise<{
  ok: boolean;
  reason?: string;
  distributionId?: number;
  recipients?: number;
}> {
  if (!config.rewardsEnabled && !opts.force) return { ok: false, reason: "rewards disabled" };

  const periodDays = config.rewardPeriodDays || 7;
  const period = getPreviousPeriod(periodDays);

  const last = config.rewardLastDistributionAt ? new Date(config.rewardLastDistributionAt) : null;
  if (last && last >= period.end && !opts.force) {
    return { ok: false, reason: "already distributed for this period" };
  }

  // Cheap precondition validation BEFORE we claim the period. If this bot
  // is misconfigured we must not advance reward_last_distribution_at, or
  // the operator could lose a whole period to a typo.
  const chain = (config.rewardTokenChain || "base") as RewardChain;
  const tokenAddress = config.rewardTokenAddress || "";
  const tokenSymbol = config.rewardTokenSymbol || "TOKEN";
  const decimals = config.rewardTokenDecimals ?? 18;
  const amountPerWinner = config.rewardAmountPerWinner || "0";
  const poolPerPeriod = config.rewardPoolPerPeriod || "0";
  const topN = config.rewardTopN || 5;
  const minDays = config.rewardMinDaysActive ?? 3;
  const maxPerUser = config.rewardMaxPerUserPerPeriod ?? 1;

  if (!tokenAddress || (amountPerWinner === "0" && poolPerPeriod === "0")) {
    return { ok: false, reason: "token, pool, or per-winner amount not configured" };
  }

  // Atomically claim this period AFTER validation. The conditional UPDATE
  // serializes the row so concurrent cron + manual triggers cannot both
  // win. The dry-run path skips claiming because no payouts are written.
  // We capture the EXACT stamped timestamp returned by the claim so a
  // later revert can match it on equality (NOW() differs from any JS
  // Date we capture client-side).
  const previousLastAt: Date | null = last;
  let claimedAt: Date | null = null;
  if (!opts.dryRun && !opts.force) {
    const claimed = await storage.tryClaimRewardsDistribution(config.id, period.end);
    if (!claimed) {
      return { ok: false, reason: "another distribution already claimed this period" };
    }
    claimedAt = claimed.claimedAt;
  }

  // Everything below this point may throw. Wrap in try/finally so the
  // in-progress marker is always cleared, and any distribution rows we
  // managed to create are finalized to "failed" rather than left pending.
  const distributionIds: number[] = [];
  let totalRecipients = 0, totalSent = 0, totalFailed = 0, totalSkipped = 0;
  // Tracks whether we should hand the period back to the next run if we
  // bail out before producing any distribution rows. Set to false the
  // moment we've created at least one distribution (any work has been
  // persisted under this period stamp and the claim is committed).
  let needsClaimRevert = !opts.dryRun && !opts.force;
  const releaseClaim = async (reason: string) => {
    if (!needsClaimRevert || !claimedAt) return;
    needsClaimRevert = false;
    try {
      const reverted = await storage.revertRewardsClaim(config.id, claimedAt, previousLastAt);
      if (reverted) {
        log(`[rewards.run] reverted claim bot=${config.id} reason=${reason}`, "rewards");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[rewards.run] revert-claim failed bot=${config.id} reason=${reason} err=${msg}`, "rewards");
    }
  };

  try {
  const byGroup = await computeContributorScoresByGroup(config.id, period.start, period.end);
  for (const [gid, list] of byGroup.entries()) {
    await persistContributorScores(config.id, period.start, period.end, list, gid);
  }

  const allRecentPayouts = await storage.listRewardPayouts(config.id, 1000);
  const payoutCountByUser = new Map<string, number>();
  for (const p of allRecentPayouts) {
    if (p.status !== "sent" || !p.createdAt || new Date(p.createdAt) < period.start) continue;
    payoutCountByUser.set(p.telegramUserId, (payoutCountByUser.get(p.telegramUserId) || 0) + 1);
  }

  for (const [gid, scores] of byGroup.entries()) {
    const eligibleCandidates = [];
    for (const s of scores) {
      if (s.daysActive < minDays || s.score <= 0) continue;
      const wallet = await storage.getMemberWallet(config.id, s.telegramUserId);
      if (config.rewardRequireSelfVerified && !wallet?.selfVerified) continue;
      const userCap = wallet?.selfVerified ? (config.rewardMaxPerUserPerPeriodVerified ?? maxPerUser) : maxPerUser;
      if ((payoutCountByUser.get(s.telegramUserId) || 0) >= userCap) continue;
      const scamCount = await storage.getScamCountForUser(config.id, s.telegramUserId);
      if (scamCount > 0) continue;
      const banned = await storage.isUserAutoBanned(config.id, s.telegramUserId);
      if (banned) continue;
      eligibleCandidates.push(s);
      if (eligibleCandidates.length >= topN) break;
    }

    if (eligibleCandidates.length === 0) continue;

    let perWinnerAmount = amountPerWinner;
    if (poolPerPeriod !== "0") {
      try {
        const poolBig = BigInt(poolPerPeriod);
        const share = poolBig / BigInt(eligibleCandidates.length);
        if (share > 0n) perWinnerAmount = share.toString();
      } catch {
        log(`Invalid rewardPoolPerPeriod for bot ${config.id}: ${poolPerPeriod}`, "rewards");
      }
    }

    // Apply TELI-paid owner bonus (per-bot effective multiplier).
    try {
      const owner = await storage.getUserById(config.userId);
      const multiplier = getRewardsBoostMultiplier(owner);
      if (multiplier > 1) {
        const numerator = BigInt(Math.round(multiplier * 10000));
        const boosted = (BigInt(perWinnerAmount) * numerator) / 10000n;
        if (boosted > 0n) perWinnerAmount = boosted.toString();
      }
    } catch (err: any) {
      log(`Rewards boost lookup failed for bot ${config.id}: ${err.message}`, "rewards");
    }

    if (opts.dryRun) {
      totalRecipients += eligibleCandidates.length;
      continue;
    }

    const distribution = await storage.createRewardDistribution({
      botConfigId: config.id,
      groupId: gid,
      periodStart: period.start,
      periodEnd: period.end,
      status: "pending",
      totalRecipients: eligibleCandidates.length,
      tokenChain: chain,
      tokenAddress,
      tokenSymbol,
      amountPerWinner: perWinnerAmount,
      notes: poolPerPeriod !== "0" ? `pool=${poolPerPeriod} share=${perWinnerAmount} group=${gid}` : `group=${gid}`,
    });
    distributionIds.push(distribution.id);
    // First persisted distribution row commits the claim; revert is no
    // longer correct because real work now lives under this period stamp.
    needsClaimRevert = false;

    let sent = 0, failed = 0, skipped = 0;
    for (let i = 0; i < eligibleCandidates.length; i++) {
      const winner = eligibleCandidates[i];
      const wallet = await storage.getMemberWallet(config.id, winner.telegramUserId);
      const baseRow: InsertRewardPayout = {
        distributionId: distribution.id,
        botConfigId: config.id,
        telegramUserId: winner.telegramUserId,
        userName: winner.userName,
        walletAddress: wallet?.walletAddress ?? null,
        amount: perWinnerAmount,
        rank: i + 1,
        score: winner.score,
        kind: "leaderboard",
        status: "pending",
      };

      if (!wallet?.walletAddress) {
        try {
          // Atomic: insert payout row + bump skipped_count in one tx so a
          // crash here cannot leave the counters out of sync with rows.
          await storage.recordPayoutWithProgress(distribution.id, { ...baseRow, status: "skipped", errorMessage: "no wallet on file" });
          skipped++;
        } catch (err) {
          // Row write failed - counter not bumped. Increment in-memory
          // failed so finalize-from-DB still treats this recipient as
          // unaccounted (handled by total_recipients > sum check).
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          log(`Failed to record skipped payout for bot ${config.id} group ${gid} -> ${winner.telegramUserId}: ${msg}`, "rewards");
        }
        continue;
      }

      // Network call lives outside the persistence tx so we can
      // distinguish transfer failures (persisted as "failed") from
      // row-write failures (treated as failed via DB-counter delta).
      let txHash: string | null = null;
      let explorerUrl: string | undefined;
      let transferError: string | null = null;
      try {
        const r = await transferErc20({ chain, tokenAddress, recipient: wallet.walletAddress, amount: perWinnerAmount, decimals });
        txHash = r.txHash;
        explorerUrl = r.explorerUrl;
      } catch (err) {
        transferError = err instanceof Error ? err.message : String(err);
      }

      try {
        if (transferError !== null) {
          await storage.recordPayoutWithProgress(distribution.id, { ...baseRow, status: "failed", errorMessage: transferError.slice(0, 500) });
          failed++;
          log(`Reward transfer failed for bot ${config.id} group ${gid} -> ${winner.telegramUserId}: ${transferError}`, "rewards");
        } else if (txHash) {
          await storage.recordPayoutWithProgress(distribution.id, { ...baseRow, status: "sent", txHash, explorerUrl });
          payoutCountByUser.set(winner.telegramUserId, (payoutCountByUser.get(winner.telegramUserId) || 0) + 1);
          sent++;
        } else {
          await storage.recordPayoutWithProgress(distribution.id, { ...baseRow, status: "failed", errorMessage: "transfer returned no tx hash" });
          failed++;
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log(`Failed to persist payout for bot ${config.id} group ${gid} -> ${winner.telegramUserId}: ${msg}`, "rewards");
      }
    }

    // Final status is derived from the persisted DB counters (NOT just
    // the in-memory loop tallies). This means a crash during the loop
    // still produces a determinate status when the process restarts and
    // recovery sweeps over pending distributions.
    const final = await storage.finalizeDistributionFromCounters(distribution.id);
    const finalStatus = final?.status ?? "failed";
    log(`Distribution ${distribution.id} finalized as ${finalStatus} (sent=${final?.sent ?? sent} failed=${final?.failed ?? failed} skipped=${final?.skipped ?? skipped})`, "rewards");
    totalRecipients += eligibleCandidates.length;
    totalSent += sent; totalFailed += failed; totalSkipped += skipped;
  }

    if (totalRecipients === 0) {
      // Claimed the period but found nothing to pay. Hand the period
      // back so the next run can try again instead of waiting a full
      // period for the next stamp window.
      await releaseClaim("no_eligible_contributors");
      return { ok: false, reason: "no eligible contributors" };
    }
    if (opts.dryRun) return { ok: true, reason: "dry run", recipients: totalRecipients };

    log(`Rewards for bot ${config.id}: groups=${distributionIds.length} sent=${totalSent} failed=${totalFailed} skipped=${totalSkipped}`, "rewards");
    return { ok: true, distributionId: distributionIds[0], recipients: totalRecipients };
  } catch (err) {
    // Uncaught exception inside the heavy loop. Best-effort: for every
    // distribution we created, re-derive a determinate status from the
    // persisted counters via finalizeDistributionFromCounters. That way
    // earlier groups that already finished cleanly keep their
    // completed/partial status, and only the truly-stuck row (the one we
    // were mid-loop on) gets downgraded to failed. We never blanket-mark
    // everything failed, since that would overwrite already-finalized rows.
    const msg = err instanceof Error ? err.message : String(err);
    log(`[rewards.run] crashed bot=${config.id} err=${msg}`, "rewards");
    for (const id of distributionIds) {
      try {
        const finalized = await storage.finalizeDistributionFromCounters(id);
        if (!finalized) {
          await storage.updateRewardDistribution(id, { status: "failed", completedAt: new Date(), notes: `crashed: ${msg.slice(0, 200)}` });
        }
      } catch {
        // swallow - already in error path
      }
    }
    // If we crashed BEFORE persisting any distribution row, hand the
    // period back so the next run is not blocked by a stamp that
    // represents zero work.
    await releaseClaim("crashed_before_first_distribution");
    throw err;
  } finally {
    // Always clear the in-progress marker, even on crash. The period stamp
    // was advanced atomically at the top, so a stuck running marker is the
    // only thing that could mislead operators.
    if (!opts.dryRun && !opts.force) {
      try { await storage.clearRewardsRunning(config.id); } catch { /* best-effort */ }
    }
  }
}

export async function payReferralReward(config: BotConfig, telegramUserId: string, userName: string | null): Promise<void> {
  if (!config.referralEnabled) return;
  const amount = config.referralRewardAmount || "0";
  if (amount === "0") return;
  const tokenAddress = config.rewardTokenAddress || "";
  if (!tokenAddress) return;

  const wallet = await storage.getMemberWallet(config.id, telegramUserId);
  const chain = (config.rewardTokenChain || "base") as RewardChain;
  const decimals = config.rewardTokenDecimals ?? 18;

  const distribution = await storage.createRewardDistribution({
    botConfigId: config.id,
    periodStart: new Date(),
    periodEnd: new Date(),
    status: "pending",
    totalRecipients: 1,
    tokenChain: chain,
    tokenAddress,
    tokenSymbol: config.rewardTokenSymbol || "TOKEN",
    amountPerWinner: amount,
    notes: "referral",
  });

  const baseRow: InsertRewardPayout = {
    distributionId: distribution.id,
    botConfigId: config.id,
    telegramUserId,
    userName,
    walletAddress: wallet?.walletAddress ?? null,
    amount,
    rank: 0,
    score: 0,
    kind: "referral",
    status: "pending",
  };

  if (!wallet?.walletAddress) {
    await storage.createRewardPayout({ ...baseRow, status: "skipped", errorMessage: "no wallet on file" });
    await storage.updateRewardDistribution(distribution.id, { status: "skipped", completedAt: new Date() });
    return;
  }

  try {
    const { txHash, explorerUrl } = await transferErc20({ chain, tokenAddress, recipient: wallet.walletAddress, amount, decimals });
    await storage.createRewardPayout({ ...baseRow, status: "sent", txHash, explorerUrl });
    await storage.updateRewardDistribution(distribution.id, { status: "sent", completedAt: new Date() });
  } catch (err: any) {
    await storage.createRewardPayout({ ...baseRow, status: "failed", errorMessage: err.message?.slice(0, 500) });
    await storage.updateRewardDistribution(distribution.id, { status: "failed", completedAt: new Date() });
    log(`Referral reward failed for bot ${config.id} → ${telegramUserId}: ${err.message}`, "rewards");
  }
}
