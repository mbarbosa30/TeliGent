import { db } from "./db";
import { botConfigs, knowledgeBase, groups, activityLogs, users, reportedScamPatterns, botMemories } from "@shared/schema";
import type { BotConfig, InsertBotConfig, KnowledgeBaseEntry, InsertKnowledgeBaseEntry, Group, InsertGroup, ActivityLog, InsertActivityLog, User, ReportedScamPattern, BotMemory, InsertBotMemory } from "@shared/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";

export interface IStorage {
  getBotConfigs(userId: string): Promise<BotConfig[]>;
  getBotConfig(botConfigId: number): Promise<BotConfig | undefined>;
  createBotConfig(userId: string, data: Partial<InsertBotConfig>): Promise<BotConfig>;
  updateBotConfig(botConfigId: number, data: Partial<InsertBotConfig>): Promise<BotConfig>;
  deleteBotConfig(botConfigId: number): Promise<void>;
  getAllActiveConfigs(): Promise<BotConfig[]>;

  getKnowledgeEntries(botConfigId: number): Promise<KnowledgeBaseEntry[]>;
  getActiveKnowledgeEntries(botConfigId: number): Promise<KnowledgeBaseEntry[]>;
  createKnowledgeEntry(botConfigId: number, userId: string, entry: Omit<InsertKnowledgeBaseEntry, "userId" | "botConfigId">): Promise<KnowledgeBaseEntry>;
  updateKnowledgeEntry(botConfigId: number, id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined>;
  deleteKnowledgeEntry(botConfigId: number, id: number): Promise<void>;

  getGroups(botConfigId: number): Promise<Group[]>;
  getGroupByChatId(botConfigId: number, chatId: string): Promise<Group | undefined>;
  upsertGroup(botConfigId: number, userId: string, data: Omit<InsertGroup, "userId" | "botConfigId">): Promise<Group>;
  updateGroup(botConfigId: number, id: number, data: Partial<InsertGroup>): Promise<Group | undefined>;

  getActivityLogs(botConfigId: number, limit?: number, offset?: number): Promise<ActivityLog[]>;
  createActivityLog(botConfigId: number, userId: string, log: Omit<InsertActivityLog, "userId" | "botConfigId">): Promise<ActivityLog>;
  getScamCountForUser(botConfigId: number, telegramUserId: string): Promise<number>;
  cleanOldActivityLogs(retentionDays?: number): Promise<number>;

  getReportLogs(botConfigId: number, limit?: number, offset?: number): Promise<ActivityLog[]>;
  getReportedScamPatterns(botConfigId: number): Promise<ReportedScamPattern[]>;
  createReportedScamPattern(botConfigId: number, pattern: string, originalText?: string): Promise<ReportedScamPattern>;

  getBotMemories(botConfigId: number): Promise<BotMemory[]>;
  createBotMemory(botConfigId: number, data: Omit<InsertBotMemory, "botConfigId">): Promise<BotMemory>;
  deleteBotMemory(botConfigId: number, id: number): Promise<void>;
  countBotMemories(botConfigId: number): Promise<number>;

  getPublicStats(): Promise<{ scamsCaught: number; groupsProtected: number; botsActive: number; conversationsHandled: number }>;
  adminGetAllUsers(): Promise<Omit<User, "passwordHash">[]>;
  adminGetAllBots(): Promise<(BotConfig & { userEmail?: string })[]>;
  adminGetAllActivityLogs(limit?: number): Promise<(ActivityLog & { botName?: string })[]>;
  adminGetStats(): Promise<{ totalUsers: number; totalBots: number; totalGroups: number; totalLogs: number; totalScams: number }>;
}

export class DatabaseStorage implements IStorage {
  async getBotConfigs(userId: string): Promise<BotConfig[]> {
    return db.select().from(botConfigs).where(eq(botConfigs.userId, userId)).orderBy(desc(botConfigs.createdAt));
  }

  async getBotConfig(botConfigId: number): Promise<BotConfig | undefined> {
    const [config] = await db.select().from(botConfigs).where(eq(botConfigs.id, botConfigId)).limit(1);
    return config;
  }

  async createBotConfig(userId: string, data: Partial<InsertBotConfig>): Promise<BotConfig> {
    const [created] = await db.insert(botConfigs).values({ ...data, userId } as InsertBotConfig).returning();
    return created;
  }

  async updateBotConfig(botConfigId: number, data: Partial<InsertBotConfig>): Promise<BotConfig> {
    const [updated] = await db.update(botConfigs).set({ ...data, updatedAt: new Date() }).where(eq(botConfigs.id, botConfigId)).returning();
    return updated;
  }

  async deleteBotConfig(botConfigId: number): Promise<void> {
    await db.delete(botConfigs).where(eq(botConfigs.id, botConfigId));
  }

  async getAllActiveConfigs(): Promise<BotConfig[]> {
    return db.select().from(botConfigs).where(eq(botConfigs.isActive, true));
  }

  async getKnowledgeEntries(botConfigId: number): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).where(eq(knowledgeBase.botConfigId, botConfigId)).orderBy(desc(knowledgeBase.createdAt));
  }

  async getActiveKnowledgeEntries(botConfigId: number): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).where(and(eq(knowledgeBase.botConfigId, botConfigId), eq(knowledgeBase.isActive, true))).orderBy(desc(knowledgeBase.createdAt));
  }

  async createKnowledgeEntry(botConfigId: number, userId: string, entry: Omit<InsertKnowledgeBaseEntry, "userId" | "botConfigId">): Promise<KnowledgeBaseEntry> {
    const [created] = await db.insert(knowledgeBase).values({ ...entry, userId, botConfigId }).returning();
    return created;
  }

  async updateKnowledgeEntry(botConfigId: number, id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined> {
    const [updated] = await db.update(knowledgeBase).set(entry).where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.botConfigId, botConfigId))).returning();
    return updated;
  }

  async deleteKnowledgeEntry(botConfigId: number, id: number): Promise<void> {
    await db.delete(knowledgeBase).where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.botConfigId, botConfigId)));
  }

  async getGroups(botConfigId: number): Promise<Group[]> {
    return db.select().from(groups).where(eq(groups.botConfigId, botConfigId)).orderBy(desc(groups.joinedAt));
  }

  async getGroupByChatId(botConfigId: number, chatId: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(and(eq(groups.botConfigId, botConfigId), eq(groups.telegramChatId, chatId)));
    return group;
  }

  async upsertGroup(botConfigId: number, userId: string, data: Omit<InsertGroup, "userId" | "botConfigId">): Promise<Group> {
    const existing = await this.getGroupByChatId(botConfigId, data.telegramChatId);
    if (existing) {
      const [updated] = await db.update(groups).set(data).where(eq(groups.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(groups).values({ ...data, userId, botConfigId }).returning();
    return created;
  }

  async updateGroup(botConfigId: number, id: number, data: Partial<InsertGroup>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(data).where(and(eq(groups.id, id), eq(groups.botConfigId, botConfigId))).returning();
    return updated;
  }

  async getActivityLogs(botConfigId: number, limit = 100, offset = 0): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).where(eq(activityLogs.botConfigId, botConfigId)).orderBy(desc(activityLogs.createdAt)).limit(limit).offset(offset);
  }

  async getReportLogs(botConfigId: number, limit = 100, offset = 0): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).where(and(eq(activityLogs.botConfigId, botConfigId), eq(activityLogs.isReport, true))).orderBy(desc(activityLogs.createdAt)).limit(limit).offset(offset);
  }

  async cleanOldActivityLogs(retentionDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await db.delete(activityLogs).where(sql`${activityLogs.createdAt} < ${cutoff}`);
    return result.rowCount ?? 0;
  }

  async createActivityLog(botConfigId: number, userId: string, log: Omit<InsertActivityLog, "userId" | "botConfigId">): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values({ ...log, userId, botConfigId }).returning();
    return created;
  }

  async getScamCountForUser(botConfigId: number, telegramUserId: string): Promise<number> {
    const [result] = await db.select({ count: count() }).from(activityLogs).where(
      and(
        eq(activityLogs.botConfigId, botConfigId),
        eq(activityLogs.telegramUserId, telegramUserId),
        eq(activityLogs.isReport, true),
        sql`${activityLogs.metadata}->>'autoDetected' = 'true'`
      )
    );
    return result.count;
  }

  async getReportedScamPatterns(botConfigId: number): Promise<ReportedScamPattern[]> {
    return db.select().from(reportedScamPatterns).where(eq(reportedScamPatterns.botConfigId, botConfigId)).orderBy(desc(reportedScamPatterns.createdAt));
  }

  async createReportedScamPattern(botConfigId: number, pattern: string, originalText?: string): Promise<ReportedScamPattern> {
    const existing = await db.select().from(reportedScamPatterns).where(
      and(eq(reportedScamPatterns.botConfigId, botConfigId), eq(reportedScamPatterns.pattern, pattern))
    ).limit(1);
    if (existing.length > 0) return existing[0];
    const [created] = await db.insert(reportedScamPatterns).values({ botConfigId, pattern, originalText: originalText || null, source: "report" }).returning();
    return created;
  }

  async getBotMemories(botConfigId: number): Promise<BotMemory[]> {
    return db.select().from(botMemories).where(eq(botMemories.botConfigId, botConfigId)).orderBy(desc(botMemories.createdAt));
  }

  async createBotMemory(botConfigId: number, data: Omit<InsertBotMemory, "botConfigId">): Promise<BotMemory> {
    const [created] = await db.insert(botMemories).values({ ...data, botConfigId }).returning();
    return created;
  }

  async deleteBotMemory(botConfigId: number, id: number): Promise<void> {
    await db.delete(botMemories).where(and(eq(botMemories.id, id), eq(botMemories.botConfigId, botConfigId)));
  }

  async countBotMemories(botConfigId: number): Promise<number> {
    const [result] = await db.select({ count: count() }).from(botMemories).where(eq(botMemories.botConfigId, botConfigId));
    return result.count;
  }

  async getPublicStats(): Promise<{ scamsCaught: number; groupsProtected: number; botsActive: number; conversationsHandled: number }> {
    const [scamResult] = await db.select({ count: count() }).from(activityLogs).where(eq(activityLogs.isReport, true));
    const [groupResult] = await db.select({ count: count() }).from(groups);
    const [botResult] = await db.select({ count: count() }).from(botConfigs).where(and(eq(botConfigs.isActive, true), sql`${botConfigs.botToken} != ''`));
    const [convResult] = await db.select({ count: count() }).from(activityLogs).where(and(eq(activityLogs.isReport, false), sql`${activityLogs.botResponse} IS NOT NULL AND ${activityLogs.botResponse} != ''`));
    return {
      scamsCaught: scamResult.count,
      groupsProtected: groupResult.count,
      botsActive: botResult.count,
      conversationsHandled: convResult.count,
    };
  }

  async adminGetAllUsers(): Promise<Omit<User, "passwordHash">[]> {
    const rows = await db.select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      profileImageUrl: users.profileImageUrl,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).orderBy(desc(users.createdAt));
    return rows;
  }

  async adminGetAllBots(): Promise<(BotConfig & { userEmail?: string })[]> {
    const rows = await db.select({
      bot: botConfigs,
      userEmail: users.email,
    }).from(botConfigs).leftJoin(users, eq(botConfigs.userId, users.id)).orderBy(desc(botConfigs.createdAt));
    return rows.map(r => ({
      ...r.bot,
      botToken: r.bot.botToken ? "••••••" : "",
      userEmail: r.userEmail ?? undefined,
    }));
  }

  async adminGetAllActivityLogs(limit = 200): Promise<(ActivityLog & { botName?: string })[]> {
    const rows = await db.select({
      log: activityLogs,
      botName: botConfigs.botName,
    }).from(activityLogs).leftJoin(botConfigs, eq(activityLogs.botConfigId, botConfigs.id)).orderBy(desc(activityLogs.createdAt)).limit(limit);
    return rows.map(r => ({ ...r.log, botName: r.botName ?? undefined }));
  }

  async adminGetStats(): Promise<{ totalUsers: number; totalBots: number; totalGroups: number; totalLogs: number; totalScams: number }> {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [botCount] = await db.select({ count: count() }).from(botConfigs);
    const [groupCount] = await db.select({ count: count() }).from(groups);
    const [logCount] = await db.select({ count: count() }).from(activityLogs);
    const [scamCount] = await db.select({ count: count() }).from(activityLogs).where(
      and(eq(activityLogs.isReport, true), sql`${activityLogs.metadata}->>'autoDetected' = 'true'`)
    );
    return {
      totalUsers: userCount.count,
      totalBots: botCount.count,
      totalGroups: groupCount.count,
      totalLogs: logCount.count,
      totalScams: scamCount.count,
    };
  }
}

export const storage = new DatabaseStorage();
