// ReDoS regression test for the deterministic scam pattern set.
//
// Run with:  tsx tests/scam-redos.test.ts
//
// We feed pathological strings (long repeated tokens, dense overlapping
// trigger words, attacker-shaped padding between trigger anchors) through
// runAllPatterns and assert each invocation completes well under a strict
// wall-clock budget. A non-zero exit code means a regex regressed into
// catastrophic backtracking territory.

import { runAllPatterns, MAX_SCAM_SCAN_LENGTH } from "../server/telegram/scam-patterns";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

const BUDGET_MS = 100;

interface Fixture {
  name: string;
  normalized: string;
  raw?: string;
}

const fixtures: Fixture[] = [
  {
    name: "10k 'a'",
    normalized: "a".repeat(10_000),
  },
  {
    name: "5k whitespace + scattered triggers",
    normalized: ("dm me " + " ".repeat(50)).repeat(100),
  },
  {
    name: "padded migration/airdrop trigger pair",
    normalized: "migration " + "x".repeat(5_000) + " holder",
  },
  {
    name: "chained dm/proof/wallet (three .{0,30} hops)",
    normalized: ("dm " + "y".repeat(40) + " proof " + "z".repeat(40) + " wallet ").repeat(100),
  },
  {
    name: "exchange listing flood",
    normalized: ("binance partner " + "q".repeat(60) + " listing ").repeat(80),
  },
  {
    name: "wallet buying pattern flood",
    normalized: ("need wallet " + "k".repeat(40) + " transactions " + "p".repeat(40) + " pay 5 sol ").repeat(80),
    raw: ("need wallet " + "k".repeat(40) + " transactions " + "p".repeat(40) + " pay 5 sol ").repeat(80),
  },
  {
    name: "100k chars of mixed scam keywords (above MAX_SCAM_SCAN_LENGTH)",
    normalized: ("dm me airdrop migration holder swap claim wallet ").repeat(2_500),
  },
  {
    name: "pure 'x' run with terminal trigger",
    normalized: "x".repeat(8_000) + " dm me proof wallet",
  },
  {
    name: "many @handles + checkmarks (revenueSplit/formattedPitch shape)",
    normalized: "",
    raw: "✅ pitch\n".repeat(100) + ("50% to you 30% split\n").repeat(50) + "@scammerhandle",
  },
  {
    name: "0x address spam (tokenCallCard shape)",
    normalized: "vol 100k mc 5m liq 20k +500% safety 99",
    raw: ("0x" + "a".repeat(40) + " vol mc liq +500% safety ").repeat(60),
  },
];

async function main() {
  console.log(`[scam-redos] MAX_SCAM_SCAN_LENGTH=${MAX_SCAM_SCAN_LENGTH}, per-fixture budget=${BUDGET_MS}ms\n`);

  for (const fx of fixtures) {
    const raw = fx.raw ?? fx.normalized;
    const t0 = Date.now();
    const result = runAllPatterns(fx.normalized, raw);
    const elapsed = Date.now() - t0;
    assert(
      elapsed < BUDGET_MS,
      `${fx.name}: ${elapsed}ms (< ${BUDGET_MS}ms, ${result.size} patterns)`,
    );
  }

  // Sanity: known-positive fixtures still match (no regression from the
  // length cap or budget guard for normal-sized inputs).
  const known = [
    {
      msg: "Am working on migration and airdropping of all holders, dm me your wallet for the swap",
      hits: ["migrationAirdropScam"],
    },
    {
      msg: "Drop me a private message with your tx hash for verification",
      hits: ["privateMessageSolicitation", "txHashRequest"],
    },
    {
      msg: "Hey, I want to give some SOL to the first 5 members to dm me with their sol address",
      hits: ["cryptoGiveawayScam"],
    },
    {
      msg: "love your project i offer logo design",
      hits: ["flatteryPitch"],
    },
  ];

  console.log(`\n[scam-redos] regression check on known-positive fixtures`);
  for (const k of known) {
    const r = runAllPatterns(k.msg.toLowerCase(), k.msg);
    for (const name of k.hits) {
      assert(r.get(name) === true, `still detects ${name} on "${k.msg.slice(0, 50)}..."`);
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(2);
});
