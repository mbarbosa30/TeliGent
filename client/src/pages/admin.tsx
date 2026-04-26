import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Bot, Activity, Shield, MessageSquare, Search,
  Globe, Clock, AlertTriangle, Lock, LogOut, CreditCard, Save,
  Link as LinkIcon, ExternalLink, Loader2, Wallet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface AdminStats {
  totalUsers: number;
  totalBots: number;
  totalGroups: number;
  totalLogs: number;
  totalScams: number;
}

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string | null;
  plan?: "free" | "pro" | "business" | null;
  planRail?: string | null;
  planPeriodEnd?: string | null;
  planCancelAtPeriodEnd?: boolean | null;
  teliPaid?: boolean | null;
  stripeCustomerId?: string | null;
  pendingIntents?: number | null;
  paidIntents?: number | null;
  lastPaymentAt?: string | null;
}

interface AdminBot {
  id: number;
  userId: string;
  botName: string;
  botToken: string;
  isActive: boolean;
  userEmail?: string;
  createdAt: string;
  helixaAgentId: string | null;
  helixaMintedAt: string | null;
  helixaTxHash: string | null;
  helixaBaseTokenId: string | null;
  helixaLinkTokenAt: string | null;
  helixaXVerifiedAt: string | null;
  helixaGithubVerifiedAt: string | null;
  helixaCredScore: number | null;
  helixaCredTier: string | null;
  helixaProfileUrl: string | null;
  helixaExplorerUrl: string | null;
}

interface HelixaWalletStatus {
  configured: boolean;
  address: string | null;
  usdc: string | null;
  eth: string | null;
  status: "unconfigured" | "low" | "healthy" | "depleted";
}

interface AdminActivityLog {
  id: number;
  type: string;
  userName: string | null;
  userMessage: string | null;
  botResponse: string | null;
  botName?: string;
  createdAt: string;
}

function StatCard({ title, value, icon: Icon, loading }: {
  title: string;
  value: string | number;
  icon: any;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className="font-mono text-3xl font-bold" data-testid={`text-admin-stat-${title.toLowerCase().replace(/\s/g, "-")}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (pass: string) => {
      const res = await apiRequest("POST", "/api/admin/login", { passphrase: pass });
      return res.json();
    },
    onSuccess: () => {
      setError("");
      onSuccess();
    },
    onError: () => {
      setError("Invalid passphrase");
    },
  });

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-sm mx-4">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 bg-foreground flex items-center justify-center">
              <Lock className="h-6 w-6 text-background" />
            </div>
          </div>
          <CardTitle className="text-lg">Admin Access</CardTitle>
          <p className="text-sm text-muted-foreground">Enter the admin passphrase to continue.</p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (passphrase.trim()) {
                loginMutation.mutate(passphrase.trim());
              }
            }}
            className="space-y-4"
          >
            <Input
              type="password"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => { setPassphrase(e.target.value); setError(""); }}
              autoFocus
              data-testid="input-admin-passphrase"
            />
            {error && (
              <p className="text-sm text-destructive" data-testid="text-admin-error">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending || !passphrase.trim()}
              data-testid="button-admin-login"
            >
              {loginMutation.isPending ? "Verifying..." : "Enter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: allBots = [], isLoading: botsLoading } = useQuery<AdminBot[]>({
    queryKey: ["/api/admin/bots"],
  });

  const { data: allActivity = [], isLoading: activityLoading } = useQuery<AdminActivityLog[]>({
    queryKey: ["/api/admin/activity"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/admin/check"], { authenticated: false });
      queryClient.removeQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.removeQueries({ queryKey: ["/api/admin/users"] });
      queryClient.removeQueries({ queryKey: ["/api/admin/bots"] });
      queryClient.removeQueries({ queryKey: ["/api/admin/activity"] });
    },
  });

  const filteredUsers = allUsers.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.firstName || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredBots = allBots.filter(b =>
    !search || b.botName.toLowerCase().includes(search.toLowerCase()) ||
    (b.userEmail || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredActivity = allActivity.filter(a =>
    !search || (a.userName || "").toLowerCase().includes(search.toLowerCase()) ||
    (a.userMessage || "").toLowerCase().includes(search.toLowerCase()) ||
    (a.botName || "").toLowerCase().includes(search.toLowerCase())
  );

  const scamLogs = allActivity.filter(a => a.type === "scam_detected");

  return (
    <ScrollArea className="h-screen">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-admin-title">Admin Dashboard</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Platform overview across all users and bots.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-admin-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Exit Admin
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard title="Users" value={stats?.totalUsers ?? 0} icon={Users} loading={statsLoading} />
          <StatCard title="Bots" value={stats?.totalBots ?? 0} icon={Bot} loading={statsLoading} />
          <StatCard title="Groups" value={stats?.totalGroups ?? 0} icon={Globe} loading={statsLoading} />
          <StatCard title="Messages" value={stats?.totalLogs ?? 0} icon={MessageSquare} loading={statsLoading} />
          <StatCard title="Scams Caught" value={stats?.totalScams ?? 0} icon={AlertTriangle} loading={statsLoading} />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users, bots, activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-admin-search"
          />
        </div>

        <Tabs defaultValue="users">
          <TabsList data-testid="tabs-admin">
            <TabsTrigger value="users" data-testid="tab-users">Users ({allUsers.length})</TabsTrigger>
            <TabsTrigger value="bots" data-testid="tab-bots">Bots ({allBots.length})</TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">Activity ({allActivity.length})</TabsTrigger>
            <TabsTrigger value="scams" data-testid="tab-scams">Scams ({scamLogs.length})</TabsTrigger>
            <TabsTrigger value="plans" data-testid="tab-plans">Plans</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            {usersLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <span>Email</span>
                  <span>Name</span>
                  <span>Joined</span>
                </div>
                {filteredUsers.map((u) => (
                  <div key={u.id} className="grid grid-cols-[1fr_1fr_auto] gap-4 px-3 py-3 border-b border-border/50 items-center" data-testid={`row-user-${u.id}`}>
                    <span className="text-sm truncate font-mono">{u.email}</span>
                    <span className="text-sm text-muted-foreground truncate">
                      {u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : "—"}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {u.createdAt ? format(new Date(u.createdAt), "MMM d, yyyy") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bots" className="mt-4 space-y-4">
            <BotsHelixaPanel
              bots={filteredBots}
              loading={botsLoading}
            />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <ActivityList logs={filteredActivity} loading={activityLoading} />
          </TabsContent>

          <TabsContent value="scams" className="mt-4">
            <ActivityList logs={scamLogs.filter(a =>
              !search || (a.userName || "").toLowerCase().includes(search.toLowerCase()) ||
              (a.userMessage || "").toLowerCase().includes(search.toLowerCase())
            )} loading={activityLoading} />
          </TabsContent>

          <TabsContent value="plans" className="mt-4 space-y-4">
            <PlansTab users={filteredUsers} loading={usersLoading} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

export default function AdminPage() {
  const queryClient = useQueryClient();

  const { data: adminCheck, isLoading } = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/admin/check"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 border-2 border-foreground border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!adminCheck?.authenticated) {
    return (
      <AdminLogin
        onSuccess={() => {
          queryClient.setQueryData(["/api/admin/check"], { authenticated: true });
        }}
      />
    );
  }

  return <AdminDashboard />;
}

function PlansTab({ users, loading }: { users: AdminUser[]; loading: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: usdPerTeli } = useQuery<{
    value: number;
    override: number | null;
    live: { usdPerTeli: number | null; source: string | null; fetchedAt: string | null; liveAvailable: boolean };
  }>({ queryKey: ["/api/admin/usd-per-teli"], refetchInterval: 30_000 });
  const [usdInput, setUsdInput] = useState("");

  const setUsdMutation = useMutation({
    mutationFn: async (value: number) => {
      const res = await apiRequest("POST", "/api/admin/usd-per-teli", { value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/usd-per-teli"] });
      toast({ title: "Saved", description: "USD per $TELI updated." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const clearUsdMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/usd-per-teli", {});
      return res.json();
    },
    onSuccess: () => {
      setUsdInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/usd-per-teli"] });
      toast({ title: "Override cleared", description: "Now using the live $TELI/USD rate." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: async (vars: { userId: string; plan: string; days: number; teliPaid: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/users/${vars.userId}/plan`, vars);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Plan updated", description: "User plan was overridden." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4" /> Crypto pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Manual override for the $TELI/USD rate. Leave blank to use the live rate (DexScreener primary, Bankr fallback, refreshed every 5 minutes).
            Setting any positive number here forces every new $TELI invoice to use that rate instead of the live source.
          </p>
          <div className="flex items-center gap-2 max-w-sm">
            <Input
              type="number"
              step="0.000001"
              min="0"
              placeholder={usdPerTeli?.override ? String(usdPerTeli.override) : "live rate"}
              value={usdInput}
              onChange={(e) => setUsdInput(e.target.value)}
              data-testid="input-usd-per-teli"
            />
            <Button
              size="sm"
              onClick={() => {
                const v = parseFloat(usdInput);
                if (!Number.isFinite(v) || v <= 0) return toast({ title: "Invalid", description: "Enter a positive number.", variant: "destructive" });
                setUsdMutation.mutate(v);
              }}
              disabled={setUsdMutation.isPending}
              data-testid="button-save-usd-per-teli"
            >
              <Save className="h-3.5 w-3.5 mr-1" /> Save override
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => clearUsdMutation.mutate()}
              disabled={clearUsdMutation.isPending}
              data-testid="button-clear-usd-per-teli"
            >
              Use live
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
            <div className="border p-2" data-testid="text-current-usd-per-teli">
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Rate in use</div>
              <div>${usdPerTeli?.value ?? "—"} / $TELI</div>
            </div>
            <div className="border p-2" data-testid="text-admin-override">
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Manual override</div>
              <div>{usdPerTeli?.override ? `$${usdPerTeli.override}` : "off"}</div>
            </div>
            <div className="border p-2" data-testid="text-admin-live-source">
              <div className="uppercase tracking-wider text-[10px] text-muted-foreground">Live source</div>
              {usdPerTeli?.live?.liveAvailable ? (
                <div>
                  ${usdPerTeli.live.usdPerTeli?.toFixed(6) ?? "—"} via {usdPerTeli.live.source}
                  {usdPerTeli.live.fetchedAt ? <span className="text-muted-foreground"> · {new Date(usdPerTeli.live.fetchedAt).toLocaleTimeString()}</span> : null}
                </div>
              ) : (
                <div className="text-destructive">Unavailable {usdPerTeli?.live?.fetchedAt ? `since ${new Date(usdPerTeli.live.fetchedAt).toLocaleTimeString()}` : ""}</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">User plans</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No users.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1.4fr_auto_auto_auto_auto_auto_auto_auto] gap-3 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
                <span>Email</span>
                <span>Plan</span>
                <span>Rail</span>
                <span>Period end</span>
                <span>TELI</span>
                <span>Payments</span>
                <span>Stripe</span>
                <span>Override</span>
              </div>
              {users.map((u) => (
                <PlanRow key={u.id} user={u} onOverride={overrideMutation.mutate} pending={overrideMutation.isPending} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanRow({ user, onOverride, pending }: { user: AdminUser; onOverride: (v: any) => void; pending: boolean }) {
  const [plan, setPlan] = useState<string>(user.plan || "free");
  const [days, setDays] = useState<string>("30");
  const [teli, setTeli] = useState<boolean>(!!user.teliPaid);
  const [reason, setReason] = useState<string>("");
  const { toast } = useToast();
  return (
    <div className="grid grid-cols-[1.4fr_auto_auto_auto_auto_auto_auto_auto] gap-3 px-3 py-3 border-b border-border/50 items-center" data-testid={`row-plan-${user.id}`}>
      <span className="text-sm font-mono truncate">{user.email}</span>
      <Badge variant="secondary" className="uppercase text-xs">{user.plan || "free"}</Badge>
      <span className="text-xs font-mono text-muted-foreground">{user.planRail || "—"}</span>
      <span className="text-xs font-mono text-muted-foreground" data-testid={`text-period-${user.id}`}>
        {user.planPeriodEnd ? (
          <>
            {format(new Date(user.planPeriodEnd), "MMM d, yyyy")}
            {user.planCancelAtPeriodEnd && <span className="ml-1 text-amber-600">(cancels)</span>}
          </>
        ) : "—"}
      </span>
      <span>
        {user.teliPaid ? <Badge className="bg-foreground text-background text-xs">TELI</Badge> : <span className="text-xs text-muted-foreground">—</span>}
      </span>
      <span className="text-xs font-mono text-muted-foreground" data-testid={`text-payments-${user.id}`}>
        {(user.paidIntents ?? 0)} paid
        {(user.pendingIntents ?? 0) > 0 && <span className="text-amber-600"> · {user.pendingIntents} pending</span>}
      </span>
      <span className="text-xs font-mono">
        {user.stripeCustomerId ? (
          <a
            href={`https://dashboard.stripe.com/customers/${user.stripeCustomerId}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground underline"
            data-testid={`link-stripe-${user.id}`}
          >Open</a>
        ) : <span className="text-muted-foreground">—</span>}
      </span>
      <div className="flex items-center gap-1.5">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="h-8 border bg-background px-2 text-xs"
          data-testid={`select-plan-${user.id}`}
        >
          <option value="free">free</option>
          <option value="pro">pro</option>
          <option value="business">business</option>
        </select>
        <input
          type="number"
          min="1"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="h-8 w-14 border bg-background px-1 text-xs font-mono"
          data-testid={`input-days-${user.id}`}
          aria-label="Days"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={teli}
            onChange={(e) => setTeli(e.target.checked)}
            data-testid={`checkbox-teli-${user.id}`}
          />
          TELI
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          className="h-8 w-44 border bg-background px-2 text-xs"
          data-testid={`input-reason-${user.id}`}
          aria-label="Reason for override"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={pending}
          onClick={() => {
            const r = reason.trim();
            if (!r) {
              toast({ title: "Reason required", description: "Document why you're overriding this user's plan.", variant: "destructive" });
              return;
            }
            onOverride({ userId: user.id, plan, days: parseInt(days) || 30, teliPaid: teli, reason: r });
          }}
          data-testid={`button-override-${user.id}`}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

function ActivityList({ logs, loading }: { logs: AdminActivityLog[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No activity found.</p>;
  }

  return (
    <div className="space-y-1">
      {logs.map((log) => {
        const isScam = log.type === "scam_detected";
        return (
          <Card key={log.id} className={isScam ? "border-destructive/30" : ""} data-testid={`row-activity-${log.id}`}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {isScam ? (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                  ) : (
                    <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{log.userName || "Unknown"}</span>
                      <Badge variant={isScam ? "destructive" : "secondary"} className="text-xs">{log.type}</Badge>
                      {log.botName && (
                        <Badge variant="outline" className="text-xs font-mono">{log.botName}</Badge>
                      )}
                    </div>
                    {log.userMessage && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{log.userMessage}</p>
                    )}
                    {log.botResponse && (
                      <p className="text-xs text-foreground/70 line-clamp-2 border-l-2 pl-2 mt-1">{log.botResponse}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">
                  {format(new Date(log.createdAt), "MMM d HH:mm")}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function BotsHelixaPanel({ bots, loading }: { bots: AdminBot[]; loading: boolean }) {
  // Wallet query lives at the panel level so it runs once per admin page
  // visit, not once per bot row. Pass the result down into the header and
  // each row, so all rendering uses the same wallet snapshot.
  const walletQuery = useQuery<HelixaWalletStatus>({
    queryKey: ["/api/admin/helixa/wallet"],
    refetchInterval: 60000,
  });
  return (
    <div className="space-y-4">
      <HelixaWalletHeader data={walletQuery.data} isLoading={walletQuery.isLoading} />
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : bots.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No bots found.</p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1.2fr_1fr_auto_1.4fr_auto] gap-4 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
            <span>Bot Name</span>
            <span>Owner</span>
            <span>Status</span>
            <span>Helixa</span>
            <span>Created</span>
          </div>
          {bots.map((b) => (
            <BotRow key={b.id} bot={b} wallet={walletQuery.data} walletErrored={walletQuery.isError} />
          ))}
        </div>
      )}
    </div>
  );
}

function HelixaWalletHeader({
  data,
  isLoading,
}: {
  data: HelixaWalletStatus | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (!data) return null;
  const dotColor =
    data.status === "healthy"
      ? "bg-green-500"
      : data.status === "low"
      ? "bg-amber-500"
      : data.status === "depleted"
      ? "bg-red-500"
      : "bg-muted-foreground";
  const label =
    data.status === "healthy"
      ? "Ready"
      : data.status === "low"
      ? "Low"
      : data.status === "depleted"
      ? "Depleted"
      : "Not configured";
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Helixa mint wallet</span>
              <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
              <span className="text-xs text-muted-foreground" data-testid="text-helixa-wallet-status">
                {label}
              </span>
            </div>
            {data.address ? (
              <p className="text-xs font-mono text-muted-foreground truncate" data-testid="text-helixa-wallet-address">
                {data.address}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set HELIXA_BASE_WALLET_PRIVATE_KEY to enable minting.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-right shrink-0">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">USDC</p>
            <p className="text-sm font-mono" data-testid="text-helixa-wallet-usdc">{data.usdc ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">ETH</p>
            <p className="text-sm font-mono" data-testid="text-helixa-wallet-eth">{data.eth ?? "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MintResponse {
  success: boolean;
  alreadyMinted: boolean;
  agentId: string;
  txHash: string | null;
  baseTokenId: string | null;
  profileUrl: string;
  explorerUrl: string | null;
}

function BotRow({
  bot,
  wallet,
  walletErrored,
}: {
  bot: AdminBot;
  wallet: HelixaWalletStatus | undefined;
  walletErrored: boolean;
}) {
  const { toast } = useToast();
  const mintMutation = useMutation<MintResponse, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/bots/${bot.id}/helixa/mint`);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/helixa/wallet"] });
      const txShort = data.txHash ? `${data.txHash.slice(0, 10)}…` : "n/a";
      toast({
        title: data.alreadyMinted ? "Already minted" : "Mint complete",
        description: `Agent ${data.agentId} | tx ${txShort}`,
      });
    },
    onError: (err) => {
      toast({ title: "Mint failed", description: err.message, variant: "destructive" });
    },
  });

  const forceRemintMutation = useMutation<MintResponse, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/bots/${bot.id}/helixa/force-remint`);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/helixa/wallet"] });
      const txShort = data.txHash ? `${data.txHash.slice(0, 10)}…` : "n/a";
      toast({
        title: "Force re-mint complete",
        description: `Agent ${data.agentId} | tx ${txShort}`,
      });
    },
    onError: (err) => {
      toast({ title: "Force re-mint failed", description: err.message, variant: "destructive" });
    },
  });

  const minted = !!bot.helixaAgentId;
  // Server allows mint when wallet has >= 1 USDC (status "healthy" or "low").
  // Block the button when we KNOW the wallet is depleted or unconfigured,
  // but fail-open when the wallet query errored or hasn't returned yet —
  // the server is the source of truth and will return a useful error if
  // the mint truly cannot proceed.
  const knownBlocked =
    !!wallet && (wallet.status === "depleted" || wallet.status === "unconfigured");
  const walletReady = !knownBlocked || walletErrored;
  const canMint = !minted && walletReady && !mintMutation.isPending;
  const canRemint = minted && walletReady && !forceRemintMutation.isPending;

  return (
    <div
      className="grid grid-cols-[1.2fr_1fr_auto_1.4fr_auto] gap-4 px-3 py-3 border-b border-border/50 items-center"
      data-testid={`row-bot-${bot.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm truncate">{bot.botName}</span>
      </div>
      <span className="text-sm font-mono text-muted-foreground truncate">{bot.userEmail || "Unknown"}</span>
      <span>
        {bot.isActive && bot.botToken ? (
          <Badge variant="default" className="text-xs">Online</Badge>
        ) : bot.botToken ? (
          <Badge variant="secondary" className="text-xs">Offline</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">No Token</Badge>
        )}
      </span>
      <div className="min-w-0">
        {minted ? (
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className="text-xs shrink-0">
                Minted
              </Badge>
              {bot.helixaProfileUrl ? (
                <a
                  href={bot.helixaProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono truncate text-foreground hover:underline inline-flex items-center gap-1 min-w-0"
                  data-testid={`link-helixa-agent-${bot.id}`}
                  title={bot.helixaAgentId ?? ""}
                >
                  <LinkIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{bot.helixaAgentId}</span>
                </a>
              ) : (
                <span
                  className="text-xs font-mono truncate text-muted-foreground"
                  data-testid={`text-helixa-agent-${bot.id}`}
                  title={bot.helixaAgentId ?? ""}
                >
                  {bot.helixaAgentId}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {bot.helixaExplorerUrl && (
                <a
                  href={bot.helixaExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  data-testid={`link-helixa-tx-${bot.id}`}
                >
                  <ExternalLink className="h-3 w-3" /> tx
                </a>
              )}
              {bot.helixaLinkTokenAt && (
                <Badge variant="secondary" className="text-[10px]">$TELI linked</Badge>
              )}
              {bot.helixaXVerifiedAt && (
                <Badge variant="secondary" className="text-[10px]">X verified</Badge>
              )}
              {bot.helixaGithubVerifiedAt && (
                <Badge variant="secondary" className="text-[10px]">GitHub verified</Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                disabled={!canRemint}
                onClick={() => {
                  if (window.confirm(`Force re-mint ${bot.botName}? This will clear the existing Helixa identity and spend ~1 USDC to mint a new one.`)) {
                    forceRemintMutation.mutate();
                  }
                }}
                data-testid={`button-force-remint-helixa-${bot.id}`}
              >
                {forceRemintMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" /> Re-minting
                  </>
                ) : (
                  "Force re-mint"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canMint}
              onClick={() => mintMutation.mutate()}
              data-testid={`button-mint-helixa-${bot.id}`}
            >
              {mintMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Minting
                </>
              ) : (
                "Mint on Helixa"
              )}
            </Button>
            {!walletReady && wallet && (
              <span className="text-xs text-muted-foreground" data-testid={`text-helixa-wallet-block-${bot.id}`}>
                {wallet.status === "depleted" ? "Wallet depleted" : "Wallet not configured"}
              </span>
            )}
          </div>
        )}
      </div>
      <span className="text-xs font-mono text-muted-foreground">
        {format(new Date(bot.createdAt), "MMM d, yyyy")}
      </span>
    </div>
  );
}
