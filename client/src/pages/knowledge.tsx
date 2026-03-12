import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { Plus, BookOpen, Link as LinkIcon, Trash2, Search, ExternalLink, Pencil, FileText, Bot } from "lucide-react";
import type { KnowledgeBaseEntry } from "@shared/schema";
import { format } from "date-fns";

function AddKnowledgeDialog({ botId, editEntry, onClose }: { botId: number; editEntry?: KnowledgeBaseEntry | null; onClose?: () => void }) {
  const [title, setTitle] = useState(editEntry?.title || "");
  const [content, setContent] = useState(editEntry?.content || "");
  const [sourceUrl, setSourceUrl] = useState(editEntry?.sourceUrl || "");
  const [category, setCategory] = useState(editEntry?.category || "general");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const isEditing = !!editEntry;
  const isDialogOpen = editEntry ? true : open;

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEditing) {
        return apiRequest("PATCH", `/api/bots/${botId}/knowledge/${editEntry.id}`, { title, content, sourceUrl: sourceUrl || null, category });
      }
      return apiRequest("POST", `/api/bots/${botId}/knowledge`, { title, content, sourceUrl: sourceUrl || null, category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "knowledge"] });
      toast({ title: isEditing ? "Entry updated" : "Entry added", description: `"${title}" has been ${isEditing ? "updated" : "added"} to the knowledge base.` });
      setTitle(""); setContent(""); setSourceUrl(""); setCategory("general");
      setOpen(false);
      onClose?.();
    },
    onError: () => {
      toast({ title: "Error", description: `Failed to ${isEditing ? "update" : "add"} entry.`, variant: "destructive" });
    },
  });

  const handleOpenChange = (v: boolean) => {
    if (isEditing) { if (!v) onClose?.(); }
    else setOpen(v);
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      {!isEditing && (
        <DialogTrigger asChild>
          <Button data-testid="button-add-knowledge">
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit" : "Add"} Knowledge Entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="kb-title">Title</Label>
            <Input id="kb-title" placeholder="e.g. How to reset password" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-kb-title" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-content">Content</Label>
            <Textarea id="kb-content" placeholder="Enter the knowledge content..." value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[120px]" data-testid="input-kb-content" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-url">Source URL (optional)</Label>
            <Input id="kb-url" placeholder="https://..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-testid="input-kb-url" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-kb-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="faq">FAQ</SelectItem>
                <SelectItem value="documentation">Documentation</SelectItem>
                <SelectItem value="rules">Rules</SelectItem>
                <SelectItem value="links">Links</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={!title.trim() || !content.trim() || mutation.isPending} data-testid="button-save-knowledge">
            {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasteContentDialog({ botId }: { botId: number }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/bots/${botId}/knowledge`, { title: title || "Imported Content", content, category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId, "knowledge"] });
      toast({ title: "Content imported", description: "Your text has been added to the knowledge base." });
      setTitle(""); setContent(""); setCategory("general");
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to import content.", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-paste-content">
          <FileText className="h-4 w-4 mr-2" />
          Paste Content
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste Content</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Paste a large block of text — like documentation, descriptions, or FAQs — and it will be saved as a knowledge base entry the bot can reference.</p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="paste-title">Title</Label>
            <Input id="paste-title" placeholder="e.g. Product Overview, Company Info..." value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-paste-title" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paste-content">Content</Label>
            <Textarea id="paste-content" placeholder="Paste your text here..." value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[200px]" data-testid="input-paste-content" />
            {content && <p className="text-xs text-muted-foreground font-mono">{content.length.toLocaleString()} characters</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="paste-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-paste-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="faq">FAQ</SelectItem>
                <SelectItem value="documentation">Documentation</SelectItem>
                <SelectItem value="rules">Rules</SelectItem>
                <SelectItem value="links">Links</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button onClick={() => mutation.mutate()} disabled={!content.trim() || mutation.isPending} data-testid="button-save-paste">
            {mutation.isPending ? "Importing..." : "Import Content"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgeBase() {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [editingEntry, setEditingEntry] = useState<KnowledgeBaseEntry | null>(null);
  const { selectedBotId } = useBot();
  const { toast } = useToast();

  const { data: entries = [], isLoading } = useQuery<KnowledgeBaseEntry[]>({
    queryKey: ["/api/bots", selectedBotId, "knowledge"],
    enabled: !!selectedBotId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bots/${selectedBotId}/knowledge/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "knowledge"] });
      toast({ title: "Entry deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/bots/${selectedBotId}/knowledge/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "knowledge"] });
    },
  });

  const filtered = entries.filter((e) => {
    const matchSearch = !search || e.title.toLowerCase().includes(search.toLowerCase()) || e.content.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === "all" || e.category === filterCategory;
    return matchSearch && matchCategory;
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

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Knowledge Base</h1>
            <p className="text-sm text-muted-foreground mt-1">Content the bot uses to answer questions</p>
          </div>
          <div className="flex gap-2">
            <PasteContentDialog botId={selectedBotId} />
            <AddKnowledgeDialog botId={selectedBotId} />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-knowledge" />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="faq">FAQ</SelectItem>
              <SelectItem value="documentation">Documentation</SelectItem>
              <SelectItem value="rules">Rules</SelectItem>
              <SelectItem value="links">Links</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No entries found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {search ? "Try adjusting your search" : "Add your first knowledge entry to get started"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((entry) => (
              <Card key={entry.id} className={!entry.isActive ? "opacity-60" : ""} data-testid={`card-knowledge-${entry.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold">{entry.title}</h3>
                        <Badge variant="secondary" className="text-xs font-mono">{entry.category}</Badge>
                        {!entry.isActive && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{entry.content}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {entry.sourceUrl && (
                          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-foreground underline underline-offset-2">
                            <ExternalLink className="h-3 w-3" />
                            Source
                          </a>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Added {format(new Date(entry.createdAt), "MMM d, yyyy")}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={entry.isActive}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: entry.id, isActive: checked })}
                        data-testid={`switch-toggle-${entry.id}`}
                      />
                      <Button size="icon" variant="ghost" onClick={() => setEditingEntry(entry)} data-testid={`button-edit-${entry.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" data-testid={`button-delete-${entry.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{entry.title}" from the knowledge base. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(entry.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-delete-${entry.id}`}
                            >
                              {deleteMutation.isPending ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {editingEntry && (
          <AddKnowledgeDialog botId={selectedBotId} editEntry={editingEntry} onClose={() => setEditingEntry(null)} />
        )}
      </div>
    </ScrollArea>
  );
}
