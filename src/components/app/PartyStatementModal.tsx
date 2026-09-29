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
import { isPostedInvoice, isPostedPurchase, isPostedReceipt, isPostedPayment, isPostedCreditNote } from "@/modules/accounting/services/canonicalOutstandingService";
import { resolveDatePreset, type DatePreset } from "@/modules/accounting/services/reportingScope";

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

  // Build statement timeline
  const { openingBalance, rows, closingBalance, totalDebits, totalCredits } = useMemo(() => {
    if (!party) {
      return { openingBalance: 0, rows: [], closingBalance: 0, totalDebits: 0, totalCredits: 0 };
    }

    const partyId = party.id;
    const fromTs = dateRange.fromTimestamp;
    const toTs = dateRange.toTimestamp;

    // Static opening from master
    const baseOpening = Number(party.openingBalance) || 0;
    const openingType = (party.openingBalanceType || "dr").toLowerCase();
    let prePeriodRunning = openingType === "cr" ? -Math.abs(baseOpening) : Math.abs(baseOpening);

    // Collect all transactions related to this party
    interface RawEvent {
      id: string;
      timestamp: number;
      date: string;
      type: "Invoice" | "Purchase" | "Receipt" | "Payment" | "Credit Note";
      documentNumber: string;
      reference?: string;
      debit: number;
      credit: number;
      branchId?: string;
    }

    const allEvents: RawEvent[] = [];

    // 1. Invoices
    for (const inv of invoicesState.data) {
      if (!isPostedInvoice(inv)) continue;
      if (inv.customerId !== partyId && (inv as any).partyId !== partyId) continue;
      const t = inv.date || inv.createdAt;
      const total = Number(inv.grandTotal ?? (inv as any).total) || 0;
      allEvents.push({
        id: inv.id,
        timestamp: t,
        date: formatDate(t),
        type: "Invoice",
        documentNumber: inv.number,
        reference: (inv as any).reference || "",
        debit: total, // Customer debit
        credit: 0,
        branchId: inv.branchId,
      });
    }

    // 2. Receipts
    for (const rec of receiptsState.data) {
      if (!isPostedReceipt(rec)) continue;
      if (rec.customerId !== partyId && (rec as any).partyId !== partyId) continue;
      const t = rec.date || rec.createdAt;
      const amount = Number(rec.amount) || 0;
      allEvents.push({
        id: rec.id,
        timestamp: t,
        date: formatDate(t),
        type: "Receipt",
        documentNumber: rec.number || (rec as any).receiptNumber || "",
        reference: rec.reference || (rec as any).referenceNumber || "",
        debit: 0,
        credit: amount, // Customer credit (reduces AR)
        branchId: rec.branchId,
      });
    }

    // 3. Purchases
    for (const pu of purchasesState.data) {
      if (!isPostedPurchase(pu)) continue;
      if (pu.supplierId !== partyId && (pu as any).partyId !== partyId) continue;
      const t = pu.date || pu.createdAt;
      const total = Number(pu.grandTotal ?? (pu as any).total) || 0;
      allEvents.push({
        id: pu.id,
        timestamp: t,
        date: formatDate(t),
        type: "Purchase",
        documentNumber: pu.number,
        reference: (pu as any).supplierInvoiceNumber || "",
        debit: 0,
        credit: total, // Supplier credit (increases AP)
        branchId: pu.branchId,
      });
    }

    // 4. Payments
    for (const pay of paymentsState.data) {
      if (!isPostedPayment(pay)) continue;
      if (pay.supplierId !== partyId && (pay as any).partyId !== partyId) continue;
      const t = pay.date || pay.createdAt;
      const amount = Number(pay.amount) || 0;
      allEvents.push({
        id: pay.id,
        timestamp: t,
        date: formatDate(t),
        type: "Payment",
        documentNumber: pay.number || (pay as any).paymentNumber || "",
        reference: pay.reference || (pay as any).referenceNumber || "",
        debit: amount, // Supplier debit (reduces AP)
        credit: 0,
        branchId: pay.branchId,
      });
    }

    // 5. Credit Notes
    for (const cn of creditNotesState.data) {
      if (!isPostedCreditNote(cn)) continue;
      if (cn.customerId !== partyId && (cn as any).partyId !== partyId) continue;
      const t = cn.date || cn.createdAt;
      const total = Number(cn.grandTotal ?? (cn as any).total) || 0;
      allEvents.push({
        id: cn.id,
        timestamp: t,
        date: formatDate(t),
        type: "Credit Note",
        documentNumber: cn.number,
        reference: (cn as any).originalInvoiceNumber ? `Against ${(cn as any).originalInvoiceNumber}` : "",
        debit: 0,
        credit: total, // Customer credit note reduces customer balance
        branchId: cn.branchId,
      });
    }

    // Filter by branch
    const branchFilteredEvents = allEvents.filter((ev) => {
      if (selectedBranchId !== "all") {
        return ev.branchId === selectedBranchId;
      }
      return true;
    });

    // Sort chronologically
    branchFilteredEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Roll pre-period events into opening balance
    for (const ev of branchFilteredEvents) {
      if (ev.timestamp < fromTs) {
        prePeriodRunning += ev.debit - ev.credit;
      }
    }

    // Accumulate period rows
    let running = prePeriodRunning;
    const periodRows: StatementTransactionRow[] = [];
    let totDr = 0;
    let totCr = 0;

    for (const ev of branchFilteredEvents) {
      if (ev.timestamp >= fromTs && ev.timestamp <= toTs) {
        running += ev.debit - ev.credit;
        totDr += ev.debit;
        totCr += ev.credit;
        const bObj = branches.find((b) => b.id === ev.branchId);
        periodRows.push({
          id: ev.id,
          date: ev.date,
          timestamp: ev.timestamp,
          type: ev.type,
          documentNumber: ev.documentNumber,
          reference: ev.reference,
          debit: ev.debit,
          credit: ev.credit,
          runningBalance: running,
          branchName: bObj?.name || "Main Branch",
        });
      }
    }

    return {
      openingBalance: prePeriodRunning,
      rows: periodRows,
      closingBalance: running,
      totalDebits: totDr,
      totalCredits: totCr,
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
