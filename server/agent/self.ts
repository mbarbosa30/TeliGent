import { log } from "../index";

const SELF_CHAIN = "celo";

let cachedSelfStatus: { verified: boolean; agentId: string | null; fetchedAt: number } | null = null;
const SELF_STATUS_CACHE_MS = 300_000;

export function getSelfAgentPrivateKey(): string | null {
  return process.env.SELF_AGENT_PRIVATE_KEY || null;
}

export function isSelfConfigured(): boolean {
  return !!getSelfAgentPrivateKey();
}

export async function getTeliGentSelfStatus(): Promise<{
  configured: boolean;
  verified: boolean;
  agentId: string | null;
  chain: string;
}> {
  const privateKey = getSelfAgentPrivateKey();
  if (!privateKey) {
    return { configured: false, verified: false, agentId: null, chain: SELF_CHAIN };
  }

  if (cachedSelfStatus && Date.now() - cachedSelfStatus.fetchedAt < SELF_STATUS_CACHE_MS) {
    return {
      configured: true,
      verified: cachedSelfStatus.verified,
      agentId: cachedSelfStatus.agentId,
      chain: SELF_CHAIN,
    };
  }

  try {
    const { SelfAgent } = await import("@selfxyz/agent-sdk");
    const agent = new SelfAgent({ privateKey });
    const registered = await agent.isRegistered();

    cachedSelfStatus = {
      verified: registered,
      agentId: registered ? agent.address : null,
      fetchedAt: Date.now(),
    };

    return {
      configured: true,
      verified: registered,
      agentId: cachedSelfStatus.agentId,
      chain: SELF_CHAIN,
    };
  } catch (err: any) {
    log(`Self status check error: ${err.message}`, "agent");
    return { configured: true, verified: false, agentId: null, chain: SELF_CHAIN };
  }
}

let verifierInstance: any = null;

async function getVerifier() {
  if (verifierInstance) return verifierInstance;

  try {
    const { SelfAgentVerifier } = await import("@selfxyz/agent-sdk");
    verifierInstance = SelfAgentVerifier.create().build();
    return verifierInstance;
  } catch (err: any) {
    log(`Failed to create SelfAgentVerifier: ${err.message}`, "agent");
    return null;
  }
}

export interface SelfVerificationResult {
  verified: boolean;
  agentAddress: string | null;
  agentId: string | null;
}

export async function verifySelfRequestHeaders(req: {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  rawBody?: string;
  body?: any;
}): Promise<SelfVerificationResult> {
  const signature = req.headers["x-self-agent-signature"];
  const address = req.headers["x-self-agent-address"];
  const timestamp = req.headers["x-self-agent-timestamp"];

  if (!signature || !address || !timestamp) {
    return { verified: false, agentAddress: null, agentId: null };
  }

  try {
    const verifier = await getVerifier();
    if (!verifier) {
      return { verified: false, agentAddress: null, agentId: null };
    }

    const result = await new Promise<SelfVerificationResult>((resolve) => {
      const mockReq = {
        headers: req.headers,
        method: req.method,
        url: req.url,
        rawBody: req.rawBody || (req.body ? JSON.stringify(req.body) : ""),
        agent: null as any,
      };

      const mockRes = {
        status: (code: number) => ({
          json: (_payload: any) => {
            resolve({ verified: false, agentAddress: String(address), agentId: null });
          },
        }),
      };

      const mockNext = () => {
        const agent = (mockReq as any).agent;
        resolve({
          verified: true,
          agentAddress: agent?.address || String(address),
          agentId: agent?.agentId ? String(agent.agentId) : null,
        });
      };

      const authMiddleware = verifier.auth();
      authMiddleware(mockReq, mockRes, mockNext);
    });

    return result;
  } catch (err: any) {
    log(`Self verification error: ${err.message}`, "agent");
    return { verified: false, agentAddress: String(address), agentId: null };
  }
}

export function clearSelfStatusCache(): void {
  cachedSelfStatus = null;
}
