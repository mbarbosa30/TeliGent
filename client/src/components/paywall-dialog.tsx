import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lock } from "lucide-react";
import { PAYWALL_EVENT, type PaywallDetails } from "@/lib/queryClient";

const FEATURE_LABELS: Record<string, string> = {
  allowWidget: "Embeddable widget",
  allowBankr: "Bankr crypto data",
  allowAgentApi: "Master Agent API",
  allowErc8004: "ERC-8004 registry",
  allowFeedbackDigest: "Feedback digest",
  allowRewards: "Rewards loop",
};

const QUOTA_LABELS: Record<string, string> = {
  maxBots: "bot",
  maxKbEntries: "knowledge base entry",
  maxGroupsPerBot: "group per bot",
};

function describe(details: PaywallDetails): { title: string; body: string } {
  if (details.feature) {
    const label = FEATURE_LABELS[details.feature] || details.feature;
    return {
      title: `${label} is a ${details.requiredPlan} feature`,
      body: `Your ${details.currentPlan} plan doesn't include ${label.toLowerCase()}. Upgrade to ${details.requiredPlan} to turn it on.`,
    };
  }
  if (details.quota) {
    const label = QUOTA_LABELS[details.quota] || details.quota;
    return {
      title: `You've hit your ${label} limit`,
      body: `Your ${details.currentPlan} plan allows ${details.limit} ${label}${(details.limit ?? 0) === 1 ? "" : "s"}. Upgrade to ${details.requiredPlan} for more headroom.`,
    };
  }
  return { title: "Upgrade required", body: details.message };
}

export function PaywallDialog() {
  const [details, setDetails] = useState<PaywallDetails | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<PaywallDetails>;
      if (ce.detail) setDetails(ce.detail);
    };
    window.addEventListener(PAYWALL_EVENT, handler as EventListener);
    return () => window.removeEventListener(PAYWALL_EVENT, handler as EventListener);
  }, []);

  if (!details) return null;

  const { title, body } = describe(details);
  const params = new URLSearchParams({ plan: details.requiredPlan });
  if (details.feature) params.set("feature", details.feature);
  if (details.quota) params.set("quota", details.quota);
  const billingHref = `/billing?${params.toString()}`;

  return (
    <Dialog open={!!details} onOpenChange={(o) => { if (!o) setDetails(null); }}>
      <DialogContent className="max-w-md" data-testid="dialog-paywall">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <DialogTitle data-testid="text-paywall-title">{title}</DialogTitle>
          </div>
          <DialogDescription data-testid="text-paywall-body">{body}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Current</span>
          <Badge variant="secondary" className="uppercase" data-testid="badge-paywall-current">{details.currentPlan}</Badge>
          <span className="text-muted-foreground">→ Recommended</span>
          <Badge className="uppercase" data-testid="badge-paywall-required">{details.requiredPlan}</Badge>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDetails(null)} data-testid="button-paywall-dismiss">Not now</Button>
          <Button
            onClick={() => { setDetails(null); setLocation(billingHref); }}
            data-testid="button-paywall-upgrade"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Upgrade to {details.requiredPlan}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
