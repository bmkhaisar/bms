import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Package, ArrowUpRight, ArrowDownLeft, CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Product, type Invoice, type Purchase, type PurchaseGrn, type SalesReturn } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

interface StockMovement {
  id: string;
  date: number;
  docType: "PURCHASE" | "GRN" | "SALES_INVOICE" | "SALES_RETURN";
  docNumber: string;
  partyName: string;
  productId: string;
  productName: string;
  unit: string;
  inwardQty: number;
  outwardQty: number;
  rate: number;
  totalValue: number;
  runningBalance?: number;
}

export function StockRegisterView() {
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const grns = useLive<PurchaseGrn>(() => db().purchaseGrns.toArray());
  const salesReturns = useLive<SalesReturn>(() => db().salesReturns.toArray());

  const [selectedProductId, setSelectedProductId] = useState<string>("all");
  const [movementType, setMovementType] = useState<string>("all"); // 'all', 'inward', 'outward'
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const selectedProduct = useMemo(() => {
    if (selectedProductId === "all") return null;
    return products.find((p) => p.id === selectedProductId) || null;
  }, [products, selectedProductId]);

  // Aggregate all stock movements chronologically
  const allMovements = useMemo(() => {
    const list: StockMovement[] = [];

    // 1. Inward: Purchases (without GRN)
    for (const p of purchases) {
      if (p.status === "cancelled") continue;
      for (const it of p.items || []) {
        list.push({
          id: `purch_${p.id}_${it.productId}`,
          date: p.date,
          docType: "PURCHASE",
          docNumber: p.number,
          partyName: p.supplierSnapshot?.name || "Supplier",
          productId: it.productId,
          productName: it.name,
          unit: it.unit || "PCS",
          inwardQty: it.quantity,
          outwardQty: 0,
          rate: it.rate,
          totalValue: it.total,
        });
      }
    }

    // 2. Inward: Purchase GRNs
    for (const g of grns) {
      if (g.status === "rejected") continue;
      for (const it of g.items || []) {
        const qty = it.acceptedQty ?? it.receivedQty;
        if (qty <= 0) continue;
        list.push({
          id: `grn_${g.id}_${it.productId}`,
          date: g.date,
          docType: "GRN",
          docNumber: g.number,
          partyName: g.supplierSnapshot?.name || "Supplier",
          productId: it.productId,
          productName: it.name,
          unit: it.unit || "PCS",
          inwardQty: qty,
          outwardQty: 0,
          rate: it.rate || 0,
          totalValue: qty * (it.rate || 0),
        });
      }
    }

    // 3. Outward: Sales Invoices
    for (const inv of invoices) {
      if (inv.status === "cancelled" || inv.status === "draft") continue;
      for (const it of inv.items || []) {
        list.push({
          id: `inv_${inv.id}_${it.productId}`,
          date: inv.date,
          docType: "SALES_INVOICE",
          docNumber: inv.number,
          partyName: inv.customerSnapshot?.name || "Customer",
          productId: it.productId,
          productName: it.name,
          unit: it.unit || "PCS",
          inwardQty: 0,
          outwardQty: it.quantity,
          rate: it.rate,
          totalValue: it.total,
        });
      }
    }

    // 4. Inward: Sales Returns
    for (const sr of salesReturns) {
      if (sr.status === "cancelled" || sr.status === "deleted") continue;
      for (const it of sr.items || []) {
        const qty = it.returnQuantity || 0;
        if (qty <= 0) continue;
        list.push({
          id: `sr_${sr.id}_${it.productId}`,
          date: sr.date,
          docType: "SALES_RETURN",
          docNumber: sr.number,
          partyName: sr.customerSnapshot?.name || "Customer",
          productId: it.productId,
          productName: it.productName || it.name || "Item",
          unit: it.unit || "PCS",
          inwardQty: qty,
          outwardQty: 0,
          rate: it.rate,
          totalValue: it.totalAmount || (qty * it.rate),
        });
      }
    }

    // Sort ascending by date for ledger calculation
    list.sort((a, b) => a.date - b.date);

    return list;
  }, [purchases, grns, invoices, salesReturns]);

  // Compute filtered movements and running balance if single product
  const filteredMovements = useMemo(() => {
    let running = selectedProduct?.openingStock || 0;

    return allMovements
      .filter((m) => {
        if (selectedProductId !== "all" && m.productId !== selectedProductId) return false;

        const q = search.toLowerCase();
        const matchSearch =
          !search ||
          m.docNumber.toLowerCase().includes(q) ||
          m.partyName.toLowerCase().includes(q) ||
          m.productName.toLowerCase().includes(q);

        let matchType = true;
        if (movementType === "inward") matchType = m.inwardQty > 0;
        else if (movementType === "outward") matchType = m.outwardQty > 0;

        let matchDate = true;
        if (dateFrom) {
          const fromTs = new Date(dateFrom).getTime();
          if (m.date < fromTs) matchDate = false;
        }
        if (dateTo) {
          const toTs = new Date(dateTo).setHours(23, 59, 59, 999);
          if (m.date > toTs) matchDate = false;
        }

        return matchSearch && matchType && matchDate;
      })
      .map((m) => {
        running += m.inwardQty - m.outwardQty;
        return {
          ...m,
          runningBalance: running,
        };
      });
  }, [allMovements, selectedProductId, selectedProduct, search, movementType, dateFrom, dateTo]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalInward = 0;
    let totalOutward = 0;
    let totalValue = 0;

    for (const m of filteredMovements) {
      totalInward += m.inwardQty;
      totalOutward += m.outwardQty;
      totalValue += m.totalValue;
    }

    return {
      totalMovements: filteredMovements.length,
      totalInward,
      totalOutward,
      netMovement: totalInward - totalOutward,
      totalValue,
    };
  }, [filteredMovements]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredMovements.map((m, idx) => ({
        "S.No": idx + 1,
        "Date": formatDate(m.date),
        "Document Type": m.docType.replace("_", " "),
        "Voucher / Doc No": m.docNumber,
        "Party Name": m.partyName,
        "Product Name": m.productName,
        "Unit": m.unit,
        "Inward Qty": m.inwardQty || 0,
        "Outward Qty": m.outwardQty || 0,
        "Unit Rate (INR)": m.rate,
        "Transaction Value (INR)": Math.round(m.totalValue * 100) / 100,
        ...(selectedProductId !== "all"
          ? { "Running Balance": m.runningBalance }
          : {}),
      }));

      // Total row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Date": "",
        "Document Type": "",
        "Voucher / Doc No": `Count: ${metrics.totalMovements}`,
        "Party Name": "",
        "Product Name": "",
        "Unit": "",
        "Inward Qty": metrics.totalInward,
        "Outward Qty": metrics.totalOutward,
        "Unit Rate (INR)": 0,
        "Transaction Value (INR)": Math.round(metrics.totalValue * 100) / 100,
        ...(selectedProductId !== "all"
          ? { "Running Balance": selectedProduct?.currentStock || 0 }
          : {}),
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock Register");
      XLSX.writeFile(wb, `Stock_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Stock Register exported to Excel");
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
            <span className="text-xs font-medium">Total Inward</span>
            <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            +{metrics.totalInward.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Purchases, GRNs, & Returns</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total Outward</span>
            <ArrowUpRight className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
            -{metrics.totalOutward.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Sales invoices & dispatches</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Net Stock Change</span>
            <History className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {metrics.netMovement >= 0 ? `+${metrics.netMovement}` : metrics.netMovement}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">In period change</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">
              {selectedProduct ? "Current Stock Balance" : "Total Transaction Value"}
            </span>
            <Package className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {selectedProduct ? `${selectedProduct.currentStock || 0} ${selectedProduct.unit || "PCS"}` : formatMoney(metrics.totalValue)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {selectedProduct ? `Opening: ${selectedProduct.openingStock || 0}` : "Gross value moved"}
          </div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger className="w-[240px] h-9 text-xs">
                <SelectValue placeholder="Product: All Products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items (Full Movement Log)</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.sku ? `(${p.sku})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={movementType} onValueChange={setMovementType}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="Movement: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Movements</SelectItem>
                <SelectItem value="inward">Inward Only</SelectItem>
                <SelectItem value="outward">Outward Only</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search doc #, party, item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

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

            <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs ml-auto">
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export to Excel</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Movements Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Document Type</TableHead>
                <TableHead>Voucher / Doc #</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Inward Qty</TableHead>
                <TableHead className="text-right text-rose-600 dark:text-rose-400">Outward Qty</TableHead>
                <TableHead className="text-right">Unit Rate</TableHead>
                <TableHead className="text-right font-semibold">Total Value</TableHead>
                {selectedProductId !== "all" && (
                  <TableHead className="text-right font-bold text-blue-600 dark:text-blue-400">
                    Running Balance
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredMovements.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={selectedProductId !== "all" ? 11 : 10}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Stock Movements Found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      No matching inward or outward inventory entries for this selection.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredMovements.map((m, idx) => (
                  <TableRow key={`${m.id}_${idx}`} className="hover:bg-secondary/30 transition-colors">
                    <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(m.date)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          m.inwardQty > 0
                            ? "text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "text-[10px] bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        }
                      >
                        {m.docType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium font-mono text-foreground">{m.docNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{m.partyName}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{m.productName}</div>
                      <div className="text-[10px] text-muted-foreground">Unit: {m.unit}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {m.inwardQty > 0 ? `+${m.inwardQty}` : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                      {m.outwardQty > 0 ? `-${m.outwardQty}` : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(m.rate)}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-foreground">
                      {formatMoney(m.totalValue)}
                    </TableCell>
                    {selectedProductId !== "all" && (
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {m.runningBalance} {m.unit}
                      </TableCell>
                    )}
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
