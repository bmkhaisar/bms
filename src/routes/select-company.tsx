import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, ArrowRight, Loader2, LogOut } from "lucide-react";
import { startupState } from "@/modules/app/startupState";

export const Route = createFileRoute("/select-company")({
  head: () => ({ meta: [{ title: "Select Company — BMS NEXT" }] }),
  component: SelectCompanyPage,
});

function SelectCompanyPage() {
  const { user, isPlatformAdmin, signOutAndSwitchAccount, authInitializing, claimsLoading } = useAuth();
  const { companies, switchCompany, loading: companiesLoading } = useActiveCompany();
  const nav = useNavigate();

  useEffect(() => {
    if (!authInitializing && !claimsLoading && !companiesLoading) {
      startupState.markBackendReady();
    }
  }, [authInitializing, claimsLoading, companiesLoading]);

  useEffect(() => {
    if (authInitializing || claimsLoading) return;

    if (!user) {
      nav({ to: "/login", replace: true });
      return;
    }

    // Platform admin defaults to /system-admin
    if (isPlatformAdmin) {
      nav({ to: "/system-admin", replace: true });
      return;
    }

    if (!companiesLoading) {
      if (companies.length === 0) {
        nav({ to: "/no-company-access", replace: true });
      } else if (companies.length === 1) {
        switchCompany(companies[0].id);
        nav({ to: "/" });
      }
    }
  }, [user, isPlatformAdmin, authInitializing, claimsLoading, companiesLoading, companies, switchCompany, nav]);

  const handleSelect = (companyId: string) => {
    switchCompany(companyId);
    nav({ to: "/" });
  };

  if (authInitializing || claimsLoading || companiesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs font-medium text-muted-foreground">Loading business workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-soft">
              BMS
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-foreground">BMS NEXT</h1>
              <p className="text-xs text-muted-foreground">
                Logged in as <span className="font-mono text-foreground">{user?.email}</span>
              </p>
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

        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">
              Select Business Workspace
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Choose the company organization you want to manage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y divide-border/60 rounded-xl border border-border/70 overflow-hidden bg-secondary/20">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  className="flex w-full items-center justify-between p-4 text-left transition hover:bg-accent/40 focus:outline-none focus:bg-accent/40"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-foreground">{c.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">Role: {c.role}</div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>

            <div className="pt-2 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOutAndSwitchAccount()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Sign in with a different account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
