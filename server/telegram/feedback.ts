import { storage } from "../storage";
import { log } from "../index";
import { openai } from "./utils";
import type { ProactivePrompt } from "@shared/schema";
import { FEEDBACK_THEMES } from "./proactive";

const CATEGORIES = ["bug", "feature_request", "praise", "complaint", "question", "idea", "other"] as const;
const SENTIMENTS = ["positive", "neutral", "negative"] as const;

export async function captureFeedbackReply(params: {
  botConfigId: number;
  prompt: ProactivePrompt;
  groupId: number | null;
  telegramUserId: string;
  userName: string | null;
  text: string;
}): Promise<void> {
  const { botConfigId, prompt, groupId, telegramUserId, userName, text } = params;
  if (!text || !text.trim()) return;
  if (prompt.kind !== "feedback") return;

  const themeHint = prompt.theme || "general";
  let category = "other";
  let sentiment = "neutral";
  let summary = text.slice(0, 240);

  try {
    const aiPrompt = `Classify this Telegram member reply to a community feedback question.

Theme being asked about: ${themeHint}
Reply text: """${text.slice(0, 800)}"""

Output JSON only:
{"category": "${CATEGORIES.join("|")}", "sentiment": "${SENTIMENTS.join("|")}", "summary": "one short sentence under 160 chars"}`;
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: aiPrompt }],
      max_completion_tokens: 200,
    });
    const content = resp.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (CATEGORIES.includes(parsed.category)) category = parsed.category;
      if (SENTIMENTS.includes(parsed.sentiment)) sentiment = parsed.sentiment;
      if (typeof parsed.summary === "string" && parsed.summary.trim()) summary = parsed.summary.slice(0, 200);
    }
  } catch (err: any) {
    log(`Feedback classification error: ${err.message}`, "feedback");
  }

  try {
    await storage.createFeedbackItem({
      botConfigId,
      groupId,
      promptId: prompt.id,
      telegramUserId,
      userName,
      theme: prompt.theme || null,
      rawText: text.slice(0, 4000),
      category,
      sentiment,
      summary,
    });
  } catch (err: any) {
    log(`Feedback persist error: ${err.message}`, "feedback");
  }

  try {
    const owner = await storage.getBotConfig(botConfigId);
    if (owner) {
      await storage.createActivityLog(botConfigId, owner.userId, {
        groupId,
        telegramUserId,
        type: "message",
        userName,
        userMessage: text.slice(0, 1000),
        botResponse: null,
        isReport: false,
        metadata: { feedbackReply: true, feedbackPromptId: prompt.id, feedbackTheme: prompt.theme || null },
      });
    }
  } catch (err: any) {
    log(`Feedback activity log error: ${err.message}`, "feedback");
  }
}

export async function generateFeedbackDigest(botConfigId: number, sinceDays = 14): Promise<string> {
  const items = await storage.listFeedbackItems(botConfigId, { sinceDays, limit: 80 });
  if (items.length === 0) return "No feedback collected yet in this window.";
  const sample = items.slice(0, 40).map(i => `- [${i.theme || "?"}|${i.sentiment || "?"}|${i.category || "?"}] ${i.summary || i.rawText.slice(0, 160)}`).join("\n");
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{
        role: "user",
        content: `You are summarising community feedback collected over the last ${sinceDays} days for a Telegram community owner. Group items by theme. Highlight the top 3 to 5 actionable insights. Note sentiment shifts. Be concrete, no fluff, no em dashes. Under 600 words.

Feedback items:
${sample}`,
      }],
      max_completion_tokens: 800,
    });
    return resp.choices[0]?.message?.content || "Digest generation returned no content.";
  } catch (err: any) {
    log(`Feedback digest error: ${err.message}`, "feedback");
    return `Digest unavailable: ${err.message}`;
  }
}

export { FEEDBACK_THEMES };
