import { z } from "zod";

const BASE_URL = "https://api.helixa.xyz/api/v2";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RETRIES = 1;
const STATS_CACHE_TTL_MS = 10 * 60 * 1000;

const networkStatsRawSchema = z
  .object({
    totalAgents: z.number().int().nonnegative().optional(),
    totalCredScore: z.number().optional(),
    soulboundCount: z.number().optional(),
    totalHumans: z.number().optional(),
    totalOrganizations: z.number().optional(),
    mintPrice: z.union([z.string(), z.number()]).optional(),
    mintPriceUsdc: z.union([z.string(), z.number()]).optional(),
    frameworks: z.union([z.array(z.string()), z.number()]).optional(),
    network: z.string().optional(),
    chain: z.string().optional(),
    chainId: z.number().optional(),
    contract: z.string().optional(),
    contractDeployed: z.boolean().optional(),
    registry: z.string().optional(),
  })
  .passthrough();

export type HelixaNetworkStats = {
  totalAgents: number | null;
  totalCredScore: number | null;
  mintPrice: string | null;
  mintPriceUsdc: string | null;
  frameworksCount: number | null;
  frameworks: string[] | null;
  chain: string;
  chainId: number | null;
  contract: string | null;
  registry: string;
  soulboundCount: number | null;
};

const credSchema = z
  .object({
    score: z.union([z.number(), z.string()]).optional(),
    credScore: z.union([z.number(), z.string()]).optional(),
    tier: z.string().optional(),
    credTier: z.string().optional(),
    scale: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .partial()
      .optional(),
    breakdown: z.record(z.unknown()).optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type HelixaCred = {
  score: number | null;
  tier: string | null;
  raw: z.infer<typeof credSchema>;
};

const agentProfileSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    framework: z.string().optional(),
    address: z.string().optional(),
    walletAddress: z.string().optional(),
    profileUrl: z.string().url().optional(),
    chain: z.string().optional(),
  })
  .passthrough();

export type HelixaAgentProfile = z.infer<typeof agentProfileSchema>;

const nameAvailabilitySchema = z
  .object({
    name: z.string().optional(),
    available: z.boolean().optional(),
    owner: z.string().optional(),
    agentId: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type HelixaNameAvailability = z.infer<typeof nameAvailabilitySchema>;

let networkStatsCache: { ts: number; data: HelixaNetworkStats } | null = null;

function log(msg: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[helixa] ${msg}`, extra);
  } else {
    console.log(`[helixa] ${msg}`);
  }
}

async function helixaFetch(path: string): Promise<unknown | null> {
  const url = `${BASE_URL}${path}`;
  // Per spec: a single retry on 5xx only. Do not retry on thrown
  // errors (timeout, network, abort) — fail fast and let the caller
  // fall back to cached data.
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startedAt;
      if (res.status === 404) {
        log(`fetch path=${path} status=404 elapsed_ms=${elapsed} attempt=${attempt + 1}`);
        return null;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        const backoff = 300 + Math.floor(Math.random() * 200);
        log(
          `fetch path=${path} status=${res.status} elapsed_ms=${elapsed} attempt=${attempt + 1} retry_in_ms=${backoff}`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok) {
        log(
          `fetch path=${path} status=${res.status} elapsed_ms=${elapsed} attempt=${attempt + 1} giving_up=true`,
        );
        return null;
      }
      const json = await res.json();
      log(`fetch path=${path} status=${res.status} elapsed_ms=${elapsed} attempt=${attempt + 1}`);
      return json;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `fetch path=${path} status=error elapsed_ms=${elapsed} attempt=${attempt + 1} error="${msg}" giving_up=true`,
      );
      return null;
    }
  }
  return null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const HELIXA_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export async function getNetworkStats(opts?: { forceFresh?: boolean }): Promise<HelixaNetworkStats | null> {
  const now = Date.now();
  if (!opts?.forceFresh && networkStatsCache && now - networkStatsCache.ts < STATS_CACHE_TTL_MS) {
    return networkStatsCache.data;
  }
  const json = await helixaFetch("/stats");
  if (!json) return networkStatsCache?.data ?? null;
  const parsed = networkStatsRawSchema.safeParse(json);
  if (!parsed.success) {
    log("stats parse_failed", { issues: parsed.error.issues.length });
    return networkStatsCache?.data ?? null;
  }
  const raw = parsed.data;
  const frameworksArray = Array.isArray(raw.frameworks) ? raw.frameworks : null;
  const frameworksCount = typeof raw.frameworks === "number"
    ? raw.frameworks
    : frameworksArray
    ? frameworksArray.length
    : null;
  const data: HelixaNetworkStats = {
    totalAgents: typeof raw.totalAgents === "number" ? raw.totalAgents : null,
    totalCredScore: typeof raw.totalCredScore === "number" ? raw.totalCredScore : null,
    mintPrice: toStringOrNull(raw.mintPrice),
    mintPriceUsdc: toStringOrNull(raw.mintPriceUsdc),
    frameworksCount,
    frameworks: frameworksArray,
    chain: (raw.network || raw.chain || "Base").toString(),
    chainId: typeof raw.chainId === "number" ? raw.chainId : null,
    contract: raw.contract || null,
    registry: raw.registry || HELIXA_REGISTRY,
    soulboundCount: typeof raw.soulboundCount === "number" ? raw.soulboundCount : null,
  };
  networkStatsCache = { ts: now, data };
  return data;
}

export async function getAgentCred(agentId: string): Promise<HelixaCred | null> {
  const json = await helixaFetch(`/agent/${encodeURIComponent(agentId)}/cred`);
  if (!json) return null;
  const parsed = credSchema.safeParse(json);
  if (!parsed.success) {
    log("cred parse_failed", { agentId, issues: parsed.error.issues.length });
    return null;
  }
  const data = parsed.data;
  const score = toNumberOrNull(data.score ?? data.credScore);
  const tier = data.tier ?? data.credTier ?? null;
  return { score, tier, raw: data };
}

export async function getAgentProfile(agentId: string): Promise<HelixaAgentProfile | null> {
  const json = await helixaFetch(`/agent/${encodeURIComponent(agentId)}`);
  if (!json) return null;
  const parsed = agentProfileSchema.safeParse(json);
  if (!parsed.success) {
    log("profile parse_failed", { agentId, issues: parsed.error.issues.length });
    return null;
  }
  return parsed.data;
}

const searchResultSchema = z
  .object({
    results: z.array(z.unknown()).optional(),
    agents: z.array(z.unknown()).optional(),
    total: z.number().optional(),
    count: z.number().optional(),
  })
  .passthrough();

export type HelixaSearchParams = {
  q?: string;
  minCred?: number;
  tier?: "JUNK" | "MARGINAL" | "QUALIFIED" | "PRIME" | "PREFERRED";
  verified?: boolean;
  capability?: string;
  limit?: number;
};

export type HelixaSearchResult = z.infer<typeof searchResultSchema>;

export async function searchAgents(params: HelixaSearchParams): Promise<HelixaSearchResult | null> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (typeof params.minCred === "number") qs.set("minCred", String(params.minCred));
  if (params.tier) qs.set("tier", params.tier);
  if (typeof params.verified === "boolean") qs.set("verified", String(params.verified));
  if (params.capability) qs.set("capability", params.capability);
  if (typeof params.limit === "number") {
    const lim = Math.max(1, Math.min(50, Math.floor(params.limit)));
    qs.set("limit", String(lim));
  }
  const path = qs.toString() ? `/search?${qs.toString()}` : `/search`;
  const json = await helixaFetch(path);
  if (!json) return null;
  const parsed = searchResultSchema.safeParse(json);
  if (!parsed.success) {
    log("search parse_failed", { issues: parsed.error.issues.length });
    return null;
  }
  return parsed.data;
}

export async function checkNameAvailability(name: string): Promise<HelixaNameAvailability | null> {
  const trimmed = name.trim().toLowerCase().replace(/^@/, "").replace(/\.agent$/, "");
  if (!trimmed) return null;
  const json = await helixaFetch(`/name/${encodeURIComponent(trimmed)}`);
  if (!json) return null;
  const parsed = nameAvailabilitySchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

export function buildHelixaProfileUrl(agentId: string): string {
  return `https://helixa.xyz/agent/${encodeURIComponent(agentId)}`;
}
