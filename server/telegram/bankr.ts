import { log } from "../index";

const BANKR_API_BASE = "https://api.bankr.bot";
const BANKR_POLL_INTERVAL = 2000;
const BANKR_TIMEOUT = 15000;
const BANKR_FETCH_TIMEOUT = 8000;

function getApiKey(botApiKey?: string | null): string | null {
  return botApiKey?.trim() || process.env.BANKR_API_KEY || null;
}

interface BankrJobResult {
  status: "completed" | "failed" | "cancelled" | "pending" | "running";
  response?: string;
  error?: string;
}

function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function submitAndPoll(prompt: string, apiKey: string): Promise<string> {
  const submitRes = await fetchWithTimeout(
    `${BANKR_API_BASE}/agent/prompt`,
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    },
    BANKR_FETCH_TIMEOUT
  );

  if (submitRes.status === 401 || submitRes.status === 403) {
    throw new Error("Bankr API authentication failed — check API key");
  }
  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`Bankr API error ${submitRes.status}: ${errText}`);
  }

  const { jobId } = await submitRes.json() as { jobId: string };
  if (!jobId) throw new Error("Bankr API returned no jobId");

  const deadline = Date.now() + BANKR_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, BANKR_POLL_INTERVAL));

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(
        `${BANKR_API_BASE}/agent/job/${jobId}`,
        { headers: { "X-API-Key": apiKey } },
        BANKR_FETCH_TIMEOUT
      );
    } catch (fetchErr: any) {
      log(`Bankr poll fetch error: ${fetchErr.message}`, "telegram");
      continue;
    }

    if (pollRes.status === 401 || pollRes.status === 403) {
      throw new Error("Bankr API authentication failed — check API key");
    }
    if (!pollRes.ok) continue;

    const result = (await pollRes.json()) as BankrJobResult;
    if (result.status === "completed" && result.response) {
      return result.response;
    }
    if (result.status === "failed" || result.status === "cancelled") {
      throw new Error(result.error || `Bankr job ${result.status}`);
    }
  }

  throw new Error("Bankr API timeout — no response within 15s");
}

export async function queryBankr(prompt: string, botApiKey?: string | null): Promise<string | null> {
  const apiKey = getApiKey(botApiKey);
  if (!apiKey) {
    log("Bankr: no API key configured", "telegram");
    return null;
  }

  try {
    const response = await submitAndPoll(prompt, apiKey);
    return response;
  } catch (err: any) {
    log(`Bankr query error: ${err.message}`, "telegram");
    return null;
  }
}

export async function getTokenPrice(tokenQuery: string, botApiKey?: string | null): Promise<string | null> {
  const prompt = `What is the current price of ${tokenQuery}? Give me the price, 24h change, and market cap if available. Be concise.`;
  return queryBankr(prompt, botApiKey);
}

const CRYPTO_PATTERN = /\b(price|chart|market\s*cap|mcap|volume|trading|swap|buy|sell|token|coin|airdrop|dex|liquidity|pool|staking|yield|farm|bridge|wallet|balance|portfolio|nft|mint)\b|\$[A-Z]{2,10}\b|0x[a-fA-F0-9]{40}/i;

export function isCryptoQuery(text: string): boolean {
  return CRYPTO_PATTERN.test(text);
}
