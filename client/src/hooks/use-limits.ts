import { useQuery } from "@tanstack/react-query";

export interface LimitsResponse {
  plan: "free" | "pro" | "business";
  planRail: string;
  planPeriodEnd: string | null;
  planCancelAtPeriodEnd: boolean;
  teliPaid: boolean;
  limits: Record<string, number | boolean>;
  pricing: Record<"free" | "pro" | "business", { monthlyUsd: number; annualUsd: number }>;
  teliDiscountPct: number;
  teliRewardsBoostPct: number;
  stripeEnabled: boolean;
  cryptoEnabled: boolean;
  receiveAddress: string | null;
  stripePublishableKey: string | null;
  usage: { bots: number; botsLimit: number };
}

export function useLimits() {
  return useQuery<LimitsResponse>({
    queryKey: ["/api/me/limits"],
    staleTime: 60 * 1000,
  });
}
