import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { Download, Printer, CheckCircle2, AlertTriangle, Scale } from "lucide-react";

interface TrialBalanceViewProps {
  ledgers: Ledger[];
  accountGroups: AccountGroup[];
  vouchers: Voucher[];
}

interface TrialBalanceRow {
  ledgerId: string;
  name: string;
  groupId: string;
  groupName: string;
  nature: string;
  openingPaise: number;
  openingType: "dr" | "cr";
  periodDrPaise: number;
  periodCrPaise: number;
  closingDrPaise: number;
  closingCrPaise: number;
}

export function TrialBalanceView({
  ledgers,
  accountGroups,
  vouchers,
}: TrialBalanceViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNature, setSelectedNature] = useState<string>("all");

  const groupLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of accountGroups) {
      map.set(g.id, g.name);
    }
    return map;
  }, [accountGroups]);

  // Aggregate posted voucher debits and credits per ledger
  const ledgerActivity = useMemo(() => {
    const map = new Map<string, { dr: number; cr: number }>();
    for (const v of vouchers) {
      if (v.status !== "posted") continue;
      for (const line of v.lines) {
        const cur = map.get(line.ledgerId) || { dr: 0, cr: 0 };
        cur.dr += line.debit;
        cur.cr += line.credit;
        map.set(line.ledgerId, cur);
      }
    }
    return map;
  }, [vouchers]);

  // Compute trial balance rows
  const { rows, totalDebitClosing, totalCreditClosing, isBalanced, imbalancePaise } = useMemo(() => {
    let totDr = 0;
    let totCr = 0;

    const computedRows: TrialBalanceRow[] = ledgers.map((l) => {
      const act = ledgerActivity.get(l.id) || { dr: 0, cr: 0 };
      const curBal = l.currentBalance || 0;

      let cDr = 0;
      let cCr = 0;
      if (curBal > 0) {
        cDr = curBal;
      } else if (curBal < 0) {
        cCr = Math.abs(curBal);
      }

      totDr += cDr;
      totCr += cCr;

      return {
        ledgerId: l.id,
        name: l.name,
        groupId: l.groupId,
        groupName: groupLookup.get(l.groupId) || l.groupId,
        nature: l.groupNature,
        openingPaise: l.openingBalance || 0,
        openingType: l.openingBalanceType || "dr",
        periodDrPaise: act.dr,
        periodCrPaise: act.cr,
        closingDrPaise: cDr,
        closingCrPaise: cCr,
      };
    });

    const diff = Math.abs(totDr - totCr);
    return {
      rows: computedRows,
      totalDebitClosing: totDr,
      totalCreditClosing: totCr,
      isBalanced: totDr === totCr,
      imbalancePaise: diff,
    };
  }, [ledgers, ledgerActivity, groupLookup]);

  // Filter rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (selectedNature !== "all" && r.nature !== selectedNature) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.groupName.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, selectedNature, searchQuery]);

  const handleExportJson = () => {
    const data = {
      asOfDate: new Date().toISOString(),
      totalDebit: totalDebitClosing,
      totalCredit: totalCreditClosing,
      balanced: isBalanced,
      accounts: rows,
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
          isBalanced
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
            : "bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isBalanced ? (
            <div className="h-9 w-9 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : (
            <div className="h-9 w-9 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
          )}
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              <span>
                {isBalanced
                  ? "Trial Balance Verified: Total Debit === Total Credit"
                  : "Integrity Violation: Imbalance Detected in Trial Balance!"}
              </span>
            </div>
            <p className="text-xs opacity-90 mt-0.5">
              {isBalanced
                ? "Every financial voucher and opening balance conforms to double-entry accounting rules."
                : `General ledger imbalance: ${formatPaise(imbalancePaise)}. Treat as an integrity failure.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs font-mono font-bold ml-auto">
          <div>
            <span className="opacity-70 uppercase text-[10px] mr-1.5">Total Debit:</span>
            <span>{formatPaise(totalDebitClosing)}</span>
          </div>
          <div>
            <span className="opacity-70 uppercase text-[10px] mr-1.5">Total Credit:</span>
            <span>{formatPaise(totalCreditClosing)}</span>
          </div>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-4 card-soft flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <Label className="text-xs">Search Accounts</Label>
          <Input
            placeholder="Search account name or group..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 border rounded-md p-1 bg-muted/20">
          {["all", "asset", "liability", "equity", "income", "expense"].map((n) => (
            <Button
              key={n}
              variant={selectedNature === n ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setSelectedNature(n)}
            >
              {n}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={handleExportJson}>
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
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
              <TableHead className="text-right w-[110px]">Opening Dr/Cr</TableHead>
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
              filteredRows.map((r) => (
                <TableRow key={r.ledgerId} className="hover:bg-muted/30 text-xs">
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.groupName}</TableCell>
                  <TableCell>
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">
                      {r.nature}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {r.openingPaise > 0
                      ? `${formatPaise(r.openingPaise)} ${r.openingType.toUpperCase()}`
                      : "—"}
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
              ))
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
              <span className="text-emerald-600 dark:text-emerald-400">{formatPaise(totalDebitClosing)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase font-sans">Total Credit:</span>
              <span className="text-blue-600 dark:text-blue-400">{formatPaise(totalCreditClosing)}</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
