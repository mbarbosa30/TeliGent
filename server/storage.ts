import { db } from "./db";
import { botConfigs, knowledgeBase, groups, activityLogs } from "@shared/schema";
import type { BotConfig, InsertBotConfig, KnowledgeBaseEntry, InsertKnowledgeBaseEntry, Group, InsertGroup, ActivityLog, InsertActivityLog } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getConfig(): Promise<BotConfig | undefined>;
  upsertConfig(data: Partial<InsertBotConfig>): Promise<BotConfig>;

  getKnowledgeEntries(): Promise<KnowledgeBaseEntry[]>;
  getActiveKnowledgeEntries(): Promise<KnowledgeBaseEntry[]>;
  createKnowledgeEntry(entry: InsertKnowledgeBaseEntry): Promise<KnowledgeBaseEntry>;
  updateKnowledgeEntry(id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined>;
  deleteKnowledgeEntry(id: number): Promise<void>;

  getGroups(): Promise<Group[]>;
  getGroupByChatId(chatId: string): Promise<Group | undefined>;
  upsertGroup(data: InsertGroup): Promise<Group>;
  updateGroup(id: number, data: Partial<InsertGroup>): Promise<Group | undefined>;

  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
}

export class DatabaseStorage implements IStorage {
  async getConfig(): Promise<BotConfig | undefined> {
    const [config] = await db.select().from(botConfigs).limit(1);
    return config;
  }

  async upsertConfig(data: Partial<InsertBotConfig>): Promise<BotConfig> {
    const existing = await this.getConfig();
    if (existing) {
      const [updated] = await db.update(botConfigs).set({ ...data, updatedAt: new Date() }).where(eq(botConfigs.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(botConfigs).values(data as InsertBotConfig).returning();
    return created;
  }

  async getKnowledgeEntries(): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.createdAt));
  }

  async getActiveKnowledgeEntries(): Promise<KnowledgeBaseEntry[]> {
    return db.select().from(knowledgeBase).where(eq(knowledgeBase.isActive, true)).orderBy(desc(knowledgeBase.createdAt));
  }

  async createKnowledgeEntry(entry: InsertKnowledgeBaseEntry): Promise<KnowledgeBaseEntry> {
    const [created] = await db.insert(knowledgeBase).values(entry).returning();
    return created;
  }

  async updateKnowledgeEntry(id: number, entry: Partial<InsertKnowledgeBaseEntry>): Promise<KnowledgeBaseEntry | undefined> {
    const [updated] = await db.update(knowledgeBase).set(entry).where(eq(knowledgeBase.id, id)).returning();
    return updated;
  }

  async deleteKnowledgeEntry(id: number): Promise<void> {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
  }

  async getGroups(): Promise<Group[]> {
    return db.select().from(groups).orderBy(desc(groups.joinedAt));
  }

  async getGroupByChatId(chatId: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.telegramChatId, chatId));
    return group;
  }

  async upsertGroup(data: InsertGroup): Promise<Group> {
    const existing = await this.getGroupByChatId(data.telegramChatId);
    if (existing) {
      const [updated] = await db.update(groups).set(data).where(eq(groups.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(groups).values(data).returning();
    return created;
  }

  async updateGroup(id: number, data: Partial<InsertGroup>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(data).where(eq(groups.id, id)).returning();
    return updated;
  }

  async getActivityLogs(limit = 100): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit);
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [created] = await db.insert(activityLogs).values(log).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
