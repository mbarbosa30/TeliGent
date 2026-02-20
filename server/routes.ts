import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startTelegramBot } from "./telegram";
import { seedDatabase } from "./seed";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Bot config
  app.get("/api/config", async (_req, res) => {
    try {
      let config = await storage.getConfig();
      if (!config) {
        config = await storage.upsertConfig({});
      }
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/config", async (req, res) => {
    try {
      const partial = insertBotConfigSchema.partial().parse(req.body);
      const config = await storage.upsertConfig(partial);
      res.json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Knowledge base
  app.get("/api/knowledge", async (_req, res) => {
    try {
      const entries = await storage.getKnowledgeEntries();
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/knowledge", async (req, res) => {
    try {
      const parsed = insertKnowledgeBaseSchema.parse(req.body);
      const entry = await storage.createKnowledgeEntry(parsed);
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertKnowledgeBaseSchema.partial().parse(req.body);
      const entry = await storage.updateKnowledgeEntry(id, partial);
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      res.json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteKnowledgeEntry(id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Groups
  app.get("/api/groups", async (_req, res) => {
    try {
      const allGroups = await storage.getGroups();
      res.json(allGroups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Activity logs
  app.get("/api/activity", async (_req, res) => {
    try {
      const logs = await storage.getActivityLogs(200);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Seed database and start telegram bot
  seedDatabase().catch((err) => {
    console.error("Failed to seed database:", err);
  });

  startTelegramBot().catch((err) => {
    console.error("Failed to start Telegram bot:", err);
  });

  return httpServer;
}
