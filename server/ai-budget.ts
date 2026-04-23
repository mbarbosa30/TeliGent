import { pool } from "./db";
import { getLimitsForBot } from "./limits";
import { log } from "./index";

const exhaustionLogged = new Set<string>();

type Key = string;

const counts = new Map<Key, number>();
const dirty = new Set<Key>();
let loadedDate: string | null = null;
let loadingPromise: Promise<void> | null = null;

function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function key(botConfigId: number, date: string): Key {
  return `${botConfigId}:${date}`;
}

async function loadTodayIntoMemory(date: string): Promise<void> {
  if (loadedDate === date) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      // Persist any pending writes from a prior date BEFORE wiping the in-memory state,
      // otherwise unsaved counts from yesterday would be dropped at the UTC rollover.
      if (dirty.size > 0) {
        await flushAiUsage();
      }
      const { rows } = await pool.query(
        `SELECT bot_config_id, count FROM ai_usage_daily WHERE usage_date = $1`,
        [date],
      );
      counts.clear();
      dirty.clear();
      exhaustionLogged.clear();
      for (const r of rows) {
        counts.set(key(Number(r.bot_config_id), date), Number(r.count) || 0);
      }
      loadedDate = date;
    } catch (err: any) {
      log(`AI budget load failed: ${err.message}`, "ai-budget");
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

/**
 * Try to consume one AI call from the bot's daily budget.
 * Returns true if the call may proceed, false if the budget is exhausted.
 * On any internal error we fail-open (return true) — the budget is a guardrail,
 * not a security boundary.
 */
export async function tryConsumeAiBudget(botConfigId: number): Promise<boolean> {
  if (!botConfigId || botConfigId <= 0) return true;
  const date = utcDate();
  try {
    if (loadedDate !== date) await loadTodayIntoMemory(date);
    const k = key(botConfigId, date);
    const limit = getLimitsForBot(botConfigId).dailyAiCallsPerBot;
    const current = counts.get(k) || 0;
    if (current >= limit) {
      if (!exhaustionLogged.has(k)) {
        exhaustionLogged.add(k);
        // Best-effort activity log of the first exhaustion per bot per day.
        // Lazy-imported to avoid circular module dependency with storage.
        (async () => {
          try {
            const { storage } = await import("./storage");
            const cfg = await storage.getBotConfig(botConfigId);
            if (cfg?.userId) {
              await storage.createActivityLog(botConfigId, cfg.userId, {
                groupId: null,
                telegramUserId: null,
                type: "ai_budget_exhausted",
                userName: null,
                userMessage: null,
                botResponse: null,
                isReport: false,
                metadata: { date, limit },
              });
            }
          } catch (err: any) {
            log(`AI budget exhaustion activity log failed: ${err.message}`, "ai-budget");
          }
        })();
      }
      return false;
    }
    counts.set(k, current + 1);
    dirty.add(k);
    return true;
  } catch (err: any) {
    log(`AI budget consume failed (fail-open): ${err.message}`, "ai-budget");
    return true;
  }
}

export async function getAiUsageToday(botConfigId: number): Promise<{ count: number; limit: number }> {
  const date = utcDate();
  if (loadedDate !== date) await loadTodayIntoMemory(date);
  return {
    count: counts.get(key(botConfigId, date)) || 0,
    limit: getLimitsForBot(botConfigId).dailyAiCallsPerBot,
  };
}

export async function flushAiUsage(): Promise<void> {
  if (dirty.size === 0) return;
  const snapshot = Array.from(dirty).map(k => {
    const [bc, d] = k.split(":");
    return { key: k, botConfigId: Number(bc), date: d, count: counts.get(k) || 0 };
  });
  dirty.clear();
  for (const row of snapshot) {
    try {
      await pool.query(
        `INSERT INTO ai_usage_daily (bot_config_id, usage_date, count)
         VALUES ($1, $2, $3)
         ON CONFLICT (bot_config_id, usage_date) DO UPDATE SET count = EXCLUDED.count`,
        [row.botConfigId, row.date, row.count],
      );
    } catch (err: any) {
      log(`AI budget flush failed for bot ${row.botConfigId}: ${err.message}`, "ai-budget");
      // Re-mark dirty so the next tick retries persistence.
      dirty.add(row.key);
    }
  }
}

/**
 * Reset the in-memory cache so the next consume reload from DB. Used when
 * the UTC date changes between ticks.
 */
export function maybeRollover(): void {
  const date = utcDate();
  if (loadedDate !== date) {
    counts.clear();
    dirty.clear();
    loadedDate = null;
  }
}
