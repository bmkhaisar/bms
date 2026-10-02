import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, CheckCircle2, TrendingUp, IndianRupee, Layers } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Invoice, type Customer } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";

export function SalesRegisterView() {
  const navigate = useNavigate();
  const invoices = useLive<Invoice>(() => db().invoices.orderBy("date").reverse().toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [gstTypeFilter, setGstTypeFilter] = useState("all"); // 'all', 'intra', 'inter'
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Exclude drafts or cancelled from statutory register if desired, or allow toggling
      if (inv.status === "cancelled" || inv.status === "draft") return false;

      const cust = customerMap.get(inv.customerId) || inv.customerSnapshot;
      const custName = cust?.name || "Cash Customer";
      const gstin = cust?.gstin || "";

      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        inv.number.toLowerCase().includes(q) ||
        custName.toLowerCase().includes(q) ||
        gstin.toLowerCase().includes(q);

      const matchCustomer = customerFilter === "all" || inv.customerId === customerFilter;

      let matchStatus = true;
      if (statusFilter === "paid") matchStatus = (inv.balance || 0) <= 0.01;
      else if (statusFilter === "unpaid") matchStatus = (inv.amountPaid || 0) === 0;
      else if (statusFilter === "partial") matchStatus = (inv.amountPaid || 0) > 0 && (inv.balance || 0) > 0.01;

      let matchGstType = true;
      if (gstTypeFilter === "intra") matchGstType = !inv.isIgst;
      else if (gstTypeFilter === "inter") matchGstType = !!inv.isIgst;

      let matchDate = true;
      if (dateFrom) {
        const fromTs = new Date(dateFrom).getTime();
        if (inv.date < fromTs) matchDate = false;
      }
      if (dateTo) {
        const toTs = new Date(dateTo).setHours(23, 59, 59, 999);
        if (inv.date > toTs) matchDate = false;
      }

      return matchSearch && matchCustomer && matchStatus && matchGstType && matchDate;
    });
  }, [invoices, customerMap, search, customerFilter, statusFilter, gstTypeFilter, dateFrom, dateTo]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalGst = 0;
    let totalGross = 0;
    let totalBalance = 0;

    for (const inv of filteredInvoices) {
      const taxable = inv.taxableAmount ?? (inv.subtotal - (inv.discountTotal || 0));
      totalTaxable += taxable;
      totalCgst += inv.cgstTotal || 0;
      totalSgst += inv.sgstTotal || 0;
      totalIgst += inv.igstTotal || 0;
      totalGst += inv.gstTotal || 0;
      totalGross += inv.grandTotal || 0;
      totalBalance += inv.balance || 0;
    }

    return {
      count: filteredInvoices.length,
      totalTaxable,
      totalCgst,
      totalSgst,
      totalIgst,
      totalGst,
      totalGross,
      totalBalance,
    };
  }, [filteredInvoices]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredInvoices.map((inv, idx) => {
        const cust = customerMap.get(inv.customerId) || inv.customerSnapshot;
        const taxable = inv.taxableAmount ?? (inv.subtotal - (inv.discountTotal || 0));
        return {
          "S.No": idx + 1,
          "Invoice Date": formatDate(inv.date),
          "Invoice No": inv.number,
          "Customer Name": cust?.name || "Cash Customer",
          "Customer GSTIN": cust?.gstin || "-",
          "Place of Supply": inv.placeOfSupply || "-",
          "GST Treatment": inv.isIgst ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)",
          "Taxable Amount": Math.round(taxable * 100) / 100,
          "CGST Amount": Math.round((inv.cgstTotal || 0) * 100) / 100,
          "SGST Amount": Math.round((inv.sgstTotal || 0) * 100) / 100,
          "IGST Amount": Math.round((inv.igstTotal || 0) * 100) / 100,
          "Total GST": Math.round((inv.gstTotal || 0) * 100) / 100,
          "Round Off": inv.roundOff || 0,
          "Invoice Total": Math.round(inv.grandTotal * 100) / 100,
          "Amount Received": Math.round((inv.amountPaid || 0) * 100) / 100,
          "Balance Due": Math.round((inv.balance || 0) * 100) / 100,
          "Status": (inv.balance || 0) <= 0.01 ? "PAID" : (inv.amountPaid || 0) > 0 ? "PARTIAL" : "UNPAID",
        };
      });

      // Add Total Row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Invoice Date": "",
        "Invoice No": "",
        "Customer Name": `Count: ${metrics.count}`,
        "Customer GSTIN": "",
        "Place of Supply": "",
        "GST Treatment": "",
        "Taxable Amount": Math.round(metrics.totalTaxable * 100) / 100,
        "CGST Amount": Math.round(metrics.totalCgst * 100) / 100,
        "SGST Amount": Math.round(metrics.totalSgst * 100) / 100,
        "IGST Amount": Math.round(metrics.totalIgst * 100) / 100,
        "Total GST": Math.round(metrics.totalGst * 100) / 100,
        "Round Off": 0,
        "Invoice Total": Math.round(metrics.totalGross * 100) / 100,
        "Amount Received": Math.round((metrics.totalGross - metrics.totalBalance) * 100) / 100,
        "Balance Due": Math.round(metrics.totalBalance * 100) / 100,
        "Status": "",
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sales Register");
      XLSX.writeFile(wb, `Sales_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Sales Register exported to Excel");
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
            <span className="text-xs font-medium">Total Invoices</span>
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {metrics.count}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Invoices in period</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Taxable Base</span>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {formatMoney(metrics.totalTaxable)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Pre-tax sales value</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Output GST (Total)</span>
            <Layers className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {formatMoney(metrics.totalGst)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-1.5">
            <span>C+S: {formatMoney(metrics.totalCgst + metrics.totalSgst)}</span>
            <span>|</span>
            <span>IGST: {formatMoney(metrics.totalIgst)}</span>
          </div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Gross Sales Value</span>
            <IndianRupee className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalGross)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Balance Due: <span className="font-semibold text-rose-500">{formatMoney(metrics.totalBalance)}</span>
          </div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoice #, customer, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>

            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[170px] h-9 text-xs">
                <SelectValue placeholder="Customer: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={gstTypeFilter} onValueChange={setGstTypeFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="GST Type: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All GST Types</SelectItem>
                <SelectItem value="intra">Intra-State (CGST+SGST)</SelectItem>
                <SelectItem value="inter">Inter-State (IGST)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Payment: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="paid">Fully Paid</SelectItem>
                <SelectItem value="partial">Partially Paid</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
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

            <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs ml-auto">
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export to Excel</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Sales Register Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer Name & GSTIN</TableHead>
                <TableHead className="text-right">Taxable (₹)</TableHead>
                <TableHead className="text-right">CGST (₹)</TableHead>
                <TableHead className="text-right">SGST (₹)</TableHead>
                <TableHead className="text-right">IGST (₹)</TableHead>
                <TableHead className="text-right font-semibold">Total (₹)</TableHead>
                <TableHead className="text-right">Balance (₹)</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Invoices Found in Register</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Change filters or record new sales invoices to populate register.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredInvoices.map((inv, idx) => {
                  const cust = customerMap.get(inv.customerId) || inv.customerSnapshot;
                  const custName = cust?.name || "Cash Customer";
                  const gstin = cust?.gstin || "";
                  const taxable = inv.taxableAmount ?? (inv.subtotal - (inv.discountTotal || 0));
                  const isPaid = (inv.balance || 0) <= 0.01;
                  const isPartial = !isPaid && (inv.amountPaid || 0) > 0;

                  return (
                    <TableRow key={inv.id} className="hover:bg-secondary/30 transition-colors">
                      <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(inv.date)}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => navigate({ to: "/invoices" })}
                          className="font-semibold text-primary hover:underline text-left"
                        >
                          {inv.number}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{custName}</div>
                        {gstin && <div className="text-[10px] font-mono text-muted-foreground">{gstin}</div>}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(taxable)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {inv.cgstTotal ? formatMoney(inv.cgstTotal) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {inv.sgstTotal ? formatMoney(inv.sgstTotal) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {inv.igstTotal ? formatMoney(inv.igstTotal) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {formatMoney(inv.grandTotal)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {inv.balance && inv.balance > 0.01 ? (
                          <span className="text-rose-600 dark:text-rose-400">{formatMoney(inv.balance)}</span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">0.00</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {isPaid ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Paid
                          </Badge>
                        ) : isPartial ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            Partial
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            Unpaid
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
