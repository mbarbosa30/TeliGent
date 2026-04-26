import { useState, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLimits } from "@/hooks/use-limits";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { Crown, Loader2, Sparkles, CreditCard, Coins, Copy, Check, ExternalLink, X } from "lucide-react";

type Plan = "free" | "pro" | "business";
type Period = "monthly" | "annual";
type Rail = "stripe" | "usdc" | "teli";

const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ["1 bot", "50 KB entries", "200 AI calls / day", "2 groups per bot", "Rewards loop"],
  pro: ["3 bots", "250 KB entries", "1,500 AI calls / day", "10 groups per bot", "Embeddable widget", "Bankr crypto data", "Master Agent API", "ERC-8004 registry"],
  business: ["10 bots", "1,000 KB entries", "8,000 AI calls / day", "50 groups per bot", "Everything in Pro", "Priority limits"],
};

interface PendingIntent {
  id: number;
  status: string;
  plan: string;
  rail: string;
  billingPeriod: string;
  receiveAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  displayAmount: string;
  expiresAt: string;
  txHash?: string | null;
}

const PAID_BANNER_KEY = "teligent.paidBannerSeenForPeriodEnd";

export default function BillingPage() {
  const { data: limits, isLoading } = useLimits();
  const { toast } = useToast();
  const search = useSearch();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState<Plan>("pro");
  const [period, setPeriod] = useState<Period>("monthly");
  const [rail, setRail] = useState<Rail>("stripe");
  const [activeIntentId, setActiveIntentId] = useState<number | null>(null);

  const [deepLinkFeature, setDeepLinkFeature] = useState<string | null>(null);
  const [deepLinkQuota, setDeepLinkQuota] = useState<string | null>(null);

  const { data: pendingData } = useQuery<{ pending: PendingIntent[] }>({
    queryKey: ["/api/billing/crypto/pending"],
    refetchInterval: 12000,
    enabled: !!limits?.cryptoEnabled,
  });
  const pending = pendingData?.pending ?? [];

  const hasPending = pending.length > 0;
  useEffect(() => {
    if (hasPending) {
      const id = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["/api/me/limits"] });
      }, 10000);
      return () => clearInterval(id);
    }
    return;
  }, [hasPending]);

  const [showPaidBanner, setShowPaidBanner] = useState(false);
  useEffect(() => {
    if (!limits) return;
    if (limits.plan !== "free" && limits.planPeriodEnd) {
      const seenFor = typeof window !== "undefined" ? window.localStorage.getItem(PAID_BANNER_KEY) : null;
      if (seenFor !== limits.planPeriodEnd) setShowPaidBanner(true);
      else setShowPaidBanner(false);
    } else {
      setShowPaidBanner(false);
    }
  }, [limits?.plan, limits?.planPeriodEnd]);
  const dismissPaidBanner = () => {
    if (limits?.planPeriodEnd && typeof window !== "undefined") {
      window.localStorage.setItem(PAID_BANNER_KEY, limits.planPeriodEnd);
    }
    setShowPaidBanner(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(search);
    const planParam = params.get("plan");
    const featureParam = params.get("feature");
    const quotaParam = params.get("quota");
    const FEATURE_PLAN: Record<string, Plan> = {
      allowWidget: "pro", allowBankr: "pro", allowAgentApi: "pro",
      allowErc8004: "pro", allowFeedbackDigest: "pro",
    };
    let resolvedPlan: Plan | null = null;
    if (planParam === "pro" || planParam === "business") resolvedPlan = planParam;
    else if (featureParam && FEATURE_PLAN[featureParam]) resolvedPlan = FEATURE_PLAN[featureParam];
    else if (quotaParam) resolvedPlan = "pro";

    if (resolvedPlan) {
      setTargetPlan(resolvedPlan);
      setPeriod("monthly");
      setRail("stripe");
      setUpgradeOpen(true);
      setDeepLinkFeature(featureParam);
      setDeepLinkQuota(quotaParam);
    }
  }, [search]);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/checkout", { plan: targetPlan, billingPeriod: period });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data?.url) window.location.assign(data.url);
    },
    onError: (err: any) => toast({ title: "Checkout failed", description: err.message, variant: "destructive" }),
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data?.url) window.location.assign(data.url);
    },
    onError: (err: any) => toast({ title: "Portal failed", description: err.message, variant: "destructive" }),
  });

  const cryptoIntentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/crypto/intent", { plan: targetPlan, billingPeriod: period, rail });
      return res.json();
    },
    onSuccess: (data: any) => {
      setActiveIntentId(data.intent.id);
      qc.invalidateQueries({ queryKey: ["/api/billing/crypto/pending"] });
    },
    onError: (err: any) => toast({ title: "Could not create payment", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !limits) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const periodEnd = limits.planPeriodEnd ? new Date(limits.planPeriodEnd) : null;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Plans & Billing</h1>
            <p className="text-sm text-muted-foreground mt-1">Pick a plan, pay with cards or crypto. Pay in $TELI for {limits.teliDiscountPct}% off.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="uppercase" data-testid="badge-current-plan">{limits.plan}</Badge>
            {limits.teliPaid && <Badge className="bg-foreground text-background" data-testid="badge-teli-paid">TELI</Badge>}
          </div>
        </div>

        {showPaidBanner && (
          <div className="border bg-foreground/5 p-4 flex items-start justify-between gap-3" data-testid="banner-payment-received">
            <div className="space-y-1">
              <p className="font-mono text-sm uppercase tracking-wider">Payment received</p>
              <p className="text-sm">
                Your <span className="capitalize">{limits.plan}</span> plan is now active until {periodEnd?.toLocaleDateString() ?? "the next billing date"}.
                {limits.teliPaid ? " TELI perks are live across the dashboard." : ""}
              </p>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={dismissPaidBanner} data-testid="button-dismiss-banner">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {pending.length > 0 && (
          <Card className="border-foreground" data-testid="card-pending-intents">
            <CardHeader>
              <CardTitle className="text-base">Pending crypto payments</CardTitle>
              <CardDescription>We're watching the chain for your transfer. If it has been more than a few minutes, paste the transaction hash below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pending.map((p) => (
                <PendingIntentPanel key={p.id} intent={p} />
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current plan</CardTitle>
            <CardDescription>
              {limits.plan === "free"
                ? "You are on the Free plan. Upgrade to unlock the widget, Bankr, the agent API, and ERC-8004."
                : `Active until ${periodEnd ? periodEnd.toLocaleDateString() : "unknown"} via ${limits.planRail || "unknown"}.${limits.planCancelAtPeriodEnd ? " Cancellation scheduled at period end." : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => setUpgradeOpen(true)} data-testid="button-open-upgrade">
              <Sparkles className="h-4 w-4 mr-2" />
              {limits.plan === "free" ? "Upgrade plan" : "Change plan"}
            </Button>
            {limits.plan !== "free" && limits.planRail === "stripe" && (
              <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending} data-testid="button-portal">
                {portalMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
                Manage subscription
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
            <CardDescription>Quotas reset on the first of every month or when you upgrade.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UsageStat label="Bots" current={limits.usage.bots} max={limits.usage.botsLimit} testId="stat-bots" />
            <UsageStat label="KB entries (total)" current={limits.usage.kb} max={limits.usage.kbLimitPerBot * Math.max(1, limits.usage.bots)} testId="stat-kb" suffix=" cap" />
            <UsageStat label="AI calls today (busiest bot)" current={limits.usage.aiCallsTodayMax} max={limits.usage.aiCallsLimitPerBot} testId="stat-ai" suffix=" / day" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["free", "pro", "business"] as Plan[]).map((p) => (
            <PlanCard
              key={p}
              plan={p}
              monthlyUsd={limits.pricing[p].monthlyUsd}
              annualUsd={limits.pricing[p].annualUsd}
              isCurrent={limits.plan === p}
              teliDiscountPct={limits.teliDiscountPct}
              onSelect={() => {
                if (p === "free") return;
                setTargetPlan(p);
                setPeriod("monthly");
                setRail("stripe");
                setUpgradeOpen(true);
              }}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Crown className="h-4 w-4" /> Pay in $TELI, get more</CardTitle>
            <CardDescription>Settle any plan with $TELI on Base for a {limits.teliDiscountPct}% discount, a TELI badge across the dashboard, +{limits.teliRewardsBoostPct}% rewards multiplier on your bots, and 2x agent API rate limits.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={(o) => { setUpgradeOpen(o); if (!o) { setActiveIntentId(null); setDeepLinkFeature(null); setDeepLinkQuota(null); qc.invalidateQueries({ queryKey: ["/api/me/limits"] }); qc.invalidateQueries({ queryKey: ["/api/billing/crypto/pending"] }); } }}
        deepLinkFeature={deepLinkFeature}
        deepLinkQuota={deepLinkQuota}
        plan={targetPlan}
        setPlan={setTargetPlan}
        period={period}
        setPeriod={setPeriod}
        rail={rail}
        setRail={setRail}
        limits={limits}
        onCheckout={() => checkoutMutation.mutate()}
        checkoutPending={checkoutMutation.isPending}
        onCryptoStart={() => cryptoIntentMutation.mutate()}
        cryptoPending={cryptoIntentMutation.isPending}
        intentId={activeIntentId}
      />
    </ScrollArea>
  );
}

function UsageStat({ label, current, max, suffix = "", testId }: { label: string; current: number; max: number; suffix?: string; testId: string }) {
  return (
    <div className="border p-3" data-testid={testId}>
      <div className="text-xs uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="font-mono text-lg mt-1">
        {current}
        <span className="text-muted-foreground text-sm">/{max}{suffix}</span>
      </div>
    </div>
  );
}

function PlanCard({ plan, monthlyUsd, annualUsd, isCurrent, teliDiscountPct, onSelect }: { plan: Plan; monthlyUsd: number; annualUsd: number; isCurrent: boolean; teliDiscountPct: number; onSelect: () => void }) {
  const monthlyTeliUsd = Math.round(monthlyUsd * (1 - teliDiscountPct / 100));
  return (
    <Card className={isCurrent ? "border-foreground" : ""}>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="capitalize">{plan}</span>
          {isCurrent && <Badge variant="secondary">Current</Badge>}
        </CardTitle>
        <CardDescription>
          {plan === "free" ? "Forever free" : (
            <span className="font-mono">${monthlyUsd}/mo · ${annualUsd}/yr · ${monthlyTeliUsd}/mo paid in $TELI</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-xs text-muted-foreground space-y-1">
          {PLAN_FEATURES[plan].map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
        {plan !== "free" && (
          <Button size="sm" variant={isCurrent ? "outline" : "default"} className="w-full" onClick={onSelect} data-testid={`button-select-${plan}`}>
            {isCurrent ? "Manage" : "Upgrade"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  allowWidget: "the embeddable widget",
  allowBankr: "Bankr crypto data",
  allowAgentApi: "the Master Agent API",
  allowErc8004: "ERC-8004 registry",
  allowFeedbackDigest: "the feedback digest",
};

const QUOTA_LABELS: Record<string, string> = {
  maxBots: "more bots",
  maxKbEntries: "more knowledge base entries",
  maxGroupsPerBot: "more groups per bot",
};

function UpgradeDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  plan: Plan;
  setPlan: (p: Plan) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  rail: Rail;
  setRail: (r: Rail) => void;
  limits: any;
  onCheckout: () => void;
  checkoutPending: boolean;
  onCryptoStart: () => void;
  cryptoPending: boolean;
  intentId: number | null;
  deepLinkFeature?: string | null;
  deepLinkQuota?: string | null;
}) {
  const { open, onOpenChange, plan, setPlan, period, setPeriod, rail, setRail, limits, onCheckout, checkoutPending, onCryptoStart, cryptoPending, intentId, deepLinkFeature, deepLinkQuota } = props;
  const contextLabel = deepLinkFeature ? FEATURE_LABELS[deepLinkFeature] : deepLinkQuota ? QUOTA_LABELS[deepLinkQuota] : null;
  const usd = period === "annual" ? limits.pricing[plan].annualUsd : limits.pricing[plan].monthlyUsd;

  const teliQuoteEnabled = open && limits.cryptoEnabled;
  const { data: teliQuote } = useQuery<QuoteResponse>({
    queryKey: ["/api/billing/crypto/quote", { plan, period, rail: "teli" }],
    queryFn: async () => {
      const params = new URLSearchParams({ plan, billingPeriod: period, rail: "teli" });
      const res = await fetch(`/api/billing/crypto/quote?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load quote");
      return res.json();
    },
    enabled: teliQuoteEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const teliLiveAvailable = teliQuote ? teliQuote.liveAvailable && teliQuote.source !== "fallback" : true;
  const teliTabDisabled = !limits.cryptoEnabled || !teliLiveAvailable;

  useEffect(() => {
    if (rail === "teli" && teliTabDisabled) {
      setRail(limits.cryptoEnabled ? "usdc" : "stripe");
    }
  }, [rail, teliTabDisabled, limits.cryptoEnabled, setRail]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle data-testid="text-upgrade-dialog-title">Upgrade to {plan}</DialogTitle>
          <DialogDescription>
            {contextLabel ? <span data-testid="text-upgrade-context">Unlocks {contextLabel}. </span> : null}
            Choose how you'd like to pay. Cards renew automatically. Crypto activates the plan for the period you paid for.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={plan} onValueChange={(v) => setPlan(v as Plan)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="pro" data-testid="tab-plan-pro">Pro</TabsTrigger>
              <TabsTrigger value="business" data-testid="tab-plan-business">Business</TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="monthly" data-testid="tab-period-monthly">Monthly · ${limits.pricing[plan].monthlyUsd}</TabsTrigger>
              <TabsTrigger value="annual" data-testid="tab-period-annual">Annual · ${limits.pricing[plan].annualUsd}</TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={rail} onValueChange={(v) => setRail(v as Rail)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="stripe" disabled={!limits.stripeEnabled} data-testid="tab-rail-stripe">Card</TabsTrigger>
              <TabsTrigger value="usdc" disabled={!limits.cryptoEnabled} data-testid="tab-rail-usdc">USDC</TabsTrigger>
              <TabsTrigger value="teli" disabled={teliTabDisabled} data-testid="tab-rail-teli">$TELI -{limits.teliDiscountPct}%</TabsTrigger>
            </TabsList>

            <TabsContent value="stripe" className="space-y-3 pt-3">
              <div className="text-sm">You'll pay <span className="font-mono">${usd}</span> by card. Cards renew automatically each {period === "annual" ? "year" : "month"}.</div>
              {!limits.stripeEnabled && <p className="text-xs text-destructive">Card payments are not configured yet.</p>}
            </TabsContent>

            <TabsContent value="usdc" className="space-y-3 pt-3">
              <CryptoQuotePreview plan={plan} period={period} rail="usdc" enabled={open && rail === "usdc" && limits.cryptoEnabled} />
              {!limits.cryptoEnabled && <p className="text-xs text-destructive">Crypto checkout is not configured.</p>}
              {intentId && rail === "usdc" && <CryptoIntentWatcher intentId={intentId} />}
            </TabsContent>

            <TabsContent value="teli" className="space-y-3 pt-3">
              <CryptoQuotePreview plan={plan} period={period} rail="teli" enabled={open && rail === "teli" && limits.cryptoEnabled} />
              {!limits.cryptoEnabled && <p className="text-xs text-destructive">Crypto checkout is not configured.</p>}
              {intentId && rail === "teli" && <CryptoIntentWatcher intentId={intentId} />}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {rail === "stripe" ? (
            <Button onClick={onCheckout} disabled={checkoutPending || !limits.stripeEnabled} data-testid="button-stripe-checkout">
              {checkoutPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Pay with card
            </Button>
          ) : (
            <CryptoCheckoutButton
              plan={plan} period={period} rail={rail}
              onCryptoStart={onCryptoStart}
              cryptoPending={cryptoPending}
              cryptoEnabled={!!limits.cryptoEnabled}
              hasIntent={!!intentId}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface QuoteResponse {
  rail: "usdc" | "teli";
  usd: number;
  discountedUsd: number;
  tokenAmount: string;
  tokenSymbol: string;
  tokenDecimals: number;
  usdPerTeli: number | null;
  source: "dexscreener" | "bankr" | "manual_override" | "fallback" | null;
  fetchedAt: string | null;
  liveAvailable: boolean;
}

function CryptoQuotePreview({ plan, period, rail, enabled }: { plan: Plan; period: Period; rail: "usdc" | "teli"; enabled: boolean }) {
  const { data, isLoading, isError } = useQuery<QuoteResponse>({
    queryKey: ["/api/billing/crypto/quote", { plan, period, rail }],
    queryFn: async () => {
      const params = new URLSearchParams({ plan, billingPeriod: period, rail });
      const res = await fetch(`/api/billing/crypto/quote?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load quote");
      return res.json();
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!enabled) return null;
  if (isLoading) {
    return <p className="text-xs text-muted-foreground" data-testid="text-quote-loading">Fetching live rate…</p>;
  }
  if (isError || !data) {
    return <p className="text-xs text-destructive" data-testid="text-quote-error">Could not load a live quote. Try the other rail or refresh.</p>;
  }

  const sourceLabel: Record<string, string> = {
    dexscreener: "DexScreener",
    bankr: "Bankr",
    manual_override: "manual override",
    fallback: "stale fallback",
  };
  const fetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;

  if (rail === "usdc") {
    return (
      <div className="border p-3 text-sm space-y-1" data-testid="quote-usdc">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground tracking-wider">Plan price</span>
          <span className="font-mono">${data.usd.toFixed(2)}/{period === "annual" ? "yr" : "mo"}</span>
        </div>
        <div className="flex items-center justify-between border-t pt-2 mt-2">
          <span className="text-xs uppercase text-muted-foreground tracking-wider">You'll send</span>
          <span className="font-mono text-base" data-testid="text-quote-amount">{data.tokenAmount} USDC</span>
        </div>
        <p className="text-xs text-muted-foreground">USDC on Base. We'll wait for your transfer.</p>
      </div>
    );
  }

  const liveOk = data.liveAvailable && data.source !== "fallback";
  return (
    <div className="border p-3 text-sm space-y-2" data-testid="quote-teli">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground tracking-wider">Plan price</span>
        <span className="font-mono">${data.usd.toFixed(2)}/{period === "annual" ? "yr" : "mo"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground tracking-wider">After $TELI discount</span>
        <span className="font-mono">${data.discountedUsd.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground tracking-wider">Live rate</span>
        <span className="font-mono text-xs" data-testid="text-quote-rate">
          ${data.usdPerTeli?.toFixed(6) ?? "—"} / $TELI
        </span>
      </div>
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-xs uppercase text-muted-foreground tracking-wider">You'll send</span>
        <span className="font-mono text-base" data-testid="text-quote-amount">{data.tokenAmount} TELI</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Source: {data.source ? sourceLabel[data.source] : "—"}
        {fetchedAt ? ` · updated ${fetchedAt.toLocaleTimeString()}` : ""}
        {!liveOk ? " · live feed unavailable" : ""}
      </p>
      {!liveOk && (
        <p className="text-xs text-destructive" data-testid="text-quote-stale">Live $TELI/USD price unavailable right now. Pay with USDC or try again shortly.</p>
      )}
    </div>
  );
}

function CryptoCheckoutButton({ plan, period, rail, onCryptoStart, cryptoPending, cryptoEnabled, hasIntent }: { plan: Plan; period: Period; rail: Rail; onCryptoStart: () => void; cryptoPending: boolean; cryptoEnabled: boolean; hasIntent: boolean }) {
  const railNarrow = rail === "teli" ? "teli" : "usdc";
  const { data } = useQuery<QuoteResponse>({
    queryKey: ["/api/billing/crypto/quote", { plan, period, rail: railNarrow }],
    queryFn: async () => {
      const params = new URLSearchParams({ plan, billingPeriod: period, rail: railNarrow });
      const res = await fetch(`/api/billing/crypto/quote?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load quote");
      return res.json();
    },
    enabled: cryptoEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const liveOk = railNarrow === "usdc" || (!!data && data.liveAvailable && data.source !== "fallback");
  return (
    <Button
      onClick={onCryptoStart}
      disabled={cryptoPending || !cryptoEnabled || hasIntent || !liveOk}
      data-testid="button-crypto-checkout"
    >
      {cryptoPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Coins className="h-4 w-4 mr-2" />}
      Generate payment
    </Button>
  );
}

function CryptoIntentWatcher({ intentId }: { intentId: number }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/crypto/intent", intentId],
    refetchInterval: 8000,
  });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (data?.status === "matched") {
      toast({ title: "Payment received", description: "Your plan is now active." });
      qc.invalidateQueries({ queryKey: ["/api/me/limits"] });
      qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
      qc.invalidateQueries({ queryKey: ["/api/billing/crypto/pending"] });
    }
  }, [data?.status, toast]);

  if (isLoading || !data) return <p className="text-xs text-muted-foreground">Preparing payment…</p>;

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="border p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-muted-foreground">Status</span>
        <Badge variant={data.status === "matched" ? "default" : "secondary"} data-testid="text-intent-status">{data.status}</Badge>
      </div>
      <Row label="Send exactly" value={`${data.displayAmount} ${data.tokenSymbol}`} onCopy={() => copy("amount", data.displayAmount)} copied={copied === "amount"} testId="row-amount" />
      <Row label="To address" value={data.receiveAddress} onCopy={() => copy("addr", data.receiveAddress)} copied={copied === "addr"} testId="row-address" />
      <Row label="Token contract" value={data.tokenAddress} onCopy={() => copy("token", data.tokenAddress)} copied={copied === "token"} testId="row-token" />
      <p className="text-xs text-muted-foreground">Network: Base. Send the exact amount shown — the trailing digits are how we match your transfer.</p>
      {data.txHash && (
        <a href={`https://basescan.org/tx/${data.txHash}`} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 underline">
          View on Basescan <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function PendingIntentPanel({ intent }: { intent: PendingIntent }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [showClaim, setShowClaim] = useState(false);
  const [txHashInput, setTxHashInput] = useState("");

  const expiresAt = useMemo(() => new Date(intent.expiresAt), [intent.expiresAt]);
  const expired = expiresAt.getTime() < Date.now();

  const claimMutation = useMutation({
    mutationFn: async (hash: string) => {
      const res = await apiRequest("POST", `/api/billing/crypto/intent/${intent.id}/claim`, { txHash: hash });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.result?.status === "matched") {
        toast({ title: "Payment matched", description: "Your plan is now active." });
      } else if (data.result?.status === "already_matched") {
        toast({ title: "Already activated", description: "This payment was already credited to your plan." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/me/limits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/crypto/pending"] });
      setShowClaim(false);
      setTxHashInput("");
    },
    onError: (err: any) => toast({ title: "Could not match transaction", description: err.message, variant: "destructive" }),
  });

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="border p-3 space-y-3 text-sm" data-testid={`pending-intent-${intent.id}`}>
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs uppercase text-muted-foreground tracking-wider">{intent.plan} · {intent.billingPeriod} · {intent.rail.toUpperCase()}</p>
          <p className="font-mono text-base">{intent.displayAmount} {intent.tokenSymbol}</p>
        </div>
        <Badge variant={expired ? "destructive" : "secondary"} data-testid={`badge-intent-status-${intent.id}`}>
          {expired ? "expired" : intent.status}
        </Badge>
      </div>
      {!expired && (
        <>
          <Row label="To address" value={intent.receiveAddress} onCopy={() => copy(`addr-${intent.id}`, intent.receiveAddress)} copied={copied === `addr-${intent.id}`} testId={`row-pending-address-${intent.id}`} />
          <Row label="Token contract" value={intent.tokenAddress} onCopy={() => copy(`tok-${intent.id}`, intent.tokenAddress)} copied={copied === `tok-${intent.id}`} testId={`row-pending-token-${intent.id}`} />
          <p className="text-xs text-muted-foreground">Expires {expiresAt.toLocaleString()}. We're watching the chain — most transfers match within ~5 minutes.</p>
        </>
      )}

      {!expired && !showClaim && (
        <Button size="sm" variant="outline" onClick={() => setShowClaim(true)} data-testid={`button-show-claim-${intent.id}`}>
          I already sent it
        </Button>
      )}
      {!expired && showClaim && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Paste the Base transaction hash to match it manually.</p>
          <div className="flex gap-2">
            <Input
              value={txHashInput}
              onChange={(e) => setTxHashInput(e.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
              data-testid={`input-tx-hash-${intent.id}`}
            />
            <Button
              size="sm"
              onClick={() => claimMutation.mutate(txHashInput.trim())}
              disabled={claimMutation.isPending || !txHashInput.trim()}
              data-testid={`button-submit-claim-${intent.id}`}
            >
              {claimMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Match"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowClaim(false); setTxHashInput(""); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, onCopy, copied, testId }: { label: string; value: string; onCopy: () => void; copied: boolean; testId: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <code className="flex-1 font-mono text-xs truncate" title={value}>{value}</code>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCopy}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}
