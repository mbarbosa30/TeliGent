import crypto from "crypto";
import { createPublicClient, http, parseAbiItem, getAddress, isAddress, formatUnits, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { storage } from "../storage";
import { TELI_DISCOUNT_PCT, type PlanTier } from "../limits";
import { getEffectivePlan } from "../limits";
import { getPriceUsd } from "./stripe";
import { getTeliPrice, type TeliPriceQuote } from "./teli-price";
import { log } from "../index";

const USDC_BASE = (process.env.USDC_BASE_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;
const TELI_BASE = (process.env.TELI_TOKEN_ADDRESS || "0x2822656E2Eec1c608a223752B4e0A651b50c4bA3") as `0x${string}`;
const USDC_DECIMALS = 6;
const TELI_DECIMALS = 18;
const INTENT_TTL_MIN = parseInt(process.env.CRYPTO_INTENT_TTL_MIN || "30", 10);
const POLL_BLOCK_LOOKBACK = BigInt(process.env.CRYPTO_POLL_BLOCK_LOOKBACK || "1200"); // ~40min on Base 2s blocks
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
const MANUAL_CLAIM_TOLERANCE_PCT = 0.5;

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

/**
 * Backwards-compatible legacy export used by /api/admin/usd-per-teli.
 * Returns just the numeric rate from the live oracle (or override).
 */
export async function getUsdPerTeli(): Promise<number> {
  const quote = await getTeliPrice();
  return quote.usdPerTeli;
}

export async function getTeliPriceQuote(): Promise<TeliPriceQuote> {
  return getTeliPrice();
}

/**
 * Compute the target token amount as a precise integer (atomic units, e.g. 6dp for USDC).
 * Adds a per-intent micro-suffix so we can match incoming transfers by exact amount.
 */
function uniqueAmount(baseAtomic: bigint, suffix: bigint, _decimals: number): bigint {
  // Use last 6 atomic units as a unique suffix (1..999999) so the collision
  // surface is large enough to make accidental same-amount matches against
  // other concurrent intents extremely unlikely. We also reject historical
  // (pre-intent-creation) matches in the poller as a second layer of defense.
  const cappedSuffix = (suffix % 999999n) + 1n;
  const clean = (baseAtomic / 1000000n) * 1000000n;
  return clean + cappedSuffix;
}

export type CryptoIntentInput = {
  userId: string;
  plan: PlanTier;
  billingPeriod: "monthly" | "annual";
  rail: "usdc" | "teli";
};

export type CryptoQuote = {
  rail: "usdc" | "teli";
  plan: PlanTier;
  billingPeriod: "monthly" | "annual";
  usd: number;
  discountedUsd: number;
  tokenAmount: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenDecimals: number;
  usdPerTeli: number | null;
  source: TeliPriceQuote["source"] | null;
  fetchedAt: string | null;
  liveAvailable: boolean;
};

export async function getCryptoQuote(input: { plan: PlanTier; billingPeriod: "monthly" | "annual"; rail: "usdc" | "teli" }): Promise<CryptoQuote> {
  const usd = getPriceUsd(input.plan, input.billingPeriod);
  if (usd <= 0) throw new Error(`Crypto checkout not available for ${input.plan}.`);
  const discounted = input.rail === "teli" ? usd * (1 - TELI_DISCOUNT_PCT / 100) : usd;

  if (input.rail === "usdc") {
    return {
      rail: "usdc",
      plan: input.plan,
      billingPeriod: input.billingPeriod,
      usd,
      discountedUsd: discounted,
      tokenAmount: discounted.toFixed(2),
      tokenSymbol: "USDC",
      tokenAddress: USDC_BASE,
      tokenDecimals: USDC_DECIMALS,
      usdPerTeli: null,
      source: null,
      fetchedAt: null,
      liveAvailable: true,
    };
  }

  const priceQuote = await getTeliPrice();
  const teliFloat = discounted / priceQuote.usdPerTeli;
  return {
    rail: "teli",
    plan: input.plan,
    billingPeriod: input.billingPeriod,
    usd,
    discountedUsd: discounted,
    tokenAmount: teliFloat.toFixed(2),
    tokenSymbol: "TELI",
    tokenAddress: TELI_BASE,
    tokenDecimals: TELI_DECIMALS,
    usdPerTeli: priceQuote.usdPerTeli,
    source: priceQuote.source,
    fetchedAt: priceQuote.fetchedAt,
    liveAvailable: priceQuote.liveAvailable || priceQuote.manualOverride,
  };
}

export async function createCryptoIntent(input: CryptoIntentInput) {
  const receive = getReceiveAddress();
  if (!receive) throw new Error("Crypto checkout is not configured (missing PLATFORM_RECEIVE_ADDRESS / BASE_WALLET_PRIVATE_KEY).");
  const usd = getPriceUsd(input.plan, input.billingPeriod);
  if (usd <= 0) throw new Error(`Crypto checkout not available for ${input.plan}.`);

  const discounted = input.rail === "teli" ? usd * (1 - TELI_DISCOUNT_PCT / 100) : usd;
  const expiresAt = new Date(Date.now() + INTENT_TTL_MIN * 60 * 1000);
  // Use cryptographically strong randomness so the suffix can't be guessed/
  // collided with prior transfers. Combined with the larger 6-decimal suffix
  // space in uniqueAmount() this drives collision probability ~1 in a million
  // per concurrent intent in the same token.
  const suffix = BigInt("0x" + crypto.randomBytes(8).toString("hex"));

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
    const priceQuote = await getTeliPrice();
    if (!priceQuote.liveAvailable && !priceQuote.manualOverride) {
      throw new Error("Live $TELI/USD rate is unavailable right now. Please retry in a moment or pay with USDC.");
    }
    const teliFloat = discounted / priceQuote.usdPerTeli;
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

export async function listPendingIntentsForUser(userId: string) {
  const all = await storage.listPendingPlanPaymentIntents();
  return all.filter((i) => i.userId === userId).map(formatIntentForDisplay);
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const jitter = 100 + Math.floor(Math.random() * 400);
    log(`crypto poller: ${label} failed, retrying in ${jitter}ms: ${msg}`, "billing");
    await new Promise((r) => setTimeout(r, jitter));
    return fn();
  }
}

/**
 * Scan recent Base blocks for ERC-20 Transfer events to the platform receive
 * address. Match each pending intent by token + exact amount + within window.
 * Activates the matching plan period and updates the user.
 */
export async function pollCryptoIntents(): Promise<{ matched: number; expired: number; pending: number; errors: number }> {
  const receive = getReceiveAddress();
  if (!receive) return { matched: 0, expired: 0, pending: 0, errors: 0 };
  const pending = await storage.listPendingPlanPaymentIntents();
  if (!pending.length) return { matched: 0, expired: 0, pending: 0, errors: 0 };

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
  if (!stillPending.length) return { matched: 0, expired, pending: 0, errors: 0 };

  const tokens = Array.from(new Set(stillPending.map((p) => p.tokenAddress.toLowerCase())));
  let head: bigint;
  try {
    head = await withRetry(() => baseClient.getBlockNumber(), "getBlockNumber");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`crypto poller: getBlockNumber failed after retry: ${msg}`, "billing");
    return { matched: 0, expired, pending: stillPending.length, errors: 1 };
  }
  let matched = 0;
  let errors = 0;

  for (const tokenAddr of tokens) {
    let logs;
    let lookback = POLL_BLOCK_LOOKBACK;
    try {
      logs = await withRetry(async () => {
        const fromBlock = head > lookback ? head - lookback : 0n;
        return baseClient.getLogs({
          address: tokenAddr as `0x${string}`,
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
          args: { to: receive as `0x${string}` },
          fromBlock,
          toBlock: head,
        });
      }, `getLogs ${tokenAddr}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`crypto poller: getLogs ${tokenAddr} failed after retry, doubling lookback for next pass: ${msg}`, "billing");
      // Doubling the lookback on the *next* full cycle would require persistent
      // state, so we instead re-attempt with a wider window inline. Capped at
      // 4x to avoid pathological full-history scans.
      try {
        lookback = POLL_BLOCK_LOOKBACK * 4n;
        const fromBlock = head > lookback ? head - lookback : 0n;
        logs = await baseClient.getLogs({
          address: tokenAddr as `0x${string}`,
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
          args: { to: receive as `0x${string}` },
          fromBlock,
          toBlock: head,
        });
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        log(`crypto poller: getLogs ${tokenAddr} wider retry also failed: ${msg2}`, "billing");
        errors += 1;
        continue;
      }
    }

    // Cache block timestamps so we don't refetch the same block repeatedly.
    const blockTsCache = new Map<bigint, number>();
    const getBlockTs = async (bn: bigint): Promise<number> => {
      const cached = blockTsCache.get(bn);
      if (cached !== undefined) return cached;
      try {
        const blk = await baseClient.getBlock({ blockNumber: bn });
        const ts = Number(blk.timestamp) * 1000;
        blockTsCache.set(bn, ts);
        return ts;
      } catch {
        return 0;
      }
    };

    for (const lg of logs) {
      const value = lg.args.value;
      if (value === undefined) continue;
      const txHash = lg.transactionHash;
      const blockNumber = lg.blockNumber;
      for (const intent of stillPending) {
        if (intent.tokenAddress.toLowerCase() !== tokenAddr) continue;
        if (intent.status !== "pending") continue;
        const expected = BigInt(intent.expectedAmount);
        if (value !== expected) continue;
        if (blockNumber != null) {
          const blockTs = await getBlockTs(blockNumber);
          const intentCreatedTs = new Date(intent.createdAt).getTime();
          if (blockTs > 0 && blockTs < intentCreatedTs) continue;
        }
        const claimed = await activateIntent(intent, txHash || null, "poller");
        if (claimed) {
          intent.status = "matched";
          matched += 1;
        }
        break;
      }
    }
  }

  const stillPendingCount = stillPending.filter((i) => i.status === "pending").length;
  log(`crypto poller cycle: matched=${matched} expired=${expired} pending=${stillPendingCount} errors=${errors}`, "billing");
  return { matched, expired, pending: stillPendingCount, errors };
}

async function activateIntent(intent: any, txHash: string | null, source: "poller" | "manual_claim"): Promise<boolean> {
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
    reason: source === "manual_claim" ? "crypto_payment_manual_claim" : "crypto_payment",
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

function normalizeTxHash(input: string): `0x${string}` | null {
  const trimmed = input.trim().toLowerCase();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-f]{64}$/.test(withPrefix)) return null;
  return withPrefix as `0x${string}`;
}

export type ManualClaimResult =
  | { status: "matched"; intentId: number; txHash: string }
  | { status: "already_matched"; intentId: number; txHash: string | null }
  | { status: "rejected"; reason: string };

/**
 * Manual recovery path: user pasted a transaction hash. Fetch the receipt,
 * verify it transferred the expected token + amount (within tolerance) to
 * the receive address, and that the block was mined after the intent was
 * created. Activates the plan if everything checks out.
 */
export async function claimIntentByTxHash(intent: any, rawTxHash: string): Promise<ManualClaimResult> {
  if (intent.status === "matched") {
    return { status: "already_matched", intentId: intent.id, txHash: intent.txHash ?? null };
  }
  if (intent.status !== "pending") {
    return { status: "rejected", reason: `Intent is ${intent.status} and cannot be claimed.` };
  }
  if (new Date(intent.expiresAt).getTime() < Date.now()) {
    return { status: "rejected", reason: "This payment request has expired. Please generate a new one." };
  }

  const txHash = normalizeTxHash(rawTxHash);
  if (!txHash) return { status: "rejected", reason: "That doesn't look like a valid Base transaction hash." };

  let receipt;
  try {
    receipt = await baseClient.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Manual claim: receipt lookup failed for ${txHash}: ${msg}`, "billing");
    return { status: "rejected", reason: "We couldn't find that transaction on Base yet. Wait ~30s and try again." };
  }
  if (!receipt || receipt.status !== "success") {
    return { status: "rejected", reason: "That transaction did not succeed on Base." };
  }

  let blockTs = 0;
  try {
    const blk = await baseClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTs = Number(blk.timestamp) * 1000;
  } catch {
    // Non-fatal; we still allow the claim if we cannot fetch timestamp,
    // because the receipt verifies the on-chain effect.
  }
  const intentCreatedTs = new Date(intent.createdAt).getTime();
  if (blockTs > 0 && blockTs < intentCreatedTs - 60_000) {
    return { status: "rejected", reason: "This transaction was mined before the payment request was created." };
  }

  // ±0.5% tolerance per the task spec — allows recovery of slightly imprecise
  // transfers (e.g. custodial wallets that take a small fee). The user must
  // own the intent (auth check in the route), the global tx-hash uniqueness
  // index prevents one tx from being credited to multiple intents, and the
  // post-intent timestamp + receiver + token checks below scope the match.
  const expected = BigInt(intent.expectedAmount);
  const tolerance = (expected * BigInt(Math.round(MANUAL_CLAIM_TOLERANCE_PCT * 100))) / 10000n;
  const minAccepted = expected > tolerance ? expected - tolerance : 0n;
  const maxAccepted = expected + tolerance;

  const expectedToken = intent.tokenAddress.toLowerCase();
  const expectedTo = (intent.receiveAddress as string).toLowerCase();

  let totalToReceiver = 0n;
  for (const lg of receipt.logs) {
    if (lg.address.toLowerCase() !== expectedToken) continue;
    if (lg.topics[0] !== TRANSFER_TOPIC) continue;
    try {
      const decoded = decodeEventLog({
        abi: [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")],
        data: lg.data,
        topics: lg.topics,
      });
      const args = decoded.args as { to: string; value: bigint };
      if (args.to.toLowerCase() !== expectedTo) continue;
      totalToReceiver += args.value;
    } catch {
      continue;
    }
  }

  if (totalToReceiver === 0n) {
    return { status: "rejected", reason: "That transaction did not transfer the expected token to our receive address." };
  }
  if (totalToReceiver < minAccepted || totalToReceiver > maxAccepted) {
    const sentDisplay = formatUnits(totalToReceiver, intent.tokenDecimals);
    const expectedDisplay = formatUnits(expected, intent.tokenDecimals);
    return {
      status: "rejected",
      reason: `Amount mismatch: transaction sent ${sentDisplay} ${intent.tokenSymbol}, expected ~${expectedDisplay} ${intent.tokenSymbol} (±${MANUAL_CLAIM_TOLERANCE_PCT}%).`,
    };
  }

  // Replay protection: a single on-chain transfer can only be credited once
  // across the whole platform. Without this, two pending intents with the same
  // expected amount (or any user with a tx in their wallet history that happens
  // to fall within the ±0.5% tolerance window for somebody else's intent)
  // could be credited multiple times.
  const existing = await storage.findMatchedIntentByTxHash(txHash);
  if (existing) {
    if (existing.id === intent.id) {
      return { status: "already_matched", intentId: intent.id, txHash: existing.txHash ?? txHash };
    }
    log(`Manual claim: tx ${txHash} already credited to intent ${existing.id}, rejected for intent ${intent.id}`, "billing");
    return { status: "rejected", reason: "This transaction has already been credited to another payment request." };
  }

  const claimed = await activateIntent(intent, txHash, "manual_claim");
  if (!claimed) {
    // Two failure modes here:
    //   (a) someone else already activated THIS intent (e.g. background poller
    //       beat us to it) — the row is already matched.
    //   (b) the partial unique index on tx_hash WHERE status='matched' fired
    //       because a different intent already credited this same tx hash
    //       (concurrent claim race or replay attempt).
    const fresh = await storage.getPlanPaymentIntent(intent.id);
    if (fresh?.status === "matched") {
      return { status: "already_matched", intentId: intent.id, txHash: fresh.txHash ?? txHash };
    }
    const otherMatched = await storage.findMatchedIntentByTxHash(txHash);
    if (otherMatched && otherMatched.id !== intent.id) {
      log(`Manual claim race: tx ${txHash} already credited to intent ${otherMatched.id}, rejected for intent ${intent.id}`, "billing");
      return { status: "rejected", reason: "This transaction has already been credited to another payment request." };
    }
    return { status: "rejected", reason: "Could not activate plan. Please contact support." };
  }
  return { status: "matched", intentId: intent.id, txHash };
}

export function getUserActivePlan(user: { plan: string | null; planPeriodEnd: Date | null } | null | undefined): PlanTier {
  if (!user) return "free";
  return getEffectivePlan({
    plan: user.plan ?? "free",
    planPeriodEnd: user.planPeriodEnd ?? null,
  });
}
