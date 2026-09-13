import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, type Invoice, type Purchase, type Product, type Customer, type Supplier, type Receipt, type Party } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Printer, HandCoins, Clock, ShieldCheck } from "lucide-react";
import { formatDate, formatMoney, toDateInput, fromDateInput } from "@/lib/format";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — Business Management" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [from, setFrom] = useState<number | undefined>(undefined);
  const [to, setTo] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("tab") || "sales";
    }
    return "sales";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const queryTab = p.get("tab");
    if (queryTab && queryTab !== tab) {
      setTab(queryTab);
    }
  }, []);

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", nextTab);
      window.history.replaceState(null, "", url.toString());
    }
  };

  return (
    <AppShell title="Reports">
      <PageHeader title="Business Reports" description="Filter by date range, print or export as JSON." />
      <Card className="card-soft mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={from ? toDateInput(from) : ""} onChange={e => setFrom(e.target.value ? fromDateInput(e.target.value) : undefined)} /></div>
        <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={to ? toDateInput(to) : ""} onChange={e => setTo(e.target.value ? fromDateInput(e.target.value) : undefined)} /></div>
        <Button variant="outline" onClick={() => { setFrom(undefined); setTo(undefined); }}>Clear</Button>
        <Button variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
      </Card>
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="outstanding">Credit Outstanding & Aging</TabsTrigger>
          <TabsTrigger value="advances">Customer Advances</TabsTrigger>
          <TabsTrigger value="supplier-advances">Supplier Advances</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="profit">Profit</TabsTrigger>
          <TabsTrigger value="gst">GST</TabsTrigger>
        </TabsList>
        <TabsContent value="sales"><SalesReport from={from} to={to} /></TabsContent>
        <TabsContent value="purchases"><PurchaseReport from={from} to={to} /></TabsContent>
        <TabsContent value="outstanding"><OutstandingReport /></TabsContent>
        <TabsContent value="advances"><CustomerAdvanceRegisterReport /></TabsContent>
        <TabsContent value="supplier-advances"><SupplierAdvanceRegisterReport /></TabsContent>
        <TabsContent value="stock"><StockReport /></TabsContent>
        <TabsContent value="profit"><ProfitReport from={from} to={to} /></TabsContent>
        <TabsContent value="gst"><GstReport from={from} to={to} /></TabsContent>
      </Tabs>
    </AppShell>
  );
}

function useRange<T extends { date: number }>(rows: T[], from?: number, to?: number) {
  return useMemo(() => rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to)), [rows, from, to]);
}

function ExportBtn({ name, data }: { name: string; data: unknown }) {
  return <Button size="sm" variant="outline" className="gap-2" onClick={() => {
    const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }}><Download className="h-4 w-4" /> Export JSON</Button>;
}

function SalesReport({ from, to }: { from?: number; to?: number }) {
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const rows = useRange(invoices, from, to);
  const total = rows.reduce((s, i) => s + i.grandTotal, 0);
  return (
    <Card className="card-soft mt-4 p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Sales Report</h3><ExportBtn name="sales.json" data={rows} /></div>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">GST</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(i => (<TableRow key={i.id}><TableCell>{formatDate(i.date)}</TableCell><TableCell className="font-mono text-xs">{i.number}</TableCell><TableCell>{customers.find(c => c.id === i.customerId)?.name ?? "—"}</TableCell><TableCell className="text-right font-mono">{formatMoney(i.subtotal - i.discountTotal)}</TableCell><TableCell className="text-right font-mono">{formatMoney(i.gstTotal)}</TableCell><TableCell className="text-right font-mono">{formatMoney(i.grandTotal)}</TableCell></TableRow>))}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No sales in this period.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="mt-3 flex justify-end text-sm">Total Sales: <b className="ml-2 font-mono">{formatMoney(total)}</b></div>
    </Card>
  );
}

function PurchaseReport({ from, to }: { from?: number; to?: number }) {
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());
  const rows = useRange(purchases, from, to);
  const total = rows.reduce((s, i) => s + i.grandTotal, 0);
  return (
    <Card className="card-soft mt-4 p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Purchase Report</h3><ExportBtn name="purchases.json" data={rows} /></div>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>BMS Bill #</TableHead><TableHead>Supplier Inv #</TableHead><TableHead>Supplier Inv Date</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(i => (<TableRow key={i.id}><TableCell>{formatDate(i.date)}</TableCell><TableCell className="font-mono text-xs">{i.number}</TableCell><TableCell className="font-mono text-xs font-semibold text-primary">{i.supplierInvoiceNumber || "—"}</TableCell><TableCell className="text-xs">{i.supplierInvoiceDate ? formatDate(i.supplierInvoiceDate) : "—"}</TableCell><TableCell>{suppliers.find(c => c.id === i.supplierId)?.name ?? i.supplierSnapshot?.name ?? "—"}</TableCell><TableCell className="text-right font-mono">{formatMoney(i.grandTotal)}</TableCell></TableRow>))}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No purchases.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="mt-3 flex justify-end text-sm">Total Purchases: <b className="ml-2 font-mono">{formatMoney(total)}</b></div>
    </Card>
  );
}

function OutstandingReport() {
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  const recv = useMemo(() => {
    const now = Date.now();
    return invoices
      .filter((i) => i.balance > 0.01 && i.status !== "cancelled")
      .map((i) => {
        const cust = customers.find((c) => c.id === i.customerId);
        const refDate = i.dueDate || i.date;
        const ageDays = Math.max(0, Math.floor((now - refDate) / (1000 * 60 * 60 * 24)));
        const creditDays = cust?.creditDays ?? (i.dueDate ? Math.round((i.dueDate - i.date) / (1000 * 60 * 60 * 24)) : 30);
        return {
          ...i,
          customerName: cust?.name || "Customer",
          creditDays,
          ageDays,
        };
      });
  }, [invoices, customers]);

  const pay = purchases.filter((p) => p.balance > 0.01);

  // Aging buckets (PRD § 94)
  const aging = useMemo(() => {
    let b0_30 = 0;
    let b31_60 = 0;
    let b61_90 = 0;
    let b90_plus = 0;

    for (const inv of recv) {
      if (inv.ageDays <= 30) b0_30 += inv.balance;
      else if (inv.ageDays <= 60) b31_60 += inv.balance;
      else if (inv.ageDays <= 90) b61_90 += inv.balance;
      else b90_plus += inv.balance;
    }
    return { b0_30, b31_60, b61_90, b90_plus, total: b0_30 + b31_60 + b61_90 + b90_plus };
  }, [recv]);

  return (
    <div className="mt-4 space-y-4">
      {/* Receivable Aging Summary Cards (PRD § 94) */}
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-emerald-600" /> Current (0–30 Days)
          </div>
          <div className="font-mono text-base font-bold text-foreground mt-1">{formatMoney(aging.b0_30)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-blue-600" /> 31–60 Days
          </div>
          <div className="font-mono text-base font-bold text-foreground mt-1">{formatMoney(aging.b31_60)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-600" /> 61–90 Days
          </div>
          <div className="font-mono text-base font-bold text-amber-600 dark:text-amber-400 mt-1">{formatMoney(aging.b61_90)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-destructive" /> Over 90+ Days
          </div>
          <div className="font-mono text-base font-bold text-destructive mt-1">{formatMoney(aging.b90_plus)}</div>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="text-xs text-primary font-medium">Total Receivables</div>
          <div className="font-mono text-base font-bold text-primary mt-1">{formatMoney(aging.total)}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-soft p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Credit Receivables Register (PRD § 93)</h3>
              <p className="text-[11px] text-muted-foreground">Detailed bill-wise aging and due dates</p>
            </div>
            <ExportBtn name="receivables.json" data={recv} />
          </div>
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recv.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs font-semibold">{i.number}</TableCell>
                    <TableCell className="text-xs font-medium">{i.customerName}</TableCell>
                    <TableCell className="text-xs">{i.dueDate ? formatDate(i.dueDate) : formatDate(i.date)}</TableCell>
                    <TableCell className={`text-right font-mono text-xs ${i.ageDays > 60 ? "text-destructive font-bold" : i.ageDays > 30 ? "text-amber-600 font-semibold" : ""}`}>
                      {i.ageDays}d
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(i.grandTotal)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-foreground">{formatMoney(i.balance)}</TableCell>
                  </TableRow>
                ))}
                {recv.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                      No overdue credit receivables.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className="card-soft p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Supplier Payables</h3>
              <p className="text-[11px] text-muted-foreground">Vendor bills awaiting settlement</p>
            </div>
            <ExportBtn name="payables.json" data={pay} />
          </div>
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs font-semibold">{i.number}</TableCell>
                    <TableCell className="text-xs font-medium">{suppliers.find((c) => c.id === i.supplierId)?.name || "Vendor"}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{formatMoney(i.balance)}</TableCell>
                  </TableRow>
                ))}
                {pay.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      Nothing owed.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CustomerAdvanceRegisterReport() {
  const receipts = useLive<Receipt>(() => db().receipts.toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());

  // Derive per-customer advance summary (PRD § 92)
  const rows = useMemo(() => {
    return customers.map((c) => {
      const custReceipts = receipts.filter(
        (r) => r.customerId === c.id && r.postingStatus !== "failed" && r.postingStatus !== "reversed"
      );
      const advanceReceipts = custReceipts.filter(
        (r) => r.allocationType === "ADVANCE" || !r.invoiceId
      );
      const totalAdvanceReceived = advanceReceipts.reduce(
        (s, r) => s + Math.max(0, (Number(r.amount) || 0) - ((r.refundAmountPaise || 0) / 100)),
        0
      );

      const custInvoices = invoices.filter(
        (i) => i.customerId === c.id && i.status !== "cancelled"
      );
      const totalAdvanceAdjusted = custInvoices.reduce(
        (s, i) => s + ((i.advanceAllocatedPaise || 0) / 100),
        0
      );

      const availableAdvance = Math.max(0, totalAdvanceReceived - totalAdvanceAdjusted);
      const lastReceipt = advanceReceipts.sort((a, b) => b.date - a.date)[0];
      const references = advanceReceipts
        .map((r) => r.reference || r.number)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");

      return {
        customer: c,
        paymentPolicy: c.paymentPolicy || "CREDIT",
        totalAdvanceReceived,
        totalAdvanceAdjusted,
        availableAdvance,
        lastReceiptDate: lastReceipt?.date,
        reference: references || "—",
      };
    }).filter((r) => r.totalAdvanceReceived > 0 || r.availableAdvance > 0 || r.paymentPolicy === "ADVANCE");
  }, [customers, receipts, invoices]);

  const totalReceived = rows.reduce((s, r) => s + r.totalAdvanceReceived, 0);
  const totalAdjusted = rows.reduce((s, r) => s + r.totalAdvanceAdjusted, 0);
  const totalAvailable = rows.reduce((s, r) => s + r.availableAdvance, 0);

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Customer Advance Register
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tally-style unapplied customer deposits and voucher allocation tracking (PRD § 92)
          </p>
        </div>
        <ExportBtn name="customer-advance-register.json" data={rows} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total Advances Received</div>
          <div className="font-mono text-lg font-bold text-foreground mt-1">{formatMoney(totalReceived)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Adjusted Against Invoices</div>
          <div className="font-mono text-lg font-bold text-muted-foreground mt-1">{formatMoney(totalAdjusted)}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
          <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Net Available Unapplied Advance</div>
          <div className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatMoney(totalAvailable)}</div>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party / Customer</TableHead>
              <TableHead>Billing Policy</TableHead>
              <TableHead className="text-right">Advance Received</TableHead>
              <TableHead className="text-right">Adjusted</TableHead>
              <TableHead className="text-right">Available Advance</TableHead>
              <TableHead>Last Receipt</TableHead>
              <TableHead>Reference(s)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                  No advance receipts recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.customer.id}>
                  <TableCell className="font-medium">
                    <Link to="/parties" className="text-primary hover:underline">
                      {r.customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      r.paymentPolicy === "ADVANCE"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-400"
                    }`}>
                      {r.paymentPolicy}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(r.totalAdvanceReceived)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatMoney(r.totalAdvanceAdjusted)}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {formatMoney(r.availableAdvance)}
                  </TableCell>
                  <TableCell className="text-xs">{r.lastReceiptDate ? formatDate(r.lastReceiptDate) : "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.reference}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function SupplierAdvanceRegisterReport() {
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  // Supplier advances derived from payments/purchases (strictly isolated from Customer AR)
  const rows = useMemo(() => {
    return suppliers.map((s) => {
      const suppPurchases = purchases.filter(
        (p) => p.supplierId === s.id && p.postingStatus !== "failed" && p.postingStatus !== "reversed"
      );
      const totalPurchased = suppPurchases.reduce((sum, p) => sum + (p.grandTotal || 0), 0);
      const totalPaid = suppPurchases.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
      const payableDue = suppPurchases.reduce((sum, p) => sum + Math.max(0, p.balance || 0), 0);
      const supplierAdvance = Math.max(0, totalPaid - totalPurchased);

      return {
        supplier: s,
        totalPurchased,
        totalPaid,
        payableDue,
        supplierAdvance,
      };
    }).filter((r) => r.totalPurchased > 0 || r.totalPaid > 0 || r.supplierAdvance > 0);
  }, [suppliers, purchases]);

  const totalPurchased = rows.reduce((sum, r) => sum + r.totalPurchased, 0);
  const totalPaid = rows.reduce((sum, r) => sum + r.totalPaid, 0);
  const totalAdvance = rows.reduce((sum, r) => sum + r.supplierAdvance, 0);

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Supplier Advance Register
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vendor prepayments and unapplied supplier advances (strictly isolated from Accounts Receivable)
          </p>
        </div>
        <ExportBtn name="supplier-advance-register.json" data={rows} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total Vendor Purchases</div>
          <div className="font-mono text-lg font-bold text-foreground mt-1">{formatMoney(totalPurchased)}</div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total Paid to Vendors</div>
          <div className="font-mono text-lg font-bold text-muted-foreground mt-1">{formatMoney(totalPaid)}</div>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-50/40 dark:bg-blue-950/20 p-3">
          <div className="text-xs text-blue-700 dark:text-blue-400 font-medium">Net Supplier Prepayments</div>
          <div className="font-mono text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">{formatMoney(totalAdvance)}</div>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor / Supplier</TableHead>
              <TableHead className="text-right">Total Bills</TableHead>
              <TableHead className="text-right">Total Paid</TableHead>
              <TableHead className="text-right">Payable Outstanding</TableHead>
              <TableHead className="text-right">Supplier Advance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                  No vendor prepayments recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.supplier.id}>
                  <TableCell className="font-medium">
                    <Link to="/parties" className="text-primary hover:underline">
                      {r.supplier.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(r.totalPurchased)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatMoney(r.totalPaid)}</TableCell>
                  <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400 font-semibold">{formatMoney(r.payableDue)}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                    {formatMoney(r.supplierAdvance)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function StockReport() {
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const value = products.reduce((s, p) => s + p.currentStock * p.purchasePrice, 0);
  return (
    <Card className="card-soft mt-4 p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Stock Report</h3><ExportBtn name="stock.json" data={products} /></div>
      <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>HSN</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>
          {products.map(p => (<TableRow key={p.id}><TableCell>{p.name}</TableCell><TableCell className="font-mono text-xs">{p.hsn}</TableCell><TableCell className={`text-right font-mono ${p.currentStock <= p.reorderLevel ? "text-amber-600 font-semibold" : ""}`}>{p.currentStock} {p.unit}</TableCell><TableCell className="text-right font-mono">{formatMoney(p.purchasePrice)}</TableCell><TableCell className="text-right font-mono">{formatMoney(p.currentStock * p.purchasePrice)}</TableCell></TableRow>))}
        </TableBody>
      </Table>
      <div className="mt-3 flex justify-end text-sm">Total Stock Value: <b className="ml-2 font-mono">{formatMoney(value)}</b></div>
    </Card>
  );
}

function ProfitReport({ from, to }: { from?: number; to?: number }) {
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const products = useLive<Product>(() => db().products.toArray());
  const invRange = useRange(invoices, from, to);
  const purRange = useRange(purchases, from, to);

  const revenue = invRange.reduce((s, i) => s + (i.subtotal - i.discountTotal), 0);
  const cost = invRange.reduce((s, i) => s + i.items.reduce((ss, it) => ss + (products.find(p => p.id === it.productId)?.purchasePrice ?? 0) * it.quantity, 0), 0);
  const gross = revenue - cost;
  const purchaseTotal = purRange.reduce((s, p) => s + p.grandTotal, 0);

  return (
    <Card className="card-soft mt-4 p-4">
      <h3 className="mb-3 font-semibold">Profit Summary</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Revenue (net)" v={formatMoney(revenue)} />
        <Stat label="Cost of Sales" v={formatMoney(cost)} />
        <Stat label="Gross Profit" v={formatMoney(gross)} accent />
        <Stat label="Purchases" v={formatMoney(purchaseTotal)} />
      </div>
    </Card>
  );
}

function GstReport({ from, to }: { from?: number; to?: number }) {
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  // PRD Correction 12: GST registers must derive strictly from authoritative POSTED documents
  // Exclude Drafts, Pending Sync, and Cancelled unposted documents
  const postedInvoices = useMemo(
    () => invoices.filter((i) => i.postingStatus === "posted" || (i.status as string) === "posted" || i.status === "paid" || i.status === "partial"),
    [invoices]
  );
  const postedPurchases = useMemo(
    () => purchases.filter((p) => p.postingStatus === "posted" || (p.status as string) === "posted" || p.status === "paid" || p.status === "partial"),
    [purchases]
  );

  const invRows = useRange(postedInvoices, from, to);
  const purRows = useRange(postedPurchases, from, to);

  const taxableSales = invRows.reduce((s, i) => s + (i.subtotal - i.discountTotal), 0);
  const cgst = invRows.reduce((s, i) => s + (i.cgstTotal || (i.gstTotal ? i.gstTotal / 2 : 0)), 0);
  const sgst = invRows.reduce((s, i) => s + (i.sgstTotal || (i.gstTotal ? i.gstTotal / 2 : 0)), 0);
  const igst = invRows.reduce((s, i) => s + (i.igstTotal || 0), 0);
  const outputGstTotal = cgst + sgst + igst;

  const taxablePurchases = purRows.reduce((s, p) => s + (p.subtotal - p.discountTotal), 0);
  const inputGstTotal = purRows.reduce((s, p) => s + (p.gstTotal || 0), 0);

  const netGstPosition = outputGstTotal - inputGstTotal;

  type GstTx = {
    id: string;
    type: "Sale" | "Purchase";
    date: number;
    docNumber: string;
    supplierInvoiceNumber?: string;
    supplierInvoiceDate?: number | string;
    partyName: string;
    gstin: string;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    link: string;
  };

  const transactions: GstTx[] = [
    ...invRows.map((i): GstTx => {
      const cust = customers.find((c) => c.id === i.customerId);
      const c = i.cgstTotal || (i.gstTotal ? i.gstTotal / 2 : 0);
      const s = i.sgstTotal || (i.gstTotal ? i.gstTotal / 2 : 0);
      const g = i.igstTotal || 0;
      return {
        id: i.id,
        type: "Sale",
        date: i.date,
        docNumber: i.number,
        partyName: i.customerSnapshot?.name || cust?.name || "Customer",
        gstin: i.customerSnapshot?.gstin || cust?.gstin || "—",
        taxable: i.subtotal - i.discountTotal,
        cgst: c,
        sgst: s,
        igst: g,
        totalTax: i.gstTotal,
        link: `/invoices?q=${encodeURIComponent(i.number)}`,
      };
    }),
    ...purRows.map((p): GstTx => {
      const supp = suppliers.find((s) => s.id === p.supplierId);
      const c = p.cgstTotal || (p.gstTotal ? p.gstTotal / 2 : 0);
      const s = p.sgstTotal || (p.gstTotal ? p.gstTotal / 2 : 0);
      const g = p.igstTotal || 0;
      return {
        id: p.id,
        type: "Purchase",
        date: p.date,
        docNumber: p.number,
        supplierInvoiceNumber: p.supplierInvoiceNumber,
        supplierInvoiceDate: p.supplierInvoiceDate,
        partyName: p.supplierSnapshot?.name || supp?.name || "Supplier",
        gstin: p.supplierSnapshot?.gstin || supp?.gstin || "—",
        taxable: p.subtotal - p.discountTotal,
        cgst: c,
        sgst: s,
        igst: g,
        totalTax: p.gstTotal,
        link: `/purchases?q=${encodeURIComponent(p.supplierInvoiceNumber || p.number)}`,
      };
    }),
  ].sort((a, b) => b.date - a.date);

  return (
    <div className="mt-4 space-y-4">
      {/* Statutory Preparation & Summary Disclaimer (Correction 13) */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <strong className="block font-semibold">PREPARATION / SUMMARY REPORTS</strong>
        <span>Prepared from BMS records. Verify before statutory filing. GSTR summary reports are for reconciliation and preparation only.</span>
      </div>

      <Card className="card-soft p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">GST Statutory Position & Summary</h3>
            <p className="text-xs text-muted-foreground">Output Tax Collected vs Recorded Input GST</p>
          </div>
          <ExportBtn name="gst_register.json" data={{ summary: { outputGstTotal, inputGstTotal, netGstPosition }, transactions }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Output GST (Collected)" v={formatMoney(outputGstTotal)} accent />
          <Stat label="Recorded Input GST" v={formatMoney(inputGstTotal)} />
          <Stat
            label={netGstPosition >= 0 ? "Net GST Payable" : "Net ITC Carry Forward"}
            v={formatMoney(Math.abs(netGstPosition))}
            accent={netGstPosition > 0}
          />
          <Stat label="Taxable Turnover" v={formatMoney(taxableSales)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground border-t pt-3">
          <span>CGST Output: <strong className="font-mono text-foreground">{formatMoney(cgst)}</strong></span>
          <span>•</span>
          <span>SGST Output: <strong className="font-mono text-foreground">{formatMoney(sgst)}</strong></span>
          <span>•</span>
          <span>IGST Output: <strong className="font-mono text-foreground">{formatMoney(igst)}</strong></span>
        </div>
      </Card>

      <Card className="card-soft p-4">
        <div className="mb-3">
          <h3 className="font-semibold text-foreground">GST Transaction Register</h3>
          <p className="text-xs text-muted-foreground">Click any document number to open and inspect the source invoice or bill.</p>
        </div>
        <div className="overflow-x-auto scrollbar-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Doc #</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right font-semibold">Total Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium uppercase ${
                      tx.type === "Sale" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    }`}>
                      {tx.type}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link to={tx.link as any} className="text-primary underline hover:text-primary/80">
                      {tx.docNumber}
                    </Link>
                    {tx.supplierInvoiceNumber && (
                      <div className="text-[10px] text-muted-foreground font-sans">
                        Inv: <span className="font-mono font-semibold text-foreground">{tx.supplierInvoiceNumber}</span>
                        {tx.supplierInvoiceDate ? ` (${formatDate(tx.supplierInvoiceDate)})` : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{tx.partyName}</TableCell>
                  <TableCell className="font-mono text-xs">{tx.gstin}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.taxable)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.cgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.sgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.igst)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatMoney(tx.totalTax)}</TableCell>
                </TableRow>
              ))}
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                    No GST transactions found in selected period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${accent ? "bg-primary/10" : "bg-muted/30"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{v}</div>
    </div>
  );
}
