import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import { tryConsumeAiBudget } from "../ai-budget";
import { getTimeContextBlock } from "./time-context";

const MIN_MESSAGE_LENGTH_USER = 80;
const MIN_MESSAGE_LENGTH_ADMIN = 24;
const LEARN_COOLDOWN_MS = 5 * 60 * 1000;
const ADMIN_LEARN_COOLDOWN_MS = 60 * 1000;
const MAX_LEARNED_PER_BOT = 50;
const TIME_SENSITIVE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POST_EVENT_GRACE_MS = 24 * 60 * 60 * 1000;

const lastLearnTimestamp = new Map<number, number>();
const learningInProgress = new Set<number>();

export async function maybeLearnFromMessage(
  botConfigId: number,
  userId: string,
  messageText: string,
  userName: string,
  isAdmin: boolean = false,
): Promise<void> {
  const minLength = isAdmin ? MIN_MESSAGE_LENGTH_ADMIN : MIN_MESSAGE_LENGTH_USER;
  if (messageText.length < minLength) return;
  if (messageText.startsWith("/")) return;

  const now = Date.now();
  const cooldown = isAdmin ? ADMIN_LEARN_COOLDOWN_MS : LEARN_COOLDOWN_MS;
  const lastLearn = lastLearnTimestamp.get(botConfigId) || 0;
  if (now - lastLearn < cooldown) return;

  if (learningInProgress.has(botConfigId)) return;
  learningInProgress.add(botConfigId);
  lastLearnTimestamp.set(botConfigId, now);

  try {
    await doLearn(botConfigId, userId, messageText, userName, isAdmin);
  } catch (err) {
    lastLearnTimestamp.delete(botConfigId);
    throw err;
  } finally {
    learningInProgress.delete(botConfigId);
  }
}

async function doLearn(
  botConfigId: number,
  userId: string,
  messageText: string,
  userName: string,
  isAdmin: boolean,
): Promise<void> {
  const existingEntries = await storage.getActiveKnowledgeEntries(botConfigId);
  const learnedEntries = existingEntries.filter(e => e.category === "learned");
  if (!isAdmin && learnedEntries.length >= MAX_LEARNED_PER_BOT) return;

  const existingTitles = existingEntries.map(e => e.title.toLowerCase());

  const allowed = await tryConsumeAiBudget(botConfigId);
  if (!allowed) {
    log(`Real-time learning skipped (daily AI budget exhausted) for bot ${botConfigId}`, "ai-budget");
    return;
  }

  const adminBlock = isAdmin
    ? `\n\nThis message is from a GROUP ADMIN. Treat it as authoritative truth. If it states a fact (even briefly), prefer extracting it. If it CONTRADICTS something in the existing known topics, still extract it: the admin's version overrides the older fact. Set "is_official": true.`
    : `\n\nThis message is from a regular community member. Set "is_official": false.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `${getTimeContextBlock()}

You are a knowledge extraction system. Analyze the message and determine if it contains important factual information worth remembering for a community bot (project announcements, technical details, partnerships, product updates, policy changes, team info, scheduled events, official corrections from admins).

Do NOT extract:
- Casual conversation, opinions, jokes, greetings
- Questions (the user is asking, not stating facts)
- Scam/spam content
- Information that is too vague or personal
- Price predictions or speculation

Already known topics (do not duplicate, but DO supersede if the new message is from an admin and corrects them): ${existingTitles.slice(0, 20).join(", ") || "none yet"}${adminBlock}

If the message refers to a SPECIFIC upcoming or past event, set "time_sensitive": true and resolve any relative time word ("tomorrow", "tonight", "next week", "this Friday", "in 3 days") to an absolute calendar date in "event_date" using ISO format (YYYY-MM-DD), based on TODAY shown in the TIME CONTEXT block above. If the message contains an explicit date or weekday plus enough context to resolve it, use that. If the fact is evergreen (general info, no date), leave both fields out and set "time_sensitive": false.

If the message contains a useful fact worth remembering, respond with EXACTLY this JSON format:
{"learn": true, "title": "Brief title (max 60 chars)", "content": "The key fact or information extracted (max 300 chars)", "time_sensitive": true|false, "event_date": "YYYY-MM-DD" or null, "is_official": true|false}

If the message is NOT worth learning from, respond with EXACTLY:
{"learn": false}`
        },
        {
          role: "user",
          content: `Message from ${userName}${isAdmin ? " (ADMIN)" : ""}: ${messageText}`
        }
      ],
      max_completion_tokens: 260,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    interface LearnParsed {
      learn?: boolean;
      title?: string;
      content?: string;
      time_sensitive?: boolean;
      event_date?: string | null;
      is_official?: boolean;
    }

    let parsed: LearnParsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      parsed = JSON.parse(jsonMatch[0]) as LearnParsed;
    } catch {
      return;
    }

    if (!parsed.learn || !parsed.title || !parsed.content) return;

    const timeSensitive = parsed.time_sensitive === true;
    const eventDateIso = typeof parsed.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.event_date)
      ? parsed.event_date
      : null;
    const official = isAdmin || parsed.is_official === true;

    let expiresAt: Date | null = null;
    if (timeSensitive) {
      if (eventDateIso) {
        const eventTs = new Date(eventDateIso + "T00:00:00Z").getTime();
        if (!Number.isNaN(eventTs)) {
          expiresAt = new Date(eventTs + POST_EVENT_GRACE_MS);
        } else {
          expiresAt = new Date(Date.now() + TIME_SENSITIVE_DEFAULT_TTL_MS);
        }
      } else {
        expiresAt = new Date(Date.now() + TIME_SENSITIVE_DEFAULT_TTL_MS);
      }
    }

    if (official) {
      await storage.supersedeMatchingLearnedEntries(botConfigId, parsed.title.slice(0, 100));
    }

    await storage.createKnowledgeEntry(botConfigId, userId, {
      title: parsed.title.slice(0, 100),
      content: parsed.content.slice(0, 500),
      category: official ? "official" : "learned",
      isActive: true,
      sourceUrl: null,
      timeSensitive,
      eventDate: eventDateIso,
      expiresAt,
      pinned: false,
      isOfficial: official,
    });

    lastLearnTimestamp.set(botConfigId, Date.now());
    log(`Real-time learning: saved "${parsed.title}" from ${userName}${isAdmin ? " (admin)" : ""} (bot ${botConfigId}, official=${official}, time_sensitive=${timeSensitive}, event_date=${eventDateIso ?? "n/a"})`, "telegram");
  } catch (err: any) {
    log(`Real-time learning AI error: ${err.message}`, "telegram");
  }
}
