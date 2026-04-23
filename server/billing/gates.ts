import type { Request, Response, NextFunction } from "express";
import type { User } from "@shared/models/auth";
import { getEffectivePlan, getLimitsForUser, type Limits, type PlanTier } from "../limits";
import { storage } from "../storage";

type FeatureKey = "allowWidget" | "allowBankr" | "allowAgentApi" | "allowErc8004" | "allowFeedbackDigest" | "allowRewards";
type QuotaKey = "maxBots" | "maxKbEntries" | "maxGroupsPerBot";

export class PaywallError extends Error {
  status = 402;
  code = "upgrade_required";
  constructor(public details: { feature?: string; quota?: string; currentPlan: PlanTier; requiredPlan: PlanTier; current?: number; limit?: number; message: string }) {
    super(details.message);
    this.name = "PaywallError";
  }
  toJson() {
    return { code: this.code, ...this.details };
  }
}

const FEATURE_REQUIRED_PLAN: Record<FeatureKey, PlanTier> = {
  allowWidget: "pro",
  allowBankr: "pro",
  allowAgentApi: "pro",
  allowErc8004: "pro",
  allowFeedbackDigest: "pro",
  allowRewards: "free",
};

function nextQuotaTier(currentPlan: PlanTier, key: QuotaKey): PlanTier {
  if (currentPlan === "free") return "pro";
  if (currentPlan === "pro") return "business";
  return "business";
}

export function requirePermission(user: User | null | undefined, feature: FeatureKey): void {
  const limits = getLimitsForUser(user);
  if (limits[feature]) return;
  const currentPlan = getEffectivePlan(user);
  throw new PaywallError({
    feature,
    currentPlan,
    requiredPlan: FEATURE_REQUIRED_PLAN[feature],
    message: `Your ${currentPlan} plan does not include this feature. Upgrade to ${FEATURE_REQUIRED_PLAN[feature]} to enable it.`,
  });
}

export function requireQuota(user: User | null | undefined, key: QuotaKey, currentCount: number): void {
  const limits = getLimitsForUser(user);
  const limit = limits[key] as number;
  if (currentCount < limit) return;
  const currentPlan = getEffectivePlan(user);
  const required = nextQuotaTier(currentPlan, key);
  throw new PaywallError({
    quota: key,
    current: currentCount,
    limit,
    currentPlan,
    requiredPlan: required,
    message: `${key} limit reached on ${currentPlan} plan (${currentCount}/${limit}). Upgrade to ${required} for more.`,
  });
}

export async function loadUserOrThrow(userId: string | undefined): Promise<User> {
  if (!userId) throw new Error("Missing user");
  const user = await storage.getUserById(userId);
  if (!user) throw new Error("User not found");
  return user;
}

export function paywallErrorMiddleware(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof PaywallError) {
    return res.status(402).json(err.toJson());
  }
  return next(err);
}

export type { Limits };
