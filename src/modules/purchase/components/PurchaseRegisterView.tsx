import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, ShoppingCart, Calculator, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Purchase } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

export function PurchaseRegisterView() {
  const purchases = useLive<Purchase>(() => db().purchases.orderBy("date").reverse().toArray());

  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"all" | "this_month" | "this_quarter" | "this_year">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");

  // Date filtering
  const filteredPurchases = useMemo(() => {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const currentYearStart = new Date(now.getFullYear(), 3, 1).getTime(); // April 1st Indian FY

    return purchases.filter((p) => {
      if (p.status === "cancelled" || p.status === "voided" || p.status === "deleted") {
        return false;
      }

      if (period === "this_month" && p.date < currentMonthStart) return false;
      if (period === "this_year" && p.date < currentYearStart) return false;

      const supName = p.supplierSnapshot?.name || "Supplier";
      if (supplierFilter !== "all" && supName !== supplierFilter) return false;

      if (search) {
        const q = search.toLowerCase();
        const matchesNum = p.number.toLowerCase().includes(q);
        const matchesSup = supName.toLowerCase().includes(q);
        const matchesInv = (p.supplierInvoiceNumber || "").toLowerCase().includes(q);
        const matchesGst = (p.supplierSnapshot?.gstin || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesSup && !matchesInv && !matchesGst) return false;
      }

      return true;
    });
  }, [purchases, period, supplierFilter, search]);

  // Unique suppliers
  const supplierNames = useMemo(() => {
    return Array.from(new Set(purchases.map((p) => p.supplierSnapshot?.name || "Supplier"))).sort();
  }, [purchases]);

  // Summary KPIs
  const summary = useMemo(() => {
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalGross = 0;

    for (const p of filteredPurchases) {
      const taxable = (p.taxableAmount !== undefined && p.taxableAmount > 0)
        ? p.taxableAmount
        : Math.max(0, (p.subtotal || 0) - (p.discountTotal || 0));

      totalTaxable += taxable;
      totalCgst += p.cgstTotal || 0;
      totalSgst += p.sgstTotal || 0;
      totalIgst += p.igstTotal || 0;
      totalGross += p.grandTotal || 0;
    }

    const totalItc = totalCgst + totalSgst + totalIgst;
    return { totalTaxable, totalCgst, totalSgst, totalIgst, totalItc, totalGross, count: filteredPurchases.length };
  }, [filteredPurchases]);

  // Export to Excel
  const exportToExcel = () => {
    const data = filteredPurchases.map((p) => {
      const taxable = (p.taxableAmount !== undefined && p.taxableAmount > 0)
        ? p.taxableAmount
        : Math.max(0, (p.subtotal || 0) - (p.discountTotal || 0));

      return {
        "Voucher Date": formatDate(p.date),
        "Purchase Voucher #": p.number,
        "Supplier Invoice #": p.supplierInvoiceNumber || "—",
        "Supplier Invoice Date": p.supplierInvoiceDate ? formatDate(p.supplierInvoiceDate) : "—",
        "Supplier Name": p.supplierSnapshot?.name || "Supplier",
        "Supplier GSTIN": p.supplierSnapshot?.gstin || "Unregistered",
        "Taxable Value": taxable,
        "CGST Amount": p.cgstTotal || 0,
        "SGST Amount": p.sgstTotal || 0,
        "IGST Amount": p.igstTotal || 0,
        "Total Tax (ITC)": (p.cgstTotal || 0) + (p.sgstTotal || 0) + (p.igstTotal || 0),
        "Round Off": p.roundOff || 0,
        "Total Bill Amount": p.grandTotal,
        "Payment Status": (p.status || "unpaid").toUpperCase(),
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Register");
    XLSX.writeFile(wb, `Purchase_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Purchase Register exported to Excel");
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Bills Count</span>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{summary.count}</div>
          <div className="text-[10px] text-muted-foreground">Purchase vouchers recorded</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Purchases (Gross)</span>
            <ArrowUpRight className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-foreground font-mono">
            {formatMoney(summary.totalGross)}
          </div>
          <div className="text-[10px] text-muted-foreground">Total invoice value</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Taxable Purchases</span>
            <FileText className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">
            {formatMoney(summary.totalTaxable)}
          </div>
          <div className="text-[10px] text-muted-foreground">Base taxable value</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total ITC Available</span>
            <Calculator className="h-4 w-4 text-purple-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-purple-700 dark:text-purple-400 font-mono">
            {formatMoney(summary.totalItc)}
          </div>
          <div className="text-[10px] text-muted-foreground">Input Tax Credit (CGST+SGST+IGST)</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search voucher #, supplier, invoice..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dates</SelectItem>
                <SelectItem value="this_month">This Month</SelectItem>
                <SelectItem value="this_year">This Financial Year</SelectItem>
              </SelectContent>
            </Select>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-44 text-xs h-9">
                <SelectValue placeholder="All Suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {supplierNames.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
            <Download className="h-3.5 w-3.5" />
            <span>Excel Export</span>
          </Button>
        </div>
      </Card>

      {/* Register Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead>Date</TableHead>
                <TableHead>Voucher #</TableHead>
                <TableHead>Supplier Bill #</TableHead>
                <TableHead>Supplier Name</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead className="text-right">Taxable (₹)</TableHead>
                <TableHead className="text-right">CGST (₹)</TableHead>
                <TableHead className="text-right">SGST (₹)</TableHead>
                <TableHead className="text-right">IGST (₹)</TableHead>
                <TableHead className="text-right">Total (₹)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPurchases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                    No purchase transactions recorded for the selected period.
                  </TableCell>
                </TableRow>
              ) : (
                filteredPurchases.map((p) => {
                  const taxable = (p.taxableAmount !== undefined && p.taxableAmount > 0)
                    ? p.taxableAmount
                    : Math.max(0, (p.subtotal || 0) - (p.discountTotal || 0));

                  return (
                    <TableRow key={p.id} className="text-xs hover:bg-secondary/20">
                      <TableCell className="whitespace-nowrap">{formatDate(p.date)}</TableCell>
                      <TableCell className="font-mono font-bold text-primary">{p.number}</TableCell>
                      <TableCell className="font-mono">{p.supplierInvoiceNumber || "—"}</TableCell>
                      <TableCell className="font-medium text-foreground">{p.supplierSnapshot?.name || "Supplier"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{p.supplierSnapshot?.gstin || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(taxable)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.cgstTotal || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.sgstTotal || 0)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.igstTotal || 0)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{formatMoney(p.grandTotal)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] capitalize ${
                            p.status === "paid"
                              ? "bg-emerald-500/10 text-emerald-700"
                              : p.status === "partial"
                              ? "bg-blue-500/10 text-blue-700"
                              : "bg-amber-500/10 text-amber-700"
                          }`}
                        >
                          {p.status || "unpaid"}
                        </Badge>
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
