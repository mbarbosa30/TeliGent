import { storage } from "../storage";
import { log } from "../index";
import { computeContributorScores, persistContributorScores, getPreviousPeriod } from "./reputation";
import { transferErc20, type RewardChain } from "../agent/erc20";
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

  const scores = await computeContributorScores(config.id, period.start, period.end);
  await persistContributorScores(config.id, period.start, period.end, scores);

  const allRecentPayouts = await storage.listRewardPayouts(config.id, 500);
  const payoutCountByUser = new Map<string, number>();
  for (const p of allRecentPayouts) {
    if (p.status !== "sent" || !p.createdAt || new Date(p.createdAt) < period.start) continue;
    payoutCountByUser.set(p.telegramUserId, (payoutCountByUser.get(p.telegramUserId) || 0) + 1);
  }

  const eligibleCandidates = [];
  for (const s of scores) {
    if (s.daysActive < minDays || s.score <= 0) continue;
    if ((payoutCountByUser.get(s.telegramUserId) || 0) >= maxPerUser) continue;
    const scamCount = await storage.getScamCountForUser(config.id, s.telegramUserId);
    if (scamCount > 0) continue;
    eligibleCandidates.push(s);
    if (eligibleCandidates.length >= topN) break;
  }

  if (eligibleCandidates.length === 0) {
    return { ok: false, reason: "no eligible contributors" };
  }

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

  if (opts.dryRun) {
    return { ok: true, reason: "dry run", recipients: eligibleCandidates.length };
  }

  const distribution = await storage.createRewardDistribution({
    botConfigId: config.id,
    periodStart: period.start,
    periodEnd: period.end,
    status: "pending",
    totalRecipients: eligibleCandidates.length,
    tokenChain: chain,
    tokenAddress,
    tokenSymbol,
    amountPerWinner: perWinnerAmount,
    notes: poolPerPeriod !== "0" ? `pool=${poolPerPeriod} share=${perWinnerAmount}` : null,
  });

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
      await storage.createRewardPayout({ ...baseRow, status: "skipped", errorMessage: "no wallet on file" });
      skipped++;
      continue;
    }

    try {
      const { txHash } = await transferErc20({
        chain,
        tokenAddress,
        recipient: wallet.walletAddress,
        amount: perWinnerAmount,
        decimals,
      });
      await storage.createRewardPayout({ ...baseRow, status: "sent", txHash });
      sent++;
    } catch (err: any) {
      await storage.createRewardPayout({ ...baseRow, status: "failed", errorMessage: err.message?.slice(0, 500) });
      failed++;
      log(`Reward transfer failed for bot ${config.id} → ${winner.telegramUserId}: ${err.message}`, "rewards");
    }
  }

  const finalStatus = failed > 0 && sent === 0 ? "failed" : sent > 0 ? "sent" : "skipped";
  await storage.updateRewardDistribution(distribution.id, { status: finalStatus, completedAt: new Date(), notes: `sent=${sent} failed=${failed} skipped=${skipped}` });
  await storage.updateBotConfig(config.id, { rewardLastDistributionAt: new Date() });

  log(`Rewards distribution ${distribution.id} for bot ${config.id}: sent=${sent} failed=${failed} skipped=${skipped}`, "rewards");
  return { ok: true, distributionId: distribution.id, recipients: eligibleCandidates.length };
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
    const { txHash } = await transferErc20({ chain, tokenAddress, recipient: wallet.walletAddress, amount, decimals });
    await storage.createRewardPayout({ ...baseRow, status: "sent", txHash });
    await storage.updateRewardDistribution(distribution.id, { status: "sent", completedAt: new Date() });
  } catch (err: any) {
    await storage.createRewardPayout({ ...baseRow, status: "failed", errorMessage: err.message?.slice(0, 500) });
    await storage.updateRewardDistribution(distribution.id, { status: "failed", completedAt: new Date() });
    log(`Referral reward failed for bot ${config.id} → ${telegramUserId}: ${err.message}`, "rewards");
  }
}
