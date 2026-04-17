import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import { redactPII, extractKeywords } from "./pii";
import type { ChatMessage } from "./conversation-history";

const CALIBRATION_COOLDOWN_MS = 4 * 60 * 1000;
const USER_COOLDOWN_MS = 30 * 60 * 1000;
const MIN_PERSIST_LENGTH = 24;
const MAX_PATTERNS_PER_BOT = 200;
const MAX_USER_MEMORIES = 500;
const MIN_QUALITY_OVERALL = 50;

const lastBotCalibration = new Map<number, number>();
const lastUserCalibration = new Map<string, number>();
const inProgress = new Set<number>();

export type Triage = { tier: "skip" | "user_memory" | "pattern" | "both"; reason: string };

export function triageMessage(messageText: string, conversationHistory: ChatMessage[]): Triage {
  const t = messageText.trim();
  if (!t) return { tier: "skip", reason: "empty" };
  const lower = t.toLowerCase();
  const looksQuestion = /\?|\b(how|what|why|when|where|can someone|anyone know|is it possible|wen|gm|whats|what's)\b/i.test(t);
  const looksSelfDisclosure = /\b(i am|i'm|im\s|i work|i build|i'm a|i'm an|i develop|my role|i specialize|i focus on|i hold|i bought|i made)\b/i.test(lower);
  const looksAdvice = /\b(tip|trick|recommend|always|never|avoid|watch out|be careful|strategy|approach|pro tip|tldr)\b/i.test(lower);
  if (looksSelfDisclosure && (looksQuestion || looksAdvice)) return { tier: "both", reason: "self-disclosure + signal" };
  if (looksSelfDisclosure) return { tier: "user_memory", reason: "self-disclosure" };
  if (looksQuestion || looksAdvice) return { tier: "pattern", reason: "question/advice" };
  return { tier: "pattern", reason: "default" };
}

export async function maybeCalibrate(
  botConfigId: number,
  telegramUserId: string,
  userName: string,
  messageText: string,
  conversationHistory: ChatMessage[],
  botName: string,
  sourceActivityLogId?: number | null,
): Promise<void> {
  const triage = triageMessage(messageText, conversationHistory);
  if (triage.tier === "skip") return;
  if (messageText.trim().length < MIN_PERSIST_LENGTH) return;
  const now = Date.now();
  const lastBot = lastBotCalibration.get(botConfigId) || 0;
  if (now - lastBot < CALIBRATION_COOLDOWN_MS) return;
  const userKey = `${botConfigId}:${telegramUserId}`;
  const lastUser = lastUserCalibration.get(userKey) || 0;
  if (now - lastUser < USER_COOLDOWN_MS) return;
  if (inProgress.has(botConfigId)) return;
  inProgress.add(botConfigId);
  lastBotCalibration.set(botConfigId, now);
  lastUserCalibration.set(userKey, now);

  try {
    await doCalibrate(botConfigId, telegramUserId, userName, messageText, conversationHistory, botName, triage, sourceActivityLogId ?? null);
  } catch (err: any) {
    lastBotCalibration.delete(botConfigId);
    log(`Calibration error: ${err.message}`, "telegram");
  } finally {
    inProgress.delete(botConfigId);
  }
}

async function doCalibrate(
  botConfigId: number,
  telegramUserId: string,
  userName: string,
  messageText: string,
  conversationHistory: ChatMessage[],
  botName: string,
  triage: Triage,
  sourceActivityLogId: number | null,
): Promise<void> {
  const [umCount, patterns] = await Promise.all([
    storage.countUserMemories(botConfigId),
    storage.getCollectivePatterns(botConfigId),
  ]);
  const allowUM = umCount < MAX_USER_MEMORIES && (triage.tier === "user_memory" || triage.tier === "both");
  const allowPattern = patterns.length < MAX_PATTERNS_PER_BOT && (triage.tier === "pattern" || triage.tier === "both");
  if (!allowUM && !allowPattern) return;

  const safeText = redactPII(messageText).slice(0, 800);
  const recent = conversationHistory.slice(-6).map(m => `${m.role === "assistant" ? botName : m.name}: ${redactPII(m.content).slice(0, 120)}`).join("\n");
  const existingPatternTitles = patterns.slice(0, 30).map(p => p.title).join(" | ");

  const sys = `You analyze a single Telegram message to extract STRUCTURED community intelligence for a bot.

Return ONE compact JSON object:
{
  "quality": { "contribution": 0-100, "domain_relevance": 0-100, "overall": 0-100 },
  "user_memory": { "save": bool, "type": "trait|expertise|interest|role", "content": "max 180 chars, no PII" } or null,
  "pattern": { "save": bool, "kind": "topic|question|pitfall|strategy|sentiment", "title": "max 60 chars", "summary": "max 200 chars", "keywords": ["3-6 lowercase words"] } or null
}

Quality scoring rubric (be strict):
- contribution: substantive new info vs noise/filler/banter
- domain_relevance: relevant to a community topic vs off-topic chatter
- overall: weighted blend (lower of the two if either is bad)

User memory rules:
- Save ONLY if the message reveals a stable trait (skill, role, interest, preference) about the speaker themselves.
- Skip casual banter, one-off opinions, questions to the bot.

Pattern rules:
- Save ONLY a recurring community theme: a question topic, a known pitfall, a strategy people share, or sentiment.
- "kind=question" only if the message asks something many users likely also ask.
- "kind=pitfall" only if the message warns about or describes a mistake/issue.
- "kind=strategy" only if it shares a tip / playbook.
- Keywords MUST be normalized lowercase nouns/verbs, no stopwords.

Existing patterns (avoid duplicates of these titles): ${existingPatternTitles || "none"}

If nothing qualifies, set save=false on both. NEVER include PII (wallets, emails, phones, IDs).`;

  let raw = "";
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Triage hint: tier=${triage.tier} (${triage.reason})\nRecent context:\n${recent}\n\nNew message from ${userName}: ${safeText}` },
      ],
      max_completion_tokens: 320,
    });
    raw = resp.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    log(`Calibration AI error: ${err.message}`, "telegram");
    return;
  }
  if (!raw) return;

  interface CalibrationParsed {
    quality?: { contribution?: number; domain_relevance?: number; overall?: number };
    user_memory?: { save?: boolean; type?: string; content?: string } | null;
    pattern?: { save?: boolean; kind?: string; title?: string; summary?: string; keywords?: unknown[] } | null;
  }

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return;
  let parsed: CalibrationParsed;
  try { parsed = JSON.parse(m[0]) as CalibrationParsed; } catch { return; }

  const q = parsed.quality || {};
  const overall = Math.max(0, Math.min(100, Number(q.overall) || 0));
  const contribution = Math.max(0, Math.min(100, Number(q.contribution) || 0));
  const domainRelevance = Math.max(0, Math.min(100, Number(q.domain_relevance) || 0));
  log(`Calibration quality for ${userName}: contribution=${contribution} domain=${domainRelevance} overall=${overall} (triage=${triage.tier})`, "telegram");

  const um = parsed.user_memory;
  const pat = parsed.pattern;
  const passed = overall >= MIN_QUALITY_OVERALL;
  let savedUM = false;
  let savedPattern = false;

  if (passed && allowUM && um?.save && typeof um.content === "string") {
    const c = redactPII(um.content).slice(0, 200);
    const t = um.type && ["trait", "expertise", "interest", "role"].includes(um.type) ? um.type : "trait";
    if (c.length >= 6) {
      await storage.upsertUserMemory(botConfigId, telegramUserId, userName.slice(0, 80), t, c, 65, overall, sourceActivityLogId);
      savedUM = true;
      log(`User memory saved for ${userName}: [${t}] "${c.slice(0, 60)}" (q=${overall}, src=${sourceActivityLogId ?? "n/a"})`, "telegram");
    }
  }

  if (passed && allowPattern && pat?.save && typeof pat.title === "string" && typeof pat.summary === "string") {
    const kind = pat.kind && ["topic", "question", "pitfall", "strategy", "sentiment"].includes(pat.kind) ? pat.kind : "topic";
    const title = redactPII(pat.title).slice(0, 80);
    const summary = redactPII(pat.summary).slice(0, 240);
    let kws = Array.isArray(pat.keywords)
      ? pat.keywords.filter((k): k is string | number => typeof k === "string" || typeof k === "number").map((k) => String(k).toLowerCase().slice(0, 24)).filter(Boolean)
      : [];
    if (kws.length === 0) kws = extractKeywords(messageText, 6);
    if (title && summary) {
      const p = await storage.upsertCollectivePattern(botConfigId, telegramUserId, kind, title, summary, kws.slice(0, 8), overall, sourceActivityLogId);
      savedPattern = true;
      log(`Pattern: [${kind}] "${title}" mentions=${p.mentionCount} users=${p.uniqueUsers} q=${overall} src=${sourceActivityLogId ?? "n/a"}`, "telegram");
    }
  }

  try {
    await storage.recordCalibrationLog(botConfigId, telegramUserId, {
      sourceActivityLogId,
      triageTier: triage.tier,
      contribution,
      domainRelevance,
      overall,
      gated: !passed,
      savedUserMemory: savedUM,
      savedPattern,
    });
  } catch (err) {
    log(`Calibration log persist error: ${(err as Error).message}`, "telegram");
  }
}
