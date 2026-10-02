import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Clock, AlertCircle, Calendar } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type PurchaseOrder, type PurchaseGrn } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

export function PendingPurchaseOrderBook() {
  const purchaseOrders = useLive<PurchaseOrder>(() => db().purchaseOrders.orderBy("date").reverse().toArray());
  const grns = useLive<PurchaseGrn>(() => db().purchaseGrns.toArray());

  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [agingFilter, setAgingFilter] = useState("all");

  // Calculate received quantities per PO item from GRNs
  const poReceivedMap = useMemo(() => {
    const map = new Map<string, number>(); // key: `${poId}_${productId}` => total accepted
    for (const g of grns) {
      if (!g.purchaseOrderId) continue;
      for (const it of g.items || []) {
        const k = `${g.purchaseOrderId}_${it.productId}`;
        map.set(k, (map.get(k) || 0) + (it.acceptedQty || 0));
      }
    }
    return map;
  }, [grns]);

  // Expand open/pending POs to item rows
  const pendingRows = useMemo(() => {
    const now = Date.now();
    const rows: {
      poId: string;
      poNumber: string;
      poDate: number;
      dueDate?: number;
      supplierName: string;
      supplierGstin?: string;
      productId: string;
      productName: string;
      unit: string;
      orderedQty: number;
      receivedQty: number;
      pendingQty: number;
      rate: number;
      pendingValue: number;
      agingDays: number;
      status: string;
    }[] = [];

    for (const po of purchaseOrders) {
      if (po.status === "cancelled" || po.status === "received") continue;

      const agingDays = Math.max(0, Math.floor((now - po.date) / 86400000));

      for (const it of po.items || []) {
        const key = `${po.id}_${it.productId}`;
        const recQty = poReceivedMap.get(key) || 0;
        const pendingQty = Math.max(0, (it.quantity || 0) - recQty);

        if (pendingQty > 0) {
          rows.push({
            poId: po.id,
            poNumber: po.number,
            poDate: po.date,
            dueDate: po.dueDate,
            supplierName: po.supplierSnapshot?.name || "Supplier",
            supplierGstin: po.supplierSnapshot?.gstin,
            productId: it.productId,
            productName: it.name,
            unit: it.unit || "PCS",
            orderedQty: it.quantity,
            receivedQty: recQty,
            pendingQty,
            rate: it.rate,
            pendingValue: pendingQty * it.rate,
            agingDays,
            status: po.status || "open",
          });
        }
      }
    }

    return rows;
  }, [purchaseOrders, poReceivedMap]);

  // Unique suppliers
  const supplierNames = useMemo(() => {
    return Array.from(new Set(pendingRows.map((r) => r.supplierName))).sort();
  }, [pendingRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return pendingRows.filter((r) => {
      if (supplierFilter !== "all" && r.supplierName !== supplierFilter) return false;
      if (agingFilter === "0_15" && r.agingDays > 15) return false;
      if (agingFilter === "16_30" && (r.agingDays <= 15 || r.agingDays > 30)) return false;
      if (agingFilter === "gt_30" && r.agingDays <= 30) return false;

      if (search) {
        const q = search.toLowerCase();
        const matchesPo = r.poNumber.toLowerCase().includes(q);
        const matchesSup = r.supplierName.toLowerCase().includes(q);
        const matchesItem = r.productName.toLowerCase().includes(q);
        if (!matchesPo && !matchesSup && !matchesItem) return false;
      }
      return true;
    });
  }, [pendingRows, supplierFilter, agingFilter, search]);

  // Total summary
  const totals = useMemo(() => {
    const totalQty = filteredRows.reduce((sum, r) => sum + r.pendingQty, 0);
    const totalVal = filteredRows.reduce((sum, r) => sum + r.pendingValue, 0);
    return { totalQty, totalVal };
  }, [filteredRows]);

  // Export to Excel
  const exportToExcel = () => {
    const data = filteredRows.map((r) => ({
      "PO Number": r.poNumber,
      "PO Date": formatDate(r.poDate),
      "Due Date": r.dueDate ? formatDate(r.dueDate) : "",
      "Supplier Name": r.supplierName,
      "GSTIN": r.supplierGstin || "",
      "Item Description": r.productName,
      "Ordered Qty": r.orderedQty,
      "Received Qty": r.receivedQty,
      "Pending Qty": r.pendingQty,
      "Unit": r.unit,
      "Unit Rate": r.rate,
      "Pending Value": r.pendingValue,
      "Aging (Days)": r.agingDays,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pending PO Book");
    XLSX.writeFile(wb, `Pending_Purchase_Order_Book_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Pending PO Book exported to Excel");
  };

  return (
    <div className="space-y-4">
      {/* Header Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Pending Lines</span>
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">
            {filteredRows.length}
          </div>
          <div className="text-[10px] text-muted-foreground">Unfulfilled items across POs</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Pending Quantity</span>
            <Clock className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-xl font-bold font-mono">
            {totals.totalQty}
          </div>
          <div className="text-[10px] text-muted-foreground">Units awaited in store</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Pending Value</span>
            <Calendar className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-foreground font-mono">
            {formatMoney(totals.totalVal)}
          </div>
          <div className="text-[10px] text-muted-foreground">Committed open expenditure</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search PO #, supplier, item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-44 text-xs h-9">
                <SelectValue placeholder="All Suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {supplierNames.map((name) => (
                  <SelectItem key={name} value={name} className="text-xs">
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={agingFilter} onValueChange={setAgingFilter}>
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder="Aging Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Aging</SelectItem>
                <SelectItem value="0_15">0 - 15 Days</SelectItem>
                <SelectItem value="16_30">16 - 30 Days</SelectItem>
                <SelectItem value="gt_30">&gt; 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
            <Download className="h-3.5 w-3.5" />
            <span>Excel Export</span>
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead>PO #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Pending Qty</TableHead>
                <TableHead className="text-right">Rate (₹)</TableHead>
                <TableHead className="text-right">Pending Value</TableHead>
                <TableHead className="text-right">Aging</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    No pending purchase orders found. All orders are either fulfilled or no open orders exist.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r, idx) => (
                  <TableRow key={idx} className="text-xs hover:bg-secondary/20">
                    <TableCell className="font-mono font-bold text-primary">{r.poNumber}</TableCell>
                    <TableCell>{formatDate(r.poDate)}</TableCell>
                    <TableCell className="font-medium text-foreground">{r.supplierName}</TableCell>
                    <TableCell>{r.productName}</TableCell>
                    <TableCell className="text-right font-mono">{r.orderedQty} {r.unit}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{r.receivedQty} {r.unit}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-amber-600">{r.pendingQty} {r.unit}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.rate)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(r.pendingValue)}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          r.agingDays > 30
                            ? "bg-rose-500/10 text-rose-700"
                            : r.agingDays > 15
                            ? "bg-amber-500/10 text-amber-700"
                            : "bg-blue-500/10 text-blue-700"
                        }`}
                      >
                        {r.agingDays} days
                      </Badge>
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
