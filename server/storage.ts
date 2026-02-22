import { db } from "./db";
import { botConfigs, knowledgeBase, groups, activityLogs } from "@shared/schema";
import type { BotConfig, InsertBotConfig, KnowledgeBaseEntry, InsertKnowledgeBaseEntry, Group, InsertGroup, ActivityLog, InsertActivityLog } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getConfig(userId: string): Promise<BotConfig | undefined>;
  upsertConfig(userId: string, data: Partial<InsertBotConfig>): Promise<BotConfig>;
  getAllActiveConfigs(): Promise<BotConfig[]>;

  getKnowledgeEntries(userId: string): Promise<KnowledgeBaseEntry[]>;
  getActiveKnowledgeEntries(userId: string): Promise<KnowledgeBaseEntry[]>;
  createKnowledgeEntry(userId: string, entry: Omit<InsertKnowledgeBaseEntry, "userId">): Promise<KnowledgeBaseEntry>;
  updateKnowledgeEntry(userId: string, id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined>;
  deleteKnowledgeEntry(userId: string, id: number): Promise<void>;

  getGroups(userId: string): Promise<Group[]>;
  getGroupByChatId(userId: string, chatId: string): Promise<Group | undefined>;
  upsertGroup(userId: string, data: Omit<InsertGroup, "userId">): Promise<Group>;
  updateGroup(userId: string, id: number, data: Partial<InsertGroup>): Promise<Group | undefined>;

  getActivityLogs(userId: string, limit?: number): Promise<ActivityLog[]>;
  createActivityLog(userId: string, log: Omit<InsertActivityLog, "userId">): Promise<ActivityLog>;
}

export class DatabaseStorage implements IStorage {
  async getConfig(userId: string): Promise<BotConfig | undefined> {
    const [config] = await db.select().from(botConfigs).where(eq(botConfigs.userId, userId)).limit(1);
    return config;
  }

  async upsertConfig(userId: string, data: Partial<InsertBotConfig>): Promise<BotConfig> {
    const existing = await this.getConfig(userId);
    if (existing) {
      const [updated] = await db.update(botConfigs).set({ ...data, updatedAt: new Date() }).where(eq(botConfigs.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(botConfigs).values({ ...data, userId } as InsertBotConfig).returning();
    return created;
  }

  async getAllActiveConfigs(): Promise<BotConfig[]> {
    return db.select().from(botConfigs).where(eq(botConfigs.isActive, true));
  }

  async getKnowledgeEntries(userId: string): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).where(eq(knowledgeBase.userId, userId)).orderBy(desc(knowledgeBase.createdAt));
  }

  async getActiveKnowledgeEntries(userId: string): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).where(and(eq(knowledgeBase.userId, userId), eq(knowledgeBase.isActive, true))).orderBy(desc(knowledgeBase.createdAt));
  }

  async createKnowledgeEntry(userId: string, entry: Omit<InsertKnowledgeBaseEntry, "userId">): Promise<KnowledgeBaseEntry> {
    const [created] = await db.insert(knowledgeBase).values({ ...entry, userId }).returning();
    return created;
  }

  async updateKnowledgeEntry(userId: string, id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined> {
    const [updated] = await db.update(knowledgeBase).set(entry).where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.userId, userId))).returning();
    return updated;
  }

  async deleteKnowledgeEntry(userId: string, id: number): Promise<void> {
    await db.delete(knowledgeBase).where(and(eq(knowledgeBase.id, id), eq(knowledgeBase.userId, userId)));
  }

  async getGroups(userId: string): Promise<Group[]> {
    return db.select().from(groups).where(eq(groups.userId, userId)).orderBy(desc(groups.joinedAt));
  }

  async getGroupByChatId(userId: string, chatId: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(and(eq(groups.userId, userId), eq(groups.telegramChatId, chatId)));
    return group;
  }

  async upsertGroup(userId: string, data: Omit<InsertGroup, "userId">): Promise<Group> {
    const existing = await this.getGroupByChatId(userId, data.telegramChatId);
    if (existing) {
      const [updated] = await db.update(groups).set(data).where(eq(groups.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(groups).values({ ...data, userId }).returning();
    return created;
  }

  async updateGroup(userId: string, id: number, data: Partial<InsertGroup>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(data).where(and(eq(groups.id, id), eq(groups.userId, userId))).returning();
    return updated;
  }

  async getActivityLogs(userId: string, limit = 100): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).where(eq(activityLogs.userId, userId)).orderBy(desc(activityLogs.createdAt)).limit(limit);
  }

  async createActivityLog(userId: string, log: Omit<InsertActivityLog, "userId">): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values({ ...log, userId }).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
