import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { formatPaise } from "../constants";
import type { Ledger, AccountGroup, Voucher } from "../types";
import { getTrialBalance, getDayBook, type TrialBalanceItem } from "../services/reportEngine";
import { Download, Printer, CheckCircle2, AlertTriangle, Scale, Calendar, ArrowRight, ShieldAlert } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface TrialBalanceViewProps {
  ledgers: Ledger[];
  accountGroups: AccountGroup[];
  vouchers: Voucher[];
}

export function TrialBalanceView({
  ledgers,
  accountGroups,
  vouchers,
}: TrialBalanceViewProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNature, setSelectedNature] = useState<string>("all");

  // Period / Month Filters
  const [periodPreset, setPeriodPreset] = useState<"fy" | "this_month" | "prev_month" | "custom" | "specific_month">("fy");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [specificMonth, setSpecificMonth] = useState<string>("2026-09");

  // Compute effective date range based on preset
  const dateRange = useMemo(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth(); // 0-indexed

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

    // Default: full financial year / all time
    return { fromDate: undefined, toDate: undefined };
  }, [periodPreset, fromDate, toDate, specificMonth]);

  // Compute authoritative Trial Balance using canonical report engine
  const report = useMemo(() => {
    return getTrialBalance(ledgers, accountGroups, vouchers, {
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
    });
  }, [ledgers, accountGroups, vouchers, dateRange]);

  // Underlying vouchers status from Day Book
  const dayBookReport = useMemo(() => {
    return getDayBook(vouchers, {
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
    });
  }, [vouchers, dateRange]);

  // Filter rows
  const filteredRows = useMemo(() => {
    return report.items.filter((r) => {
      if (selectedNature !== "all" && r.nature !== selectedNature) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.groupName.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [report.items, selectedNature, searchQuery]);

  const handleExportJson = () => {
    const data = {
      asOfDate: new Date().toISOString(),
      period: periodPreset,
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
      totalDebit: report.totalDebitPaise,
      totalCredit: report.totalCreditPaise,
      balanced: report.isBalanced,
      difference: report.imbalancePaise,
      accounts: report.items,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Integrity Status Banner */}
      <div
        className={`p-4 rounded-lg border flex flex-wrap items-center justify-between gap-4 transition-all ${
          report.isBalanced
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
            : dayBookReport.isBalanced
            ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
            : "bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200"
        }`}
      >
        <div className="flex items-center gap-3">
          {report.isBalanced ? (
            <div className="h-10 w-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : dayBookReport.isBalanced ? (
            <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            </div>
          )}

          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              <span>
                {report.isBalanced
                  ? "Trial Balance Verified: Total Debit === Total Credit"
                  : dayBookReport.isBalanced
                  ? "Trial Balance Requires Attention (Underlying Vouchers Balanced)"
                  : "CRITICAL ACCOUNTING IMBALANCE DETECTED"}
              </span>
            </div>
            <p className="text-xs opacity-90 mt-0.5">
              {report.isBalanced
                ? "Every financial voucher and opening balance conforms to double-entry accounting rules (0 difference)."
                : dayBookReport.isBalanced
                ? `Difference: ${formatPaise(report.imbalancePaise)}. Underlying posted vouchers are balanced. Review account closing derivations.`
                : `Critical voucher discrepancy: ${formatPaise(report.imbalancePaise)}. Unbalanced vouchers exist in Day Book.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs font-mono font-bold ml-auto">
          <div>
            <span className="opacity-70 uppercase text-[10px] mr-1.5 font-sans">Total Debit:</span>
            <span className="text-emerald-600 dark:text-emerald-400">{formatPaise(report.totalDebitPaise)}</span>
          </div>
          <div>
            <span className="opacity-70 uppercase text-[10px] mr-1.5 font-sans">Total Credit:</span>
            <span className="text-blue-600 dark:text-blue-400">{formatPaise(report.totalCreditPaise)}</span>
          </div>
          {!report.isBalanced && (
            <div>
              <span className="opacity-70 uppercase text-[10px] mr-1.5 font-sans text-rose-600 dark:text-rose-400">Diff:</span>
              <span className="text-rose-600 dark:text-rose-400">{formatPaise(report.imbalancePaise)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Period & Month Filter Bar */}
      <Card className="p-3.5 card-soft space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-muted-foreground mr-1" />
            <span className="text-xs font-semibold text-muted-foreground mr-1">Period:</span>
            <div className="flex flex-wrap items-center gap-1 border rounded-md p-1 bg-muted/20">
              <Button
                variant={periodPreset === "fy" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPeriodPreset("fy")}
              >
                Financial Year
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

          {/* Month Selector dropdown */}
          {periodPreset === "specific_month" && (
            <div className="flex items-center gap-2">
              <Label className="text-xs">Month:</Label>
              <Select value={specificMonth} onValueChange={setSpecificMonth}>
                <SelectTrigger className="h-8 text-xs w-[160px]">
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

          {/* Custom Date Inputs */}
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

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleExportJson}>
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          </div>
        </div>

        {/* Search & Nature filter */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Input
              placeholder="Search account name or group..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-1 border rounded-md p-0.5 bg-muted/20">
            {["all", "asset", "liability", "equity", "income", "expense"].map((n) => (
              <Button
                key={n}
                variant={selectedNature === n ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-[11px] capitalize px-2.5"
                onClick={() => setSelectedNature(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Trial Balance Table */}
      <Card className="card-soft overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Account / Ledger Name</TableHead>
              <TableHead>Account Group</TableHead>
              <TableHead className="w-[80px]">Nature</TableHead>
              <TableHead className="text-right w-[120px]">Opening Dr/Cr</TableHead>
              <TableHead className="text-right w-[110px]">Period Dr (₹)</TableHead>
              <TableHead className="text-right w-[110px]">Period Cr (₹)</TableHead>
              <TableHead className="text-right w-[130px]">Closing Debit (₹)</TableHead>
              <TableHead className="text-right w-[130px]">Closing Credit (₹)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                  No accounts found matching filter.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((r) => {
                // Effective opening display
                const hasEffectiveOpening = r.effectiveOpeningSignedPaise !== 0;
                const effOpenAmt = Math.abs(r.effectiveOpeningSignedPaise);
                const effOpenType = r.effectiveOpeningSignedPaise >= 0 ? "DR" : "CR";

                return (
                  <TableRow key={r.ledgerId} className="hover:bg-muted/30 text-xs">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.closingBalanceType === "cr" && r.nature === "asset" && (
                          <span className="text-[10px] px-1 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-normal">
                            Credit Balance
                          </span>
                        )}
                        {r.closingBalanceType === "dr" && r.nature === "liability" && (
                          <span className="text-[10px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-normal">
                            Debit Balance
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.groupName}</TableCell>
                    <TableCell>
                      <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">
                        {r.nature}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {hasEffectiveOpening ? `${formatPaise(effOpenAmt)} ${effOpenType}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {r.periodDrPaise > 0 ? formatPaise(r.periodDrPaise) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400">
                      {r.periodCrPaise > 0 ? formatPaise(r.periodCrPaise) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {r.closingDrPaise > 0 ? formatPaise(r.closingDrPaise) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {r.closingCrPaise > 0 ? formatPaise(r.closingCrPaise) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Grand Total Footer */}
        <div className="p-4 border-t bg-muted/30 flex flex-wrap items-center justify-between text-xs font-bold">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <span>Grand Total ({filteredRows.length} Accounts)</span>
          </div>
          <div className="flex items-center gap-8 font-mono text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase font-sans">Total Debit:</span>
              <span className="text-emerald-600 dark:text-emerald-400">{formatPaise(report.totalDebitPaise)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase font-sans">Total Credit:</span>
              <span className="text-blue-600 dark:text-blue-400">{formatPaise(report.totalCreditPaise)}</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
