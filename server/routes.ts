import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startTelegramBot } from "./telegram";
import { seedDatabase } from "./seed";

async function scrapeUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" ||
      hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.") ||
      hostname === "169.254.169.254" || hostname.endsWith(".internal") || hostname === "[::1]") {
    throw new Error("Internal/private URLs are not allowed");
  }
  const response = await fetch(url, {
    headers: { "User-Agent": "ContextBot/1.0" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("URL must return HTML or text content");
  }
  const html = await response.text();
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

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

      if (parsed.sourceUrl && parsed.sourceUrl.trim()) {
        try {
          const scrapedContent = await scrapeUrl(parsed.sourceUrl);
          if (scrapedContent) {
            const existingContent = parsed.content?.trim() || "";
            parsed.content = existingContent
              ? `${existingContent}\n\n--- Content from ${parsed.sourceUrl} ---\n${scrapedContent}`
              : scrapedContent;
          }
        } catch (scrapeErr: any) {
          console.log(`[scrape] Could not auto-scrape URL: ${scrapeErr.message}`);
        }
      }

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

  app.post("/api/scrape-website", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const textContent = await scrapeUrl(url);
      await storage.upsertConfig({ websiteUrl: url, websiteContent: textContent });

      res.json({ content: textContent, length: textContent.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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

  startTelegramBot(app).catch((err) => {
    console.error("Failed to start Telegram bot:", err);
  });

  return httpServer;
}
