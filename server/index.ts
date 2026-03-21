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

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);

      try {
        const { startOpenServAgent } = await import("./agent/openserv");
        await startOpenServAgent();
      } catch (err: any) {
        log(`OpenServ agent startup skipped: ${err.message}`);
      }
    },
  );
})();
