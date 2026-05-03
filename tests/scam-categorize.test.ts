// Regression test for the MiniPlay false-positive auto-ban incident.
// Two regular users (Hellen, Igwe) were auto-banned because the AI scam
// classifier flagged any DM mention as a scam, then the auto-ban safeguard
// (which requires "2 distinct patterns") was defeated by the AI paraphrasing
// the same root behavior in two slightly different free-text reasons.
//
// The fix has two parts:
//  1. The AI prompt no longer treats a bare DM mention as a scam unless it
//     is paired with a financial hook. (Prompt change, not testable here.)
//  2. The "distinct patterns" safeguard now collapses reasons down to a
//     stable category enum via `categorize`, so two paraphrases of the same
//     behavior count as ONE distinct signal, not two.
//
// Run with: tsx tests/scam-categorize.test.ts

import { categorize, type ScamCategory } from "../server/telegram/scam-detection";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

function eq(reason: string, expected: ScamCategory): void {
  const got = categorize(reason);
  assert(got === expected, `categorize(${JSON.stringify(reason)}) -> ${got} (expected ${expected})`);
}

console.log("\n[explicit cat:xxx tag wins]");
eq("AI [cat:dm_solicitation]: asks to DM for free crypto", "dm_solicitation");
eq("AI (impersonator) [cat:impersonation_evasion]: lookalike", "impersonation_evasion");
eq("AI [cat:airdrop_migration]: migration scam", "airdrop_migration");
eq("AI [cat:nsfw_spam]: porn channel", "nsfw_spam");
eq("AI [cat:bogus_made_up]: garbage tag falls back", "other");

console.log("\n[deterministic substring fallbacks]");
eq("Homoglyph evasion detected (Cyrillic)", "impersonation_evasion");
eq("Forwarded ad with multiple inline buttons", "button_grid_spam");
eq("Migration airdrop scam", "airdrop_migration");
eq("Crypto giveaway scam", "giveaway_scam");
eq("NSFW spam detected", "nsfw_spam");
eq("Fake exchange listing", "fake_exchange");
eq("Wallet buying solicitation", "wallet_buying");
eq("Learned pattern match", "learned_pattern");
eq("Promo for hire / paid promo", "promo_for_hire");
eq("VIP call insider testimonial", "pump_call");
eq("Telegram invite link group promo", "group_promo");
eq("Tx hash phishing request", "tx_hash_phishing");
eq("Service pitch / cold pitch / management", "service_pitch");
eq("Private message solicitation / DM", "dm_solicitation");
eq("Something completely unrelated", "other");

console.log("\n[paraphrase collapse: the MiniPlay bug]");
// These two free-text reasons describe the SAME root behavior. Pre-fix they
// were treated as two distinct patterns (defeating the >=2 safeguard).
// Post-fix they must collapse to the same category.
const r1 = "AI [cat:dm_solicitation]: asks user to DM privately to claim reward";
const r2 = "AI [cat:dm_solicitation]: requests private contact via DM for the giveaway";
const c1 = categorize(r1);
const c2 = categorize(r2);
assert(c1 === c2, `paraphrased DM reasons collapse to one category (got ${c1} and ${c2})`);
assert(c1 === "dm_solicitation", `collapsed category is dm_solicitation (got ${c1})`);

console.log("\n[different categories stay distinct]");
const dm = categorize("AI [cat:dm_solicitation]: dm me for airdrop");
const mig = categorize("AI [cat:airdrop_migration]: migrate to new contract");
assert(dm !== mig, `dm_solicitation and airdrop_migration are distinct (${dm} vs ${mig})`);

// Action-gate regression: bare DM phrasing must NOT pass the deterministic
// auto-action gate without a corroborating financial hook. The pattern may
// still fire (`privateMessageSolicitation` matches "drop me a private
// message"), but the gate in detectAndHandleScam now requires an additional
// signal before deleting/banning. We assert the gate logic directly here by
// running the pattern map and applying the same conjunction the gate uses.
console.log("\n[deterministic DM action-gate]");
import { runAllPatterns } from "../server/telegram/scam-patterns";

// Mirrors the gate in detectAndHandleScam (server/telegram/scam-detection.ts)
// minus the runtime financial-hype check (which isn't exported). This is
// sufficient to lock in the bare-DM regression: none of the negative
// fixtures match the listed deterministic financial-hook patterns either,
// so adding the hype check would not change their result.
function bareDmGateFires(msg: string): boolean {
  const r = runAllPatterns(msg.toLowerCase(), msg);
  const hit = (n: string) => r.get(n) === true;
  const dmAsk = hit("privateMessageSolicitation") || hit("dmSolicitation");
  const dmFinancialHook =
    hit("txHashRequest") ||
    hit("migrationAirdropScam") ||
    hit("walletBuyingSelling") ||
    hit("cryptoGiveawayScam") ||
    hit("scamOffer");
  return dmAsk && dmFinancialHook;
}

assert(!bareDmGateFires("drop me a private message"), "bare 'drop me a private message' does NOT pass DM gate");
assert(!bareDmGateFires("please send me a message when you're free"), "bare 'send me a message' does NOT pass DM gate");
assert(!bareDmGateFires("reach out to me about the docs"), "bare 'reach out to me' does NOT pass DM gate");
assert(bareDmGateFires("Drop me a private message with your tx hash for verification"), "DM + tx hash DOES pass DM gate");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll assertions passed");
}
