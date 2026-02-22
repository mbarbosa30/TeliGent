import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startBotEngine } from "./telegram";
import { isAuthenticated } from "./auth";

function getUserId(req: any): string {
  return req.session?.userId;
}

async function requireBotOwnership(req: Request, res: Response, next: NextFunction) {
  const userId = getUserId(req);
  const botId = parseInt(req.params.botId as string);
  if (isNaN(botId)) {
    return res.status(400).json({ error: "Invalid bot ID" });
  }
  const config = await storage.getBotConfig(botId);
  if (!config || config.userId !== userId) {
    return res.status(404).json({ error: "Bot not found" });
  }
  (req as any).botConfig = config;
  next();
}

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

  app.get("/api/bots", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const bots = await storage.getBotConfigs(userId);
      res.json(bots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { botName } = req.body;
      const config = await storage.createBotConfig(userId, { botName: botName || "My Bot" });
      res.status(201).json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      await storage.deleteBotConfig(botId);
      startBotEngine(app).catch(err => {
        console.error("Failed to restart bot engine:", err);
      });
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/config", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      res.json((req as any).botConfig);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/bots/:botId/config", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const partial = insertBotConfigSchema.partial().parse(req.body);
      const config = await storage.updateBotConfig(botId, partial);

      if (partial.botToken !== undefined || partial.isActive !== undefined) {
        startBotEngine(app).catch(err => {
          console.error("Failed to restart bot engine:", err);
        });
      }

      res.json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/knowledge", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const entries = await storage.getKnowledgeEntries(botId);
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/knowledge", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const userId = getUserId(req);
      const parsed = insertKnowledgeBaseSchema.omit({ userId: true, botConfigId: true }).parse(req.body);

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

      const entry = await storage.createKnowledgeEntry(botId, userId, parsed);
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/bots/:botId/knowledge/:id", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      const partial = insertKnowledgeBaseSchema.partial().parse(req.body);
      const entry = await storage.updateKnowledgeEntry(botId, id, partial);
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      res.json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId/knowledge/:id", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      await storage.deleteKnowledgeEntry(botId, id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/scrape-website", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const textContent = await scrapeUrl(url);
      await storage.updateBotConfig(botId, { websiteUrl: url, websiteContent: textContent });

      res.json({ content: textContent, length: textContent.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/groups", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const allGroups = await storage.getGroups(botId);
      res.json(allGroups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/activity", isAuthenticated, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const logs = await storage.getActivityLogs(botId, 200);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  await startBotEngine(app);

  return httpServer;
}
