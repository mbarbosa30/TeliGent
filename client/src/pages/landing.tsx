import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bot, Shield, Brain, Zap, Users, Globe, Loader2 } from "lucide-react";
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
      const body = await err?.response?.json?.().catch(() => null);
      setError(body?.message || err?.message || "Something went wrong");
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
                <button type="button" onClick={() => { setMode("register"); setError(""); }} className="text-primary underline underline-offset-2 font-medium" data-testid="button-switch-register">
                  Sign Up
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-primary underline underline-offset-2 font-medium" data-testid="button-switch-login">
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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">ContextBot</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline" data-testid="link-features">Features</a>
            <a href="#auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-sign-in">Sign In</a>
          </div>
        </div>
      </nav>

      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight font-serif" data-testid="text-hero-heading">
            AI-Powered Telegram Bot
            <br />
            <span className="text-primary">for Your Community</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Give your Telegram group an intelligent assistant that answers questions from your knowledge base, detects scams automatically, and moderates content — all configured from a simple dashboard.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button size="lg" asChild data-testid="button-get-started">
              <a href="#auth">Get Started Free</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">No credit card required. Bring your own Telegram bot token.</p>
        </div>
      </section>

      <section id="features" className="py-16 px-6 bg-muted/30">
        <div className="max-w-5xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold font-serif">Everything You Need</h2>
            <p className="text-muted-foreground">Configure your bot in minutes, not hours</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Brain className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">AI-Powered Responses</h3>
                <p className="text-sm text-muted-foreground">Feeds your project context, website content, and knowledge base into every response. Your bot actually knows what it's talking about.</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">Scam Detection</h3>
                <p className="text-sm text-muted-foreground">Automatically detects and removes scam messages, DM solicitation, pump schemes, and spam — before they can harm your community.</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">Smart Moderation</h3>
                <p className="text-sm text-muted-foreground">Users can report messages with /report and the bot evaluates them with AI. Configurable response modes and cooldowns keep things balanced.</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">Multi-Group Support</h3>
                <p className="text-sm text-muted-foreground">Add your bot to multiple Telegram groups. Track activity, reports, and member counts across all of them from one dashboard.</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="pt-6 space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">Website Import</h3>
                <p className="text-sm text-muted-foreground">Paste your website URL and the bot automatically scrapes and learns from your content. Add knowledge base entries for specific topics.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section id="auth" className="py-16 px-6">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold font-serif">Ready to protect your community?</h2>
            <p className="text-muted-foreground">Set up your bot in under 5 minutes. Create an account, paste your Telegram bot token, and configure your knowledge base.</p>
          </div>
          <AuthForm />
        </div>
      </section>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>ContextBot</span>
          <span>Powered by AI</span>
        </div>
      </footer>
    </div>
  );
}
