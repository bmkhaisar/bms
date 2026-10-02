import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, RotateCcw, CheckCircle2, TrendingDown, Layers, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type SalesReturn, type Customer } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";

export function SalesReturnRegisterView() {
  const navigate = useNavigate();
  const salesReturns = useLive<SalesReturn>(() => db().salesReturns.orderBy("date").reverse().toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  const uniqueReasons = useMemo(() => {
    const set = new Set<string>();
    salesReturns.forEach((sr) => {
      if (sr.reason) set.add(sr.reason);
    });
    return Array.from(set).sort();
  }, [salesReturns]);

  const filteredReturns = useMemo(() => {
    return salesReturns.filter((sr) => {
      if (sr.status === "cancelled" || sr.status === "deleted") return false;

      const cust = customerMap.get(sr.customerId) || sr.customerSnapshot;
      const custName = cust?.name || "Customer";
      const q = search.toLowerCase();

      const matchSearch =
        !search ||
        sr.number.toLowerCase().includes(q) ||
        (sr.creditNoteNumber && sr.creditNoteNumber.toLowerCase().includes(q)) ||
        (sr.originalInvoiceNumber && sr.originalInvoiceNumber.toLowerCase().includes(q)) ||
        custName.toLowerCase().includes(q) ||
        (sr.reason && sr.reason.toLowerCase().includes(q));

      const matchCustomer = customerFilter === "all" || sr.customerId === customerFilter;
      const matchReason = reasonFilter === "all" || sr.reason === reasonFilter;

      let matchDate = true;
      if (dateFrom) {
        const fromTs = new Date(dateFrom).getTime();
        if (sr.date < fromTs) matchDate = false;
      }
      if (dateTo) {
        const toTs = new Date(dateTo).setHours(23, 59, 59, 999);
        if (sr.date > toTs) matchDate = false;
      }

      return matchSearch && matchCustomer && matchReason && matchDate;
    });
  }, [salesReturns, customerMap, search, customerFilter, reasonFilter, dateFrom, dateTo]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalGst = 0;
    let totalGrand = 0;

    for (const sr of filteredReturns) {
      totalTaxable += sr.taxableAmount || 0;
      totalCgst += sr.cgstTotal || 0;
      totalSgst += sr.sgstTotal || 0;
      totalIgst += sr.igstTotal || 0;
      totalGst += sr.gstTotal || 0;
      totalGrand += sr.grandTotal || 0;
    }

    return {
      count: filteredReturns.length,
      totalTaxable,
      totalCgst,
      totalSgst,
      totalIgst,
      totalGst,
      totalGrand,
    };
  }, [filteredReturns]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredReturns.map((sr, idx) => {
        const cust = customerMap.get(sr.customerId) || sr.customerSnapshot;
        return {
          "S.No": idx + 1,
          "Return Date": formatDate(sr.date),
          "Return Voucher No": sr.number,
          "Credit Note No": sr.creditNoteNumber || "-",
          "Original Invoice No": sr.originalInvoiceNumber || "-",
          "Original Inv Date": sr.originalInvoiceDate ? formatDate(sr.originalInvoiceDate) : "-",
          "Customer Name": cust?.name || "Customer",
          "Customer GSTIN": cust?.gstin || "-",
          "Return Type": sr.returnType || "FULL",
          "Reason": sr.reason || "-",
          "Taxable Amount": Math.round((sr.taxableAmount || 0) * 100) / 100,
          "CGST Reversal": Math.round((sr.cgstTotal || 0) * 100) / 100,
          "SGST Reversal": Math.round((sr.sgstTotal || 0) * 100) / 100,
          "IGST Reversal": Math.round((sr.igstTotal || 0) * 100) / 100,
          "Total GST Reversed": Math.round((sr.gstTotal || 0) * 100) / 100,
          "Round Off": sr.roundOff || 0,
          "Total CN Value": Math.round((sr.grandTotal || 0) * 100) / 100,
          "Posting Status": sr.status?.toUpperCase() || "POSTED",
        };
      });

      // Total row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Return Date": "",
        "Return Voucher No": "",
        "Credit Note No": "",
        "Original Invoice No": "",
        "Original Inv Date": "",
        "Customer Name": `Count: ${metrics.count}`,
        "Customer GSTIN": "",
        "Return Type": "" as unknown as "FULL" | "PARTIAL",
        "Reason": "",
        "Taxable Amount": Math.round(metrics.totalTaxable * 100) / 100,
        "CGST Reversal": Math.round(metrics.totalCgst * 100) / 100,
        "SGST Reversal": Math.round(metrics.totalSgst * 100) / 100,
        "IGST Reversal": Math.round(metrics.totalIgst * 100) / 100,
        "Total GST Reversed": Math.round(metrics.totalGst * 100) / 100,
        "Round Off": 0,
        "Total CN Value": Math.round(metrics.totalGrand * 100) / 100,
        "Posting Status": "",
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sales Return Register");
      XLSX.writeFile(wb, `Sales_Return_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Sales Return Register exported to Excel");
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
            <span className="text-xs font-medium">Return Notes</span>
            <RotateCcw className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {metrics.count}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Returns in period</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Taxable Reversed</span>
            <TrendingDown className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {formatMoney(metrics.totalTaxable)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Sales reduction value</div>
        </Card>

        <Card className="p-3.5 border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">GST Output Reversed</span>
            <Layers className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
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
            <span className="text-xs font-medium">Total Credit Value</span>
            <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(metrics.totalGrand)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Customer credits issued</div>
        </Card>
      </div>

      {/* Filter and Action Bar */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search return #, CN #, invoice #, customer..."
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

            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="Reason: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Reasons</SelectItem>
                {uniqueReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
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

            <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs ml-auto">
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export to Excel</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Return # / CN #</TableHead>
                <TableHead>Original Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Taxable (₹)</TableHead>
                <TableHead className="text-right">GST Reversed (₹)</TableHead>
                <TableHead className="text-right font-semibold">Credit Value (₹)</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredReturns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Sales Returns Recorded</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      No customer return notes or credit notes found in the selected range.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredReturns.map((sr, idx) => {
                  const cust = customerMap.get(sr.customerId) || sr.customerSnapshot;
                  return (
                    <TableRow key={sr.id} className="hover:bg-secondary/30 transition-colors">
                      <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(sr.date)}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => navigate({ to: "/sales-returns" })}
                          className="font-semibold text-primary hover:underline text-left block"
                        >
                          {sr.number}
                        </button>
                        {sr.creditNoteNumber && (
                          <div className="text-[10px] text-muted-foreground font-mono">
                            CN: {sr.creditNoteNumber}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{sr.originalInvoiceNumber || "-"}</div>
                        {sr.originalInvoiceDate && (
                          <div className="text-[10px] text-muted-foreground">
                            {formatDate(sr.originalInvoiceDate)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{cust?.name || "Customer"}</div>
                        {cust?.gstin && (
                          <div className="text-[10px] font-mono text-muted-foreground">{cust.gstin}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {sr.reason || "General Return"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {formatMoney(sr.taxableAmount || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400">
                        {formatMoney(sr.gstTotal || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {formatMoney(sr.grandTotal || 0)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          {sr.status ? sr.status.toUpperCase() : "POSTED"}
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
