import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Package, AlertTriangle, CheckCircle2, TrendingUp, IndianRupee, Layers } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Product, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";

export function StockStatusView() {
  const navigate = useNavigate();
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const categories = useLive<Category>(() => db().categories.toArray());

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all', 'low', 'out', 'normal'

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (p.trackInventory === false) return false;

      const catName = p.categoryId ? categoryMap.get(p.categoryId) || "" : "";
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.hsn && p.hsn.toLowerCase().includes(q)) ||
        catName.toLowerCase().includes(q);

      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;

      const current = p.currentStock || 0;
      const reorder = p.reorderLevel || 0;

      let matchStatus = true;
      if (statusFilter === "out") matchStatus = current <= 0;
      else if (statusFilter === "low") matchStatus = current > 0 && current <= reorder;
      else if (statusFilter === "normal") matchStatus = current > reorder;

      return matchSearch && matchCat && matchStatus;
    });
  }, [products, categoryMap, search, categoryFilter, statusFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of filteredProducts) {
      const stock = Math.max(0, p.currentStock || 0);
      const costRate = p.purchasePrice || 0;
      const sellRate = p.sellingPrice || 0;

      totalUnits += stock;
      totalCostValuation += stock * costRate;
      totalRetailValuation += stock * sellRate;

      if ((p.currentStock || 0) <= 0) {
        outOfStockCount++;
      } else if ((p.currentStock || 0) <= (p.reorderLevel || 0)) {
        lowStockCount++;
      }
    }

    return {
      totalProducts: filteredProducts.length,
      totalUnits,
      totalCostValuation,
      totalRetailValuation,
      lowStockCount,
      outOfStockCount,
    };
  }, [filteredProducts]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredProducts.map((p, idx) => {
        const cat = p.categoryId ? categoryMap.get(p.categoryId) || "-" : "-";
        const stock = p.currentStock || 0;
        const costRate = p.purchasePrice || 0;
        const sellRate = p.sellingPrice || 0;
        const costVal = stock * costRate;
        const retailVal = stock * sellRate;
        const reorder = p.reorderLevel || 0;

        let statusText = "IN STOCK";
        if (stock <= 0) statusText = "OUT OF STOCK";
        else if (stock <= reorder) statusText = "LOW STOCK";

        return {
          "S.No": idx + 1,
          "Product Name": p.name,
          "SKU / Item Code": p.sku || "-",
          "HSN": p.hsn || "-",
          "Category": cat,
          "UOM": p.unit || "PCS",
          "Current Stock": stock,
          "Reorder Level": reorder,
          "Cost Price (INR)": costRate,
          "Selling Price (INR)": sellRate,
          "Valuation at Cost (INR)": Math.round(costVal * 100) / 100,
          "Valuation at Retail (INR)": Math.round(retailVal * 100) / 100,
          "Potential Margin (INR)": Math.round((retailVal - costVal) * 100) / 100,
          "Stock Status": statusText,
        };
      });

      // Total Row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Product Name": `Items: ${metrics.totalProducts}`,
        "SKU / Item Code": "",
        "HSN": "",
        "Category": "",
        "UOM": "",
        "Current Stock": metrics.totalUnits,
        "Reorder Level": 0,
        "Cost Price (INR)": 0,
        "Selling Price (INR)": 0,
        "Valuation at Cost (INR)": Math.round(metrics.totalCostValuation * 100) / 100,
        "Valuation at Retail (INR)": Math.round(metrics.totalRetailValuation * 100) / 100,
        "Potential Margin (INR)":
          Math.round((metrics.totalRetailValuation - metrics.totalCostValuation) * 100) / 100,
        "Stock Status": "",
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock Status & Valuation");
      XLSX.writeFile(wb, `Stock_Status_Valuation_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Stock Status report exported to Excel");
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
            <span className="text-xs font-medium">Stock Quantity</span>
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {metrics.totalUnits.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Across {metrics.totalProducts} active SKUs
          </div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Valuation at Cost</span>
            <IndianRupee className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {formatMoney(metrics.totalCostValuation)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Inventory asset value</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Valuation at Retail</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalRetailValuation)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Gross potential revenue
          </div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Stock Alerts</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {metrics.lowStockCount}
            </span>
            <span className="text-xs text-muted-foreground">low /</span>
            <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {metrics.outOfStockCount}
            </span>
            <span className="text-xs text-muted-foreground">out</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Needs immediate PO</div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search item name, SKU, HSN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px] h-9 text-xs">
                <SelectValue placeholder="Category: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Stock Status: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stock Status</SelectItem>
                <SelectItem value="low">Low Stock Only</SelectItem>
                <SelectItem value="out">Out of Stock (Zero)</SelectItem>
                <SelectItem value="normal">Healthy Stock</SelectItem>
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
                <TableHead>Product / SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                <TableHead className="text-right">Reorder Lvl</TableHead>
                <TableHead className="text-right">Cost Price</TableHead>
                <TableHead className="text-right">Retail Price</TableHead>
                <TableHead className="text-right font-semibold">Cost Valuation</TableHead>
                <TableHead className="text-right font-semibold">Retail Valuation</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Products Found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Adjust your search or filter criteria.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((p, idx) => {
                  const cat = p.categoryId ? categoryMap.get(p.categoryId) || "-" : "-";
                  const stock = p.currentStock || 0;
                  const reorder = p.reorderLevel || 0;
                  const costVal = stock * (p.purchasePrice || 0);
                  const retailVal = stock * (p.sellingPrice || 0);

                  const isOut = stock <= 0;
                  const isLow = !isOut && stock <= reorder;

                  return (
                    <TableRow key={p.id} className="hover:bg-secondary/30 transition-colors">
                      <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => navigate({ to: "/products" })}
                          className="font-semibold text-foreground hover:underline text-left block"
                        >
                          {p.name}
                        </button>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {p.sku && <span>SKU: {p.sku}</span>}
                          {p.hsn && <span>HSN: {p.hsn}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {cat}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {stock} <span className="text-[10px] font-normal text-muted-foreground">{p.unit || "PCS"}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {reorder}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.purchasePrice || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.sellingPrice || 0)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-foreground">
                        {formatMoney(costVal)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-foreground">
                        {formatMoney(retailVal)}
                      </TableCell>
                      <TableCell className="text-center">
                        {isOut ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Out of Stock
                          </Badge>
                        ) : isLow ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            Low Stock
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            In Stock
                          </Badge>
                        )}
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
