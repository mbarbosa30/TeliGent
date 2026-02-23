import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Bot, Activity, Shield, MessageSquare, Search,
  Globe, Clock, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
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
  isAdmin: boolean;
  createdAt: string | null;
}

interface AdminBot {
  id: number;
  userId: string;
  botName: string;
  botToken: string;
  isActive: boolean;
  userEmail?: string;
  createdAt: string;
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

export default function AdminPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const isAdminUser = !!user?.isAdmin;

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: isAdminUser,
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdminUser,
  });

  const { data: allBots = [], isLoading: botsLoading } = useQuery<AdminBot[]>({
    queryKey: ["/api/admin/bots"],
    enabled: isAdminUser,
  });

  const { data: allActivity = [], isLoading: activityLoading } = useQuery<AdminActivityLog[]>({
    queryKey: ["/api/admin/activity"],
    enabled: isAdminUser,
  });

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <Shield className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">Access Denied</h2>
        <p className="text-sm text-muted-foreground mt-1">You don't have admin access.</p>
      </div>
    );
  }

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
    <ScrollArea className="h-full">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-admin-title">Admin Dashboard</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Platform overview across all users and bots.
          </p>
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
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <span>Email</span>
                  <span>Name</span>
                  <span>Role</span>
                  <span>Joined</span>
                </div>
                {filteredUsers.map((u) => (
                  <div key={u.id} className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-3 py-3 border-b border-border/50 items-center" data-testid={`row-user-${u.id}`}>
                    <span className="text-sm truncate font-mono">{u.email}</span>
                    <span className="text-sm text-muted-foreground truncate">
                      {u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : "—"}
                    </span>
                    <span>
                      {u.isAdmin ? (
                        <Badge variant="default" className="text-xs">Admin</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">User</Badge>
                      )}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {u.createdAt ? format(new Date(u.createdAt), "MMM d, yyyy") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="bots" className="mt-4">
            {botsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filteredBots.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No bots found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <span>Bot Name</span>
                  <span>Owner</span>
                  <span>Status</span>
                  <span>Created</span>
                </div>
                {filteredBots.map((b) => (
                  <div key={b.id} className="grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-3 py-3 border-b border-border/50 items-center" data-testid={`row-bot-${b.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm truncate">{b.botName}</span>
                    </div>
                    <span className="text-sm font-mono text-muted-foreground truncate">{b.userEmail || "Unknown"}</span>
                    <span>
                      {b.isActive && b.botToken ? (
                        <Badge variant="default" className="text-xs">Online</Badge>
                      ) : b.botToken ? (
                        <Badge variant="secondary" className="text-xs">Offline</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">No Token</Badge>
                      )}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {format(new Date(b.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
        </Tabs>
      </div>
    </ScrollArea>
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
