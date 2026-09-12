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
import type { Voucher, Ledger } from "../types";
import { formatDate } from "@/lib/format";
import { Download, Printer, BookOpen, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface LedgerStatementViewProps {
  ledgers: Ledger[];
  vouchers: Voucher[];
}

interface StatementLine {
  date: number;
  voucherNumber: string;
  voucherType: string;
  reference: string;
  description: string;
  debitPaise: number;
  creditPaise: number;
  runningBalancePaise: number;
}

export function LedgerStatementView({ ledgers, vouchers }: LedgerStatementViewProps) {
  const [selectedLedgerId, setSelectedLedgerId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const activeLedgers = useMemo(() => {
    return [...ledgers].sort((a, b) => a.name.localeCompare(b.name));
  }, [ledgers]);

  const currentLedger = useMemo(() => {
    return ledgers.find((l) => l.id === selectedLedgerId);
  }, [ledgers, selectedLedgerId]);

  // Compute statement entries and running balance
  const { lines, openingBalPaise, periodDrPaise, periodCrPaise, closingBalPaise } = useMemo(() => {
    if (!currentLedger) {
      return {
        lines: [],
        openingBalPaise: 0,
        periodDrPaise: 0,
        periodCrPaise: 0,
        closingBalPaise: 0,
      };
    }

    const openingSign = currentLedger.openingBalanceType === "dr" ? 1 : -1;
    const initialOpening = (currentLedger.openingBalance || 0) * openingSign;

    const fromMs = fromDate ? new Date(fromDate).getTime() : 0;
    const toMs = toDate ? new Date(toDate).getTime() + 86400000 : Infinity;

    // Extract all posted voucher lines touching this ledger
    const rawEvents: {
      date: number;
      voucherNumber: string;
      voucherType: string;
      reference: string;
      description: string;
      debit: number;
      credit: number;
    }[] = [];

    for (const v of vouchers) {
      if (v.status !== "posted") continue;
      for (const line of v.lines) {
        if (line.ledgerId === currentLedger.id) {
          rawEvents.push({
            date: v.date,
            voucherNumber: v.voucherNumber,
            voucherType: v.voucherType,
            reference: v.reference || "",
            description: line.description || v.narration || "",
            debit: line.debit,
            credit: line.credit,
          });
        }
      }
    }

    // Sort chronologically
    rawEvents.sort((a, b) => a.date - b.date);

    // Calculate effective opening balance before `fromDate`
    let running = initialOpening;
    let effectiveOpening = initialOpening;
    const periodLines: StatementLine[] = [];
    let pDr = 0;
    let pCr = 0;

    for (const ev of rawEvents) {
      if (ev.date < fromMs) {
        running += ev.debit - ev.credit;
        effectiveOpening = running;
      } else if (ev.date <= toMs) {
        running += ev.debit - ev.credit;
        pDr += ev.debit;
        pCr += ev.credit;
        periodLines.push({
          date: ev.date,
          voucherNumber: ev.voucherNumber,
          voucherType: ev.voucherType,
          reference: ev.reference,
          description: ev.description,
          debitPaise: ev.debit,
          creditPaise: ev.credit,
          runningBalancePaise: running,
        });
      }
    }

    return {
      lines: periodLines,
      openingBalPaise: effectiveOpening,
      periodDrPaise: pDr,
      periodCrPaise: pCr,
      closingBalPaise: running,
    };
  }, [currentLedger, vouchers, fromDate, toDate]);

  const handleExportJson = () => {
    if (!currentLedger) return;
    const exportData = {
      ledger: currentLedger.name,
      nature: currentLedger.groupNature,
      openingBalance: openingBalPaise,
      closingBalance: closingBalPaise,
      periodDebit: periodDrPaise,
      periodCredit: periodCrPaise,
      entries: lines,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-statement-${currentLedger.name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Control Card */}
      <Card className="p-4 card-soft flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-xs">Select Ledger Account</Label>
          <Select value={selectedLedgerId} onValueChange={setSelectedLedgerId}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Choose ledger to inspect statement…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {activeLedgers.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.name} — <span className="uppercase text-[10px] text-muted-foreground">{l.groupNature}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-[130px]">
          <Label className="text-xs">From Date</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div className="space-y-1.5 w-[130px]">
          <Label className="text-xs">To Date</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        {(fromDate || toDate) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="h-9 text-xs"
          >
            Clear Dates
          </Button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={() => window.print()}
            disabled={!currentLedger}
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={handleExportJson}
            disabled={!currentLedger}
          >
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
        </div>
      </Card>

      {!currentLedger ? (
        <Card className="p-12 card-soft text-center text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">Select a ledger account above to view its detailed double-entry statement.</p>
        </Card>
      ) : (
        <>
          {/* Header Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Card className="p-3 card-soft">
              <div className="text-[11px] font-medium text-muted-foreground uppercase">Opening Balance</div>
              <div className="text-lg font-bold font-mono mt-1 flex items-center justify-between">
                <span>{formatPaise(Math.abs(openingBalPaise))}</span>
                <span className="text-xs font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {openingBalPaise >= 0 ? "Dr" : "Cr"}
                </span>
              </div>
            </Card>

            <Card className="p-3 card-soft">
              <div className="text-[11px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                <span>Total Period Debits</span>
              </div>
              <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {formatPaise(periodDrPaise)}
              </div>
            </Card>

            <Card className="p-3 card-soft">
              <div className="text-[11px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                <ArrowDownRight className="h-3 w-3 text-rose-500" />
                <span>Total Period Credits</span>
              </div>
              <div className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                {formatPaise(periodCrPaise)}
              </div>
            </Card>

            <Card className="p-3 card-soft border-primary/20 bg-primary/5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase">Closing Balance</div>
              <div className="text-lg font-bold font-mono text-primary mt-1 flex items-center justify-between">
                <span>{formatPaise(Math.abs(closingBalPaise))}</span>
                <span className="text-xs font-sans px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
                  {closingBalPaise >= 0 ? "Dr" : "Cr"}
                </span>
              </div>
            </Card>
          </div>

          {/* Statement Table */}
          <Card className="card-soft overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead className="w-[140px]">Voucher #</TableHead>
                  <TableHead className="w-[90px]">Type</TableHead>
                  <TableHead className="w-[100px]">Reference</TableHead>
                  <TableHead>Narration / Particulars</TableHead>
                  <TableHead className="text-right w-[120px]">Debit (₹)</TableHead>
                  <TableHead className="text-right w-[120px]">Credit (₹)</TableHead>
                  <TableHead className="text-right w-[140px]">Running Balance (₹)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening Balance Row */}
                <TableRow className="bg-muted/20 font-medium text-xs">
                  <TableCell>—</TableCell>
                  <TableCell className="font-mono text-muted-foreground">OPENING</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="italic text-muted-foreground">Opening Balance Brought Forward</TableCell>
                  <TableCell className="text-right font-mono">
                    {openingBalPaise > 0 ? formatPaise(openingBalPaise) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {openingBalPaise < 0 ? formatPaise(Math.abs(openingBalPaise)) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatPaise(Math.abs(openingBalPaise))} {openingBalPaise >= 0 ? "Dr" : "Cr"}
                  </TableCell>
                </TableRow>

                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      No transactions recorded for this ledger in the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 text-xs">
                      <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell className="font-mono font-medium">{row.voucherNumber}</TableCell>
                      <TableCell>
                        <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">
                          {row.voucherType}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.reference || "—"}</TableCell>
                      <TableCell className="max-w-xs truncate" title={row.description}>
                        {row.description}
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {row.debitPaise > 0 ? formatPaise(row.debitPaise) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400">
                        {row.creditPaise > 0 ? formatPaise(row.creditPaise) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatPaise(Math.abs(row.runningBalancePaise))}{" "}
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {row.runningBalancePaise >= 0 ? "Dr" : "Cr"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Closing Balance Footer */}
            <div className="p-3.5 border-t bg-muted/20 flex flex-wrap items-center justify-between text-xs font-semibold">
              <div className="text-muted-foreground">
                Statement Net Movement: {formatPaise(periodDrPaise - periodCrPaise)}
              </div>
              <div className="flex items-center gap-6 font-mono">
                <span>Period Dr: {formatPaise(periodDrPaise)}</span>
                <span>Period Cr: {formatPaise(periodCrPaise)}</span>
                <span className="text-primary font-bold">
                  Closing: {formatPaise(Math.abs(closingBalPaise))} {closingBalPaise >= 0 ? "Dr" : "Cr"}
                </span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
