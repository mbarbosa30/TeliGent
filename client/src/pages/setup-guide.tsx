import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bot, MessageSquare, Settings, Shield, BookOpen,
  ExternalLink, CheckCircle2, ArrowRight, Sparkles,
} from "lucide-react";
import type { BotConfig } from "@shared/schema";

function StepCard({
  step,
  title,
  description,
  children,
  completed,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
  completed?: boolean;
}) {
  return (
    <Card className={completed ? "border-green-500/30 bg-green-500/5" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            completed
              ? "bg-green-500 text-white"
              : "bg-primary text-primary-foreground"
          }`}>
            {completed ? <CheckCircle2 className="h-4 w-4" /> : step}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              {title}
              {completed && (
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">
                  Done
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pl-[3.25rem]">{children}</CardContent>
    </Card>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <code className="inline-block px-2 py-0.5 bg-muted rounded text-sm font-mono">
      {children}
    </code>
  );
}

export default function SetupGuidePage() {
  const { data: config } = useQuery<BotConfig>({ queryKey: ["/api/config"] });

  const hasToken = !!(config?.botToken && config.botToken.trim());
  const hasName = !!(config?.botName && config.botName !== "ContextBot" && config.botName.trim());
  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-setup-title">Setup Guide</h1>
          </div>
          <p className="text-muted-foreground">
            Follow these steps to create your Telegram bot and connect it to ContextBot. The whole process takes about 5 minutes.
          </p>
        </div>

        <Separator />

        <div className="space-y-4">
          <StepCard
            step={1}
            title="Create a Bot on Telegram"
            description="Use Telegram's official BotFather to create your bot and get a token."
          >
            <div className="space-y-3 text-sm">
              <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
                <li>
                  Open Telegram and search for{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                    data-testid="link-botfather"
                  >
                    @BotFather <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Send the command <CodeBlock>/newbot</CodeBlock>
                </li>
                <li>
                  Choose a <strong>display name</strong> for your bot (e.g., "My Community Bot")
                </li>
                <li>
                  Choose a <strong>username</strong> ending in "bot" (e.g., "my_community_bot")
                </li>
                <li>
                  BotFather will reply with your <strong>bot token</strong> — it looks like this:
                  <div className="mt-1 p-2 bg-muted rounded-md font-mono text-xs break-all">
                    123456789:ABCdefGHIjklMNOpqrsTUVwxyz
                  </div>
                </li>
              </ol>
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-700 dark:text-amber-400 text-xs">
                <strong>Keep your token secret!</strong> Anyone with your token can control your bot. Never share it publicly.
              </div>
            </div>
          </StepCard>

          <StepCard
            step={2}
            title="Disable Privacy Mode"
            description="Allow your bot to read all group messages so it can detect scams and answer questions."
          >
            <div className="space-y-3 text-sm">
              <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
                <li>
                  Still in{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    @BotFather <ExternalLink className="h-3 w-3" />
                  </a>
                  , send <CodeBlock>/setprivacy</CodeBlock>
                </li>
                <li>Select your bot from the list</li>
                <li>Choose <strong>Disable</strong></li>
              </ol>
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-700 dark:text-amber-400 text-xs">
                <strong>Why is this important?</strong> By default, bots in groups can only see messages that mention them directly. Disabling privacy mode lets the bot read all messages — which is required for scam detection and auto-moderation.
              </div>
            </div>
          </StepCard>

          <StepCard
            step={3}
            title="Paste Your Bot Token"
            description="Connect your bot to ContextBot by entering the token in Settings."
            completed={hasToken}
          >
            <div className="space-y-3 text-sm">
              {hasToken ? (
                <p className="text-green-600 dark:text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Your bot token is connected!
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Copy the token from BotFather and paste it into the Bot Token field on the Settings page.
                  </p>
                  <Link href="/settings">
                    <Button size="sm" data-testid="button-goto-settings">
                      <Settings className="h-4 w-4 mr-2" />
                      Go to Settings
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </StepCard>

          <StepCard
            step={4}
            title="Configure Your Bot"
            description="Give your bot a name, personality, and behavior settings."
            completed={hasName && hasToken}
          >
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>On the Settings page, customize:</p>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <Bot className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span><strong>Bot Name</strong> — How your bot identifies itself</span>
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span><strong>Personality</strong> — The tone and style of bot responses</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span><strong>Scam Detection</strong> — Automatically detects and removes scam messages</span>
                </li>
              </ul>
              {!hasToken && (
                <p className="text-xs text-muted-foreground/60 italic">
                  Complete step 2 first to unlock bot configuration.
                </p>
              )}
            </div>
          </StepCard>

          <StepCard
            step={5}
            title="Add Your Bot to a Telegram Group"
            description="Invite the bot to the groups you want it to manage."
          >
            <div className="space-y-3 text-sm">
              <ol className="space-y-2 list-decimal list-inside text-muted-foreground">
                <li>Open your Telegram group</li>
                <li>
                  Tap the group name at the top, then <strong>"Add Members"</strong>
                </li>
                <li>Search for your bot's username and add it</li>
                <li>
                  <strong>Make the bot an Admin</strong> — it needs permission to read and delete messages
                </li>
                <li>
                  Grant these admin permissions:
                  <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                    <li>Delete Messages</li>
                    <li>Ban Users (optional, for scam response)</li>
                  </ul>
                </li>
              </ol>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md text-blue-700 dark:text-blue-400 text-xs">
                The bot will appear in your Connected Groups list on the Dashboard once someone sends a message in the group.
              </div>
            </div>
          </StepCard>

          <StepCard
            step={6}
            title="Add Knowledge to Your Bot"
            description="Teach your bot about your project so it can answer questions accurately."
          >
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Go to the Knowledge Base page and add information your bot should know, like:</p>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Project FAQ, tokenomics, roadmap</span>
                </li>
                <li className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Official links and social media</span>
                </li>
                <li className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <span>Rules and guidelines for your community</span>
                </li>
              </ul>
              <p className="text-xs">
                You can also paste a website URL to automatically import content.
              </p>
              <Link href="/knowledge">
                <Button size="sm" variant="outline" data-testid="button-goto-knowledge">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Go to Knowledge Base
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </StepCard>

          <StepCard
            step={7}
            title="You're All Set!"
            description="Your bot is now ready to protect and assist your community."
          >
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Once everything is connected, your bot will:</p>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Answer questions using your knowledge base</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Automatically detect and remove scam messages</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                  <span>Log all activity for you to review on the Dashboard</span>
                </li>
              </ul>
              <Link href="/">
                <Button size="sm" data-testid="button-goto-dashboard">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </StepCard>
        </div>
      </div>
    </ScrollArea>
  );
}
