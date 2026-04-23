import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    setToken(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to reset password");
      setDone(true);
      setTimeout(() => setLocation("/"), 2500);
    } catch (err: any) {
      setError(err?.message || "Failed to reset password");
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
          {done ? (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  <CardTitle className="text-xl">Password updated</CardTitle>
                </div>
                <CardDescription>Your password has been reset and any other active sessions were signed out. Redirecting you to sign in...</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/" data-testid="link-go-signin">
                  <Button variant="outline" className="w-full">Go to sign in</Button>
                </Link>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-xl">Choose a new password</CardTitle>
                <CardDescription>Enter a new password for your TeliGent account.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password" className="text-xs">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      minLength={6}
                      required
                      data-testid="input-new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password" className="text-xs">Confirm new password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Repeat password"
                      minLength={6}
                      required
                      data-testid="input-confirm-password"
                    />
                  </div>
                  {error && <p className="text-sm text-red-500" data-testid="text-reset-error">{error}</p>}
                  <Button type="submit" className="w-full" disabled={pending || !token} data-testid="button-reset-submit">
                    {pending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Update password
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
