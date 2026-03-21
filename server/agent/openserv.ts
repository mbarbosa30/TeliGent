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

export function getOpenServStatus(): OpenServStatus {
  return {
    configured: isOpenServConfigured(),
    capabilities: ["threat-check", "threat-check-ai", "community-health"],
    totalInvocations,
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

export function registerOpenServRoutes(app: Express): void {
  const apiKey = getOpenServApiKey();
  if (!apiKey) {
    log("OpenServ not configured — OPENSERV_API_KEY not set", "agent");
    return;
  }

  app.post("/api/agent/openserv/invoke", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { type, capability, args, taskId, workspaceId } = req.body;

      if (type === "capability_invoke" || type === "do_task") {
        const capName = capability || req.body.task?.capability;
        const capArgs = args || req.body.task?.args || {};

        const cap = capabilityDefs.find((c) => c.name === capName);
        if (!cap) {
          return res.status(404).json({ error: `Unknown capability: ${capName}` });
        }

        log(`OpenServ invocation: ${capName} (workspace: ${workspaceId || "N/A"}, task: ${taskId || "N/A"})`, "agent");

        const result = await cap.run(capArgs);
        totalInvocations++;

        const callerInfo = `ws-${workspaceId || "unknown"}/task-${taskId || "unknown"}`;
        logOpenServInvocation(capName, result, callerInfo);

        return res.json({
          success: true,
          result,
          capability: capName,
          taskId,
        });
      }

      if (type === "get_capabilities" || type === "list_capabilities") {
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

  log(`OpenServ routes registered with ${capabilityDefs.length} capabilities`, "agent");
}
