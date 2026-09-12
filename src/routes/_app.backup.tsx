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
import { clearAllDeviceData } from "@/modules/sync/dexieCache";

export const Route = createFileRoute("/_app/backup")({
  head: () => ({ meta: [{ title: "Company Export & Local Data — BMS NEXT" }] }),
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

export function BackupPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { activeCompany, activeFinancialYear, isOwner } = useActiveCompany();
  const { user, clearDeviceData } = useAuth();
  const [resetOpen, setResetOpen] = useState(false);
  const [clearDeviceOpen, setClearDeviceOpen] = useState(false);

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
      schemaVersion: "2.0",
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
    <AppShell title="Export & Data Management">
      <PageHeader
        title="Company Data & Local Storage"
        description="Tenant-scoped JSON exports and offline cache management."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Export Card */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Download className="h-4 w-4 text-primary" /> Cloud-Aware Export
            </CardTitle>
            <CardDescription className="text-xs">
              Tenant-scoped snapshot with schema version 2.0
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Exports all customer master data, products, quotations, invoices, and purchase records
              for <strong className="text-foreground">{activeCompany?.name || "current company"}</strong>.
            </p>
            <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-[11px] space-y-1">
              <div>Company: <span className="font-mono text-foreground">{activeCompany?.name || "—"}</span></div>
              <div>FY: <span className="font-mono text-foreground">{activeFinancialYear?.name || "Active"}</span></div>
              <div>Format: <span className="font-mono text-foreground">BMS NEXT v2.0 JSON</span></div>
            </div>
            <Button className="gap-2 w-full" onClick={handleExport} disabled={!activeCompany}>
              <Download className="h-4 w-4" /> Download Company JSON
            </Button>
          </CardContent>
        </Card>

        {/* Clear Local Cache */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Trash2 className="h-4 w-4 text-amber-600" /> Offline Cache
            </CardTitle>
            <CardDescription className="text-xs">
              Manage IndexedDB storage on this device
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Removes locally cached data (<code className="text-[11px] font-mono">bms_cache_v1</code>) from
              this browser. Cloud records in Firebase remain safe and will re-sync upon your next sign-in.
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-[11px] text-amber-800 dark:text-amber-300">
              Useful when using a shared workstation or if local storage displays out-of-sync state.
            </div>
            <Button
              variant="outline"
              className="gap-2 w-full text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-800"
              onClick={() => setClearDeviceOpen(true)}
            >
              Clear Local Data From This Device
            </Button>
          </CardContent>
        </Card>

        {/* Security / Invariant Notice */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
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
