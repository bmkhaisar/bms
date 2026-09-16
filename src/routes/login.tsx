import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, Lock, Eye, EyeOff, Sun, Moon } from "lucide-react";
import logo from "@/assets/bms-logo.png.asset.json";
import { BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";
import { checkPlatformAdminSetupStatusFn } from "@/functions/platformAdminFns";
import { startupState } from "@/modules/app/startupState";
import {
  checkLoginLockout,
  recordFailedLogin,
  resetLoginLockout,
  MAX_LOGIN_ATTEMPTS,
  type LockoutStatus,
} from "@/modules/auth/loginLockout";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign In — BMS NEXT" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { signIn, isAuthenticated, isPlatformAdmin, authInitializing, claimsLoading, user, setResolutionState } = useAuth();
  const { companies, loading: companiesLoading } = useActiveCompany();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entering, setEntering] = useState(false);
  const [routingResolved, setRoutingResolved] = useState(false);
  const [resolvingDestination, setResolvingDestination] = useState(false);
  const [lockoutStatus, setLockoutStatus] = useState<LockoutStatus>(() => checkLoginLockout());

  useEffect(() => {
    const t = localStorage.getItem("bms_theme") === "dark";
    setDark(t);
    document.documentElement.classList.toggle("dark", t);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("bms_theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  // Keep lockout status synchronized with current email
  useEffect(() => {
    setLockoutStatus(checkLoginLockout(email));
  }, [email]);

  // Live countdown tick every second when locked out
  useEffect(() => {
    if (!lockoutStatus.isLocked) return;

    const interval = setInterval(() => {
      const nextStatus = checkLoginLockout(email);
      setLockoutStatus(nextStatus);
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutStatus.isLocked, email]);

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
    if (loading || entering) return;

    // Strict security check: prevent login attempts if locked out
    const currentStatus = checkLoginLockout(email);
    if (currentStatus.isLocked) {
      setLockoutStatus(currentStatus);
      toast.error(
        `Sign In is locked due to ${MAX_LOGIN_ATTEMPTS} failed attempts. Try again in ${currentStatus.remainingTimeFormatted}.`
      );
      return;
    }

    setLoading(true);

    const result = await signIn(email, password);
    setLoading(false);

    if (result.success) {
      resetLoginLockout(email);
      setLockoutStatus(checkLoginLockout(email));
      setEntering(true);
      toast.success("Welcome back");
      // resolveDestination will automatically trigger via auth state effect
    } else {
      const updatedStatus = recordFailedLogin(email);
      setLockoutStatus(updatedStatus);

      if (updatedStatus.isLocked) {
        toast.error(
          `Security Alert: 5 incorrect password attempts. Sign In has been disabled for the next 5 hours.`
        );
      } else {
        toast.error(
          `${result.error || "Failed to sign in. Please verify your credentials."} (${updatedStatus.failedAttempts}/${MAX_LOGIN_ATTEMPTS} attempts — ${updatedStatus.attemptsRemaining} remaining before 5-hour lockout)`
        );
      }
    }
  }

  // Concurrently signal startup readiness when unauthenticated visitor reaches login screen
  useEffect(() => {
    if (!authInitializing && !claimsLoading && !isAuthenticated) {
      startupState.markBackendReady();
    }
  }, [authInitializing, claimsLoading, isAuthenticated]);

  if (authInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4" />
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(44,123,82,0.06),transparent_80%)] dark:bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(141,214,170,0.05),transparent_80%)] p-4 selection:bg-accent selection:text-accent-foreground">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative w-full max-w-[400px]">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="relative">
            <img
              src={logo.url}
              alt="BMS NEXT logo"
              className="h-14 w-14 rounded-2xl object-contain shadow-soft border border-border/80 bg-card p-1"
            />
            <div className="absolute -bottom-1 -right-1 rounded-full bg-card p-0.5 shadow-xs border border-border/80">
              <ShieldCheck className="h-3.5 w-3.5 text-mint" />
            </div>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">BMS NEXT</h1>
          <p className="text-xs font-medium text-muted-foreground">
            Multi-Company Cloud ERP · {BRAND_TAGLINE}
          </p>
        </div>

        {/* Soft Login Card (Photo 1 inspired) */}
        <Card className="rounded-3xl border border-border/80 bg-card shadow-raised transition-all">
          <CardHeader className="space-y-1 p-6 pb-2 sm:p-7 sm:pb-2">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">Sign In</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Enter your corporate credentials to access your workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-3 sm:p-7 sm:pt-3">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-foreground">Corporate Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 text-sm"
                  disabled={loading || entering}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-foreground">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 text-sm pr-10"
                    disabled={loading || entering}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {lockoutStatus.isLocked && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive backdrop-blur-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
                    <div className="space-y-1">
                      <p className="font-semibold text-destructive">
                        Sign In Disabled — Security Lockout
                      </p>
                      <p className="text-[11px] leading-relaxed text-destructive/90">
                        Wrong password was entered 5 times. To protect your account, sign in has been disabled for 5 hours.
                      </p>
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-destructive/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-destructive">
                        <Lock className="h-3.5 w-3.5" />
                        <span>Remaining: {lockoutStatus.remainingTimeFormatted}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-10 gap-2 font-semibold text-xs rounded-xl shadow-xs active:scale-[0.98]"
                disabled={loading || entering || lockoutStatus.isLocked}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : lockoutStatus.isLocked ? (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>Sign In Disabled ({lockoutStatus.remainingTimeFormatted})</span>
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

        {/* Supporting Footer Links */}
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
          <img src={logo.url} alt="BMS logo" className="h-16 w-16 rounded-2xl object-contain shadow-soft border border-border bg-card p-1" />
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-mint" />
            <span>Resolving workspace access...</span>
          </div>
        </div>
      )}
    </div>
  );
}
