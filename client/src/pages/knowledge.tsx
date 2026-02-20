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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, BookOpen, Link as LinkIcon, Trash2, Search, ExternalLink, Pencil } from "lucide-react";
import type { KnowledgeBaseEntry } from "@shared/schema";
import { format } from "date-fns";

function AddKnowledgeDialog({ editEntry, onClose }: { editEntry?: KnowledgeBaseEntry | null; onClose?: () => void }) {
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
        return apiRequest("PATCH", `/api/knowledge/${editEntry.id}`, { title, content, sourceUrl: sourceUrl || null, category });
      }
      return apiRequest("POST", "/api/knowledge", { title, content, sourceUrl: sourceUrl || null, category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
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

export default function KnowledgeBase() {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [editingEntry, setEditingEntry] = useState<KnowledgeBaseEntry | null>(null);
  const { data: entries = [], isLoading } = useQuery<KnowledgeBaseEntry[]>({ queryKey: ["/api/knowledge"] });
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/knowledge/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({ title: "Entry deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/knowledge/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
    },
  });

  const filtered = entries.filter((e) => {
    const matchSearch = !search || e.title.toLowerCase().includes(search.toLowerCase()) || e.content.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === "all" || e.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const categories = [...new Set(entries.map(e => e.category))];

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Knowledge Base</h1>
            <p className="text-muted-foreground mt-1">Content the bot uses to answer questions</p>
          </div>
          <AddKnowledgeDialog />
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
                        <Badge variant="secondary" className="text-xs">{entry.category}</Badge>
                        {!entry.isActive && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{entry.content}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {entry.sourceUrl && (
                          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary">
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
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(entry.id)} data-testid={`button-delete-${entry.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {editingEntry && (
          <AddKnowledgeDialog editEntry={editingEntry} onClose={() => setEditingEntry(null)} />
        )}
      </div>
    </ScrollArea>
  );
}
