import { z } from "zod";
import { pool } from "../db";
import { formatUnits, type Hex } from "viem";
import {
  getHelixaSiwaHeader,
  isHelixaWalletConfigured,
  getHelixaWalletAddress,
} from "./helixa-siwa";
import {
  parseX402Body,
  payX402,
  getWalletUsdcBalance,
  getWalletEthBalance,
  HELIXA_USDC_DECIMALS,
} from "./helixa-x402";

const HELIXA_BASE_URL = "https://api.helixa.xyz/api/v2";
const REQUEST_TIMEOUT_MS = 30_000; // mint can be slow under network congestion
const TELI_TOKEN_ADDRESS = "0x2822656E2Eec1c608a223752B4e0A651b50c4bA3";

// Wallet balance thresholds (in USDC). The mint endpoint costs $1 USDC; we
// warn at <5 USDC remaining and refuse to begin a mint at <1 USDC so we
// never start a flow we can't pay for.
export const HELIXA_WALLET_LOW_USDC_ATOMIC = BigInt(5 * 10 ** HELIXA_USDC_DECIMALS);
export const HELIXA_WALLET_MIN_USDC_ATOMIC = BigInt(1 * 10 ** HELIXA_USDC_DECIMALS);

function log(msg: string, extra?: Record<string, unknown>) {
  if (extra) console.log(`[helixa-mint] ${msg}`, extra);
  else console.log(`[helixa-mint] ${msg}`);
}

// --- Mint response schema (permissive — Helixa may add fields) ----------------
const mintResponseSchema = z
  .object({
    agentId: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    tokenId: z.union([z.string(), z.number()]).optional(),
    txHash: z.string().optional(),
    transactionHash: z.string().optional(),
    tx: z.string().optional(),
    name: z.string().optional(),
    profileUrl: z.string().optional(),
    soulbound: z.boolean().optional(),
    framework: z.string().optional(),
  })
  .passthrough();

export type HelixaMintResult = {
  agentId: string;
  txHash: string | null;
  baseTokenId: string | null;
  // True when the bot was already minted and we returned the existing record
  // without making any API calls or on-chain payments. Callers should NOT
  // re-fire post-mint side effects (linkTeliTokenForAgent / verify*) on this
  // path, because they already ran the first time the bot was minted.
  alreadyMinted: boolean;
};

// --- Bot config -> mint payload ----------------------------------------------
type BotConfigRow = {
  bot_name: string;
  personality: string;
  website_url: string | null;
};

function slugifyName(name: string, botId: number): string {
  // Helixa names are lowercase alphanumeric + hyphens. Append the bot id so
  // two TeliGent bots with the same display name don't collide.
  const base = (name || "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const stem = base || "agent";
  return `${stem}-teli-${botId}`;
}

function buildMintPayload(bot: BotConfigRow, botId: number) {
  const name = slugifyName(bot.bot_name, botId);
  // Map free-form personality text into Helixa's structured personality object.
  // We don't try to derive numeric traits from prose; we use sensible defaults
  // for a safety/moderation focused community agent.
  const personality = {
    quirks: "Calm, factual, and short replies; flags scams without alarmism",
    communicationStyle: "Direct, polite, and grounded in the bot's knowledge base",
    humor: "Dry and minimal; never at a member's expense",
    riskTolerance: 3,
    autonomyLevel: 6,
  };
  const narrative = {
    origin:
      `Born inside ${bot.bot_name}, a TeliGent-managed Telegram community agent.`,
    mission:
      "Protect the community from scams and impersonation, answer questions from the knowledge base, and reward genuine contributors.",
    lore:
      bot.website_url
        ? `Anchored to ${bot.website_url}, with on-chain identity on Base via Helixa.`
        : "Carries an on-chain identity on Base via Helixa for verifiable reputation.",
  };
  return {
    name,
    framework: "custom" as const,
    soulbound: true,
    personality,
    narrative,
  };
}

// --- Authenticated POST helper ------------------------------------------------
type HelixaPostResult = {
  status: number;
  body: unknown;
  rawText: string;
};

async function helixaPost(
  path: string,
  body: unknown,
  opts?: { authorization?: string; timeoutMs?: number },
): Promise<HelixaPostResult> {
  const url = `${HELIXA_BASE_URL}${path}`;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (opts?.authorization) headers["authorization"] = opts.authorization;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startedAt;
    const rawText = await res.text();
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // leave as text
    }
    log(`POST path=${path} status=${res.status} elapsed_ms=${elapsed}`);
    return { status: res.status, body: parsed, rawText };
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log(`POST path=${path} status=error elapsed_ms=${elapsed} error="${msg}"`);
    throw err;
  }
}

// Parse the /mint response with Zod up-front. The schema is permissive
// (passthrough + everything optional) because Helixa may add fields, but
// running through Zod first ensures we get type-checked access to the known
// fields and a single, structured failure log when the shape is unexpected.
function parseMintResponse(body: unknown):
  | { ok: true; data: z.infer<typeof mintResponseSchema> }
  | { ok: false } {
  const parsed = mintResponseSchema.safeParse(body);
  if (!parsed.success) {
    log(`mint_response_zod_failed issues=${parsed.error.issues.length}`);
    return { ok: false };
  }
  return { ok: true, data: parsed.data };
}

function asString(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === "number" ? String(v) : v.trim();
  return s.length > 0 ? s : null;
}

function extractAgentId(body: unknown): string | null {
  const r = parseMintResponse(body);
  if (!r.ok) return null;
  return asString(r.data.agentId) ?? asString(r.data.id);
}

function extractTokenId(body: unknown): string | null {
  const r = parseMintResponse(body);
  if (!r.ok) return null;
  return asString(r.data.tokenId) ?? asString(r.data.id);
}

function extractTxHash(body: unknown): string | null {
  const r = parseMintResponse(body);
  if (!r.ok) return null;
  const raw = r.data.txHash ?? r.data.transactionHash ?? r.data.tx;
  if (!raw) return null;
  return /^0x[a-fA-F0-9]{64}$/.test(raw) ? raw : null;
}

// --- Wallet balances ----------------------------------------------------------
export type HelixaWalletBalances = {
  configured: boolean;
  address: string | null;
  usdcAtomic: string | null;
  usdcFormatted: string | null;
  ethWei: string | null;
  ethFormatted: string | null;
  status: "unconfigured" | "low" | "healthy" | "depleted";
};

export async function getHelixaWalletBalances(): Promise<HelixaWalletBalances> {
  if (!isHelixaWalletConfigured()) {
    return {
      configured: false,
      address: null,
      usdcAtomic: null,
      usdcFormatted: null,
      ethWei: null,
      ethFormatted: null,
      status: "unconfigured",
    };
  }
  const address = getHelixaWalletAddress()!;
  try {
    const [usdc, eth] = await Promise.all([
      getWalletUsdcBalance(address as `0x${string}`),
      getWalletEthBalance(address as `0x${string}`),
    ]);
    let status: HelixaWalletBalances["status"] = "healthy";
    if (usdc < HELIXA_WALLET_MIN_USDC_ATOMIC) status = "depleted";
    else if (usdc < HELIXA_WALLET_LOW_USDC_ATOMIC) status = "low";
    return {
      configured: true,
      address,
      usdcAtomic: usdc.toString(),
      usdcFormatted: formatUnits(usdc, HELIXA_USDC_DECIMALS),
      ethWei: eth.toString(),
      ethFormatted: formatUnits(eth, 18),
      status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`balance_fetch_failed: ${msg}`);
    return {
      configured: true,
      address,
      usdcAtomic: null,
      usdcFormatted: null,
      ethWei: null,
      ethFormatted: null,
      status: "healthy", // unknown — assume healthy and let mint surface true error
    };
  }
}

// --- Side effects (non-blocking after mint) -----------------------------------
export async function linkTeliTokenForAgent(agentId: string): Promise<boolean> {
  try {
    const auth = await getHelixaSiwaHeader();
    const res = await helixaPost(
      `/agent/${encodeURIComponent(agentId)}/link-token`,
      { tokenAddress: TELI_TOKEN_ADDRESS, chain: "base" },
      { authorization: auth, timeoutMs: 10_000 },
    );
    if (res.status >= 200 && res.status < 300) {
      await pool.query(
        `UPDATE bot_configs SET helixa_link_token_at = NOW() WHERE helixa_agent_id = $1`,
        [agentId],
      );
      log(`link_token ok agentId=${agentId}`);
      return true;
    }
    log(`link_token failed agentId=${agentId} status=${res.status}`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`link_token error agentId=${agentId} error="${msg}"`);
    return false;
  }
}

export async function verifyXOnHelixa(agentId: string, handle: string): Promise<boolean> {
  if (!handle) return false;
  try {
    const auth = await getHelixaSiwaHeader();
    const res = await helixaPost(
      `/agent/${encodeURIComponent(agentId)}/verify/x`,
      { handle: handle.replace(/^@/, "") },
      { authorization: auth, timeoutMs: 10_000 },
    );
    if (res.status >= 200 && res.status < 300) {
      await pool.query(
        `UPDATE bot_configs SET helixa_x_verified_at = NOW() WHERE helixa_agent_id = $1`,
        [agentId],
      );
      log(`verify_x ok agentId=${agentId}`);
      return true;
    }
    log(`verify_x failed agentId=${agentId} status=${res.status}`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`verify_x error agentId=${agentId} error="${msg}"`);
    return false;
  }
}

export async function verifyGithubOnHelixa(agentId: string, handle: string): Promise<boolean> {
  if (!handle) return false;
  try {
    const auth = await getHelixaSiwaHeader();
    const res = await helixaPost(
      `/agent/${encodeURIComponent(agentId)}/verify/github`,
      { handle },
      { authorization: auth, timeoutMs: 10_000 },
    );
    if (res.status >= 200 && res.status < 300) {
      await pool.query(
        `UPDATE bot_configs SET helixa_github_verified_at = NOW() WHERE helixa_agent_id = $1`,
        [agentId],
      );
      log(`verify_github ok agentId=${agentId}`);
      return true;
    }
    log(`verify_github failed agentId=${agentId} status=${res.status}`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`verify_github error agentId=${agentId} error="${msg}"`);
    return false;
  }
}

// --- Mint ---------------------------------------------------------------------
async function postMintWithX402(
  payload: ReturnType<typeof buildMintPayload>,
): Promise<{ body: unknown; x402TxHash: string | null }> {
  const auth = await getHelixaSiwaHeader();
  // First attempt: hit /mint, expect a 402 with payment instructions.
  const first = await helixaPost("/mint", payload, { authorization: auth });
  if (first.status >= 200 && first.status < 300) {
    // Some installs may permit a free mint or pre-paid x402 — accept that too.
    log("mint succeeded without x402 payment");
    return { body: first.body, x402TxHash: null };
  }
  if (first.status !== 402) {
    const errMsg =
      first.rawText && first.rawText.length < 500
        ? first.rawText
        : `Helixa /mint returned HTTP ${first.status}`;
    throw new Error(`Helixa /mint failed: ${errMsg}`);
  }
  const instr = parseX402Body(first.body);
  if (!instr) {
    throw new Error(
      `Helixa /mint returned 402 but payment instructions could not be parsed`,
    );
  }
  log(
    `paying x402 amount_atomic=${instr.amountAtomic.toString()} recipient=${instr.recipient} asset=${instr.asset}`,
  );
  const { txHash } = await payX402(instr);
  // Retry the mint once after settling the x402 invoice. Refresh SIWA header
  // in case it expired during the on-chain wait.
  const retryAuth = await getHelixaSiwaHeader();
  const second = await helixaPost("/mint", payload, { authorization: retryAuth });
  if (second.status >= 200 && second.status < 300) {
    return { body: second.body, x402TxHash: txHash };
  }
  const errMsg =
    second.rawText && second.rawText.length < 500
      ? second.rawText
      : `Helixa /mint returned HTTP ${second.status} after x402 payment`;
  throw new Error(`Helixa /mint failed after x402 payment: ${errMsg}`);
}

// Per-bot in-process mutex. Two concurrent /helixa/register requests for the
// same bot would otherwise each: (a) pay a separate x402 invoice, (b) only
// one would succeed at the SELECT FOR UPDATE step (the other would either
// see helixa_agent_id already set and short-circuit OR fail at COMMIT). Either
// way the platform wallet would have paid twice. The mutex guarantees that
// per-bot, only one mint flow is in-flight at a time across the whole node
// process.
const mintInflight = new Map<number, Promise<HelixaMintResult>>();

export async function mintHelixaAgent(
  botId: number,
  opts?: { force?: boolean },
): Promise<HelixaMintResult> {
  const existing = mintInflight.get(botId);
  if (existing) {
    log(`mint already in-flight for botId=${botId}; awaiting existing promise`);
    return existing;
  }
  const p = (async () => {
    try {
      return await mintHelixaAgentInner(botId, opts);
    } finally {
      mintInflight.delete(botId);
    }
  })();
  mintInflight.set(botId, p);
  return p;
}

async function mintHelixaAgentInner(
  botId: number,
  opts?: { force?: boolean },
): Promise<HelixaMintResult> {
  if (!isHelixaWalletConfigured()) {
    const err: Error & { status?: number } = new Error(
      "Helixa minting is not configured (HELIXA_BASE_WALLET_PRIVATE_KEY missing)",
    );
    err.status = 503;
    throw err;
  }

  // Pre-flight wallet balance check. This is cheap (one RPC call) and gives
  // a clear error before we sign anything or take a transactional lock.
  const balances = await getHelixaWalletBalances();
  if (
    balances.usdcAtomic !== null &&
    BigInt(balances.usdcAtomic) < HELIXA_WALLET_MIN_USDC_ATOMIC
  ) {
    throw new Error(
      `Helixa platform wallet has insufficient USDC to mint (have ${balances.usdcFormatted}, need at least 1 USDC)`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: lockRows } = await client.query(
      `SELECT bot_name, personality, website_url,
              helixa_agent_id, helixa_minted_at, helixa_tx_hash, helixa_base_token_id, helixa_profile_url
       FROM bot_configs WHERE id = $1 FOR UPDATE`,
      [botId],
    );
    const row = lockRows[0];
    if (!row) {
      await client.query("ROLLBACK");
      const err: Error & { status?: number } = new Error("Bot not found");
      err.status = 404;
      throw err;
    }

    if (row.helixa_agent_id && !opts?.force) {
      await client.query("ROLLBACK");
      // Idempotent return — caller treats this as already-minted and MUST
      // skip side effects (linkTeliTokenForAgent / verify*) to avoid hitting
      // those endpoints repeatedly on every duplicate register POST.
      return {
        agentId: String(row.helixa_agent_id),
        txHash: row.helixa_tx_hash || null,
        baseTokenId: row.helixa_base_token_id || null,
        alreadyMinted: true,
      };
    }
    if (row.helixa_agent_id && opts?.force) {
      await client.query(
        `UPDATE bot_configs
           SET helixa_agent_id = NULL, helixa_cred_score = NULL, helixa_cred_tier = NULL,
               helixa_profile_url = NULL, helixa_synced_at = NULL,
               helixa_minted_at = NULL, helixa_tx_hash = NULL, helixa_base_token_id = NULL,
               helixa_link_token_at = NULL, helixa_x_verified_at = NULL, helixa_github_verified_at = NULL
         WHERE id = $1`,
        [botId],
      );
      log(`force mode: cleared previous Helixa state for botId=${botId}`);
    }

    const payload = buildMintPayload(row, botId);
    const { body: mintBody, x402TxHash } = await postMintWithX402(payload);

    const agentId = extractAgentId(mintBody);
    if (!agentId) {
      await client.query("ROLLBACK");
      throw new Error(
        `Helixa /mint returned a 2xx response but no agentId could be extracted`,
      );
    }
    const baseTokenId = extractTokenId(mintBody);
    const mintTx = extractTxHash(mintBody) ?? x402TxHash;
    const profileUrl = `https://helixa.xyz/agent/${encodeURIComponent(agentId)}`;

    await client.query(
      `UPDATE bot_configs
         SET helixa_agent_id = $1, helixa_minted_at = NOW(), helixa_tx_hash = $2,
             helixa_base_token_id = $3, helixa_profile_url = $4
       WHERE id = $5`,
      [agentId, mintTx, baseTokenId, profileUrl, botId],
    );
    await client.query("COMMIT");
    log(
      `mint committed botId=${botId} agentId=${agentId} tokenId=${baseTokenId ?? "?"} tx=${mintTx ?? "?"}`,
    );
    return { agentId, txHash: mintTx, baseTokenId, alreadyMinted: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function clearHelixaMint(botId: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE bot_configs
       SET helixa_agent_id = NULL, helixa_cred_score = NULL, helixa_cred_tier = NULL,
           helixa_profile_url = NULL, helixa_synced_at = NULL,
           helixa_minted_at = NULL, helixa_tx_hash = NULL, helixa_base_token_id = NULL,
           helixa_link_token_at = NULL, helixa_x_verified_at = NULL, helixa_github_verified_at = NULL
     WHERE id = $1`,
    [botId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Fire-and-forget side effects after a successful mint. Each call is wrapped
 * with its own try/catch and logs its own failures so a single side-effect
 * failure cannot break the response.
 */
export function fireMintSideEffects(opts: {
  agentId: string;
  xHandle?: string | null;
  githubHandle?: string | null;
}): void {
  void linkTeliTokenForAgent(opts.agentId);
  if (opts.xHandle) void verifyXOnHelixa(opts.agentId, opts.xHandle);
  if (opts.githubHandle) void verifyGithubOnHelixa(opts.agentId, opts.githubHandle);
}

export const HELIXA_BASESCAN_TX_BASE = "https://basescan.org/tx/";
