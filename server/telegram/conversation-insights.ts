import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import type { ChatMessage } from "./conversation-history";

const MAX_MEMORIES_PER_BOT = 100;
const INSIGHT_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_EXCHANGE_LENGTH = 2;

const lastInsightTimestamp = new Map<number, number>();
const insightInProgress = new Set<number>();

export async function maybeExtractInsight(
  botConfigId: number,
  userMessage: string,
  botResponse: string,
  userName: string,
  conversationHistory: ChatMessage[],
  botName: string
): Promise<void> {
  const now = Date.now();
  const lastInsight = lastInsightTimestamp.get(botConfigId) || 0;
  if (now - lastInsight < INSIGHT_COOLDOWN_MS) return;

  if (conversationHistory.length < MIN_EXCHANGE_LENGTH) return;

  if (insightInProgress.has(botConfigId)) return;
  insightInProgress.add(botConfigId);
  lastInsightTimestamp.set(botConfigId, now);

  try {
    await doExtractInsight(botConfigId, userMessage, botResponse, userName, conversationHistory, botName);
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
  botName: string
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

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You analyze conversations between a Telegram bot ("${botName}") and group members to extract behavioral insights worth remembering.

Extract insights like:
- User corrections ("No, the supply is actually 1B" → "Token supply is 1 billion, not 100M")
- Community preferences ("People seem to prefer short answers" → "Community prefers brief, direct responses")
- Frequently asked topics ("Staking questions come up often" → "Staking is a frequent topic — be ready to discuss mechanics")
- Tone feedback ("Too formal" → "Users want a more casual, friendly tone")
- Important community context ("We're launching on Thursday" → "Upcoming launch happening Thursday")

Do NOT extract:
- Routine Q&A exchanges that are already handled by the knowledge base
- Scam/spam related observations
- Individual user info or personal details
- Things too specific to a single moment

Already known insights (avoid duplicates): ${existingSummary || "none yet"}

If there is a useful behavioral insight, respond with EXACTLY:
{"save": true, "type": "correction|preference|topic|context", "content": "The insight in 1-2 sentences (max 200 chars)", "confidence": 60-95}

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

    let parsed: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return;
    }

    if (!parsed.save || !parsed.content || !parsed.type) return;

    const validTypes = ["correction", "preference", "topic", "context", "insight"];
    const memType = validTypes.includes(parsed.type) ? parsed.type : "insight";
    const confidence = Math.max(50, Math.min(95, parsed.confidence || 70));

    await storage.createBotMemory(botConfigId, {
      type: memType,
      content: parsed.content.slice(0, 300),
      source: "auto",
      confidence,
    });

    log(`Conversation insight saved for bot ${botConfigId}: [${memType}] "${parsed.content.slice(0, 60)}"`, "telegram");
  } catch (err: any) {
    log(`Conversation insight error: ${err.message}`, "telegram");
  }
}
