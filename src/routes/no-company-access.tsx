import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, LogOut, Loader2, ShieldCheck } from "lucide-react";
import { checkPlatformAdminSetupStatusFn } from "@/functions/platformAdminFns";
import { startupState } from "@/modules/app/startupState";

export const Route = createFileRoute("/no-company-access")({
  head: () => ({ meta: [{ title: "No Company Access — BMS NEXT" }] }),
  component: NoCompanyAccessPage,
});

function NoCompanyAccessPage() {
  const { user, isPlatformAdmin, signOutAndSwitchAccount, initializing, authInitializing, claimsLoading, resolutionState } = useAuth();
  const { companies, loading: companiesLoading } = useActiveCompany();
  const nav = useNavigate();
  const [checkingPrivileges, setCheckingPrivileges] = useState(true);

  useEffect(() => {
    if (authInitializing || claimsLoading || resolutionState !== "ready") return;

    if (!user) {
      nav({ to: "/login", replace: true });
      return;
    }

    // Platform admin should always be on /system-admin
    if (isPlatformAdmin) {
      nav({ to: "/system-admin", replace: true });
      return;
    }

    let active = true;

    // Active verification: check freshly minted claims & setup status
    user.getIdToken(true).then(async (freshToken) => {
      if (!active) return;
      try {
        const tokenRes = await user.getIdTokenResult(true);
        if (tokenRes.claims.platformAdmin) {
          nav({ to: "/system-admin", replace: true });
          return;
        }

        const setupCheck = await checkPlatformAdminSetupStatusFn({ data: { idToken: freshToken } });
        if (setupCheck.isPlatformAdmin) {
          nav({ to: "/system-admin", replace: true });
          return;
        }
        if (setupCheck.setupRequired) {
          nav({ to: "/platform-admin-setup-required", replace: true });
          return;
        }

        if (active) setCheckingPrivileges(false);
      } catch {
        if (active) setCheckingPrivileges(false);
      }
    }).catch(() => {
      if (active) setCheckingPrivileges(false);
    });

    // If companies have loaded and user has company access, move to workspace
    if (!companiesLoading && companies.length > 0) {
      nav({ to: "/", replace: true });
    }

    return () => {
      active = false;
    };
  }, [user, isPlatformAdmin, authInitializing, claimsLoading, resolutionState, companiesLoading, companies.length, nav]);

  useEffect(() => {
    if (!initializing && resolutionState === "ready" && !companiesLoading && !checkingPrivileges) {
      startupState.markBackendReady();
    }
  }, [initializing, resolutionState, companiesLoading, checkingPrivileges]);

  if (initializing || resolutionState !== "ready" || companiesLoading || checkingPrivileges) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs font-medium text-muted-foreground">Checking company assignments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-soft">
              BMS
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-foreground">BMS NEXT</h1>
              <p className="text-xs text-muted-foreground">Workspace Access</p>
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

        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft text-center">
          <CardHeader className="pb-3">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
              No Company Access
            </CardTitle>
            <CardDescription className="text-xs max-w-sm mx-auto leading-relaxed text-muted-foreground">
              Your account (<span className="font-mono text-foreground">{user?.email}</span>) is not currently assigned to a company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Contact your administrator for access. Once company access is granted, your workspace will activate automatically upon your next sign-in.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
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
