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
