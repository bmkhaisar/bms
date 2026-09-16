import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Download, Upload, Trash2, ShieldAlert, FileJson } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { clearAllDeviceData, estimateLocalCacheStats } from "@/modules/sync/dexieCache";
import { outboxManager } from "@/modules/sync/outboxManager";
import type { NetworkStatus } from "@/modules/sync/types";
import { Wifi, RefreshCw, Database, HardDrive } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/backup")({
  head: () => ({ meta: [{ title: "Backup & Sync — BMS NEXT" }] }),
  component: BackupPage,
});

const EXPORT_TABLES = [
  "customers",
  "suppliers",
  "categories",
  "products",
  "quotations",
  "invoices",
  "receipts",
  "purchases",
] as const;

function BackupPage() {
  const { activeCompany, activeFinancialYear, isOwner } = useActiveCompany();
  const { user } = useAuth();
  const [clearDeviceOpen, setClearDeviceOpen] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("online");
  const [pendingCount, setPendingCount] = useState(0);
  const [cacheStats, setCacheStats] = useState<{
    recordCount: number;
    outboxPendingCount: number;
    estimatedSizeBytes: number;
  } | null>(null);

  useEffect(() => {
    estimateLocalCacheStats().then(setCacheStats);
    const unsub = outboxManager.subscribeStatus((status, count) => {
      setNetworkStatus(status);
      setPendingCount(count);
    });
    return () => unsub();
  }, [activeCompany?.id]);

  async function handleExport() {
    if (!activeCompany) {
      toast.error("No active company selected for export");
      return;
    }

    const data: Record<string, unknown[]> = {};
    for (const t of EXPORT_TABLES) {
      data[t] = await (
        db() as unknown as Record<string, { toArray: () => Promise<unknown[]> }>
      )[t].toArray();
    }

    const exportPayload = {
      schemaVersion: "3.0",
      companyId: activeCompany.id,
      companyName: activeCompany.name,
      financialYearId: activeFinancialYear?.id || null,
      financialYearName: activeFinancialYear?.name || null,
      exportedAt: new Date().toISOString(),
      exportedByUid: user?.uid || null,
      data,
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const sanitizedName = activeCompany.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    a.href = url;
    a.download = `${sanitizedName}-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success("Company data exported successfully");
  }

  return (
    <AppShell title="Backup & Sync">
      <PageHeader
        title="Backup & Sync Architecture"
        description="Authoritative cloud sync state, high-speed local indexing, and tenant backups."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* 1. Cloud Sync Status (PRD #85) */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Wifi className="h-4 w-4 text-emerald-500" /> Cloud Synchronization
            </CardTitle>
            <CardDescription className="text-xs">
              Firebase Realtime Database (Tenant Scoped)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Status:</span>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {networkStatus === "online" ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Online & Active
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
                    Syncing Outbox ({pendingCount})
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Pending Cloud Writes:</span>
              <span className="font-mono font-semibold text-foreground">{pendingCount}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Source of Truth:</span>
              <span className="font-medium text-foreground">Cloud RTDB</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground pt-1">
              Changes on device A immediately push to cloud RTDB and replicate to all 10 employees concurrently.
            </p>
          </CardContent>
        </Card>

        {/* 2. Local Dexie Cache (PRD #4, #5, #85) */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Database className="h-4 w-4 text-primary" /> Local Indexed Cache
            </CardTitle>
            <CardDescription className="text-xs">
              Dexie IndexedDB mirror (bms_cache_v1 v3)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Cached Records:</span>
              <span className="font-mono font-semibold text-foreground">
                {cacheStats?.recordCount ?? "Loading…"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Estimated Cache Size:</span>
              <span className="font-mono font-semibold text-foreground">
                {cacheStats ? `${(cacheStats.estimatedSizeBytes / 1024).toFixed(1)} KB` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2.5">
              <span>Compound Indexes:</span>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Active (v3)</span>
            </div>
            <Button
              variant="outline"
              className="gap-2 w-full text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-800"
              onClick={() => setClearDeviceOpen(true)}
            >
              <Trash2 className="h-4 w-4" /> Clear Local Cache
            </Button>
          </CardContent>
        </Card>

        {/* 3. Export Card */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Download className="h-4 w-4 text-primary" /> Export Company Data
            </CardTitle>
            <CardDescription className="text-xs">
              Complete tenant-scoped backup
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Exports all customer master data, products, quotations, invoices, and purchase records
              for <strong className="text-foreground">{activeCompany?.name || "current company"}</strong>.
            </p>
            <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-[11px] space-y-1">
              <div>Company: <span className="font-mono text-foreground">{activeCompany?.name || "—"}</span></div>
              <div>Format: <span className="font-mono text-foreground">BMS NEXT v3.0 JSON</span></div>
            </div>
            <Button className="gap-2 w-full" onClick={handleExport} disabled={!activeCompany}>
              <Download className="h-4 w-4" /> Export Company JSON
            </Button>
          </CardContent>
        </Card>

        {/* Security / Invariant Notice */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <ShieldAlert className="h-4 w-4 text-primary" /> Accounting Protection
            </CardTitle>
            <CardDescription className="text-xs">
              Strict financial ledger integrity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
            <p>
              In accordance with double-entry accounting invariants, financial vouchers and journal
              entries cannot be arbitrarily overwritten via raw file imports.
            </p>
            <p>
              To migrate transactions or opening balances, utilize the official Chart of Accounts opening
              vouchers or contact support.
            </p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={clearDeviceOpen}
        onOpenChange={setClearDeviceOpen}
        title="Clear local data from this device?"
        description="This will purge offline IndexedDB records from this browser. Your cloud data in Firebase RTDB is unaffected and will re-sync upon sign-in."
        confirmText="Clear Device Data"
        onConfirm={async () => {
          await clearAllDeviceData();
          toast.success("Local offline data cleared from this device.");
          setClearDeviceOpen(false);
        }}
      />
    </AppShell>
  );
}
