import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User, Lock, Save, Loader2, LogOut, MailWarning, MailCheck } from "lucide-react";

export default function AccountPage() {
  const { user, logout, isLoggingOut } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [email, setEmail] = useState(user?.email || "");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const profileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/user", { firstName, lastName, email });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/user"], data);
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to update profile";
      try {
        const parsed = JSON.parse(msg.substring(msg.indexOf(": ") + 2));
        toast({ title: "Error", description: parsed.message || msg, variant: "destructive" });
      } catch {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/auth/password", { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to update password";
      try {
        const parsed = JSON.parse(msg.substring(msg.indexOf(": ") + 2));
        toast({ title: "Error", description: parsed.message || msg, variant: "destructive" });
      } catch {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  const canUpdatePassword = currentPassword && newPassword && newPassword.length >= 6 && newPassword === confirmPassword;

  const resendVerificationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/resend-verification", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.alreadyVerified) {
        toast({ title: "Email already verified" });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else {
        toast({ title: "Verification email sent", description: "Check your inbox for a fresh verification link." });
      }
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to send verification email";
      try {
        const parsed = JSON.parse(msg.substring(msg.indexOf(": ") + 2));
        toast({ title: "Error", description: parsed.message || msg, variant: "destructive" });
      } catch {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your profile and security settings</p>
        </div>

        {user && !user.emailVerified ? (
          <Card className="border-yellow-500/40 bg-yellow-500/5" data-testid="card-email-unverified">
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-start gap-3">
                <MailWarning className="h-5 w-5 mt-0.5 text-yellow-600 dark:text-yellow-500 shrink-0" />
                <div className="space-y-2 flex-1 min-w-0">
                  <div>
                    <p className="text-sm font-medium">Your email is not verified yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Verify your email to unlock paid plans, on-chain bot registration, and password recovery.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resendVerificationMutation.mutate()}
                    disabled={resendVerificationMutation.isPending}
                    data-testid="button-resend-verification"
                  >
                    {resendVerificationMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <MailCheck className="h-3 w-3 mr-2" />}
                    Resend verification email
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Profile</CardTitle>
            </div>
            <CardDescription>Update your name and email address</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="acc-first-name">First Name</Label>
                <Input
                  id="acc-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  data-testid="input-account-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-last-name">Last Name</Label>
                <Input
                  id="acc-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-account-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-email">Email</Label>
              <Input
                id="acc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-account-email"
              />
            </div>
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={profileMutation.isPending}
              data-testid="button-save-profile"
            >
              {profileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save Profile
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Change Password</CardTitle>
            </div>
            <CardDescription>Update your password for account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-pw">Current Password</Label>
              <Input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New Password</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm New Password</Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <Button
              onClick={() => passwordMutation.mutate()}
              disabled={!canUpdatePassword || passwordMutation.isPending}
              data-testid="button-change-password"
            >
              {passwordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
              Change Password
            </Button>
          </CardContent>
        </Card>

        <Separator />

        <Button variant="outline" onClick={() => logout()} disabled={isLoggingOut} data-testid="button-logout">
          <LogOut className="h-4 w-4 mr-2" />
          {isLoggingOut ? "Signing out..." : "Sign Out"}
        </Button>
      </div>
    </ScrollArea>
  );
}
