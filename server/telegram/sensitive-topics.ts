// Sensitive-topic guardrails for the conversational AI.
//
// Goal: stop the bot from speaking on behalf of "the team" or improvising
// explanations about money, payouts, delays, audits, formulas, treasury, or
// funding. The bot must never invent operational commitments ("we paused
// rewards to audit formulas", "sustainable funding", "verifiable on-chain")
// because owners use it for real communities where those words have weight.
//
// Two-stage defense:
//   1. classifySensitiveTopic(text)   - INPUT side. Detects when the user is
//      asking about money/payouts/delays/audits/funding so the caller can lock
//      down the context (drop community patterns, drop non-pinned KB, drop
//      website/global context) and add stricter system-prompt rules.
//   2. filterForbiddenPhrases(output) - OUTPUT side. Hard substring/regex
//      filter on the model's draft. If the bot still tries to speak as "the
//      team" or commit to audits/payouts/funding, we either substitute a safe
//      fallback or skip the message entirely.
//
// All regexes use the RE2-safe `rt()` helper from scam-patterns.ts so a
// pathological input cannot ReDoS the bot pipeline.

import { rt } from "./scam-patterns";

export type SensitiveCategory =
  | "payouts"
  | "delays_pauses"
  | "audits_formulas"
  | "treasury_funding"
  | "refunds"
  | "schedule_promise";

export interface SensitiveMatch {
  sensitive: boolean;
  categories: SensitiveCategory[];
}

interface ClassifierRule {
  category: SensitiveCategory;
  test: (lower: string) => boolean;
}

const CLASSIFIER_RULES: ClassifierRule[] = [
  {
    category: "payouts",
    test: (s) =>
      rt(/\b(payout|payouts|reward|rewards|distribution|distributions|claim|claims|airdrop|emission|emissions)\b.{0,40}\b(when|next|coming|paused|delayed|stopped|halted|broken|missing|late|fix|status)\b/i, s) ||
      rt(/\b(when|where|why|how)\b.{0,30}\b(is|are|was|were|will|do|does|did)\b.{0,40}\b(payout|payouts|reward|rewards|distribution|claim|airdrop|emission)s?\b/i, s) ||
      rt(/\b(when\s+(do|will|are|am)|how\s+do)\b.{0,30}\b(we|i|members|holders)\b.{0,30}\b(get\s+paid|paid|rewarded|claim|receive)\b/i, s) ||
      rt(/\bxp\b.{0,30}\b(pay|payout|reward|claim|distribution|track|count|when)\b/i, s),
  },
  {
    category: "delays_pauses",
    test: (s) =>
      rt(/\b(why|how\s+come|whats\s+up\s+with|what\s+happened\s+to|whens?)\b.{0,40}\b(paused|delayed|stopped|halted|broken|down|late|frozen|on\s+hold)\b/i, s) ||
      rt(/\b(reward|payout|distribution|claim|airdrop|drop)s?\b.{0,30}\b(paused|delayed|stopped|halted|frozen|on\s+hold|down)\b/i, s) ||
      rt(/\b(no\s+(rewards?|payouts?|drops?))\b.{0,30}\b(today|this\s+week|since|why|when)\b/i, s),
  },
  {
    category: "audits_formulas",
    test: (s) =>
      rt(/\b(audit|auditing|audited|investigation|investigating|review|reviewing)\b.{0,40}\b(reward|payout|distribution|emission|tokenomics|formula|payouts?)\b/i, s) ||
      rt(/\b(formula|tokenomics|emission|reward\s*math|reward\s*logic)\b.{0,40}\b(change|changed|fix|fixed|broken|wrong|update|new)\b/i, s) ||
      rt(/\b(why|how)\b.{0,30}\b(formula|tokenomics|emission|reward\s*math)\b/i, s),
  },
  {
    category: "treasury_funding",
    test: (s) =>
      rt(/\b(treasury|runway|funding|liquidity|reserves|burn\s*rate|cash|budget)\b.{0,40}\b(low|empty|out|dry|left|status|gone|sustain|extend|fix|how\s+much)\b/i, s) ||
      rt(/\b(sustainable|sustainability|sustain)\b.{0,30}\b(funding|reward|payout|tokenomics|model|emission|community)/i, s) ||
      rt(/\b(funding|reward|payout|tokenomics|model|emission|treasury)\b.{0,30}\b(sustainable|sustainability|sustain)\b/i, s) ||
      rt(/\b(out\s+of\s+(money|funds|liquidity|treasury))\b/i, s),
  },
  {
    category: "refunds",
    test: (s) =>
      rt(/\b(refund|refunds|reimburs(ed?|ement)|compensat(ed?|ion)|make\s+(it|us)\s+whole|made\s+whole)\b/i, s),
  },
  {
    category: "schedule_promise",
    test: (s) =>
      rt(/\b(when\s+(will|do|are|is))\b.{0,30}\b(rewards?|payouts?|distribution|airdrop|claim|drop|emission)/i, s) ||
      rt(/\b(eta|timeline|roadmap)\b.{0,30}\b(reward|payout|distribution|airdrop|claim|emission|fix)/i, s) ||
      rt(/\b(promise|guarantee|commit)\b.{0,30}\b(reward|payout|distribution|airdrop|claim|fund)/i, s),
  },
];

/**
 * Classify a user message (and optional reply context) against the sensitive
 * topic taxonomy. Returns `{ sensitive: false }` for ordinary chat so the
 * normal prompt path is unchanged.
 */
export function classifySensitiveTopic(
  userMessage: string,
  replyContext?: string | null,
): SensitiveMatch {
  const blob = `${userMessage}\n${replyContext ?? ""}`.toLowerCase();
  if (!blob.trim()) return { sensitive: false, categories: [] };

  const hits: SensitiveCategory[] = [];
  for (const rule of CLASSIFIER_RULES) {
    if (rule.test(blob)) hits.push(rule.category);
  }
  return { sensitive: hits.length > 0, categories: hits };
}

// ---------------------------------------------------------------------------
// Output filter
// ---------------------------------------------------------------------------

interface ForbiddenRule {
  id: string;
  test: (lower: string) => boolean;
}

// Phrases the bot must never put in its OUTPUT. These are the shapes that
// caused the original incident (a "we paused rewards to audit formulas, fix
// reliability, and build sustainable funding" reply) plus close paraphrases.
const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    id: "team_action_commitment",
    test: (s) => {
      // Broad set of synonyms the model uses when speaking for operators:
      // team, devs, founders, mods, admins (when paired with operational
      // verbs about money/payouts), core contributors, maintainers, ops.
      const TEAM = String.raw`(the\s+team|our\s+team|we|our\s+devs?|the\s+devs?|the\s+founders?|core\s+contributors?|the\s+maintainers?|the\s+mods|the\s+admins?|ops|the\s+ops\s+team)`;
      return (
        rt(new RegExp(String.raw`\b${TEAM}\s+(have|has|are|is|will|just|recently)?\s*(paused|halted|stopped|delayed|frozen|disabled|suspended|reworking|reworked)\b.{0,40}\b(reward|payout|distribution|claim|airdrop|drop|emission)`, "i"), s) ||
        rt(new RegExp(String.raw`\b${TEAM}\s+(will|are|is|have|has|plan(s|ned)?\s+to|going\s+to|currently|right\s+now|actively)\s*(currently|now|actively|just|right\s+now)?\s*(audit|auditing|review|reviewing|fix|fixing|restore|restoring|resuming|resume|distribute|pay|compensate|refund|launch|build|building|ship|shipping|deliver|rework|reworking|investigat(e|ing))\b`, "i"), s) ||
        // Passive-voice variants: "rewards are being audited", "payouts are
        // currently paused", "distribution is being reworked".
        rt(/\b(reward|payout|distribution|claim|airdrop|drop|emission)s?\s+(are|is|were|was)\s+(currently|now|being|getting)\s*(paused|halted|stopped|delayed|frozen|audited|reviewed|reworked|investigated|fixed)/i, s) ||
        // "is being audited / paused / reworked" without explicit subject.
        rt(/\b(being\s+(audited|paused|halted|reworked|investigated|fixed|restored))\b.{0,40}\b(reward|payout|distribution|claim|airdrop|emission|formula|tokenomics)/i, s)
      );
    },
  },
  {
    id: "sustainable_funding_promise",
    test: (s) =>
      rt(/\bsustainab(le|ility)\b.{0,20}\b(funding|reward|payout|tokenomics|emission|model|community|growth)/i, s) ||
      rt(/\b(build|building|create|creating|design|designing)\b.{0,20}\bsustainab(le|ility)\b/i, s),
  },
  {
    id: "verifiable_onchain_claim",
    test: (s) =>
      rt(/\b(verifiable|verified|provable|transparent|trustless)\b.{0,15}\bon[\s\-]?chain\b/i, s) ||
      rt(/\bon[\s\-]?chain\b.{0,15}\b(verifiable|verified|provable|transparent|proof)\b/i, s),
  },
  {
    id: "trust_commitment",
    test: (s) =>
      rt(/\b(rebuild|earn|restore|win\s*back|regain)\s+(your\s+|the\s+community(?:'s)?\s+)?trust\b/i, s),
  },
  {
    id: "audit_formula_explanation",
    test: (s) =>
      rt(/\baudit(ing)?\b.{0,30}\b(formula|formulas|payout|payouts|distribution|emission|tokenomics|reward\s*math)\b/i, s) ||
      rt(/\b(fix|fixing|fixed)\b.{0,20}\b(reliability|the\s+formula|the\s+system|payouts?|distribution|tokenomics)\b/i, s),
  },
  {
    id: "schedule_commitment",
    test: (s) =>
      rt(/\b(rewards?|payouts?|distribution|airdrop|claim|drop|emission)s?\s+(will|are\s+going\s+to|should)\s+(resume|restart|return|come\s+back|be\s+(back|live|fixed|paid))\b/i, s) ||
      rt(/\b(by|in)\s+(next|the\s+next)\s+(week|day|days|month|hours?)\b.{0,30}\b(reward|payout|distribution|airdrop|claim|emission)/i, s),
  },
  {
    id: "treasury_explanation",
    test: (s) =>
      rt(/\b(treasury|runway|reserves|burn\s*rate|liquidity)\b.{0,30}\b(low|extend|sustain|fix|build|short|tight|healthy)\b/i, s),
  },
  {
    id: "refund_promise",
    test: (s) =>
      rt(/\b(we|the\s+team|our\s+team)\s+(will|are\s+going\s+to|plan\s+to)\s+(refund|reimburse|compensate|make\s+(it|you|everyone)\s+whole)\b/i, s),
  },
];

export interface FilterResult {
  ok: boolean;
  matched: string[];
  output: string;
}

/**
 * Inspect a model draft for forbidden spokesperson/operational claims. When a
 * forbidden pattern fires, returns ok=false plus the list of matched rule IDs
 * so the caller can log the original draft for debugging and substitute a
 * safe fallback (or skip the message entirely).
 */
export function filterForbiddenPhrases(output: string): FilterResult {
  const trimmed = (output || "").trim();
  if (!trimmed) return { ok: true, matched: [], output: trimmed };
  const lower = trimmed.toLowerCase();
  const matched: string[] = [];
  for (const rule of FORBIDDEN_RULES) {
    if (rule.test(lower)) matched.push(rule.id);
  }
  return { ok: matched.length === 0, matched, output: trimmed };
}

/**
 * Stable safe fallback used when (a) a sensitive question has no PINNED /
 * OFFICIAL knowledge backing it, or (b) the model's draft tripped the
 * forbidden-phrase filter. Phrasing is deliberately neutral, never speaks for
 * "the team", never promises timing, and points the user at admins/pins.
 */
export function buildSafeFallbackReply(): string {
  return "i dont have that info on hand. best to check the pinned message or wait for an admin to chime in.";
}

/**
 * Hard rule block injected into the system prompt for EVERY conversational
 * reply (not just sensitive ones). These rules are short, specific, and
 * mirror the output filter so the model self-corrects before we even need to
 * post-filter.
 */
export const SPOKESPERSON_HARD_RULES = `\n\n--- NO SPOKESPERSON RULES (HARD) ---
- You are NOT the team. Never say "we", "our team", "the team", or "our devs" when describing actions, decisions, plans, audits, fixes, pauses, or funding. You can say "i" for your own opinion as the bot, but never speak for the operators.
- Never explain WHY rewards, payouts, distributions, drops, claims, or emissions were paused, delayed, stopped, audited, or changed. You do not know the reason and must not invent one.
- Never promise or estimate WHEN rewards, payouts, claims, refunds, audits, or fixes will happen. No "soon", no "next week", no "should resume".
- Never use the phrases: "sustainable funding", "verifiable on-chain", "rebuild trust", "audit the formula", "fix reliability", "make whole", "compensate everyone".
- Never describe the treasury, runway, reserves, burn rate, or funding model.
- For questions about money, payouts, delays, audits, formulas, refunds, or funding: only repeat what is in a [PINNED] or [OFFICIAL/ADMIN] knowledge base entry. If no such entry covers it, say you dont have that info and point to the pinned message or admins. Do NOT improvise.`;

/**
 * Extra system-prompt block added on top of the hard rules ONLY when the
 * input was classified as sensitive. Tells the model exactly what is allowed
 * (cite PINNED/OFFICIAL only or defer) and what to do otherwise (return
 * `[[SKIP]]`).
 */
export function buildSensitiveTopicInstruction(categories: SensitiveCategory[]): string {
  const list = categories.join(", ");
  return `\n\n--- SENSITIVE TOPIC DETECTED (${list}) ---
This question is about money, payouts, delays, audits, formulas, treasury, or funding. Follow the NO SPOKESPERSON RULES strictly. You may ONLY answer by quoting or paraphrasing a [PINNED] or [OFFICIAL/ADMIN] knowledge base entry. If no such entry directly covers this question, reply with one short sentence telling the user you dont have that info and they should check the pinned message or wait for an admin. Never invent reasons, schedules, or plans. If unsure, output [[SKIP]] and stay silent.`;
}
