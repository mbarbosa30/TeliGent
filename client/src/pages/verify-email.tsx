import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { queryClient } from "@/lib/queryClient";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<"pending" | "ok" | "error" | "missing">("pending");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setStatus("missing");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "include",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setErrorMessage(body.message || "We could not verify this email link.");
          return;
        }
        setStatus("ok");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } catch (err: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err?.message || "We could not verify this email link.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <Link href="/" className="text-sm font-mono uppercase tracking-widest" data-testid="link-home">TeliGent</Link>
        <ThemeToggle />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm" data-testid={`card-verify-${status}`}>
          {status === "pending" && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <CardTitle className="text-xl">Verifying your email...</CardTitle>
                </div>
                <CardDescription>This will take a moment.</CardDescription>
              </CardHeader>
            </>
          )}
          {status === "ok" && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  <CardTitle className="text-xl">Email verified</CardTitle>
                </div>
                <CardDescription>Thanks. You can now upgrade your plan, take payments, and register on-chain identities.</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/" data-testid="link-go-app">
                  <Button className="w-full">Continue</Button>
                </Link>
              </CardContent>
            </>
          )}
          {(status === "error" || status === "missing") && (
            <>
              <CardHeader className="space-y-1 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  <CardTitle className="text-xl">Could not verify</CardTitle>
                </div>
                <CardDescription>
                  {status === "missing"
                    ? "This page is missing its verification token. Use the link from your email."
                    : errorMessage || "This link has expired or is invalid."}
                  {" "}You can request a new verification email from your Account page after signing in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/" data-testid="link-go-signin">
                  <Button variant="outline" className="w-full">Go to sign in</Button>
                </Link>
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
