import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import { getTimeContextBlock } from "./time-context";
import type { ChatMessage } from "./conversation-history";

const MAX_MEMORIES_PER_BOT = 100;
const INSIGHT_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_EXCHANGE_LENGTH = 2;
const TIME_SENSITIVE_INSIGHT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const lastInsightTimestamp = new Map<number, number>();
const insightInProgress = new Set<number>();

interface InsightOptions {
  isAdmin?: boolean;
}

export async function maybeExtractInsight(
  botConfigId: number,
  userMessage: string,
  botResponse: string,
  userName: string,
  conversationHistory: ChatMessage[],
  botName: string,
  options: InsightOptions = {},
): Promise<void> {
  const isAdmin = options.isAdmin === true;
  const now = Date.now();
  const lastInsight = lastInsightTimestamp.get(botConfigId) || 0;
  if (now - lastInsight < INSIGHT_COOLDOWN_MS) return;

  if (conversationHistory.length < MIN_EXCHANGE_LENGTH) return;

  if (insightInProgress.has(botConfigId)) return;
  insightInProgress.add(botConfigId);
  lastInsightTimestamp.set(botConfigId, now);

  try {
    await doExtractInsight(botConfigId, userMessage, botResponse, userName, conversationHistory, botName, isAdmin);
  } catch (err) {
    lastInsightTimestamp.delete(botConfigId);
    throw err;
  } finally {
    insightInProgress.delete(botConfigId);
  }
}

async function doExtractInsight(
  botConfigId: number,
  userMessage: string,
  botResponse: string,
  userName: string,
  conversationHistory: ChatMessage[],
  botName: string,
  isAdmin: boolean,
): Promise<void> {
  const memoryCount = await storage.countBotMemories(botConfigId);
  if (memoryCount >= MAX_MEMORIES_PER_BOT) return;

  const existingMemories = await storage.getBotMemories(botConfigId);
  const existingSummary = existingMemories
    .slice(0, 20)
    .map(m => m.content)
    .join(" | ");

  const recentExchanges = conversationHistory.slice(-10)
    .map(m => `${m.role === "assistant" ? botName : m.name}: ${m.content.slice(0, 150)}`)
    .join("\n");

  const { tryConsumeAiBudget } = await import("../ai-budget");
  const allowedInsight = await tryConsumeAiBudget(botConfigId);
  if (!allowedInsight) return;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `${getTimeContextBlock()}

You analyze conversations between a Telegram bot ("${botName}") and group members to extract behavioral insights worth remembering for the long term.

Extract insights like:
- User corrections (e.g. "No, the supply is actually 1B" becomes "Token supply is 1 billion, not 100M")
- Community preferences (e.g. "People seem to prefer short answers" becomes "Community prefers brief, direct responses")
- Frequently asked topics (e.g. "Staking questions come up often" becomes "Staking is a frequent topic, be ready to discuss mechanics")
- Tone feedback (e.g. "Too formal" becomes "Users want a more casual, friendly tone")

Do NOT extract:
- Anything tied to a SPECIFIC date or upcoming event ("the AMA is tomorrow", "we launch Thursday", "voting closes tonight"). Those belong in the knowledge base, not in long-term behavioral memory, because they go stale.
- Routine Q&A exchanges that are already handled by the knowledge base
- Scam/spam related observations
- Individual user info or personal details
- Things too specific to a single moment in time

If the insight nonetheless involves a time-bound theme (e.g. ongoing campaign, season, weekly cadence), set "time_sensitive": true so it can expire automatically. Default is false.

Already known insights (avoid duplicates): ${existingSummary || "none yet"}

${isAdmin ? `The latest user message in the conversation is from a GROUP ADMIN. If the admin is correcting the bot or asserting how things should be, weight that heavily. Treat the admin's framing as authoritative.` : ""}

If there is a useful behavioral insight, respond with EXACTLY:
{"save": true, "type": "correction|preference|topic|context", "content": "The insight in 1-2 sentences (max 200 chars)", "confidence": 60-95, "time_sensitive": true|false}

If nothing worth remembering, respond with EXACTLY:
{"save": false}`
        },
        {
          role: "user",
          content: `Recent conversation:\n${recentExchanges}\n\nLatest exchange:\n${userName}: ${userMessage.slice(0, 300)}\n${botName}: ${botResponse.slice(0, 300)}`
        }
      ],
      max_completion_tokens: 200,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    interface InsightParsed {
      save?: boolean;
      type?: string;
      content?: string;
      confidence?: number;
      time_sensitive?: boolean;
    }

    let parsed: InsightParsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      parsed = JSON.parse(jsonMatch[0]) as InsightParsed;
    } catch {
      return;
    }

    if (!parsed.save || !parsed.content || !parsed.type) return;

    const validTypes = ["correction", "preference", "topic", "context", "insight"];
    const memType = validTypes.includes(parsed.type) ? parsed.type : "insight";
    const baseConfidence = Math.max(50, Math.min(95, parsed.confidence || 70));
    const confidence = isAdmin ? Math.min(95, baseConfidence + 15) : baseConfidence;
    const timeSensitive = parsed.time_sensitive === true;
    const expiresAt = timeSensitive ? new Date(Date.now() + TIME_SENSITIVE_INSIGHT_TTL_MS) : null;

    await storage.createBotMemory(botConfigId, {
      type: memType,
      content: parsed.content.slice(0, 300),
      source: "auto",
      confidence,
      expiresAt,
    });

    log(`Conversation insight saved for bot ${botConfigId}: [${memType}] "${parsed.content.slice(0, 60)}" (time_sensitive=${timeSensitive})`, "telegram");
  } catch (err: any) {
    log(`Conversation insight error: ${err.message}`, "telegram");
  }
}
