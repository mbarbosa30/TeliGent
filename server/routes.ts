import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { insertKnowledgeBaseSchema, insertBotConfigSchema } from "@shared/schema";
import { startBotEngine, getWebhookStatus } from "./telegram";
import { generateAIResponse } from "./telegram/commands";
import { isAuthenticated, isAdminAuthenticated } from "./auth";
import { sql } from "drizzle-orm";
import { scrapeUrl } from "./scraper";
import crypto from "crypto";

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

  app.get("/api/bots/:botId/memories", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const memories = await storage.getBotMemories(botId);
      res.json(memories);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/bots/:botId/memories/:id", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const id = parseInt(req.params.id as string);
      await storage.deleteBotMemory(botId, id);
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

  const widgetRateLimit = createApiRateLimiter(60 * 1000, 20);

  app.post("/api/bots/:botId/widget/enable", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId);
      const widgetKey = crypto.randomBytes(24).toString("hex");
      await storage.updateBotConfig(botId, { widgetEnabled: true, widgetKey });
      res.json({ widgetKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/widget/disable", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId);
      await storage.updateBotConfig(botId, { widgetEnabled: false });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/widget/conversations", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId);
      const conversations = await storage.getWidgetConversations(botId);
      res.json(conversations);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function widgetCors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
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
      const config = await storage.getBotByWidgetKey(req.params.widgetKey);
      if (!config) return res.status(404).json({ error: "Widget not found" });
      res.json({
        botName: config.botName || "Assistant",
        greeting: `Hi! I'm ${config.botName || "the assistant"}. How can I help you?`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/widget/:widgetKey/message", widgetCors, widgetRateLimit, async (req, res) => {
    try {
      const config = await storage.getBotByWidgetKey(req.params.widgetKey);
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

  const agentRateLimit = createApiRateLimiter(60 * 1000, 30);
  const agentTrustRateLimit = createApiRateLimiter(60 * 1000, 60);

  const { registerOpenServRoutes } = await import("./agent/openserv");
  registerOpenServRoutes(app);

  app.get("/api/agent/erc8004/registration", agentRateLimit, async (req, res) => {
    try {
      const { generateERC8004Registration } = await import("./agent/erc8004");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const registration = await generateERC8004Registration(baseUrl);
      res.json(registration);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agent/identity", agentRateLimit, async (req, res) => {
    try {
      const { getAgentIdentity } = await import("./agent/index");
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const identity = await getAgentIdentity(baseUrl);
      res.json(identity);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/services/threat-check", async (req, res, next) => {
    const { verifySelfRequestHeaders } = await import("./agent/self");
    const selfResult = await verifySelfRequestHeaders(req);
    (req as any).selfVerified = selfResult.verified;
    (req as any).selfAgentAddress = selfResult.agentAddress;
    const limiter = selfResult.verified ? agentTrustRateLimit : agentRateLimit;
    limiter(req, res, next);
  }, async (req, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/services/community-health", async (req, res, next) => {
    const { verifySelfRequestHeaders } = await import("./agent/self");
    const selfResult = await verifySelfRequestHeaders(req);
    (req as any).selfVerified = selfResult.verified;
    (req as any).selfAgentAddress = selfResult.agentAddress;
    const limiter = selfResult.verified ? agentTrustRateLimit : agentRateLimit;
    limiter(req, res, next);
  }, async (req, res) => {
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
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bots/:botId/erc8004/register", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
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
      console.error(`[erc8004] Registration failed for bot ${req.params.botId}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/bots/:botId/erc8004/status", isAuthenticated, apiRateLimit, requireBotOwnership, async (req, res) => {
    try {
      const botId = parseInt(req.params.botId as string);
      const { getCeloRegistrationStatus } = await import("./agent/celo");
      const status = await getCeloRegistrationStatus(botId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: err.message });
    }
  });

  await startBotEngine(app);

  return httpServer;
}
