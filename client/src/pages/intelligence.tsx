import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBot } from "@/hooks/use-bot";
import { Bot, Sparkles, BookPlus, Trash2, CheckCheck, HelpCircle, AlertOctagon, Lightbulb, TrendingUp, Users, MessageSquare, Brain, type LucideIcon } from "lucide-react";
import type { CollectivePattern, UserMemory } from "@shared/schema";
import { format } from "date-fns";

type Components = {
  pattern: number; confidence: number; contributor: number; depth: number;
  diversity: number; volume: number; growth: number; maturity: number;
};
type WisdomDetails = {
  totalPatterns: number;
  promotedKnown: number;
  totalMentions: number;
  kbEntries: number;
  activeUsers30d: number;
  activeUsers7d: number;
  messages7d: number;
  messagesPrev7d: number;
  previousScore: number | null;
};
type Overview = {
  summary: string;
  bullets?: string[];
  wisdom: { score: number; components: Components; details: WisdomDetails };
  messages7d: number;
  activityByDay: { day: string; count: number }[];
  topByMentions: CollectivePattern[];
  openQuestions: CollectivePattern[];
  pitfalls: CollectivePattern[];
  strategies: CollectivePattern[];
  scoreTrend: { at: string; score: number }[];
};

const componentLabels: Record<keyof Components, string> = {
  pattern: "Patterns",
  confidence: "Confidence",
  contributor: "Contributors",
  depth: "Depth",
  diversity: "Diversity",
  volume: "Volume",
  growth: "Growth",
  maturity: "Maturity",
};

const kindIcon: Record<string, LucideIcon> = {
  topic: Sparkles,
  question: HelpCircle,
  pitfall: AlertOctagon,
  strategy: Lightbulb,
  sentiment: Brain,
};

function RewardsPanels({ botId }: { botId: number | null }) {
  const { toast } = useToast();
  const enabled = !!botId;
  const { data: leaderboard = [] } = useQuery<any[]>({ queryKey: ["/api/bots", botId, "rewards", "leaderboard"], enabled });
  const { data: distributions = [] } = useQuery<any[]>({ queryKey: ["/api/bots", botId, "rewards", "distributions"], enabled });
  const { data: payouts = [] } = useQuery<any[]>({ queryKey: ["/api/bots", botId, "rewards", "payouts"], enabled });
  const { data: walletStatus } = useQuery<any>({ queryKey: ["/api/bots", botId, "rewards", "wallet-status"], enabled });
  const { data: prompts = [] } = useQuery<any[]>({ queryKey: ["/api/bots", botId, "proactive", "queue"], enabled });
  const { data: referrals = [] } = useQuery<any[]>({ queryKey: ["/api/bots", botId, "referrals"], enabled });

  const runRewards = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bots/${botId}/rewards/run`, { dryRun: false });
      return res.json();
    },
    onSuccess: (res: any) => {
      toast({ title: "Rewards run", description: res?.reason || `Recipients: ${res?.recipients ?? 0}` });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "rewards", "distributions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "rewards", "payouts"] });
    },
    onError: (err: any) => toast({ title: "Rewards run failed", description: err.message, variant: "destructive" }),
  });

  const runProactive = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bots/${botId}/proactive/run`, {});
      return res.json();
    },
    onSuccess: (res: any) => {
      toast({ title: "Proactive tick", description: res?.reason || (res?.posted ? "Posted" : "Queued") });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "proactive", "queue"] });
    },
    onError: (err: any) => toast({ title: "Proactive failed", description: err.message, variant: "destructive" }),
  });

  const postPrompt = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bots/${botId}/proactive/${id}/post`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "proactive", "queue"] }),
  });
  const skipPrompt = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bots/${botId}/proactive/${id}/skip`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "proactive", "queue"] }),
  });

  if (!enabled) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" />Contributor Leaderboard</CardTitle>
          <Button size="sm" variant="outline" onClick={() => runRewards.mutate()} disabled={runRewards.isPending} data-testid="button-run-rewards">
            {runRewards.isPending ? "Running..." : "Run rewards now"}
          </Button>
        </CardHeader>
        <CardContent>
          {walletStatus && (
            <div className="text-xs text-muted-foreground mb-3 font-mono">
              Wallet [{walletStatus.chain}]: {walletStatus.configured ? `${walletStatus.address} (${walletStatus.keySource})` : `Not configured: ${walletStatus.error || ""}`}
            </div>
          )}
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scores yet for the latest period.</p>
          ) : (
            <div className="space-y-1">
              {leaderboard.slice(0, 10).map((s: any, i: number) => (
                <div key={s.id} className="flex items-center justify-between border-b last:border-b-0 py-1.5" data-testid={`row-leaderboard-${s.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs w-6 text-muted-foreground">#{i + 1}</span>
                    <span className="text-sm truncate">{s.userName || s.telegramUserId}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span>{s.daysActive}d</span>
                    <span className="font-bold text-foreground">{s.score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Reward Distributions</CardTitle>
        </CardHeader>
        <CardContent>
          {distributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No distributions yet.</p>
          ) : (
            <div className="space-y-1">
              {distributions.slice(0, 10).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between border-b last:border-b-0 py-1.5 text-xs font-mono" data-testid={`row-distribution-${d.id}`}>
                  <span>{d.periodStart ? format(new Date(d.periodStart), "MMM d") : "?"} → {d.periodEnd ? format(new Date(d.periodEnd), "MMM d") : "?"}</span>
                  <span>{d.tokenSymbol} × {d.totalRecipients}</span>
                  <Badge variant={d.status === "sent" ? "default" : d.status === "failed" ? "destructive" : "secondary"}>{d.status}</Badge>
                </div>
              ))}
            </div>
          )}
          {payouts.length > 0 && (
            <div className="mt-4 space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recent payouts</div>
              {payouts.slice(0, 8).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs font-mono border-b last:border-b-0 py-1" data-testid={`row-payout-${p.id}`}>
                  <span className="truncate max-w-[180px]">{p.userName || p.telegramUserId}</span>
                  <span className="truncate max-w-[150px]">{p.walletAddress?.slice(0, 8)}...{p.walletAddress?.slice(-6)}</span>
                  <Badge variant={p.status === "sent" ? "default" : p.status === "failed" ? "destructive" : "secondary"}>{p.status}</Badge>
                  {p.txHash && <span className="text-muted-foreground truncate max-w-[100px]">{p.txHash.slice(0, 10)}...</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4" />Proactive Prompt Queue</CardTitle>
          <Button size="sm" variant="outline" onClick={() => runProactive.mutate()} disabled={runProactive.isPending} data-testid="button-run-proactive">
            {runProactive.isPending ? "Generating..." : "Generate now"}
          </Button>
        </CardHeader>
        <CardContent>
          {prompts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prompts queued.</p>
          ) : (
            <div className="space-y-2">
              {prompts.slice(0, 10).map((p: any) => (
                <div key={p.id} className="border-b last:border-b-0 pb-2" data-testid={`row-prompt-${p.id}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">{p.status}</Badge>
                    <div className="flex gap-1">
                      {p.status === "queued" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => postPrompt.mutate(p.id)} disabled={postPrompt.isPending} data-testid={`button-post-${p.id}`}>Post</Button>
                          <Button size="sm" variant="ghost" onClick={() => skipPrompt.mutate(p.id)} disabled={skipPrompt.isPending} data-testid={`button-skip-${p.id}`}>Skip</Button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm">{p.question}</p>
                  {p.rationale && <p className="text-xs text-muted-foreground mt-0.5">{p.rationale}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Users className="h-4 w-4" />Referrals</CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No referrals yet.</p>
          ) : (
            <div className="space-y-1">
              {referrals.slice(0, 12).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between text-xs font-mono border-b last:border-b-0 py-1" data-testid={`row-referral-${r.id}`}>
                  <span className="truncate max-w-[140px]">{r.referrerTelegramUserId}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate max-w-[140px]">{r.refereeUserName || r.refereeTelegramUserId}</span>
                  <Badge variant={r.status === "credited" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-4">
      <div className="font-mono text-5xl font-bold leading-none" data-testid="text-wisdom-score">{pct}</div>
      <div className="flex-1 space-y-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Wisdom Score</div>
        <div className="h-2 bg-muted overflow-hidden">
          <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}

function TrendSparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <div className="text-xs text-muted-foreground">No history</div>;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-10">
      {values.map((v, i) => (
        <div key={i} className="flex-1 bg-foreground" style={{ height: `${(v / max) * 100}%`, minHeight: "2px" }} />
      ))}
    </div>
  );
}

function PatternCard({ pattern, botId }: { pattern: CollectivePattern; botId: number }) {
  const { toast } = useToast();
  const Icon = kindIcon[pattern.kind] || Sparkles;

  const promote = useMutation({
    mutationFn: () => apiRequest("POST", `/api/bots/${botId}/intelligence/patterns/${pattern.id}/promote`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "knowledge"] });
      toast({ title: "Promoted to knowledge base", description: pattern.title });
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/bots/${botId}/intelligence/patterns/${pattern.id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "intelligence"] }),
  });

  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/bots/${botId}/intelligence/patterns/${pattern.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "intelligence"] }),
  });

  return (
    <Card data-testid={`card-pattern-${pattern.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold truncate">{pattern.title}</h3>
              <Badge variant="secondary" className="text-xs font-mono">{pattern.kind}</Badge>
              <Badge variant="outline" className="text-xs font-mono">{pattern.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{pattern.summary}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground font-mono">
              <span data-testid={`text-mentions-${pattern.id}`}>{pattern.mentionCount}× mentioned</span>
              <span>{pattern.uniqueUsers} users</span>
              <span>conf {pattern.confidence}</span>
              <span>{format(new Date(pattern.lastSeenAt), "MMM d")}</span>
            </div>
            {pattern.keywords.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-2">
                {pattern.keywords.slice(0, 6).map(k => (
                  <Badge key={k} variant="outline" className="text-xs font-mono">{k}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            {pattern.status !== "known" && (
              <Button size="icon" variant="ghost" onClick={() => promote.mutate()} disabled={promote.isPending} data-testid={`button-promote-${pattern.id}`} title="Promote to knowledge base">
                <BookPlus className="h-4 w-4" />
              </Button>
            )}
            {pattern.status === "open" && (
              <Button size="icon" variant="ghost" onClick={() => setStatus.mutate("known")} data-testid={`button-mark-known-${pattern.id}`} title="Mark known">
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} data-testid={`button-delete-pattern-${pattern.id}`} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function IntelligencePage() {
  const { selectedBotId } = useBot();
  const [filterKind, setFilterKind] = useState("all");

  const { data: overview, isLoading: overviewLoading } = useQuery<Overview>({
    queryKey: ["/api/bots", selectedBotId, "intelligence", "overview"],
    enabled: !!selectedBotId,
  });

  const { data: patterns = [], isLoading: patternsLoading } = useQuery<CollectivePattern[]>({
    queryKey: ["/api/bots", selectedBotId, "intelligence", "patterns"],
    enabled: !!selectedBotId,
  });

  const { data: userMems = [] } = useQuery<UserMemory[]>({
    queryKey: ["/api/bots", selectedBotId, "intelligence", "user-memories"],
    enabled: !!selectedBotId,
  });

  if (!selectedBotId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">No bot selected</h2>
        <p className="text-sm text-muted-foreground mt-1">Use the bot switcher in the sidebar to create or select a bot.</p>
      </div>
    );
  }

  const filteredPatterns = filterKind === "all" ? patterns : patterns.filter(p => p.kind === filterKind);
  const trendValues = overview?.scoreTrend.map(s => s.score) || [];
  const activityValues = overview?.activityByDay.map(d => d.count) || [];

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Community patterns, wisdom score, and weekly insights</p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            {overviewLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : overview ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                  <ScoreGauge score={overview.wisdom.score} />
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Score history (last {trendValues.length} snapshots)</div>
                    <TrendSparkline values={trendValues} />
                  </div>
                </div>
                <div className="pt-2 border-t space-y-2">
                  <p className="text-sm" data-testid="text-digest-summary">{overview.summary}</p>
                  {overview.bullets && overview.bullets.length > 0 && (
                    <ul className="space-y-1.5 mt-2" data-testid="list-digest-bullets">
                      {overview.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-sm" data-testid={`bullet-digest-${i}`}>
                          <span className="text-muted-foreground font-mono shrink-0">›</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {overview.scoreTrend.length > 1 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Past digest history ({overview.scoreTrend.length} snapshots)</summary>
                    <ul className="mt-2 space-y-1 font-mono">
                      {overview.scoreTrend.slice(-8).reverse().map((s, i) => (
                        <li key={i} data-testid={`row-snapshot-${i}`}>{format(new Date(s.at), "MMM d, HH:mm")} — score {s.score}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data yet. Add a bot, connect to a group, and intelligence will start building.</p>
            )}
          </CardContent>
        </Card>

        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {(Object.keys(componentLabels) as (keyof Components)[]).map(k => (
              <Card key={k}>
                <CardContent className="p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{componentLabels[k]}</div>
                  <div className="font-mono text-xl font-bold" data-testid={`text-component-${k}`}>{overview.wisdom.components[k]}</div>
                  <div className="h-1 bg-muted mt-1.5 overflow-hidden">
                    <div className="h-full bg-foreground" style={{ width: `${overview.wisdom.components[k]}%` }} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Messages this week</div>
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="font-mono text-2xl font-bold mt-2" data-testid="text-messages-7d">{overview.messages7d}</div>
                <div className="mt-2"><TrendSparkline values={activityValues} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Active users (30d)</div>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="font-mono text-2xl font-bold mt-2" data-testid="text-active-30d">{overview.wisdom.details.activeUsers30d}</div>
                <div className="text-xs text-muted-foreground mt-1">{overview.wisdom.details.activeUsers7d} this week</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Total patterns</div>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="font-mono text-2xl font-bold mt-2" data-testid="text-total-patterns">{overview.wisdom.details.totalPatterns}</div>
                <div className="text-xs text-muted-foreground mt-1">{overview.wisdom.details.promotedKnown} promoted to KB</div>
              </CardContent>
            </Card>
          </div>
        )}

        {patterns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" />Topic map</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {(["topic", "question", "pitfall", "strategy", "sentiment"] as const).map(kind => {
                  const items = patterns.filter(p => p.kind === kind).slice(0, 12);
                  const Icon = kindIcon[kind];
                  return (
                    <div key={kind} className="space-y-2 border p-3" data-testid={`topic-map-col-${kind}`}>
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        <span>{kind}</span>
                        <span className="ml-auto font-mono">{items.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.length === 0 ? (
                          <span className="text-xs text-muted-foreground/60">none</span>
                        ) : items.map(p => {
                          const intensity = Math.min(1, p.mentionCount / 10);
                          const fontSize = 11 + Math.round(intensity * 4);
                          let chipClass = "border-foreground/40 bg-foreground/5 text-foreground";
                          if (kind === "pitfall") chipClass = "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400";
                          else if (kind === "strategy") chipClass = "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
                          else if (kind === "question") chipClass = "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400";
                          else if (kind === "sentiment") {
                            const haystack = `${p.title} ${p.summary} ${p.keywords.join(" ")}`.toLowerCase();
                            const negative = /(angry|frustrat|upset|hate|toxic|negative|complain|disappoint|bad|broken|worried|confus|fud)/.test(haystack);
                            const positive = /(love|great|excit|happy|positive|hype|bullish|amazing|awesome|grateful|thank)/.test(haystack);
                            if (negative && !positive) chipClass = "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400";
                            else if (positive && !negative) chipClass = "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
                            else chipClass = "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300";
                          }
                          return (
                            <span
                              key={p.id}
                              className={`border px-1.5 py-0.5 leading-tight ${chipClass}`}
                              style={{ fontSize, opacity: 0.55 + intensity * 0.45 }}
                              title={`${p.title} (${p.mentionCount}x)`}
                              data-testid={`topic-chip-${p.id}`}
                            >{p.title}</span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {overview && (overview.openQuestions.length > 0 || overview.pitfalls.length > 0 || overview.strategies.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {overview.openQuestions.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><HelpCircle className="h-4 w-4" />Open questions</CardTitle></CardHeader>
                <CardContent className="space-y-2">{overview.openQuestions.map(p => <PatternCard key={p.id} pattern={p} botId={selectedBotId} />)}</CardContent>
              </Card>
            )}
            {overview.pitfalls.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><AlertOctagon className="h-4 w-4" />Pitfalls</CardTitle></CardHeader>
                <CardContent className="space-y-2">{overview.pitfalls.map(p => <PatternCard key={p.id} pattern={p} botId={selectedBotId} />)}</CardContent>
              </Card>
            )}
            {overview.strategies.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Lightbulb className="h-4 w-4" />Strategies</CardTitle></CardHeader>
                <CardContent className="space-y-2">{overview.strategies.map(p => <PatternCard key={p.id} pattern={p} botId={selectedBotId} />)}</CardContent>
              </Card>
            )}
          </div>
        )}

        {overview && (() => {
          const actions: { label: string; reason: string }[] = [];
          if (overview.openQuestions.length > 0) actions.push({ label: `Answer ${overview.openQuestions.length} open question${overview.openQuestions.length > 1 ? "s" : ""}`, reason: "Promote them to the knowledge base so the bot can respond automatically." });
          if (overview.wisdom.components.depth < 30) actions.push({ label: "Grow the knowledge base", reason: "Depth score is low. Add a few key entries or promote recurring patterns." });
          if (overview.wisdom.components.contributor < 30) actions.push({ label: "Encourage more participation", reason: "Few unique contributors in the last 30 days." });
          if (overview.pitfalls.length > 0) actions.push({ label: `Address ${overview.pitfalls.length} pitfall${overview.pitfalls.length > 1 ? "s" : ""}`, reason: "Members are repeatedly running into the same problems." });
          if (overview.wisdom.components.growth < 40) actions.push({ label: "Re-engage the community", reason: "Activity is trending down compared to the previous week." });
          const top = actions.slice(0, 5);
          if (top.length === 0) return null;
          return (
            <Card>
              <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" />Suggested actions</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {top.map((a, i) => (
                    <li key={i} className="flex gap-3" data-testid={`row-suggested-action-${i}`}>
                      <span className="font-mono text-xs text-muted-foreground mt-1 w-4">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.reason}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-semibold">All patterns</CardTitle>
            <Select value={filterKind} onValueChange={setFilterKind}>
              <SelectTrigger className="w-40" data-testid="select-pattern-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="topic">Topics</SelectItem>
                <SelectItem value="question">Questions</SelectItem>
                <SelectItem value="pitfall">Pitfalls</SelectItem>
                <SelectItem value="strategy">Strategies</SelectItem>
                <SelectItem value="sentiment">Sentiment</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-2">
            {patternsLoading ? (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            ) : filteredPatterns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No patterns yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">As your bot processes group messages, recurring topics will surface here.</p>
              </div>
            ) : (
              filteredPatterns.map(p => <PatternCard key={p.id} pattern={p} botId={selectedBotId} />)
            )}
          </CardContent>
        </Card>

        <RewardsPanels botId={selectedBotId} />

        {userMems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2"><Brain className="h-4 w-4" />What the bot knows about members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {userMems.slice(0, 20).map(m => (
                  <div key={m.id} className="flex items-start gap-3 pb-2 border-b last:border-b-0 last:pb-0" data-testid={`row-user-memory-${m.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{m.userName || "Unknown"}</span>
                        <Badge variant="secondary" className="text-xs font-mono">{m.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{m.content}</p>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono shrink-0">×{m.hitCount}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
