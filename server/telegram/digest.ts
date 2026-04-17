import { storage } from "../storage";
import { openai } from "./utils";
import { computeWisdomScore, type WisdomScoreResult } from "./wisdom";
import type { CollectivePattern } from "@shared/schema";

export interface WeeklyDigest {
  summary: string;
  bullets: string[];
  wisdom: WisdomScoreResult;
  messages7d: number;
  activityByDay: { day: string; count: number }[];
  topByMentions: CollectivePattern[];
  openQuestions: CollectivePattern[];
  pitfalls: CollectivePattern[];
  strategies: CollectivePattern[];
  scoreTrend: { at: Date; score: number }[];
}

interface DigestParseShape {
  summary?: unknown;
  bullets?: unknown;
}

const cache = new Map<number, { at: number; data: WeeklyDigest }>();
const TTL_MS = 30 * 60 * 1000;

export async function generateWeeklyDigest(botConfigId: number): Promise<WeeklyDigest> {
  const cached = cache.get(botConfigId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const [patterns, wisdom, day7, snapshots, kbEntries] = await Promise.all([
    storage.getCollectivePatterns(botConfigId),
    computeWisdomScore(botConfigId),
    storage.getActivityCountsByDay(botConfigId, 7),
    storage.getWisdomSnapshots(botConfigId, 14),
    storage.getActiveKnowledgeEntries(botConfigId),
  ]);

  const STOPWORDS = new Set(["the","a","an","is","it","to","of","in","on","for","and","or","but","i","you","we","they","this","that","be","do","what","how","why","when","where","can","does","with","at","as","by","from"]);
  const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));
  const kbTokenSets = kbEntries.map(e => new Set(tokenize(`${e.title} ${e.content}`)));
  const isKbAnswerable = (p: CollectivePattern): boolean => {
    const qTokens = new Set([...tokenize(`${p.title} ${p.summary}`), ...p.keywords.map(k => k.toLowerCase())]);
    if (qTokens.size === 0) return false;
    for (const kbSet of kbTokenSets) {
      if (kbSet.size === 0) continue;
      let overlap = 0;
      qTokens.forEach(t => { if (kbSet.has(t)) overlap++; });
      const ratio = overlap / qTokens.size;
      if (ratio >= 0.5) return true;
    }
    return false;
  };

  const recent = patterns.filter(p => Date.now() - new Date(p.lastSeenAt).getTime() < 7 * 24 * 3600 * 1000);
  const topByMentions = [...recent].sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 8);
  const newOpenQuestions = recent.filter(p => p.kind === "question" && p.status === "open" && !isKbAnswerable(p)).slice(0, 5);
  const pitfalls = recent.filter(p => p.kind === "pitfall").slice(0, 5);
  const strategies = recent.filter(p => p.kind === "strategy").slice(0, 5);

  const messages7d = day7.reduce((s, d) => s + d.count, 0);
  let summary = "";
  let bullets: string[] = [];
  if (topByMentions.length > 0) {
    try {
      const prompt = `You are summarizing one week of community activity for a Telegram group manager.

Stats:
- Wisdom score: ${wisdom.score}/100
- Messages this week: ${messages7d}
- Top topics: ${topByMentions.map(p => `"${p.title}" (${p.mentionCount}x, ${p.kind})`).join(", ")}
- Open questions: ${newOpenQuestions.map(p => `"${p.title}"`).join(", ") || "none"}
- Pitfalls: ${pitfalls.map(p => `"${p.title}"`).join(", ") || "none"}
- Strategies: ${strategies.map(p => `"${p.title}"`).join(", ") || "none"}

Output JSON only, no prose, no markdown fences:
{"summary":"<one short sentence>","bullets":["<insight 1>","<insight 2>","<insight 3>","<insight 4>","<insight 5>"]}

Rules:
- Exactly 3 to 5 bullets, each a short standalone insight, no bullet markers in the text.
- Plain language. No emoji. No em dashes. No marketing fluff.
- Each bullet must reference real data from above (a topic name, a count, a trend, an open question, etc).`;
      const resp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
        response_format: { type: "json_object" },
      });
      const raw = resp.choices[0]?.message?.content?.trim() || "";
      try {
        const parsed = JSON.parse(raw) as DigestParseShape;
        if (typeof parsed.summary === "string") summary = parsed.summary.trim();
        if (Array.isArray(parsed.bullets)) {
          bullets = (parsed.bullets as unknown[])
            .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
            .map((b) => b.trim().replace(/^[-*•]\s*/, ""))
            .slice(0, 5);
        }
      } catch {}
    } catch {}
  }
  if (!summary) {
    summary = topByMentions.length === 0
      ? `Quiet week. ${messages7d} messages tracked. Wisdom score is ${wisdom.score}/100.`
      : `${messages7d} messages this week. Top topic: "${topByMentions[0].title}" (${topByMentions[0].mentionCount} mentions). Wisdom score is ${wisdom.score}/100.`;
  }
  if (bullets.length < 3) {
    bullets = [];
    bullets.push(`Wisdom score sits at ${wisdom.score}/100 with ${messages7d} messages logged this week.`);
    if (topByMentions[0]) bullets.push(`Most discussed: "${topByMentions[0].title}" with ${topByMentions[0].mentionCount} mentions.`);
    if (newOpenQuestions[0]) bullets.push(`${newOpenQuestions.length} open question${newOpenQuestions.length === 1 ? "" : "s"} unresolved, starting with "${newOpenQuestions[0].title}".`);
    if (pitfalls[0]) bullets.push(`Recurring pitfall: "${pitfalls[0].title}" (${pitfalls[0].mentionCount} mentions).`);
    if (strategies[0]) bullets.push(`Working strategy: "${strategies[0].title}" came up ${strategies[0].mentionCount} times.`);
    if (bullets.length < 3) bullets.push(`${recent.length} active patterns tracked across ${recent.filter(p => p.kind === "topic").length} topics.`);
    bullets = bullets.slice(0, 5);
  }

  const result = {
    summary,
    bullets,
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
