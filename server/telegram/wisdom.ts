import { storage } from "../storage";

export interface WisdomComponents {
  pattern: number;
  confidence: number;
  contributor: number;
  depth: number;
  diversity: number;
  volume: number;
  growth: number;
  maturity: number;
}

export async function computeWisdomScore(botConfigId: number): Promise<{ score: number; components: WisdomComponents; details: any }> {
  const [patterns, kbEntries, recentUsers30, recentUsers7, snapshots, day14, day7] = await Promise.all([
    storage.getCollectivePatterns(botConfigId),
    storage.getActiveKnowledgeEntries(botConfigId),
    storage.countDistinctUsers(botConfigId, 30),
    storage.countDistinctUsers(botConfigId, 7),
    storage.getWisdomSnapshots(botConfigId, 5),
    storage.getActivityCountsByDay(botConfigId, 14),
    storage.getActivityCountsByDay(botConfigId, 7),
  ]);

  const totalPatterns = patterns.length;
  const promotedKnown = patterns.filter(p => p.status === "known").length;
  const avgConf = patterns.length ? patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length : 0;
  const avgUsers = patterns.length ? patterns.reduce((s, p) => s + p.uniqueUsers, 0) / patterns.length : 0;
  const totalMentions = patterns.reduce((s, p) => s + p.mentionCount, 0);
  const distinctKinds = new Set(patterns.map(p => p.kind)).size;

  const pattern = Math.min(100, totalPatterns * 4);
  const confidence = Math.round(avgConf);
  const contributor = Math.min(100, recentUsers30 * 5);
  const depth = Math.min(100, kbEntries.length * 6 + promotedKnown * 4);
  const diversity = Math.min(100, distinctKinds * 20);
  const volume = Math.min(100, totalMentions * 2);

  const sumLast7 = day7.reduce((s, d) => s + d.count, 0);
  const sumPrev7 = day14.slice(0, Math.max(0, day14.length - 7)).reduce((s, d) => s + d.count, 0);
  const growthRatio = sumPrev7 > 0 ? (sumLast7 - sumPrev7) / sumPrev7 : (sumLast7 > 0 ? 1 : 0);
  const growth = Math.max(0, Math.min(100, 50 + Math.round(growthRatio * 50)));

  const oldestFirstSeen = patterns.length
    ? Math.min(...patterns.map(p => new Date(p.firstSeenAt).getTime()))
    : Date.now();
  const ageDays = patterns.length ? (Date.now() - oldestFirstSeen) / (24 * 3600 * 1000) : 0;
  const maturity = Math.min(100, Math.round(ageDays * 3) + Math.min(40, recentUsers7 * 4));

  const components: WisdomComponents = { pattern, confidence, contributor, depth, diversity, volume, growth, maturity };
  const score = Math.round((pattern + confidence + contributor + depth + diversity + volume + growth + maturity) / 8);

  return {
    score,
    components,
    details: {
      totalPatterns, promotedKnown, totalMentions, kbEntries: kbEntries.length,
      activeUsers30d: recentUsers30, activeUsers7d: recentUsers7,
      messages7d: sumLast7, messagesPrev7d: sumPrev7,
      previousScore: snapshots[0]?.score ?? null,
    },
  };
}

const lastSnapshotAt = new Map<number, number>();
const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function maybeSnapshotWisdom(botConfigId: number): Promise<void> {
  const now = Date.now();
  const last = lastSnapshotAt.get(botConfigId) || 0;
  if (now - last < SNAPSHOT_INTERVAL_MS) return;
  lastSnapshotAt.set(botConfigId, now);
  try {
    const { score, components } = await computeWisdomScore(botConfigId);
    await storage.createWisdomSnapshot(botConfigId, score, components);
  } catch {}
}
