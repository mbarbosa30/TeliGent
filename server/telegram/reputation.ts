import { storage } from "../storage";
import { log } from "../index";

export interface ContributorBreakdown {
  calibration: number;
  patterns: number;
  reports: number;
  messages: number;
  referrals: number;
  proactiveReplies: number;
  [key: string]: number;
}

export interface ContributorScore {
  telegramUserId: string;
  userName: string | null;
  score: number;
  daysActive: number;
  breakdown: ContributorBreakdown;
}

export function getCurrentPeriod(periodDays: number, ref: Date = new Date()): { start: Date; end: Date } {
  const ms = periodDays * 24 * 60 * 60 * 1000;
  const epoch = Math.floor(ref.getTime() / ms) * ms;
  return { start: new Date(epoch), end: new Date(epoch + ms) };
}

export function getPreviousPeriod(periodDays: number, ref: Date = new Date()): { start: Date; end: Date } {
  const cur = getCurrentPeriod(periodDays, ref);
  const ms = periodDays * 24 * 60 * 60 * 1000;
  return { start: new Date(cur.start.getTime() - ms), end: cur.start };
}

export async function computeContributorScores(botConfigId: number, periodStart: Date, periodEnd: Date): Promise<ContributorScore[]> {
  const aggregates = await storage.computeContributionAggregates(botConfigId, periodStart, periodEnd);
  const referralCounts = await storage.countCreditedReferralsByReferrer(botConfigId, periodStart, periodEnd);
  const proactiveReplyCounts = await storage.countProactiveRepliesByUser(botConfigId, periodStart, periodEnd);
  return aggregates.map(a => {
    const calibration = Math.max(0, Math.round(a.calibrationSum));
    const patterns = a.patternsCount * 8;
    const reports = a.reportsCount * 4;
    const messages = Math.min(20, a.messagesCount);
    const referrals = (referralCounts.get(a.telegramUserId) || 0) * 15;
    const proactiveReplies = (proactiveReplyCounts.get(a.telegramUserId) || 0) * 3;
    const score = calibration + patterns + reports + messages + referrals + proactiveReplies;
    return {
      telegramUserId: a.telegramUserId,
      userName: a.userName,
      score,
      daysActive: a.daysActive,
      breakdown: { calibration, patterns, reports, messages, referrals, proactiveReplies },
    };
  }).sort((x, y) => y.score - x.score);
}

export async function persistContributorScores(botConfigId: number, periodStart: Date, periodEnd: Date, scores: ContributorScore[]): Promise<void> {
  for (const s of scores) {
    try {
      await storage.upsertContributionScore({
        botConfigId,
        telegramUserId: s.telegramUserId,
        userName: s.userName,
        periodStart,
        periodEnd,
        score: s.score,
        breakdown: s.breakdown,
        daysActive: s.daysActive,
      });
    } catch (err: any) {
      log(`persistContributorScores error: ${err.message}`, "rewards");
    }
  }
}
