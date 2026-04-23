import type { User } from "@shared/models/auth";

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

const DEFAULT_LIMITS: Limits = {
  maxBots: parseInt(process.env.MAX_BOTS_PER_USER || "10", 10),
  maxKbEntries: parseInt(process.env.MAX_KB_ENTRIES_PER_BOT || "500", 10),
  maxGroupsPerBot: parseInt(process.env.MAX_GROUPS_PER_BOT || "100", 10),
  dailyAiCallsPerBot: parseInt(process.env.DAILY_AI_CALLS_PER_BOT || "1000", 10),
  apiRateLimitPerMin: 60,
  publicApiRateLimitPerMin: 30,
  widgetApiRateLimitPerMin: 20,
  scrapeRateLimitPerMin: 5,
  maxBotResponseChars: parseInt(process.env.MAX_BOT_RESPONSE_CHARS || "4000", 10),
  agentApiRateLimitPerMin: 30,
  agentApiTrustedRateLimitPerMin: 60,
  allowWidget: true,
  allowBankr: true,
  allowRewards: true,
  allowAgentApi: true,
  allowErc8004: true,
  allowFeedbackDigest: true,
};

export function getDefaultLimits(): Limits {
  return { ...DEFAULT_LIMITS };
}

/**
 * Resolve the active limits for a given user. Currently returns defaults for
 * everyone — this is the seam where subscription tiers will plug in. Keeping
 * the user param now means call sites don't need to change later.
 */
export function getLimitsForUser(_user?: User | null | undefined): Limits {
  return { ...DEFAULT_LIMITS };
}

/**
 * Limits scoped to a bot. Today this just returns the defaults — when tiers
 * land, this will look up the bot's owner and return their tier's limits.
 */
export function getLimitsForBot(_botConfigId: number): Limits {
  return { ...DEFAULT_LIMITS };
}
