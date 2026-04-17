import { storage } from "../storage";
import { log } from "../index";
import { payReferralReward } from "./rewards";
import type { BotConfig } from "@shared/schema";

const DEFAULT_MIN_DAYS_FOR_CREDIT = 2;
const MAX_CREDITS_PER_PERIOD = 10;

export function parseReferrerFromStartArg(startArg: string | undefined): string | null {
  if (!startArg) return null;
  const m = startArg.match(/^ref_(\w{1,64})$/);
  return m ? m[1] : null;
}

export async function recordReferralIfNew(opts: {
  botConfigId: number;
  referrerTelegramUserId: string;
  refereeTelegramUserId: string;
  refereeUserName: string | null;
  telegramChatId: string | null;
  referrerUserName?: string | null;
}): Promise<void> {
  if (opts.referrerTelegramUserId === opts.refereeTelegramUserId) return;
  const existing = await storage.getReferralByReferee(opts.botConfigId, opts.refereeTelegramUserId);
  if (existing) return;
  await storage.createReferral({
    botConfigId: opts.botConfigId,
    referrerTelegramUserId: opts.referrerTelegramUserId,
    referrerUserName: opts.referrerUserName ?? null,
    refereeTelegramUserId: opts.refereeTelegramUserId,
    refereeUserName: opts.refereeUserName,
    telegramChatId: opts.telegramChatId,
    status: "pending",
  });
}

export async function processPendingReferrals(config: BotConfig): Promise<{ credited: number }> {
  if (!config.referralEnabled) return { credited: 0 };
  const pending = await storage.listPendingReferrals(config.id);
  if (pending.length === 0) return { credited: 0 };

  let credited = 0;
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const ref of pending) {
    try {
      const aggregates = await storage.computeContributionAggregates(
        config.id,
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        now,
      );
      if (!ref.joinedGroupAt) continue;
      const refereeAgg = aggregates.find(a => a.telegramUserId === ref.refereeTelegramUserId);
      const minDays = config.referralActivationDays ?? DEFAULT_MIN_DAYS_FOR_CREDIT;
      if (!refereeAgg || refereeAgg.daysActive < minDays) continue;

      const referrerCredits = await storage.countCreditedReferrals(config.id, ref.referrerTelegramUserId, since);
      if (referrerCredits >= MAX_CREDITS_PER_PERIOD) continue;

      await storage.markReferralCredited(ref.id);
      try {
        await payReferralReward(config, ref.referrerTelegramUserId, ref.referrerUserName);
      } catch (err: any) {
        log(`Referral payout failed for ref ${ref.id}: ${err.message}`, "referrals");
      }
      credited++;
    } catch (err: any) {
      log(`Referral processing error for ref ${ref.id}: ${err.message}`, "referrals");
    }
  }
  return { credited };
}
