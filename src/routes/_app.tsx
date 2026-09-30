import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { startCompanyRealtimeSync } from "@/modules/sync/companyRealtimeSync";
import { AppShell } from "@/components/app/AppShell";
import { DashboardSkeleton } from "@/components/app/Skeletons";
import { startupState } from "@/modules/app/startupState";

const PUBLIC_ROUTES = new Set([
  "/",
  "/about",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
  "/login",
]);

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
  const { activeCompany, loading: companyLoading, companies, activeFinancialYear, activeBranchId, branches, isOwner } = useActiveCompany();

  const authorizedBranchIds = useMemo(() => (branches || []).map((b) => b.id), [branches]);
  const branchIdsKey = useMemo(() => authorizedBranchIds.slice().sort().join(","), [authorizedBranchIds]);

  // Central multi-device realtime company synchronization (PRD §§ 49, 56-59, 77-78, Pre-Merge Blocker 4)
  useEffect(() => {
    if (!activeCompany?.id || !isAuthenticated) return;
    const stopSync = startCompanyRealtimeSync({
      companyId: activeCompany.id,
      uid: user?.uid,
      financialYearId: activeFinancialYear?.id,
      activeBranchId,
      authorizedBranchIds,
      isOwner,
    });
    return () => stopSync();
  }, [activeCompany?.id, isAuthenticated, user?.uid, activeFinancialYear?.id, activeBranchId, isOwner, branchIdsKey]);

  // Concurrently signal startup readiness as soon as auth & active company resolve
  useEffect(() => {
    if (!authInitializing && !claimsLoading) {
      if (!isAuthenticated || !user) {
        startupState.markBackendReady();
      } else if (isPlatformAdmin) {
        startupState.markBackendReady();
      } else if (!companyLoading && (activeCompany || companies.length === 0)) {
        startupState.markBackendReady();
      }
    }
  }, [authInitializing, claimsLoading, isAuthenticated, user, isPlatformAdmin, companyLoading, activeCompany, companies.length]);

  const loc = useLocation();
  const isPublicRoute = PUBLIC_ROUTES.has(loc.pathname);

  useEffect(() => {
    if (authInitializing || claimsLoading) return;

    // 1. Not authenticated -> redirect to /login only if not on a canonical public route
    if (!isAuthenticated || !user) {
      if (!isPublicRoute) {
        nav({ to: "/login", replace: true });
      }
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
    isPublicRoute,
  ]);

  // If credentials or company memberships are actively resolving
  if (authInitializing || claimsLoading) {
    if (isPublicRoute) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
        </div>
      );
    }
    return (
      <AppShell title="Dashboard">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80">
              <span className="inline-block h-2 w-2 rounded-full bg-primary/60 animate-pulse" />
              <span>Loading company workspace…</span>
            </div>
          </div>
          <DashboardSkeleton />
        </div>
      </AppShell>
    );
  }

  if (isAuthenticated && !isPlatformAdmin && (companyLoading || !activeCompany)) {
    return (
      <AppShell title="Dashboard">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80">
              <span className="inline-block h-2 w-2 rounded-full bg-primary/60 animate-pulse" />
              <span>Loading company workspace…</span>
            </div>
          </div>
          <DashboardSkeleton />
        </div>
      </AppShell>
    );
  }

  if (!isAuthenticated || !user) {
    if (isPublicRoute) {
      return <Outlet />;
    }
    return null;
  }
  if (!isPlatformAdmin && companies.length === 0) return null;
  if (isPlatformAdmin && (!activeCompany || !companies.some((c) => c.id === activeCompany.id))) {
    return null;
  }

  return <Outlet />;
}
