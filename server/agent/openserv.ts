import type { Express } from "express";
import { log } from "../index";
import { getLocusWalletAddress } from "./locus";

let totalInvocations = 0;

export function getOpenServApiKey(): string | null {
  return process.env.OPENSERV_API_KEY || null;
}

export function isOpenServConfigured(): boolean {
  return !!getOpenServApiKey();
}

export interface OpenServStatus {
  configured: boolean;
  capabilities: string[];
  totalInvocations: number;
}

export async function getOpenServStatus(): Promise<OpenServStatus> {
  let dbInvocations = totalInvocations;
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM agent_service_logs WHERE caller_identifier LIKE 'openserv:%'`);
    const count = Number(result.rows?.[0]?.count ?? 0);
    dbInvocations = Math.max(count, totalInvocations);
  } catch {
    dbInvocations = totalInvocations;
  }
  return {
    configured: isOpenServConfigured(),
    capabilities: ["threat-check", "threat-check-ai", "community-health"],
    totalInvocations: dbInvocations,
  };
}

interface CapabilityDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean; maxLength?: number }>;
  pricingTier: string;
  priceUsdc: string;
  run: (args: any) => Promise<string>;
}

const capabilityDefs: CapabilityDef[] = [
  {
    name: "threat-check",
    description:
      "Deterministic scam detection using regex patterns, homoglyph normalization, and structural analysis. Analyzes text for financial scams, phishing, impersonation, and spam patterns.",
    parameters: {
      text: { type: "string", description: "The text content to analyze for scam/threat patterns", required: true, maxLength: 5000 },
    },
    pricingTier: "deterministic",
    priceUsdc: "0.001",
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
    pricingTier: "ai",
    priceUsdc: "0.005",
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
    pricingTier: "standard",
    priceUsdc: "0.002",
    async run() {
      const { getCommunityHealthStats } = await import("./services");
      const stats = await getCommunityHealthStats();
      return JSON.stringify({ ...stats, service: "community-health", timestamp: new Date().toISOString() });
    },
  },
];

const capabilityDefsByLength = [...capabilityDefs].sort((a, b) => b.name.length - a.name.length);

function resolveCapabilityFromPayload(body: any): { cap: CapabilityDef; args: any; callerInfo: string } | null {
  const capName = body.capability || body.task?.capability || null;
  let capArgs = body.args || body.task?.args || {};

  if (capName) {
    const cap = capabilityDefs.find((c) => c.name === capName);
    if (cap) {
      if (Object.keys(cap.parameters).length > 0 && !capArgs.text) {
        const textContent = body.task?.input || body.task?.description || body.task?.body || "";
        if (textContent) capArgs = { ...capArgs, text: textContent };
      }
      return { cap, args: capArgs, callerInfo: buildCallerInfo(body) };
    }
  }

  const taskDescription = body.task?.description || body.task?.body || "";
  const taskInput = body.task?.input || "";
  const textContent = taskInput || taskDescription;

  if (textContent) {
    const lowerText = textContent.toLowerCase();
    for (const cap of capabilityDefsByLength) {
      if (lowerText.includes(cap.name)) {
        const resolvedArgs = Object.keys(cap.parameters).length > 0 ? { ...capArgs, text: textContent } : capArgs;
        return { cap, args: resolvedArgs, callerInfo: buildCallerInfo(body) };
      }
    }

    const threatCap = capabilityDefs.find((c) => c.name === "threat-check");
    if (threatCap && textContent.length > 0) {
      return { cap: threatCap, args: { text: textContent }, callerInfo: buildCallerInfo(body) };
    }
  }

  return null;
}

function buildCallerInfo(body: any): string {
  const wsId = body.workspaceId || body.workspace?.id || "unknown";
  const taskId = body.taskId || body.task?.id || "unknown";
  return `ws-${wsId}/task-${taskId}`;
}

export function getOpenServManifest(baseUrl: string) {
  const walletAddress = getLocusWalletAddress();

  return {
    name: "TeliGent Master Agent",
    description:
      "Autonomous community protection agent on Base. Real-time scam detection, threat intelligence, and community health monitoring for Telegram groups and web platforms. Proof-of-human identity via Self Protocol on Celo.",
    url: baseUrl,
    version: "1.2.0",
    capabilities: capabilityDefs.map((c) => ({
      name: c.name,
      description: c.description,
      parameters: c.parameters,
      pricing: {
        amount: c.priceUsdc,
        currency: "USDC",
        chain: "base",
        protocol: "locus",
      },
    })),
    endpoints: {
      invoke: `${baseUrl}/api/agent/openserv/invoke`,
      tools: capabilityDefs.reduce((acc, c) => {
        acc[c.name] = `${baseUrl}/api/agent/openserv/tools/${c.name}`;
        return acc;
      }, {} as Record<string, string>),
      health: `${baseUrl}/api/agent/openserv/health`,
      identity: `${baseUrl}/api/agent/identity`,
      threatCheck: `${baseUrl}/api/agent/services/threat-check`,
      communityHealth: `${baseUrl}/api/agent/services/community-health`,
    },
    payment: {
      address: walletAddress || null,
      currency: "USDC",
      chain: "base",
      protocol: "locus",
    },
    trust: {
      provider: "self-protocol",
      chain: "celo",
      description: "Self-verified calling agents receive 50% pricing discount and higher rate limits (60/min vs 30/min)",
      verificationHeaders: ["x-self-agent-address", "x-self-agent-signature", "x-self-agent-timestamp"],
      tiers: [
        {
          name: "verified",
          rateLimit: "60/min",
          discount: "50%",
          requirements: ["Self Protocol proof-of-human verification on Celo"],
        },
        {
          name: "standard",
          rateLimit: "30/min",
          discount: "0%",
          requirements: [],
        },
      ],
      selfProtocol: {
        chain: "celo",
        description: "Self-verified calling agents receive 50% pricing discount and higher rate limits (60/min vs 30/min)",
        verificationHeaders: ["x-self-agent-address", "x-self-agent-signature", "x-self-agent-timestamp"],
      },
    },
    provider: {
      name: "TeliGent",
      url: "https://teli.gent",
      telegram: "https://t.me/teli_gent",
      twitter: "https://x.com/Teli_Gent_",
    },
    tags: ["security", "scam-detection", "threat-intelligence", "community-protection", "telegram", "x402-compatible"],
  };
}

async function logOpenServInvocation(capName: string, result: string, callerInfo: string) {
  try {
    const { storage } = await import("../storage");
    const parsed = JSON.parse(result);

    const cap = capabilityDefs.find((c) => c.name === capName);

    await storage.createAgentServiceLog({
      service: capName === "community-health" ? "community-health" : "threat-check",
      callerIdentifier: `openserv:${callerInfo}`,
      inputLength: parsed.inputLength || 0,
      isScam: parsed.isScam ?? null,
      method: parsed.method || null,
      reason: parsed.reason || null,
      pricingTier: `openserv-${cap?.pricingTier || "standard"}`,
      amountUsdc: cap?.priceUsdc || "0",
      paymentId: `openserv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paymentVerified: true,
      selfVerified: false,
      selfAgentAddress: null,
    });
  } catch (err: any) {
    log(`Failed to log OpenServ invocation: ${err.message}`, "agent");
  }
}

async function executeCapability(cap: CapabilityDef, args: any, callerInfo: string) {
  const result = await cap.run(args);
  totalInvocations++;
  logOpenServInvocation(cap.name, result, callerInfo);
  return result;
}

export function registerOpenServRoutes(app: Express): void {
  const apiKey = getOpenServApiKey();

  function verifyAuth(req: any, res: any): boolean {
    if (!apiKey) {
      res.status(503).json({ error: "OpenServ integration not configured" });
      return false;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  app.post("/api/agent/openserv/invoke", async (req, res) => {
    try {
      if (!verifyAuth(req, res)) return;

      const type = req.body.type || req.body.action?.type || req.body.action;
      const normalizedType = typeof type === "string" ? type.replace(/-/g, "_").toLowerCase() : null;

      if (normalizedType === "capability_invoke" || normalizedType === "do_task") {
        const resolved = resolveCapabilityFromPayload(req.body);
        if (!resolved) {
          return res.status(404).json({ error: "Could not resolve capability from request" });
        }

        log(`OpenServ invocation: ${resolved.cap.name} (${resolved.callerInfo})`, "agent");

        const result = await executeCapability(resolved.cap, resolved.args, resolved.callerInfo);

        return res.json({
          success: true,
          result,
          capability: resolved.cap.name,
          taskId: req.body.taskId || req.body.task?.id,
        });
      }

      if (normalizedType === "respond_chat_message") {
        const messages = req.body.messages || req.body.chatHistory || [];
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const userText = lastMessage?.content || req.body.message || "";

        if (userText) {
          const resolved = resolveCapabilityFromPayload({ ...req.body, task: { input: userText } });
          if (resolved) {
            const result = await executeCapability(resolved.cap, resolved.args, buildCallerInfo(req.body));
            return res.json({ success: true, result, type: "chat-response" });
          }
        }

        return res.json({
          success: true,
          result: JSON.stringify({
            message: "TeliGent Master Agent provides scam detection, threat intelligence, and community health monitoring. Send text to analyze or ask for community-health stats.",
            capabilities: capabilityDefs.map((c) => c.name),
          }),
          type: "chat-response",
        });
      }

      if (normalizedType === "get_capabilities" || normalizedType === "list_capabilities") {
        return res.json({
          capabilities: capabilityDefs.map((c) => ({
            name: c.name,
            description: c.description,
            parameters: c.parameters,
            pricing: { amount: c.priceUsdc, currency: "USDC" },
          })),
        });
      }

      return res.status(400).json({ error: `Unknown request type: ${type}` });
    } catch (err: any) {
      log(`OpenServ request error: ${err.message}`, "agent");
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/openserv/tools/:toolName", async (req, res) => {
    try {
      if (!verifyAuth(req, res)) return;

      const { toolName } = req.params;
      const cap = capabilityDefs.find((c) => c.name === toolName);
      if (!cap) {
        return res.status(404).json({ error: `Tool "${toolName}" not found` });
      }

      const args = req.body.args || req.body;
      const callerInfo = buildCallerInfo(req.body);

      log(`OpenServ tool call: ${toolName} (${callerInfo})`, "agent");

      const result = await executeCapability(cap, args, callerInfo);

      return res.json({ success: true, result });
    } catch (err: any) {
      log(`OpenServ tool error: ${err.message}`, "agent");
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agent/openserv/health", (_req, res) => {
    res.json({
      status: "ok",
      agent: "TeliGent Master Agent",
      version: "1.2.0",
      capabilities: capabilityDefs.length,
      totalInvocations,
    });
  });

  app.get("/.well-known/agent.json", (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json(getOpenServManifest(baseUrl));
  });

  log(`OpenServ routes registered with ${capabilityDefs.length} capabilities${apiKey ? "" : " (OPENSERV_API_KEY not set — invoke disabled)"}`, "agent");
}
