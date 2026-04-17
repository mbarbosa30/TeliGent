import { db } from "./db";
import { botConfigs, knowledgeBase, groups, activityLogs, users, reportedScamPatterns, botMemories, widgetConversations, widgetMessages, agentServiceLogs, userMemories, collectivePatterns, dataCorrelations, wisdomSnapshots, calibrationLogs } from "@shared/schema";
import type { BotConfig, InsertBotConfig, KnowledgeBaseEntry, InsertKnowledgeBaseEntry, Group, InsertGroup, ActivityLog, InsertActivityLog, User, ReportedScamPattern, BotMemory, InsertBotMemory, WidgetConversation, WidgetMessage, AgentServiceLog, InsertAgentServiceLog, UserMemory, InsertUserMemory, CollectivePattern, InsertCollectivePattern, DataCorrelation, WisdomSnapshot } from "@shared/schema";
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

  getBotByWidgetKey(widgetKey: string): Promise<BotConfig | undefined>;
  getOrCreateWidgetConversation(botConfigId: number, sessionId: string, pageUrl?: string): Promise<WidgetConversation>;
  addWidgetMessage(conversationId: number, role: string, content: string): Promise<WidgetMessage>;
  getWidgetMessages(conversationId: number, limit?: number): Promise<WidgetMessage[]>;
  getWidgetConversations(botConfigId: number, limit?: number): Promise<(WidgetConversation & { messageCount: number; lastMessage?: string })[]>;

  getPublicStats(): Promise<{ scamsCaught: number; groupsProtected: number; botsActive: number; conversationsHandled: number }>;
  adminGetAllUsers(): Promise<Omit<User, "passwordHash">[]>;
  adminGetAllBots(): Promise<(BotConfig & { userEmail?: string })[]>;
  adminGetAllActivityLogs(limit?: number): Promise<(ActivityLog & { botName?: string })[]>;
  adminGetStats(): Promise<{ totalUsers: number; totalBots: number; totalGroups: number; totalLogs: number; totalScams: number }>;

  createAgentServiceLog(data: Omit<InsertAgentServiceLog, "id" | "createdAt">): Promise<AgentServiceLog>;
  getAgentServiceLogs(limit?: number): Promise<AgentServiceLog[]>;
  getAgentServiceLogByPaymentId(paymentId: string): Promise<AgentServiceLog | undefined>;
  getAgentServiceStats(): Promise<{ totalRequests: number; totalEarnings: string; requestsToday: number; verifiedRequests: number; unverifiedRequests: number }>;

  getUserMemoriesForUser(botConfigId: number, telegramUserId: string): Promise<UserMemory[]>;
  upsertUserMemory(botConfigId: number, telegramUserId: string, userName: string | null, type: string, content: string, confidence: number, qualityScore?: number, sourceActivityLogId?: number | null): Promise<UserMemory>;
  countUserMemories(botConfigId: number): Promise<number>;
  getRecentUserMemories(botConfigId: number, limit?: number): Promise<UserMemory[]>;

  getCollectivePatterns(botConfigId: number, status?: string): Promise<CollectivePattern[]>;
  upsertCollectivePattern(botConfigId: number, telegramUserId: string, kind: string, title: string, summary: string, keywords: string[], qualityScore?: number, sourceActivityLogId?: number | null): Promise<CollectivePattern>;
  updatePatternStatus(botConfigId: number, id: number, status: string, promotedKbId?: number | null): Promise<CollectivePattern | undefined>;
  deletePattern(botConfigId: number, id: number): Promise<void>;
  getPattern(botConfigId: number, id: number): Promise<CollectivePattern | undefined>;

  getWisdomSnapshots(botConfigId: number, limit?: number): Promise<WisdomSnapshot[]>;
  createWisdomSnapshot(botConfigId: number, score: number, components: any, digest?: string | null): Promise<WisdomSnapshot>;

  getActivityCountsByDay(botConfigId: number, days: number): Promise<{ day: string; count: number }[]>;
  countDistinctUsers(botConfigId: number, sinceDays: number): Promise<number>;
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

  async getBotByWidgetKey(widgetKey: string): Promise<BotConfig | undefined> {
    const [config] = await db.select().from(botConfigs).where(and(eq(botConfigs.widgetKey, widgetKey), eq(botConfigs.widgetEnabled, true))).limit(1);
    return config;
  }

  async getOrCreateWidgetConversation(botConfigId: number, sessionId: string, pageUrl?: string): Promise<WidgetConversation> {
    const [existing] = await db.select().from(widgetConversations).where(and(eq(widgetConversations.botConfigId, botConfigId), eq(widgetConversations.sessionId, sessionId))).limit(1);
    if (existing) {
      const [updated] = await db.update(widgetConversations).set({ updatedAt: new Date(), pageUrl: pageUrl || existing.pageUrl }).where(eq(widgetConversations.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(widgetConversations).values({ botConfigId, sessionId, pageUrl: pageUrl || null }).returning();
    return created;
  }

  async addWidgetMessage(conversationId: number, role: string, content: string): Promise<WidgetMessage> {
    const [created] = await db.insert(widgetMessages).values({ conversationId, role, content }).returning();
    return created;
  }

  async getWidgetMessages(conversationId: number, limit = 50): Promise<WidgetMessage[]> {
    return db.select().from(widgetMessages).where(eq(widgetMessages.conversationId, conversationId)).orderBy(widgetMessages.createdAt).limit(limit);
  }

  async getWidgetConversations(botConfigId: number, limit = 50): Promise<(WidgetConversation & { messageCount: number; lastMessage?: string })[]> {
    const convos = await db.select().from(widgetConversations).where(eq(widgetConversations.botConfigId, botConfigId)).orderBy(desc(widgetConversations.updatedAt)).limit(limit);
    const results = [];
    for (const c of convos) {
      const [msgCount] = await db.select({ count: count() }).from(widgetMessages).where(eq(widgetMessages.conversationId, c.id));
      const [lastMsg] = await db.select().from(widgetMessages).where(eq(widgetMessages.conversationId, c.id)).orderBy(desc(widgetMessages.createdAt)).limit(1);
      results.push({ ...c, messageCount: msgCount.count, lastMessage: lastMsg?.content });
    }
    return results;
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

  async createAgentServiceLog(data: Omit<InsertAgentServiceLog, "id" | "createdAt">): Promise<AgentServiceLog> {
    const [log] = await db.insert(agentServiceLogs).values(data).returning();
    return log;
  }

  async getAgentServiceLogs(limit = 100): Promise<AgentServiceLog[]> {
    return db.select().from(agentServiceLogs).orderBy(desc(agentServiceLogs.createdAt)).limit(limit);
  }

  async getAgentServiceLogByPaymentId(paymentId: string): Promise<AgentServiceLog | undefined> {
    const [log] = await db.select().from(agentServiceLogs).where(eq(agentServiceLogs.paymentId, paymentId)).limit(1);
    return log;
  }

  async getAgentServiceStats(): Promise<{ totalRequests: number; totalEarnings: string; requestsToday: number; verifiedRequests: number; unverifiedRequests: number }> {
    const [totalCount] = await db.select({ count: count() }).from(agentServiceLogs);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayCount] = await db.select({ count: count() }).from(agentServiceLogs).where(
      sql`${agentServiceLogs.createdAt} >= ${todayStart}`
    );
    const [earningsResult] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${agentServiceLogs.amountUsdc} AS DECIMAL)), 0)`,
    }).from(agentServiceLogs);
    const [verifiedCount] = await db.select({ count: count() }).from(agentServiceLogs).where(
      eq(agentServiceLogs.selfVerified, true)
    );
    return {
      totalRequests: totalCount.count,
      totalEarnings: String(earningsResult.total || "0"),
      requestsToday: todayCount.count,
      verifiedRequests: verifiedCount.count,
      unverifiedRequests: totalCount.count - verifiedCount.count,
    };
  }

  async getUserMemoriesForUser(botConfigId: number, telegramUserId: string): Promise<UserMemory[]> {
    return db.select().from(userMemories).where(and(eq(userMemories.botConfigId, botConfigId), eq(userMemories.telegramUserId, telegramUserId))).orderBy(desc(userMemories.lastSeenAt));
  }

  async getRecentUserMemories(botConfigId: number, limit = 50): Promise<UserMemory[]> {
    return db.select().from(userMemories).where(eq(userMemories.botConfigId, botConfigId)).orderBy(desc(userMemories.lastSeenAt)).limit(limit);
  }

  async countUserMemories(botConfigId: number): Promise<number> {
    const [r] = await db.select({ count: count() }).from(userMemories).where(eq(userMemories.botConfigId, botConfigId));
    return r.count;
  }

  async upsertUserMemory(botConfigId: number, telegramUserId: string, userName: string | null, type: string, content: string, confidence: number, qualityScore: number = 0, sourceActivityLogId: number | null = null): Promise<UserMemory> {
    const existing = await db.select().from(userMemories).where(and(eq(userMemories.botConfigId, botConfigId), eq(userMemories.telegramUserId, telegramUserId)));
    const norm = content.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    for (const e of existing) {
      const eNorm = e.content.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
      const overlap = norm.filter(w => eNorm.includes(w)).length;
      const ratio = overlap / Math.max(norm.length, eNorm.length, 1);
      if (ratio >= 0.6) {
        const [updated] = await db.update(userMemories).set({
          hitCount: e.hitCount + 1,
          lastSeenAt: new Date(),
          confidence: Math.min(95, Math.max(e.confidence, confidence)),
          userName: userName || e.userName,
        }).where(eq(userMemories.id, e.id)).returning();
        return updated;
      }
    }
    const [created] = await db.insert(userMemories).values({
      botConfigId, telegramUserId, userName, type, content, confidence, qualityScore, sourceActivityLogId,
    }).returning();
    return created;
  }

  async getCollectivePatterns(botConfigId: number, status?: string): Promise<CollectivePattern[]> {
    const filters = status
      ? and(eq(collectivePatterns.botConfigId, botConfigId), eq(collectivePatterns.status, status))
      : eq(collectivePatterns.botConfigId, botConfigId);
    return db.select().from(collectivePatterns).where(filters).orderBy(desc(collectivePatterns.mentionCount), desc(collectivePatterns.lastSeenAt));
  }

  async getPattern(botConfigId: number, id: number): Promise<CollectivePattern | undefined> {
    const [p] = await db.select().from(collectivePatterns).where(and(eq(collectivePatterns.id, id), eq(collectivePatterns.botConfigId, botConfigId))).limit(1);
    return p;
  }

  async upsertCollectivePattern(botConfigId: number, telegramUserId: string, kind: string, title: string, summary: string, keywords: string[], qualityScore: number = 0, sourceActivityLogId: number | null = null): Promise<CollectivePattern> {
    const existing = await db.select().from(collectivePatterns).where(and(eq(collectivePatterns.botConfigId, botConfigId), eq(collectivePatterns.kind, kind)));
    const newKw = new Set(keywords.map(k => k.toLowerCase()));
    let match: CollectivePattern | null = null;
    let bestRatio = 0;
    for (const e of existing) {
      const exKw = new Set(e.keywords.map(k => k.toLowerCase()));
      const overlap = [...newKw].filter(w => exKw.has(w)).length;
      const ratio = overlap / Math.max(newKw.size, exKw.size, 1);
      if (ratio > bestRatio) { bestRatio = ratio; match = e; }
    }
    if (match && bestRatio >= 0.6) {
      const mergedKw = Array.from(new Set([...match.keywords, ...keywords])).slice(0, 12);
      const [updated] = await db.update(collectivePatterns).set({
        mentionCount: match.mentionCount + 1,
        lastSeenAt: new Date(),
        keywords: mergedKw,
        qualityScore: Math.max(match.qualityScore, qualityScore),
        lastSourceActivityLogId: sourceActivityLogId ?? match.lastSourceActivityLogId,
      }).where(eq(collectivePatterns.id, match.id)).returning();
      await this.upsertCorrelation(botConfigId, updated.id, telegramUserId, sourceActivityLogId);
      const [uniq] = await db.select({ c: count() }).from(dataCorrelations).where(eq(dataCorrelations.patternId, updated.id));
      const [final] = await db.update(collectivePatterns).set({ uniqueUsers: uniq.c, confidence: Math.min(95, 50 + uniq.c * 5 + Math.min(20, updated.mentionCount)) }).where(eq(collectivePatterns.id, updated.id)).returning();
      return final;
    }
    const [created] = await db.insert(collectivePatterns).values({
      botConfigId, kind, title, summary, keywords: keywords.slice(0, 12),
      mentionCount: 1, uniqueUsers: 1, confidence: 55, status: "open",
      qualityScore, lastSourceActivityLogId: sourceActivityLogId,
    }).returning();
    await this.upsertCorrelation(botConfigId, created.id, telegramUserId, sourceActivityLogId);
    return created;
  }

  private async upsertCorrelation(botConfigId: number, patternId: number, telegramUserId: string, sourceActivityLogId: number | null = null): Promise<void> {
    const [existing] = await db.select().from(dataCorrelations).where(and(eq(dataCorrelations.patternId, patternId), eq(dataCorrelations.telegramUserId, telegramUserId))).limit(1);
    if (existing) {
      await db.update(dataCorrelations).set({ weight: existing.weight + 1, lastSeenAt: new Date(), sourceActivityLogId: sourceActivityLogId ?? existing.sourceActivityLogId }).where(eq(dataCorrelations.id, existing.id));
    } else {
      await db.insert(dataCorrelations).values({ botConfigId, patternId, telegramUserId, weight: 1, sourceActivityLogId });
    }
  }

  async updatePatternStatus(botConfigId: number, id: number, status: string, promotedKbId?: number | null): Promise<CollectivePattern | undefined> {
    const updates: Partial<typeof collectivePatterns.$inferInsert> = { status };
    if (promotedKbId !== undefined) updates.promotedKbId = promotedKbId;
    const [updated] = await db.update(collectivePatterns).set(updates).where(and(eq(collectivePatterns.id, id), eq(collectivePatterns.botConfigId, botConfigId))).returning();
    return updated;
  }

  async recordCalibrationLog(
    botConfigId: number,
    telegramUserId: string,
    data: {
      sourceActivityLogId: number | null;
      triageTier: string;
      contribution: number;
      domainRelevance: number;
      overall: number;
      gated: boolean;
      savedUserMemory: boolean;
      savedPattern: boolean;
    },
  ): Promise<void> {
    await db.insert(calibrationLogs).values({
      botConfigId,
      telegramUserId,
      sourceActivityLogId: data.sourceActivityLogId,
      triageTier: data.triageTier,
      contribution: data.contribution,
      domainRelevance: data.domainRelevance,
      overall: data.overall,
      gated: data.gated,
      savedUserMemory: data.savedUserMemory,
      savedPattern: data.savedPattern,
    });
  }

  async deletePattern(botConfigId: number, id: number): Promise<void> {
    await db.delete(collectivePatterns).where(and(eq(collectivePatterns.id, id), eq(collectivePatterns.botConfigId, botConfigId)));
  }

  async getWisdomSnapshots(botConfigId: number, limit = 30): Promise<WisdomSnapshot[]> {
    return db.select().from(wisdomSnapshots).where(eq(wisdomSnapshots.botConfigId, botConfigId)).orderBy(desc(wisdomSnapshots.createdAt)).limit(limit);
  }

  async createWisdomSnapshot(botConfigId: number, score: number, components: any, digest?: string | null): Promise<WisdomSnapshot> {
    const [created] = await db.insert(wisdomSnapshots).values({ botConfigId, score, components, digest: digest ?? null }).returning();
    return created;
  }

  async getActivityCountsByDay(botConfigId: number, days: number): Promise<{ day: string; count: number }[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db.execute(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM activity_logs
      WHERE bot_config_id = ${botConfigId} AND created_at >= ${cutoff}
      GROUP BY 1 ORDER BY 1 ASC
    `);
    return (rows.rows as any[]).map(r => ({ day: r.day, count: Number(r.count) }));
  }

  async countDistinctUsers(botConfigId: number, sinceDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await db.execute(sql`
      SELECT COUNT(DISTINCT telegram_user_id)::int AS c
      FROM activity_logs
      WHERE bot_config_id = ${botConfigId} AND created_at >= ${cutoff} AND telegram_user_id IS NOT NULL
    `);
    return Number((rows.rows[0] as any)?.c || 0);
  }
}

export const storage = new DatabaseStorage();
