import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Clock, AlertCircle, Calendar, ArrowRight, Package, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, uid, nextNumber, type SalesOrder, type Invoice } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";
import { documentDeepLink } from "@/lib/useDocumentDeepLink";

export function PendingSalesOrderBook() {
  const navigate = useNavigate();
  const salesOrders = useLive<SalesOrder>(() => db().salesOrders.orderBy("date").reverse().toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [agingFilter, setAgingFilter] = useState("all");

  // Calculate dispatched/invoiced quantities per SO item from Invoices
  const soInvoicedMap = useMemo(() => {
    const map = new Map<string, number>(); // key: `${soId}_${productId}` => total invoiced qty
    for (const inv of invoices) {
      const soId = (inv as any).salesOrderId;
      if (!soId) continue;
      for (const it of inv.items || []) {
        const k = `${soId}_${it.productId}`;
        map.set(k, (map.get(k) || 0) + (it.quantity || 0));
      }
    }
    return map;
  }, [invoices]);

  // Expand open/pending SOs to item rows
  const pendingRows = useMemo(() => {
    const now = Date.now();
    const rows: {
      soId: string;
      soNumber: string;
      soDate: number;
      deliveryDate?: number;
      customerId: string;
      customerName: string;
      customerGstin?: string;
      productId: string;
      productName: string;
      unit: string;
      orderedQty: number;
      dispatchedQty: number;
      pendingQty: number;
      rate: number;
      gstRate: number;
      pendingTaxable: number;
      pendingValue: number;
      agingDays: number;
      status: string;
    }[] = [];

    for (const so of salesOrders) {
      if (so.status === "cancelled" || so.status === "completed") continue;

      for (const it of so.items || []) {
        const invoicedQty = soInvoicedMap.get(`${so.id}_${it.productId}`) || 0;
        const pendingQty = Math.max(0, it.quantity - invoicedQty);

        if (pendingQty > 0 || so.status === "open" || so.status === "partially_invoiced") {
          const agingDays = Math.max(0, Math.floor((now - so.date) / (1000 * 60 * 60 * 24)));
          const pendingTaxable = pendingQty * it.rate;
          const pendingValue = pendingTaxable * (1 + (it.gstRate || 0) / 100);
          const custName = so.customerSnapshot?.name || "Customer";
          const custGstin = so.customerSnapshot?.gstin;

          rows.push({
            soId: so.id,
            soNumber: so.number,
            soDate: so.date,
            deliveryDate: so.deliveryDate,
            customerId: so.customerId,
            customerName: custName,
            customerGstin: custGstin,
            productId: it.productId,
            productName: it.name,
            unit: it.unit || "PCS",
            orderedQty: it.quantity,
            dispatchedQty: invoicedQty,
            pendingQty,
            rate: it.rate,
            gstRate: it.gstRate || 0,
            pendingTaxable,
            pendingValue,
            agingDays,
            status: so.status,
          });
        }
      }
    }

    return rows;
  }, [salesOrders, soInvoicedMap]);

  // Unique customers for dropdown
  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    pendingRows.forEach((r) => {
      if (r.customerName) set.add(r.customerName);
    });
    return Array.from(set).sort();
  }, [pendingRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return pendingRows.filter((row) => {
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        row.soNumber.toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        row.productName.toLowerCase().includes(q);

      const matchCustomer = customerFilter === "all" || row.customerName === customerFilter;

      let matchAging = true;
      if (agingFilter === "0_7") matchAging = row.agingDays <= 7;
      else if (agingFilter === "8_15") matchAging = row.agingDays > 7 && row.agingDays <= 15;
      else if (agingFilter === "16_30") matchAging = row.agingDays > 15 && row.agingDays <= 30;
      else if (agingFilter === "gt_30") matchAging = row.agingDays > 30;

      return matchSearch && matchCustomer && matchAging;
    });
  }, [pendingRows, search, customerFilter, agingFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalPendingOrders = new Set(filteredRows.map((r) => r.soId)).size;
    const totalPendingQty = filteredRows.reduce((sum, r) => sum + r.pendingQty, 0);
    const totalPendingValue = filteredRows.reduce((sum, r) => sum + r.pendingValue, 0);
    const overdueCount = filteredRows.filter((r) => r.deliveryDate && r.deliveryDate < Date.now() && r.pendingQty > 0).length;

    return { totalPendingOrders, totalPendingQty, totalPendingValue, overdueCount };
  }, [filteredRows]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredRows.map((r, idx) => ({
        "S.No": idx + 1,
        "Order No": r.soNumber,
        "Order Date": formatDate(r.soDate),
        "Expected Delivery": r.deliveryDate ? formatDate(r.deliveryDate) : "N/A",
        "Aging (Days)": r.agingDays,
        "Customer Name": r.customerName,
        "Customer GSTIN": r.customerGstin || "-",
        "Item Description": r.productName,
        "Unit": r.unit,
        "Ordered Qty": r.orderedQty,
        "Dispatched Qty": r.dispatchedQty,
        "Pending Qty": r.pendingQty,
        "Unit Price (INR)": r.rate,
        "GST %": r.gstRate,
        "Pending Taxable Value (INR)": Math.round(r.pendingTaxable * 100) / 100,
        "Pending Total Value (INR)": Math.round(r.pendingValue * 100) / 100,
        "Order Status": r.status.toUpperCase(),
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pending Sales Orders");
      XLSX.writeFile(wb, `Pending_Sales_Order_Book_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Pending Sales Order Book exported to Excel");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to export Excel");
    }
  };

  const handleConvertSoToInvoice = async (soId: string) => {
    const so = salesOrders.find((s) => s.id === soId);
    if (!so) return;

    try {
      const invNum = await nextNumber("invoice");
      const newInvoice: Invoice = {
        id: uid(),
        number: invNum,
        date: Date.now(),
        customerId: so.customerId,
        customerSnapshot: so.customerSnapshot,
        items: so.items,
        subtotal: so.subtotal,
        discountTotal: so.discountTotal,
        taxableAmount: so.taxableAmount,
        cgstTotal: so.cgstTotal,
        sgstTotal: so.sgstTotal,
        igstTotal: so.igstTotal,
        gstTotal: so.gstTotal,
        roundOff: so.roundOff,
        grandTotal: so.grandTotal,
        amountPaid: so.advanceReceived || 0,
        balance: Math.max(0, so.grandTotal - (so.advanceReceived || 0)),
        isIgst: (so.igstTotal || 0) > 0,
        status: (so.advanceReceived || 0) >= so.grandTotal ? "paid" : (so.advanceReceived || 0) > 0 ? "partial" : "unpaid",
        notes: `Converted from Sales Order ${so.number}`,
        createdAt: Date.now(),
      };
      (newInvoice as any).salesOrderId = so.id;

      await db().invoices.put(newInvoice);
      await db().salesOrders.update(so.id, {
        status: "completed",
        convertedInvoiceId: newInvoice.id,
        convertedInvoiceNumber: newInvoice.number,
      });

      toast.success(`Sales Order ${so.number} converted to Invoice ${newInvoice.number}!`);
      navigate({ to: documentDeepLink("/invoices", newInvoice.id) as never });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to convert SO to Invoice");
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Orders</span>
            <Clock className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {metrics.totalPendingOrders}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Awaiting dispatch</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Units</span>
            <Package className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {metrics.totalPendingQty.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Total unfulfilled quantity</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Order Value</span>
            <Calendar className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalPendingValue)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Order pipeline revenue</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Overdue Line Items</span>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            {metrics.overdueCount}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Past promised delivery date</div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search order #, customer, item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[180px] h-9 text-xs">
                <SelectValue placeholder="Customer: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {uniqueCustomers.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={agingFilter} onValueChange={setAgingFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <SelectValue placeholder="Aging: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Aging</SelectItem>
                <SelectItem value="0_7">Within 7 Days</SelectItem>
                <SelectItem value="8_15">8 - 15 Days</SelectItem>
                <SelectItem value="16_30">16 - 30 Days</SelectItem>
                <SelectItem value="gt_30">&gt; 30 Days (Critical)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export to Excel</span>
          </Button>
        </div>
      </Card>

      {/* Pending Items Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Order # & Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Item Description</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Dispatched</TableHead>
                <TableHead className="text-right font-semibold text-amber-600 dark:text-amber-400">Pending Qty</TableHead>
                <TableHead className="text-right">Unit Rate</TableHead>
                <TableHead className="text-right font-semibold">Pending Value</TableHead>
                <TableHead className="text-center">Due / Aging</TableHead>
                <TableHead className="text-center w-28">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Pending Sales Orders Found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All confirmed sales orders have been fulfilled or matched filters.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r, idx) => {
                  const isOverdue = r.deliveryDate && r.deliveryDate < Date.now() && r.pendingQty > 0;
                  return (
                    <TableRow key={`${r.soId}_${r.productId}_${idx}`} className="hover:bg-secondary/30 transition-colors">
                      <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="font-semibold text-foreground">{r.soNumber}</div>
                        <div className="text-[11px] text-muted-foreground">{formatDate(r.soDate)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{r.customerName}</div>
                        {r.customerGstin && (
                          <div className="text-[10px] font-mono text-muted-foreground">{r.customerGstin}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{r.productName}</div>
                        <div className="text-[10px] text-muted-foreground">Unit: {r.unit}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.orderedQty}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {r.dispatchedQty}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {r.pendingQty} {r.unit}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.rate)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-foreground">
                        {formatMoney(r.pendingValue)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          {isOverdue ? (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              Overdue ({r.agingDays}d)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              {r.agingDays} days ago
                            </Badge>
                          )}
                          {r.deliveryDate && (
                            <span className="text-[10px] text-muted-foreground">
                              Due: {formatDate(r.deliveryDate)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-[11px] gap-1 px-2 hover:bg-primary hover:text-primary-foreground transition-colors"
                          onClick={() => handleConvertSoToInvoice(r.soId)}
                        >
                          <span>Invoice</span>
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
