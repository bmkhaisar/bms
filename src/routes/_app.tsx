import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { startCompanyRealtimeSync } from "@/modules/sync/companyRealtimeSync";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppGuard,
});

function AppGuard() {
  const nav = useNavigate();
  const {
    user,
    authInitializing,
    claimsLoading,
    isAuthenticated,
    isPlatformAdmin,
  } = useAuth();
  const { activeCompany, loading: companyLoading, companies, activeFinancialYear } = useActiveCompany();

  // Central multi-device realtime company synchronization (PRD §§ 49, 56-59, 77-78)
  useEffect(() => {
    if (!activeCompany?.id || !isAuthenticated) return;
    const stopSync = startCompanyRealtimeSync({
      companyId: activeCompany.id,
      uid: user?.uid,
      financialYearId: activeFinancialYear?.id,
    });
    return () => stopSync();
  }, [activeCompany?.id, isAuthenticated, user?.uid, activeFinancialYear?.id]);

  useEffect(() => {
    if (authInitializing || claimsLoading) return;

    // 1. Not authenticated -> /login
    if (!isAuthenticated || !user) {
      nav({ to: "/login", replace: true });
      return;
    }

    // 2. Platform Admin handling
    if (isPlatformAdmin) {
      // If Platform Admin has explicitly selected an authorized company they belong to
      if (activeCompany && companies.some((c) => c.id === activeCompany.id)) {
        return; // Allow tenant workspace view without redirect loop
      }
      // Otherwise default Platform Admin landing is /system-admin
      nav({ to: "/system-admin", replace: true });
      return;
    }

    // 3. Normal user handling (wait until company memberships resolve)
    if (!companyLoading) {
      if (companies.length === 0) {
        nav({ to: "/no-company-access", replace: true });
        return;
      }

      if (companies.length > 1 && !activeCompany) {
        nav({ to: "/select-company", replace: true });
        return;
      }
    }
  }, [
    authInitializing,
    claimsLoading,
    companyLoading,
    user,
    isAuthenticated,
    isPlatformAdmin,
    companies,
    activeCompany,
    nav,
  ]);

  if (authInitializing || claimsLoading || (isAuthenticated && !isPlatformAdmin && companyLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs font-medium text-muted-foreground">
            {authInitializing
              ? "Verifying authentication..."
              : claimsLoading
              ? "Resolving identity credentials..."
              : "Loading company workspace..."}
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;
  if (!isPlatformAdmin && companies.length === 0) return null;
  if (isPlatformAdmin && (!activeCompany || !companies.some((c) => c.id === activeCompany.id))) {
    return null;
  }

  return <Outlet />;
}
