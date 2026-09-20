import { useState, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Calendar,
  ArrowRight,
  Printer,
  Download,
  Receipt,
  FileText,
  TrendingUp,
  CreditCard,
  Building2,
  Info,
  HelpCircle,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import {
  getComprehensiveFinancialReconciliation,
  type ComprehensiveReconciliation,
  normalizeVoucherDate,
} from "../services/reportEngine";
import type { Ledger, AccountGroup, Voucher } from "../types";
import { formatPaise } from "../constants";

interface CAReviewWorkspaceProps {
  ledgers: Ledger[];
  accountGroups: AccountGroup[];
  vouchers: Voucher[];
  invoices: any[];
  receipts: any[];
  purchases?: any[];
  products?: any[];
  parties?: any[];
  loading?: boolean;
}

export function CAReviewWorkspace({
  ledgers,
  accountGroups,
  vouchers,
  invoices = [],
  receipts = [],
  purchases = [],
  products = [],
  parties = [],
  loading = false,
}: CAReviewWorkspaceProps) {
  const navigate = useNavigate();

  // Period / Month Filters
  const [periodPreset, setPeriodPreset] = useState<"all" | "this_month" | "prev_month" | "specific_month" | "custom">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [specificMonth, setSpecificMonth] = useState<string>("2026-09");
  const [activeTab, setActiveTab] = useState<string>("summary");

  // Compute effective date range based on preset
  const dateRange = useMemo(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth();

    if (periodPreset === "this_month") {
      const start = `${curY}-${String(curM + 1).padStart(2, "0")}-01`;
      const lastD = new Date(curY, curM + 1, 0).getDate();
      const end = `${curY}-${String(curM + 1).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
      return { fromDate: start, toDate: end };
    }

    if (periodPreset === "prev_month") {
      const prevD = new Date(curY, curM, 0);
      const prevY = prevD.getFullYear();
      const prevM = prevD.getMonth();
      const start = `${prevY}-${String(prevM + 1).padStart(2, "0")}-01`;
      const lastD = prevD.getDate();
      const end = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
      return { fromDate: start, toDate: end };
    }

    if (periodPreset === "specific_month" && specificMonth) {
      const [y, m] = specificMonth.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastD = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
      return { fromDate: start, toDate: end };
    }

    if (periodPreset === "custom") {
      return { fromDate: fromDate || undefined, toDate: toDate || undefined };
    }

    // Default: all time
    return { fromDate: undefined, toDate: undefined };
  }, [periodPreset, fromDate, toDate, specificMonth]);

  // Pure authoritative calculation of comprehensive company reconciliations
  const recon: ComprehensiveReconciliation = useMemo(() => {
    return getComprehensiveFinancialReconciliation({
      ledgers,
      accountGroups,
      vouchers,
      invoices,
      receipts,
      purchases,
      products,
      parties,
      filter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
      },
    });
  }, [ledgers, accountGroups, vouchers, invoices, receipts, purchases, products, parties, dateRange]);

  const handleExportJson = () => {
    const data = {
      title: "CA Review & Financial Insights Report",
      exportedAt: new Date().toISOString(),
      period: recon.periodLabel,
      reconciliation: recon,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ca-review-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: "PASS" | "RECONCILED" | "ATTENTION" | "CRITICAL" | "COMPLETE" | "COSTING_INCOMPLETE") => {
    switch (status) {
      case "PASS":
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">PASS</Badge>;
      case "RECONCILED":
      case "COMPLETE":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px]">RECONCILED</Badge>;
      case "ATTENTION":
      case "COSTING_INCOMPLETE":
        return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px]">ATTENTION</Badge>;
      case "CRITICAL":
        return <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 text-[10px]">CRITICAL</Badge>;
      default:
        return null;
    }
  };

  if (loading) {
    return <CAReviewSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Top Filter and Actions Bar */}
      <Card className="p-4 card-soft flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-muted-foreground mr-1" />
            <span className="text-xs font-semibold text-muted-foreground">Period:</span>
            <div className="flex flex-wrap items-center gap-1 border rounded-md p-1 bg-muted/20">
              <Button
                variant={periodPreset === "all" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("all")}
              >
                All Time
              </Button>
              <Button
                variant={periodPreset === "this_month" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("this_month")}
              >
                This Month
              </Button>
              <Button
                variant={periodPreset === "prev_month" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("prev_month")}
              >
                Previous Month
              </Button>
              <Button
                variant={periodPreset === "specific_month" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("specific_month")}
              >
                Specific Month
              </Button>
              <Button
                variant={periodPreset === "custom" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("custom")}
              >
                Custom Range
              </Button>
            </div>
          </div>

          {periodPreset === "specific_month" && (
            <div className="flex items-center gap-2">
              <Label className="text-xs">Month:</Label>
              <Select value={specificMonth} onValueChange={setSpecificMonth}>
                <SelectTrigger className="h-8 text-xs w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2026-04">April 2026</SelectItem>
                  <SelectItem value="2026-05">May 2026</SelectItem>
                  <SelectItem value="2026-06">June 2026</SelectItem>
                  <SelectItem value="2026-07">July 2026</SelectItem>
                  <SelectItem value="2026-08">August 2026</SelectItem>
                  <SelectItem value="2026-09">September 2026</SelectItem>
                  <SelectItem value="2026-10">October 2026</SelectItem>
                  <SelectItem value="2026-11">November 2026</SelectItem>
                  <SelectItem value="2026-12">December 2026</SelectItem>
                  <SelectItem value="2027-01">January 2027</SelectItem>
                  <SelectItem value="2027-02">February 2027</SelectItem>
                  <SelectItem value="2027-03">March 2027</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {periodPreset === "custom" && (
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">From:</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 text-xs w-[130px]"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">To:</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 text-xs w-[130px]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleExportJson}>
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </Card>

      {/* Financial Health Panel (Section N) */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>Accounting Health & Reconciliation Matrix</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* 1. Day Book */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Day Book</span>
              {getStatusBadge(recon.dayBook.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{(recon.dayBook.totalDebitPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.dayBook.voucherCount} posted vouchers. Dr === Cr.
            </p>
          </Card>

          {/* 2. Trial Balance */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Trial Balance</span>
              {getStatusBadge(recon.trialBalance.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{(recon.trialBalance.totalDebitPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.trialBalance.isBalanced ? "Total Debit === Total Credit" : `Difference: ₹${(recon.trialBalance.differencePaise / 100).toFixed(2)}`}
            </p>
          </Card>

          {/* 3. Sales Reconciliation */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Sales Revenue</span>
              {getStatusBadge(recon.sales.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{recon.sales.netSalesRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.sales.isReconciled ? "Reconciled with Round-Off" : "Variance detected"}
            </p>
          </Card>

          {/* 4. GST Position */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">GST Output</span>
              {getStatusBadge(recon.gst.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{recon.gst.outputGstRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              CGST + SGST + IGST verified
            </p>
          </Card>

          {/* 5. Receivables */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Receivables (AR)</span>
              {getStatusBadge(recon.receivables.status)}
            </div>
            <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ₹{recon.receivables.totalOutstandingRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.receivables.openInvoicesCount} open invoice(s)
            </p>
          </Card>

          {/* 6. Customer Credits */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Customer Credits</span>
              {getStatusBadge(recon.customerCredits.status)}
            </div>
            <div className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400">
              ₹{recon.customerCredits.totalCustomerCreditRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.customerCredits.isReconciled ? "Overpayments verified" : "Check allocations"}
            </p>
          </Card>

          {/* 7. Payables */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Payables (AP)</span>
              {getStatusBadge(recon.payables.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{recon.payables.totalOutstandingRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.payables.openBillsCount} open bill(s)
            </p>
          </Card>

          {/* 8. Cash & Bank */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Cash in Hand</span>
              {getStatusBadge(recon.cashBank.status)}
            </div>
            <div className="text-sm font-bold font-mono">
              ₹{recon.cashBank.cashLedgerRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Receipts matched to ledger
            </p>
          </Card>

          {/* 9. Profit / COGS */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Gross Profit</span>
              {getStatusBadge(recon.profit.status)}
            </div>
            <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
              ₹{recon.profit.grossProfitRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {recon.profit.marginPercent.toFixed(1)}% gross margin
            </p>
          </Card>

          {/* 10. Audit Exceptions */}
          <Card className="p-3.5 card-soft space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Exceptions</span>
              <Badge variant={recon.exceptions.length === 0 ? "secondary" : "destructive"} className="text-[10px]">
                {recon.exceptions.length} ITEMS
              </Badge>
            </div>
            <div className="text-sm font-bold font-mono">
              {recon.exceptions.length === 0 ? "Zero Issues" : `${recon.exceptions.length} to Review`}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Audit & classification flags
            </p>
          </Card>
        </div>
      </div>

      {/* Period Comparison Insights (Section U) */}
      {recon.periodComparison && (
        <Card className="p-4 card-soft space-y-3 bg-muted/10 border">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>Current vs Previous Month Performance Snapshot</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">Comparative Metrics</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg border bg-background/50 space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">Monthly Billed Sales</div>
              <div className="text-base font-bold font-mono">
                ₹{recon.periodComparison.currentSales.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] flex items-center gap-1 text-muted-foreground">
                Prev: ₹{recon.periodComparison.previousSales.toFixed(2)}
                <span className={recon.periodComparison.salesChangePercent >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                  ({recon.periodComparison.salesChangePercent >= 0 ? "+" : ""}{recon.periodComparison.salesChangePercent.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-background/50 space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">Monthly Collections</div>
              <div className="text-base font-bold font-mono">
                ₹{recon.periodComparison.currentCollections.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] flex items-center gap-1 text-muted-foreground">
                Prev: ₹{recon.periodComparison.previousCollections.toFixed(2)}
                <span className={recon.periodComparison.collectionsChangePercent >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>
                  ({recon.periodComparison.collectionsChangePercent >= 0 ? "+" : ""}{recon.periodComparison.collectionsChangePercent.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-background/50 space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">Outstanding Receivables (AR)</div>
              <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                ₹{recon.periodComparison.outstandingReceivables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] text-muted-foreground">Active uncollected customer invoices</div>
            </div>

            <div className="p-3 rounded-lg border bg-background/50 space-y-1">
              <div className="text-[11px] text-muted-foreground font-medium">Customer Credit (Overpayment)</div>
              <div className="text-base font-bold font-mono text-blue-600 dark:text-blue-400">
                ₹{recon.periodComparison.customerCredit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] text-muted-foreground">Advance available for future invoices</div>
            </div>
          </div>
        </Card>
      )}

      {/* Deterministic CA Insights (Section O) */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          <span>Chartered Accountant Insights (Deterministic Engine)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {recon.insights.map((ins) => (
            <div
              key={ins.id}
              onClick={() => navigate({ to: ins.linkPath as any })}
              className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-all cursor-pointer flex items-start gap-2.5 group"
            >
              <div className="mt-0.5">
                {ins.severity === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <Info className="h-4 w-4 text-blue-600 shrink-0" />
                )}
              </div>
              <div className="flex-1 space-y-0.5">
                <div className="text-xs font-bold text-foreground group-hover:text-primary flex items-center justify-between">
                  <span>{ins.title}</span>
                  <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{ins.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CA Exception Panel (Section P & Q) */}
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span>CA Exception Panel</span>
          </div>
          <span className="text-xs text-muted-foreground">{recon.exceptions.length} active flag(s)</span>
        </div>

        {recon.exceptions.length === 0 ? (
          <div className="p-4 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Zero accounting exceptions detected.</span> All vouchers, ledgers, tax registers, customer overpayments, and inventory costs reconcile with double-entry precision.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {recon.exceptions.map((exc) => (
              <Card key={exc.id} className="p-3.5 border-amber-500/40 bg-amber-500/5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-foreground">
                    <Badge variant={exc.severity === "CRITICAL" ? "destructive" : "secondary"}>
                      {exc.severity}
                    </Badge>
                    <span>{exc.what}</span>
                  </div>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{exc.amount}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Why: </span>
                    {exc.why}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Related Records: </span>
                    {exc.relatedRecords}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Next Action: </span>
                    {exc.nextAction}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Month-End Review Checklist (Section R) */}
      <Card className="p-4 card-soft space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span>Month-End Review Checklist (Informational Verification)</span>
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">10 Standards</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {recon.monthEndChecklist.map((chk) => (
            <div key={chk.id} className="flex items-center justify-between p-2 rounded-md border bg-background text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <span>{chk.label}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{chk.detail}</div>
              </div>
              <div className="ml-3 shrink-0">
                {getStatusBadge(chk.status)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Section 6: Tabbed Drill-Down Reconciliations */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full flex-wrap justify-start gap-1 p-1 h-auto">
          <TabsTrigger value="summary">Sales & Round-Off</TabsTrigger>
          <TabsTrigger value="credits">Customer Credits ({recon.customerCredits.traces.length})</TabsTrigger>
          <TabsTrigger value="receivables">Receivables ({recon.receivables.openInvoicesCount})</TabsTrigger>
          <TabsTrigger value="gst">GST Position</TabsTrigger>
          <TabsTrigger value="cashbank">Cash & Bank</TabsTrigger>
          <TabsTrigger value="profit">Profit & COGS</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance Drill-Down</TabsTrigger>
        </TabsList>

        {/* Tab 1: Sales & Round-Off */}
        <TabsContent value="summary">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Sales & Revenue Ledger Bridge</h4>
                <p className="text-xs text-muted-foreground">Commercial invoice turnover reconciled with double-entry General Ledger.</p>
              </div>
              {getStatusBadge(recon.sales.status)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Net/Taxable Invoiced Sales</div>
                <div className="text-sm font-bold font-mono">₹{recon.sales.netSalesRupees.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">{recon.sales.invoiceCount} posted invoices</div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Invoice Round-Off Bridge</div>
                <div className="text-sm font-bold font-mono">₹{recon.sales.roundOffRupees.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">Commercial round-off delta</div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Sales Revenue Ledger Credit</div>
                <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  ₹{recon.sales.accountingRevenueRupees.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">GL Account: Sales Revenue</div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Gross Billed to Customers</div>
                <div className="text-sm font-bold font-mono">₹{recon.sales.grossBilledRupees.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">Taxable + GST + RoundOff</div>
              </div>
            </div>

            <div className="p-3 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-200 text-xs">
              <span className="font-bold">Accounting Verification: </span>
              {recon.sales.explanation}
            </div>
          </Card>
        </TabsContent>

        {/* Tab 2: Customer Credits */}
        <TabsContent value="credits">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Customer Credit & Overpayment Trace</h4>
                <p className="text-xs text-muted-foreground">Dual-source verification: Ledger credit balance vs bill-wise unapplied receipt allocations.</p>
              </div>
              <Badge variant="secondary">Total Credit: ₹{recon.customerCredits.totalCustomerCreditRupees.toFixed(2)}</Badge>
            </div>

            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Ledger Credit Balance</TableHead>
                  <TableHead className="text-right">Unapplied Allocation</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Source Receipts & Allocations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.customerCredits.traces.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                      No customer credits or overpayments exist in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  recon.customerCredits.traces.map((trace) => (
                    <TableRow key={trace.customerId} className="text-xs">
                      <TableCell className="font-semibold">{trace.customerName}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-blue-600">
                        ₹{trace.ledgerCreditRupees.toFixed(2)} Cr
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        ₹{trace.unappliedAllocationRupees.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ₹{trace.differenceRupees.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(trace.status)}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {trace.receipts.map((r) => (
                          <div key={r.receiptId} className="flex items-center gap-2">
                            <span className="font-semibold">{r.receiptNumber}</span>
                            <span>(Total: ₹{r.amountRupees.toFixed(2)}, Remaining: ₹{r.remainingCreditRupees.toFixed(2)})</span>
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 3: Receivables */}
        <TabsContent value="receivables">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Accounts Receivable (Open Invoices)</h4>
                <p className="text-xs text-muted-foreground">Authoritative bill-wise outstanding invoices. Customer credits are tracked separately.</p>
              </div>
              <Badge variant="secondary">Outstanding: ₹{recon.receivables.totalOutstandingRupees.toFixed(2)}</Badge>
            </div>

            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Grand Total</TableHead>
                  <TableHead className="text-right">Balance Due</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.receivables.openInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                      Zero open receivables. All invoices are settled.
                    </TableCell>
                  </TableRow>
                ) : (
                  recon.receivables.openInvoices.map((inv) => (
                    <TableRow key={inv.id} className="text-xs">
                      <TableCell className="font-mono font-semibold">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{inv.date || "—"}</TableCell>
                      <TableCell className="text-right font-mono">₹{inv.total.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600">
                        ₹{inv.balance.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1"
                          onClick={() => navigate({ to: "/invoices" })}
                        >
                          View <ArrowRight className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Tab 4: GST Position */}
        <TabsContent value="gst">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">GST Position & Ledger Match</h4>
                <p className="text-xs text-muted-foreground">Statutory GST heads verified against posted invoice records and general ledger.</p>
              </div>
              {getStatusBadge(recon.gst.status)}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Taxable Turnover</div>
                <div className="text-sm font-bold font-mono">₹{recon.gst.taxableTurnoverRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">CGST Output</div>
                <div className="text-sm font-bold font-mono">₹{recon.gst.cgstRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">SGST Output</div>
                <div className="text-sm font-bold font-mono">₹{recon.gst.sgstRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">IGST Output</div>
                <div className="text-sm font-bold font-mono">₹{recon.gst.igstRupees.toFixed(2)}</div>
              </div>
            </div>

            <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-200 text-xs">
              <span className="font-bold">Statutory Proof: </span>
              CGST (₹{recon.gst.cgstRupees.toFixed(2)}) + SGST (₹{recon.gst.sgstRupees.toFixed(2)}) + IGST (₹{recon.gst.igstRupees.toFixed(2)}) === Output GST (₹{recon.gst.outputGstRupees.toFixed(2)}) === Ledger Balance (₹{recon.gst.outputGstLedgerRupees.toFixed(2)}).
            </div>
          </Card>
        </TabsContent>

        {/* Tab 5: Cash & Bank */}
        <TabsContent value="cashbank">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Cash & Bank Movement</h4>
                <p className="text-xs text-muted-foreground">Reconciliation of cash/bank accounts against customer receipts and voucher entries.</p>
              </div>
              {getStatusBadge(recon.cashBank.status)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Cash in Hand Ledger</div>
                <div className="text-sm font-bold font-mono">₹{recon.cashBank.cashLedgerRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Bank Accounts Ledger</div>
                <div className="text-sm font-bold font-mono">₹{recon.cashBank.bankLedgerRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Total Customer Receipts</div>
                <div className="text-sm font-bold font-mono">₹{recon.cashBank.customerReceiptsRupees.toFixed(2)}</div>
              </div>
            </div>

            <div className="p-3 rounded-md bg-muted/30 text-xs text-muted-foreground">
              {recon.cashBank.explanation}
            </div>
          </Card>
        </TabsContent>

        {/* Tab 6: Profit & COGS */}
        <TabsContent value="profit">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Profitability & COGS Audit</h4>
                <p className="text-xs text-muted-foreground">Gross profit derived strictly from invoiced items and configured purchase prices.</p>
              </div>
              {getStatusBadge(recon.profit.status)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Net Sales Revenue</div>
                <div className="text-sm font-bold font-mono">₹{recon.profit.netSalesRevenueRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Cost of Goods Sold (COGS)</div>
                <div className="text-sm font-bold font-mono">₹{recon.profit.costOfGoodsSoldRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Gross Profit</div>
                <div className="text-sm font-bold font-mono text-emerald-600">₹{recon.profit.grossProfitRupees.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-lg border bg-muted/10 space-y-1">
                <div className="text-muted-foreground">Gross Margin</div>
                <div className="text-sm font-bold font-mono">{recon.profit.marginPercent.toFixed(1)}%</div>
              </div>
            </div>

            {!recon.profit.isCostingComplete && (
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
                <span className="font-bold">Attention: </span>
                Purchase costing incomplete for: {recon.profit.missingCostItems.join(", ")}. Configure item cost in Products & Stock.
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Tab 7: Trial Balance Drill-Down */}
        <TabsContent value="tb">
          <Card className="p-4 card-soft space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">Trial Balance Summary</h4>
                <p className="text-xs text-muted-foreground">Total Debit === Total Credit verified from canonical signed balances.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => navigate({ to: "/ledger" })}
              >
                Open Full Trial Balance <ArrowRight className="h-3 w-3" />
              </Button>
            </div>

            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead className="text-right">Closing Debit</TableHead>
                  <TableHead className="text-right">Closing Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.trialBalance.items.map((item) => (
                  <TableRow key={item.ledgerId} className="text-xs">
                    <TableCell className="font-semibold">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground">{item.groupName}</TableCell>
                    <TableCell className="uppercase text-[10px] font-medium">{item.nature}</TableCell>
                    <TableCell className="text-right font-mono">
                      {item.closingDrPaise > 0 ? formatPaise(item.closingDrPaise) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {item.closingCrPaise > 0 ? formatPaise(item.closingCrPaise) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function CAReviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Skeleton Top Filter */}
      <div className="h-14 rounded-2xl border border-border/80 bg-card p-4 shadow-soft flex items-center justify-between">
        <div className="h-5 w-48 bg-muted/60 rounded-md" />
        <div className="h-8 w-28 bg-muted/60 rounded-md" />
      </div>

      {/* Skeleton Matrix */}
      <div className="space-y-2">
        <div className="h-4 w-56 bg-muted/70 rounded-md" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i} className="p-3.5 card-soft space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-3 w-16 bg-muted/60 rounded-md" />
                <div className="h-4 w-12 bg-muted/50 rounded-full" />
              </div>
              <div className="h-6 w-24 bg-muted/70 rounded-md" />
              <div className="h-2.5 w-28 bg-muted/40 rounded-md" />
            </Card>
          ))}
        </div>
      </div>

      {/* Skeleton Period Comparison */}
      <div className="p-4 rounded-2xl border border-border/80 bg-card/60 shadow-soft space-y-3">
        <div className="h-4 w-48 bg-muted/70 rounded-md" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 rounded-lg border bg-background/50 space-y-2">
              <div className="h-2.5 w-24 bg-muted/50 rounded-md" />
              <div className="h-5 w-28 bg-muted/70 rounded-md" />
              <div className="h-2 w-32 bg-muted/40 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Skeleton Drilldown */}
      <div className="h-64 rounded-2xl border border-border/80 bg-card p-4 shadow-soft flex flex-col justify-center items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary/40 border-t-transparent animate-spin" />
        <div className="h-4 w-40 bg-muted/60 rounded-md" />
      </div>
    </div>
  );
}

