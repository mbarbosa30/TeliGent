import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { createHash } from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startBotEngine, getWebhookStatus } from "./telegram";
import { generateAIResponse } from "./telegram/commands";
import { isAuthenticated, isAdminAuthenticated, requireVerifiedEmail } from "./auth";
import { sql } from "drizzle-orm";
import { scrapeUrl } from "./scraper";
import crypto from "crypto";

const serverStartTime = Date.now();

import { getLimitsForUser, getLimitsForBot, getDefaultLimits, TIER_LIMITS, TIER_PRICING, TELI_DISCOUNT_PCT, TELI_REWARDS_BOOST_PCT, getEffectivePlan, isPlanActive, type PlanTier } from "./limits";
import { PaywallError, requirePermission, requireQuota, paywallErrorMiddleware } from "./billing/gates";
import * as Stripe from "./billing/stripe";
import * as CryptoBilling from "./billing/crypto";

function getUserId(req: any): string {
  return req.session?.userId;
}

// Express 5 types route params as `string | string[]`. We require a single
// string and reject any other shape with a 400 — array params are usually a
// sign of a malformed URL and should never be silently coerced into a storage
// lookup. The route catch handlers honor `err.status` to surface this.
class BadParamError extends Error {
  status = 400;
  constructor(name: string) {
    super(`Invalid URL parameter: ${name}`);
  }
}

function asString(p: unknown, name = "param"): string {
  if (typeof p === "string" && p.length > 0) return p;
  throw new BadParamError(name);
}

async function loadUser(req: Request) {
  const userId = getUserId(req);
  if (!userId) return null;
  return storage.getUserById(userId);
}

function createApiRateLimiter(windowMs: number, maxRequests: number, opts?: { keyFn?: (req: Request) => string; maxFn?: (req: Request) => number }) {
  const store = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key);
    }
  }, 60 * 1000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts?.keyFn ? opts.keyFn(req) : (req.session?.userId || req.ip || "unknown");
    const limit = opts?.maxFn ? opts.maxFn(req) : maxRequests;
    const now = Date.now();
    const entry = store.get(key);
    if (entry && now < entry.resetAt) {
      if (entry.count >= limit) {
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

const _defaultLimits = getDefaultLimits();
const apiRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.apiRateLimitPerMin);
const scrapeRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.scrapeRateLimitPerMin);
const publicRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.publicApiRateLimitPerMin);

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
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots", isAuthenticated, apiRateLimit, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const user = await loadUser(req);
      const existing = await storage.getBotConfigs(userId);
      requireQuota(user, "maxBots", existing.length);
      const { botName } = req.body;
      const config = await storage.createBotConfig(userId, { botName: botName || "My Bot" });
      res.status(201).json(config);
    } catch (err: any) {
      if (err instanceof PaywallError) return next(err);
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
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/config", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const config = { ...(req as any).botConfig };
      const rawKey = config.bankrApiKey || "";
      config.bankrApiKey = rawKey ? `${rawKey.slice(0, 6)}${"*".repeat(Math.max(0, rawKey.length - 6))}` : "";
      config.hasBankrApiKey = !!rawKey;
      res.json(config);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/webhook-status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const status = await getWebhookStatus(botId);
      res.json(status);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.patch("/api/bots/:botId/config", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res, next) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const partial = insertBotConfigSchema.partial().parse(req.body);
      if (partial.scamSensitivity !== undefined && !["low", "medium", "high"].includes(partial.scamSensitivity)) {
        return res.status(400).json({ error: "scamSensitivity must be one of low, medium, high" });
      }
      if (typeof partial.publicAlias === "string") {
        partial.publicAlias = partial.publicAlias.trim().slice(0, 40);
      }
      const user = await loadUser(req);
      if (partial.widgetEnabled === true) requirePermission(user, "allowWidget");
      if (partial.bankrEnabled === true) requirePermission(user, "allowBankr");
      if (partial.feedbackEnabled === true) requirePermission(user, "allowFeedbackDigest");
      const config = await storage.updateBotConfig(botId, partial);

      if (partial.botToken !== undefined || partial.isActive !== undefined) {
        startBotEngine(app).catch(err => {
          console.error("Failed to restart bot engine:", err);
        });
      }

      res.json(config);
    } catch (err: any) {
      if (err instanceof PaywallError) return next(err);
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/knowledge", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const entries = await storage.getKnowledgeEntries(botId);
      res.json(entries);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/knowledge", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res, next) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const userId = getUserId(req);
      const parsed = insertKnowledgeBaseSchema.omit({ userId: true, botConfigId: true }).parse(req.body);

      const owner = await loadUser(req);
      const existingKb = await storage.getKnowledgeEntries(botId);
      requireQuota(owner, "maxKbEntries", existingKb.length);

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
      if (err instanceof PaywallError) return next(err);
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
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/memories", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const memories = await storage.getBotMemories(botId);
      res.json(memories);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/memories", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { type, content } = req.body;
      if (!content || typeof content !== "string" || content.trim().length < 5) {
        return res.status(400).json({ error: "Content must be at least 5 characters" });
      }
      const validTypes = ["correction", "preference", "topic", "context", "insight"];
      const memType = validTypes.includes(type) ? type : "insight";
      const memory = await storage.createBotMemory(botId, {
        type: memType,
        content: content.trim().slice(0, 300),
        source: "manual",
        confidence: 90,
      });
      res.json(memory);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId/memories/:id", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      await storage.deleteBotMemory(botId, id);
      res.status(204).send();
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
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
      res.status(err?.status || 500).json({ error: err.message });
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
      res.status(err?.status || 500).json({ error: err.message });
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
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/scam-flagged", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const items = await storage.getRecentlyFlaggedScams(botId, limit);
      res.json(items);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/scam-flagged/:logId/false-positive", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const logId = parseInt(req.params.logId as string);
      if (isNaN(logId)) return res.status(400).json({ error: "Invalid log id" });

      const log = await storage.getActivityLogById(botId, logId);
      if (!log) return res.status(404).json({ error: "Flagged item not found" });

      const meta = (log.metadata || {}) as Record<string, unknown>;
      const isAutoDeletedScam =
        log.isReport === true &&
        log.botResponse === "(silently deleted)" &&
        meta.autoDetected === true;
      if (!isAutoDeletedScam) {
        return res.status(400).json({ error: "This activity log is not an auto-deleted scam message" });
      }
      if (meta.falsePositive === true || meta.falsePositive === "true") {
        return res.status(409).json({ error: "Already marked as a false positive" });
      }

      const text = (log.userMessage || "").trim();
      if (!text) return res.status(400).json({ error: "Original message text is not available" });

      const { normalizeUnicode } = await import("./telegram/normalization");
      const { extractKeyPhrases, clearLearnedPatternsCache, clearScamAllowlistCache } = await import("./telegram/scam-detection");

      const normalized = normalizeUnicode(text);
      const bigrams = extractKeyPhrases(normalized);

      const removedPatterns = await storage.deleteReportedScamPatterns(botId, bigrams);
      await storage.createScamAllowlistEntry(botId, text, normalized, bigrams, log.id);
      await storage.markActivityLogFalsePositive(botId, log.id);

      clearLearnedPatternsCache(botId);
      clearScamAllowlistCache(botId);

      let unbanned = false;
      let unbanError: string | null = null;
      if (log.telegramUserId && log.groupId) {
        try {
          const group = await storage.getGroupById(botId, log.groupId);
          const { getActiveBotInstance } = await import("./telegram/instance-registry");
          const instance = getActiveBotInstance(botId);
          if (group && instance) {
            await instance.bot.unbanChatMember(group.telegramChatId, Number(log.telegramUserId), { only_if_banned: true });
            unbanned = true;
          }
        } catch (e: any) {
          unbanError = e?.message || String(e);
        }
      }

      res.json({
        success: true,
        removedPatterns,
        bigramsConsidered: bigrams.length,
        unbanAttempted: !!(log.telegramUserId && log.groupId),
        unbanned,
        unbanError,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/intelligence/overview", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { generateWeeklyDigest } = await import("./telegram/digest");
      const data = await generateWeeklyDigest(botId);
      res.json(data);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/intelligence/patterns", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const patterns = await storage.getCollectivePatterns(botId, status);
      res.json(patterns);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.patch("/api/bots/:botId/intelligence/patterns/:id/status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      const status = String(req.body.status || "open");
      if (!["open", "known", "resolved", "ignored"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const updated = await storage.updatePatternStatus(botId, id, status);
      if (!updated) return res.status(404).json({ error: "Pattern not found" });
      const { invalidateDigestCache } = await import("./telegram/digest");
      invalidateDigestCache(botId);
      res.json(updated);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId/intelligence/patterns/:id", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      await storage.deletePattern(botId, id);
      const { invalidateDigestCache } = await import("./telegram/digest");
      invalidateDigestCache(botId);
      res.status(204).send();
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/intelligence/patterns/:id/promote", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      const userId = getUserId(req);
      const pattern = await storage.getPattern(botId, id);
      if (!pattern) return res.status(404).json({ error: "Pattern not found" });
      const entry = await storage.createKnowledgeEntry(botId, userId, {
        title: pattern.title.slice(0, 100),
        content: pattern.summary,
        category: pattern.kind === "question" ? "faq" : "general",
        isActive: true,
        sourceUrl: null,
      });
      await storage.updatePatternStatus(botId, id, "known", entry.id);
      const { invalidateDigestCache } = await import("./telegram/digest");
      invalidateDigestCache(botId);
      res.json({ entry, pattern });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/intelligence/user-memories", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const memories = await storage.getRecentUserMemories(botId, limit);
      res.json(memories);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/admin/stats", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const stats = await storage.adminGetStats();
      res.json(stats);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const allUsers = await storage.adminGetAllUsers();
      const summaries = await storage.adminGetPlanPaymentSummaries().catch(() => new Map());
      const enriched = allUsers.map((u) => {
        const s = summaries.get(u.id) || { paid: 0, pending: 0, lastPaymentAt: null };
        return { ...u, paidIntents: s.paid, pendingIntents: s.pending, lastPaymentAt: s.lastPaymentAt };
      });
      res.json(enriched);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/admin/bots", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const allBots = await storage.adminGetAllBots();
      res.json(allBots);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/admin/activity", isAdminAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const logs = await storage.adminGetAllActivityLogs(500);
      res.json(logs);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  const widgetRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.widgetApiRateLimitPerMin);

  app.post("/api/bots/:botId/widget/enable", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res, next) => {
    try {
      const owner = await loadUser(req);
      requirePermission(owner, "allowWidget");
      const botId = parseInt(req.params.botId as string);
      const widgetKey = crypto.randomBytes(24).toString("hex");
      await storage.updateBotConfig(botId, { widgetEnabled: true, widgetKey });
      res.json({ widgetKey });
    } catch (err: any) {
      if (err instanceof PaywallError) return next(err);
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/widget/disable", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      await storage.updateBotConfig(botId, { widgetEnabled: false });
      res.json({ success: true });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/widget/conversations", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const conversations = await storage.getWidgetConversations(botId);
      res.json(conversations);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  async function widgetCors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    const widgetKey = (req.params as any)?.widgetKey;
    if (widgetKey) {
      try {
        const cfg = await storage.getBotByWidgetKey(widgetKey);
        const allowed = (cfg?.widgetAllowedOrigins || []).map(s => s.trim()).filter(Boolean);
        if (allowed.length > 0) {
          if (!origin || !allowed.includes(origin)) {
            return res.status(403).json({ error: "Origin not allowed for this widget." });
          }
        }
      } catch (err) {
        // Fail-closed: if we cannot verify the configured allowlist, refuse the request
        // rather than silently allowing every origin through.
        return res.status(503).json({ error: "Widget access check temporarily unavailable." });
      }
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  }

  app.options("/api/widget/:widgetKey/config", widgetCors);
  app.options("/api/widget/:widgetKey/message", widgetCors);

  app.get("/api/widget/:widgetKey/config", widgetCors, widgetRateLimit, async (req, res) => {
    try {
      const config = await storage.getBotByWidgetKey(asString(req.params.widgetKey));
      if (!config) return res.status(404).json({ error: "Widget not found" });
      res.json({
        botName: config.botName || "Assistant",
        greeting: `Hi! I'm ${config.botName || "the assistant"}. How can I help you?`,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/widget/:widgetKey/message", widgetCors, widgetRateLimit, async (req, res) => {
    try {
      const config = await storage.getBotByWidgetKey(asString(req.params.widgetKey));
      if (!config) return res.status(404).json({ error: "Widget not found" });

      const { message, sessionId, pageUrl } = req.body;
      if (!message || typeof message !== "string" || !sessionId || typeof sessionId !== "string") {
        return res.status(400).json({ error: "message and sessionId are required" });
      }
      if (message.length > 2000) {
        return res.status(400).json({ error: "Message too long" });
      }
      if (sessionId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
        return res.status(400).json({ error: "Invalid sessionId format" });
      }

      const conversation = await storage.getOrCreateWidgetConversation(config.id, sessionId, pageUrl);
      await storage.addWidgetMessage(conversation.id, "user", message);

      const history = await storage.getWidgetMessages(conversation.id, 20);
      const conversationHistory = history.map(m => ({
        role: m.role as "user" | "assistant",
        name: m.role === "user" ? "Website Visitor" : (config.botName || "Assistant"),
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
      }));

      const aiResponse = await generateAIResponse(
        config.id,
        message,
        "Website Visitor",
        config,
        "Website Chat",
        config.botName || "Assistant",
        null,
        false,
        conversationHistory,
        null,
      );

      await storage.addWidgetMessage(conversation.id, "assistant", aiResponse);

      res.json({ response: aiResponse, conversationId: conversation.id });
    } catch (err: any) {
      console.error("Widget message error:", err);
      res.status(500).json({ error: "Failed to generate response" });
    }
  });

  let cachedPublicStats: any = null;
  let cachedPublicStatsAt = 0;
  const STATS_CACHE_MS = 5 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // PRIVACY GUARANTEE for /api/public/recent-events
  // ---------------------------------------------------------------------------
  // This endpoint streams recent activity from bots that have explicitly opted
  // in (`bot_configs.share_anonymized_events = true`, default false). The
  // redaction rules below are enforced on the server before any data leaves:
  //   - Raw user message text and bot response text are NEVER selected from
  //     the database (see storage.getRecentSharedActivity).
  //   - Telegram user identifiers are reduced to a stable, salted hash and
  //     surfaced only as `@x***N` (one letter + two digits) so you cannot
  //     correlate two events back to the same person across bots.
  //   - Bot identity is not exposed; the source community is always shown as
  //     "a community".
  //   - The category label is one of four hard-coded strings; no user-
  //     controlled text reaches the client.
  //   - Output is capped at 12 events from the last 24 hours and cached in
  //     memory for 30 seconds to limit query pressure and reduce timing-based
  //     correlation risk.
  // ---------------------------------------------------------------------------
  type PublicEventKind = "scam_removed" | "ai_answer" | "reward" | "new_member";
  type PublicEvent = { kind: PublicEventKind; at: string; label: string };
  const RECENT_EVENTS_CACHE_MS = 30 * 1000;
  const RECENT_EVENTS_LIMIT = 12;
  let cachedRecentEvents: PublicEvent[] | null = null;
  let cachedRecentEventsAt = 0;

  // Salted, stable hash so the same telegram user looks the same across the
  // 24h window but cannot be reversed. Salt rotates with SESSION_SECRET so it
  // also rotates if/when the operator rotates that secret.
  const HANDLE_SALT = process.env.SESSION_SECRET || "teligent-public-events";
  function redactHandle(rawId: string | null, rawHandle: string | null): string {
    const seed = (rawId || rawHandle || "anon").toString();
    const h = createHash("sha256").update(HANDLE_SALT).update(seed).digest("hex");
    const letter = h[0];
    const digits = (parseInt(h.slice(1, 5), 16) % 100).toString().padStart(2, "0");
    return `@${letter}***${digits}`;
  }
  function activityKindFor(type: string): PublicEventKind | null {
    if (type === "report") return "scam_removed";
    if (type === "response") return "ai_answer";
    if (type === "join") return "new_member";
    return null;
  }
  function communityLabel(alias: string): string {
    const a = (alias || "").trim();
    return a.length > 0 ? a : "a community";
  }
  function labelFor(kind: PublicEventKind, handle: string, community: string): string {
    switch (kind) {
      case "scam_removed": return `removed scam DM from ${handle} in ${community}`;
      case "ai_answer":    return `answered a question from ${handle} in ${community}`;
      case "new_member":   return `welcomed ${handle} to ${community}`;
      case "reward":       return `sent contribution rewards to ${handle} in ${community}`;
    }
  }

  // The public events endpoint is intentionally cross-origin friendly so the
  // landing page (and any embedded version of the hero card) can read it
  // without a per-bot widget allowlist. Permissive CORS is safe here because
  // the response is fully redacted and rate-limited. Privacy contract:
  //   - Only category labels leave the server (no userMessage/botResponse).
  //   - Telegram handles are reduced to a salted SHA-256 of the form
  //     `@x***NN`. The salt is global and stable, so the SAME underlying
  //     user produces the SAME pseudonym across events and across bots —
  //     coarse correlation is possible by design (it keeps the feed
  //     coherent). Follow-up #58 will rotate the salt daily.
  //   - Bot identity is hidden behind the bot's optional public alias
  //     (capped at 40 chars, trimmed) or "a community" when no alias is
  //     set. The bot's real name and ID are never exposed.
  function publicEventsCors(_req: Request, res: Response, next: NextFunction) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    next();
  }
  app.options("/api/public/recent-events", publicEventsCors, (_req, res) => res.sendStatus(204));

  app.get("/api/public/recent-events", publicEventsCors, publicRateLimit, async (_req, res) => {
    try {
      const now = Date.now();
      if (cachedRecentEvents && now - cachedRecentEventsAt < RECENT_EVENTS_CACHE_MS) {
        return res.json({ events: cachedRecentEvents, available: cachedRecentEvents.length > 0 });
      }
      const [acts, rewards] = await Promise.all([
        storage.getRecentSharedActivity(RECENT_EVENTS_LIMIT * 2),
        storage.getRecentSharedRewards(RECENT_EVENTS_LIMIT),
      ]);
      const events: PublicEvent[] = [];
      for (const a of acts) {
        const kind = activityKindFor(a.type);
        if (!kind) continue;
        const handle = redactHandle(a.telegramUserId, a.userName);
        events.push({ kind, at: a.createdAt.toISOString(), label: labelFor(kind, handle, communityLabel(a.publicAlias)) });
      }
      for (const r of rewards) {
        const handle = redactHandle(r.recipientTelegramId, r.recipientHandle);
        events.push({ kind: "reward", at: r.createdAt.toISOString(), label: labelFor("reward", handle, communityLabel(r.publicAlias)) });
      }
      events.sort((a, b) => (a.at < b.at ? 1 : -1));
      const trimmed = events.slice(0, RECENT_EVENTS_LIMIT);
      cachedRecentEvents = trimmed;
      cachedRecentEventsAt = now;
      res.json({ events: trimmed, available: trimmed.length > 0 });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

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
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  // Agent API rate limit is keyed per caller (Self-verified agent address > callerIdentifier > IP)
  // so one noisy caller can't exhaust a global bucket. The per-minute cap also stacks for
  // trusted callers: Self verified -> 2x, plus another 2x if the targeted bot's owner has
  // teliPaid=true. This delivers the "$TELI -> 2x agent rate limit" perk in a way that's
  // resilient to callers that don't authenticate as a TeliGent user.
  const agentLimitMaxFn = (req: Request): number => {
    const isVerified = !!(req as any).selfVerified;
    // Prefer the targeted bot owner's tier-derived caps so Pro/Business owners
    // get their promised agent throughput. Fall back to Free defaults for
    // unauthenticated/unknown requests.
    const ownerLimits = (req as any).agentOwnerLimits as { agentApiRateLimitPerMin: number; agentApiTrustedRateLimitPerMin: number } | undefined;
    const baseUntrusted = ownerLimits?.agentApiRateLimitPerMin ?? _defaultLimits.agentApiRateLimitPerMin;
    const baseTrusted = ownerLimits?.agentApiTrustedRateLimitPerMin ?? _defaultLimits.agentApiTrustedRateLimitPerMin;
    // Note: getLimitsForUser already applies the TELI 2x multiplier on agent
    // caps when teliPaid is active, so we must NOT double-apply it here.
    const cap = isVerified ? baseTrusted : baseUntrusted;
    return cap;
  };
  const agentLimitKeyFn = (req: Request): string => {
    const verifiedAddr = (req as any).selfAgentAddress as string | null;
    if (verifiedAddr) return `agent:self:${verifiedAddr.toLowerCase()}`;
    const caller = typeof req.body?.callerIdentifier === "string" ? req.body.callerIdentifier.slice(0, 64) : "";
    return caller ? `agent:caller:${caller}` : `agent:ip:${req.ip || "unknown"}`;
  };
  const agentRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.agentApiRateLimitPerMin, { keyFn: agentLimitKeyFn, maxFn: agentLimitMaxFn });
  const agentTrustRateLimit = createApiRateLimiter(60 * 1000, _defaultLimits.agentApiTrustedRateLimitPerMin, { keyFn: agentLimitKeyFn, maxFn: agentLimitMaxFn });

  // Resolve owner-tier-aware perks before the rate limiter runs. If the request body carries a
  // botId we can recognise, we'll mark the request as belonging to a TELI-paying owner so the
  // rate-limit cap is bumped accordingly.
  async function resolveAgentRequestOwner(req: Request): Promise<void> {
    // Owner-scoped agent services require an explicit, valid botId so we can
    // resolve the owner and enforce their tier. Missing/invalid botId or
    // unknown owner => 402 (PaywallError) so callers can't bypass tier gating
    // by simply omitting the field.
    // Two valid call modes:
    //   (a) Owner-scoped: caller supplies a valid botId so we resolve the
    //       owner and enforce their tier (`allowAgentApi`) plus expose their
    //       per-minute caps for the rate limiter.
    //   (b) Global/platform-agent: caller omits botId. We treat the request as
    //       a public/platform invocation and apply the Free-tier baseline caps.
    //       This preserves backwards compatibility for callers that don't map
    //       to a specific tenant bot.
    // Invalid/unknown botId is rejected (402) so callers cannot bypass tier
    // gating by guessing or supplying junk.
    const botIdRaw = req.body?.botId;
    if (botIdRaw == null) return; // global/platform-agent path: Free defaults apply
    const agentEntitlementError = (message: string) => new PaywallError({
      feature: "allowAgentApi",
      currentPlan: "free",
      requiredPlan: "pro",
      message,
    });
    const botId = parseInt(String(botIdRaw));
    if (!Number.isFinite(botId)) {
      throw agentEntitlementError("botId must be a valid integer.");
    }
    const bot = await storage.getBotConfig(botId).catch(() => null);
    if (!bot) {
      throw agentEntitlementError("Unknown botId.");
    }
    const owner = await storage.getUserById(bot.userId).catch(() => null);
    if (!owner) {
      throw agentEntitlementError("Bot owner could not be resolved.");
    }
    // Tier check: agent API must be enabled for the targeted bot's owner.
    requirePermission(owner, "allowAgentApi");
    // Expose owner's tier limits to the rate limiter so Pro/Business owners
    // receive their promised throughput (Free baseline would otherwise apply).
    const ownerLimits = getLimitsForUser(owner);
    (req as any).agentOwnerLimits = {
      agentApiRateLimitPerMin: ownerLimits.agentApiRateLimitPerMin,
      agentApiTrustedRateLimitPerMin: ownerLimits.agentApiTrustedRateLimitPerMin,
    };
    if (owner.teliPaid && isPlanActive(owner)) (req as any).ownerTeliPaid = true;
  }

  // Wrap so PaywallError thrown from resolveAgentRequestOwner is converted to 402.
  async function agentEntitlementGate(req: Request, res: Response, next: NextFunction) {
    try {
      const { verifySelfRequestHeaders } = await import("./agent/self");
      const selfResult = await verifySelfRequestHeaders(req);
      (req as any).selfVerified = selfResult.verified;
      (req as any).selfAgentAddress = selfResult.agentAddress;
      await resolveAgentRequestOwner(req);
      const limiter = selfResult.verified ? agentTrustRateLimit : agentRateLimit;
      limiter(req, res, next);
    } catch (err: any) {
      if (err instanceof PaywallError) return res.status(402).json(err.toJson());
      next(err);
    }
  }

  const { registerOpenServRoutes } = await import("./agent/openserv");
  registerOpenServRoutes(app);

  app.get("/api/agent/erc8004/registration", agentRateLimit, async (req, res) => {
    try {
      const { generateERC8004Registration } = await import("./agent/erc8004");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const registration = await generateERC8004Registration(baseUrl);
      res.json(registration);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/agent/identity", agentRateLimit, async (req, res) => {
    try {
      const { getAgentIdentity } = await import("./agent/index");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const identity = await getAgentIdentity(baseUrl);
      res.json(identity);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/agent/wallet/status", agentRateLimit, async (_req, res) => {
    try {
      const { getWalletStatus, getLocusWalletAddress } = await import("./agent/locus");
      const walletData = await getWalletStatus();
      const address = getLocusWalletAddress() || walletData?.ownerAddress || null;
      res.json({
        configured: !!address,
        address,
        status: walletData?.walletStatus || (address ? "address_only" : "not_configured"),
        chain: walletData?.chain || "base",
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/agent/services/threat-check", agentEntitlementGate, async (req, res) => {
    try {
      const { text, useAI, paymentId, callerIdentifier } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing required field: text" });
      }
      if (text.length > 5000) {
        return res.status(400).json({ error: "Text exceeds maximum length of 5000 characters" });
      }

      const isSelfVerified = !!(req as any).selfVerified;
      const selfAgentAddress = (req as any).selfAgentAddress || null;
      const pricingTier = useAI ? "ai" : "deterministic";
      const baseAmount = useAI ? 0.005 : 0.001;
      const requiredAmount = isSelfVerified ? baseAmount * 0.5 : baseAmount;

      if (!paymentId) {
        return res.status(402).json({
          error: "Payment required",
          message: "Provide a valid Locus paymentId to use this service",
          requiredAmount: requiredAmount.toString(),
          currency: "USDC",
          tier: pricingTier,
          selfVerified: isSelfVerified,
          trustTierApplied: isSelfVerified,
        });
      }

      const existingLog = await storage.getAgentServiceLogByPaymentId(paymentId);
      if (existingLog) {
        return res.status(409).json({ error: "Payment ID already used" });
      }
      const { verifyLocusPayment } = await import("./agent/locus");
      const paymentResult = await verifyLocusPayment(paymentId);
      const verified = paymentResult.verified;
      const amountUsdc = paymentResult.amount || "0";
      if (!verified || parseFloat(amountUsdc) < requiredAmount) {
        return res.status(402).json({
          error: "Payment verification failed",
          requiredAmount: requiredAmount.toString(),
          currency: "USDC",
          verified,
          selfVerified: isSelfVerified,
        });
      }

      const { performThreatCheck } = await import("./agent/services");
      const result = await performThreatCheck(text, useAI === true);

      await storage.createAgentServiceLog({
        service: "threat-check",
        callerIdentifier: callerIdentifier || req.ip || "unknown",
        inputLength: text.length,
        isScam: result.isScam,
        method: result.method,
        reason: result.reason,
        pricingTier: isSelfVerified ? `${pricingTier}-trust` : pricingTier,
        amountUsdc,
        paymentId,
        paymentVerified: true,
        selfVerified: isSelfVerified,
        selfAgentAddress,
      });

      res.json({
        ...result,
        paymentVerified: true,
        selfVerified: isSelfVerified,
        trustTierApplied: isSelfVerified,
        service: "threat-check",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/agent/services/community-health", agentEntitlementGate, async (req, res) => {
    try {
      const { paymentId, callerIdentifier } = req.body || {};
      const isSelfVerified = !!(req as any).selfVerified;
      const selfAgentAddress = (req as any).selfAgentAddress || null;
      const baseAmount = 0.002;
      const requiredAmount = isSelfVerified ? baseAmount * 0.5 : baseAmount;

      if (!paymentId) {
        return res.status(402).json({
          error: "Payment required",
          message: "Provide a valid Locus paymentId to use this service",
          requiredAmount: requiredAmount.toString(),
          currency: "USDC",
          selfVerified: isSelfVerified,
          trustTierApplied: isSelfVerified,
        });
      }

      const existingLog = await storage.getAgentServiceLogByPaymentId(paymentId);
      if (existingLog) {
        return res.status(409).json({ error: "Payment ID already used" });
      }
      const { verifyLocusPayment } = await import("./agent/locus");
      const paymentResult = await verifyLocusPayment(paymentId);
      const verified = paymentResult.verified;
      const amountUsdc = paymentResult.amount || "0";
      if (!verified || parseFloat(amountUsdc) < requiredAmount) {
        return res.status(402).json({
          error: "Payment verification failed",
          requiredAmount: requiredAmount.toString(),
          currency: "USDC",
          verified,
          selfVerified: isSelfVerified,
        });
      }

      const { getCommunityHealthStats } = await import("./agent/services");
      const stats = await getCommunityHealthStats();

      await storage.createAgentServiceLog({
        service: "community-health",
        callerIdentifier: callerIdentifier || req.ip || "unknown",
        inputLength: 0,
        isScam: null,
        method: null,
        reason: null,
        pricingTier: isSelfVerified ? "standard-trust" : "standard",
        amountUsdc,
        paymentId,
        paymentVerified: true,
        selfVerified: isSelfVerified,
        selfAgentAddress,
      });

      res.json({
        ...stats,
        paymentVerified: true,
        selfVerified: isSelfVerified,
        trustTierApplied: isSelfVerified,
        service: "community-health",
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/erc8004/register", isAuthenticated, requireVerifiedEmail, apiRateLimit, requireBotOwnership, async (req, res, next) => {
    try {
      const owner = await loadUser(req);
      requirePermission(owner, "allowErc8004");
      const botId = parseInt(req.params.botId as string);
      const { getCeloRegistrationStatus, registerBotOnCelo } = await import("./agent/celo");
      const existing = await getCeloRegistrationStatus(botId);
      if (existing.registered) {
        return res.status(409).json({ error: "Bot is already registered on Celo", ...existing });
      }
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await registerBotOnCelo(botId, baseUrl);
      res.json({
        success: true,
        agentId: result.agentId,
        txHash: result.txHash,
        explorerUrl: `https://celoscan.io/tx/${result.txHash}`,
      });
    } catch (err: any) {
      if (err instanceof PaywallError) return next(err);
      console.error(`[erc8004] Registration failed for bot ${req.params.botId}:`, err.message);
      const msg = err.message || "Registration failed";
      if (msg.includes("already registered")) {
        return res.status(409).json({ error: msg });
      }
      if (msg.includes("no group activity") || msg.includes("No group activity")) {
        return res.status(400).json({ error: msg });
      }
      if (msg.includes("CELO_WALLET_PRIVATE_KEY")) {
        return res.status(503).json({ error: "Celo wallet is not configured" });
      }
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/bots/:botId/erc8004/status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { getCeloRegistrationStatus } = await import("./agent/celo");
      const status = await getCeloRegistrationStatus(botId);
      res.json(status);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/helixa/network-stats", agentRateLimit, async (_req, res) => {
    try {
      const { getNetworkStats } = await import("./agent/helixa");
      const stats = await getNetworkStats();
      if (!stats) {
        return res.status(503).json({ error: "Helixa network is unreachable" });
      }
      res.json(stats);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/helixa/status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { pool } = await import("./db");
      const { rows } = await pool.query(
        `SELECT helixa_agent_id, helixa_cred_score, helixa_cred_tier, helixa_profile_url, helixa_synced_at
         FROM bot_configs WHERE id = $1`,
        [botId]
      );
      const row = rows[0];
      if (!row) {
        return res.status(404).json({ error: "Bot not found" });
      }
      const agentId: string | null = row.helixa_agent_id || null;
      if (!agentId) {
        return res.json({
          minted: false,
          agentId: null,
          credScore: null,
          credTier: null,
          profileUrl: null,
          syncedAt: null,
        });
      }
      const { getAgentCred, buildHelixaProfileUrl } = await import("./agent/helixa");
      let credScore: number | null = row.helixa_cred_score;
      let credTier: string | null = row.helixa_cred_tier;
      let syncedAt: Date | null = row.helixa_synced_at;
      const profileUrl: string = row.helixa_profile_url || buildHelixaProfileUrl(agentId);

      // Serve cached fields by default. Only hit the Helixa API if our
      // cache is stale (>5 minutes old) or empty. This keeps the route
      // fast and resilient when Helixa is degraded — the 6h background
      // sync also keeps these fields warm.
      const STATUS_STALE_MS = 5 * 60 * 1000;
      const isStale = !syncedAt || Date.now() - new Date(syncedAt).getTime() > STATUS_STALE_MS;
      let liveRefreshed = false;
      if (isStale) {
        const fresh = await getAgentCred(agentId);
        if (fresh) {
          credScore = fresh.score;
          credTier = fresh.tier;
          syncedAt = new Date();
          liveRefreshed = true;
          await pool.query(
            `UPDATE bot_configs
             SET helixa_cred_score = $1, helixa_cred_tier = $2, helixa_profile_url = $3, helixa_synced_at = $4
             WHERE id = $5`,
            [credScore, credTier, profileUrl, syncedAt, botId]
          );
        }
      }
      res.json({
        minted: true,
        agentId,
        credScore,
        credTier,
        profileUrl,
        syncedAt: syncedAt ? syncedAt.toISOString() : null,
        live: liveRefreshed,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/admin/bots/:botId/helixa/agent-id", isAdminAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      if (Number.isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot id" });
      }
      const raw = req.body?.agentId;
      const agentId: string | null = raw === null || raw === undefined || raw === ""
        ? null
        : String(raw).trim();
      if (agentId !== null && !/^[A-Za-z0-9._-]{1,128}$/.test(agentId)) {
        return res.status(400).json({ error: "agentId must be 1-128 chars [A-Za-z0-9._-]" });
      }
      const { pool } = await import("./db");
      const { buildHelixaProfileUrl, getAgentCred } = await import("./agent/helixa");
      if (agentId === null) {
        const result = await pool.query(
          `UPDATE bot_configs
           SET helixa_agent_id = NULL, helixa_cred_score = NULL, helixa_cred_tier = NULL,
               helixa_profile_url = NULL, helixa_synced_at = NULL
           WHERE id = $1`,
          [botId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Bot not found" });
        return res.json({ cleared: true, agentId: null });
      }
      const profileUrl = buildHelixaProfileUrl(agentId);
      const fresh = await getAgentCred(agentId);
      const score = fresh?.score ?? null;
      const tier = fresh?.tier ?? null;
      // Only stamp helixa_synced_at when the live fetch actually succeeded — a
      // failed fetch should not be claimed as a successful sync.
      const syncedAt = fresh ? new Date() : null;
      const result = await pool.query(
        `UPDATE bot_configs
         SET helixa_agent_id = $1, helixa_cred_score = $2, helixa_cred_tier = $3,
             helixa_profile_url = $4, helixa_synced_at = $5
         WHERE id = $6`,
        [agentId, score, tier, profileUrl, syncedAt, botId]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Bot not found" });
      res.json({
        agentId,
        credScore: score,
        credTier: tier,
        profileUrl,
        syncedAt: syncedAt ? syncedAt.toISOString() : null,
        live: !!fresh,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/admin/erc8004/clear", isAdminAuthenticated, async (req, res) => {
    try {
      const botIds = req.body?.botIds;
      if (!botIds || !Array.isArray(botIds)) {
        return res.status(400).json({ error: "botIds array required" });
      }
      const { pool } = await import("./db");
      const client = await pool.connect();
      try {
        const result = await client.query(
          `UPDATE bot_configs SET celo_agent_id = NULL, celo_tx_hash = NULL, celo_registered_at = NULL WHERE id = ANY($1::int[])`,
          [botIds]
        );
        res.json({ cleared: result.rowCount, botIds });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/admin/erc8004/register-all", isAdminAuthenticated, async (req, res) => {
    try {
      const { batchRegisterAllBots } = await import("./agent/celo-batch");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const sendAnnouncements = req.body?.sendAnnouncements !== false;
      const force = req.body?.force === true;
      const result = await batchRegisterAllBots(baseUrl, { sendAnnouncements, force });
      res.json(result);
    } catch (err: any) {
      console.error("[admin] Batch ERC-8004 registration failed:", err.message);
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/agent/dashboard", isAdminAuthenticated, async (req, res) => {
    try {
      const { getAgentDashboard } = await import("./agent/index");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const dashboard = await getAgentDashboard(baseUrl);
      const logs = await storage.getAgentServiceLogs(50);
      res.json({ ...dashboard, recentLogs: logs });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/rewards/leaderboard", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
      const groupIdRaw = req.query.groupId as string | undefined;
      const groupId = groupIdRaw === undefined || groupIdRaw === "" ? undefined : (groupIdRaw === "null" ? null : parseInt(groupIdRaw));
      const periodStartRaw = req.query.periodStart as string | undefined;
      if (periodStartRaw) {
        const ps = new Date(periodStartRaw);
        if (isNaN(ps.getTime())) return res.status(400).json({ error: "invalid periodStart" });
        const scores = await storage.getContributionScoresForPeriod(botId, ps, limit, groupId as number | null | undefined);
        return res.json(scores);
      }
      const scores = await storage.getLatestContributionScores(botId, limit, groupId as number | null | undefined);
      res.json(scores);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/rewards/periods", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const periods = await storage.listContributionScorePeriods(botId, 24);
      res.json(periods);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/rewards/distributions", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const distributions = await storage.listRewardDistributions(botId, 30);
      res.json(distributions);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/rewards/payouts", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const payouts = await storage.listRewardPayouts(botId, 100);
      res.json(payouts);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/rewards/run", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const config = await storage.getBotConfig(botId);
      if (!config) return res.status(404).json({ error: "Bot not found" });
      const { runRewardsForBot } = await import("./telegram/rewards");
      const result = await runRewardsForBot(config, { dryRun: req.body?.dryRun === true, force: req.body?.force === true });
      res.json(result);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/rewards/wallet-status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const config = await storage.getBotConfig(botId);
      if (!config) return res.status(404).json({ error: "Bot not found" });
      const erc20 = await import("./agent/erc20");
      try {
        const chain = (config.rewardTokenChain || "base") as import("./agent/erc20").RewardChain;
        const { address, source } = erc20.getRewardWalletAddress(chain);
        res.json({ configured: true, address, keySource: source, chain: config.rewardTokenChain || "base" });
      } catch (err: any) {
        res.json({ configured: false, error: err.message, chain: config.rewardTokenChain || "base" });
      }
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/proactive/queue", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const status = (req.query.status as string) || undefined;
      const prompts = await storage.listProactivePrompts(botId, status, 100);
      res.json(prompts);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/proactive/run", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const config = await storage.getBotConfig(botId);
      if (!config) return res.status(404).json({ error: "Bot not found" });
      const { maybeRunProactiveForBot } = await import("./telegram/proactive");
      const result = await maybeRunProactiveForBot({ ...config, proactiveEnabled: true });
      res.json(result);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/proactive/:promptId/post", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const promptId = parseInt(asString(req.params.promptId));
      const { postProactivePrompt } = await import("./telegram/proactive");
      const result = await postProactivePrompt(botId, promptId);
      res.json(result);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/proactive/:promptId/skip", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const promptId = parseInt(asString(req.params.promptId));
      const updated = await storage.updateProactivePrompt(botId, promptId, { status: "skipped" });
      res.json(updated || { ok: false });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/referrals", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const status = (req.query.status as string) || undefined;
      const refs = await storage.listReferrals(botId, status, 100);
      res.json(refs);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/wallets", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const wallets = await storage.listMemberWallets(botId);
      res.json(wallets);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/feedback", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const theme = (req.query.theme as string) || undefined;
      const sentiment = (req.query.sentiment as string) || undefined;
      const groupIdRaw = req.query.groupId ? parseInt(req.query.groupId as string) : NaN;
      const groupId = Number.isFinite(groupIdRaw) ? groupIdRaw : undefined;
      const sinceDaysRaw = req.query.sinceDays ? parseInt(req.query.sinceDays as string) : 30;
      const sinceDays = Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0 && sinceDaysRaw <= 365 ? sinceDaysRaw : 30;
      const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, limitRaw) : 100;
      const items = await storage.listFeedbackItems(botId, { theme, sentiment, groupId, sinceDays, limit });
      res.json(items);
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/feedback/stats", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(asString(req.params.botId));
      const sinceDaysRaw = req.query.sinceDays ? parseInt(req.query.sinceDays as string) : 30;
      const sinceDays = Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0 && sinceDaysRaw <= 365 ? sinceDaysRaw : 30;
      const [byTheme, bySentiment] = await Promise.all([
        storage.countFeedbackByTheme(botId, sinceDays),
        storage.countFeedbackBySentiment(botId, sinceDays),
      ]);
      res.json({ byTheme, bySentiment, sinceDays });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/feedback/digest", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res, next) => {
    try {
      const owner = await loadUser(req);
      requirePermission(owner, "allowFeedbackDigest");
      const botId = parseInt(asString(req.params.botId));
      const sinceDays = req.body?.sinceDays ? parseInt(String(req.body.sinceDays)) : 14;
      const { generateFeedbackDigest } = await import("./telegram/feedback");
      const digest = await generateFeedbackDigest(botId, sinceDays);
      res.json({ digest, sinceDays });
    } catch (err: any) {
      if (err instanceof PaywallError) return next(err);
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  // ---------------- Billing & subscription routes ----------------

  app.get("/api/me/limits", isAuthenticated, apiRateLimit, async (req, res) => {
    const user = await loadUser(req);
    const plan = getEffectivePlan(user);
    const limits = getLimitsForUser(user);
    const bots = user ? await storage.getBotConfigs(user.id) : [];
    // Real usage stats: KB entries summed across all of the user's bots, and the
    // largest single-bot AI-call count for today (the one that would hit the cap first).
    let kbCount = 0;
    let aiCallsToday = 0;
    if (bots.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const perBot = await Promise.all(bots.map(async (b) => {
        const [kbs, ai] = await Promise.all([
          storage.getKnowledgeEntries(b.id).catch(() => []),
          storage.getAiUsageForDay(b.id, today).catch(() => 0),
        ]);
        return { kbs: kbs.length, ai };
      }));
      kbCount = perBot.reduce((s, x) => s + x.kbs, 0);
      aiCallsToday = perBot.reduce((m, x) => Math.max(m, x.ai), 0);
    }
    res.json({
      plan,
      planRail: user?.planRail || "none",
      planPeriodEnd: user?.planPeriodEnd || null,
      planCancelAtPeriodEnd: !!user?.planCancelAtPeriodEnd,
      teliPaid: !!(user?.teliPaid && isPlanActive(user)),
      limits,
      pricing: TIER_PRICING,
      teliDiscountPct: TELI_DISCOUNT_PCT,
      teliRewardsBoostPct: TELI_REWARDS_BOOST_PCT,
      stripeEnabled: Stripe.isStripeEnabled(),
      cryptoEnabled: CryptoBilling.isCryptoEnabled(),
      receiveAddress: CryptoBilling.getReceiveAddressPublic(),
      stripePublishableKey: Stripe.getPublishableKey(),
      usage: {
        bots: bots.length,
        botsLimit: limits.maxBots,
        kb: kbCount,
        kbLimitPerBot: limits.maxKbEntries,
        aiCallsTodayMax: aiCallsToday,
        aiCallsLimitPerBot: limits.dailyAiCallsPerBot,
      },
    });
  });

  app.get("/api/billing/history", isAuthenticated, apiRateLimit, async (req, res) => {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const periods = await storage.listPlanPeriodsForUser(user.id, 25);
    res.json(periods);
  });

  app.post("/api/billing/checkout", isAuthenticated, requireVerifiedEmail, apiRateLimit, async (req, res) => {
    try {
      const user = await loadUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!Stripe.isStripeEnabled()) return res.status(503).json({ error: "Card payments are not configured. Use the crypto checkout for now." });
      const plan = (req.body?.plan as PlanTier) || "pro";
      const billingPeriod = (req.body?.billingPeriod === "annual" ? "annual" : "monthly") as "monthly" | "annual";
      if (plan !== "pro" && plan !== "business") return res.status(400).json({ error: "Invalid plan" });
      const origin = `${req.protocol}://${req.get("host")}`;
      const result = await Stripe.createCheckoutSession({
        userId: user.id,
        email: user.email,
        customerId: user.stripeCustomerId || null,
        plan,
        billingPeriod,
        origin,
      });
      if (!user.stripeCustomerId || user.stripeCustomerId !== result.customerId) {
        await storage.updateUserPlan(user.id, { stripeCustomerId: result.customerId });
      }
      res.json({ url: result.url });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  app.post("/api/billing/portal", isAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const user = await loadUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!user.stripeCustomerId) return res.status(400).json({ error: "No card subscription on file." });
      const origin = `${req.protocol}://${req.get("host")}`;
      const result = await Stripe.createPortalSession({ customerId: user.stripeCustomerId, origin });
      res.json({ url: result.url });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  // Stripe webhook (raw body verified via crypto). No auth.
  app.post("/api/billing/webhook", async (req, res) => {
    try {
      const sig = req.header("stripe-signature");
      const raw = (req as any).rawBody as Buffer | undefined;
      if (!raw || !Stripe.verifyWebhookSignature(raw, sig)) {
        return res.status(400).json({ error: "Invalid signature" });
      }
      const event = JSON.parse(raw.toString("utf8"));
      const obj = event.data?.object;
      if (event.type === "checkout.session.completed" && obj?.subscription && obj?.customer) {
        // Force a fetch to get the price id
        const sub = await Stripe.getSubscription(obj.subscription as string);
        await applyStripeSubscription(sub);
      } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        await applyStripeSubscription(obj);
      } else if (event.type === "customer.subscription.deleted") {
        const userId = obj?.metadata?.userId;
        if (userId) {
          await storage.updateUserPlan(userId, { plan: "free", planRail: "none", stripeSubscriptionId: null, planCancelAtPeriodEnd: false });
          await storage.createPlanPeriod({
            userId, plan: "free", rail: "stripe", billingPeriod: "monthly",
            teliPaid: false, startsAt: new Date(), endsAt: new Date(),
            stripeSubscriptionId: obj?.id || null,
            reason: "stripe_subscription_deleted",
          });
        }
      } else if (event.type === "invoice.paid") {
        // Renewal payment succeeded — re-fetch subscription to update period_end.
        const subId = obj?.subscription;
        if (subId) {
          const sub = await Stripe.getSubscription(subId as string);
          await applyStripeSubscription(sub);
        }
      } else if (event.type === "invoice.payment_failed") {
        // Payment failed — record an audit row but leave the active period in place.
        // Stripe will retry; downgrade happens via subscription.updated/deleted if it ultimately fails.
        const subId = obj?.subscription;
        const userId = obj?.metadata?.userId || (subId ? (await Stripe.getSubscription(subId as string).catch(() => null))?.metadata?.userId : null);
        if (userId) {
          await storage.createPlanPeriod({
            userId, plan: "free", rail: "stripe", billingPeriod: "monthly",
            teliPaid: false, startsAt: new Date(), endsAt: new Date(),
            stripeSubscriptionId: subId || null,
            reason: `stripe_invoice_payment_failed (invoice ${obj?.id || "unknown"})`,
          });
        }
      }
      res.json({ received: true });
    } catch (err: any) {
      console.error("[stripe webhook]", err);
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  async function applyStripeSubscription(sub: any) {
    if (!sub) return;
    const userId = sub.metadata?.userId;
    if (!userId) return;
    const item = sub.items?.data?.[0];
    const priceId = item?.price?.id;
    const mapping = Stripe.planFromPriceId(priceId);
    if (!mapping) return;
    const status = sub.status as string;
    const isActive = status === "active" || status === "trialing";
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
    await storage.updateUserPlan(userId, {
      plan: isActive ? mapping.plan : "free",
      planRail: isActive ? "stripe" : "none",
      planPeriodEnd: periodEnd,
      planCancelAtPeriodEnd: !!sub.cancel_at_period_end,
      stripeSubscriptionId: sub.id,
      teliPaid: false,
    });
    if (isActive && periodEnd) {
      await storage.createPlanPeriod({
        userId,
        plan: mapping.plan,
        rail: "stripe",
        billingPeriod: mapping.billingPeriod,
        teliPaid: false,
        startsAt: new Date(),
        endsAt: periodEnd,
        stripeSubscriptionId: sub.id,
        reason: `stripe_${status}`,
      });
    }
  }

  app.post("/api/billing/crypto/intent", isAuthenticated, requireVerifiedEmail, apiRateLimit, async (req, res) => {
    try {
      const user = await loadUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!CryptoBilling.isCryptoEnabled()) return res.status(503).json({ error: "Crypto checkout is not configured." });
      const plan = (req.body?.plan as PlanTier) || "pro";
      const billingPeriod = (req.body?.billingPeriod === "annual" ? "annual" : "monthly") as "monthly" | "annual";
      const rail = (req.body?.rail === "teli" ? "teli" : "usdc") as "usdc" | "teli";
      if (plan !== "pro" && plan !== "business") return res.status(400).json({ error: "Invalid plan" });
      const result = await CryptoBilling.createCryptoIntent({ userId: user.id, plan, billingPeriod, rail });
      res.json({
        intent: CryptoBilling.formatIntentForDisplay(result.intent),
        displayAmount: result.displayAmount,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/billing/crypto/intent/:id", isAuthenticated, apiRateLimit, async (req, res) => {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const id = parseInt(asString(req.params.id));
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid intent id" });
    const intent = await storage.getPlanPaymentIntent(id);
    if (!intent || intent.userId !== user.id) return res.status(404).json({ error: "Not found" });
    res.json(CryptoBilling.formatIntentForDisplay(intent));
  });

  app.get("/api/billing/crypto/quote", isAuthenticated, apiRateLimit, async (req, res) => {
    try {
      const user = await loadUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      if (!CryptoBilling.isCryptoEnabled()) return res.status(503).json({ error: "Crypto checkout is not configured." });
      const planRaw = asString(req.query.plan ?? "pro");
      const plan = (planRaw === "business" ? "business" : "pro") as PlanTier;
      const billingPeriod = (asString(req.query.billingPeriod ?? "monthly") === "annual" ? "annual" : "monthly") as "monthly" | "annual";
      const rail = (asString(req.query.rail ?? "usdc") === "teli" ? "teli" : "usdc") as "usdc" | "teli";
      const quote = await CryptoBilling.getCryptoQuote({ plan, billingPeriod, rail });
      res.json(quote);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/billing/crypto/pending", isAuthenticated, apiRateLimit, async (req, res) => {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const pending = await CryptoBilling.listPendingIntentsForUser(user.id);
    res.json({ pending });
  });

  app.post("/api/billing/crypto/intent/:id/claim", isAuthenticated, requireVerifiedEmail, apiRateLimit, async (req, res) => {
    try {
      const user = await loadUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const id = parseInt(asString(req.params.id));
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid intent id" });
      const intent = await storage.getPlanPaymentIntent(id);
      if (!intent || intent.userId !== user.id) return res.status(404).json({ error: "Not found" });
      const txHash = typeof req.body?.txHash === "string" ? req.body.txHash : "";
      if (!txHash.trim()) return res.status(400).json({ error: "txHash is required" });
      const result = await CryptoBilling.claimIntentByTxHash(intent, txHash);
      if (result.status === "rejected") return res.status(400).json({ error: result.reason });
      const fresh = await storage.getPlanPaymentIntent(id);
      res.json({ result, intent: fresh ? CryptoBilling.formatIntentForDisplay(fresh) : null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/usd-per-teli", isAdminAuthenticated, async (req, res) => {
    const v = parseFloat(String(req.body?.value || ""));
    if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ error: "value must be > 0" });
    await storage.setPlatformSetting("usd_per_teli", v.toString());
    res.json({ success: true, value: v });
  });

  app.delete("/api/admin/usd-per-teli", isAdminAuthenticated, async (_req, res) => {
    await storage.deletePlatformSetting("usd_per_teli");
    res.json({ success: true, cleared: true });
  });

  app.get("/api/admin/usd-per-teli", isAdminAuthenticated, async (_req, res) => {
    const v = await CryptoBilling.getUsdPerTeli();
    const live = await CryptoBilling.getTeliPriceQuote();
    const overrideRaw = await storage.getPlatformSetting("usd_per_teli");
    const override = overrideRaw ? parseFloat(overrideRaw) : null;
    res.json({
      value: v,
      override: override && Number.isFinite(override) && override > 0 ? override : null,
      live: {
        usdPerTeli: live.usdPerTeli,
        source: live.source,
        fetchedAt: live.fetchedAt,
        liveAvailable: live.liveAvailable,
      },
    });
  });

  app.post("/api/admin/users/:userId/plan", isAdminAuthenticated, async (req, res) => {
    const userId = asString(req.params.userId);
    const plan = req.body?.plan as PlanTier;
    const days = parseInt(String(req.body?.days || "30"));
    const reasonRaw = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!["free", "pro", "business"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
    if (!reasonRaw) return res.status(400).json({ error: "reason is required for admin plan overrides" });
    const planPeriodEnd = plan === "free" ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const planRail = plan === "free" ? "none" : "manual";
    await storage.updateUserPlan(userId, { plan, planRail, planPeriodEnd, teliPaid: !!req.body?.teliPaid, planCancelAtPeriodEnd: false });
    if (plan !== "free" && planPeriodEnd) {
      await storage.createPlanPeriod({
        userId, plan, rail: "manual", billingPeriod: "monthly",
        teliPaid: !!req.body?.teliPaid,
        startsAt: new Date(), endsAt: planPeriodEnd,
        reason: `admin_override: ${reasonRaw.slice(0, 240)}`,
      });
    } else if (plan === "free") {
      // Audit row for downgrades too.
      await storage.createPlanPeriod({
        userId, plan: "free", rail: "manual", billingPeriod: "monthly",
        teliPaid: false,
        startsAt: new Date(), endsAt: new Date(),
        reason: `admin_override (downgrade): ${reasonRaw.slice(0, 240)}`,
      });
    }
    res.json({ success: true });
  });

  app.use(paywallErrorMiddleware);

  await startBotEngine(app);

  return httpServer;
}
