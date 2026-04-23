import { Lock } from "lucide-react";
import { Link } from "wouter";
import { useLimits, type LimitsResponse } from "@/hooks/use-limits";

type FeatureKey = keyof Pick<
  LimitsResponse["limits"],
  "allowWidget" | "allowBankr" | "allowAgentApi" | "allowErc8004" | "allowFeedbackDigest" | "allowRewards"
>;

export function useFeatureAllowed(feature: FeatureKey): { allowed: boolean; tier: string; loaded: boolean } {
  const { data, isLoading } = useLimits();
  if (isLoading || !data) return { allowed: true, tier: "free", loaded: false };
  return { allowed: !!data.limits[feature], tier: (data as any).plan ?? "free", loaded: true };
}

export function TierLockedHint({ feature, requiredPlan = "Pro" }: { feature: FeatureKey; requiredPlan?: string }) {
  const { allowed, loaded } = useFeatureAllowed(feature);
  if (!loaded || allowed) return null;
  return (
    <Link href="/billing">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wider border bg-muted hover:bg-muted/70 cursor-pointer"
        data-testid={`tier-lock-${feature}`}
      >
        <Lock className="h-3 w-3" /> {requiredPlan}
      </span>
    </Link>
  );
}

export function TierLockedBanner({ feature, requiredPlan = "Pro", message }: { feature: FeatureKey; requiredPlan?: string; message?: string }) {
  const { allowed, loaded, tier } = useFeatureAllowed(feature);
  if (!loaded || allowed) return null;
  return (
    <div className="border bg-muted/40 px-3 py-2 text-xs flex items-center justify-between gap-3" data-testid={`tier-banner-${feature}`}>
      <span className="text-muted-foreground">
        {message || `This feature is not available on the ${tier} plan. Upgrade to ${requiredPlan} to enable it.`}
      </span>
      <Link href="/billing">
        <span className="px-2 py-1 border bg-background hover:bg-muted/50 cursor-pointer uppercase tracking-wider">Upgrade</span>
      </Link>
    </div>
  );
}

export function useBotQuota(): { atLimit: boolean; current: number; limit: number; loaded: boolean } {
  const { data, isLoading } = useLimits();
  if (isLoading || !data) return { atLimit: false, current: 0, limit: 0, loaded: false };
  return { atLimit: data.usage.bots >= data.usage.botsLimit, current: data.usage.bots, limit: data.usage.botsLimit, loaded: true };
}
