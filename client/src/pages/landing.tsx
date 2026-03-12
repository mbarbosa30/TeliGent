import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, Shield, Brain, Zap, Users, Globe, Loader2, MessageCircle, ShieldCheck, Radio, Sparkles } from "lucide-react";
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
            <a href="#auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-sign-in">Sign In</a>
          </div>
        </div>
      </nav>

      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Intelligent Community Agents</p>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.1]" data-testid="text-hero-heading">
            Smart Agent
            <br />
            for Your Community
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            An AI agent that understands your project, speaks with your voice, and engages your community — with built-in scam and spam prevention that works around the clock.
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
            <h2 className="text-2xl font-bold tracking-tight">An Agent That Gets It</h2>
            <p className="text-muted-foreground">Understands your project. Engages your community. Stops the bad actors.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Brain className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Contextual Understanding</h3>
                <p className="text-sm text-muted-foreground">Learns from your website, knowledge base, and project details. Every response is grounded in what your community actually needs to know.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Configurable Personality</h3>
                <p className="text-sm text-muted-foreground">Give your agent a name, tone, and character that fits your brand. It speaks with your voice — professional, casual, or anywhere in between.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Scam & Spam Prevention</h3>
                <p className="text-sm text-muted-foreground">Detects and removes scam messages, phishing, DM solicitation, and pump schemes automatically — keeping your community safe around the clock.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Zap className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Community Moderation</h3>
                <p className="text-sm text-muted-foreground">Members can flag suspicious messages with /report. Your agent evaluates them with AI and takes action — learning new threats as it goes.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Multi-Group Dashboard</h3>
                <p className="text-sm text-muted-foreground">Deploy your agent across multiple Telegram groups. Monitor activity, track reports, and manage everything from a single dashboard.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center border bg-muted">
                  <Globe className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">Learns From Your Content</h3>
                <p className="text-sm text-muted-foreground">Paste your website URL and your agent absorbs it. Add knowledge base entries for specific topics. The more it knows, the better it serves.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section id="auth" className="py-16 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Give your community a smart agent</h2>
            <p className="text-muted-foreground">Set up in under 5 minutes. Your agent handles the rest.</p>
          </div>
          <AuthForm />
        </div>
      </section>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>TeliGent</span>
          <span>teli.gent</span>
        </div>
      </footer>
    </div>
  );
}
