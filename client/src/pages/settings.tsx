import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Bot, MessageSquare, Shield, Zap, Save, Globe, FileText, Loader2 } from "lucide-react";
import type { BotConfig } from "@shared/schema";

const settingsSchema = z.object({
  botName: z.string().min(1, "Bot name is required"),
  personality: z.string().min(10, "Personality prompt should be at least 10 characters"),
  globalContext: z.string(),
  websiteUrl: z.string(),
  responseMode: z.string(),
  cooldownSeconds: z.number().min(0).max(3600),
  maxResponseLength: z.number().min(50).max(4000),
  isActive: z.boolean(),
  onlyRespondWhenMentioned: z.boolean(),
  respondToReplies: z.boolean(),
  trackReports: z.boolean(),
  reportKeywords: z.array(z.string()),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { data: config, isLoading } = useQuery<BotConfig>({ queryKey: ["/api/config"] });
  const { toast } = useToast();

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      botName: "",
      personality: "",
      globalContext: "",
      websiteUrl: "",
      responseMode: "smart",
      cooldownSeconds: 30,
      maxResponseLength: 500,
      isActive: true,
      onlyRespondWhenMentioned: false,
      respondToReplies: true,
      trackReports: true,
      reportKeywords: ["report", "issue", "bug", "problem", "broken"],
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        botName: config.botName,
        personality: config.personality,
        globalContext: config.globalContext || "",
        websiteUrl: config.websiteUrl || "",
        responseMode: config.responseMode,
        cooldownSeconds: config.cooldownSeconds,
        maxResponseLength: config.maxResponseLength,
        isActive: config.isActive,
        onlyRespondWhenMentioned: config.onlyRespondWhenMentioned,
        respondToReplies: config.respondToReplies,
        trackReports: config.trackReports,
        reportKeywords: config.reportKeywords || ["report", "issue", "bug", "problem", "broken"],
      });
    }
  }, [config, form]);

  const mutation = useMutation({
    mutationFn: (data: SettingsForm) => {
      if (!config) throw new Error("Config not loaded yet");
      return apiRequest("PATCH", "/api/config", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Settings saved", description: "Your bot configuration has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/scrape-website", { url });
      return res.json();
    },
    onSuccess: (data: { content: string; length: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Website imported", description: `Extracted ${data.length.toLocaleString()} characters of content from your website.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to fetch website content. Make sure the URL is correct and accessible.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Settings</h1>
            <p className="text-muted-foreground mt-1">Configure how your bot behaves</p>
          </div>
          <Button onClick={form.handleSubmit((d) => mutation.mutate(d))} disabled={mutation.isPending || isLoading || !config} data-testid="button-save-settings">
            <Save className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <Form {...form}>
          <form className="space-y-6" onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">General</CardTitle>
                </div>
                <CardDescription>Basic bot identity and status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="botName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Name</FormLabel>
                    <FormControl><Input {...field} data-testid="input-bot-name" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Active</FormLabel>
                      <FormDescription>Enable or disable the bot</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-bot-active" />
                    </FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Context & Knowledge</CardTitle>
                </div>
                <CardDescription>Give the bot background information about your project or community</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="globalContext" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Global Context</FormLabel>
                    <FormControl><Textarea {...field} placeholder="Describe your project, community, or organization here. For example: 'We are SelfClaw, a web3 gaming community focused on...' This text is included in every AI response as background knowledge." className="min-h-[120px]" data-testid="input-global-context" /></FormControl>
                    <FormDescription>This description is included in every AI response as background knowledge</FormDescription>
                  </FormItem>
                )} />
                <Separator />
                <div className="space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Website Import</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Paste your website URL and the bot will extract its content as context</p>
                  </div>
                  <div className="flex gap-2">
                    <FormField control={form.control} name="websiteUrl" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input {...field} placeholder="https://your-website.com" data-testid="input-website-url" /></FormControl>
                      </FormItem>
                    )} />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!form.watch("websiteUrl")?.trim() || scrapeMutation.isPending}
                      onClick={() => {
                        const url = form.getValues("websiteUrl");
                        if (url) scrapeMutation.mutate(url);
                      }}
                      data-testid="button-import-website"
                    >
                      {scrapeMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</>
                      ) : (
                        <><Globe className="h-4 w-4 mr-2" />Import</>
                      )}
                    </Button>
                  </div>
                  {config?.websiteContent && (
                    <div className="rounded-md bg-muted/50 p-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Imported website content ({config.websiteContent.length.toLocaleString()} characters)</p>
                      <p className="text-xs text-muted-foreground line-clamp-3">{config.websiteContent.slice(0, 300)}...</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Response Behavior</CardTitle>
                </div>
                <CardDescription>Control how and when the bot responds</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="personality" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Personality / System Prompt</FormLabel>
                    <FormControl><Textarea {...field} className="min-h-[100px]" data-testid="input-personality" /></FormControl>
                    <FormDescription>Instructions that shape how the bot communicates</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="responseMode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response Mode</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-response-mode">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="smart">Smart (AI decides when to respond)</SelectItem>
                        <SelectItem value="always">Always respond to messages</SelectItem>
                        <SelectItem value="mentioned">Only when mentioned</SelectItem>
                        <SelectItem value="questions">Only to questions</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>How the bot decides whether to reply</FormDescription>
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="cooldownSeconds" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cooldown (seconds)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-cooldown" />
                      </FormControl>
                      <FormDescription>Min time between responses</FormDescription>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="maxResponseLength" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Response Length</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 200)} data-testid="input-max-length" />
                      </FormControl>
                      <FormDescription>Characters limit for replies</FormDescription>
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="onlyRespondWhenMentioned" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Only When Mentioned</FormLabel>
                      <FormDescription>Only respond when @mentioned</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-mention-only" />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="respondToReplies" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Respond to Replies</FormLabel>
                      <FormDescription>Reply when users reply to bot messages</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-respond-replies" />
                    </FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Report Tracking</CardTitle>
                </div>
                <CardDescription>Detect and track user reports automatically</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="trackReports" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Track Reports</FormLabel>
                      <FormDescription>Auto-detect messages that report issues</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-track-reports" />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="reportKeywords" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Report Keywords</FormLabel>
                    <FormControl>
                      <Input
                        value={field.value.join(", ")}
                        onChange={(e) => field.onChange(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                        data-testid="input-report-keywords"
                      />
                    </FormControl>
                    <FormDescription>Comma-separated words that trigger report detection</FormDescription>
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>
    </ScrollArea>
  );
}
