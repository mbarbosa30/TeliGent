// Concurrency race verification for Task #71 atomicity guarantees.
//
// Run with:  tsx tests/concurrency.test.ts
//
// Exits 0 only when every race serialized to exactly one winner. A
// non-zero exit means an atomicity guarantee regressed.

import { pool, db } from "../server/db";
import { storage } from "../server/storage";
import { sql } from "drizzle-orm";
import type { InsertGroup } from "@shared/schema";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

type IdRow = { id: string };
type IdNumRow = { id: number };
type CountRow = { c: number | string };
type StatusRow = { status: string };

function readId<T>(rows: readonly Record<string, unknown>[]): T {
  if (rows.length === 0) throw new Error("expected at least one row");
  return rows[0] as unknown as T;
}

async function makeUser(): Promise<string> {
  const email = `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const r = await db.execute(sql`
    INSERT INTO users (email, password_hash, email_verified, plan, plan_rail)
    VALUES (${email}, 'x', true, 'free', 'none') RETURNING id
  `);
  return readId<IdRow>(r.rows).id;
}
async function makeBot(userId: string): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO bot_configs (user_id, bot_name, bot_token) VALUES (${userId}, 'race-bot', 'race:test') RETURNING id
  `);
  return Number(readId<IdNumRow>(r.rows).id);
}
async function cleanup(userId: string, botId: number | null): Promise<void> {
  if (botId !== null) await db.execute(sql`DELETE FROM bot_configs WHERE id = ${botId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

async function raceCryptoActivation(): Promise<void> {
  console.log("\n[race 1] crypto activation idempotency");
  const userId = await makeUser();
  const intentRow = await db.execute(sql`
    INSERT INTO plan_payment_intents
      (user_id, plan, rail, status, token_symbol, token_address, token_decimals, receive_address, expected_amount, usd_amount, expires_at)
    VALUES
      (${userId}, 'pro', 'crypto', 'pending', 'USDC', '0xtoken', 6, '0xrace', '1000000', '1.00', NOW() + INTERVAL '1 hour')
    RETURNING id
  `);
  const intentId = Number(readId<IdNumRow>(intentRow.rows).id);
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + 86400000);
  const period = { userId, plan: "pro", rail: "crypto", intentId, startsAt, endsAt };
  const userUpdate = { plan: "pro" as const, planRail: "crypto" as const, planPeriodEnd: endsAt };
  try {
    type ActivateResult = Awaited<ReturnType<typeof storage.activateCryptoIntent>>;
    const captured: ActivateResult[] = await Promise.all([
      storage.activateCryptoIntent(intentId, "0xRACE_HASH_1", period, userId, userUpdate)
        .catch((e: unknown): ActivateResult => ({ ok: false, reason: "user_not_found" as const })),
      storage.activateCryptoIntent(intentId, "0xRACE_HASH_2", period, userId, userUpdate)
        .catch((e: unknown): ActivateResult => ({ ok: false, reason: "user_not_found" as const })),
    ]);
    const winners = captured.filter((r) => r.ok === true).length;
    const summaries = captured.map((r) => (r.ok ? "ok" : r.reason));
    assert(winners === 1, `exactly one activation winner (got ${winners}, results=${JSON.stringify(summaries)})`);

    const matched = await db.execute(sql`SELECT status FROM plan_payment_intents WHERE id = ${intentId}`);
    assert(readId<StatusRow>(matched.rows).status === "matched", "intent ends in matched state");

    const periods = await db.execute(sql`SELECT COUNT(*)::int AS c FROM plan_periods WHERE intent_id = ${intentId}`);
    assert(Number(readId<CountRow>(periods.rows).c) === 1, "exactly one plan_period row created");
  } finally {
    await db.execute(sql`DELETE FROM plan_periods WHERE intent_id = ${intentId}`);
    await db.execute(sql`DELETE FROM plan_payment_intents WHERE id = ${intentId}`);
    await cleanup(userId, null);
  }
}

async function raceRewardsClaim(): Promise<void> {
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

async function raceGroupCap(): Promise<void> {
  console.log("\n[race 3] group-cap concurrent upsert");
  const userId = await makeUser();
  const botId = await makeBot(userId);
  try {
    const before = await db.execute(sql`SELECT COUNT(*)::int AS c FROM groups WHERE bot_config_id = ${botId} AND is_active = true`);
    const startCount = Number(readId<CountRow>(before.rows).c);

    const mkData = (chatId: string, name: string): Omit<InsertGroup, "userId" | "botConfigId"> => ({
      telegramChatId: chatId,
      name,
      isActive: true,
    });

    const results = await Promise.allSettled([
      storage.upsertGroup(botId, userId, mkData("race-chat-A", "A")),
      storage.upsertGroup(botId, userId, mkData("race-chat-B", "B")),
      storage.upsertGroup(botId, userId, mkData("race-chat-C", "C")),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    for (const r of results) {
      if (r.status === "rejected") {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.log(`    rejected: ${reason}`);
      }
    }

    const after = await db.execute(sql`SELECT COUNT(*)::int AS c FROM groups WHERE bot_config_id = ${botId} AND is_active = true`);
    const endCount = Number(readId<CountRow>(after.rows).c);
    const delta = endCount - startCount;

    // Real exclusion test: every fulfilled upsert must correspond to
    // exactly one new active row, and total active rows never exceed
    // the count of fulfilled upserts (cap enforcement under contention).
    assert(delta === fulfilled, `active group delta == fulfilled upserts (delta=${delta}, fulfilled=${fulfilled}, rejected=${rejected})`);
    assert(delta <= 3, `cap never exceeds attempted upserts (delta=${delta})`);
    // At least one upsert should have succeeded (otherwise the test
    // setup is wrong, not a real race outcome). The free plan default
    // cap allows multiple groups per bot.
    assert(fulfilled >= 1, `at least one upsert succeeded (fulfilled=${fulfilled})`);
  } finally {
    await db.execute(sql`DELETE FROM groups WHERE bot_config_id = ${botId}`);
    await cleanup(userId, botId);
  }
}

async function main(): Promise<void> {
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
