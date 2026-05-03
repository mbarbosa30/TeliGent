// End-to-end regression for the sensitive-topic guardrails inside
// generateAIResponse. We mock storage, the OpenAI client, and the AI-budget
// pool so the test does not touch real Postgres or the OpenAI API.
//
// Three scenarios exercise the full code path:
//   A. Sensitive question + no PINNED/OFFICIAL coverage  -> safe fallback,
//      OpenAI is NEVER called (deterministic gate).
//   B. Sensitive question + PINNED coverage + model returns the verbatim
//      incident phrase ("the team paused payouts to audit formulas")
//      -> post-filter substitutes "[[SKIP]]".
//   C. Sensitive question + PINNED coverage + model returns a clean,
//      neutral paraphrase -> the reply is returned as-is.
//
// Run with: tsx tests/ai-no-team-spokesperson.e2e.test.ts

import type { BotConfig, KnowledgeEntry } from "../shared/schema";
import { storage } from "../server/storage";
import { openai } from "../server/telegram/utils";
import { pool } from "../server/db";
import { generateAIResponse } from "../server/telegram/commands";
import { buildSafeFallbackReply } from "../server/telegram/sensitive-topics";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

const TEST_BOT_ID = 999_001;

const baseConfig: BotConfig = {
  id: TEST_BOT_ID,
  userId: "test-user",
  botName: "TestBot",
  botToken: "test-token",
  personality: "friendly community helper",
  websiteUrl: null,
  websiteContent: null,
  globalContext: null,
  bankrEnabled: false,
  bankrApiKey: null,
  scamSensitivity: "medium",
  autoBan: false,
  maxResponseLength: 280,
} as unknown as BotConfig;

function makePinnedEntry(): KnowledgeEntry {
  return {
    id: 1,
    botConfigId: TEST_BOT_ID,
    title: "Payouts FAQ",
    category: "payouts",
    content: "Payout cadence is documented in the pinned message.",
    sourceUrl: null,
    pinned: true,
    isOfficial: true,
    expiresAt: null,
    eventDate: null,
    createdAt: new Date(),
  } as unknown as KnowledgeEntry;
}

function makeUnrelatedPinnedEntry(): KnowledgeEntry {
  // Generic welcome/rules pinned entry. PINNED + OFFICIAL but says nothing
  // about payouts, audits, or funding. Must NOT count as coverage for a
  // sensitive financial question.
  return {
    id: 2,
    botConfigId: TEST_BOT_ID,
    title: "Welcome and group rules",
    category: "general",
    content: "Be kind, no spam, no shilling. Introduce yourself in the intro thread.",
    sourceUrl: null,
    pinned: true,
    isOfficial: true,
    expiresAt: null,
    eventDate: null,
    createdAt: new Date(),
  } as unknown as KnowledgeEntry;
}

let createCalls = 0;
let lastModelDraft = "";

interface MutableStorage {
  getActiveKnowledgeEntries: (botConfigId: number) => Promise<KnowledgeEntry[]>;
  getBotMemories: (botConfigId: number) => Promise<unknown[]>;
  getUserMemoriesForUser: (botConfigId: number, tg: string) => Promise<unknown[]>;
  getCollectivePatterns: (botConfigId: number) => Promise<unknown[]>;
  getBotConfig: (botConfigId: number) => Promise<unknown>;
  getUserById: (userId: string) => Promise<unknown>;
}
const mutStorage = storage as unknown as MutableStorage;

interface MutableOpenAI {
  chat: { completions: { create: (req: unknown) => Promise<unknown> } };
}
const mutOpenai = openai as unknown as MutableOpenAI;

interface MutablePool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}
const mutPool = pool as unknown as MutablePool;

let kbForTest: KnowledgeEntry[] = [];

mutStorage.getActiveKnowledgeEntries = async () => kbForTest;
mutStorage.getBotMemories = async () => [];
mutStorage.getUserMemoriesForUser = async () => [];
mutStorage.getCollectivePatterns = async () => [];
mutStorage.getBotConfig = async (id: number) => ({ id, userId: "test-user" });
mutStorage.getUserById = async () => ({ id: "test-user", planTier: "free", planStatus: "active", planExpiresAt: null, teliPaid: false });
mutPool.query = async () => ({ rows: [] });

mutOpenai.chat = {
  completions: {
    create: async () => {
      createCalls += 1;
      return { choices: [{ message: { content: lastModelDraft } }] };
    },
  },
};

async function run(): Promise<void> {
  console.log("[ai-no-team-spokesperson e2e] A: sensitive + no PINNED -> safe fallback, no AI call");
  kbForTest = [];
  createCalls = 0;
  lastModelDraft = "this should never be used";
  const replyA = await generateAIResponse(
    TEST_BOT_ID,
    "when are rewards coming back?",
    "alice",
    baseConfig,
    "Test Group",
    "testbot",
    null, false, [], null, null, false,
  );
  assert(createCalls === 0, `OpenAI never called (was ${createCalls})`);
  assert(replyA === buildSafeFallbackReply(), `returned safe fallback: "${replyA}"`);

  console.log("\n[ai-no-team-spokesperson e2e] A2: sensitive + only UNRELATED PINNED entry -> safe fallback, no AI call");
  kbForTest = [makeUnrelatedPinnedEntry()];
  createCalls = 0;
  lastModelDraft = "this should never be used";
  const replyA2 = await generateAIResponse(
    TEST_BOT_ID,
    "when do payouts come back",
    "alice",
    baseConfig,
    "Test Group",
    "testbot",
    null, false, [], null, null, false,
  );
  assert(createCalls === 0, `OpenAI never called when only unrelated pinned entry exists (was ${createCalls})`);
  assert(replyA2 === buildSafeFallbackReply(), `unrelated pinned entry does not bypass gate: "${replyA2}"`);

  console.log("\n[ai-no-team-spokesperson e2e] B: sensitive + PINNED + model returns incident phrase -> [[SKIP]]");
  kbForTest = [makePinnedEntry()];
  createCalls = 0;
  lastModelDraft = "the team paused payouts to audit formulas, fix reliability, and build sustainable funding. xp is still tracked and payouts are verifiable on-chain.";
  const replyB = await generateAIResponse(
    TEST_BOT_ID,
    "why are payouts paused",
    "alice",
    baseConfig,
    "Test Group",
    "testbot",
    null, false, [], null, null, false,
  );
  assert(createCalls === 1, `OpenAI called exactly once (was ${createCalls})`);
  assert(replyB === "[[SKIP]]", `post-filter substitutes [[SKIP]] (got "${replyB}")`);

  console.log("\n[ai-no-team-spokesperson e2e] C: sensitive + PINNED + clean draft -> draft returned");
  kbForTest = [makePinnedEntry()];
  createCalls = 0;
  lastModelDraft = "i dont have payout details on hand, the pinned message has the latest schedule";
  const replyC = await generateAIResponse(
    TEST_BOT_ID,
    "when do payouts resume",
    "alice",
    baseConfig,
    "Test Group",
    "testbot",
    null, false, [], null, null, false,
  );
  assert(createCalls === 1, `OpenAI called exactly once (was ${createCalls})`);
  assert(replyC === lastModelDraft, `clean draft passes through (got "${replyC}")`);

  console.log("\n[ai-no-team-spokesperson e2e] D: non-sensitive question -> draft returned, no gating");
  kbForTest = [];
  createCalls = 0;
  lastModelDraft = "yo welcome, hope you enjoy the group";
  const replyD = await generateAIResponse(
    TEST_BOT_ID,
    "gm everyone, just joined",
    "alice",
    baseConfig,
    "Test Group",
    "testbot",
    null, false, [], null, null, false,
  );
  assert(createCalls === 1, `OpenAI called for non-sensitive (was ${createCalls})`);
  assert(replyD === lastModelDraft, `non-sensitive draft passes through (got "${replyD}")`);
}

run().then(() => {
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
  console.error("test crashed:", err);
  process.exit(1);
});
