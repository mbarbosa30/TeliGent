import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
      if (!res.ok && res.status !== 200) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Something went wrong");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <Link href="/" className="text-sm font-mono uppercase tracking-widest" data-testid="link-home">TeliGent</Link>
        <ThemeToggle />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          {submitted ? (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center gap-2">
                  <MailCheck className="h-5 w-5" />
                  <CardTitle className="text-xl">Check your inbox</CardTitle>
                </div>
                <CardDescription>
                  If an account exists for that email, we sent a link to reset your password. The link expires in 60 minutes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/" data-testid="link-back-to-signin">
                  <Button variant="outline" className="w-full">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to sign in
                  </Button>
                </Link>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl">Forgot password</CardTitle>
                <CardDescription>Enter your email and we will send you a link to set a new password.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                  {error && <p className="text-sm text-red-500" data-testid="text-forgot-error">{error}</p>}
                  <Button type="submit" className="w-full" disabled={pending} data-testid="button-forgot-submit">
                    {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Send reset link
                  </Button>
                  <Link href="/" data-testid="link-back-signin">
                    <Button type="button" variant="ghost" className="w-full">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to sign in
                    </Button>
                  </Link>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
