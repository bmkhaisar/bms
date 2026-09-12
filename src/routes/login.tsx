import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import logo from "@/assets/bms-logo.png.asset.json";
import { BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";
import { checkPlatformAdminSetupStatusFn } from "@/functions/platformAdminFns";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign In — BMS NEXT" }] }),
  component: LoginPage,
});

export function LoginPage() {
  const nav = useNavigate();
  const { signIn, resetPassword, isAuthenticated, isPlatformAdmin, authInitializing, claimsLoading, user, setResolutionState } = useAuth();
  const { companies, loading: companiesLoading } = useActiveCompany();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [entering, setEntering] = useState(false);
  const [routingResolved, setRoutingResolved] = useState(false);
  const [resolvingDestination, setResolvingDestination] = useState(false);

  const resolveDestination = useCallback(async () => {
    if (!user || authInitializing || claimsLoading || routingResolved) return;

    setResolvingDestination(true);

    try {
      // 1. Force refresh ID token & claims result to guarantee freshest custom claims
      setResolutionState("refreshingToken");
      const freshToken = await user.getIdToken(true);
      setResolutionState("loadingClaims");
      const tokenResult = await user.getIdTokenResult(true);
      const isClaimAdmin = Boolean(tokenResult.claims.platformAdmin);

      // Safe dev logging for authoritative platform admin inspection
      if (user.uid === "BOkCLXp08tVmRHICTArgpReVh5Y2" || user.email === "maaz@admin.com") {
        console.info("[Login Destination] Platform Admin claim check:", {
          uid: user.uid,
          email: user.email,
          platformAdmin: isClaimAdmin,
          auth_time: tokenResult.claims.auth_time || tokenResult.authTime,
        });
      }

      // PRIORITY 1: Platform Admin (platformAdmin === true) -> /system-admin
      if (isClaimAdmin || isPlatformAdmin) {
        setRoutingResolved(true);
        setResolutionState("ready");
        nav({ to: "/system-admin", replace: true });
        return;
      }

      // PRIORITY 2: Check server-side Platform Admin setup eligibility
      setResolutionState("checkingPlatformAdminStatus");
      try {
        const setupCheck = await checkPlatformAdminSetupStatusFn({ data: { idToken: freshToken } });
        if (setupCheck.isPlatformAdmin || setupCheck.setupRequired) {
          setRoutingResolved(true);
          setResolutionState("ready");
          nav({ to: "/system-admin", replace: true });
          return;
        }
      } catch (e) {
        console.warn("Setup check error:", e);
      }

      // PRIORITY 3: Normal user -> wait for companies resolution
      setResolutionState("resolvingCompanies");
      if (companiesLoading) {
        // Still resolving companies, do NOT redirect to /no-company-access yet!
        return;
      }

      setRoutingResolved(true);
      setResolutionState("ready");

      // PRIORITY 4: Normal user + 0 companies -> /no-company-access
      if (companies.length === 0) {
        nav({ to: "/no-company-access", replace: true });
        return;
      }

      // PRIORITY 5: Normal user + 1 company -> /
      if (companies.length === 1) {
        nav({ to: "/", replace: true });
        return;
      }

      // PRIORITY 6: Normal user + >1 companies -> /select-company
      nav({ to: "/select-company", replace: true });
    } catch (err) {
      console.warn("Destination resolution error:", err);
    } finally {
      setResolvingDestination(false);
    }
  }, [user, isPlatformAdmin, authInitializing, claimsLoading, companiesLoading, companies, routingResolved, setResolutionState, nav]);

  useEffect(() => {
    if (!authInitializing && !claimsLoading && isAuthenticated && !routingResolved) {
      resolveDestination();
    }
  }, [authInitializing, claimsLoading, isAuthenticated, routingResolved, resolveDestination]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || entering || resetting) return;
    setLoading(true);

    const result = await signIn(email, password);
    setLoading(false);

    if (result.success) {
      setEntering(true);
      toast.success("Welcome back");
      // resolveDestination will automatically trigger via auth state effect
    } else {
      toast.error(result.error || "Failed to sign in. Please verify your credentials.");
    }
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      toast.error("Please enter your email address first.");
      return;
    }
    setResetting(true);
    const result = await resetPassword(email);
    setResetting(false);

    if (result.success) {
      toast.success("Password reset link sent to your email.");
    } else {
      toast.error(result.error || "Could not send password reset email.");
    }
  }

  if (authInitializing) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 via-sky-50/50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-medium">Verifying session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      {/* Decorative ambient lighting */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-900/20" />

      <div className="relative w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="relative">
            <img
              src={logo.url}
              alt="BMS NEXT logo"
              className="h-14 w-14 rounded-2xl object-contain shadow-md ring-1 ring-border/60 backdrop-blur"
            />
            <div className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5 shadow">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">BMS NEXT</h1>
          <p className="text-xs font-medium text-muted-foreground">
            Multi-Company Cloud ERP · {BRAND_TAGLINE}
          </p>
        </div>

        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur-md shadow-xl transition-all">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg font-semibold tracking-tight">Sign In</CardTitle>
            <CardDescription className="text-xs">
              Enter your corporate credentials to access your workspaces
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium">Corporate Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetting}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    {resetting ? "Sending..." : "Forgot password?"}
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <Button type="submit" className="w-full gap-2 font-medium" disabled={loading || entering}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    <span>Sign In</span>
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <a href="/about" className="transition-colors hover:text-foreground">About</a>
            <span className="text-muted-foreground/40">·</span>
            <a href="/contact" className="transition-colors hover:text-foreground">Support</a>
          </div>
          <p className="text-[11px] font-medium text-muted-foreground/80">
            Product by <span className="font-semibold text-foreground">{BRAND_ATTRIBUTION}</span>
          </p>
        </div>
      </div>

      {(entering || resolvingDestination || (isAuthenticated && !routingResolved)) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-md animate-fade-in">
          <img src={logo.url} alt="BMS logo" className="h-16 w-16 rounded-2xl object-contain animate-scale-in shadow-lg" />
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Resolving workspace access...</span>
          </div>
        </div>
      )}
    </div>
  );
}
