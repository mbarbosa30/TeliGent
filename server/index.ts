import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./auth";
import { runMigrations } from "./migrations";
import { storage } from "./storage";

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
        const safeBody = JSON.stringify(capturedJsonResponse, (key, value) => {
          if (key === "botToken" && typeof value === "string") return value.slice(0, 6) + "***";
          return value;
        });
        logLine += ` :: ${safeBody}`;
      }

      log(logLine);
    }
  });

  next();
});

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

  const HELIXA_SYNC_INTERVAL_HOURS = Math.max(
    1,
    parseInt(process.env.HELIXA_SYNC_INTERVAL_HOURS || "6", 10) || 6,
  );
  let helixaSyncRunning = false;
  const runHelixaSync = async () => {
    if (helixaSyncRunning) {
      log("Helixa sync skipped: previous run still active", "helixa.sync");
      return;
    }
    helixaSyncRunning = true;
    let refreshed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const { pool } = await import("./db");
      const { getAgentCred, buildHelixaProfileUrl } = await import("./agent/helixa");
      const { rows } = await pool.query(
        `SELECT id, helixa_agent_id FROM bot_configs
         WHERE helixa_agent_id IS NOT NULL AND helixa_agent_id <> ''`,
      );
      for (const row of rows) {
        const botId: number = row.id;
        const agentId: string = row.helixa_agent_id;
        try {
          const fresh = await getAgentCred(agentId);
          if (!fresh) {
            skipped++;
            continue;
          }
          const profileUrl = buildHelixaProfileUrl(agentId);
          await pool.query(
            `UPDATE bot_configs
             SET helixa_cred_score = $1, helixa_cred_tier = $2,
                 helixa_profile_url = $3, helixa_synced_at = $4
             WHERE id = $5`,
            [fresh.score, fresh.tier, profileUrl, new Date(), botId],
          );
          refreshed++;
        } catch (err: any) {
          failed++;
          log(`Helixa sync bot ${botId} error: ${err.message}`, "helixa.sync");
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      log(
        `[helixa.sync] refreshed=${refreshed} skipped=${skipped} failed=${failed} total=${rows.length}`,
        "helixa.sync",
      );
    } catch (err: any) {
      log(`Helixa sync error: ${err.message}`, "helixa.sync");
    } finally {
      helixaSyncRunning = false;
    }
  };
  setInterval(runHelixaSync, HELIXA_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
  setTimeout(runHelixaSync, 60 * 1000);

  // One-shot Helixa wallet balance check at boot. Logs USDC + ETH so
  // operators can spot a depleted mint wallet before users hit the
  // /helixa/register endpoint. Each mint costs ~$1 USDC.
  setTimeout(async () => {
    try {
      const { isHelixaWalletConfigured } = await import("./agent/helixa-siwa");
      if (!isHelixaWalletConfigured()) {
        log(
          "HELIXA_BASE_WALLET_PRIVATE_KEY not set — per-bot Helixa minting disabled",
          "helixa.wallet",
        );
        return;
      }
      const { getHelixaWalletBalances } = await import("./agent/helixa-mint");
      const bal = await getHelixaWalletBalances();
      const tag = `address=${bal.address} usdc=${bal.usdcFormatted ?? "?"} eth=${bal.ethFormatted ?? "?"} status=${bal.status}`;
      if (bal.status === "depleted") {
        log(`DEPLETED ${tag} — mints will fail until refilled`, "helixa.wallet");
      } else if (bal.status === "low") {
        log(`LOW ${tag} — top up before more mints`, "helixa.wallet");
      } else {
        log(`ok ${tag}`, "helixa.wallet");
      }
    } catch (err: any) {
      log(`balance check error: ${err.message}`, "helixa.wallet");
    }
  }, 5 * 1000);

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
