import { storage } from "../storage";
import { log } from "../index";
import { openai, sendBotMessage } from "./utils";
import type { BotConfig, ProactivePrompt } from "@shared/schema";
import { getActiveBotInstance } from "./instance-registry";

const POSTED_QUESTION_LIMIT = 600;

export const FEEDBACK_THEMES = [
  "improvements",
  "feature_requests",
  "pain_points",
  "missing_info",
  "success_stories",
  "general",
] as const;
export type FeedbackTheme = typeof FEEDBACK_THEMES[number];
const FEEDBACK_THEME_SET: Set<string> = new Set(FEEDBACK_THEMES);

const THEME_LABELS: Record<string, string> = {
  improvements: "what could be better",
  feature_requests: "what new features people want",
  pain_points: "frustrations and friction",
  missing_info: "knowledge gaps or unclear topics",
  success_stories: "wins and what's working",
  general: "an open check-in on how things are going",
};

function pickFeedbackTheme(config: BotConfig, recentThemes: string[]): string | null {
  const enabledThemes = (config.feedbackThemes && config.feedbackThemes.length > 0)
    ? config.feedbackThemes.filter((t): t is FeedbackTheme => FEEDBACK_THEME_SET.has(t))
    : (["improvements", "feature_requests", "pain_points"] as FeedbackTheme[]);
  if (enabledThemes.length === 0) return null;
  const recentSet = new Set(recentThemes);
  const fresh = enabledThemes.filter(t => !recentSet.has(t));
  const pool = fresh.length > 0 ? fresh : enabledThemes;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateFeedbackQuestion(config: BotConfig, theme: string, topKbTopic: string | null): Promise<{ question: string; rationale: string }> {
  const { tryConsumeAiBudget } = await import("../ai-budget");
  const allowed = await tryConsumeAiBudget(config.id);
  if (!allowed) {
    log(`Proactive feedback question skipped (daily AI budget exhausted) for bot ${config.id}`, "ai-budget");
    return { question: `How's it going? Reply here with anything on your mind.`, rationale: "ai_budget_exhausted" };
  }
  const themeLabel = THEME_LABELS[theme] || theme;
  const personality = (config.personality && config.personality.trim()) ? `\nYour voice: ${config.personality.slice(0, 240)}` : "";
  const ctx = (config.globalContext && config.globalContext.trim()) ? `\nProject context: ${config.globalContext.slice(0, 400)}` : "";
  const topicHint = topKbTopic ? `\nA recurring topic in the knowledge base: "${topKbTopic.slice(0, 160)}". Reference it only if it fits naturally.` : "";
  const prompt = `You are ${config.botName}, hosting a Telegram community.${personality}${ctx}${topicHint}

Ask the group ONE short, friendly open question (under 200 chars) inviting honest feedback about: ${themeLabel}.

Avoid em dashes. Be casual and specific to this community. No emoji-only. Encourage replies (mention they can just reply to this message).

Output JSON only: {"question": "...", "rationale": "why we ask"}`;
  const resp = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 200,
  });
  const content = resp.choices[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { question: `How's it going with ${themeLabel}? Reply here with anything on your mind.`, rationale: "" };
  const question = String(parsed.question || "").slice(0, POSTED_QUESTION_LIMIT) || `How's it going with ${themeLabel}? Reply here with anything on your mind.`;
  const rationale = String(parsed.rationale || `Gather ${theme} feedback`).slice(0, 500);
  return { question, rationale };
}

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

  // Runtime tier gate: feedback digest is a Pro+ feature. If the owner downgraded,
  // disable it here even if the per-bot toggle is still on.
  const { getLimitsForBotAsync: _getOwnerLimits } = await import("../limits");
  const ownerLimits = await _getOwnerLimits(config.id).catch(() => null);
  const feedbackEnabled = !!config.feedbackEnabled && !!ownerLimits?.allowFeedbackDigest;
  const mixRatio = Math.max(0, Math.min(100, config.feedbackMixRatio ?? 40));

  if (open.length === 0 && !feedbackEnabled) return { generated: false, posted: false, reason: "no patterns" };

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

    const useFeedback = feedbackEnabled && (open.length === 0 || Math.random() * 100 < mixRatio);
    let topKbTopic: string | null = null;
    if (useFeedback || (open.length === 0 && feedbackEnabled)) {
      try {
        const kb = await storage.getKnowledgeEntries(config.id);
        const active = kb.filter(e => e.isActive);
        if (active.length > 0) {
          const pick = active[Math.floor(Math.random() * Math.min(5, active.length))];
          topKbTopic = pick.title || null;
        }
      } catch {
        // optional personalisation, ignore failures
      }
    }

    let question = "";
    let rationale = "";
    let kind: "pattern" | "feedback" = "pattern";
    let theme: string | null = null;
    let patternId: number | null = null;

    if (useFeedback) {
      const recentThemes = groupPrompts.slice(0, 8).map(p => p.theme).filter((t): t is string => !!t);
      const picked = pickFeedbackTheme(config, recentThemes);
      if (!picked) {
        perGroup.push({ groupId: group.id, outcome: "no themes" });
        continue;
      }
      try {
        const out = await generateFeedbackQuestion(config, picked, topKbTopic);
        question = out.question;
        rationale = out.rationale;
        kind = "feedback";
        theme = picked;
      } catch (err: any) {
        log(`Proactive feedback generation error: ${err.message}`, "proactive");
        perGroup.push({ groupId: group.id, outcome: "ai error" });
        continue;
      }
    } else {
      const recentPatternIds = new Set(groupPrompts.slice(0, 20).map(p => p.patternId));
      const candidate = open.find(p => !recentPatternIds.has(p.id));
      if (!candidate) {
        if (feedbackEnabled) {
          const recentThemes = groupPrompts.slice(0, 8).map(p => p.theme).filter((t): t is string => !!t);
          const picked = pickFeedbackTheme(config, recentThemes);
          if (!picked) { perGroup.push({ groupId: group.id, outcome: "no fresh pattern" }); continue; }
          try {
            const out = await generateFeedbackQuestion(config, picked, topKbTopic);
            question = out.question;
            rationale = out.rationale;
            kind = "feedback";
            theme = picked;
          } catch (err: any) {
            log(`Proactive feedback fallback generation error: ${err.message}`, "proactive");
            perGroup.push({ groupId: group.id, outcome: "ai error" });
            continue;
          }
        } else {
          perGroup.push({ groupId: group.id, outcome: "no fresh pattern" });
          continue;
        }
      } else {
        try {
          const prompt = `You are ${config.botName}, hosting a Telegram community. Recent recurring topic: "${candidate.title}". Summary: "${candidate.summary.slice(0, 300)}".

Write ONE short, friendly question (under 200 chars) you can post to the group to gather members' real opinions or experience on this topic. Avoid em dashes. Be casual. Avoid generic filler. No emoji-only.

Output JSON only: {"question": "...", "rationale": "why we ask"}`;
          const { tryConsumeAiBudget } = await import("../ai-budget");
          const allowed = await tryConsumeAiBudget(config.id);
          if (!allowed) {
            log(`Proactive pattern question skipped (daily AI budget exhausted) for bot ${config.id}`, "ai-budget");
            perGroup.push({ groupId: group.id, outcome: "ai_budget_exhausted" });
            continue;
          }
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
          patternId = candidate.id;
        } catch (err: any) {
          log(`Proactive question generation error: ${err.message}`, "proactive");
          perGroup.push({ groupId: group.id, outcome: "ai error" });
          continue;
        }
      }
    }

    const created = await storage.createProactivePrompt({
      botConfigId: config.id,
      groupId: group.id,
      patternId,
      kind,
      theme,
      question,
      rationale,
      status: "queued",
    });
    anyGenerated = true;

    if (config.proactiveMode === "auto") {
      const instance = getActiveBotInstance(config.id);
      if (instance) {
        try {
          const sent = await sendBotMessage(instance.bot, parseInt(group.telegramChatId, 10), question);
          await storage.updateProactivePrompt(config.id, created.id, { status: "posted", postedAt: new Date(), postedMessageId: sent?.message_id ?? null });
          anyPosted = true;
          perGroup.push({ groupId: group.id, outcome: `posted:${kind}` });
          continue;
        } catch (err: any) {
          log(`Proactive auto-post failed: ${err.message}`, "proactive");
        }
      }
    }
    perGroup.push({ groupId: group.id, outcome: `queued:${kind}` });
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
    const sent = await sendBotMessage(instance.bot, parseInt(groupRow.telegramChatId, 10), prompt.question);
    await storage.updateProactivePrompt(botConfigId, promptId, { status: "posted", postedAt: new Date(), postedMessageId: sent?.message_id ?? null });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
