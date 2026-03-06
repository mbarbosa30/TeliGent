import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_bot_configs_user_id").on(table.userId),
  index("idx_bot_configs_is_active").on(table.isActive),
]);

export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botConfigId: integer("bot_config_id").references(() => botConfigs.id, { onDelete: "cascade" }),
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
  botConfigId: integer("bot_config_id").references(() => botConfigs.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id").notNull(),
  name: text("name").notNull(),
  memberCount: integer("member_count").default(0),
  isActive: boolean("is_active").notNull().default(true),
  joinedAt: timestamp("joined_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("idx_groups_bot_config_chat").on(table.botConfigId, table.telegramChatId),
]);

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  botConfigId: integer("bot_config_id").references(() => botConfigs.id, { onDelete: "cascade" }),
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
