import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { Button } from "@/components/ui/button";
import { BmsBrandMark } from "@/components/brand/BmsBrandMark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, LogOut, Loader2, RefreshCw, Radio } from "lucide-react";
import { checkPlatformAdminSetupStatusFn } from "@/functions/platformAdminFns";
import { startupState } from "@/modules/app/startupState";
import { ref, onValue, off, get } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { toast } from "sonner";

export const Route = createFileRoute("/no-company-access")({
  head: () => ({ meta: [{ title: "No Company Access — BMS NEXT" }] }),
  component: NoCompanyAccessPage,
});

function NoCompanyAccessPage() {
  const { user, isPlatformAdmin, signOutAndSwitchAccount, initializing, authInitializing, claimsLoading, resolutionState } = useAuth();
  const { companies, loading: companiesLoading, refreshCompanyData, resolvedUserId } = useActiveCompany();
  const nav = useNavigate();
  const [checkingPrivileges, setCheckingPrivileges] = useState(true);
  const [manualChecking, setManualChecking] = useState(false);

  // 1. Immediate redirect if companies are already resolved
  useEffect(() => {
    if (!companiesLoading && companies.length > 0) {
      nav({ to: "/", replace: true });
    }
  }, [companiesLoading, companies.length, nav]);

  // 2. Active verification: check freshly minted claims & setup status
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

    return () => {
      active = false;
    };
  }, [user, isPlatformAdmin, authInitializing, claimsLoading, resolutionState, nav]);

  // 3. Realtime listener on userCompanies & direct membership fallback for instant activation
  useEffect(() => {
    if (!user || !firebaseDb) return;

    const userCompaniesRef = ref(firebaseDb, `userCompanies/${user.uid}`);
    const onUserCompaniesUpdate = async (snapshot: any) => {
      const val = snapshot.val();
      if (val && Object.keys(val).length > 0) {
        await refreshCompanyData();
        toast.success("Company access detected! Entering workspace…");
        nav({ to: "/", replace: true });
        return;
      }

      // Check direct membership fallback in KH Portable Cabins
      try {
        const memSnap = await get(ref(firebaseDb!, `memberships/comp_1789194549079_1wz2v/${user.uid}`));
        if (memSnap.exists()) {
          await refreshCompanyData();
          nav({ to: "/", replace: true });
        }
      } catch {}
    };

    onValue(userCompaniesRef, onUserCompaniesUpdate);

    // Initial check right away
    get(userCompaniesRef).then(async (snap) => {
      if (snap.exists() && Object.keys(snap.val() || {}).length > 0) {
        await refreshCompanyData();
        nav({ to: "/", replace: true });
      }
    }).catch(() => {});

    return () => {
      off(userCompaniesRef, "value", onUserCompaniesUpdate);
    };
  }, [user, nav, refreshCompanyData]);

  // Signal startup completion once checks settle
  useEffect(() => {
    if (!initializing && resolutionState === "ready" && !checkingPrivileges) {
      startupState.markBackendReady();
    }
  }, [initializing, resolutionState, checkingPrivileges]);

  // Manual verify access handler
  const handleVerifyAccess = useCallback(async () => {
    if (!user || !firebaseDb) return;
    setManualChecking(true);
    try {
      await refreshCompanyData();
      const snap = await get(ref(firebaseDb, `userCompanies/${user.uid}`));
      const val = snap.val();
      if (val && Object.keys(val).length > 0) {
        toast.success("Company access verified! Loading your workspace…");
        nav({ to: "/", replace: true });
        return;
      }

      // Check direct membership in primary company
      const memSnap = await get(ref(firebaseDb, `memberships/comp_1789194549079_1wz2v/${user.uid}`));
      if (memSnap.exists()) {
        toast.success("Company ownership verified! Entering workspace…");
        await refreshCompanyData();
        nav({ to: "/", replace: true });
        return;
      }

      toast.info("No active company assignment found yet. If access was just granted, please wait a few seconds and try again.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to verify access. Please check your network connection.");
    } finally {
      setManualChecking(false);
    }
  }, [user, nav, refreshCompanyData]);

  if (initializing || resolutionState !== "ready" || checkingPrivileges) {
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
            <BmsBrandMark size="sm" />
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

        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft text-center overflow-hidden">
          <div className="bg-primary/5 border-b border-border/60 py-2 px-3 flex items-center justify-center gap-2 text-[11px] font-medium text-primary">
            <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-500" />
            <span>Real-time access monitor active</span>
          </div>

          <CardHeader className="pb-3 pt-5">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
              No Company Access
            </CardTitle>
            <CardDescription className="text-xs max-w-sm mx-auto leading-relaxed text-muted-foreground">
              Your account (<span className="font-mono text-foreground">{user?.email}</span>) is awaiting company activation or assignment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              When an administrator or owner assigns you to a company, your workspace will activate in real time automatically without needing to log out.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleVerifyAccess}
                disabled={manualChecking}
                className="w-full sm:w-auto gap-2 text-xs"
              >
                {manualChecking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>Check Access Now</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => signOutAndSwitchAccount()}
                className="w-full sm:w-auto gap-2 text-xs"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Switch Account</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
