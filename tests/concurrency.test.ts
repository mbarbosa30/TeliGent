// Concurrency race verification for Task #71 atomicity guarantees.
//
// Run with:  tsx tests/concurrency.test.ts
//
// Exits 0 only when every race serialized to exactly one winner. A
// non-zero exit means an atomicity guarantee regressed.

import { pool, db } from "../server/db";
import { storage } from "../server/storage";
import { sql } from "drizzle-orm";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

async function makeUser(): Promise<string> {
  const email = `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const r = await db.execute(sql`
    INSERT INTO users (email, password_hash, email_verified, plan, plan_rail)
    VALUES (${email}, 'x', true, 'free', 'none') RETURNING id
  `);
  return (r.rows[0] as any).id as string;
}
async function makeBot(userId: string): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO bot_configs (user_id, bot_name, bot_token) VALUES (${userId}, 'race-bot', 'race:test') RETURNING id
  `);
  return Number((r.rows[0] as any).id);
}
async function cleanup(userId: string, botId: number | null) {
  if (botId !== null) await db.execute(sql`DELETE FROM bot_configs WHERE id = ${botId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

async function raceCryptoActivation() {
  console.log("\n[race 1] crypto activation idempotency");
  const userId = await makeUser();
  const intentRow = await db.execute(sql`
    INSERT INTO plan_payment_intents
      (user_id, plan, rail, status, token_symbol, token_address, token_decimals, receive_address, expected_amount, usd_amount, expires_at)
    VALUES
      (${userId}, 'pro', 'crypto', 'pending', 'USDC', '0xtoken', 6, '0xrace', '1000000', '1.00', NOW() + INTERVAL '1 hour')
    RETURNING id
  `);
  const intentId = Number((intentRow.rows[0] as any).id);
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + 86400000);
  const period: any = { userId, plan: "pro", rail: "crypto", intentId, startsAt, endsAt };
  const userUpdate = { plan: "pro" as const, planRail: "crypto" as const, planPeriodEnd: endsAt };
  try {
    const results = await Promise.all([
      storage.activateCryptoIntent(intentId, "0xRACE_HASH_1", period, userId, userUpdate).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e) })),
      storage.activateCryptoIntent(intentId, "0xRACE_HASH_2", period, userId, userUpdate).catch((e) => ({ ok: false as const, reason: String(e?.message ?? e) })),
    ]);
    const winners = results.filter((r) => r.ok === true).length;
    assert(winners === 1, `exactly one activation winner (got ${winners}, results=${JSON.stringify(results.map(r => r.ok ? "ok" : (r as any).reason))})`);
    const matched = await db.execute(sql`SELECT status FROM plan_payment_intents WHERE id = ${intentId}`);
    assert((matched.rows[0] as any).status === "matched", "intent ends in matched state");
    const periods = await db.execute(sql`SELECT COUNT(*)::int AS c FROM plan_periods WHERE intent_id = ${intentId}`);
    assert(Number((periods.rows[0] as any).c) === 1, "exactly one plan_period row created");
  } finally {
    await db.execute(sql`DELETE FROM plan_periods WHERE intent_id = ${intentId}`);
    await db.execute(sql`DELETE FROM plan_payment_intents WHERE id = ${intentId}`);
    await cleanup(userId, null);
  }
}

async function raceRewardsClaim() {
  console.log("\n[race 2] rewards distribution claim");
  const userId = await makeUser();
  const botId = await makeBot(userId);
  try {
    const periodEnd = new Date();
    const results = await Promise.all([
      storage.tryClaimRewardsDistribution(botId, periodEnd),
      storage.tryClaimRewardsDistribution(botId, periodEnd),
      storage.tryClaimRewardsDistribution(botId, periodEnd),
    ]);
    const winners = results.filter(Boolean).length;
    assert(winners === 1, `exactly one rewards claim winner (got ${winners})`);
  } finally {
    await cleanup(userId, botId);
  }
}

async function raceGroupCap() {
  console.log("\n[race 3] group-cap concurrent upsert");
  const userId = await makeUser();
  const botId = await makeBot(userId);
  try {
    const before = await db.execute(sql`SELECT COUNT(*)::int AS c FROM groups WHERE bot_config_id = ${botId} AND is_active = true`);
    const startCount = Number((before.rows[0] as any).c);
    const results = await Promise.allSettled([
      storage.upsertGroup({ botConfigId: botId, telegramChatId: "race-chat-A", title: "A", isActive: true } as any),
      storage.upsertGroup({ botConfigId: botId, telegramChatId: "race-chat-B", title: "B", isActive: true } as any),
      storage.upsertGroup({ botConfigId: botId, telegramChatId: "race-chat-C", title: "C", isActive: true } as any),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const after = await db.execute(sql`SELECT COUNT(*)::int AS c FROM groups WHERE bot_config_id = ${botId} AND is_active = true`);
    const endCount = Number((after.rows[0] as any).c);
    // The number of newly-active groups must equal fulfilled upserts:
    // no double-insert past the cap, no lost row from a missed lock.
    assert(endCount - startCount === fulfilled, `active group delta == fulfilled upserts (delta=${endCount - startCount}, fulfilled=${fulfilled})`);
  } finally {
    await db.execute(sql`DELETE FROM groups WHERE bot_config_id = ${botId}`);
    await cleanup(userId, botId);
  }
}

async function main() {
  try {
    await raceCryptoActivation();
    await raceRewardsClaim();
    await raceGroupCap();
  } catch (err) {
    console.error("test harness error:", err);
    failures++;
  } finally {
    await pool.end();
  }
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
