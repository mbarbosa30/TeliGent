import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const botConfigs = pgTable("bot_configs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botToken: text("bot_token").notNull().default(""),
  botName: text("bot_name").notNull().default("My Bot"),
  personality: text("personality").notNull().default("You are a helpful group assistant. Answer questions clearly and concisely based on the knowledge base provided. Be friendly but not overly chatty."),
  globalContext: text("global_context").notNull().default(""),
  websiteUrl: text("website_url").default(""),
  websiteContent: text("website_content").default(""),
  responseMode: text("response_mode").notNull().default("smart"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(30),
  maxResponseLength: integer("max_response_length").notNull().default(500),
  isActive: boolean("is_active").notNull().default(true),
  onlyRespondWhenMentioned: boolean("only_respond_when_mentioned").notNull().default(false),
  respondToReplies: boolean("respond_to_replies").notNull().default(true),
  autoBanThreshold: integer("auto_ban_threshold").notNull().default(0),
  trackReports: boolean("track_reports").notNull().default(true),
  reportKeywords: text("report_keywords").array().notNull().default(sql`ARRAY['report', 'issue', 'bug', 'problem', 'broken']`),
  widgetEnabled: boolean("widget_enabled").notNull().default(false),
  widgetKey: varchar("widget_key", { length: 64 }),
  bankrEnabled: boolean("bankr_enabled").notNull().default(false),
  bankrApiKey: text("bankr_api_key"),
  rewardsEnabled: boolean("rewards_enabled").notNull().default(false),
  rewardTokenChain: text("reward_token_chain").notNull().default("base"),
  rewardTokenAddress: text("reward_token_address").default(""),
  rewardTokenSymbol: text("reward_token_symbol").default(""),
  rewardTokenDecimals: integer("reward_token_decimals").notNull().default(18),
  rewardPeriodDays: integer("reward_period_days").notNull().default(7),
  rewardTopN: integer("reward_top_n").notNull().default(5),
  rewardAmountPerWinner: text("reward_amount_per_winner").default("0"),
  rewardPoolPerPeriod: text("reward_pool_per_period").default("0"),
  rewardMinDaysActive: integer("reward_min_days_active").notNull().default(3),
  rewardLastDistributionAt: timestamp("reward_last_distribution_at"),
  proactiveEnabled: boolean("proactive_enabled").notNull().default(false),
  proactiveMode: text("proactive_mode").notNull().default("queue"),
  proactiveCadenceHours: integer("proactive_cadence_hours").notNull().default(24),
  proactiveLastAt: timestamp("proactive_last_at"),
  referralEnabled: boolean("referral_enabled").notNull().default(false),
  referralRewardAmount: text("referral_reward_amount").default("0"),
  referralActivationDays: integer("referral_activation_days").notNull().default(3),
  rewardMaxPerUserPerPeriod: integer("reward_max_per_user_per_period").notNull().default(1),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_bot_configs_user_id").on(table.userId),
  index("idx_bot_configs_is_active").on(table.isActive),
]);

export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceUrl: text("source_url"),
  category: text("category").notNull().default("general"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_knowledge_base_bot_config_id").on(table.botConfigId),
]);

export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id").notNull(),
  name: text("name").notNull(),
  memberCount: integer("member_count").default(0),
  isActive: boolean("is_active").notNull().default(true),
  joinedAt: timestamp("joined_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_groups_bot_config_chat_unique").on(table.botConfigId, table.telegramChatId),
]);

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  telegramUserId: text("telegram_user_id"),
  userName: text("user_name"),
  userMessage: text("user_message"),
  botResponse: text("bot_response"),
  isReport: boolean("is_report").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_activity_logs_bot_config_created").on(table.botConfigId, table.createdAt),
  index("idx_activity_logs_telegram_user").on(table.botConfigId, table.telegramUserId),
]);

export const reportedScamPatterns = pgTable("reported_scam_patterns", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").references(() => botConfigs.id, { onDelete: "cascade" }).notNull(),
  pattern: text("pattern").notNull(),
  originalText: text("original_text"),
  source: text("source").notNull().default("report"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_reported_scam_patterns_bot_config_id").on(table.botConfigId),
]);

export const botMemories = pgTable("bot_memories", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("insight"),
  content: text("content").notNull(),
  source: text("source").notNull().default("auto"),
  confidence: integer("confidence").notNull().default(70),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_bot_memories_bot_config_id").on(table.botConfigId),
]);

export const widgetConversations = pgTable("widget_conversations", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  visitorName: text("visitor_name"),
  pageUrl: text("page_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_widget_conversations_bot_config_id").on(table.botConfigId),
  index("idx_widget_conversations_session").on(table.botConfigId, table.sessionId),
]);

export const widgetMessages = pgTable("widget_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => widgetConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_widget_messages_conversation_id").on(table.conversationId),
]);

export const insertBotConfigSchema = createInsertSchema(botConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({
  id: true,
  createdAt: true,
});

export const insertGroupSchema = createInsertSchema(groups).omit({
  id: true,
  joinedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertReportedScamPatternSchema = createInsertSchema(reportedScamPatterns).omit({
  id: true,
  createdAt: true,
});

export type BotConfig = typeof botConfigs.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type KnowledgeBaseEntry = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBaseEntry = z.infer<typeof insertKnowledgeBaseSchema>;
export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ReportedScamPattern = typeof reportedScamPatterns.$inferSelect;
export type InsertReportedScamPattern = z.infer<typeof insertReportedScamPatternSchema>;

export const insertBotMemorySchema = createInsertSchema(botMemories).omit({
  id: true,
  createdAt: true,
});
export type BotMemory = typeof botMemories.$inferSelect;
export type InsertBotMemory = z.infer<typeof insertBotMemorySchema>;

export const insertWidgetConversationSchema = createInsertSchema(widgetConversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertWidgetMessageSchema = createInsertSchema(widgetMessages).omit({
  id: true,
  createdAt: true,
});
export type WidgetConversation = typeof widgetConversations.$inferSelect;
export type InsertWidgetConversation = z.infer<typeof insertWidgetConversationSchema>;
export type WidgetMessage = typeof widgetMessages.$inferSelect;
export type InsertWidgetMessage = z.infer<typeof insertWidgetMessageSchema>;

export const agentServiceLogs = pgTable("agent_service_logs", {
  id: serial("id").primaryKey(),
  service: text("service").notNull(),
  callerIdentifier: text("caller_identifier"),
  inputLength: integer("input_length"),
  isScam: boolean("is_scam"),
  method: text("method"),
  reason: text("reason"),
  pricingTier: text("pricing_tier").notNull().default("free"),
  amountUsdc: text("amount_usdc").default("0"),
  paymentId: text("payment_id"),
  paymentVerified: boolean("payment_verified").default(false),
  selfVerified: boolean("self_verified").default(false),
  selfAgentAddress: text("self_agent_address"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_agent_service_logs_created").on(table.createdAt),
  index("idx_agent_service_logs_service").on(table.service),
]);

export const insertAgentServiceLogSchema = createInsertSchema(agentServiceLogs).omit({
  id: true,
  createdAt: true,
});
export type AgentServiceLog = typeof agentServiceLogs.$inferSelect;
export type InsertAgentServiceLog = z.infer<typeof insertAgentServiceLogSchema>;

export const userMemories = pgTable("user_memories", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  userName: text("user_name"),
  type: text("type").notNull().default("trait"),
  content: text("content").notNull(),
  confidence: integer("confidence").notNull().default(60),
  qualityScore: integer("quality_score").notNull().default(0),
  hitCount: integer("hit_count").notNull().default(1),
  sourceActivityLogId: integer("source_activity_log_id"),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_user_memories_bot_user").on(table.botConfigId, table.telegramUserId),
  index("idx_user_memories_bot_created").on(table.botConfigId, table.createdAt),
]);

export const collectivePatterns = pgTable("collective_patterns", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("topic"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  keywords: text("keywords").array().notNull().default(sql`ARRAY[]::text[]`),
  mentionCount: integer("mention_count").notNull().default(1),
  uniqueUsers: integer("unique_users").notNull().default(1),
  confidence: integer("confidence").notNull().default(60),
  status: text("status").notNull().default("open"),
  promotedKbId: integer("promoted_kb_id"),
  qualityScore: integer("quality_score").notNull().default(0),
  lastSourceActivityLogId: integer("last_source_activity_log_id"),
  firstSeenAt: timestamp("first_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_collective_patterns_bot_kind").on(table.botConfigId, table.kind),
  index("idx_collective_patterns_bot_status").on(table.botConfigId, table.status),
  index("idx_collective_patterns_bot_lastseen").on(table.botConfigId, table.lastSeenAt),
]);

export const dataCorrelations = pgTable("data_correlations", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  patternId: integer("pattern_id").notNull().references(() => collectivePatterns.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  weight: integer("weight").notNull().default(1),
  sourceActivityLogId: integer("source_activity_log_id"),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_data_correlations_unique").on(table.patternId, table.telegramUserId),
  index("idx_data_correlations_bot").on(table.botConfigId),
  index("idx_data_correlations_bot_lastseen").on(table.botConfigId, table.lastSeenAt),
]);

export const calibrationLogs = pgTable("calibration_logs", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  sourceActivityLogId: integer("source_activity_log_id"),
  triageTier: text("triage_tier").notNull(),
  contribution: integer("contribution").notNull(),
  domainRelevance: integer("domain_relevance").notNull(),
  overall: integer("overall").notNull(),
  gated: boolean("gated").notNull().default(false),
  savedUserMemory: boolean("saved_user_memory").notNull().default(false),
  savedPattern: boolean("saved_pattern").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_calibration_logs_bot_created").on(table.botConfigId, table.createdAt),
]);

export const wisdomSnapshots = pgTable("wisdom_snapshots", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  components: jsonb("components").notNull(),
  digest: text("digest"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_wisdom_snapshots_bot_created").on(table.botConfigId, table.createdAt),
]);

export const insertUserMemorySchema = createInsertSchema(userMemories).omit({ id: true, createdAt: true, lastSeenAt: true });
export type UserMemory = typeof userMemories.$inferSelect;
export type InsertUserMemory = z.infer<typeof insertUserMemorySchema>;

export const insertCollectivePatternSchema = createInsertSchema(collectivePatterns).omit({ id: true, firstSeenAt: true, lastSeenAt: true });
export type CollectivePattern = typeof collectivePatterns.$inferSelect;
export type InsertCollectivePattern = z.infer<typeof insertCollectivePatternSchema>;

export const insertDataCorrelationSchema = createInsertSchema(dataCorrelations).omit({ id: true, lastSeenAt: true });
export type DataCorrelation = typeof dataCorrelations.$inferSelect;
export type InsertDataCorrelation = z.infer<typeof insertDataCorrelationSchema>;

export type WisdomSnapshot = typeof wisdomSnapshots.$inferSelect;

export type CalibrationLog = typeof calibrationLogs.$inferSelect;
export const insertCalibrationLogSchema = createInsertSchema(calibrationLogs).omit({ id: true, createdAt: true });
export type InsertCalibrationLog = z.infer<typeof insertCalibrationLogSchema>;

export const memberWallets = pgTable("member_wallets", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  userName: text("user_name"),
  walletAddress: varchar("wallet_address", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_member_wallets_unique").on(table.botConfigId, table.telegramUserId),
]);

export const contributionScores = pgTable("contribution_scores", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  userName: text("user_name"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  score: integer("score").notNull().default(0),
  breakdown: jsonb("breakdown"),
  daysActive: integer("days_active").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_contribution_scores_unique").on(table.botConfigId, table.telegramUserId, table.periodStart),
  index("idx_contribution_scores_bot_period").on(table.botConfigId, table.periodStart),
]);

export const rewardDistributions = pgTable("reward_distributions", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  status: text("status").notNull().default("pending"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  tokenChain: text("token_chain").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  amountPerWinner: text("amount_per_winner").notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_reward_distributions_bot_created").on(table.botConfigId, table.createdAt),
]);

export const rewardPayouts = pgTable("reward_payouts", {
  id: serial("id").primaryKey(),
  distributionId: integer("distribution_id").notNull().references(() => rewardDistributions.id, { onDelete: "cascade" }),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramUserId: text("telegram_user_id").notNull(),
  userName: text("user_name"),
  walletAddress: text("wallet_address"),
  amount: text("amount").notNull().default("0"),
  status: text("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  errorMessage: text("error_message"),
  rank: integer("rank").notNull().default(0),
  score: integer("score").notNull().default(0),
  kind: text("kind").notNull().default("leaderboard"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_reward_payouts_distribution").on(table.distributionId),
  index("idx_reward_payouts_bot_created").on(table.botConfigId, table.createdAt),
]);

export const proactivePrompts = pgTable("proactive_prompts", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  patternId: integer("pattern_id").references(() => collectivePatterns.id, { onDelete: "set null" }),
  question: text("question").notNull(),
  rationale: text("rationale"),
  status: text("status").notNull().default("queued"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_proactive_prompts_bot_status").on(table.botConfigId, table.status),
]);

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  botConfigId: integer("bot_config_id").notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
  referrerTelegramUserId: text("referrer_telegram_user_id").notNull(),
  referrerUserName: text("referrer_user_name"),
  refereeTelegramUserId: text("referee_telegram_user_id").notNull(),
  refereeUserName: text("referee_user_name"),
  telegramChatId: text("telegram_chat_id"),
  status: text("status").notNull().default("pending"),
  joinedGroupAt: timestamp("joined_group_at"),
  creditedAt: timestamp("credited_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("idx_referrals_unique_referee").on(table.botConfigId, table.refereeTelegramUserId),
  index("idx_referrals_bot_status").on(table.botConfigId, table.status),
]);

export type MemberWallet = typeof memberWallets.$inferSelect;
export const insertMemberWalletSchema = createInsertSchema(memberWallets).omit({ id: true, createdAt: true });
export type InsertMemberWallet = z.infer<typeof insertMemberWalletSchema>;

export type ContributionScore = typeof contributionScores.$inferSelect;
export const insertContributionScoreSchema = createInsertSchema(contributionScores).omit({ id: true, createdAt: true });
export type InsertContributionScore = z.infer<typeof insertContributionScoreSchema>;

export type RewardDistribution = typeof rewardDistributions.$inferSelect;
export const insertRewardDistributionSchema = createInsertSchema(rewardDistributions).omit({ id: true, createdAt: true });
export type InsertRewardDistribution = z.infer<typeof insertRewardDistributionSchema>;

export type RewardPayout = typeof rewardPayouts.$inferSelect;
export const insertRewardPayoutSchema = createInsertSchema(rewardPayouts).omit({ id: true, createdAt: true });
export type InsertRewardPayout = z.infer<typeof insertRewardPayoutSchema>;

export type ProactivePrompt = typeof proactivePrompts.$inferSelect;
export const insertProactivePromptSchema = createInsertSchema(proactivePrompts).omit({ id: true, createdAt: true });
export type InsertProactivePrompt = z.infer<typeof insertProactivePromptSchema>;

export type Referral = typeof referrals.$inferSelect;
export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
