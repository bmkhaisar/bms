import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ShieldAlert,
  Building2,
  Users,
  KeyRound,
  Loader2,
  LogOut,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Plus,
  ExternalLink,
  CheckCircle2,
  Layers,
  LayoutDashboard,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  checkPlatformAdminServerFn,
  checkPlatformAdminSetupStatusFn,
  getPlatformServerStatusFn,
  listCompaniesPlatformAdminFn,
  listPlatformUsersFn,
  bootstrapPlatformAdminClaimFn,
} from "@/functions/platformAdminFns";
import { CompaniesView } from "@/modules/platform-admin/components/CompaniesView";
import { UsersView } from "@/modules/platform-admin/components/UsersView";
import { CompanyAccessView } from "@/modules/platform-admin/components/CompanyAccessView";
import type { PlatformCompanySummary } from "@/server/platform-admin/companyService";
import type { PlatformUserSummary } from "@/server/platform-admin/userService";

export const Route = createFileRoute("/system-admin")({
  head: () => ({ meta: [{ title: "Platform Console — BMS NEXT" }] }),
  component: SystemAdminPage,
});

export function SystemAdminPage() {
  const { user, isPlatformAdmin, signOutAndSwitchAccount, authInitializing, claimsLoading } = useAuth();
  const { companies: userTenantCompanies, switchCompany } = useActiveCompany();
  const nav = useNavigate();

  const [activeTab, setActiveTab] = useState("overview");
  const [idToken, setIdToken] = useState<string>("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  // Platform server diagnostic status
  const [serverStatus, setServerStatus] = useState<{
    firebaseAdminConfigured: boolean;
    firebaseAdminReady: boolean;
    status: string;
    statusMessage: string;
    missingVariables: string[];
    r2Configured: boolean;
  } | null>(null);

  // Authoritative Platform Admin data for KPIs
  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [platformUsers, setPlatformUsers] = useState<PlatformUserSummary[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Load platform overview metrics if authorized and server ready
  const loadPlatformData = useCallback(async (token: string) => {
    if (!token) return;
    setLoadingData(true);
    try {
      const [compRes, userRes] = await Promise.all([
        listCompaniesPlatformAdminFn({ data: { idToken: token } }).catch(() => ({ success: false, companies: [] })),
        listPlatformUsersFn({ data: { idToken: token } }).catch(() => ({ success: false, users: [] })),
      ]);

      if (compRes.success && compRes.companies) {
        setCompanies(compRes.companies);
      }
      if (userRes.success && userRes.users) {
        setPlatformUsers(userRes.users);
      }
    } catch {
      // Graceful fallback
    } finally {
      setLoadingData(false);
    }
  }, []);

  // 1. Authoritative Guard & Status Verification
  const verifyAuthAndStatus = useCallback(
    async (forceRefresh = false) => {
      if (!user) {
        nav({ to: "/login", replace: true });
        return;
      }

      try {
        const token = await user.getIdToken(forceRefresh);
        setIdToken(token);

        // Fetch safe platform server status
        const status = await getPlatformServerStatusFn();
        setServerStatus(status);

        // Check if token has platformAdmin custom claim
        const idTokenResult = await user.getIdTokenResult(forceRefresh);
        const hasClaim = Boolean(idTokenResult.claims.platformAdmin);

        if (hasClaim || isPlatformAdmin) {
          setIsAuthorized(true);
          setIsSetupMode(false);
          setCheckingAuth(false);
          if (status.firebaseAdminReady) {
            loadPlatformData(token);
          }
          return;
        }

        // Check server-side authorization
        const authRes = await checkPlatformAdminServerFn({ data: { idToken: token } });
        if (authRes.success) {
          setIsAuthorized(true);
          setIsSetupMode(false);
          if (status.firebaseAdminReady) {
            loadPlatformData(token);
          }
        } else {
          // Check if user is the configured Platform Admin pending bootstrap
          const setupCheck = await checkPlatformAdminSetupStatusFn({ data: { idToken: token } });
          if (setupCheck.setupRequired) {
            setIsAuthorized(true);
            setIsSetupMode(true);
          } else {
            setIsAuthorized(false);
            setIsSetupMode(false);
            setAccessDeniedMessage(authRes.error || "You do not have Platform Administrator authorization.");
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Verification error";
        setIsAuthorized(false);
        setAccessDeniedMessage(msg);
      } finally {
        setCheckingAuth(false);
      }
    },
    [user, isPlatformAdmin, nav, loadPlatformData]
  );

  useEffect(() => {
    if (authInitializing || claimsLoading) return;
    verifyAuthAndStatus(false);
  }, [authInitializing, claimsLoading, verifyAuthAndStatus]);

  // Manual Refresh Status Handler
  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      await verifyAuthAndStatus(true);
      toast.success("Server and authentication status refreshed.");
    } catch {
      toast.error("Failed to refresh status.");
    } finally {
      setRefreshing(false);
    }
  };

  // Bootstrap Admin Claim from UI (trusted server RPC)
  const handleBootstrapClaim = async () => {
    if (!user) return;
    setBootstrapping(true);
    try {
      const token = await user.getIdToken(true);
      const res = await bootstrapPlatformAdminClaimFn({ data: { idToken: token } });
      if (res.success) {
        toast.success("Platform Administrator custom claim successfully activated!");
        // Force token refresh to incorporate custom claims immediately
        await user.getIdToken(true);
        await user.getIdTokenResult(true);
        await verifyAuthAndStatus(true);
      } else {
        toast.error(res.error || "Failed to bootstrap claim. Check server configuration.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bootstrap failed";
      toast.error(msg);
    } finally {
      setBootstrapping(false);
    }
  };

  // Handler to open authorized company workspace
  const handleOpenWorkspace = (companyId: string) => {
    switchCompany(companyId);
    nav({ to: "/" });
  };

  if (authInitializing || claimsLoading || checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-xs font-medium text-muted-foreground">Verifying Platform Administrator privilege...</p>
        </div>
      </div>
    );
  }

  // Access Denied Screen (Strict Authorization Safeguard)
  if (!user || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <Card className="w-full max-w-md shadow-md border-border/60">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {accessDeniedMessage || "You do not have Platform Administrator authorization to access this console."}
              </p>
            </div>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => nav({ to: "/" })} className="w-full sm:w-auto text-xs">
                Go to Workspace
              </Button>
              <Button variant="ghost" size="sm" onClick={() => signOutAndSwitchAccount()} className="w-full sm:w-auto text-xs">
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authoritative KPI Computations
  const isServerReady = Boolean(serverStatus?.firebaseAdminReady);
  const totalCompaniesDisplay = isServerReady ? String(companies.length) : "Unavailable";
  const activeCompaniesCount = companies.filter((c) => c.active).length;
  const activeCompaniesDisplay = isServerReady ? String(activeCompaniesCount) : "Unavailable";
  const platformUsersDisplay = isServerReady ? String(platformUsers.length) : "Unavailable";

  // Compute active memberships across all companies
  const totalMemberships = companies.reduce((acc, c) => acc + (c.activeUsersCount || 0), 0);
  const activeMembershipsDisplay = isServerReady ? String(totalMemberships) : "Unavailable";

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 flex flex-col">
      {/* Top Platform Console Bar */}
      <header className="bg-card/90 backdrop-blur border-b border-border/60 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              BMS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground text-sm sm:text-base">System Administration</span>
                {/* PRD Section 13: Distinguish Setup Mode vs Verified Platform Admin */}
                {!isSetupMode && isPlatformAdmin ? (
                  <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200/60 text-[10px] gap-1 px-2 py-0.5 font-medium">
                    <ShieldCheck className="h-3 w-3 text-emerald-600" />
                    Platform Admin
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 text-[10px] gap-1 px-2 py-0.5 font-medium">
                    <KeyRound className="h-3 w-3 text-amber-600" />
                    Platform Setup
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground font-mono hidden sm:block">
                Authoritative Console • Decoupled Tenant Architecture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Refresh Server Status Button (PRD Section 12) */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshStatus}
              disabled={refreshing}
              className="text-xs gap-1.5 h-8 text-muted-foreground hover:text-foreground"
              title="Refresh server status and custom claims"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            {/* Explicit Company Workspace Entry for Platform Admin */}
            {userTenantCompanies.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenWorkspace(userTenantCompanies[0].id)}
                className="text-xs gap-1.5 h-8 border-primary/30 text-primary hover:bg-primary/10"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open Company Workspace</span>
                <span className="sm:hidden">Workspace</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOutAndSwitchAccount()}
              className="text-xs text-muted-foreground hover:text-foreground h-8 gap-1"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* PRD Section 17: Diagnostic Server Configuration Banner (Disappears when firebaseAdminReady === true) */}
      {serverStatus && !serverStatus.firebaseAdminReady && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>{serverStatus.statusMessage}</span>
            </div>
            <div className="flex items-center gap-2">
              {serverStatus.missingVariables && serverStatus.missingVariables.length > 0 && (
                <span className="text-[10px] font-mono text-amber-700/80 dark:text-amber-400 hidden lg:inline">
                  Missing: {serverStatus.missingVariables.join(", ")}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="h-7 text-xs gap-1 border-amber-300/80 text-amber-900 dark:text-amber-200 bg-amber-50/50 hover:bg-amber-100 dark:bg-amber-950/40"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Admin Console Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-3">
            <TabsList className="bg-card/80 border border-border/60 p-1 shadow-xs self-start">
              <TabsTrigger value="overview" className="gap-2 text-xs">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="companies" className="gap-2 text-xs">
                <Building2 className="h-3.5 w-3.5" />
                Organizations
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-2 text-xs">
                <Users className="h-3.5 w-3.5" />
                Platform Users
              </TabsTrigger>
              <TabsTrigger value="access" className="gap-2 text-xs">
                <KeyRound className="h-3.5 w-3.5" />
                Access Control
              </TabsTrigger>
            </TabsList>

            <div className="text-xs text-muted-foreground">
              Signed in as <span className="font-mono text-foreground font-medium">{user.email}</span>
            </div>
          </div>

          {/* TAB 1: OVERVIEW */}
          <TabsContent value="overview" className="space-y-6 focus-visible:outline-none">
            {/* PRD Section 13: Dedicated Platform Setup Card when in Setup Mode */}
            {isSetupMode && (
              <Card className="rounded-2xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 shadow-xs">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-amber-600" />
                    <CardTitle className="text-base font-semibold text-foreground">
                      Platform Administrator Setup Mode
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground">
                    You are recognized as the initial platform identity (<span className="font-mono">{user.email}</span>).
                    To unlock full administrative capabilities, the <code className="font-mono text-primary font-semibold">platformAdmin</code> custom claim must be assigned by the server.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {serverStatus?.firebaseAdminReady ? (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-background/80 border border-border/60">
                      <div className="text-xs">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Server Ready:</span> Firebase Admin SDK is configured. You can now bootstrap your claim.
                      </div>
                      <Button
                        size="sm"
                        onClick={handleBootstrapClaim}
                        disabled={bootstrapping}
                        className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {bootstrapping ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        <span>Activate Platform Admin Claim</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-800 dark:text-amber-300 p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/40 border border-amber-200/50">
                      <strong>Activation pending credentials:</strong> Add <code className="font-mono">FIREBASE_ADMIN_CLIENT_EMAIL</code> and <code className="font-mono">FIREBASE_ADMIN_PRIVATE_KEY</code> to <code className="font-mono">.env</code> on the server, restart the process, and click <strong>Refresh</strong> above.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Welcome to BMS NEXT</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Multi-tenant cloud platform management console. Manage companies, provision users, and assign access.
              </p>
            </div>

            {/* KPI Cards Grid (PRD Section 4: Exact or Unavailable) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Total Companies</CardTitle>
                  <Building2 className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-foreground">{totalCompaniesDisplay}</div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isServerReady ? "Registered corporate tenants" : "Server config required"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Active Companies</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-foreground">{activeCompaniesDisplay}</div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isServerReady ? "Operational workspaces" : "Server config required"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Platform Users</CardTitle>
                  <Users className="h-4 w-4 text-sky-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-foreground">{platformUsersDisplay}</div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isServerReady ? "Provisioned accounts" : "Server config required"}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">Active Memberships</CardTitle>
                  <Layers className="h-4 w-4 text-indigo-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-foreground">{activeMembershipsDisplay}</div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {isServerReady ? "User-company assignments" : "Server config required"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-foreground">Quick Management Actions</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Common platform administration tasks.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2.5">
                <Button
                  size="sm"
                  onClick={() => setActiveTab("companies")}
                  className="gap-2 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Company</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab("users")}
                  className="gap-2 text-xs"
                >
                  <Users className="h-3.5 w-3.5" />
                  <span>Create User</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab("access")}
                  className="gap-2 text-xs"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Grant Access</span>
                </Button>
              </CardContent>
            </Card>

            {/* Authorized Workspaces */}
            {userTenantCompanies.length > 0 && (
              <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-foreground">Your Assigned Workspaces</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    You have active tenant memberships in the following organizations. Click to launch operational dashboard.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {userTenantCompanies.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-background/50 hover:bg-accent/40 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-foreground">{c.name}</div>
                          <div className="text-[11px] text-muted-foreground capitalize">Role: {c.role}</div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleOpenWorkspace(c.id)}
                        className="text-xs gap-1.5 h-7"
                      >
                        <span>Open Workspace</span>
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* First Use Experience / Empty States */}
            {isServerReady && companies.length === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-6 text-center">
                  <Building2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold text-foreground">No companies yet</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                    Create your first company when you're ready. Tenant structures will be provisioned automatically.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveTab("companies")}
                    className="mt-4 text-xs gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create Company</span>
                  </Button>
                </Card>

                <Card className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-6 text-center">
                  <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold text-foreground">No additional users yet</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                    Create users now and assign them to a company later. Users exist independently of organizations.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveTab("users")}
                    className="mt-4 text-xs gap-1.5"
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>Create User</span>
                  </Button>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: ORGANIZATIONS */}
          <TabsContent value="companies" className="focus-visible:outline-none">
            <CompaniesView idToken={idToken} onCompanyCreated={() => verifyAuthAndStatus(true)} />
          </TabsContent>

          {/* TAB 3: USERS */}
          <TabsContent value="users" className="focus-visible:outline-none">
            <UsersView idToken={idToken} onUserCreated={() => verifyAuthAndStatus(true)} />
          </TabsContent>

          {/* TAB 4: ACCESS MANAGEMENT */}
          <TabsContent value="access" className="focus-visible:outline-none">
            <CompanyAccessView idToken={idToken} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
