import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startBotEngine, getWebhookStatus } from "./telegram";
import { isAuthenticated, isAdminAuthenticated } from "./auth";
import { convert } from "html-to-text";
import { sql } from "drizzle-orm";

const serverStartTime = Date.now();

const MAX_BOTS_PER_USER = parseInt(process.env.MAX_BOTS_PER_USER || "10", 10);

function getUserId(req: any): string {
  return req.session?.userId;
}

function createApiRateLimiter(windowMs: number, maxRequests: number) {
  const store = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key);
    }
  }, 60 * 1000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.session?.userId || req.ip || "unknown";
    const now = Date.now();
    const entry = store.get(key);
    if (entry && now < entry.resetAt) {
      if (entry.count >= maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({ error: "Too many requests. Please slow down." });
      }
      entry.count++;
    } else {
      store.set(key, { count: 1, resetAt: now + windowMs });
    }
    next();
  };
}

const apiRateLimit = createApiRateLimiter(60 * 1000, 60);
const scrapeRateLimit = createApiRateLimiter(60 * 1000, 5);
const publicRateLimit = createApiRateLimiter(60 * 1000, 30);

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
  const isPrivateIp = (h: string): boolean => {
    if (h === "localhost" || h === "0.0.0.0" || h === "[::1]") return true;
    if (h.endsWith(".internal") || h.endsWith(".local")) return true;
    const parts = h.split(".").map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    return false;
  };
  if (isPrivateIp(hostname)) {
    throw new Error("Internal/private URLs are not allowed");
  }
  const dns = await import("dns");
  const resolved = await dns.promises.resolve4(hostname).catch(() => [] as string[]);
  const resolved6 = await dns.promises.resolve6(hostname).catch(() => [] as string[]);
  for (const ip of [...resolved, ...resolved6]) {
    if (isPrivateIp(ip)) {
      throw new Error("Internal/private URLs are not allowed");
    }
  }
  let finalUrl = url;
  let response: globalThis.Response;
  let redirectCount = 0;
  const maxRedirects = 5;
  while (true) {
    response = await fetch(finalUrl, {
      headers: { "User-Agent": "TeliGent/1.0" },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (++redirectCount > maxRedirects) throw new Error("Too many redirects");
      const redirectUrl = new URL(response.headers.get("location")!, finalUrl);
      const rHost = redirectUrl.hostname.toLowerCase();
      if (isPrivateIp(rHost)) throw new Error("Redirect to internal/private URL is not allowed");
      const rResolved = await dns.promises.resolve4(rHost).catch(() => [] as string[]);
      const rResolved6 = await dns.promises.resolve6(rHost).catch(() => [] as string[]);
      for (const ip of [...rResolved, ...rResolved6]) {
        if (isPrivateIp(ip)) throw new Error("Redirect to internal/private URL is not allowed");
      }
      finalUrl = redirectUrl.toString();
      continue;
    }
    break;
  }
  if (!response!.ok) {
    throw new Error(`Failed to fetch website: ${response!.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("URL must return HTML or text content");
  }
  const html = await response.text();
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
      { selector: "header", format: "skip" },
      { selector: "aside", format: "skip" },
      { selector: "iframe", format: "skip" },
    ],
    limits: { maxInputLength: 500000 },
  });
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/^ +| +$/gm, "")
    .trim()
    .slice(0, 10000);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", publicRateLimit, async (_req, res) => {
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    let dbStatus = "ok";
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = "unreachable";
    }
    res.json({
      status: dbStatus === "ok" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: uptimeSeconds,
      database: dbStatus,
    });
  });

  app.get("/api/bots", isAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const userId = getUserId(req);
      const bots = await storage.getBotConfigs(userId);
      res.json(bots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots", isAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const userId = getUserId(req);
      const existing = await storage.getBotConfigs(userId);
      if (existing.length >= MAX_BOTS_PER_USER) {
        return res.status(403).json({ error: `You have reached the maximum of ${MAX_BOTS_PER_USER} bots. Please delete an existing bot to create a new one.` });
      }
      const { botName } = req.body;
      const config = await storage.createBotConfig(userId, { botName: botName || "My Bot" });
      res.status(201).json(config);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
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

  app.get("/api/bots/:botId/config", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      res.json((req as any).botConfig);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/webhook-status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const status = await getWebhookStatus(botId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/bots/:botId/config", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
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

  app.get("/api/bots/:botId/knowledge", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const entries = await storage.getKnowledgeEntries(botId);
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/knowledge", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
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

  app.patch("/api/bots/:botId/knowledge/:id", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
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

  app.delete("/api/bots/:botId/knowledge/:id", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      await storage.deleteKnowledgeEntry(botId, id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/scrape-website", isAuthenticated, requireBotOwnership, scrapeRateLimit, async (req, res) => {
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

  app.get("/api/bots/:botId/groups", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const allGroups = await storage.getGroups(botId);
      res.json(allGroups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/activity", isAuthenticated, requireBotOwnership, apiRateLimit, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const logs = await storage.getActivityLogs(botId, limit, offset);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/reports", isAuthenticated, requireBotOwnership, apiRateLimit, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const reports = await storage.getReportLogs(botId, limit, offset);
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/stats", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const stats = await storage.adminGetStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const allUsers = await storage.adminGetAllUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/bots", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const allBots = await storage.adminGetAllBots();
      res.json(allBots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/activity", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const logs = await storage.adminGetAllActivityLogs(500);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  let cachedPublicStats: any = null;
  let cachedPublicStatsAt = 0;
  const STATS_CACHE_MS = 5 * 60 * 1000;

  app.get("/api/public/stats", publicRateLimit, async (_req, res) => {
    try {
      const now = Date.now();
      if (cachedPublicStats && now - cachedPublicStatsAt < STATS_CACHE_MS) {
        return res.json(cachedPublicStats);
      }
      const stats = await storage.getPublicStats();
      cachedPublicStats = stats;
      cachedPublicStatsAt = now;
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  await startBotEngine(app);

  return httpServer;
}
