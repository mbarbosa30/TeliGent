import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBot } from "@/hooks/use-bot";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Copy, Check, Code, MessageSquare, Clock, ExternalLink } from "lucide-react";

export default function WidgetPage() {
  const { selectedBotId, selectedBot } = useBot();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery<any>({
    queryKey: ["/api/bots", selectedBotId, "config"],
    enabled: !!selectedBotId,
  });

  const { data: conversations, isLoading: convsLoading } = useQuery<any[]>({
    queryKey: ["/api/bots", selectedBotId, "widget", "conversations"],
    enabled: !!selectedBotId && !!config?.widgetEnabled,
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bots/${selectedBotId}/widget/enable`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "config"] });
      toast({ title: "Widget enabled", description: "Your chat widget is now active." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to enable widget.", variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/bots/${selectedBotId}/widget/disable`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "config"] });
      toast({ title: "Widget disabled", description: "Your chat widget has been turned off." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disable widget.", variant: "destructive" });
    },
  });

  const widgetEnabled = config?.widgetEnabled;
  const widgetKey = config?.widgetKey;
  const domain = window.location.origin;
  const embedCode = `<script src="${domain}/widget.js" data-widget-key="${widgetKey || "YOUR_KEY"}"></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    toast({ title: "Copied", description: "Embed code copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggle = () => {
    if (widgetEnabled) {
      disableMutation.mutate();
    } else {
      enableMutation.mutate();
    }
  };

  if (!selectedBotId) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="text-no-bot">
        <p className="text-muted-foreground">Select a bot to configure the chat widget.</p>
      </div>
    );
  }

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-widget-title">Website Chat Widget</h1>
          <p className="text-muted-foreground mt-1">
            Embed an AI chat widget on your website. Uses the same knowledge base, memories, and personality as your Telegram bot.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Widget Status</CardTitle>
                <CardDescription>Enable or disable the chat widget for {selectedBot?.botName || "your bot"}</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={widgetEnabled ? "default" : "secondary"} data-testid="badge-widget-status">
                  {widgetEnabled ? "Active" : "Inactive"}
                </Badge>
                <Switch
                  checked={!!widgetEnabled}
                  onCheckedChange={handleToggle}
                  disabled={enableMutation.isPending || disableMutation.isPending}
                  data-testid="switch-widget-toggle"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        {widgetEnabled && widgetKey && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  Embed Code
                </CardTitle>
                <CardDescription>
                  Add this snippet to your website's HTML, just before the closing &lt;/body&gt; tag.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <pre className="bg-muted p-4 text-sm font-mono overflow-x-auto border" data-testid="text-embed-code">
                    {embedCode}
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={handleCopy}
                    data-testid="button-copy-embed"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  <span>Widget Key: <code className="font-mono">{widgetKey.substring(0, 12)}...</code></span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Recent Conversations
                </CardTitle>
                <CardDescription>
                  Website visitors who have chatted with your widget
                </CardDescription>
              </CardHeader>
              <CardContent>
                {convsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !conversations || conversations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-conversations">
                    No conversations yet. Embed the widget on your website to get started.
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="list-conversations">
                    {conversations.map((conv: any) => (
                      <div
                        key={conv.id}
                        className="flex items-center justify-between p-3 border hover:bg-muted/50 transition-colors"
                        data-testid={`card-conversation-${conv.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-8 bg-muted flex items-center justify-center shrink-0">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {conv.visitorName || `Visitor ${conv.sessionId.substring(0, 8)}`}
                            </p>
                            {conv.lastMessage && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">
                                {conv.lastMessage}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-xs">
                            {conv.messageCount} msgs
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(conv.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
