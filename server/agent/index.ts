import { getLocusApiKey, getLocusWalletAddress, getWalletStatus } from "./locus";
import { getTeliGentSelfStatus } from "./self";
import { getOpenServStatus, getOpenServManifest } from "./openserv";

export interface AgentIdentity {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  chain: string;
  walletAddress: string | null;
  walletStatus: string | null;
  selfVerified: boolean;
  selfAgentId: string | null;
  selfChain: string;
  pricing: {
    threatCheck: { price: string; currency: string; description: string };
    threatCheckAI: { price: string; currency: string; description: string };
    communityHealth: { price: string; currency: string; description: string };
  };
  trustTierPricing: {
    threatCheck: { price: string; currency: string; description: string };
    threatCheckAI: { price: string; currency: string; description: string };
    communityHealth: { price: string; currency: string; description: string };
  };
  openServ: {
    configured: boolean;
    capabilities: Array<{
      name: string;
      description: string;
      parameters: Record<string, any>;
      pricing: { amount: string; currency: string; chain: string; protocol: string };
    }>;
  };
  payment: {
    address: string | null;
    currency: string;
    chain: string;
    protocol: string;
  };
  trust: {
    selfProtocol: {
      chain: string;
      description: string;
      verificationHeaders: string[];
    };
  };
  endpoints: {
    identity: string;
    threatCheck: string;
    communityHealth: string;
    walletStatus: string;
    openServInvoke: string;
    openServHealth: string;
    agentCard: string;
  };
  links: {
    website: string;
    telegram: string;
    twitter: string;
  };
}

export async function getAgentIdentity(baseUrl: string): Promise<AgentIdentity> {
  const walletStatus = await getWalletStatus();
  const selfStatus = await getTeliGentSelfStatus();
  const openServStatus = await getOpenServStatus();
  const manifest = getOpenServManifest(baseUrl);

  return {
    name: "TeliGent Master Agent",
    version: "1.2.0",
    description: "Autonomous community protection agent with proof-of-human identity. Provides real-time scam detection, threat intelligence, and community health monitoring for Telegram groups and web platforms. Powered by deterministic pattern matching and AI analysis. Self-verified agents get trust-tier pricing discounts.",
    capabilities: [
      "scam_detection",
      "threat_intelligence",
      "community_health_monitoring",
      "homoglyph_normalization",
      "impersonation_detection",
      "real_time_learning",
      "multi_platform_protection",
      "proof_of_human_verification",
    ],
    chain: "base",
    walletAddress: getLocusWalletAddress() || walletStatus?.ownerAddress || null,
    walletStatus: walletStatus?.walletStatus || null,
    selfVerified: selfStatus.verified,
    selfAgentId: selfStatus.agentId,
    selfChain: selfStatus.chain,
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
    trustTierPricing: {
      threatCheck: {
        price: "0.0005",
        currency: "USDC",
        description: "Trust-tier: 50% discount for Self-verified agents — deterministic scam detection",
      },
      threatCheckAI: {
        price: "0.0025",
        currency: "USDC",
        description: "Trust-tier: 50% discount for Self-verified agents — full AI threat analysis",
      },
      communityHealth: {
        price: "0.001",
        currency: "USDC",
        description: "Trust-tier: 50% discount for Self-verified agents — community health stats",
      },
    },
    openServ: {
      configured: openServStatus.configured,
      capabilities: manifest.capabilities,
    },
    payment: manifest.payment,
    trust: manifest.trust,
    endpoints: {
      identity: `${baseUrl}/api/agent/identity`,
      threatCheck: `${baseUrl}/api/agent/services/threat-check`,
      communityHealth: `${baseUrl}/api/agent/services/community-health`,
      walletStatus: `${baseUrl}/api/agent/wallet/status`,
      openServInvoke: `${baseUrl}/api/agent/openserv/invoke`,
      openServHealth: `${baseUrl}/api/agent/openserv/health`,
      agentCard: `${baseUrl}/.well-known/agent.json`,
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
  selfStatus: {
    configured: boolean;
    verified: boolean;
    agentId: string | null;
    chain: string;
  };
  openServStatus: {
    configured: boolean;
    capabilities: string[];
    totalInvocations: number;
  };
  serviceStats: {
    totalRequests: number;
    totalEarnings: string;
    requestsToday: number;
    verifiedRequests: number;
    unverifiedRequests: number;
  };
}

export async function getAgentDashboard(baseUrl: string): Promise<AgentDashboardData> {
  const identity = await getAgentIdentity(baseUrl);
  const apiKey = getLocusApiKey();
  const selfStatus = await getTeliGentSelfStatus();
  const openServStatus = await getOpenServStatus();
  const { storage } = await import("../storage");

  const stats = await storage.getAgentServiceStats();

  return {
    identity,
    isConfigured: !!apiKey,
    selfStatus,
    openServStatus,
    serviceStats: stats,
  };
}
