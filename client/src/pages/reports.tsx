import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertTriangle, Clock, User, Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { useBot } from "@/hooks/use-bot";
import type { ActivityLog } from "@shared/schema";
import { format } from "date-fns";

const PAGE_SIZE = 50;

export default function ReportsPage() {
  const { selectedBotId } = useBot();
  const [page, setPage] = useState(0);

  useEffect(() => { setPage(0); }, [selectedBotId]);

  const { data: reports = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/bots", selectedBotId, `reports?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`],
    enabled: !!selectedBotId,
  });

  const hasMore = reports.length === PAGE_SIZE;

  const todayReports = reports.filter(r => new Date(r.createdAt).toDateString() === new Date().toDateString()).length;
  const uniqueReporters = new Set(reports.map(r => r.userName).filter(Boolean)).size;

  if (!selectedBotId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <Bot className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">No bot selected</h2>
        <p className="text-sm text-muted-foreground mt-1">Use the bot switcher in the sidebar to create or select a bot.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Issues and reports detected from group conversations</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Showing</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="font-mono text-3xl font-bold" data-testid="text-total-reports">{reports.length}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">reports on this page</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Today</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="font-mono text-3xl font-bold">{todayReports}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">on this page</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Unique Reporters</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="font-mono text-3xl font-bold">{uniqueReporters}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">on this page</p>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Shield className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No reports yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Reports will appear here when users mention issues in groups</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <Card key={report.id} data-testid={`report-item-${report.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-destructive/10">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{report.userName || "Unknown"}</span>
                          <Badge variant="destructive" className="text-xs">Report</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          {format(new Date(report.createdAt), "MMM d, yyyy HH:mm")}
                        </span>
                      </div>
                      {report.userMessage && (
                        <p className="text-sm mt-1">{report.userMessage}</p>
                      )}
                      {report.botResponse && (
                        <div className="mt-2 border-l-2 border-border pl-3 py-1">
                          <p className="text-xs font-medium text-muted-foreground mb-0.5">Bot Acknowledgment</p>
                          <p className="text-sm">{report.botResponse}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && (page > 0 || hasMore) && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground font-mono" data-testid="text-page-number">Page {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
