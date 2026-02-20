import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, AlertTriangle, Clock, User } from "lucide-react";
import type { ActivityLog } from "@shared/schema";
import { format } from "date-fns";

export default function ReportsPage() {
  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({ queryKey: ["/api/activity"] });

  const reports = logs.filter((l) => l.isReport);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Reports</h1>
          <p className="text-muted-foreground mt-1">Issues and reports detected from group conversations</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Reports</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold" data-testid="text-total-reports">{reports.length}</div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold">
                  {reports.filter(r => new Date(r.createdAt).toDateString() === new Date().toDateString()).length}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unique Reporters</CardTitle>
              <User className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-2xl font-bold">
                  {new Set(reports.map(r => r.userName).filter(Boolean)).size}
                </div>
              )}
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
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{report.userName || "Unknown"}</span>
                          <Badge variant="destructive" className="text-xs">Report</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(report.createdAt), "MMM d, yyyy HH:mm")}
                        </span>
                      </div>
                      {report.userMessage && (
                        <p className="text-sm mt-1">{report.userMessage}</p>
                      )}
                      {report.botResponse && (
                        <div className="mt-2 p-2.5 rounded-md bg-secondary/50">
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
      </div>
    </ScrollArea>
  );
}
