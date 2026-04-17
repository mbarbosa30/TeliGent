import { storage } from "../storage";
import { log } from "../index";
import { openai, sendBotMessage } from "./utils";
import type { BotConfig, ProactivePrompt } from "@shared/schema";
import { getActiveBotInstance } from "./instance-registry";

const POSTED_QUESTION_LIMIT = 600;

export async function maybeRunProactiveForBot(config: BotConfig): Promise<{ generated: boolean; posted: boolean; reason?: string; perGroup?: Array<{ groupId: number; outcome: string }> }> {
  if (!config.proactiveEnabled) return { generated: false, posted: false, reason: "disabled" };

  const cadenceMs = (config.proactiveCadenceHours || 24) * 60 * 60 * 1000;
  const groupsForBot = await storage.getGroups(config.id);
  if (groupsForBot.length === 0) return { generated: false, posted: false, reason: "no groups" };

  const patterns = await storage.getCollectivePatterns(config.id);
  const open = patterns
    .filter(p => p.kind === "question" || p.kind === "pitfall" || p.kind === "topic")
    .sort((a, b) => (b.mentionCount * 2 + b.uniqueUsers * 3) - (a.mentionCount * 2 + a.uniqueUsers * 3))
    .slice(0, 10);

  if (open.length === 0) return { generated: false, posted: false, reason: "no patterns" };

  const recentAll = await storage.listProactivePrompts(config.id, undefined, 200);
  const perGroup: Array<{ groupId: number; outcome: string }> = [];
  let anyGenerated = false;
  let anyPosted = false;

  for (const group of groupsForBot) {
    const groupPrompts = recentAll.filter(p => p.groupId === group.id);
    const lastForGroup = groupPrompts[0];
    if (lastForGroup && lastForGroup.createdAt) {
      const lastTs = new Date(lastForGroup.createdAt).getTime();
      if (Date.now() - lastTs < cadenceMs) {
        perGroup.push({ groupId: group.id, outcome: "cadence" });
        continue;
      }
    }

    const recentPatternIds = new Set(groupPrompts.slice(0, 20).map(p => p.patternId));
    const candidate = open.find(p => !recentPatternIds.has(p.id));
    if (!candidate) {
      perGroup.push({ groupId: group.id, outcome: "no fresh pattern" });
      continue;
    }

    let question = "";
    let rationale = "";
    try {
      const prompt = `You are ${config.botName}, hosting a Telegram community. Recent recurring topic: "${candidate.title}". Summary: "${candidate.summary.slice(0, 300)}".

Write ONE short, friendly question (under 200 chars) you can post to the group to gather members' real opinions or experience on this topic. Avoid em dashes. Be casual. Avoid generic filler. No emoji-only.

Output JSON only: {"question": "...", "rationale": "why we ask"}`;
      const resp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 200,
      });
      const content = resp.choices[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { question: candidate.summary, rationale: "" };
      question = String(parsed.question || candidate.summary).slice(0, POSTED_QUESTION_LIMIT);
      rationale = String(parsed.rationale || "").slice(0, 500);
    } catch (err: any) {
      log(`Proactive question generation error: ${err.message}`, "proactive");
      perGroup.push({ groupId: group.id, outcome: "ai error" });
      continue;
    }

    const created = await storage.createProactivePrompt({
      botConfigId: config.id,
      groupId: group.id,
      patternId: candidate.id,
      question,
      rationale,
      status: "queued",
    });
    anyGenerated = true;

    if (config.proactiveMode === "auto") {
      const instance = getActiveBotInstance(config.id);
      if (instance) {
        try {
          await sendBotMessage(instance.bot, parseInt(group.telegramChatId, 10), question);
          await storage.updateProactivePrompt(config.id, created.id, { status: "posted", postedAt: new Date() });
          anyPosted = true;
          perGroup.push({ groupId: group.id, outcome: "posted" });
          continue;
        } catch (err: any) {
          log(`Proactive auto-post failed: ${err.message}`, "proactive");
        }
      }
    }
    perGroup.push({ groupId: group.id, outcome: "queued" });
  }

  if (anyGenerated) {
    await storage.updateBotConfig(config.id, { proactiveLastAt: new Date() });
  }

  return { generated: anyGenerated, posted: anyPosted, perGroup };
}

export async function postProactivePrompt(botConfigId: number, promptId: number): Promise<{ ok: boolean; reason?: string }> {
  const list = await storage.listProactivePrompts(botConfigId, undefined, 200);
  const prompt = list.find((p: ProactivePrompt) => p.id === promptId);
  if (!prompt) return { ok: false, reason: "not found" };
  if (prompt.status === "posted") return { ok: false, reason: "already posted" };

  const groupRow = prompt.groupId ? (await storage.getGroups(botConfigId)).find(g => g.id === prompt.groupId) : null;
  if (!groupRow) return { ok: false, reason: "group not available" };

  const instance = getActiveBotInstance(botConfigId);
  if (!instance) return { ok: false, reason: "bot not running" };

  try {
    await sendBotMessage(instance.bot, parseInt(groupRow.telegramChatId, 10), prompt.question);
    await storage.updateProactivePrompt(botConfigId, promptId, { status: "posted", postedAt: new Date() });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
