// Regression test for the "no spokesperson" guardrails.
//
// Run with:  tsx tests/ai-no-team-spokesperson.test.ts
//
// We test the deterministic pieces (sensitive-topic classifier + forbidden
// phrase output filter) end-to-end since the AI step itself is not pure.
// The triggering incident — "the team paused daily rewards to audit
// formulas, fix reliability, and build sustainable funding, XP is still
// tracked and payouts are verifiable on-chain" — must be blocked by the
// output filter, and questions in that shape must classify as sensitive on
// the input side.

import {
  classifySensitiveTopic,
  filterForbiddenPhrases,
  buildSafeFallbackReply,
  buildSensitiveTopicInstruction,
  SPOKESPERSON_HARD_RULES,
  type SensitiveCategory,
} from "../server/telegram/sensitive-topics";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.error(`  FAIL ${msg}`); failures++; }
}

console.log("[ai-no-team-spokesperson] sensitive classifier (positives)");
const sensitivePositives: Array<{ msg: string; expectAny: SensitiveCategory[] }> = [
  { msg: "when are rewards coming back?", expectAny: ["payouts", "schedule_promise", "delays_pauses"] },
  { msg: "why are payouts paused", expectAny: ["payouts", "delays_pauses"] },
  { msg: "when do we get paid for last week", expectAny: ["payouts"] },
  { msg: "is the team auditing the reward formula?", expectAny: ["audits_formulas"] },
  { msg: "how is the treasury looking, runway low?", expectAny: ["treasury_funding"] },
  { msg: "can i get a refund for the missed drop?", expectAny: ["refunds"] },
  { msg: "no rewards this week, why?", expectAny: ["delays_pauses", "payouts"] },
  { msg: "is the funding model sustainable", expectAny: ["treasury_funding"] },
  { msg: "when will the airdrop resume", expectAny: ["schedule_promise", "payouts", "delays_pauses"] },
  { msg: "xp pay when?", expectAny: ["payouts"] },
];
for (const c of sensitivePositives) {
  const r = classifySensitiveTopic(c.msg, null);
  const hit = r.sensitive && c.expectAny.some(cat => r.categories.includes(cat));
  assert(hit, `sensitive: "${c.msg}" -> [${r.categories.join(",")}]`);
}

console.log("\n[ai-no-team-spokesperson] sensitive classifier (negatives)");
const sensitiveNegatives = [
  "gm everyone, hope you're well",
  "the launch trailer looks really clean",
  "what does the project actually do",
  "thanks for the help yesterday",
  "anyone tried the new staking page",
  "lol that meme killed me",
  "is there a discord link",
];
for (const msg of sensitiveNegatives) {
  const r = classifySensitiveTopic(msg, null);
  assert(!r.sensitive, `not sensitive: "${msg}" (categories=[${r.categories.join(",")}])`);
}

console.log("\n[ai-no-team-spokesperson] forbidden output filter (must block)");
const forbiddenDrafts = [
  // The exact incident phrase shape.
  "the team paused daily rewards to audit formulas, fix reliability, and build sustainable funding. xp is still tracked and payouts are verifiable on-chain.",
  "we paused payouts this week",
  "the team is auditing the formula right now",
  "we are working on a sustainable funding model",
  "rewards are verifiable onchain so dont worry",
  "we will rebuild your trust soon",
  "payouts will resume next week, promise",
  "the treasury is healthy and we are extending the runway",
  "we plan to refund everyone affected",
  "the team has paused distribution while we audit payouts",
  // Adversarial paraphrases: synonymized "team" + operational verbs.
  "core contributors are reviewing the reward formula",
  "the founders plan to refund affected holders",
  "our devs are actively auditing payouts",
  "the maintainers will restore distribution shortly",
  "ops is currently reworking the emission schedule",
  // Passive-voice variants with no explicit "team" subject.
  "payouts are currently paused while being audited",
  "distribution is being reworked this week",
  "rewards are being investigated by the team",
];
for (const draft of forbiddenDrafts) {
  const r = filterForbiddenPhrases(draft);
  assert(!r.ok && r.matched.length > 0, `BLOCKED: "${draft.slice(0, 60)}..." -> [${r.matched.join(",")}]`);
}

console.log("\n[ai-no-team-spokesperson] forbidden output filter (must allow)");
const allowedDrafts = [
  "i dont have that info on hand. best to check the pinned message.",
  "good question, you might wanna ask an admin.",
  "the trailer is sick, lots of energy",
  "i think the new ui looks cleaner tbh",
  "lol same, my coffee is also cold",
  "yeah the docs are at the link in the pinned msg",
  // "we" is fine when it isn't paired with operational verbs.
  "we should grab a coffee sometime haha",
  buildSafeFallbackReply(),
];
for (const draft of allowedDrafts) {
  const r = filterForbiddenPhrases(draft);
  assert(r.ok, `ALLOWED: "${draft.slice(0, 60)}..." (matched=[${r.matched.join(",")}])`);
}

console.log("\n[ai-no-team-spokesperson] prompt blocks non-empty");
assert(SPOKESPERSON_HARD_RULES.includes("NO SPOKESPERSON RULES"), "hard rules block has header");
assert(SPOKESPERSON_HARD_RULES.includes("sustainable funding"), "hard rules name the forbidden phrase");
const inst = buildSensitiveTopicInstruction(["payouts", "delays_pauses"]);
assert(inst.includes("payouts, delays_pauses"), "sensitive instruction lists detected categories");
assert(inst.includes("[[SKIP]]"), "sensitive instruction permits skip");
assert(inst.includes("[PINNED]"), "sensitive instruction restricts citation to pinned/official");

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
