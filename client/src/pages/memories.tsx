import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBot } from "@/hooks/use-bot";
import { Plus, Brain, Trash2, Bot, Sparkles, AlertCircle, MessageSquare, Target, Lightbulb } from "lucide-react";
import type { BotMemory } from "@shared/schema";
import { format } from "date-fns";

const typeConfig: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  correction: { label: "Correction", icon: AlertCircle, color: "text-orange-500" },
  preference: { label: "Preference", icon: MessageSquare, color: "text-blue-500" },
  topic: { label: "Topic", icon: Target, color: "text-green-500" },
  context: { label: "Context", icon: Lightbulb, color: "text-yellow-500" },
  insight: { label: "Insight", icon: Sparkles, color: "text-purple-500" },
};

function AddMemoryDialog({ botId }: { botId: number }) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("insight");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/bots/${botId}/memories`, { type, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "memories"] });
      toast({ title: "Memory added", description: "The bot will use this in future conversations." });
      setContent("");
      setType("insight");
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add memory.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-memory">
          <Plus className="h-4 w-4 mr-2" />
          Add Memory
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Memory</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Teach the bot something it should remember. This could be a correction, a community preference, or important context.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="mem-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-memory-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="correction">Correction</SelectItem>
                <SelectItem value="preference">Preference</SelectItem>
                <SelectItem value="topic">Topic</SelectItem>
                <SelectItem value="context">Context</SelectItem>
                <SelectItem value="insight">Insight</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mem-content">Content</Label>
            <Textarea
              id="mem-content"
              placeholder='e.g. "The token supply is 1 billion, not 100 million" or "Users prefer short, casual responses"'
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px]"
              data-testid="input-memory-content"
            />
            <p className="text-xs text-muted-foreground">{content.length}/300 characters</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => mutation.mutate()}
            disabled={content.trim().length < 5 || mutation.isPending}
            data-testid="button-save-memory"
          >
            {mutation.isPending ? "Saving..." : "Add Memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MemoriesPage() {
  const [filterType, setFilterType] = useState("all");
  const { selectedBotId } = useBot();
  const { toast } = useToast();

  const { data: memories = [], isLoading } = useQuery<BotMemory[]>({
    queryKey: ["/api/bots", selectedBotId, "memories"],
    enabled: !!selectedBotId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bots/${selectedBotId}/memories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "memories"] });
      toast({ title: "Memory deleted" });
    },
  });

  const filtered = memories.filter((m) => {
    return filterType === "all" || m.type === filterType;
  });

  const autoCount = memories.filter(m => m.source === "auto").length;
  const manualCount = memories.filter(m => m.source === "manual").length;

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Memories</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Things the bot has learned from conversations and manual input
            </p>
          </div>
          <AddMemoryDialog botId={selectedBotId} />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="correction">Corrections</SelectItem>
              <SelectItem value="preference">Preferences</SelectItem>
              <SelectItem value="topic">Topics</SelectItem>
              <SelectItem value="context">Context</SelectItem>
              <SelectItem value="insight">Insights</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>{memories.length} total</span>
            <span>{autoCount} auto-learned</span>
            <span>{manualCount} manual</span>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Brain className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No memories yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {memories.length > 0 ? "Try adjusting your filter" : "The bot will automatically learn from conversations, or you can add memories manually"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((memory) => {
              const config = typeConfig[memory.type] || typeConfig.insight;
              const Icon = config.icon;
              return (
                <Card key={memory.id} data-testid={`card-memory-${memory.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{memory.content}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge variant="secondary" className="text-xs font-mono">{config.label}</Badge>
                            <Badge variant="outline" className="text-xs">
                              {memory.source === "auto" ? "Auto-learned" : "Manual"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(memory.createdAt), "MMM d, yyyy")}
                            </span>
                          </div>
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="shrink-0" data-testid={`button-delete-memory-${memory.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The bot will no longer use this information in conversations.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(memory.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-delete-memory-${memory.id}`}
                            >
                              {deleteMutation.isPending ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
