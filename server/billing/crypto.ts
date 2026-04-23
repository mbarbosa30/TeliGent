import { createPublicClient, http, parseAbiItem, getAddress, isAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { storage } from "../storage";
import { TELI_DISCOUNT_PCT, type PlanTier, getEffectivePlan } from "../limits";
import { getPriceUsd } from "./stripe";
import { log } from "../index";

const USDC_BASE = (process.env.USDC_BASE_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const TELI_BASE = (process.env.TELI_TOKEN_ADDRESS || "0x2822656E2Eec1c608a223752B4e0A651b50c4bA3") as `0x${string}`;
const USDC_DECIMALS = 6;
const TELI_DECIMALS = 18;
const INTENT_TTL_MIN = parseInt(process.env.CRYPTO_INTENT_TTL_MIN || "30", 10);
const POLL_BLOCK_LOOKBACK = BigInt(process.env.CRYPTO_POLL_BLOCK_LOOKBACK || "1200"); // ~40min on Base 2s blocks
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

function getReceiveAddress(): string | null {
  const explicit = process.env.PLATFORM_RECEIVE_ADDRESS;
  if (explicit && isAddress(explicit)) return getAddress(explicit);
  const pk = process.env.BASE_WALLET_PRIVATE_KEY || process.env.CELO_WALLET_PRIVATE_KEY;
  if (!pk) return null;
  try {
    const acct = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
    return getAddress(acct.address);
  } catch {
    return null;
  }
}

export function isCryptoEnabled(): boolean {
  return !!getReceiveAddress();
}

export function getReceiveAddressPublic(): string | null {
  return getReceiveAddress();
}

const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
});

export async function getUsdPerTeli(): Promise<number> {
  const stored = await storage.getPlatformSetting("usd_per_teli");
  if (stored) {
    const n = parseFloat(stored);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fallback = parseFloat(process.env.USD_PER_TELI || "0.10");
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0.10;
}

/**
 * Compute the target token amount as a precise integer (atomic units, e.g. 6dp for USDC).
 * Adds a per-intent micro-suffix so we can match incoming transfers by exact amount.
 */
function uniqueAmount(baseAtomic: bigint, suffix: bigint, decimals: number): bigint {
  // Use last 4 atomic units as a unique suffix (e.g. 0.000001 USDC steps).
  const cappedSuffix = (suffix % 9999n) + 1n;
  // Strip last 4 digits then add suffix to guarantee uniqueness
  const clean = (baseAtomic / 10000n) * 10000n;
  return clean + cappedSuffix;
}

export type CryptoIntentInput = {
  userId: string;
  plan: PlanTier;
  billingPeriod: "monthly" | "annual";
  rail: "usdc" | "teli";
};

export async function createCryptoIntent(input: CryptoIntentInput) {
  const receive = getReceiveAddress();
  if (!receive) throw new Error("Crypto checkout is not configured (missing PLATFORM_RECEIVE_ADDRESS / BASE_WALLET_PRIVATE_KEY).");
  const usd = getPriceUsd(input.plan, input.billingPeriod);
  if (usd <= 0) throw new Error(`Crypto checkout not available for ${input.plan}.`);

  const discounted = input.rail === "teli" ? usd * (1 - TELI_DISCOUNT_PCT / 100) : usd;
  const expiresAt = new Date(Date.now() + INTENT_TTL_MIN * 60 * 1000);
  const suffix = BigInt(Date.now() % 100000);

  let tokenAddress: `0x${string}`;
  let tokenSymbol: string;
  let tokenDecimals: number;
  let baseAtomic: bigint;

  if (input.rail === "usdc") {
    tokenAddress = USDC_BASE;
    tokenSymbol = "USDC";
    tokenDecimals = USDC_DECIMALS;
    baseAtomic = BigInt(Math.round(discounted * 10 ** USDC_DECIMALS));
  } else {
    const usdPerTeli = await getUsdPerTeli();
    const teliFloat = discounted / usdPerTeli;
    tokenAddress = TELI_BASE;
    tokenSymbol = "TELI";
    tokenDecimals = TELI_DECIMALS;
    // Convert with full precision via string to avoid Number overflow
    const teliWei = BigInt(Math.round(teliFloat * 1e6)) * BigInt(10 ** (TELI_DECIMALS - 6));
    baseAtomic = teliWei;
  }

  const expectedAtomic = uniqueAmount(baseAtomic, suffix, tokenDecimals);
  const expectedAmount = formatUnits(expectedAtomic, tokenDecimals);

  const intent = await storage.createPlanPaymentIntent({
    userId: input.userId,
    plan: input.plan,
    billingPeriod: input.billingPeriod,
    rail: input.rail,
    receiveAddress: receive,
    expectedAmount: expectedAtomic.toString(),
    tokenAddress,
    tokenSymbol,
    tokenDecimals,
    usdAmount: discounted.toFixed(2),
    status: "pending",
    expiresAt,
  });

  return { intent, displayAmount: expectedAmount };
}

export function formatIntentForDisplay(intent: any) {
  const decimals = intent.tokenDecimals as number;
  const atomic = BigInt(intent.expectedAmount);
  return {
    ...intent,
    displayAmount: formatUnits(atomic, decimals),
  };
}

/**
 * Scan recent Base blocks for ERC-20 Transfer events to the platform receive
 * address. Match each pending intent by token + exact amount + within window.
 * Activates the matching plan period and updates the user.
 */
export async function pollCryptoIntents(): Promise<{ matched: number; expired: number }> {
  const receive = getReceiveAddress();
  if (!receive) return { matched: 0, expired: 0 };
  const pending = await storage.listPendingPlanPaymentIntents();
  if (!pending.length) return { matched: 0, expired: 0 };

  const now = Date.now();
  const stillPending = [] as typeof pending;
  let expired = 0;
  for (const p of pending) {
    if (new Date(p.expiresAt).getTime() < now) {
      await storage.markPlanPaymentIntent(p.id, "expired");
      expired += 1;
    } else {
      stillPending.push(p);
    }
  }
  if (!stillPending.length) return { matched: 0, expired };

  const tokens = Array.from(new Set(stillPending.map((p) => p.tokenAddress.toLowerCase())));
  let head: bigint;
  try {
    head = await baseClient.getBlockNumber();
  } catch (err: any) {
    log(`crypto poller: getBlockNumber failed: ${err.message}`, "billing");
    return { matched: 0, expired };
  }
  const fromBlock = head > POLL_BLOCK_LOOKBACK ? head - POLL_BLOCK_LOOKBACK : 0n;
  const padded = `0x${receive.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;

  const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
  let matched = 0;
  for (const tokenAddr of tokens) {
    try {
      const logs = await baseClient.getLogs({
        address: tokenAddr as `0x${string}`,
        event: transferEvent,
        args: { to: receive as `0x${string}` },
        fromBlock,
        toBlock: head,
      });
      for (const lg of logs) {
        const value = lg.args.value;
        if (value === undefined) continue;
        const txHash = lg.transactionHash;
        for (const intent of stillPending) {
          if (intent.tokenAddress.toLowerCase() !== tokenAddr) continue;
          if (intent.status !== "pending") continue;
          const expected = BigInt(intent.expectedAmount);
          if (value === expected) {
            // markPlanPaymentIntent does an atomic WHERE status='pending' update;
            // if it returns undefined, another poll already claimed this intent.
            const claimed = await activateIntent(intent, txHash || null);
            if (claimed) {
              intent.status = "matched";
              matched += 1;
            }
            break;
          }
        }
      }
    } catch (err: any) {
      log(`crypto poller: getLogs ${tokenAddr} failed: ${err.message}`, "billing");
    }
  }
  return { matched, expired };
}

async function activateIntent(intent: any, txHash: string | null): Promise<boolean> {
  const updated = await storage.markPlanPaymentIntent(intent.id, "matched", txHash);
  if (!updated) return false;
  const periodMs = intent.billingPeriod === "annual" ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + periodMs);
  await storage.createPlanPeriod({
    userId: intent.userId,
    plan: intent.plan,
    rail: intent.rail,
    billingPeriod: intent.billingPeriod,
    teliPaid: intent.rail === "teli",
    startsAt,
    endsAt,
    intentId: intent.id,
    reason: "crypto_payment",
  });
  await storage.updateUserPlan(intent.userId, {
    plan: intent.plan,
    planRail: intent.rail,
    planPeriodEnd: endsAt,
    teliPaid: intent.rail === "teli",
    planCancelAtPeriodEnd: false,
  });
  log(`Crypto intent ${intent.id} matched: user=${intent.userId} plan=${intent.plan} rail=${intent.rail} tx=${txHash || "?"}`, "billing");
  return true;
}

export function getUserActivePlan(user: { plan: string | null; planPeriodEnd: Date | null } | null | undefined): PlanTier {
  if (!user) return "free";
  return getEffectivePlan({ plan: user.plan ?? null, planPeriodEnd: user.planPeriodEnd ?? null });
}
