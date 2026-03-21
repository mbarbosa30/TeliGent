import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, Shield, Brain, Zap, Users, Globe, Loader2, MessageCircle, ShieldCheck, Radio, Sparkles, BarChart3, Copy, Check, ChevronDown, Cpu } from "lucide-react";
import { SiX, SiTelegram } from "react-icons/si";
import { useAuth } from "@/hooks/use-auth";

function AuthForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const { login, register, isLoggingIn, isRegistering } = useAuth();

  const isPending = isLoggingIn || isRegistering;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    try {
      if (mode === "login") {
        await login({ email, password });
      } else {
        await register({ email, password, firstName, lastName });
      }
    } catch (err: any) {
      const msg = err?.message || "Something went wrong";
      try {
        const jsonStr = msg.substring(msg.indexOf(": ") + 2);
        const parsed = JSON.parse(jsonStr);
        setError(parsed.message || msg);
      } catch {
        setError(msg);
      }
    }
  }

  return (
    <Card className="w-full max-w-sm mx-auto">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-xl">{mode === "login" ? "Sign In" : "Create Account"}</CardTitle>
        <CardDescription>
          {mode === "login"
            ? "Enter your email and password to sign in"
            : "Fill in your details to create an account"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-last-name"
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              data-testid="input-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
              data-testid="input-password"
            />
          </div>
          {error && (
            <p className="text-sm text-red-500" data-testid="text-auth-error">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-auth-submit">
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {mode === "login" ? "Sign In" : "Create Account"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>Don't have an account?{" "}
                <button type="button" onClick={() => { setMode("register"); setError(""); }} className="text-foreground underline underline-offset-2 font-medium" data-testid="button-switch-register">
                  Sign Up
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-foreground underline underline-offset-2 font-medium" data-testid="button-switch-login">
                  Sign In
                </button>
              </>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function AnimatedCounter({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!value || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(Math.round(eased * value));
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value, duration]);

  const formatted = display >= 1000 ? `${(display / 1000).toFixed(1)}k`.replace('.0k', 'k') : String(display);
  return <span ref={ref}>{formatted}</span>;
}

function MetricsSection() {
  const { data: stats } = useQuery<{ scamsCaught: number; groupsProtected: number; botsActive: number; conversationsHandled: number }>({
    queryKey: ["/api/public/stats"],
    staleTime: 5 * 60 * 1000,
  });

  if (!stats) return null;
  const hasData = stats.scamsCaught > 0 || stats.conversationsHandled > 0 || stats.groupsProtected > 0;
  if (!hasData) return null;

  const metrics = [
    { label: "Scams Blocked", value: stats.scamsCaught, icon: ShieldCheck },
    { label: "AI Conversations", value: stats.conversationsHandled, icon: MessageCircle },
    { label: "Groups Protected", value: stats.groupsProtected, icon: Users },
    { label: "Active Bots", value: stats.botsActive, icon: Radio },
  ].filter(m => m.value > 0);

  return (
    <section className="py-12 px-6 border-t">
      <div className="max-w-4xl mx-auto">
        <div className={`grid grid-cols-2 ${metrics.length === 4 ? 'md:grid-cols-4' : metrics.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
          {metrics.map((m) => (
            <div key={m.label} className="text-center space-y-1" data-testid={`stat-${m.label.toLowerCase().replace(/\s+/g, '-')}`}>
              <m.icon className="h-4 w-4 mx-auto text-muted-foreground mb-2" />
              <p className="text-3xl sm:text-4xl font-bold font-mono tracking-tight">
                <AnimatedCounter value={m.value} />
              </p>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const TOKEN_CA = "0x2822656E2Eec1c608a223752B4e0A651b50c4bA3";

function TokenAddress() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(TOKEN_CA).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="text-xs font-mono select-all" data-testid="text-token-ca">{TOKEN_CA}</code>
      <button
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-copy-ca"
        aria-label="Copy contract address"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

const FAQ_ITEMS = [
  {
    question: "What is TeliGent?",
    answer: "TeliGent is an AI-powered Telegram bot platform that moderates your community, detects scams and spam in real time, and engages members with intelligent, on-brand responses. It learns from your website, knowledge base, and conversation history to provide contextual support."
  },
  {
    question: "How does the scam detection work?",
    answer: "TeliGent uses a multi-layered approach combining deterministic pattern matching (detecting phishing, DM solicitation, pump schemes, impersonation) with AI-powered analysis. It catches scam messages that bypass simple keyword filters by understanding context, homoglyph evasion, and message structure."
  },
  {
    question: "Is TeliGent free to use?",
    answer: "Yes, TeliGent is free to set up and use. You just need your own Telegram bot token from BotFather. No credit card is required to get started."
  },
  {
    question: "What types of communities can use TeliGent?",
    answer: "TeliGent works for any Telegram community — crypto and web3 projects, NFT communities, DeFi protocols, gaming groups, developer communities, and any group that needs intelligent moderation and engagement. The bot adapts to your specific project context."
  },
  {
    question: "How do I set up TeliGent for my Telegram group?",
    answer: "Setup takes under 5 minutes: create a free account at teli.gent, enter your Telegram bot token (from BotFather), configure your bot's personality and knowledge base, then add it to your group as an admin. The bot starts protecting and engaging your community immediately."
  },
  {
    question: "Can I manage multiple Telegram groups with one account?",
    answer: "Yes, TeliGent supports multi-group management. You can deploy your bot across multiple Telegram groups and monitor all activity, scam reports, and conversations from a single dashboard."
  },
];

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-16 px-6 border-t">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="text-center space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Frequently Asked Questions</p>
          <h2 className="text-2xl font-bold tracking-tight">Everything You Need to Know</h2>
          <p className="text-muted-foreground">Common questions about our AI Telegram moderation bot.</p>
        </div>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border" data-testid={`faq-item-${i}`}>
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
                data-testid={`button-faq-toggle-${i}`}
              >
                <span className="font-medium text-sm pr-4">{item.question}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${openIndex === i ? 'rotate-180' : ''}`} />
              </button>
              {openIndex === i && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center bg-foreground">
              <Bot className="h-4 w-4 text-background" />
            </div>
            <span className="font-semibold text-lg tracking-tight">TeliGent</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-features">Features</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-faq">FAQ</a>
            <a href="#auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-sign-in">Sign In</a>
          </div>
        </div>
      </nav>

      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">AI-Powered Telegram Moderation Bot</p>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.1]" data-testid="text-hero-heading">
            Smart Agent
            <br />
            for Your Community
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            An AI community support agent that understands your project, speaks with your voice, and moderates your Telegram groups — with real-time scam detection, spam filtering, and intelligent member engagement around the clock.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button size="lg" asChild data-testid="button-get-started">
              <a href="#auth">Get Started Free</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">No credit card required. Bring your own Telegram bot token.</p>
        </div>
      </section>

      <MetricsSection />

      <section id="features" className="py-16 px-6 border-t">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Capabilities</p>
            <h2 className="text-2xl font-bold tracking-tight">AI-Powered Community Management</h2>
            <p className="text-muted-foreground">Automated Telegram moderation, intelligent member support, and real-time scam protection.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Brain className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Knowledge-Driven AI Responses</h3>
                <p className="text-sm text-muted-foreground">Your bot learns from your website, knowledge base, and project details. Every response is grounded in real context — like having a support agent who actually knows your product.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Customizable Bot Personality</h3>
                <p className="text-sm text-muted-foreground">Give your Telegram bot a name, tone, and character that matches your brand. It speaks with your voice — professional, casual, or anywhere in between.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Anti-Scam & Spam Filter</h3>
                <p className="text-sm text-muted-foreground">Automatically detects and removes scam messages, phishing attempts, DM solicitation, pump schemes, and token shills — keeping your Telegram group safe 24/7.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Zap className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">AI-Assisted Group Moderation</h3>
                <p className="text-sm text-muted-foreground">Members can flag suspicious messages with /report. Your bot evaluates reports with AI, takes action automatically, and learns new threat patterns as it goes.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Multi-Group Management</h3>
                <p className="text-sm text-muted-foreground">Deploy your bot across multiple Telegram groups. Monitor activity, track scam reports, and manage all your communities from a single dashboard.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Globe className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Auto-Learning Knowledge Base</h3>
                <p className="text-sm text-muted-foreground">Paste your website URL and your bot absorbs it. Add knowledge base entries for specific topics. It also learns from conversations — the more it knows, the better it supports your community.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 max-w-lg mx-auto">
            <Card className="border-foreground/20">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Master Agent API — Agent-to-Agent Services</h3>
                <p className="text-sm text-muted-foreground">TeliGent operates as an autonomous agent on Base. Other agents can query its threat intelligence and scam detection capabilities via API, with payments handled through Locus on Base (USDC).</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <FAQSection />

      <section id="auth" className="py-16 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Add an AI moderator to your Telegram group</h2>
            <p className="text-muted-foreground">Set up in under 5 minutes. Your bot handles the rest.</p>
          </div>
          <AuthForm />
        </div>
      </section>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>TeliGent</span>
            <div className="flex items-center gap-3">
              <a href="https://x.com/Teli_Gent_" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-x-twitter" aria-label="X (Twitter)">
                <SiX className="h-3.5 w-3.5" />
              </a>
              <a href="https://t.me/teli_gent" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-telegram" aria-label="Telegram">
                <SiTelegram className="h-3.5 w-3.5" />
              </a>
              <a href="https://dexscreener.com/base/0x0d65bab223f60d04fb509046096f14934f0bea2943514b32f131c96a781f380f" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors" data-testid="link-dexscreener" aria-label="DexScreener">
                <BarChart3 className="h-3.5 w-3.5" />
              </a>
            </div>
            <span>teli.gent</span>
          </div>
          <div className="flex items-center justify-center text-xs text-muted-foreground gap-1.5">
            <span>CA</span>
            <TokenAddress />
          </div>
        </div>
      </footer>
    </div>
  );
}
