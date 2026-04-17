import { storage } from "../storage";
import { openai } from "./utils";
import { computeWisdomScore } from "./wisdom";

const cache = new Map<number, { at: number; data: any }>();
const TTL_MS = 30 * 60 * 1000;

export async function generateWeeklyDigest(botConfigId: number): Promise<any> {
  const cached = cache.get(botConfigId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const [patterns, wisdom, day7, snapshots] = await Promise.all([
    storage.getCollectivePatterns(botConfigId),
    computeWisdomScore(botConfigId),
    storage.getActivityCountsByDay(botConfigId, 7),
    storage.getWisdomSnapshots(botConfigId, 14),
  ]);

  const recent = patterns.filter(p => Date.now() - new Date(p.lastSeenAt).getTime() < 7 * 24 * 3600 * 1000);
  const topByMentions = [...recent].sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 8);
  const newOpenQuestions = recent.filter(p => p.kind === "question" && p.status === "open").slice(0, 5);
  const pitfalls = recent.filter(p => p.kind === "pitfall").slice(0, 5);
  const strategies = recent.filter(p => p.kind === "strategy").slice(0, 5);

  const messages7d = day7.reduce((s, d) => s + d.count, 0);
  let summary = "";
  if (topByMentions.length > 0) {
    try {
      const prompt = `Write a concise 3-sentence weekly community summary for a Telegram group manager. Mention the wisdom score (${wisdom.score}/100), total messages this week (${messages7d}), and the single most active topic. Be plain, no marketing fluff, no emoji, no em dashes.

Top topics: ${topByMentions.map(p => `"${p.title}" (${p.mentionCount}x)`).join(", ")}`;
      const resp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 200,
      });
      summary = resp.choices[0]?.message?.content?.trim() || "";
    } catch {}
  }
  if (!summary) {
    summary = topByMentions.length === 0
      ? `Quiet week. ${messages7d} messages tracked. Wisdom score is ${wisdom.score}/100.`
      : `${messages7d} messages this week. Top topic: "${topByMentions[0].title}" (${topByMentions[0].mentionCount} mentions). Wisdom score is ${wisdom.score}/100.`;
  }

  const result = {
    summary,
    wisdom,
    messages7d,
    activityByDay: day7,
    topByMentions,
    openQuestions: newOpenQuestions,
    pitfalls,
    strategies,
    scoreTrend: snapshots.map(s => ({ at: s.createdAt, score: s.score })).reverse(),
  };
  cache.set(botConfigId, { at: Date.now(), data: result });
  return result;
}

export function invalidateDigestCache(botConfigId: number) {
  cache.delete(botConfigId);
}
