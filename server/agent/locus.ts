import { log } from "../index";

const LOCUS_BASE_URL = "https://beta-api.paywithlocus.com/api";

interface LocusRegistrationResponse {
  success: boolean;
  data: {
    apiKey: string;
    apiKeyPrefix: string;
    ownerPrivateKey: string;
    ownerAddress: string;
    walletId: string;
    walletStatus: string;
    statusUrl: string;
    claimUrl: string;
    skillFileUrl: string;
    defaults: {
      allowanceUsdc: string;
      maxAllowedTxnSizeUsdc: string;
      chain: string;
    };
  };
}

interface LocusStatusResponse {
  success: boolean;
  data: {
    walletId: string;
    walletStatus: string;
    ownerAddress: string;
    chain: string;
    allowanceUsdc: string;
    maxAllowedTxnSizeUsdc: string;
  };
}

let cachedStatus: { data: LocusStatusResponse["data"]; fetchedAt: number } | null = null;
const STATUS_CACHE_MS = 60_000;

export function getLocusApiKey(): string | null {
  return process.env.LOCUS_API_KEY || null;
}

export function getLocusWalletAddress(): string | null {
  return process.env.LOCUS_WALLET_ADDRESS || null;
}

export async function registerAgent(name: string): Promise<LocusRegistrationResponse> {
  const res = await fetch(`${LOCUS_BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Locus registration failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getWalletStatus(): Promise<LocusStatusResponse["data"] | null> {
  const apiKey = getLocusApiKey();
  if (!apiKey) return null;

  if (cachedStatus && Date.now() - cachedStatus.fetchedAt < STATUS_CACHE_MS) {
    return cachedStatus.data;
  }

  try {
    const res = await fetch(`${LOCUS_BASE_URL}/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      log(`Locus status check failed: ${res.status}`, "agent");
      return null;
    }
    const json: LocusStatusResponse = await res.json();
    cachedStatus = { data: json.data, fetchedAt: Date.now() };
    return json.data;
  } catch (err: any) {
    log(`Locus status error: ${err.message}`, "agent");
    return null;
  }
}

export async function verifyLocusPayment(paymentId: string): Promise<{ verified: boolean; amount?: string }> {
  const apiKey = getLocusApiKey();
  if (!apiKey) return { verified: false };

  try {
    const res = await fetch(`${LOCUS_BASE_URL}/checkout/verify/${paymentId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { verified: false };
    const json = await res.json();
    return { verified: json.success === true, amount: json.data?.amountUsdc };
  } catch {
    return { verified: false };
  }
}

export function clearStatusCache(): void {
  cachedStatus = null;
}
