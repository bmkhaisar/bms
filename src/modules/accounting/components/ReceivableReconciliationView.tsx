import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, CheckCircle2, RefreshCw, AlertCircle, ArrowRightLeft, UserCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Customer, type Invoice, type Receipt, type SalesReturn } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

interface CustomerReconciliationData {
  customer: Customer;
  totalInvoiced: number;
  totalPaid: number;
  totalReturns: number;
  balanceOutstanding: number;
  invoicesCount: number;
  receiptsCount: number;
  unpaidInvoices: Invoice[];
  unallocatedReceipts: Receipt[];
  reconciliationStatus: "balanced" | "pending_allocation" | "unreconciled";
}

export function ReceivableReconciliationView() {
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const receipts = useLive<Receipt>(() => db().receipts.toArray());
  const salesReturns = useLive<SalesReturn>(() => db().salesReturns.toArray());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Group transactions by customer
  const reconciliationData = useMemo(() => {
    const list: CustomerReconciliationData[] = [];

    for (const cust of customers) {
      const custInvoices = invoices.filter((inv) => inv.customerId === cust.id && inv.status !== "cancelled" && inv.status !== "draft");
      const custReceipts = receipts.filter((r) => r.customerId === cust.id);
      const custReturns = salesReturns.filter((sr) => sr.customerId === cust.id && sr.status !== "cancelled");

      const totalInvoiced = custInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
      const totalPaid = custInvoices.reduce((sum, inv) => sum + (inv.amountPaid || 0), 0);
      const totalReturns = custReturns.reduce((sum, sr) => sum + (sr.grandTotal || 0), 0);
      const totalReceiptsAmount = custReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
      const balanceOutstanding = Math.max(0, totalInvoiced - totalPaid - totalReturns);

      const unpaidInvoices = custInvoices
        .filter((inv) => (inv.balance || 0) > 0.01)
        .sort((a, b) => a.date - b.date);

      // Receipts that are not tied directly to a single invoice or have remaining unallocated funds
      const unallocatedReceipts = custReceipts.filter((r) => {
        if (!r.invoiceId) return true;
        return false;
      });

      let reconciliationStatus: "balanced" | "pending_allocation" | "unreconciled" = "balanced";
      if (balanceOutstanding <= 0.01) {
        reconciliationStatus = "balanced";
      } else if (totalReceiptsAmount >= totalInvoiced && balanceOutstanding > 0.01) {
        reconciliationStatus = "pending_allocation";
      } else {
        reconciliationStatus = "unreconciled";
      }

      if (totalInvoiced > 0 || totalReceiptsAmount > 0 || balanceOutstanding > 0) {
        list.push({
          customer: cust,
          totalInvoiced,
          totalPaid,
          totalReturns,
          balanceOutstanding,
          invoicesCount: custInvoices.length,
          receiptsCount: custReceipts.length,
          unpaidInvoices,
          unallocatedReceipts,
          reconciliationStatus,
        });
      }
    }

    return list;
  }, [customers, invoices, receipts, salesReturns]);

  const filteredData = useMemo(() => {
    return reconciliationData.filter((row) => {
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        row.customer.name.toLowerCase().includes(q) ||
        (row.customer.phone && row.customer.phone.includes(q)) ||
        (row.customer.gstin && row.customer.gstin.toLowerCase().includes(q));

      let matchStatus = true;
      if (statusFilter === "balanced") matchStatus = row.reconciliationStatus === "balanced";
      else if (statusFilter === "pending") matchStatus = row.reconciliationStatus === "pending_allocation";
      else if (statusFilter === "unreconciled") matchStatus = row.reconciliationStatus === "unreconciled";

      return matchSearch && matchStatus;
    });
  }, [reconciliationData, search, statusFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalInvoiced = 0;
    let totalReceived = 0;
    let totalOutstanding = 0;
    let reconciledCount = 0;

    for (const r of reconciliationData) {
      totalInvoiced += r.totalInvoiced;
      totalReceived += r.totalPaid;
      totalOutstanding += r.balanceOutstanding;
      if (r.reconciliationStatus === "balanced") reconciledCount++;
    }

    const reconcileRate = reconciliationData.length > 0
      ? Math.round((reconciledCount / reconciliationData.length) * 100)
      : 100;

    return { totalInvoiced, totalReceived, totalOutstanding, reconcileRate, totalParties: reconciliationData.length };
  }, [reconciliationData]);

  // Selected customer for modal
  const activeRecord = useMemo(() => {
    return reconciliationData.find((r) => r.customer.id === selectedCustomerId) || null;
  }, [reconciliationData, selectedCustomerId]);

  const openReconciliationModal = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setIsReconcileModalOpen(true);
  };

  // Perform Auto-reconciliation FIFO
  const handleAutoReconcileFifo = async () => {
    if (!activeRecord) return;
    setIsProcessing(true);

    try {
      // Calculate available unallocated pool from unapplied receipts or credits
      const custReceipts = receipts.filter((r) => r.customerId === activeRecord.customer.id);
      const totalReceipts = custReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
      let availableToKnockOff = totalReceipts;

      // Update invoices chronologically
      const custInvoices = invoices
        .filter((inv) => inv.customerId === activeRecord.customer.id && inv.status !== "cancelled" && inv.status !== "draft")
        .sort((a, b) => a.date - b.date);

      for (const inv of custInvoices) {
        if (availableToKnockOff <= 0) {
          // Zero remaining to apply
          await db().invoices.update(inv.id, {
            amountPaid: 0,
            balance: inv.grandTotal,
            status: "unpaid",
          });
          continue;
        }

        if (availableToKnockOff >= inv.grandTotal) {
          // Full payment
          availableToKnockOff -= inv.grandTotal;
          await db().invoices.update(inv.id, {
            amountPaid: inv.grandTotal,
            balance: 0,
            status: "paid",
          });
        } else {
          // Partial payment
          const paidPart = availableToKnockOff;
          const rem = inv.grandTotal - paidPart;
          availableToKnockOff = 0;
          await db().invoices.update(inv.id, {
            amountPaid: paidPart,
            balance: rem,
            status: "partial",
          });
        }
      }

      toast.success(`Auto-reconciliation complete for ${activeRecord.customer.name}!`);
      setIsReconcileModalOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Reconciliation failed");
    } finally {
      setIsProcessing(false);
    }
  };

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredData.map((r, idx) => ({
        "S.No": idx + 1,
        "Customer Name": r.customer.name,
        "Phone": r.customer.phone || "-",
        "GSTIN": r.customer.gstin || "-",
        "Total Invoices": r.invoicesCount,
        "Total Invoiced (INR)": Math.round(r.totalInvoiced * 100) / 100,
        "Total Receipts (INR)": Math.round(r.totalPaid * 100) / 100,
        "Total Returns / CN (INR)": Math.round(r.totalReturns * 100) / 100,
        "Balance Outstanding (INR)": Math.round(r.balanceOutstanding * 100) / 100,
        "Reconciliation Status": r.reconciliationStatus.toUpperCase(),
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Receivables Reconciliation");
      XLSX.writeFile(wb, `Receivables_Reconciliation_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Reconciliation report exported to Excel");
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
            <span className="text-xs font-medium">Total Receivables Billed</span>
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {formatMoney(metrics.totalInvoiced)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Across {metrics.totalParties} customers</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total Inflows Reconciled</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalReceived)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Cleared against invoices</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Net Outstanding</span>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            {formatMoney(metrics.totalOutstanding)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Pending collection</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Reconciliation Rate</span>
            <ArrowRightLeft className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {metrics.reconcileRate}%
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Balanced customer accounts</div>
        </Card>
      </div>

      {/* Filters and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customer, phone, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
              className="h-9 text-xs"
            >
              All Parties
            </Button>
            <Button
              variant={statusFilter === "unreconciled" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("unreconciled")}
              className="h-9 text-xs text-rose-600"
            >
              Unreconciled / Pending
            </Button>
            <Button
              variant={statusFilter === "balanced" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("balanced")}
              className="h-9 text-xs text-emerald-600"
            >
              Balanced
            </Button>
          </div>

          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export to Excel</span>
          </Button>
        </div>
      </Card>

      {/* Reconciliation Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Invoiced (₹)</TableHead>
                <TableHead className="text-right">Receipts (₹)</TableHead>
                <TableHead className="text-right">Returns (₹)</TableHead>
                <TableHead className="text-right font-semibold text-rose-600 dark:text-rose-400">
                  Outstanding (₹)
                </TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center w-28">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Customer Records Found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      No customer transactions match your filter.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredData.map((r, idx) => (
                  <TableRow key={r.customer.id} className="hover:bg-secondary/30 transition-colors">
                    <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-foreground">{r.customer.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {r.customer.phone && <span>Ph: {r.customer.phone}</span>}
                        {r.customer.gstin && <span>GSTIN: {r.customer.gstin}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.totalInvoiced)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMoney(r.totalPaid)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.totalReturns ? formatMoney(r.totalReturns) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {r.balanceOutstanding > 0.01 ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          {formatMoney(r.balanceOutstanding)}
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">0.00</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.reconciliationStatus === "balanced" ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Balanced
                        </Badge>
                      ) : r.reconciliationStatus === "pending_allocation" ? (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          Allocation Needed
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[11px] gap-1 px-2.5 hover:bg-primary hover:text-primary-foreground transition-colors"
                        onClick={() => openReconciliationModal(r.customer.id)}
                      >
                        <UserCheck className="h-3 w-3" />
                        <span>Reconcile</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Reconciliation Dialog */}
      <Dialog open={isReconcileModalOpen} onOpenChange={setIsReconcileModalOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-base">
              <span>Account Reconciliation: {activeRecord?.customer.name}</span>
              <Badge variant="outline" className="text-xs">
                Outstanding: {formatMoney(activeRecord?.balanceOutstanding || 0)}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2 text-xs">
            <div className="p-3 bg-secondary/30 rounded-lg border border-border/50 text-[11px] text-muted-foreground flex items-center justify-between">
              <div>
                FIFO Matching matches received funds against earliest unpaid invoices to clear aging debts.
              </div>
              <Button
                size="sm"
                onClick={handleAutoReconcileFifo}
                disabled={isProcessing}
                className="gap-1.5 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 ml-3"
              >
                <RefreshCw className={`h-3 w-3 ${isProcessing ? "animate-spin" : ""}`} />
                <span>Auto-Reconcile (FIFO)</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column: Unpaid Invoices */}
              <div className="space-y-2">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Unpaid Invoices ({activeRecord?.unpaidInvoices.length || 0})</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Knock-off Targets</span>
                </div>
                <div className="border border-border/60 rounded-md divide-y divide-border/40 max-h-60 overflow-y-auto">
                  {(!activeRecord?.unpaidInvoices || activeRecord.unpaidInvoices.length === 0) ? (
                    <div className="p-4 text-center text-muted-foreground">
                      No unpaid invoices. Account is fully settled!
                    </div>
                  ) : (
                    activeRecord.unpaidInvoices.map((inv) => (
                      <div key={inv.id} className="p-2.5 flex items-center justify-between hover:bg-secondary/20">
                        <div>
                          <div className="font-semibold text-foreground">{inv.number}</div>
                          <div className="text-[10px] text-muted-foreground">{formatDate(inv.date)}</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-bold text-rose-600 dark:text-rose-400">
                            {formatMoney(inv.balance || 0)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            of {formatMoney(inv.grandTotal)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Unallocated Receipts */}
              <div className="space-y-2">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Available Receipts & Advances</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Source Funds</span>
                </div>
                <div className="border border-border/60 rounded-md divide-y divide-border/40 max-h-60 overflow-y-auto">
                  {(!activeRecord?.unallocatedReceipts || activeRecord.unallocatedReceipts.length === 0) ? (
                    <div className="p-4 text-center text-muted-foreground">
                      No unlinked receipts available.
                    </div>
                  ) : (
                    activeRecord.unallocatedReceipts.map((r) => (
                      <div key={r.id} className="p-2.5 flex items-center justify-between hover:bg-secondary/20">
                        <div>
                          <div className="font-semibold text-foreground">{r.number}</div>
                          <div className="text-[10px] text-muted-foreground">{formatDate(r.date)} ({r.mode})</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(r.amount)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Unallocated</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t border-border/50">
            <Button variant="outline" size="sm" onClick={() => setIsReconcileModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
