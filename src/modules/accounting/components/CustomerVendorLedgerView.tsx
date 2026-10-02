import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Printer, Users, Truck, ArrowUpRight, ArrowDownRight, BookOpen, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Customer, type Supplier, type Invoice, type Purchase, type Receipt, type Payment, type SalesReturn } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

interface LedgerEntry {
  id: string;
  date: number;
  type: string;
  voucherNumber: string;
  particulars: string;
  debit: number;
  credit: number;
  runningBalance: number;
  balanceType: "Dr" | "Cr";
}

export function CustomerVendorLedgerView() {
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const receipts = useLive<Receipt>(() => db().receipts.toArray());
  const payments = useLive<Payment>(() => db().payments.toArray());
  const salesReturns = useLive<SalesReturn>(() => db().salesReturns.toArray());

  // Default select first party if none selected
  const activePartyId = useMemo(() => {
    if (selectedPartyId) return selectedPartyId;
    if (partyType === "customer" && customers.length > 0) return customers[0].id;
    if (partyType === "supplier" && suppliers.length > 0) return suppliers[0].id;
    return "";
  }, [selectedPartyId, partyType, customers, suppliers]);

  const selectedParty = useMemo(() => {
    if (partyType === "customer") return customers.find((c) => c.id === activePartyId) || null;
    return suppliers.find((s) => s.id === activePartyId) || null;
  }, [partyType, customers, suppliers, activePartyId]);

  // Aggregate raw events for selected party
  const { ledgerEntries, openingBal, totalDebit, totalCredit, closingBal } = useMemo(() => {
    if (!selectedParty) {
      return { ledgerEntries: [], openingBal: 0, totalDebit: 0, totalCredit: 0, closingBal: 0 };
    }

    const openingSign = ((selectedParty as any).openingBalanceType || "dr") === "dr" ? 1 : -1;
    const initialOpening = (selectedParty.openingBalance || 0) * openingSign;

    const fromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTs = dateTo ? new Date(dateTo).setHours(23, 59, 59, 999) : Infinity;

    const events: {
      date: number;
      type: string;
      voucherNumber: string;
      particulars: string;
      debit: number;
      credit: number;
    }[] = [];

    if (partyType === "customer") {
      // 1. Sales Invoices (Debit Customer)
      for (const inv of invoices) {
        if (inv.customerId !== selectedParty.id || inv.status === "cancelled" || inv.status === "draft") continue;
        events.push({
          date: inv.date,
          type: "Sales Invoice",
          voucherNumber: inv.number,
          particulars: `Sales Goods / Services`,
          debit: inv.grandTotal,
          credit: 0,
        });
      }

      // 2. Receipts (Credit Customer)
      for (const r of receipts) {
        if (r.customerId !== selectedParty.id) continue;
        events.push({
          date: r.date,
          type: "Receipt",
          voucherNumber: r.number,
          particulars: `Payment Received (${r.mode || "Bank"})`,
          debit: 0,
          credit: r.amount,
        });
      }

      // 3. Sales Returns / Credit Notes (Credit Customer)
      for (const sr of salesReturns) {
        if (sr.customerId !== selectedParty.id || sr.status === "cancelled") continue;
        events.push({
          date: sr.date,
          type: "Credit Note",
          voucherNumber: sr.creditNoteNumber || sr.number,
          particulars: `Sales Return (${sr.reason || "Adjustment"})`,
          debit: 0,
          credit: sr.grandTotal,
        });
      }
    } else {
      // Vendor / Supplier:
      // 1. Purchase Bills (Credit Supplier)
      for (const p of purchases) {
        if (p.supplierId !== selectedParty.id || p.status === "cancelled") continue;
        events.push({
          date: p.date,
          type: "Purchase Bill",
          voucherNumber: p.number,
          particulars: `Goods Purchase Inward`,
          debit: 0,
          credit: p.grandTotal,
        });
      }

      // 2. Payments (Debit Supplier)
      for (const pay of payments) {
        if (pay.supplierId !== selectedParty.id) continue;
        events.push({
          date: pay.date,
          type: "Payment",
          voucherNumber: pay.number,
          particulars: `Payment Made (${pay.mode || "Bank"})`,
          debit: pay.amount,
          credit: 0,
        });
      }
    }

    // Sort ascending by date
    events.sort((a, b) => a.date - b.date);

    // Filter by date range and calculate running balance
    let running = initialOpening;
    let periodDr = 0;
    let periodCr = 0;

    const filtered: LedgerEntry[] = [];
    for (const ev of events) {
      if (ev.date < fromTs) {
        running += ev.debit - ev.credit;
        continue;
      }
      if (ev.date > toTs) continue;

      periodDr += ev.debit;
      periodCr += ev.credit;
      running += ev.debit - ev.credit;

      filtered.push({
        id: `${ev.voucherNumber}_${ev.date}`,
        date: ev.date,
        type: ev.type,
        voucherNumber: ev.voucherNumber,
        particulars: ev.particulars,
        debit: ev.debit,
        credit: ev.credit,
        runningBalance: Math.abs(running),
        balanceType: running >= 0 ? "Dr" : "Cr",
      });
    }

    return {
      ledgerEntries: filtered,
      openingBal: initialOpening,
      totalDebit: periodDr,
      totalCredit: periodCr,
      closingBal: running,
    };
  }, [selectedParty, partyType, invoices, purchases, receipts, payments, salesReturns, dateFrom, dateTo]);

  // Excel Export
  const handleExportExcel = () => {
    if (!selectedParty) return;

    try {
      const partyName = selectedParty.name;
      const exportData = ledgerEntries.map((e, idx) => ({
        "S.No": idx + 1,
        "Date": formatDate(e.date),
        "Voucher Type": e.type,
        "Voucher / Ref No": e.voucherNumber,
        "Particulars": e.particulars,
        "Debit (INR)": e.debit ? Math.round(e.debit * 100) / 100 : 0,
        "Credit (INR)": e.credit ? Math.round(e.credit * 100) / 100 : 0,
        "Running Balance": Math.round(e.runningBalance * 100) / 100,
        "Dr/Cr": e.balanceType,
      }));

      // Total Row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Date": "",
        "Voucher Type": "",
        "Voucher / Ref No": `Entries: ${ledgerEntries.length}`,
        "Particulars": `Closing: ${formatMoney(Math.abs(closingBal))} ${closingBal >= 0 ? "Dr" : "Cr"}`,
        "Debit (INR)": Math.round(totalDebit * 100) / 100,
        "Credit (INR)": Math.round(totalCredit * 100) / 100,
        "Running Balance": Math.round(Math.abs(closingBal) * 100) / 100,
        "Dr/Cr": closingBal >= 0 ? "Dr" : "Cr",
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Party Ledger");
      XLSX.writeFile(
        wb,
        `${partyName.replace(/\s+/g, "_")}_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success("Party Ledger exported to Excel");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to export Excel");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Party Selector & Range Filter */}
      <Card className="p-3.5 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex rounded-md bg-secondary/50 p-0.5 border border-border/60">
              <Button
                variant={partyType === "customer" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  setPartyType("customer");
                  setSelectedPartyId("");
                }}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Customers</span>
              </Button>
              <Button
                variant={partyType === "supplier" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  setPartyType("supplier");
                  setSelectedPartyId("");
                }}
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Vendors</span>
              </Button>
            </div>

            <Select value={activePartyId} onValueChange={setSelectedPartyId}>
              <SelectTrigger className="w-[240px] h-9 text-xs">
                <SelectValue placeholder="Select Party..." />
              </SelectTrigger>
              <SelectContent>
                {partyType === "customer"
                  ? customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  : suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>From:</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-32 h-9 text-xs"
              />
              <span>To:</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-32 h-9 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handlePrint} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </Button>
            <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export to Excel</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Summary KPI Banner for Selected Party */}
      {selectedParty && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Opening Balance</span>
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {formatMoney(Math.abs(openingBal))}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {openingBal >= 0 ? "Debit (Receivable)" : "Credit (Advance/Payable)"}
            </div>
          </Card>

          <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Period Debits</span>
              <ArrowUpRight className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {formatMoney(totalDebit)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Billed or paid out</div>
          </Card>

          <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Period Credits</span>
              <ArrowDownRight className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {formatMoney(totalCredit)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Received or credited</div>
          </Card>

          <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Closing Net Balance</span>
              <Badge variant="outline" className="text-[10px]">
                {closingBal >= 0 ? "Dr" : "Cr"}
              </Badge>
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {formatMoney(Math.abs(closingBal))}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {closingBal > 0
                ? partyType === "customer" ? "Pending Receivable" : "Advance Paid"
                : closingBal < 0
                ? partyType === "customer" ? "Customer Advance" : "Pending Payable"
                : "Account Settled"}
            </div>
          </Card>
        </div>
      )}

      {/* Ledger Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Voucher Type</TableHead>
                <TableHead>Voucher / Ref #</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Debit (₹)</TableHead>
                <TableHead className="text-right">Credit (₹)</TableHead>
                <TableHead className="text-right font-semibold">Running Balance (₹)</TableHead>
                <TableHead className="w-16 text-center">Dr/Cr</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {/* Opening Balance Row */}
              <TableRow className="bg-secondary/15 font-medium">
                <TableCell className="text-center font-mono text-muted-foreground">-</TableCell>
                <TableCell className="text-muted-foreground font-mono">
                  {dateFrom ? formatDate(new Date(dateFrom).getTime()) : "Opening"}
                </TableCell>
                <TableCell className="font-semibold text-foreground">Opening Balance</TableCell>
                <TableCell className="text-muted-foreground font-mono">-</TableCell>
                <TableCell className="text-muted-foreground">Balance brought forward</TableCell>
                <TableCell className="text-right font-mono">
                  {openingBal > 0 ? formatMoney(openingBal) : "-"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {openingBal < 0 ? formatMoney(Math.abs(openingBal)) : "-"}
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-foreground">
                  {formatMoney(Math.abs(openingBal))}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="text-[10px]">
                    {openingBal >= 0 ? "Dr" : "Cr"}
                  </Badge>
                </TableCell>
              </TableRow>

              {ledgerEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    <p className="font-medium text-xs">No transactions recorded in the selected period.</p>
                  </TableCell>
                </TableRow>
              ) : (
                ledgerEntries.map((e, idx) => (
                  <TableRow key={e.id} className="hover:bg-secondary/30 transition-colors">
                    <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(e.date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {e.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-medium text-foreground">{e.voucherNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{e.particulars}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-foreground">
                      {e.debit ? formatMoney(e.debit) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-foreground">
                      {e.credit ? formatMoney(e.credit) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {formatMoney(e.runningBalance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          e.balanceType === "Dr"
                            ? "text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }
                      >
                        {e.balanceType}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}

              {/* Closing Balance Row */}
              <TableRow className="bg-secondary/25 font-bold border-t-2 border-border/80">
                <TableCell className="text-center font-mono">-</TableCell>
                <TableCell className="text-foreground font-mono">
                  {dateTo ? formatDate(new Date(dateTo).getTime()) : "Closing"}
                </TableCell>
                <TableCell className="text-foreground">Closing Balance</TableCell>
                <TableCell className="text-muted-foreground font-mono">-</TableCell>
                <TableCell className="text-muted-foreground">Net Closing Balance</TableCell>
                <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                  {formatMoney(totalDebit)}
                </TableCell>
                <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                  {formatMoney(totalCredit)}
                </TableCell>
                <TableCell className="text-right font-mono font-bold text-primary">
                  {formatMoney(Math.abs(closingBal))}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="text-[10px] font-bold">
                    {closingBal >= 0 ? "Dr" : "Cr"}
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
