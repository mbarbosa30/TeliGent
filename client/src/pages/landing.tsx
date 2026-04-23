import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, Shield, Brain, Zap, Users, Loader2, MessageCircle, ShieldCheck, Radio, Sparkles, BarChart3, Copy, Check, ChevronDown, Cpu, Trophy, Code2, LineChart, ArrowRight } from "lucide-react";
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
            ? "Welcome back. Enter your credentials to continue."
            : "Get started with TeliGent in seconds."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-xs">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-xs">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                  data-testid="input-last-name"
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs">Email</Label>
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
            <Label htmlFor="password" className="text-xs">Password</Label>
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

function Eyebrow({ number, label }: { number: string; label: string }) {
  return (
    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
      <span className="text-foreground">{number}</span>
      <span className="mx-2 text-muted-foreground/50">/</span>
      <span>{label}</span>
    </p>
  );
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
    { label: "Scams Blocked", value: stats.scamsCaught },
    { label: "AI Conversations", value: stats.conversationsHandled },
    { label: "Groups Protected", value: stats.groupsProtected },
    { label: "Active Bots", value: stats.botsActive },
  ].filter(m => m.value > 0);

  const cols = metrics.length === 4 ? 'md:grid-cols-4' : metrics.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';

  return (
    <section className="py-20 px-6 border-t">
      <div className="max-w-6xl mx-auto">
        <div className={`grid grid-cols-2 ${cols} md:divide-x divide-border`}>
          {metrics.map((m) => (
            <div
              key={m.label}
              className="px-2 md:px-8 py-4 space-y-2 text-left"
              data-testid={`stat-${m.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <p className="text-5xl sm:text-6xl font-bold font-mono tracking-tight leading-none">
                <AnimatedCounter value={m.value} />
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{m.label}</p>
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
    answer: "An AI-powered Telegram bot that moderates your community, blocks scams in real time, and answers members in your brand's voice."
  },
  {
    question: "How does the scam detection work?",
    answer: "Deterministic pattern matching for phishing, DM solicitation, pump schemes, and impersonation, plus AI fallback that catches context-aware and homoglyph evasion."
  },
  {
    question: "How much does TeliGent cost?",
    answer: "Free tier covers 1 bot. Pro is $19/mo, Business is $79/mo. Pay by card via Stripe or in USDC or $TELI on Base. Paying in $TELI gives you 25% off and extra perks."
  },
  {
    question: "How do I set up TeliGent for my Telegram group?",
    answer: "Create a free account, drop in your Telegram bot token from BotFather, then add the bot to your group as admin. Under 5 minutes."
  },
  {
    question: "How do token rewards for top contributors work?",
    answer: "Score members on real signals and pay out any ERC-20 on Base or Celo each period. You set the token, amounts, and caps. The bot wallet sends the transfer, TeliGent never custodies funds."
  },
  {
    question: "Can other AI agents call TeliGent's threat intelligence?",
    answer: "Yes. The agent-to-agent API is discoverable on OpenServ, has an ERC-8004 identity, and accepts USDC on Base via Locus. Self Protocol verified callers get discounts."
  },
];

const PRICING_PLANS = [
  {
    name: "Free",
    monthly: 0,
    annual: 0,
    teliMonthly: 0,
    description: "Try TeliGent on your community.",
    features: ["1 bot", "50 KB entries", "200 AI calls / day", "2 groups per bot", "Rewards loop", "Scam detection"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Pro",
    monthly: 19,
    annual: 190,
    teliMonthly: 14,
    description: "For active communities and crypto teams.",
    features: ["3 bots", "250 KB entries", "1,500 AI calls / day", "10 groups per bot", "Embed widget", "Bankr crypto data", "Master Agent API", "ERC-8004 registry"],
    cta: "Go Pro",
    highlight: true,
  },
  {
    name: "Business",
    monthly: 79,
    annual: 790,
    teliMonthly: 59,
    description: "For studios running many communities.",
    features: ["10 bots", "1,000 KB entries", "8,000 AI calls / day", "50 groups per bot", "Everything in Pro", "Priority limits"],
    cta: "Go Business",
    highlight: false,
  },
];

const FEATURES = [
  { icon: Brain, title: "Grounded AI Responses", body: "Answers from your website, knowledge base, and chat memory. Gets smarter the longer it runs." },
  { icon: Sparkles, title: "Customizable Bot Personality", body: "Pick a name, tone, and character. Your bot speaks with your brand's voice." },
  { icon: Shield, title: "Anti-Scam & Spam Filter", body: "Catches phishing, DM solicitation, pump schemes, and token shills automatically." },
  { icon: Zap, title: "AI-Assisted Group Moderation", body: "Members flag with /report. Your bot reviews, acts, and learns new patterns over time." },
  { icon: Users, title: "Multi-Group Management", body: "Run one bot across many Telegram groups from a single dashboard." },
  { icon: Trophy, title: "Passive CEO Rewards Loop", body: "Score top contributors and pay out any ERC-20 on Base or Celo each period. Built-in referrals." },
  { icon: LineChart, title: "Crypto Intelligence (Bankr)", body: "Optional /price command and live market data injected into AI answers for token communities." },
  { icon: Code2, title: "Embeddable Web Chat Widget", body: "One script tag drops the same on-brand AI agent on your website." },
  { icon: Cpu, title: "Master Agent API & On-Chain Identity", body: "Bots get an ERC-8004 identity on Celo. Platform takes USDC on Base via Locus." },
];

function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-6 border-t">
      <div className="max-w-6xl mx-auto space-y-14">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
          <div className="md:col-span-8 space-y-3">
            <Eyebrow number="01" label="Capabilities" />
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">AI-Powered Community Management</h2>
          </div>
          <p className="md:col-span-4 text-sm text-muted-foreground">Automated Telegram moderation, intelligent member support, and real-time scam protection.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 border-t border-b">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const isLastRow = i >= FEATURES.length - (FEATURES.length % 2 === 0 ? 2 : 1);
            const isRightCol = i % 2 === 1;
            return (
              <div
                key={f.title}
                className={[
                  "py-8 px-2 md:px-8 flex gap-5 items-start",
                  !isLastRow ? "border-b" : "",
                  isRightCol ? "md:border-l" : "",
                ].join(" ")}
                data-testid={`feature-${f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-foreground">
                  <Icon className="h-5 w-5 text-background" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-base leading-tight">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  return (
    <section id="pricing" className="py-24 px-6 border-t">
      <div className="max-w-6xl mx-auto space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
          <div className="md:col-span-8 space-y-3">
            <Eyebrow number="02" label="Pricing" />
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Simple plans, two ways to pay</h2>
          </div>
          <p className="md:col-span-4 text-sm text-muted-foreground">Card or crypto. Pay in $TELI for 25% off.</p>
        </div>

        <div className="flex items-center justify-center">
          <div className="inline-flex border" role="tablist">
            <button
              type="button"
              onClick={() => setPeriod("monthly")}
              className={`px-5 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors ${period === "monthly" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-pricing-monthly"
            >Monthly</button>
            <button
              type="button"
              onClick={() => setPeriod("annual")}
              className={`px-5 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors border-l ${period === "annual" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-pricing-annual"
            >Annual · 2 months free</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 border-t border-b">
          {PRICING_PLANS.map((p, idx) => {
            const usd = period === "annual" ? p.annual : p.monthly;
            const teliUsd = period === "annual" ? Math.round(p.teliMonthly * 10) : p.teliMonthly;
            const inverted = p.highlight;
            const colBorder = idx > 0 ? "md:border-l" : "";
            return (
              <div
                key={p.name}
                className={[
                  "p-8 flex flex-col gap-6",
                  colBorder,
                  inverted ? "bg-foreground text-background" : "",
                  !inverted ? "hover:bg-muted/30 transition-colors" : "",
                ].join(" ")}
                data-testid={`card-pricing-${p.name.toLowerCase()}`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold tracking-tight">{p.name}</h3>
                    {p.highlight && (
                      <span className="text-[10px] font-mono uppercase tracking-widest border border-background/40 px-2 py-0.5">Popular</span>
                    )}
                  </div>
                  <p className={`text-xs ${inverted ? "text-background/60" : "text-muted-foreground"}`}>{p.description}</p>
                </div>
                <div className="space-y-1">
                  <div className="font-mono text-5xl font-bold tracking-tight leading-none">
                    ${usd}
                    <span className={`text-base font-normal ml-1 ${inverted ? "text-background/60" : "text-muted-foreground"}`}>/{period === "annual" ? "yr" : "mo"}</span>
                  </div>
                  {p.monthly > 0 && (
                    <p className={`text-xs ${inverted ? "text-background/60" : "text-muted-foreground"}`}>or ${teliUsd} in $TELI · 25% off</p>
                  )}
                </div>
                <ul className="space-y-2 text-sm flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className={`h-3.5 w-3.5 mt-1 shrink-0 ${inverted ? "text-background" : "text-foreground"}`} />
                      <span className={inverted ? "text-background/90" : ""}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className={`w-full ${inverted ? "bg-background text-foreground hover:bg-background/90" : ""}`}
                  variant={inverted ? "default" : "outline"}
                  data-testid={`button-pricing-${p.name.toLowerCase()}`}
                >
                  <a href="#auth" className="inline-flex items-center justify-center gap-2">
                    {p.cta}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center border-t border-b py-10">
          <div className="md:col-span-4">
            <p className="font-mono font-bold text-5xl sm:text-6xl tracking-tight leading-none">$TELI</p>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mt-2">Native token · Base</p>
          </div>
          <div className="md:col-span-8 space-y-4">
            <p className="text-sm text-foreground leading-relaxed">Pay in $TELI on Base for more.</p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 mt-1 shrink-0" /><span>25% discount</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 mt-1 shrink-0" /><span>+20% rewards multiplier</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 mt-1 shrink-0" /><span>2x agent API rate</span></li>
              <li className="flex items-start gap-2"><Check className="h-3.5 w-3.5 mt-1 shrink-0" /><span>TELI badge</span></li>
            </ul>
          </div>
        </div>

        <div className="overflow-x-auto" data-testid="table-pricing-comparison">
          <table className="w-full text-sm border-t-2 border-b-2 border-foreground">
            <thead>
              <tr className="border-b">
                <th className="text-left px-4 py-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Feature</th>
                <th className="text-center px-4 py-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Free</th>
                <th className="text-center px-4 py-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Pro</th>
                <th className="text-center px-4 py-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Business</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr:last-child]:border-b-0">
              <tr><td className="px-4 py-3">Bots</td><td className="text-center px-4 py-3 font-mono">1</td><td className="text-center px-4 py-3 font-mono">3</td><td className="text-center px-4 py-3 font-mono">10</td></tr>
              <tr><td className="px-4 py-3">Knowledge base entries / bot</td><td className="text-center px-4 py-3 font-mono">50</td><td className="text-center px-4 py-3 font-mono">250</td><td className="text-center px-4 py-3 font-mono">1,000</td></tr>
              <tr><td className="px-4 py-3">AI calls / bot / day</td><td className="text-center px-4 py-3 font-mono">200</td><td className="text-center px-4 py-3 font-mono">1,500</td><td className="text-center px-4 py-3 font-mono">8,000</td></tr>
              <tr><td className="px-4 py-3">Telegram groups / bot</td><td className="text-center px-4 py-3 font-mono">2</td><td className="text-center px-4 py-3 font-mono">10</td><td className="text-center px-4 py-3 font-mono">50</td></tr>
              <tr><td className="px-4 py-3">Embeddable chat widget</td><td className="text-center px-4 py-3 text-muted-foreground">No</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">Bankr crypto intelligence</td><td className="text-center px-4 py-3 text-muted-foreground">No</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">Agent-to-agent API</td><td className="text-center px-4 py-3 text-muted-foreground">No</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">ERC-8004 on-chain identity</td><td className="text-center px-4 py-3 text-muted-foreground">No</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">AI feedback digest</td><td className="text-center px-4 py-3 text-muted-foreground">No</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">Rewards + leaderboards</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
              <tr><td className="px-4 py-3">$TELI perks (25% off, +20% rewards, 2x agent rate)</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td><td className="text-center px-4 py-3">Yes</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 px-6 border-t">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
          <div className="md:col-span-8 space-y-3">
            <Eyebrow number="03" label="Frequently Asked Questions" />
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Everything You Need to Know</h2>
          </div>
          <p className="md:col-span-4 text-sm text-muted-foreground">Common questions about our AI Telegram moderation bot.</p>
        </div>
        <div className="border-t border-b">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className={i < FAQ_ITEMS.length - 1 ? "border-b" : ""} data-testid={`faq-item-${i}`}>
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between py-5 px-2 text-left hover:bg-muted/40 transition-colors"
                data-testid={`button-faq-toggle-${i}`}
              >
                <span className="font-medium text-base pr-4">{item.question}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${openIndex === i ? 'rotate-180' : ''}`} />
              </button>
              {openIndex === i && (
                <div className="px-2 pb-5 -mt-1">
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{item.answer}</p>
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
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center bg-foreground">
              <Bot className="h-4 w-4 text-background" />
            </div>
            <span className="font-semibold text-lg tracking-tight">TeliGent</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-features">Features</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-pricing">Pricing</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-faq">FAQ</a>
            <a
              href="#auth"
              className="text-xs font-mono uppercase tracking-widest bg-foreground text-background px-4 py-2 hover:bg-foreground/90 transition-colors"
              data-testid="link-sign-in"
            >Sign In</a>
          </div>
        </div>
      </nav>

      <section className="py-24 sm:py-32 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7 space-y-7">
            <Eyebrow number="00" label="AI-Powered Telegram Moderation Bot" />
            <h1
              className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.95]"
              data-testid="text-hero-heading"
            >
              Smart Agent
              <br />
              for Your
              <br />
              Community.
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
              The AI that moderates your Telegram group and answers members in your voice. 24/7.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button size="lg" asChild data-testid="button-get-started">
                <a href="#pricing" className="inline-flex items-center gap-2">
                  See Pricing
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-create-account">
                <a href="#auth">Create Account</a>
              </Button>
            </div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground pt-1">
              From $19/mo · 25% off in $TELI
            </p>
          </div>

          <div className="md:col-span-5">
            <div className="border bg-card">
              <div className="aspect-square bg-foreground flex items-center justify-center relative">
                <Bot className="h-24 w-24 text-background" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 bg-background animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-background/80">Live</span>
                </div>
                <div className="absolute bottom-3 right-3 text-[10px] font-mono uppercase tracking-widest text-background/60">v2 · Base</div>
              </div>
              <div className="divide-y">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Status</span>
                  <span className="text-xs font-mono">Operational</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Engine</span>
                  <span className="text-xs font-mono">GPT-5.2 · GPT-5-mini</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Chains</span>
                  <span className="text-xs font-mono">Base · Celo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <MetricsSection />

      <FeaturesSection />

      <PricingSection />

      <FAQSection />

      <section id="auth" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-10 items-start">
          <div className="md:col-span-6 space-y-6">
            <Eyebrow number="04" label="Start" />
            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Add an AI moderator to your Telegram group</h2>
            <ul className="border-t border-b divide-y">
              <li className="flex items-center gap-3 py-3">
                <span className="font-mono text-xs text-muted-foreground w-6">01</span>
                <span className="text-sm">Create your free account</span>
              </li>
              <li className="flex items-center gap-3 py-3">
                <span className="font-mono text-xs text-muted-foreground w-6">02</span>
                <span className="text-sm">Drop in your Telegram bot token</span>
              </li>
              <li className="flex items-center gap-3 py-3">
                <span className="font-mono text-xs text-muted-foreground w-6">03</span>
                <span className="text-sm">Add the bot to your group as admin</span>
              </li>
            </ul>
          </div>
          <div className="md:col-span-6">
            <AuthForm />
          </div>
        </div>
      </section>

      <footer className="border-t py-10 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center bg-foreground">
              <Bot className="h-3 w-3 text-background" />
            </div>
            <span className="text-sm font-semibold tracking-tight">TeliGent</span>
            <span className="text-xs text-muted-foreground ml-2">teli.gent</span>
          </div>
          <div className="flex items-center justify-center text-xs text-muted-foreground gap-1.5">
            <span className="font-mono uppercase tracking-widest">CA</span>
            <TokenAddress />
          </div>
          <div className="flex items-center md:justify-end gap-4">
            <a href="https://x.com/Teli_Gent_" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-x-twitter" aria-label="X (Twitter)">
              <SiX className="h-4 w-4" />
            </a>
            <a href="https://t.me/teli_gent" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-telegram" aria-label="Telegram">
              <SiTelegram className="h-4 w-4" />
            </a>
            <a href="https://dexscreener.com/base/0x0d65bab223f60d04fb509046096f14934f0bea2943514b32f131c96a781f380f" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-dexscreener" aria-label="DexScreener">
              <BarChart3 className="h-4 w-4" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
