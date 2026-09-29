import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileSpreadsheet,
  FileText,
  Printer,
  Share2,
  Calendar,
  Building2,
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Receipt,
  Download,
} from "lucide-react";
import { useLive, useLiveState } from "@/lib/useLive";
import { db, type Invoice, type Purchase, type Receipt as DbReceipt, type Payment, type CreditNote, type Party } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { formatDate, formatMoney } from "@/lib/format";
import { executeExport } from "@/modules/export/exportService";
import type { ExportColumnDefinition } from "@/modules/export/exportTypes";
import { toast } from "sonner";
import { resolveDatePreset, type DatePreset } from "@/modules/accounting/services/reportingScope";
import { getPartyStatement } from "@/modules/accounting/services/reportEngine";

export interface StatementTransactionRow {
  id: string;
  date: string;
  timestamp: number;
  type: "Invoice" | "Purchase" | "Receipt" | "Payment" | "Credit Note" | "Opening";
  documentNumber: string;
  reference?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  branchName?: string;
}

export function PartyStatementModal({
  open,
  onOpenChange,
  party,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: Party | any | null;
}) {
  const { activeCompany, branches, activeBranchId: currentScopeBranchId, isOwner } = useActiveCompany();
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("this_fy");

  // Load transactions
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const receiptsState = useLiveState<DbReceipt>(() => db().receipts.toArray());
  const paymentsState = useLiveState<Payment>(() => db().payments.toArray());
  const creditNotesState = useLiveState<CreditNote>(() => db().creditNotes.toArray());

  const dateRange = useMemo(() => {
    return resolveDatePreset(datePreset);
  }, [datePreset]);

  const partyType = party?.partyType || (party?.isCustomer ? "SUNDRY_DEBTOR" : "SUNDRY_CREDITOR");
  const isDebtor = partyType === "SUNDRY_DEBTOR" || partyType === "BOTH" || party?.isCustomer;

  // Build statement timeline using authoritative getPartyStatement (Item 4)
  const { openingBalance, rows, closingBalance, totalDebits, totalCredits } = useMemo(() => {
    if (!party) {
      return { openingBalance: 0, rows: [], closingBalance: 0, totalDebits: 0, totalCredits: 0 };
    }

    const stmt = getPartyStatement({
      party,
      invoices: invoicesState.data,
      purchases: purchasesState.data,
      receipts: receiptsState.data,
      payments: paymentsState.data,
      creditNotes: creditNotesState.data,
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
      branchId: selectedBranchId,
    });

    const periodRows: StatementTransactionRow[] = stmt.rows.map((r) => {
      const bObj = branches.find((b) => b.id === r.branchId);
      return {
        id: r.id,
        date: r.date,
        timestamp: r.timestamp,
        type: r.type as any,
        documentNumber: r.documentNumber,
        reference: r.reference,
        debit: r.debit,
        credit: r.credit,
        runningBalance: r.runningBalance,
        branchName: bObj?.name || "Main Branch",
      };
    });

    return {
      openingBalance: stmt.openingBalance,
      rows: periodRows,
      closingBalance: stmt.closingBalance,
      totalDebits: stmt.periodDebit,
      totalCredits: stmt.periodCredit,
    };
  }, [
    party,
    dateRange,
    selectedBranchId,
    invoicesState.data,
    purchasesState.data,
    receiptsState.data,
    paymentsState.data,
    creditNotesState.data,
    branches,
  ]);

  const statementColumns: ExportColumnDefinition<StatementTransactionRow>[] = [
    { key: "date", header: "Date", width: 14 },
    { key: "type", header: "Particulars", width: 16 },
    { key: "documentNumber", header: "Voucher / Doc #", width: 18 },
    { key: "reference", header: "Reference", width: 18, getter: (r) => r.reference || "—" },
    { key: "debit", header: "Debit (₹)", type: "currency", width: 16 },
    { key: "credit", header: "Credit (₹)", type: "currency", width: 16 },
    {
      key: "runningBalance",
      header: "Running Balance (₹)",
      type: "currency",
      width: 18,
      formatForDisplay: (v) => `${formatMoney(Math.abs(v))} ${v >= 0 ? "Dr" : "Cr"}`,
    },
    { key: "branchName", header: "Branch", width: 16 },
  ];

  function handleDownloadExcel() {
    if (!party) return;
    executeExport({
      filename: `Statement_${(party.name || "Party").replace(/\s+/g, "_")}`,
      sheetName: "Account Statement",
      title: `${party.name} — Account Statement`,
      subtitle: `${party.gstin ? `GSTIN: ${party.gstin}  •  ` : ""}${party.mobile || party.phone || ""}`,
      scopeSummary: `Period: ${dateRange.label}  •  Branch: ${selectedBranchId === "all" ? "All Branches" : selectedBranchId}  •  Closing: ${formatMoney(Math.abs(closingBalance))} ${closingBalance >= 0 ? "Dr" : "Cr"}`,
      columns: statementColumns,
      data: rows,
      format: "excel",
      includeTotals: true,
    });
    toast.success("Account statement exported to Excel.");
  }

  function handleDownloadPDF() {
    if (!party) return;
    executeExport({
      filename: `Statement_${(party.name || "Party").replace(/\s+/g, "_")}`,
      title: `${party.name} — Account Statement`,
      subtitle: `${party.gstin ? `GSTIN: ${party.gstin}  •  ` : ""}${party.mobile || party.phone || ""}`,
      scopeSummary: `Period: ${dateRange.label}  •  Branch: ${selectedBranchId === "all" ? "All Branches" : selectedBranchId}  •  Closing: ${formatMoney(Math.abs(closingBalance))} ${closingBalance >= 0 ? "Dr" : "Cr"}`,
      columns: statementColumns,
      data: rows,
      format: "pdf",
      includeTotals: true,
    });
    toast.success("Account statement exported to PDF.");
  }

  function handlePrint() {
    window.print();
  }

  async function handleShare() {
    if (!party) return;
    const shareText = `${activeCompany?.name || "BMS NEXT"} — Statement of Account\nParty: ${party.name}\nPeriod: ${dateRange.label}\nOpening Balance: ${formatMoney(Math.abs(openingBalance))} ${openingBalance >= 0 ? "Dr" : "Cr"}\nTotal Debits: ${formatMoney(totalDebits)}\nTotal Credits: ${formatMoney(totalCredits)}\nClosing Balance: ${formatMoney(Math.abs(closingBalance))} ${closingBalance >= 0 ? "Dr" : "Cr"}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Account Statement - ${party.name}`,
          text: shareText,
        });
        toast.success("Shared successfully");
      } catch {
        // User cancelled or unsupported
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      toast.success("Statement summary copied to clipboard.");
    }
  }

  if (!party) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 border-b border-border/70 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold text-foreground">
                  Statement of Account: {party.name}
                </DialogTitle>
                {party.partyCode && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {party.partyCode}
                  </Badge>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {[party.gstin ? `GSTIN: ${party.gstin}` : null, party.city, party.mobile || party.phone]
                  .filter(Boolean)
                  .join("  •  ")}
              </DialogDescription>
            </div>

            {/* Actions: Download PDF, Download Excel, Print, Share */}
            <div className="flex flex-wrap items-center gap-1.5 no-print">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleDownloadExcel}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Excel</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleDownloadPDF}
              >
                <FileText className="h-3.5 w-3.5 text-rose-600" />
                <span>PDF</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handlePrint}
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleShare}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share</span>
              </Button>
            </div>
          </div>

          {/* Filter Bar: Branch & Date Range */}
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-border/50 text-xs no-print">
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={datePreset} onValueChange={(v: DatePreset) => setDatePreset(v)}>
                <SelectTrigger className="h-7 w-[150px] text-xs">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="this_month" className="text-xs">This Month</SelectItem>
                  <SelectItem value="last_month" className="text-xs">Last Month</SelectItem>
                  <SelectItem value="this_quarter" className="text-xs">This Quarter</SelectItem>
                  <SelectItem value="this_fy" className="text-xs">This Financial Year</SelectItem>
                  <SelectItem value="mtd" className="text-xs">MTD</SelectItem>
                  <SelectItem value="all_time" className="text-xs">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <span className="text-[11px] text-muted-foreground ml-auto">
              Period: {dateRange.fromDate} to {dateRange.toDate}
            </span>
          </div>
        </DialogHeader>

        {/* Balance Overview Cards */}
        <div className="grid grid-cols-3 gap-2.5 p-4 bg-muted/20 border-b border-border/60">
          <div className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Opening Balance</div>
            <div className="text-base font-bold font-mono mt-0.5 text-foreground">
              {formatMoney(Math.abs(openingBalance))}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {openingBalance >= 0 ? "Dr" : "Cr"}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
            <div className="text-[11px] font-medium text-muted-foreground">Period Movement</div>
            <div className="text-xs font-mono mt-1 space-y-0.5">
              <div className="text-emerald-700 dark:text-emerald-400">Dr: {formatMoney(totalDebits)}</div>
              <div className="text-rose-700 dark:text-rose-400">Cr: {formatMoney(totalCredits)}</div>
            </div>
          </div>

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 shadow-2xs">
            <div className="text-[11px] font-medium text-primary">Closing Balance</div>
            <div className="text-base font-bold font-mono mt-0.5 text-foreground">
              {formatMoney(Math.abs(closingBalance))}
              <span className="text-xs font-normal text-primary ml-1">
                {closingBalance >= 0 ? "Dr (Receivable)" : "Cr (Payable)"}
              </span>
            </div>
          </div>
        </div>

        {/* Scrollable Statement Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-2xs">
              <TableRow className="text-[11px] font-semibold uppercase text-muted-foreground border-b border-border/70">
                <TableHead className="w-[100px]">Date</TableHead>
                <TableHead className="w-[120px]">Particulars</TableHead>
                <TableHead className="w-[130px]">Voucher #</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right w-[110px]">Debit (₹)</TableHead>
                <TableHead className="text-right w-[110px]">Credit (₹)</TableHead>
                <TableHead className="text-right w-[130px]">Balance (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Opening Balance Row */}
              <TableRow className="bg-muted/30 font-medium text-xs">
                <TableCell className="font-mono text-[11px]">{dateRange.fromDate}</TableCell>
                <TableCell className="font-semibold text-primary">Opening Balance</TableCell>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell className="text-muted-foreground text-xs">Brought forward</TableCell>
                <TableCell className="text-right font-mono">{openingBalance > 0 ? formatMoney(openingBalance) : "—"}</TableCell>
                <TableCell className="text-right font-mono">{openingBalance < 0 ? formatMoney(Math.abs(openingBalance)) : "—"}</TableCell>
                <TableCell className="text-right font-mono font-bold">
                  {formatMoney(Math.abs(openingBalance))} {openingBalance >= 0 ? "Dr" : "Cr"}
                </TableCell>
              </TableRow>

              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-xs text-muted-foreground">
                    No transactions posted for this party during the selected period.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={`${row.type}-${row.id}`} className="text-xs hover:bg-muted/40">
                    <TableCell className="font-mono text-[11px]">{row.date}</TableCell>
                    <TableCell className="font-medium text-foreground">{row.type}</TableCell>
                    <TableCell className="font-mono text-primary font-medium">{row.documentNumber}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[150px]">{row.reference || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {row.debit > 0 ? formatMoney(row.debit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {row.credit > 0 ? formatMoney(row.credit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-foreground">
                      {formatMoney(Math.abs(row.runningBalance))} {row.runningBalance >= 0 ? "Dr" : "Cr"}
                    </TableCell>
                  </TableRow>
                ))
              )}

              {/* Closing Summary Row */}
              <TableRow className="bg-muted/50 font-bold text-xs border-t-2 border-border/80">
                <TableCell colSpan={4} className="text-right uppercase tracking-wider text-[11px]">
                  Closing Position ({dateRange.toDate})
                </TableCell>
                <TableCell className="text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {formatMoney(totalDebits)}
                </TableCell>
                <TableCell className="text-right font-mono text-rose-700 dark:text-rose-400">
                  {formatMoney(totalCredits)}
                </TableCell>
                <TableCell className="text-right font-mono text-base text-primary">
                  {formatMoney(Math.abs(closingBalance))} {closingBalance >= 0 ? "Dr" : "Cr"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
