import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./auth";
import { runMigrations } from "./migrations";
import { storage } from "./storage";
import { csrfMiddleware } from "./csrf";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Field-name denylist for response-body logging. Anything matching either
// the explicit set or the regex below is redacted before it ever lands in
// our server logs. This is defense in depth: route handlers should already
// avoid returning raw secrets, but a missed handler should not be able to
// leak credentials, PII, or wallet identifiers via the access log.
const SENSITIVE_FIELD_NAMES = new Set<string>([
  "email",
  "customerId",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "walletAddress",
  "address",
  "txHash",
  "transactionHash",
  "sessionId",
  "refreshToken",
  "accessToken",
  "bankrApiKey",
  "apiKey",
  "privateKey",
  "passphrase",
  "csrfToken",
  "csrf_token",
  "tokenHash",
  "passwordHash",
  // Profile PII: present on /api/auth/user and similar account endpoints.
  "firstName",
  "lastName",
  "fullName",
  "phone",
  "phoneNumber",
  "username",
  "telegramHandle",
  "telegramUsername",
  "ipAddress",
]);
const SENSITIVE_FIELD_PATTERN = /(key|secret|token|password|passphrase)/i;

function maskString(value: string): string {
  if (value.length <= 6) return "[redacted]";
  return value.slice(0, 2) + "***" + value.slice(-2);
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  // Preserve the existing botToken truncation shape so existing log readers
  // don't break.
  if (key === "botToken") return value.slice(0, 6) + "***";
  if (SENSITIVE_FIELD_NAMES.has(key) || SENSITIVE_FIELD_PATTERN.test(key)) {
    return maskString(value);
  }
  return value;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const safeBody = JSON.stringify(capturedJsonResponse, (key, value) => redactValue(key, value));
        logLine += ` :: ${safeBody}`;
      }

      log(logLine);
    }
  });

  next();
});

app.use(csrfMiddleware);

(async () => {
  await runMigrations();

  setupAuth(app);
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "90", 10);
  const LOG_CLEANUP_INTERVAL_HOURS = parseInt(process.env.LOG_CLEANUP_INTERVAL_HOURS || "24", 10);

  const runLogCleanup = async () => {
    try {
      const deleted = await storage.cleanOldActivityLogs(LOG_RETENTION_DAYS);
      if (deleted > 0) {
        log(`Activity log cleanup: removed ${deleted} entries older than ${LOG_RETENTION_DAYS} days`);
      }
    } catch (err: any) {
      log(`Activity log cleanup error: ${err.message}`);
    }
  };

  runLogCleanup();
  setInterval(runLogCleanup, LOG_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

  // Crash-recovery sweep for rewards distributions. Any reward_distributions
  // row left in `pending` longer than the threshold belonged to a process
  // that died mid-loop. We re-derive a determinate status from the
  // persisted counters via finalizeDistributionFromCounters and stamp
  // completed_at, so the dashboard never shows a permanently-stuck row.
  // Runs once at boot and then on a slow interval.
  const REWARDS_RECOVERY_STALE_MIN = parseInt(process.env.REWARDS_RECOVERY_STALE_MIN || "15", 10);
  const REWARDS_RECOVERY_INTERVAL_MIN = parseInt(process.env.REWARDS_RECOVERY_INTERVAL_MIN || "60", 10);
  const runRewardsRecovery = async () => {
    try {
      const ids = await storage.findStalePendingDistributionIds(REWARDS_RECOVERY_STALE_MIN * 60 * 1000);
      if (ids.length === 0) return;
      let recovered = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const final = await storage.finalizeDistributionFromCounters(id);
          if (final) recovered++;
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          log(`[rewards.recovery] failed id=${id} err=${msg}`, "rewards");
        }
      }
      log(`[rewards.recovery] swept stale=${ids.length} recovered=${recovered} failed=${failed}`, "rewards");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[rewards.recovery] sweep error: ${msg}`, "rewards");
    }
  };
  // Defer the first sweep so it never races migrations or route setup.
  setTimeout(runRewardsRecovery, 30 * 1000);
  setInterval(runRewardsRecovery, REWARDS_RECOVERY_INTERVAL_MIN * 60 * 1000);

  const KNOWLEDGE_SWEEP_MIN = 30;
  const runKnowledgeSweep = async () => {
    try {
      const [kb, mem] = await Promise.all([
        storage.sweepExpiredKnowledge(),
        storage.sweepExpiredBotMemories(),
      ]);
      if (kb > 0 || mem > 0) {
        log(`Temporal sweep: knowledge_disabled=${kb} memories_deleted=${mem}`, "memory");
      }
    } catch (err: any) {
      log(`Temporal sweep error: ${err.message}`, "memory");
    }
  };
  runKnowledgeSweep();
  setInterval(runKnowledgeSweep, KNOWLEDGE_SWEEP_MIN * 60 * 1000);

  const SCHEDULER_INTERVAL_MIN = parseInt(process.env.REWARDS_SCHEDULER_MIN || "15", 10);
  let schedulerRunning = false;
  const rewardsLocks = new Set<number>();
  const runRewardsScheduler = async () => {
    if (schedulerRunning) {
      log("Scheduler tick skipped: previous tick still running", "scheduler");
      return;
    }
    schedulerRunning = true;
    try {
      const { flushAiUsage, maybeRollover } = await import("./ai-budget");
      // Flush BEFORE rollover so any prior-day usage is persisted before the in-memory cache resets.
      await flushAiUsage();
      maybeRollover();

      // Poll Base for crypto plan payments. No-op if no platform receive address is configured.
      try {
        const { pollCryptoIntents, isCryptoEnabled } = await import("./billing/crypto");
        if (isCryptoEnabled()) {
          const result = await pollCryptoIntents();
          if (result.matched > 0 || result.expired > 0) {
            log(`Crypto poller: matched=${result.matched} expired=${result.expired}`, "billing");
          }
        }
      } catch (err: any) {
        log(`Crypto poller error: ${err.message}`, "billing");
      }
      const { maybeRunProactiveForBot } = await import("./telegram/proactive");
      const { runRewardsForBot } = await import("./telegram/rewards");
      const { processPendingReferrals } = await import("./telegram/referrals");
      const { getCurrentPeriod, computeContributorScoresByGroup, persistContributorScores } = await import("./telegram/reputation");

      const configs = await storage.getAllActiveConfigs();
      const CHUNK = 4;
      const PAUSE_MS = 1500;
      const processOne = async (config: typeof configs[number]) => {
        try {
          const period = getCurrentPeriod(config.rewardPeriodDays || 7);
          const byGroup = await computeContributorScoresByGroup(config.id, period.start, period.end);
          for (const [gid, list] of byGroup.entries()) {
            await persistContributorScores(config.id, period.start, period.end, list, gid);
          }

          if (config.proactiveEnabled) {
            await maybeRunProactiveForBot(config);
          }
          if (config.referralEnabled) {
            await processPendingReferrals(config);
          }
          if (config.rewardsEnabled) {
            const periodMs = (config.rewardPeriodDays || 7) * 24 * 60 * 60 * 1000;
            const last = config.rewardLastDistributionAt ? new Date(config.rewardLastDistributionAt).getTime() : 0;
            if (Date.now() - last >= periodMs && !rewardsLocks.has(config.id)) {
              rewardsLocks.add(config.id);
              try {
                const fresh = await storage.getBotConfig(config.id);
                if (fresh) await runRewardsForBot(fresh);
              } finally {
                rewardsLocks.delete(config.id);
              }
            }
          }
        } catch (err: any) {
          log(`Scheduler bot ${config.id} error: ${err.message}`, "scheduler");
        }
      };
      for (let i = 0; i < configs.length; i += CHUNK) {
        const chunk = configs.slice(i, i + CHUNK);
        await Promise.all(chunk.map(processOne));
        if (i + CHUNK < configs.length) {
          await new Promise((r) => setTimeout(r, PAUSE_MS));
        }
      }
    } catch (err: any) {
      log(`Scheduler tick error: ${err.message}`, "scheduler");
    } finally {
      schedulerRunning = false;
    }
  };

  setInterval(runRewardsScheduler, SCHEDULER_INTERVAL_MIN * 60 * 1000);
  setTimeout(runRewardsScheduler, 30 * 1000);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
