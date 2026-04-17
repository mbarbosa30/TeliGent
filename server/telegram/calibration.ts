import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import { redactPII, extractKeywords } from "./pii";
import type { ChatMessage } from "./conversation-history";

const CALIBRATION_COOLDOWN_MS = 4 * 60 * 1000;
const USER_COOLDOWN_MS = 30 * 60 * 1000;
const MIN_MESSAGE_LENGTH = 60;
const MAX_PATTERNS_PER_BOT = 200;
const MAX_USER_MEMORIES = 500;

const lastBotCalibration = new Map<number, number>();
const lastUserCalibration = new Map<string, number>();
const inProgress = new Set<number>();

export async function maybeCalibrate(
  botConfigId: number,
  telegramUserId: string,
  userName: string,
  messageText: string,
  conversationHistory: ChatMessage[],
  botName: string
): Promise<void> {
  if (!messageText || messageText.length < MIN_MESSAGE_LENGTH) return;
  if (messageText.startsWith("/")) return;
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
    await doCalibrate(botConfigId, telegramUserId, userName, messageText, conversationHistory, botName);
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
  botName: string
): Promise<void> {
  const [umCount, patterns] = await Promise.all([
    storage.countUserMemories(botConfigId),
    storage.getCollectivePatterns(botConfigId),
  ]);
  const allowUM = umCount < MAX_USER_MEMORIES;
  const allowPattern = patterns.length < MAX_PATTERNS_PER_BOT;
  if (!allowUM && !allowPattern) return;

  const safeText = redactPII(messageText).slice(0, 800);
  const recent = conversationHistory.slice(-6).map(m => `${m.role === "assistant" ? botName : m.name}: ${redactPII(m.content).slice(0, 120)}`).join("\n");
  const existingPatternTitles = patterns.slice(0, 30).map(p => p.title).join(" | ");

  const sys = `You analyze a single Telegram message to extract STRUCTURED community intelligence for a bot.

Return ONE compact JSON object:
{
  "user_memory": { "save": bool, "type": "trait|expertise|interest|role", "content": "max 180 chars, no PII" } or null,
  "pattern": { "save": bool, "kind": "topic|question|pitfall|strategy|sentiment", "title": "max 60 chars", "summary": "max 200 chars", "keywords": ["3-6 lowercase words"] } or null
}

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

If nothing qualifies, return {"user_memory": null, "pattern": null}. NEVER include PII (wallets, emails, phones, IDs).`;

  let raw = "";
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Recent context:\n${recent}\n\nNew message from ${userName}: ${safeText}` },
      ],
      max_completion_tokens: 250,
    });
    raw = resp.choices[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    log(`Calibration AI error: ${err.message}`, "telegram");
    return;
  }
  if (!raw) return;

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return;
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return; }

  if (allowUM && parsed?.user_memory?.save && parsed.user_memory.content) {
    const c = redactPII(String(parsed.user_memory.content)).slice(0, 200);
    const t = ["trait", "expertise", "interest", "role"].includes(parsed.user_memory.type) ? parsed.user_memory.type : "trait";
    if (c.length >= 6) {
      await storage.upsertUserMemory(botConfigId, telegramUserId, userName.slice(0, 80), t, c, 65);
      log(`User memory saved for ${userName}: [${t}] "${c.slice(0, 60)}"`, "telegram");
    }
  }

  if (allowPattern && parsed?.pattern?.save && parsed.pattern.title && parsed.pattern.summary) {
    const kind = ["topic", "question", "pitfall", "strategy", "sentiment"].includes(parsed.pattern.kind) ? parsed.pattern.kind : "topic";
    const title = redactPII(String(parsed.pattern.title)).slice(0, 80);
    const summary = redactPII(String(parsed.pattern.summary)).slice(0, 240);
    let kws = Array.isArray(parsed.pattern.keywords) ? parsed.pattern.keywords.map((k: any) => String(k).toLowerCase().slice(0, 24)).filter(Boolean) : [];
    if (kws.length === 0) kws = extractKeywords(messageText, 6);
    if (title && summary) {
      const p = await storage.upsertCollectivePattern(botConfigId, telegramUserId, kind, title, summary, kws.slice(0, 8));
      log(`Pattern: [${kind}] "${title}" mentions=${p.mentionCount} users=${p.uniqueUsers}`, "telegram");
    }
  }
}
