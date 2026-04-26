import { storage } from "../storage";
import { log } from "../index";
import { getTokenPrice as bankrGetTokenPrice } from "../telegram/bankr";

const TELI_TOKEN_ADDRESS = (process.env.TELI_TOKEN_ADDRESS || "0x2822656E2Eec1c608a223752B4e0A651b50c4bA3").toLowerCase();
const TELI_DEXSCREENER_PAIR = (process.env.TELI_DEXSCREENER_PAIR || "0x0d65bab223f60d04fb509046096f14934f0bea2943514b32f131c96a781f380f").toLowerCase();
const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_USD_PER_TELI = 0.10;
const FETCH_TIMEOUT_MS = 7000;

export type PriceSource = "dexscreener" | "bankr" | "manual_override" | "fallback";

export interface TeliPriceQuote {
  usdPerTeli: number;
  source: PriceSource;
  fetchedAt: string;
  manualOverride: boolean;
  liveAvailable: boolean;
}

interface CachedLive {
  usdPerTeli: number;
  source: Exclude<PriceSource, "manual_override" | "fallback">;
  fetchedAt: number;
}

let cached: CachedLive | null = null;
let inflight: Promise<CachedLive | null> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function fetchFromDexScreener(): Promise<number | null> {
  try {
    const res = await withTimeout(fetch(`https://api.dexscreener.com/latest/dex/pairs/base/${TELI_DEXSCREENER_PAIR}`), FETCH_TIMEOUT_MS);
    if (!res.ok) {
      log(`teli-price: DexScreener HTTP ${res.status}`, "billing");
      return null;
    }
    const body = await res.json() as { pair?: { priceUsd?: string }; pairs?: Array<{ priceUsd?: string }> };
    const priceStr = body.pair?.priceUsd ?? body.pairs?.[0]?.priceUsd;
    if (!priceStr) {
      log("teli-price: DexScreener returned no priceUsd", "billing");
      return null;
    }
    const n = parseFloat(priceStr);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`teli-price: DexScreener fetch failed: ${msg}`, "billing");
    return null;
  }
}

function parseUsdFromBankrText(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?(?:e-?\d+)?)/i,
    /([0-9]+(?:\.[0-9]+)?(?:e-?\d+)?)\s*(?:usd|usdc|usdt|dollars?)\b/i,
    /price[^0-9]*([0-9]+(?:\.[0-9]+)?(?:e-?\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function fetchFromBankr(): Promise<number | null> {
  try {
    const text = await withTimeout(bankrGetTokenPrice(`$TELI on Base (contract ${TELI_TOKEN_ADDRESS})`), FETCH_TIMEOUT_MS);
    if (!text) return null;
    const parsed = parseUsdFromBankrText(text);
    if (parsed === null) {
      log(`teli-price: Bankr response could not be parsed for USD price`, "billing");
      return null;
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`teli-price: Bankr fetch failed: ${msg}`, "billing");
    return null;
  }
}

async function fetchLive(): Promise<CachedLive | null> {
  const dex = await fetchFromDexScreener();
  if (dex !== null) {
    return { usdPerTeli: dex, source: "dexscreener", fetchedAt: Date.now() };
  }
  const bankr = await fetchFromBankr();
  if (bankr !== null) {
    return { usdPerTeli: bankr, source: "bankr", fetchedAt: Date.now() };
  }
  return null;
}

async function getCachedLive(force = false): Promise<CachedLive | null> {
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const live = await fetchLive();
      if (live) cached = live;
      return live ?? cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Returns the current $TELI/USD rate for both UI display and intent generation.
 * Resolution order: admin manual override (platform_settings.usd_per_teli) →
 * DexScreener pair price → Bankr parsed price → cached live (even if stale) →
 * hardcoded 0.10 fallback.
 */
export async function getTeliPrice(): Promise<TeliPriceQuote> {
  const override = await storage.getPlatformSetting("usd_per_teli");
  if (override) {
    const n = parseFloat(override);
    if (Number.isFinite(n) && n > 0) {
      return {
        usdPerTeli: n,
        source: "manual_override",
        fetchedAt: new Date().toISOString(),
        manualOverride: true,
        liveAvailable: !!cached,
      };
    }
  }

  const live = await getCachedLive();
  if (live) {
    return {
      usdPerTeli: live.usdPerTeli,
      source: live.source,
      fetchedAt: new Date(live.fetchedAt).toISOString(),
      manualOverride: false,
      liveAvailable: true,
    };
  }

  return {
    usdPerTeli: FALLBACK_USD_PER_TELI,
    source: "fallback",
    fetchedAt: new Date().toISOString(),
    manualOverride: false,
    liveAvailable: false,
  };
}

export function clearTeliPriceCache(): void {
  cached = null;
}
