import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, ShoppingCart, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type SalesOrder } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

export function SalesOrderBookView() {
  const salesOrders = useLive<SalesOrder>(() => db().salesOrders.orderBy("date").reverse().toArray());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");

  // Unique customers
  const customerNames = useMemo(() => {
    return Array.from(new Set(salesOrders.map((s) => s.customerSnapshot?.name || "Customer"))).sort();
  }, [salesOrders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return salesOrders.filter((so) => {
      if (statusFilter !== "all" && so.status !== statusFilter) return false;
      const custName = so.customerSnapshot?.name || "Customer";
      if (customerFilter !== "all" && custName !== customerFilter) return false;

      if (search) {
        const q = search.toLowerCase();
        const matchesNum = so.number.toLowerCase().includes(q);
        const matchesCust = custName.toLowerCase().includes(q);
        const matchesInv = (so.convertedInvoiceNumber || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesCust && !matchesInv) return false;
      }
      return true;
    });
  }, [salesOrders, statusFilter, customerFilter, search]);

  // Summary KPIs
  const summary = useMemo(() => {
    let totalGross = 0;
    let totalAdvance = 0;
    let openCount = 0;
    let completedCount = 0;

    for (const so of filteredOrders) {
      totalGross += so.grandTotal || 0;
      totalAdvance += so.advanceReceived || 0;
      if (so.status === "open") openCount++;
      if (so.status === "completed") completedCount++;
    }

    return { totalGross, totalAdvance, openCount, completedCount, totalCount: filteredOrders.length };
  }, [filteredOrders]);

  // Export to Excel
  const exportToExcel = () => {
    const data = filteredOrders.map((so) => ({
      "Order Date": formatDate(so.date),
      "SO Number": so.number,
      "Customer Name": so.customerSnapshot?.name || "Customer",
      "Customer GSTIN": so.customerSnapshot?.gstin || "—",
      "Delivery Due Date": so.deliveryDate ? formatDate(so.deliveryDate) : "—",
      "Taxable Value": so.taxableAmount || so.subtotal,
      "GST Total": so.gstTotal,
      "Order Value": so.grandTotal,
      "Advance Received": so.advanceReceived || 0,
      "Status": (so.status || "open").toUpperCase(),
      "Linked Invoice #": so.convertedInvoiceNumber || "—",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Order Book");
    XLSX.writeFile(wb, `Sales_Order_Book_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Sales Order Book exported to Excel");
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Orders Booked</span>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{summary.totalCount}</div>
          <div className="text-[10px] text-muted-foreground">Booked customer orders</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Order Value</span>
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-foreground font-mono">
            {formatMoney(summary.totalGross)}
          </div>
          <div className="text-[10px] text-muted-foreground">Confirmed bookings</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Open (Awaiting Delivery)</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">
            {summary.openCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Pending execution</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Completed / Invoiced</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {summary.completedCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Invoiced orders</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search SO #, customer, invoice..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-44 text-xs h-9">
                <SelectValue placeholder="All Customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customerNames.map((name) => (
                  <SelectItem key={name} value={name} className="text-xs">
                    {name}
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

      {/* Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead>SO Date</TableHead>
                <TableHead>SO Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead className="text-right">Order Value (₹)</TableHead>
                <TableHead className="text-right">Advance (₹)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linked Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No sales orders found matching your filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((so) => (
                  <TableRow key={so.id} className="text-xs hover:bg-secondary/20">
                    <TableCell className="whitespace-nowrap">{formatDate(so.date)}</TableCell>
                    <TableCell className="font-mono font-bold text-primary">{so.number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{so.customerSnapshot?.name || "Customer"}</div>
                    </TableCell>
                    <TableCell>{so.deliveryDate ? formatDate(so.deliveryDate) : "—"}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(so.grandTotal)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">
                      {so.advanceReceived ? formatMoney(so.advanceReceived) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] capitalize ${
                          so.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : so.status === "cancelled"
                            ? "bg-rose-500/10 text-rose-700"
                            : "bg-blue-500/10 text-blue-700"
                        }`}
                      >
                        {so.status || "open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-muted-foreground">
                      {so.convertedInvoiceNumber || "—"}
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
