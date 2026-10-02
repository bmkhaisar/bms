import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Users, Truck, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Customer, type Supplier, type Invoice, type Purchase, type Receipt, type Payment, type SalesReturn } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";

export interface PartyOutstandingRow {
  partyId: string;
  partyType: "customer" | "supplier";
  name: string;
  phone?: string;
  gstin?: string;
  creditDays?: number;
  creditLimit?: number;
  totalBilled: number;
  totalCleared: number;
  totalAdjusted: number;
  outstandingBalance: number;
  overdueAmount: number;
  status: "clear" | "normal" | "overdue" | "limit_exceeded";
}

export function PartyOutstandingView() {
  const navigate = useNavigate();
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const receipts = useLive<Receipt>(() => db().receipts.toArray());
  const payments = useLive<Payment>(() => db().payments.toArray());
  const salesReturns = useLive<SalesReturn>(() => db().salesReturns.toArray());

  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "supplier">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // 'all', 'overdue', 'has_balance'
  const [search, setSearch] = useState("");

  const now = Date.now();

  // Compute Outstanding for all parties
  const rows: PartyOutstandingRow[] = useMemo(() => {
    const list: PartyOutstandingRow[] = [];

    // 1. Customers (Receivables)
    for (const c of customers) {
      const custInvoices = invoices.filter((inv) => inv.customerId === c.id && inv.status !== "cancelled" && inv.status !== "draft");
      const custReceipts = receipts.filter((r) => r.customerId === c.id);
      const custReturns = salesReturns.filter((sr) => sr.customerId === c.id && sr.status !== "cancelled");

      const totalBilled = custInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
      const totalCleared = custReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
      const totalAdjusted = custReturns.reduce((sum, sr) => sum + (sr.grandTotal || 0), 0);
      const outstandingBalance = Math.max(0, totalBilled - totalCleared - totalAdjusted);

      // Check overdue invoices
      let overdueAmount = 0;
      for (const inv of custInvoices) {
        if ((inv.balance || 0) > 0.01) {
          const due = inv.dueDate || (inv.date + (c.creditDays || 30) * 86400000);
          if (now > due) {
            overdueAmount += inv.balance || 0;
          }
        }
      }

      let status: "clear" | "normal" | "overdue" | "limit_exceeded" = "normal";
      if (outstandingBalance <= 0.01) {
        status = "clear";
      } else if (c.creditLimit && outstandingBalance > c.creditLimit) {
        status = "limit_exceeded";
      } else if (overdueAmount > 0) {
        status = "overdue";
      }

      list.push({
        partyId: c.id,
        partyType: "customer",
        name: c.name,
        phone: c.phone,
        gstin: c.gstin,
        creditDays: c.creditDays,
        creditLimit: c.creditLimit,
        totalBilled,
        totalCleared,
        totalAdjusted,
        outstandingBalance,
        overdueAmount,
        status,
      });
    }

    // 2. Suppliers (Payables)
    for (const s of suppliers) {
      const suppPurchases = purchases.filter((p) => p.supplierId === s.id && p.status !== "cancelled");
      const suppPayments = payments.filter((p) => p.supplierId === s.id);

      const totalBilled = suppPurchases.reduce((sum, p) => sum + (p.grandTotal || 0), 0);
      const totalCleared = suppPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const outstandingBalance = Math.max(0, totalBilled - totalCleared);

      // Check overdue purchases
      let overdueAmount = 0;
      for (const p of suppPurchases) {
        if ((p.balance || 0) > 0.01) {
          const due = (p as any).dueDate || (p.date + 30 * 86400000);
          if (now > due) {
            overdueAmount += p.balance || 0;
          }
        }
      }

      let status: "clear" | "normal" | "overdue" | "limit_exceeded" = "normal";
      if (outstandingBalance <= 0.01) {
        status = "clear";
      } else if (overdueAmount > 0) {
        status = "overdue";
      }

      list.push({
        partyId: s.id,
        partyType: "supplier",
        name: s.name,
        phone: s.phone,
        gstin: s.gstin,
        creditDays: undefined,
        creditLimit: undefined,
        totalBilled,
        totalCleared,
        totalAdjusted: 0,
        outstandingBalance,
        overdueAmount,
        status,
      });
    }

    return list;
  }, [customers, suppliers, invoices, purchases, receipts, payments, salesReturns, now]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.partyType !== typeFilter) return false;

      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        r.name.toLowerCase().includes(q) ||
        (r.phone && r.phone.includes(q)) ||
        (r.gstin && r.gstin.toLowerCase().includes(q));

      let matchStatus = true;
      if (statusFilter === "has_balance") matchStatus = r.outstandingBalance > 0.01;
      else if (statusFilter === "overdue") matchStatus = r.overdueAmount > 0;
      else if (statusFilter === "clear") matchStatus = r.outstandingBalance <= 0.01;

      return matchSearch && matchStatus;
    });
  }, [rows, typeFilter, statusFilter, search]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalReceivables = 0;
    let totalPayables = 0;
    let totalOverdue = 0;
    let overdueCount = 0;

    for (const r of rows) {
      if (r.partyType === "customer") {
        totalReceivables += r.outstandingBalance;
      } else {
        totalPayables += r.outstandingBalance;
      }

      if (r.overdueAmount > 0) {
        totalOverdue += r.overdueAmount;
        overdueCount++;
      }
    }

    return {
      totalReceivables,
      totalPayables,
      netWorkingCapital: totalReceivables - totalPayables,
      totalOverdue,
      overdueCount,
    };
  }, [rows]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredRows.map((r, idx) => ({
        "S.No": idx + 1,
        "Party Type": r.partyType === "customer" ? "Customer (Debtor)" : "Vendor (Creditor)",
        "Party Name": r.name,
        "Phone": r.phone || "-",
        "GSTIN": r.gstin || "-",
        "Credit Terms (Days)": r.creditDays || "-",
        "Credit Limit (INR)": r.creditLimit || "-",
        "Total Billed (INR)": Math.round(r.totalBilled * 100) / 100,
        "Total Cleared (INR)": Math.round(r.totalCleared * 100) / 100,
        "Adjustments / Returns (INR)": Math.round(r.totalAdjusted * 100) / 100,
        "Outstanding Balance (INR)": Math.round(r.outstandingBalance * 100) / 100,
        "Overdue Amount (INR)": Math.round(r.overdueAmount * 100) / 100,
        "Status": r.status.toUpperCase(),
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Outstanding Balances");
      XLSX.writeFile(wb, `Customer_Vendor_Outstanding_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Outstanding balances exported to Excel");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to export Excel");
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Customer Receivables</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalReceivables)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total due from customers</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Vendor Payables</span>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            {formatMoney(metrics.totalPayables)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total owed to suppliers</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Net Liquidity Gap</span>
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {formatMoney(metrics.netWorkingCapital)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {metrics.netWorkingCapital >= 0 ? "Net Positive Working Capital" : "Net Negative Working Capital"}
          </div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Critical Overdue</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {formatMoney(metrics.totalOverdue)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Across {metrics.overdueCount} overdue parties
          </div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search party name, phone, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Select
              value={typeFilter}
              onValueChange={(val) => setTypeFilter(val as "all" | "customer" | "supplier")}
            >
              <SelectTrigger className="w-[170px] h-9 text-xs">
                <SelectValue placeholder="Party Type: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Parties</SelectItem>
                <SelectItem value="customer">Customers (Receivables)</SelectItem>
                <SelectItem value="supplier">Vendors (Payables)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Status: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Balances</SelectItem>
                <SelectItem value="has_balance">With Balance Only</SelectItem>
                <SelectItem value="overdue">Overdue Debts Only</SelectItem>
                <SelectItem value="clear">Settled / Zero Balance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export to Excel</span>
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead className="text-right">Total Billed</TableHead>
                <TableHead className="text-right">Total Cleared</TableHead>
                <TableHead className="text-right font-bold text-foreground">Outstanding (₹)</TableHead>
                <TableHead className="text-right text-rose-600 dark:text-rose-400">Overdue (₹)</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Outstanding Records Found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Adjust your search or status filter.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r, idx) => (
                  <TableRow key={`${r.partyType}_${r.partyId}`} className="hover:bg-secondary/30 transition-colors">
                    <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.partyType === "customer"
                            ? "text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "text-[10px] bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                        }
                      >
                        {r.partyType === "customer" ? "Customer" : "Vendor"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-foreground">{r.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {r.phone && <span>Ph: {r.phone}</span>}
                        {r.gstin && <span>GSTIN: {r.gstin}</span>}
                        {r.creditLimit && <span>Limit: {formatMoney(r.creditLimit)}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.totalBilled)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMoney(r.totalCleared)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {r.outstandingBalance > 0.01 ? (
                        <span className={r.partyType === "customer" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                          {formatMoney(r.outstandingBalance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0.00</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {r.overdueAmount > 0.01 ? (
                        <span className="text-rose-600 dark:text-rose-400">{formatMoney(r.overdueAmount)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.status === "clear" ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Settled
                        </Badge>
                      ) : r.status === "limit_exceeded" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Limit Exceeded
                        </Badge>
                      ) : r.status === "overdue" ? (
                        <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                          Overdue
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          Within Terms
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
