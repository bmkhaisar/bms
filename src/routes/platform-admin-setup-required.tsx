import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert, RefreshCw, LogOut, Terminal, Loader2, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { checkPlatformAdminSetupStatusFn } from "@/functions/platformAdminFns";

export const Route = createFileRoute("/platform-admin-setup-required")({
  head: () => ({ meta: [{ title: "Platform Admin Setup Required — BMS NEXT" }] }),
  component: PlatformAdminSetupRequiredPage,
});

export function PlatformAdminSetupRequiredPage() {
  const { user, isPlatformAdmin, refreshClaims, signOutAndSwitchAccount, initializing } = useAuth();
  const nav = useNavigate();
  const [checking, setChecking] = useState(false);
  const [serverStatusVerified, setServerStatusVerified] = useState<boolean | null>(null);

  const verifySetupEligibility = useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await checkPlatformAdminSetupStatusFn({ data: { idToken } });
      if (res.isPlatformAdmin) {
        nav({ to: "/system-admin", replace: true });
        return;
      }
      if (!res.setupRequired) {
        // Not a pending bootstrap candidate, send to workspace / no-company-access
        nav({ to: "/", replace: true });
        return;
      }
      setServerStatusVerified(true);
    } catch {
      setServerStatusVerified(false);
    }
  }, [user, nav]);

  useEffect(() => {
    if (initializing) return;

    if (!user) {
      nav({ to: "/login", replace: true });
      return;
    }

    if (isPlatformAdmin) {
      nav({ to: "/system-admin", replace: true });
      return;
    }

    verifySetupEligibility();
  }, [user, isPlatformAdmin, initializing, verifySetupEligibility, nav]);

  const handleRefresh = async () => {
    setChecking(true);
    try {
      const isClaimSet = await refreshClaims();
      if (isClaimSet) {
        toast.success("Platform Administrator claim detected! Opening console...");
        nav({ to: "/system-admin", replace: true });
      } else {
        toast.info("Claim not yet configured. Please run the bootstrap script on the server.");
      }
    } catch {
      toast.error("Failed to refresh token claims. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  if (initializing || serverStatusVerified === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs font-medium text-muted-foreground">Checking administrator status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-amber-50/20 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 sm:p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white font-bold text-sm shadow-sm">
              BMS
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-foreground">BMS NEXT</h1>
              <p className="text-xs text-muted-foreground">Platform Setup State</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOutAndSwitchAccount()}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </Button>
        </div>

        <Card className="rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-card/90 backdrop-blur shadow-md">
          <CardHeader className="text-center pb-3">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
              Platform Administrator Setup Required
            </CardTitle>
            <CardDescription className="text-xs max-w-md mx-auto leading-relaxed text-muted-foreground">
              Your administrator account (<span className="font-mono text-foreground">{user?.email}</span>) is authenticated, but the Platform Admin server claim has not been configured yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Terminal className="h-4 w-4 text-primary" />
                <span>Configuration Instructions</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Configure the Firebase Admin server credentials in your server environment and run the Platform Admin bootstrap command:
              </p>
              <div className="rounded-lg bg-slate-900 dark:bg-slate-950 p-2.5 font-mono text-[11px] text-emerald-400">
                npm run bootstrap:admin
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                Required server environment variables: <code className="font-mono text-foreground">FIREBASE_ADMIN_PROJECT_ID</code>, <code className="font-mono text-foreground">FIREBASE_ADMIN_CLIENT_EMAIL</code>, and <code className="font-mono text-foreground">FIREBASE_ADMIN_PRIVATE_KEY</code>.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
              <Button
                size="sm"
                onClick={() => nav({ to: "/system-admin" })}
                className="w-full sm:w-auto gap-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span>Open Platform Console</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={checking}
                className="w-full sm:w-auto gap-2 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
                <span>{checking ? "Checking Claims..." : "Refresh Setup Status"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOutAndSwitchAccount()}
                className="w-full sm:w-auto gap-2 text-xs"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign in with a different account</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
