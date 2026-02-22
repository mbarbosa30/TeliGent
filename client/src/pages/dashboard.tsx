import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Users, BookOpen, Activity, MessageSquare, Shield, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import type { BotConfig, Group, ActivityLog, KnowledgeBaseEntry } from "@shared/schema";
import { format } from "date-fns";

function StatCard({ title, value, icon: Icon, description, loading }: {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
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
          <>
            <div className="font-mono text-3xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s/g, "-")}`}>{value}</div>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: config, isLoading: configLoading } = useQuery<BotConfig>({ queryKey: ["/api/config"] });
  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: activity = [], isLoading: activityLoading } = useQuery<ActivityLog[]>({ queryKey: ["/api/activity"] });
  const { data: knowledge = [], isLoading: knowledgeLoading } = useQuery<KnowledgeBaseEntry[]>({ queryKey: ["/api/knowledge"] });

  const totalMembers = groups.reduce((sum, g) => sum + (g.memberCount || 0), 0);
  const recentReports = activity.filter(a => a.isReport).length;
  const todayActivity = activity.filter(a => {
    const d = new Date(a.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor your bot's activity and performance</p>
        </div>

        {!configLoading && config && !config.botToken?.trim() && (
          <Card className="border-foreground/30" data-testid="banner-setup-token">
            <CardContent className="flex items-start gap-3 pt-5 pb-4">
              <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Connect your Telegram bot</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Follow the <Link href="/setup" className="text-foreground underline underline-offset-2 font-medium" data-testid="link-setup-guide">Setup Guide</Link> to create a Telegram bot and connect it, or go directly to <Link href="/settings" className="text-foreground underline underline-offset-2 font-medium" data-testid="link-settings-token">Settings</Link> to enter your bot token.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!configLoading && config && config.botToken?.trim() && !config.globalContext?.trim() && (
          <Card className="border-foreground/30" data-testid="banner-setup-context">
            <CardContent className="flex items-start gap-3 pt-5 pb-4">
              <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Your bot needs context to answer questions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Go to <Link href="/settings" className="text-foreground underline underline-offset-2 font-medium" data-testid="link-settings-context">Settings</Link> and fill in the <strong>Global Context</strong> with a description of your project or community.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Groups" value={groups.length} icon={Users} description={`${totalMembers} total members`} loading={groupsLoading} />
          <StatCard title="Knowledge Items" value={knowledge.length} icon={BookOpen} description="Active entries" loading={knowledgeLoading} />
          <StatCard title="Today's Activity" value={todayActivity} icon={Activity} description="Messages processed" loading={activityLoading} />
          <StatCard title="Reports" value={recentReports} icon={Shield} description="User reports tracked" loading={activityLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
              <CardTitle className="text-base font-semibold">Bot Status</CardTitle>
              <Bot className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4">
              {configLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : config ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant={config.isActive ? "default" : "secondary"} data-testid="badge-bot-status">
                      {config.isActive ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Response Mode</span>
                    <Badge variant="secondary" data-testid="badge-response-mode">{config.responseMode}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Cooldown</span>
                    <span className="text-sm font-mono">{config.cooldownSeconds}s</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Mention Only</span>
                    <span className="text-sm font-mono">{config.onlyRespondWhenMentioned ? "Yes" : "No"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Respond to Replies</span>
                    <span className="text-sm font-mono">{config.respondToReplies ? "Yes" : "No"}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No configuration found</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
              <CardTitle className="text-base font-semibold">Connected Groups</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {groupsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Users className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No groups connected yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Add the bot to a Telegram group to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.slice(0, 5).map((group) => (
                    <div key={group.id} className="flex items-center justify-between" data-testid={`group-item-${group.id}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center bg-muted">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{group.name}</p>
                          <p className="text-xs text-muted-foreground">{group.memberCount || 0} members</p>
                        </div>
                      </div>
                      <Badge variant={group.isActive ? "default" : "secondary"}>
                        {group.isActive ? "Active" : "Paused"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No activity yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Activity will appear here once the bot starts interacting</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activity.slice(0, 8).map((log) => (
                  <div key={log.id} className="flex items-start gap-3 pb-3 border-b last:border-b-0 last:pb-0" data-testid={`activity-item-${log.id}`}>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center ${log.isReport ? "bg-destructive/10" : "bg-muted"}`}>
                      {log.isReport ? (
                        <Shield className="h-4 w-4 text-destructive" />
                      ) : log.type === "response" ? (
                        <MessageSquare className="h-4 w-4" />
                      ) : (
                        <Activity className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{log.userName || "Unknown"}</span>
                        {log.isReport && <Badge variant="destructive" className="text-xs">Report</Badge>}
                        <Badge variant="secondary" className="text-xs">{log.type}</Badge>
                      </div>
                      {log.userMessage && (
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">{log.userMessage}</p>
                      )}
                      {log.botResponse && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">Bot: {log.botResponse}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 font-mono">
                      {format(new Date(log.createdAt), "HH:mm")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
