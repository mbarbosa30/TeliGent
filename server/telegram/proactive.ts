import { storage } from "../storage";
import { log } from "../index";
import { openai, sendBotMessage } from "./utils";
import type { BotConfig } from "@shared/schema";
import { getActiveBotInstance } from "./instance-registry";

const POSTED_QUESTION_LIMIT = 600;

export async function maybeRunProactiveForBot(config: BotConfig): Promise<{ generated: boolean; posted: boolean; reason?: string }> {
  if (!config.proactiveEnabled) return { generated: false, posted: false, reason: "disabled" };

  const cadenceMs = (config.proactiveCadenceHours || 24) * 60 * 60 * 1000;
  const lastAt = config.proactiveLastAt ? new Date(config.proactiveLastAt as any).getTime() : 0;
  if (Date.now() - lastAt < cadenceMs) return { generated: false, posted: false, reason: "cadence" };

  const patterns = await storage.getCollectivePatterns(config.id);
  const open = patterns
    .filter(p => p.kind === "question" || p.kind === "pitfall" || p.kind === "topic")
    .sort((a, b) => (b.mentionCount * 2 + b.uniqueUsers * 3) - (a.mentionCount * 2 + a.uniqueUsers * 3))
    .slice(0, 5);

  if (open.length === 0) return { generated: false, posted: false, reason: "no patterns" };

  const top = open[0];
  const recent = await storage.listProactivePrompts(config.id, undefined, 30);
  if (recent.some(r => r.patternId === top.id)) {
    return { generated: false, posted: false, reason: "already prompted" };
  }

  let question: string;
  let rationale: string;
  try {
    const prompt = `You are ${config.botName}, hosting a Telegram community. Recent recurring topic: "${top.title}". Summary: "${top.summary.slice(0, 300)}".

Write ONE short, friendly question (under 200 chars) you can post to the group to gather members' real opinions or experience on this topic. Avoid em dashes. Be casual. Avoid generic filler. No emoji-only.

Output JSON only: {"question": "...", "rationale": "why we ask"}`;
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 200,
    });
    const content = resp.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { question: top.summary, rationale: "" };
    question = String(parsed.question || top.summary).slice(0, POSTED_QUESTION_LIMIT);
    rationale = String(parsed.rationale || "").slice(0, 500);
  } catch (err: any) {
    log(`Proactive question generation error: ${err.message}`, "proactive");
    return { generated: false, posted: false, reason: "ai error" };
  }

  const groupsForBot = await storage.getGroups(config.id);
  const targetGroup = groupsForBot[0];

  const created = await storage.createProactivePrompt({
    botConfigId: config.id,
    groupId: targetGroup?.id ?? null,
    patternId: top.id,
    question,
    rationale,
    status: "queued",
  });

  await storage.updateBotConfig(config.id, { proactiveLastAt: new Date() as any } as any);

  if (config.proactiveMode === "auto" && targetGroup) {
    const instance = getActiveBotInstance(config.id);
    if (instance) {
      try {
        await sendBotMessage(instance.bot, parseInt(targetGroup.telegramChatId, 10) as any, question);
        await storage.updateProactivePrompt(config.id, created.id, { status: "posted", postedAt: new Date() } as any);
        return { generated: true, posted: true };
      } catch (err: any) {
        log(`Proactive auto-post failed: ${err.message}`, "proactive");
      }
    }
  }
  return { generated: true, posted: false };
}

export async function postProactivePrompt(botConfigId: number, promptId: number): Promise<{ ok: boolean; reason?: string }> {
  const list = await storage.listProactivePrompts(botConfigId, undefined, 200);
  const prompt = list.find(p => p.id === promptId);
  if (!prompt) return { ok: false, reason: "not found" };
  if (prompt.status === "posted") return { ok: false, reason: "already posted" };

  const groupRow = prompt.groupId ? (await storage.getGroups(botConfigId)).find(g => g.id === prompt.groupId) : null;
  if (!groupRow) return { ok: false, reason: "group not available" };

  const instance = getActiveBotInstance(botConfigId);
  if (!instance) return { ok: false, reason: "bot not running" };

  try {
    await sendBotMessage(instance.bot, parseInt(groupRow.telegramChatId, 10) as any, prompt.question);
    await storage.updateProactivePrompt(botConfigId, promptId, { status: "posted", postedAt: new Date() } as any);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
