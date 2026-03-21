import { runDeterministicScamCheck, aiScamCheck } from "../telegram/scam-detection";
import { normalizeUnicode } from "../telegram/normalization";
import { storage } from "../storage";
import { log } from "../index";

export interface ThreatCheckResult {
  isScam: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  method: "deterministic" | "ai" | "none";
  normalizedText: string;
}

export async function performThreatCheck(text: string, useAI: boolean = false): Promise<ThreatCheckResult> {
  if (!text || text.trim().length < 5) {
    return {
      isScam: false,
      confidence: "low",
      reason: "Text too short to analyze",
      method: "none",
      normalizedText: text || "",
    };
  }

  const normalized = normalizeUnicode(text);

  const deterministicResult = runDeterministicScamCheck(text);
  if (deterministicResult.isScam) {
    return {
      isScam: true,
      confidence: "high",
      reason: deterministicResult.reason,
      method: "deterministic",
      normalizedText: normalized,
    };
  }

  if (useAI) {
    try {
      const aiResult = await aiScamCheck(text, "member");
      if (aiResult.isScam) {
        return {
          isScam: true,
          confidence: "medium",
          reason: `AI: ${aiResult.reason}`,
          method: "ai",
          normalizedText: normalized,
        };
      }
    } catch (err: any) {
      log(`Agent AI threat check error: ${err.message}`, "agent");
    }
  }

  return {
    isScam: false,
    confidence: "high",
    reason: "No threats detected",
    method: useAI ? "ai" : "deterministic",
    normalizedText: normalized,
  };
}

export async function getCommunityHealthStats(): Promise<{
  totalGroups: number;
  totalScamsDetected: number;
  totalBotsActive: number;
  activeSince: string;
}> {
  const stats = await storage.getPublicStats();
  return {
    totalGroups: stats.groupsProtected,
    totalScamsDetected: stats.scamsCaught,
    totalBotsActive: stats.botsActive,
    activeSince: "2026-03-01",
  };
}
