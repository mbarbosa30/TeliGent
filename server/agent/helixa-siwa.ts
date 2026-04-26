import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPublicClient, http, getAddress, type Hex } from "viem";
import { base } from "viem/chains";

// SIWA = "Sign-In With Agent" — Helixa's wallet-signed bearer auth scheme.
// The exact message body is dictated by Helixa's API docs:
//   "Sign-In With Agent: api.helixa.xyz wants you to sign in with your wallet
//    {address} at {timestamp}"
// Header: Authorization: Bearer {address}:{timestamp}:{signature}
// Helixa expires signatures after 1 hour; we cache for 50 minutes to leave
// a safety buffer for slow round-trips.

const SIWA_TTL_MS = 50 * 60 * 1000;
const HELIXA_DOMAIN = "api.helixa.xyz";

function buildSiwaMessage(address: string, timestamp: number): string {
  return `Sign-In With Agent: ${HELIXA_DOMAIN} wants you to sign in with your wallet ${address} at ${timestamp}`;
}

function log(msg: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[helixa-siwa] ${msg}`, extra);
  } else {
    console.log(`[helixa-siwa] ${msg}`);
  }
}

let cachedHeader: { value: string; expiresAt: number } | null = null;
let cachedAccount: PrivateKeyAccount | null = null;
let cachedAddress: string | null = null;

function getAccount(): PrivateKeyAccount | null {
  const pk = process.env.HELIXA_BASE_WALLET_PRIVATE_KEY;
  if (!pk) return null;
  if (cachedAccount) return cachedAccount;
  try {
    const formatted = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
    cachedAccount = privateKeyToAccount(formatted);
    cachedAddress = getAddress(cachedAccount.address);
    return cachedAccount;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`failed to derive Helixa wallet from private key: ${msg}`);
    return null;
  }
}

export function isHelixaWalletConfigured(): boolean {
  return !!getAccount();
}

export function getHelixaWalletAddress(): string | null {
  const acct = getAccount();
  if (!acct) return null;
  return cachedAddress;
}

/**
 * Returns a SIWA Bearer header for use against authenticated Helixa endpoints.
 * Throws when the wallet env var is missing — callers must check
 * isHelixaWalletConfigured() first and translate to a 503.
 */
export async function getHelixaSiwaHeader(): Promise<string> {
  const acct = getAccount();
  if (!acct || !cachedAddress) {
    throw new Error("HELIXA_BASE_WALLET_PRIVATE_KEY is not configured");
  }
  const now = Date.now();
  if (cachedHeader && cachedHeader.expiresAt > now) {
    return cachedHeader.value;
  }
  const timestamp = Math.floor(now / 1000);
  const message = buildSiwaMessage(cachedAddress, timestamp);
  const signature = await acct.signMessage({ message });
  const value = `Bearer ${cachedAddress}:${timestamp}:${signature}`;
  cachedHeader = { value, expiresAt: now + SIWA_TTL_MS };
  log(`signed new SIWA header address=${cachedAddress} ts=${timestamp} ttl_min=${Math.round(SIWA_TTL_MS / 60000)}`);
  return value;
}

export function clearHelixaSiwaCache(): void {
  cachedHeader = null;
}

// Derive the cached client's type from a Base-specific factory. Annotating
// with viem's exported PublicClient generic — or even ReturnType<typeof
// createPublicClient> — causes a type-collision because the unparameterized
// return doesn't know about Base's "deposit" transaction variant on getBlock.
const makeBaseClient = () =>
  createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
type BaseClient = ReturnType<typeof makeBaseClient>;
let publicClient: BaseClient | null = null;
export function getBaseClient(): BaseClient {
  if (publicClient) return publicClient;
  publicClient = makeBaseClient();
  return publicClient;
}
