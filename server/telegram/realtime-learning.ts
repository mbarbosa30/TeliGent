import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";

const MIN_MESSAGE_LENGTH = 80;
const LEARN_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_LEARNED_PER_BOT = 50;

const lastLearnTimestamp = new Map<number, number>();
const learningInProgress = new Set<number>();

export async function maybeLearnFromMessage(
  botConfigId: number,
  userId: string,
  messageText: string,
  userName: string
): Promise<void> {
  if (messageText.length < MIN_MESSAGE_LENGTH) return;
  if (messageText.startsWith("/")) return;

  const now = Date.now();
  const lastLearn = lastLearnTimestamp.get(botConfigId) || 0;
  if (now - lastLearn < LEARN_COOLDOWN_MS) return;

  if (learningInProgress.has(botConfigId)) return;
  learningInProgress.add(botConfigId);
  lastLearnTimestamp.set(botConfigId, now);

  try {
    await doLearn(botConfigId, userId, messageText, userName);
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
  userName: string
): Promise<void> {
  const existingEntries = await storage.getActiveKnowledgeEntries(botConfigId);
  const learnedEntries = existingEntries.filter(e => e.category === "learned");
  if (learnedEntries.length >= MAX_LEARNED_PER_BOT) return;

  const existingTitles = existingEntries.map(e => e.title.toLowerCase());

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are a knowledge extraction system. Analyze the message and determine if it contains important factual information worth remembering for a community bot (e.g. project announcements, technical details, dates, partnerships, product updates, policy changes, team info).

Do NOT extract:
- Casual conversation, opinions, jokes, greetings
- Questions (the user is asking, not stating facts)
- Scam/spam content
- Information that is too vague or personal
- Price predictions or speculation

Already known topics (do not duplicate): ${existingTitles.slice(0, 20).join(", ") || "none yet"}

If the message contains a useful fact worth remembering, respond with EXACTLY this JSON format:
{"learn": true, "title": "Brief title (max 60 chars)", "content": "The key fact or information extracted (max 300 chars)"}

If the message is NOT worth learning from, respond with EXACTLY:
{"learn": false}`
        },
        {
          role: "user",
          content: `Message from ${userName}: ${messageText}`
        }
      ],
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    let parsed: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return;
    }

    if (!parsed.learn || !parsed.title || !parsed.content) return;

    await storage.createKnowledgeEntry(botConfigId, userId, {
      title: parsed.title.slice(0, 100),
      content: parsed.content.slice(0, 500),
      category: "learned",
      isActive: true,
      sourceUrl: null,
    });

    lastLearnTimestamp.set(botConfigId, now);
    log(`Real-time learning: saved "${parsed.title}" from ${userName} (bot ${botConfigId})`, "telegram");
  } catch (err: any) {
    log(`Real-time learning AI error: ${err.message}`, "telegram");
  }
}
