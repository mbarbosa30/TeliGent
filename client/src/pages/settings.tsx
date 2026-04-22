import { useEffect, useRef } from "react";
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
import { useBot } from "@/hooks/use-bot";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Bot, MessageSquare, Shield, Zap, Save, Globe, FileText, Loader2, Key, AlertTriangle, Trash2, Link, ExternalLink, Check, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { BotConfig } from "@shared/schema";

const settingsSchema = z.object({
  botToken: z.string(),
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
  autoBanThreshold: z.number().min(0).max(100),
  scamSensitivity: z.string(),
  trackReports: z.boolean(),
  reportKeywords: z.array(z.string()),
  bankrEnabled: z.boolean(),
  bankrApiKey: z.string(),
  rewardsEnabled: z.boolean(),
  rewardTokenChain: z.string(),
  rewardTokenAddress: z.string(),
  rewardTokenSymbol: z.string(),
  rewardTokenDecimals: z.number().min(0).max(36),
  rewardAmountPerWinner: z.string(),
  rewardPoolPerPeriod: z.string(),
  rewardTopN: z.number().min(1).max(50),
  rewardPeriodDays: z.number().min(1).max(60),
  rewardMinDaysActive: z.number().min(0).max(60),
  rewardMaxPerUserPerPeriod: z.number().min(1).max(10),
  rewardMaxPerUserPerPeriodVerified: z.number().min(1).max(20),
  rewardRequireSelfVerified: z.boolean(),
  proactiveEnabled: z.boolean(),
  proactiveMode: z.string(),
  proactiveCadenceHours: z.number().min(1).max(720),
  feedbackEnabled: z.boolean(),
  feedbackThemes: z.array(z.string()),
  feedbackMixRatio: z.number().min(0).max(100),
  referralEnabled: z.boolean(),
  referralActivationDays: z.number().min(0).max(60),
  referralRewardAmount: z.string(),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { selectedBotId, bots, selectBot } = useBot();
  const { toast } = useToast();

  const { data: config, isLoading } = useQuery<BotConfig>({
    queryKey: ["/api/bots", selectedBotId, "config"],
    enabled: !!selectedBotId,
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      botToken: "",
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
      autoBanThreshold: 0,
      scamSensitivity: "medium",
      trackReports: true,
      reportKeywords: ["report", "issue", "bug", "problem", "broken"],
      bankrEnabled: false,
      bankrApiKey: "",
      rewardsEnabled: false,
      rewardTokenChain: "base",
      rewardTokenAddress: "",
      rewardTokenSymbol: "TOKEN",
      rewardTokenDecimals: 18,
      rewardAmountPerWinner: "0",
      rewardPoolPerPeriod: "0",
      rewardTopN: 5,
      rewardPeriodDays: 7,
      rewardMinDaysActive: 3,
      rewardMaxPerUserPerPeriod: 1,
      rewardMaxPerUserPerPeriodVerified: 2,
      rewardRequireSelfVerified: false,
      proactiveEnabled: false,
      proactiveMode: "queue",
      proactiveCadenceHours: 24,
      feedbackEnabled: false,
      feedbackThemes: ["improvements", "feature_requests", "pain_points"],
      feedbackMixRatio: 40,
      referralEnabled: false,
      referralActivationDays: 3,
      referralRewardAmount: "0",
    },
  });

  const prevBotIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (config) {
      const isBotSwitch = prevBotIdRef.current !== selectedBotId;
      prevBotIdRef.current = selectedBotId;

      const configValues: SettingsForm = {
        botToken: config.botToken || "",
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
        autoBanThreshold: config.autoBanThreshold ?? 0,
        scamSensitivity: (config as any).scamSensitivity ?? "medium",
        trackReports: config.trackReports,
        reportKeywords: config.reportKeywords || ["report", "issue", "bug", "problem", "broken"],
        bankrEnabled: config.bankrEnabled ?? false,
        bankrApiKey: config.bankrApiKey ?? "",
        rewardsEnabled: config.rewardsEnabled ?? false,
        rewardTokenChain: config.rewardTokenChain ?? "base",
        rewardTokenAddress: config.rewardTokenAddress ?? "",
        rewardTokenSymbol: config.rewardTokenSymbol ?? "TOKEN",
        rewardTokenDecimals: config.rewardTokenDecimals ?? 18,
        rewardAmountPerWinner: config.rewardAmountPerWinner ?? "0",
        rewardPoolPerPeriod: config.rewardPoolPerPeriod ?? "0",
        rewardTopN: config.rewardTopN ?? 5,
        rewardPeriodDays: config.rewardPeriodDays ?? 7,
        rewardMinDaysActive: config.rewardMinDaysActive ?? 3,
        rewardMaxPerUserPerPeriod: config.rewardMaxPerUserPerPeriod ?? 1,
        rewardMaxPerUserPerPeriodVerified: config.rewardMaxPerUserPerPeriodVerified ?? 2,
        rewardRequireSelfVerified: config.rewardRequireSelfVerified ?? false,
        proactiveEnabled: config.proactiveEnabled ?? false,
        proactiveMode: config.proactiveMode ?? "queue",
        proactiveCadenceHours: config.proactiveCadenceHours ?? 24,
        feedbackEnabled: config.feedbackEnabled ?? false,
        feedbackThemes: config.feedbackThemes ?? ["improvements", "feature_requests", "pain_points"],
        feedbackMixRatio: config.feedbackMixRatio ?? 40,
        referralEnabled: config.referralEnabled ?? false,
        referralActivationDays: config.referralActivationDays ?? 3,
        referralRewardAmount: config.referralRewardAmount ?? "0",
      };

      if (isBotSwitch) {
        form.reset(configValues);
      } else {
        form.reset(configValues, { keepDirtyValues: true });
      }
    }
  }, [config, form, selectedBotId]);

  const mutation = useMutation({
    mutationFn: (data: SettingsForm) => {
      if (!selectedBotId) throw new Error("No bot selected");
      const { bankrApiKey, ...rest } = data;
      const payload: Partial<SettingsForm> = { ...rest };
      if (!bankrApiKey || !bankrApiKey.includes("*")) {
        payload.bankrApiKey = bankrApiKey;
      }
      return apiRequest("PATCH", `/api/bots/${selectedBotId}/config`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      toast({ title: "Settings saved", description: "Your bot configuration has been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", `/api/bots/${selectedBotId}/scrape-website`, { url });
      return res.json();
    },
    onSuccess: (data: { content: string; length: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "config"] });
      toast({ title: "Website imported", description: `Extracted ${data.length.toLocaleString()} characters of content from your website.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to fetch website content. Make sure the URL is correct and accessible.", variant: "destructive" });
    },
  });

  const deleteBotMutation = useMutation({
    mutationFn: () => {
      if (!selectedBotId) throw new Error("No bot selected");
      return apiRequest("DELETE", `/api/bots/${selectedBotId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      const remaining = bots.filter(b => b.id !== selectedBotId);
      if (remaining.length > 0) {
        selectBot(remaining[0].id);
      }
      toast({ title: "Bot deleted", description: "The bot and all its data have been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete bot.", variant: "destructive" });
    },
  });

  const { data: celoStatus } = useQuery<{
    registered: boolean;
    agentId: number | null;
    txHash: string | null;
    registeredAt: string | null;
    explorerUrl: string | null;
  }>({
    queryKey: ["/api/bots", selectedBotId, "erc8004", "status"],
    enabled: !!selectedBotId,
  });

  const celoRegisterMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bots/${selectedBotId}/erc8004/register`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBotId, "erc8004", "status"] });
      toast({ title: "Registered on Celo", description: `Agent ID: ${data.agentId}. Transaction confirmed on-chain.` });
    },
    onError: (err: any) => {
      toast({ title: "Registration failed", description: err.message || "Could not register on Celo. Check wallet balance.", variant: "destructive" });
    },
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
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Configure how your bot behaves</p>
          </div>
          <Button onClick={form.handleSubmit((d) => mutation.mutate(d))} disabled={mutation.isPending || isLoading || !config} data-testid="button-save-settings">
            <Save className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <Form {...form}>
          <form className="space-y-6" onSubmit={form.handleSubmit((d) => { if (config) mutation.mutate(d); })}>
            {!config?.botToken?.trim() && (
              <Card className="border-foreground/30" data-testid="banner-setup-token">
                <CardContent className="flex items-start gap-3 pt-5 pb-4">
                  <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Bot token required</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add your Telegram bot token below to get started. You can get one from <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 font-medium">@BotFather</a> on Telegram.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Telegram Bot Token</CardTitle>
                </div>
                <CardDescription>Connect your Telegram bot by entering its token from @BotFather</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="botToken" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Token</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        data-testid="input-bot-token"
                      />
                    </FormControl>
                    <FormDescription>Your token is stored securely and never shared</FormDescription>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

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
                    <div className="bg-muted p-3 space-y-1">
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
                        <SelectItem value="smart">Smart (AI picks when to join in)</SelectItem>
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
                <FormField control={form.control} name="autoBanThreshold" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auto-Ban Threshold</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} min={0} max={100} data-testid="input-auto-ban-threshold" />
                    </FormControl>
                    <FormDescription>Ban user after this many auto-deleted scam messages (0 = disabled)</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="scamSensitivity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scam Detection Sensitivity</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-scam-sensitivity"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low — only flag clear, unambiguous scams</SelectItem>
                        <SelectItem value="medium">Medium — balanced (recommended)</SelectItem>
                        <SelectItem value="high">High — flag aggressively, more false positives</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>Controls how strict the AI and learned-pattern checks are. Lower means fewer deletions and a softer AI verdict.</FormDescription>
                  </FormItem>
                )} />
                <RecentlyFlaggedList botId={selectedBotId!} />
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

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Rewards & Engagement</CardTitle>
                </div>
                <CardDescription>Score top contributors, send token rewards, and run referral campaigns</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField control={form.control} name="rewardsEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enable Token Rewards</FormLabel>
                      <FormDescription>Periodically pay top contributors in an ERC-20 token</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-rewards-enabled" />
                    </FormControl>
                  </FormItem>
                )} />
                {form.watch("rewardsEnabled") && (
                  <div className="space-y-4 pl-2 border-l">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="rewardTokenChain" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Chain</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger data-testid="select-reward-chain"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="base">Base</SelectItem>
                              <SelectItem value="celo">Celo</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rewardTokenSymbol" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Token Symbol</FormLabel>
                          <FormControl><Input {...field} data-testid="input-reward-symbol" /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="rewardTokenAddress" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Token Contract Address</FormLabel>
                        <FormControl><Input placeholder="0x..." {...field} data-testid="input-reward-token" /></FormControl>
                        <FormDescription>ERC-20 contract on the selected chain</FormDescription>
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="rewardTokenDecimals" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Decimals</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-decimals" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rewardAmountPerWinner" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount per Winner</FormLabel>
                          <FormControl><Input {...field} placeholder="100" data-testid="input-reward-amount" /></FormControl>
                          <FormDescription>In token units (e.g. 100 = 100 $TELI). Used when no pool is set.</FormDescription>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="rewardPoolPerPeriod" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pool per Period (optional)</FormLabel>
                        <FormControl><Input {...field} placeholder="0" data-testid="input-reward-pool" /></FormControl>
                        <FormDescription>If set above 0, this whole pool is split equally among eligible winners (overrides Amount per Winner).</FormDescription>
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-3 gap-3">
                      <FormField control={form.control} name="rewardTopN" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Top N</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-topn" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rewardPeriodDays" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Period (days)</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-period" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rewardMinDaysActive" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Min Days Active</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-mindays" /></FormControl>
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={form.control} name="rewardMaxPerUserPerPeriod" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max wins per user / period</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-maxperuser" /></FormControl>
                          <FormDescription>Base cap for unverified members.</FormDescription>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="rewardMaxPerUserPerPeriodVerified" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max wins per user / period (Self verified)</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-reward-maxperuser-verified" /></FormControl>
                          <FormDescription>Higher cap when the member has Self Protocol verification on file.</FormDescription>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="rewardRequireSelfVerified" render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel>Require Self Protocol verification</FormLabel>
                          <FormDescription>If on, only members with proof-of-human verification are eligible for payouts.</FormDescription>
                        </div>
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-reward-require-verified" /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                )}

                <Separator />

                <FormField control={form.control} name="proactiveEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enable Proactive Engagement</FormLabel>
                      <FormDescription>Bot generates and posts open questions about trending topics</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-proactive-enabled" />
                    </FormControl>
                  </FormItem>
                )} />
                {form.watch("proactiveEnabled") && (
                  <div className="grid grid-cols-2 gap-3 pl-2 border-l">
                    <FormField control={form.control} name="proactiveMode" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mode</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger data-testid="select-proactive-mode"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="queue">Queue for review</SelectItem>
                            <SelectItem value="auto">Auto-post</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="proactiveCadenceHours" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cadence (hours)</FormLabel>
                        <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-proactive-cadence" /></FormControl>
                      </FormItem>
                    )} />
                  </div>
                )}

                <Separator />

                <FormField control={form.control} name="feedbackEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enable Community Feedback Loop</FormLabel>
                      <FormDescription>Bot periodically posts open feedback questions and captures replies as structured insights</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-feedback-enabled" />
                    </FormControl>
                  </FormItem>
                )} />
                {form.watch("feedbackEnabled") && (
                  <div className="space-y-3 pl-2 border-l">
                    <FormField control={form.control} name="feedbackThemes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Feedback Themes</FormLabel>
                        <FormDescription>Pick which areas the bot rotates through when asking for feedback</FormDescription>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {[
                            { v: "improvements", l: "Improvements" },
                            { v: "feature_requests", l: "Feature requests" },
                            { v: "pain_points", l: "Pain points" },
                            { v: "missing_info", l: "Missing info" },
                            { v: "success_stories", l: "Success stories" },
                            { v: "general", l: "General check-in" },
                          ].map(opt => {
                            const checked = (field.value || []).includes(opt.v);
                            return (
                              <button
                                type="button"
                                key={opt.v}
                                onClick={() => {
                                  const current = field.value || [];
                                  field.onChange(checked ? current.filter((t: string) => t !== opt.v) : [...current, opt.v]);
                                }}
                                className={`px-3 py-1 text-xs border ${checked ? "bg-foreground text-background" : "bg-background"}`}
                                data-testid={`button-theme-${opt.v}`}
                              >
                                {opt.l}
                              </button>
                            );
                          })}
                        </div>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="feedbackMixRatio" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Feedback vs Pattern Mix ({field.value}% feedback)</FormLabel>
                        <FormControl>
                          <Input type="range" min={0} max={100} step={5} value={field.value} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-feedback-mix" />
                        </FormControl>
                        <FormDescription>0 means always ask about recurring patterns, 100 means always ask for feedback</FormDescription>
                      </FormItem>
                    )} />
                  </div>
                )}

                <Separator />

                <FormField control={form.control} name="referralEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enable Referrals</FormLabel>
                      <FormDescription>Members earn rewards by inviting active new users</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-referral-enabled" />
                    </FormControl>
                  </FormItem>
                )} />
                {form.watch("referralEnabled") && (
                  <div className="grid grid-cols-2 gap-3 pl-2 border-l">
                    <FormField control={form.control} name="referralActivationDays" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Activation Days</FormLabel>
                        <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value || "0"))} data-testid="input-referral-days" /></FormControl>
                        <FormDescription>Referee must stay active for this many days</FormDescription>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="referralRewardAmount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referral Reward</FormLabel>
                        <FormControl><Input {...field} placeholder="50" data-testid="input-referral-amount" /></FormControl>
                        <FormDescription>Token amount paid to referrer</FormDescription>
                      </FormItem>
                    )} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Crypto Intelligence</CardTitle>
                </div>
                <CardDescription>Real-time token prices and crypto data powered by Bankr</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="bankrEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enable Crypto Intelligence</FormLabel>
                      <FormDescription>Answer token price queries and crypto questions with live data</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-bankr-enabled" />
                    </FormControl>
                  </FormItem>
                )} />
                {form.watch("bankrEnabled") && (
                  <FormField control={form.control} name="bankrApiKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bankr API Key (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="bk_... (leave empty to use platform key)"
                          {...field}
                          data-testid="input-bankr-api-key"
                        />
                      </FormControl>
                      <FormDescription>Override the platform API key with your own from bankr.bot/api</FormDescription>
                    </FormItem>
                  )} />
                )}
                {form.watch("bankrEnabled") && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      When enabled, your bot responds to /price commands and enriches AI answers with live crypto data.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Link className="h-5 w-5" />
                  <CardTitle className="text-base">ERC-8004 — On-chain Identity</CardTitle>
                </div>
                <CardDescription>Register this bot as a verifiable on-chain agent on Celo</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {celoStatus?.registered ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">Registered on Celo</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Agent ID</span>
                        <Badge variant="default" className="font-mono" data-testid="badge-celo-agent-id">
                          #{celoStatus.agentId}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Transaction</span>
                        <a
                          href={celoStatus.explorerUrl || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-primary hover:underline flex items-center gap-1 truncate max-w-[220px]"
                          data-testid="link-celo-tx"
                        >
                          {celoStatus.txHash?.slice(0, 10)}...{celoStatus.txHash?.slice(-8)}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Registered</span>
                        <span className="text-xs text-muted-foreground" data-testid="text-celo-registered-at">
                          {celoStatus.registeredAt ? new Date(celoStatus.registeredAt).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        This bot has a verifiable on-chain identity on Celo via the ERC-8004 Agent Identity Registry.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Register this bot on the ERC-8004 Agent Identity Registry on Celo. This creates a unique, verifiable on-chain identity with the bot's real stats and capabilities.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => celoRegisterMutation.mutate()}
                      disabled={celoRegisterMutation.isPending}
                      data-testid="button-register-celo"
                    >
                      {celoRegisterMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Registering on Celo...
                        </>
                      ) : (
                        <>
                          <Link className="h-4 w-4 mr-2" />
                          Register on Celo
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-destructive" />
                  <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
                </div>
                <CardDescription>Permanently delete this bot and all its data</CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" data-testid="button-delete-bot">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Bot
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this bot?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the bot "{config?.botName}" and all associated data including knowledge base entries, activity logs, and group connections. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteBotMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        data-testid="button-confirm-delete-bot"
                      >
                        {deleteBotMutation.isPending ? "Deleting..." : "Delete permanently"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </form>
        </Form>
      </div>
    </ScrollArea>
  );
}

function RecentlyFlaggedList({ botId }: { botId: number }) {
  const { data, isLoading } = useQuery<Array<{ id: number; userName: string | null; userMessage: string | null; metadata: any; createdAt: string }>>({
    queryKey: ["/api/bots", botId, "scam-flagged"],
    enabled: !!botId,
  });
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Recently Flagged (last 20)</Label>
      <p className="text-xs text-muted-foreground">Auto-deleted scam messages. Use these to judge whether your sensitivity is too strict or too loose.</p>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="text-no-flagged">No auto-deleted messages yet.</p>
      ) : (
        <div className="border divide-y" data-testid="list-flagged">
          {data.map((item) => (
            <div key={item.id} className="p-2 space-y-1" data-testid={`row-flagged-${item.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium truncate">{item.userName || "Unknown"}</span>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              {item.metadata?.reason && (
                <Badge variant="outline" className="text-[10px]">{String(item.metadata.reason).slice(0, 80)}</Badge>
              )}
              <p className="text-xs text-muted-foreground line-clamp-2">{item.userMessage || ""}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
