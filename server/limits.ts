import type { User } from "@shared/models/auth";
import { storage } from "./storage";

export type PlanTier = "free" | "pro" | "business";

export type Limits = {
  maxBots: number;
  maxKbEntries: number;
  maxGroupsPerBot: number;
  dailyAiCallsPerBot: number;
  apiRateLimitPerMin: number;
  publicApiRateLimitPerMin: number;
  widgetApiRateLimitPerMin: number;
  scrapeRateLimitPerMin: number;
  maxBotResponseChars: number;
  agentApiRateLimitPerMin: number;
  agentApiTrustedRateLimitPerMin: number;
  allowWidget: boolean;
  allowBankr: boolean;
  allowRewards: boolean;
  allowAgentApi: boolean;
  allowErc8004: boolean;
  allowFeedbackDigest: boolean;
};

const DEFAULT_RUNTIME = {
  maxBotResponseChars: parseInt(process.env.MAX_BOT_RESPONSE_CHARS || "4000", 10),
  scrapeRateLimitPerMin: 5,
  publicApiRateLimitPerMin: 30,
};

export const TIER_LIMITS: Record<PlanTier, Limits> = {
  free: {
    maxBots: 1,
    maxKbEntries: 50,
    maxGroupsPerBot: 2,
    dailyAiCallsPerBot: 200,
    apiRateLimitPerMin: 30,
    widgetApiRateLimitPerMin: 10,
    agentApiRateLimitPerMin: 10,
    agentApiTrustedRateLimitPerMin: 20,
    allowWidget: false,
    allowBankr: false,
    allowRewards: true,
    allowAgentApi: false,
    allowErc8004: false,
    allowFeedbackDigest: false,
    ...DEFAULT_RUNTIME,
  },
  pro: {
    maxBots: 3,
    maxKbEntries: 250,
    maxGroupsPerBot: 10,
    dailyAiCallsPerBot: 1500,
    apiRateLimitPerMin: 60,
    widgetApiRateLimitPerMin: 30,
    agentApiRateLimitPerMin: 30,
    agentApiTrustedRateLimitPerMin: 60,
    allowWidget: true,
    allowBankr: true,
    allowRewards: true,
    allowAgentApi: true,
    allowErc8004: true,
    allowFeedbackDigest: true,
    ...DEFAULT_RUNTIME,
  },
  business: {
    maxBots: 10,
    maxKbEntries: 1000,
    maxGroupsPerBot: 50,
    dailyAiCallsPerBot: 8000,
    apiRateLimitPerMin: 120,
    widgetApiRateLimitPerMin: 60,
    agentApiRateLimitPerMin: 60,
    agentApiTrustedRateLimitPerMin: 120,
    allowWidget: true,
    allowBankr: true,
    allowRewards: true,
    allowAgentApi: true,
    allowErc8004: true,
    allowFeedbackDigest: true,
    ...DEFAULT_RUNTIME,
  },
};

export const TIER_PRICING: Record<PlanTier, { monthlyUsd: number; annualUsd: number }> = {
  free: { monthlyUsd: 0, annualUsd: 0 },
  pro: { monthlyUsd: 19, annualUsd: 190 },
  business: { monthlyUsd: 79, annualUsd: 790 },
};

export const TELI_DISCOUNT_PCT = parseInt(process.env.TELI_DISCOUNT_PCT || "25", 10);
export const TELI_REWARDS_BOOST_PCT = parseInt(process.env.TELI_REWARDS_BOOST_PCT || "20", 10);

function normalisePlan(plan: string | null | undefined): PlanTier {
  if (plan === "pro" || plan === "business") return plan;
  return "free";
}

// Both helpers only read `plan` and `planPeriodEnd`, so accept the minimal
// shape rather than the full User row. This lets callers with partial user
// data (e.g. crypto billing intents) pass typed objects without casts.
type PlanFields = Pick<User, "plan" | "planPeriodEnd">;

export function isPlanActive(user: PlanFields | null | undefined): boolean {
  if (!user) return false;
  if (user.plan === "free") return true;
  if (!user.planPeriodEnd) return false;
  return new Date(user.planPeriodEnd).getTime() > Date.now();
}

export function getEffectivePlan(user: PlanFields | null | undefined): PlanTier {
  if (!user) return "free";
  return isPlanActive(user) ? normalisePlan(user.plan) : "free";
}

export function getDefaultLimits(): Limits {
  return { ...TIER_LIMITS.free };
}

/**
 * Resolve the active limits for a given user. Includes $TELI perks: when the
 * current period was paid in $TELI, agent API rate limits are doubled to the
 * next tier's ceiling and the user keeps their TELI badge.
 */
export function getLimitsForUser(user?: User | null | undefined): Limits {
  const tier = getEffectivePlan(user);
  const base = { ...TIER_LIMITS[tier] };
  if (user && user.teliPaid && isPlanActive(user)) {
    base.agentApiRateLimitPerMin = base.agentApiRateLimitPerMin * 2;
    base.agentApiTrustedRateLimitPerMin = base.agentApiTrustedRateLimitPerMin * 2;
  }
  return base;
}

/**
 * Limits scoped to a bot. Looks up the bot owner and returns their tier limits.
 * Falls back to defaults when the bot or owner is missing.
 */
export async function getLimitsForBotAsync(botConfigId: number): Promise<Limits> {
  try {
    const bot = await storage.getBotConfig(botConfigId);
    if (!bot) return getDefaultLimits();
    const user = await storage.getUserById(bot.userId);
    return getLimitsForUser(user);
  } catch {
    return getDefaultLimits();
  }
}

/**
 * Synchronous fallback used by hot paths that can't await. Returns Free-tier
 * limits unless the caller already resolved them.
 */
export function getLimitsForBot(_botConfigId: number): Limits {
  return getDefaultLimits();
}

export function getRewardsBoostMultiplier(user: User | null | undefined): number {
  if (!user) return 1;
  if (!user.teliPaid) return 1;
  if (!isPlanActive(user)) return 1;
  return 1 + TELI_REWARDS_BOOST_PCT / 100;
}
