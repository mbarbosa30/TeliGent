import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, MessageSquare, Shield, Search, UserPlus, LogOut, Bot } from "lucide-react";
import type { ActivityLog } from "@shared/schema";
import { format } from "date-fns";

const typeIcons: Record<string, any> = {
  response: MessageSquare,
  report: Shield,
  join: UserPlus,
  leave: LogOut,
  mention: Bot,
  command: Bot,
};

export default function ActivityPage() {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({ queryKey: ["/api/activity"] });

  const filtered = logs.filter((log) => {
    const matchSearch = !search || (log.userName?.toLowerCase().includes(search.toLowerCase())) ||
      (log.userMessage?.toLowerCase().includes(search.toLowerCase())) ||
      (log.botResponse?.toLowerCase().includes(search.toLowerCase()));
    const matchType = filterType === "all" || log.type === filterType || (filterType === "report" && log.isReport);
    return matchSearch && matchType;
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1">See everything your bot is doing across groups</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search activity..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-activity" />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="response">Responses</SelectItem>
              <SelectItem value="report">Reports</SelectItem>
              <SelectItem value="mention">Mentions</SelectItem>
              <SelectItem value="command">Commands</SelectItem>
              <SelectItem value="join">Joins</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Activity className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No activity found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {search ? "Try adjusting your search" : "Activity will appear here as the bot interacts with groups"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((log) => {
              const Icon = typeIcons[log.type] || Activity;
              return (
                <Card key={log.id} data-testid={`activity-log-${log.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center ${log.isReport ? "bg-destructive/10" : "bg-muted"}`}>
                        <Icon className={`h-4 w-4 ${log.isReport ? "text-destructive" : ""}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{log.userName || "System"}</span>
                            <Badge variant={log.isReport ? "destructive" : "secondary"} className="text-xs">
                              {log.isReport ? "Report" : log.type}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 font-mono">
                            {format(new Date(log.createdAt), "MMM d, HH:mm")}
                          </span>
                        </div>
                        {log.userMessage && (
                          <p className="text-sm text-muted-foreground mt-1">{log.userMessage}</p>
                        )}
                        {log.botResponse && (
                          <div className="mt-2 border-l-2 border-border pl-3 py-1">
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Bot Response</p>
                            <p className="text-sm">{log.botResponse}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
