import { getLocusApiKey, getLocusWalletAddress, getWalletStatus } from "./locus";

export interface AgentIdentity {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  chain: string;
  walletAddress: string | null;
  walletStatus: string | null;
  pricing: {
    threatCheck: { price: string; currency: string; description: string };
    threatCheckAI: { price: string; currency: string; description: string };
    communityHealth: { price: string; currency: string; description: string };
  };
  endpoints: {
    identity: string;
    threatCheck: string;
    communityHealth: string;
    walletStatus: string;
  };
  links: {
    website: string;
    telegram: string;
    twitter: string;
  };
}

export async function getAgentIdentity(baseUrl: string): Promise<AgentIdentity> {
  const walletStatus = await getWalletStatus();

  return {
    name: "TeliGent Master Agent",
    version: "1.0.0",
    description: "Autonomous community protection agent. Provides real-time scam detection, threat intelligence, and community health monitoring for Telegram groups and web platforms. Powered by deterministic pattern matching and AI analysis.",
    capabilities: [
      "scam_detection",
      "threat_intelligence",
      "community_health_monitoring",
      "homoglyph_normalization",
      "impersonation_detection",
      "real_time_learning",
      "multi_platform_protection",
    ],
    chain: "base",
    walletAddress: getLocusWalletAddress() || walletStatus?.ownerAddress || null,
    walletStatus: walletStatus?.walletStatus || null,
    pricing: {
      threatCheck: {
        price: "0.001",
        currency: "USDC",
        description: "Deterministic scam detection — regex patterns, homoglyph normalization, structural analysis",
      },
      threatCheckAI: {
        price: "0.005",
        currency: "USDC",
        description: "Full threat analysis — deterministic + GPT-5.2 AI fallback for ambiguous cases",
      },
      communityHealth: {
        price: "0.002",
        currency: "USDC",
        description: "Aggregated community protection statistics and threat landscape overview",
      },
    },
    endpoints: {
      identity: `${baseUrl}/api/agent/identity`,
      threatCheck: `${baseUrl}/api/agent/services/threat-check`,
      communityHealth: `${baseUrl}/api/agent/services/community-health`,
      walletStatus: `${baseUrl}/api/agent/wallet/status`,
    },
    links: {
      website: "https://teli.gent",
      telegram: "https://t.me/teli_gent",
      twitter: "https://x.com/Teli_Gent_",
    },
  };
}

export interface AgentDashboardData {
  identity: AgentIdentity;
  isConfigured: boolean;
  serviceStats: {
    totalRequests: number;
    totalEarnings: string;
    requestsToday: number;
  };
}

export async function getAgentDashboard(baseUrl: string): Promise<AgentDashboardData> {
  const identity = await getAgentIdentity(baseUrl);
  const apiKey = getLocusApiKey();
  const { storage } = await import("../storage");

  const stats = await storage.getAgentServiceStats();

  return {
    identity,
    isConfigured: !!apiKey,
    serviceStats: stats,
  };
}
