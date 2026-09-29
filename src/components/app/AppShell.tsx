import { ReactNode, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BusinessScopeBar } from "./BusinessScopeBar";
import { InstallPwaBanner } from "./InstallPwaBanner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { AlertCircle } from "lucide-react";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const { isDemoExpired } = useActiveCompany();
  const { isPlatformAdmin } = useAuth();

  useEffect(() => setMounted(true), []);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <Topbar title={title} />
        <BusinessScopeBar />
        {isDemoExpired && !isPlatformAdmin && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Demo access has expired. Contact your administrator.</span>
          </div>
        )}
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          {mounted ? (
            <>
              <InstallPwaBanner />
              {children}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
