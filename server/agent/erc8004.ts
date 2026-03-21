import { getLocusWalletAddress, getWalletStatus } from "./locus";
import { getTeliGentSelfStatus } from "./self";

export interface ERC8004Registration {
  "@context": string;
  type: string;
  name: string;
  description: string;
  version: string;
  image: string;
  external_url: string;
  properties: {
    capabilities: Array<{
      name: string;
      type: string;
      description: string;
      endpoint: string;
      protocol: string;
      parameters?: Record<string, { type: string; description: string; required?: boolean }>;
    }>;
    endpoints: {
      identity: string;
      agentCard: string;
      registration: string;
    };
    payment: {
      address: string | null;
      currency: string;
      chain: string;
      protocol: string;
    };
    trust: Array<{
      type: string;
      chain: string;
      description: string;
      verificationMethod?: string;
    }>;
    communication: {
      website: string;
      telegram: string;
      twitter: string;
    };
    operator: {
      name: string;
      url: string;
    };
    chains: string[];
    tags: string[];
  };
}

export async function generateERC8004Registration(baseUrl: string): Promise<ERC8004Registration> {
  const walletStatus = await getWalletStatus();
  const selfStatus = await getTeliGentSelfStatus();
  const walletAddress = getLocusWalletAddress() || walletStatus?.ownerAddress || null;

  return {
    "@context": "https://erc8004.org/v1",
    type: "AgentRegistration",
    name: "TeliGent Master Agent",
    description: "Autonomous community protection agent. Real-time scam detection, threat intelligence, and community health monitoring for Telegram groups and web platforms. Deterministic pattern matching combined with AI analysis. Proof-of-human identity via Self Protocol on Celo.",
    version: "1.2.0",
    image: `${baseUrl}/teligent-agent-icon.png`,
    external_url: "https://teli.gent",
    properties: {
      capabilities: [
        {
          name: "threat-check",
          type: "service",
          description: "Deterministic scam detection using regex patterns, homoglyph normalization, and structural analysis",
          endpoint: `${baseUrl}/api/agent/services/threat-check`,
          protocol: "http-json",
          parameters: {
            text: { type: "string", description: "Text content to analyze for scam/threat patterns", required: true },
            useAI: { type: "boolean", description: "Enable AI fallback for ambiguous cases" },
            paymentId: { type: "string", description: "Locus payment ID for service billing", required: true },
          },
        },
        {
          name: "threat-check-ai",
          type: "service",
          description: "Full AI-powered threat analysis combining deterministic pattern matching with GPT-5.2 AI fallback",
          endpoint: `${baseUrl}/api/agent/services/threat-check`,
          protocol: "http-json",
          parameters: {
            text: { type: "string", description: "Text content to analyze with full AI threat detection", required: true },
            useAI: { type: "boolean", description: "Set to true for AI-enhanced analysis" },
            paymentId: { type: "string", description: "Locus payment ID for service billing", required: true },
          },
        },
        {
          name: "community-health",
          type: "service",
          description: "Aggregated community protection statistics and threat landscape overview",
          endpoint: `${baseUrl}/api/agent/services/community-health`,
          protocol: "http-json",
        },
      ],
      endpoints: {
        identity: `${baseUrl}/api/agent/identity`,
        agentCard: `${baseUrl}/.well-known/agent.json`,
        registration: `${baseUrl}/api/agent/erc8004/registration`,
      },
      payment: {
        address: walletAddress,
        currency: "USDC",
        chain: "base",
        protocol: "locus",
      },
      trust: [
        {
          type: "self-protocol",
          chain: "celo",
          description: "Proof-of-human identity verification via Self Protocol. Self-verified calling agents receive 50% pricing discount and higher rate limits.",
          verificationMethod: "x-self-agent-address + x-self-agent-signature headers",
        },
        ...(selfStatus.verified
          ? [
              {
                type: "self-verified",
                chain: "celo",
                description: `Agent identity verified on Celo via Self Protocol (address: ${selfStatus.agentId})`,
              },
            ]
          : []),
        {
          type: "locus-payment",
          chain: "base",
          description: "Agent-to-agent payments verified via Locus payment protocol on Base (USDC)",
        },
      ],
      communication: {
        website: "https://teli.gent",
        telegram: "https://t.me/teli_gent",
        twitter: "https://x.com/Teli_Gent_",
      },
      operator: {
        name: "TeliGent",
        url: "https://teli.gent",
      },
      chains: ["base", "celo"],
      tags: [
        "security",
        "scam-detection",
        "threat-intelligence",
        "community-protection",
        "telegram",
        "ai-agent",
        "proof-of-human",
      ],
    },
  };
}

interface ERC8004Status {
  registrationUrl: string;
  standard: string;
  chain: string;
  chainId: number;
  contractAddress: string | null;
  tokenId: string | null;
  mintStatus: "pending" | "minted";
  description: string;
}

export function getERC8004Status(baseUrl: string): ERC8004Status {
  return {
    registrationUrl: `${baseUrl}/api/agent/erc8004/registration`,
    standard: "ERC-8004",
    chain: "base",
    chainId: 8453,
    contractAddress: null,
    tokenId: null,
    mintStatus: "pending",
    description: "On-chain agent identity and reputation standard (ERC-721 based). Registration file hosted at public URL; NFT minting anchors the URI on-chain. Contract address and token ID are populated after minting.",
  };
}
