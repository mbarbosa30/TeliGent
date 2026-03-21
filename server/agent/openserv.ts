import express from "express";
import { log } from "../index";

const OPENSERV_PORT = parseInt(process.env.OPENSERV_PORT || "7378", 10);

let serverStarted = false;
let serverError: string | null = null;

export function getOpenServApiKey(): string | null {
  return process.env.OPENSERV_API_KEY || null;
}

export function isOpenServConfigured(): boolean {
  return !!getOpenServApiKey();
}

export interface OpenServStatus {
  configured: boolean;
  running: boolean;
  port: number;
  capabilities: string[];
  error: string | null;
}

export function getOpenServStatus(): OpenServStatus {
  return {
    configured: isOpenServConfigured(),
    running: serverStarted,
    port: OPENSERV_PORT,
    capabilities: ["threat-check", "threat-check-ai", "community-health"],
    error: serverError,
  };
}

interface OpenServCapability {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean; maxLength?: number }>;
  run: (args: any) => Promise<string>;
}

const capabilities: OpenServCapability[] = [
  {
    name: "threat-check",
    description:
      "Deterministic scam detection using regex patterns, homoglyph normalization, and structural analysis. Analyzes text for financial scams, phishing, impersonation, and spam patterns.",
    parameters: {
      text: { type: "string", description: "The text content to analyze for scam/threat patterns", required: true, maxLength: 5000 },
    },
    async run(args: { text: string }) {
      const { performThreatCheck } = await import("./services");
      const result = await performThreatCheck(args.text, false);
      return JSON.stringify({ ...result, service: "threat-check", tier: "deterministic", timestamp: new Date().toISOString() });
    },
  },
  {
    name: "threat-check-ai",
    description:
      "Full AI-powered threat analysis combining deterministic pattern matching with GPT-5.2 AI fallback for ambiguous cases. More thorough but slower.",
    parameters: {
      text: { type: "string", description: "The text content to analyze with full AI threat detection", required: true, maxLength: 5000 },
    },
    async run(args: { text: string }) {
      const { performThreatCheck } = await import("./services");
      const result = await performThreatCheck(args.text, true);
      return JSON.stringify({ ...result, service: "threat-check", tier: "ai", timestamp: new Date().toISOString() });
    },
  },
  {
    name: "community-health",
    description:
      "Aggregated community protection statistics and threat landscape overview. Returns data on protected groups, detected scams, active bots, and conversation volume.",
    parameters: {},
    async run() {
      const { getCommunityHealthStats } = await import("./services");
      const stats = await getCommunityHealthStats();
      return JSON.stringify({ ...stats, service: "community-health", timestamp: new Date().toISOString() });
    },
  },
];

export function getOpenServAgentCard(baseUrl: string) {
  return {
    name: "TeliGent Master Agent",
    description:
      "Autonomous community protection agent on Base. Real-time scam detection, threat intelligence, and community health monitoring for Telegram groups and web platforms. Proof-of-human identity via Self Protocol on Celo.",
    url: baseUrl,
    capabilities: capabilities.map((c) => ({
      name: c.name,
      description: c.description,
      parameters: c.parameters,
    })),
    provider: {
      name: "TeliGent",
      url: "https://teli.gent",
    },
    version: "1.2.0",
    tags: ["security", "scam-detection", "threat-intelligence", "community-protection", "telegram"],
  };
}

export async function startOpenServAgent(): Promise<void> {
  const apiKey = getOpenServApiKey();
  if (!apiKey) {
    log("OpenServ not configured — OPENSERV_API_KEY not set", "agent");
    return;
  }

  if (serverStarted) {
    log("OpenServ agent already running", "agent");
    return;
  }

  try {
    const app = express();
    app.use(express.json());

    app.post("/", async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const { type, capability, args, taskId, workspaceId } = req.body;

        if (type === "capability_invoke" || type === "do_task") {
          const capName = capability || req.body.task?.capability;
          const capArgs = args || req.body.task?.args || {};

          const cap = capabilities.find((c) => c.name === capName);
          if (!cap) {
            return res.status(404).json({ error: `Unknown capability: ${capName}` });
          }

          log(`OpenServ invocation: ${capName} (workspace: ${workspaceId || "N/A"}, task: ${taskId || "N/A"})`, "agent");
          const result = await cap.run(capArgs);

          return res.json({
            success: true,
            result,
            capability: capName,
            taskId,
          });
        }

        if (type === "get_capabilities" || type === "list_capabilities") {
          return res.json({
            capabilities: capabilities.map((c) => ({
              name: c.name,
              description: c.description,
              parameters: c.parameters,
            })),
          });
        }

        return res.status(400).json({ error: `Unknown request type: ${type}` });
      } catch (err: any) {
        log(`OpenServ request error: ${err.message}`, "agent");
        return res.status(500).json({ error: err.message });
      }
    });

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", agent: "TeliGent Master Agent", version: "1.2.0" });
    });

    app.get("/.well-known/agent.json", (req, res) => {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      res.json(getOpenServAgentCard(baseUrl));
    });

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(OPENSERV_PORT, "0.0.0.0", () => {
        serverStarted = true;
        serverError = null;
        log(`OpenServ agent started on port ${OPENSERV_PORT} with ${capabilities.length} capabilities`, "agent");
        resolve();
      });
      server.on("error", (err: any) => {
        serverError = err.message;
        log(`OpenServ agent failed to start: ${err.message}`, "agent");
        reject(err);
      });
    });
  } catch (err: any) {
    serverError = err.message;
    log(`Failed to start OpenServ agent: ${err.message}`, "agent");
  }
}
