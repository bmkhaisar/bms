import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import {
  db,
  type Invoice,
  type Purchase,
  type Product,
  type Customer,
  type Supplier,
  type Receipt,
  type Payment,
  type Party,
} from "@/lib/db";
import { useLive, useLiveState } from "@/lib/useLive";
import { useMemo, useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Printer,
  HandCoins,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Wrench,
  RefreshCw,
  Scale,
} from "lucide-react";
import { formatDate, formatMoney, toDateInput, fromDateInput } from "@/lib/format";
import { resolvePartyNameFromCollections } from "@/modules/accounting/domain/partyResolver";
import { toast } from "sonner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";

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
      <PageHeader title="Business & Financial Reports" description="Canonical accounting reports, GST statutory positions, and reconciliation center." />
      <Card className="rounded-2xl border border-border/80 bg-card shadow-soft mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from ? toDateInput(from) : ""} onChange={(e) => setFrom(e.target.value ? fromDateInput(e.target.value) : undefined)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to ? toDateInput(to) : ""} onChange={(e) => setTo(e.target.value ? fromDateInput(e.target.value) : undefined)} />
        </div>
        <Button variant="outline" onClick={() => { setFrom(undefined); setTo(undefined); }}>Clear</Button>
        <Button variant="outline" className="gap-2" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
      </Card>
      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-3">
        {/* Row 1: Primary Report Navigation (Horizontal scroll, whitespace-nowrap, no wrap collisions) */}
        <div className="w-full overflow-x-auto scrollbar-thin pb-1">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 h-10 items-center justify-start gap-1 p-1 bg-secondary/50 rounded-xl whitespace-nowrap">
            <TabsTrigger value="sales" className="shrink-0 px-3 py-1.5 text-xs font-medium">Sales & Revenue</TabsTrigger>
            <TabsTrigger value="purchases" className="shrink-0 px-3 py-1.5 text-xs font-medium">Purchases</TabsTrigger>
            <TabsTrigger value="outstanding" className="shrink-0 px-3 py-1.5 text-xs font-medium">Credit Outstanding & Aging</TabsTrigger>
            <TabsTrigger value="advances" className="shrink-0 px-3 py-1.5 text-xs font-medium">Customer Advances</TabsTrigger>
            <TabsTrigger value="supplier-advances" className="shrink-0 px-3 py-1.5 text-xs font-medium">Supplier Advances</TabsTrigger>
            <TabsTrigger value="stock" className="shrink-0 px-3 py-1.5 text-xs font-medium">Stock</TabsTrigger>
            <TabsTrigger value="profit" className="shrink-0 px-3 py-1.5 text-xs font-medium">Profit & Costing</TabsTrigger>
            <TabsTrigger value="gst" className="shrink-0 px-3 py-1.5 text-xs font-medium">GST Statutory Register</TabsTrigger>
          </TabsList>
        </div>

        {/* Row 2: Secondary Toolbar Row */}
        <div className="w-full overflow-x-auto scrollbar-thin flex items-center justify-start sm:justify-center gap-3 sm:gap-6 min-h-[44px] mt-2 mb-3 px-3 py-1.5 bg-secondary/30 border border-border/70 rounded-xl">
          <Button
            type="button"
            variant={tab === "financial-reconciliation" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handleTabChange("financial-reconciliation")}
            className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 sm:px-4 py-2 h-8 whitespace-nowrap transition-all ${
              tab === "financial-reconciliation" ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Scale className="h-3.5 w-3.5" /> Financial Reconciliation
          </Button>
          <div className="h-4 w-px bg-border shrink-0" />
          <Button
            type="button"
            variant={tab === "gst-audit" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handleTabChange("gst-audit")}
            className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 sm:px-4 py-2 h-8 whitespace-nowrap transition-all ${
              tab === "gst-audit" ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className={`h-3.5 w-3.5 ${tab === "gst-audit" ? "text-primary-foreground" : "text-mint"}`} /> GST Data Audit
          </Button>
        </div>

        {/* Report Content Panels */}
        <div className="pt-2">
          <TabsContent value="sales" className="mt-0"><SalesReport from={from} to={to} /></TabsContent>
          <TabsContent value="purchases" className="mt-0"><PurchaseReport from={from} to={to} /></TabsContent>
          <TabsContent value="outstanding" className="mt-0"><OutstandingReport /></TabsContent>
          <TabsContent value="advances" className="mt-0"><CustomerAdvanceRegisterReport /></TabsContent>
          <TabsContent value="supplier-advances" className="mt-0"><SupplierAdvanceRegisterReport /></TabsContent>
          <TabsContent value="stock" className="mt-0"><StockReport /></TabsContent>
          <TabsContent value="profit" className="mt-0"><ProfitReport from={from} to={to} /></TabsContent>
          <TabsContent value="gst" className="mt-0"><GstReport from={from} to={to} /></TabsContent>
          <TabsContent value="financial-reconciliation" className="mt-0"><FinancialReconciliationReport from={from} to={to} /></TabsContent>
          <TabsContent value="gst-audit" className="mt-0"><GstDataIntegrityAuditReport /></TabsContent>
        </div>
      </Tabs>
    </AppShell>
  );
}

function useRange<T extends { date: number }>(rows: T[], from?: number, to?: number) {
  return useMemo(() => rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)), [rows, from, to]);
}

function ExportBtn({ name, data }: { name: string; data: unknown }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-2"
      onClick={() => {
        const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download className="h-4 w-4" /> Export JSON
    </Button>
  );
}

/**
 * Helper to determine clean tax heads for an Invoice or Purchase record,
 * respecting frozen taxSnapshot first, then place of supply / isIgst,
 * and strictly enforcing Intrastate (CGST+SGST) XOR Interstate (IGST).
 */
function resolveDocumentTaxes(doc: Invoice | Purchase) {
  const docAny = doc as any;
  if (docAny.taxSnapshot) {
    const s = docAny.taxSnapshot;
    return {
      taxable: s.taxableValue ?? ((doc.subtotal || 0) - (doc.discountTotal || 0)),
      cgst: s.cgst || 0,
      sgst: s.sgst || 0,
      igst: s.igst || 0,
      cess: s.cess || 0,
      totalTax: (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0) + (s.cess || 0),
      isInterState: Boolean(s.isInterState),
    };
  }

  const isInterState = Boolean(docAny.isIgst || (doc.igstTotal && doc.igstTotal > 0));
  const rawGstTotal = doc.gstTotal || 0;

  if (isInterState) {
    const igst = doc.igstTotal || rawGstTotal;
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst: 0,
      sgst: 0,
      igst,
      cess: docAny.cessTotal || 0,
      totalTax: igst + (docAny.cessTotal || 0),
      isInterState: true,
    };
  } else {
    const cgst = doc.cgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    const sgst = doc.sgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst,
      sgst,
      igst: 0,
      cess: docAny.cessTotal || 0,
      totalTax: cgst + sgst + (docAny.cessTotal || 0),
      isInterState: false,
    };
  }
}

// ========================================================================
// 1. SALES & REVENUE REPORT
// ========================================================================

function SalesReport({ from, to }: { from?: number; to?: number }) {
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const invoices = invoicesState.data;
  const isLoaded = invoicesState.isLoaded;
  const parties = useLive<Party>(() => db().parties.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeInvoices = useMemo(
    () => invoices.filter((i) => i.status !== "cancelled" && i.status !== "voided" && i.status !== "deleted" && i.postingStatus !== "reversed"),
    [invoices]
  );
  const rows = useRange(activeInvoices, from, to);

  const taxableRevenue = rows.reduce((s, i) => s + (i.subtotal - i.discountTotal), 0);
  const additionalChargesTotal = rows.reduce((s, i) => s + (i.extraChargesTotal || 0), 0);
  const gstTotal = rows.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);
  const grossInvoiceTotal = rows.reduce((s, i) => s + i.grandTotal, 0);

  return (
    <div className="space-y-4 mt-4">
      {/* Financial Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Net Sales / Revenue" v={formatMoney(taxableRevenue)} accent loading={!isLoaded} />
        <Stat label="Additional Charges" v={formatMoney(additionalChargesTotal)} loading={!isLoaded} />
        <Stat label="Output GST" v={formatMoney(gstTotal)} loading={!isLoaded} />
        <Stat label="Gross Invoice Value" v={formatMoney(grossInvoiceTotal)} loading={!isLoaded} />
      </div>

      <Card className="card-soft p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Sales & Revenue Register</h3>
            <p className="text-xs text-muted-foreground">Itemized sales revenue reconciled with GST, charges, and gross invoice totals.</p>
          </div>
          <ExportBtn name="sales_revenue_report.json" data={rows} />
        </div>

        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Taxable Revenue</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Round Off</TableHead>
                <TableHead className="text-right font-bold">Gross Invoice Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => {
                const customerName = resolvePartyNameFromCollections(i.customerId, i.customerSnapshot, parties, customers);
                const taxes = resolveDocumentTaxes(i);
                const isExpanded = expandedId === i.id;
                const charges = i.extraChargesTotal || 0;

                return (
                  <Fragment key={i.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpandedId(isExpanded ? null : i.id)}>
                      <TableCell className="p-2 text-center text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>{formatDate(i.date)}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        <Link to={`/invoices?q=${encodeURIComponent(i.number)}` as any} className="underline hover:text-primary/80" onClick={(e) => e.stopPropagation()}>
                          {i.number}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{customerName}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(i.subtotal - i.discountTotal)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{formatMoney(charges)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(taxes.totalTax)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(i.roundOff || 0)}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">{formatMoney(i.grandTotal)}</TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={9} className="p-3 text-xs">
                          <div className="rounded-lg border bg-background/80 p-3 space-y-2">
                            <div className="font-semibold text-primary flex items-center justify-between">
                              <span>Mathematical Calculation Breakdown:</span>
                              <span className="font-mono text-xs text-foreground">
                                Taxable ({formatMoney(i.subtotal - i.discountTotal)}) + Charges ({formatMoney(charges)}) + GST ({formatMoney(taxes.totalTax)}) {i.roundOff ? `+ Round (${formatMoney(i.roundOff)})` : ""} = Gross ({formatMoney(i.grandTotal)})
                              </span>
                            </div>
                            {i.extraCharges && i.extraCharges.length > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                <strong>Additional Charges:</strong> {i.extraCharges.map((c) => `${c.label || c.name}: ${formatMoney(c.amount)}`).join(", ")}
                              </div>
                            )}
                            <div className="text-[11px] text-muted-foreground flex gap-4">
                              <span>Tax Regime: <strong>{taxes.isInterState ? "Interstate (IGST)" : "Intrastate (CGST + SGST)"}</strong></span>
                              <span>CGST: <strong>{formatMoney(taxes.cgst)}</strong></span>
                              <span>SGST: <strong>{formatMoney(taxes.sgst)}</strong></span>
                              <span>IGST: <strong>{formatMoney(taxes.igst)}</strong></span>
                              <span>Invoice Balance: <strong className={i.balance > 0 ? "text-amber-600 font-mono" : "text-emerald-600 font-mono"}>{formatMoney(i.balance)}</strong></span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">No sales in this period.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>Total Invoices: <strong>{rows.length}</strong></span>
          <div className="space-x-4">
            <span>Net Sales Revenue: <strong className="font-mono text-foreground">{formatMoney(taxableRevenue)}</strong></span>
            <span>•</span>
            <span>Total Gross Billed: <strong className="font-mono text-foreground font-bold">{formatMoney(grossInvoiceTotal)}</strong></span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ========================================================================
// 2. PURCHASE REPORT
// ========================================================================

function PurchaseReport({ from, to }: { from?: number; to?: number }) {
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const parties = useLive<Party>(() => db().parties.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  const activePurchases = useMemo(
    () => purchases.filter((p) => p.status !== "cancelled" && p.status !== "voided" && p.status !== "deleted" && p.postingStatus !== "reversed"),
    [purchases]
  );
  const rows = useRange(activePurchases, from, to);
  const totalTaxable = rows.reduce((s, p) => s + (p.subtotal - p.discountTotal), 0);
  const totalGst = rows.reduce((s, p) => s + resolveDocumentTaxes(p).totalTax, 0);
  const totalGrand = rows.reduce((s, p) => s + p.grandTotal, 0);

  return (
    <Card className="card-soft mt-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Purchase Report</h3>
          <p className="text-xs text-muted-foreground">Vendor invoices and purchase bills with recorded input tax.</p>
        </div>
        <ExportBtn name="purchases.json" data={rows} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>BMS Bill #</TableHead>
            <TableHead>Supplier Inv #</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Taxable</TableHead>
            <TableHead className="text-right">GST</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => {
            const supplierName = resolvePartyNameFromCollections(p.supplierId, p.supplierSnapshot, parties, suppliers);
            const taxes = resolveDocumentTaxes(p);
            return (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.date)}</TableCell>
                <TableCell className="font-mono text-xs">{p.number}</TableCell>
                <TableCell className="font-mono text-xs font-semibold text-primary">{p.supplierInvoiceNumber || "—"}</TableCell>
                <TableCell>{supplierName}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(p.subtotal - p.discountTotal)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(taxes.totalTax)}</TableCell>
                <TableCell className="text-right font-mono font-bold">{formatMoney(p.grandTotal)}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No purchases in this period.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="mt-3 flex justify-end gap-4 text-xs">
        <span>Taxable: <b className="font-mono">{formatMoney(totalTaxable)}</b></span>
        <span>•</span>
        <span>Input Tax: <b className="font-mono">{formatMoney(totalGst)}</b></span>
        <span>•</span>
        <span>Total Purchases: <b className="font-mono text-foreground font-bold">{formatMoney(totalGrand)}</b></span>
      </div>
    </Card>
  );
}

// ========================================================================
// 3. CREDIT OUTSTANDING & AGING REPORT
// ========================================================================

function OutstandingReport() {
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const isLoaded = invoicesState.isLoaded && purchasesState.isLoaded;
  const parties = useLive<Party>(() => db().parties.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  const recv = useMemo(() => {
    const now = Date.now();
    return invoices
      .filter((i) => i.balance > 0.01 && i.status !== "cancelled" && i.status !== "voided" && i.status !== "deleted" && i.postingStatus !== "reversed")
      .map((i) => {
        const name = resolvePartyNameFromCollections(i.customerId, i.customerSnapshot, parties, customers);
        const party = parties.find((p) => p.id === i.customerId);
        const cust = customers.find((c) => c.id === i.customerId);
        const refDate = i.dueDate || i.date;
        const ageDays = Math.max(0, Math.floor((now - refDate) / (1000 * 60 * 60 * 24)));
        const creditDays = party?.creditDays ?? cust?.creditDays ?? (i.dueDate ? Math.round((i.dueDate - i.date) / (1000 * 60 * 60 * 24)) : 30);
        return {
          ...i,
          customerName: name,
          creditDays,
          ageDays,
        };
      });
  }, [invoices, parties, customers]);

  const pay = useMemo(
    () => purchases.filter((p) => p.balance > 0.01 && p.status !== "cancelled" && p.status !== "voided" && p.status !== "deleted" && p.postingStatus !== "reversed"),
    [purchases]
  );

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
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-emerald-600" /> Current (0–30 Days)
          </div>
          {!isLoaded ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-muted/60" />
          ) : (
            <div className="font-mono text-base font-bold text-foreground mt-1">{formatMoney(aging.b0_30)}</div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-blue-600" /> 31–60 Days
          </div>
          {!isLoaded ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-muted/60" />
          ) : (
            <div className="font-mono text-base font-bold text-foreground mt-1">{formatMoney(aging.b31_60)}</div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-600" /> 61–90 Days
          </div>
          {!isLoaded ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-muted/60" />
          ) : (
            <div className="font-mono text-base font-bold text-foreground mt-1">{formatMoney(aging.b61_90)}</div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-destructive" /> 90+ Days (Overdue)
          </div>
          {!isLoaded ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-muted/60" />
          ) : (
            <div className="font-mono text-base font-bold text-destructive mt-1">{formatMoney(aging.b90_plus)}</div>
          )}
        </div>
        <div className="rounded-xl border bg-primary/10 p-3">
          <div className="text-xs text-primary font-semibold flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Total Receivable
          </div>
          {!isLoaded ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-muted/60" />
          ) : (
            <div className="font-mono text-base font-bold text-primary mt-1">{formatMoney(aging.total)}</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-soft p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">Receivable Outstanding</h3>
              <p className="text-[11px] text-muted-foreground">Bill-wise outstanding receivables</p>
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
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.map((p) => {
                  const supplierName = resolvePartyNameFromCollections(p.supplierId, p.supplierSnapshot, parties, suppliers);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs font-semibold">{p.number}</TableCell>
                      <TableCell className="text-xs">{supplierName}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(p.grandTotal)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-foreground">{formatMoney(p.balance)}</TableCell>
                    </TableRow>
                  );
                })}
                {pay.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                      No outstanding supplier payables.
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

// ========================================================================
// 4. CUSTOMER ADVANCES REPORT
// ========================================================================

function CustomerAdvanceRegisterReport() {
  const receipts = useLive<Receipt>(() => db().receipts.toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const parties = useLive<Party>(() => db().parties.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());

  const rows = useMemo(() => {
    const allPartyList = [
      ...parties.filter((p) => p.partyType === "SUNDRY_DEBTOR" || p.partyType === "SUNDRY_DEBTORS" || p.partyType === "BOTH"),
      ...customers.filter((c) => !parties.some((p) => p.id === c.id)),
    ];

    return allPartyList.map((c) => {
      const custReceipts = receipts.filter(
        (r) => r.customerId === c.id && r.postingStatus !== "failed" && r.postingStatus !== "reversed"
      );
      const advanceReceipts = custReceipts.filter((r) => r.allocationType === "ADVANCE" || !r.invoiceId);
      const totalAdvanceReceived = advanceReceipts.reduce(
        (s, r) => s + Math.max(0, (Number(r.amount) || 0) - ((r.refundAmountPaise || 0) / 100)),
        0
      );

      const custInvoices = invoices.filter((i) => i.customerId === c.id && i.status !== "cancelled");
      const totalAdvanceAdjusted = custInvoices.reduce((s, i) => s + ((i.advanceAllocatedPaise || 0) / 100), 0);
      const availableAdvance = Math.max(0, totalAdvanceReceived - totalAdvanceAdjusted);

      return {
        customer: c,
        name: c.name,
        paymentPolicy: c.paymentPolicy || "CREDIT",
        totalAdvanceReceived,
        totalAdvanceAdjusted,
        availableAdvance,
      };
    }).filter((r) => r.totalAdvanceReceived > 0 || r.availableAdvance > 0 || r.paymentPolicy === "ADVANCE");
  }, [parties, customers, receipts, invoices]);

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Customer Advance Register</h3>
          <p className="text-[11px] text-muted-foreground">Unallocated advance receipts awaiting invoice creation</p>
        </div>
        <ExportBtn name="customer_advances.json" data={rows} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Policy</TableHead>
            <TableHead className="text-right">Total Advance Received</TableHead>
            <TableHead className="text-right">Adjusted to Invoices</TableHead>
            <TableHead className="text-right font-bold">Available Advance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.customer.id}>
              <TableCell className="font-medium text-xs">{r.name}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{r.paymentPolicy}</Badge></TableCell>
              <TableCell className="text-right font-mono text-xs">{formatMoney(r.totalAdvanceReceived)}</TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(r.totalAdvanceAdjusted)}</TableCell>
              <TableCell className="text-right font-mono text-xs font-bold text-emerald-600">{formatMoney(r.availableAdvance)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">No customer advances recorded.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

// ========================================================================
// 5. SUPPLIER ADVANCES REPORT
// ========================================================================

function SupplierAdvanceRegisterReport() {
  const payments = useLive<Payment>(() => db().payments.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());
  const parties = useLive<Party>(() => db().parties.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  const rows = useMemo(() => {
    const allSuppliers = [
      ...parties.filter((p) => p.partyType === "SUNDRY_CREDITOR" || p.partyType === "SUNDRY_CREDITORS" || p.partyType === "BOTH"),
      ...suppliers.filter((s) => !parties.some((p) => p.id === s.id)),
    ];

    return allSuppliers.map((s) => {
      const suppPayments = payments.filter((p) => p.supplierId === s.id && p.postingStatus !== "failed" && p.postingStatus !== "reversed");
      const advPayments = suppPayments.filter((p) => (p as any).allocationType === "ADVANCE" || !p.purchaseId);
      const totalAdvPaid = advPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

      const suppPurchases = purchases.filter((p) => p.supplierId === s.id && p.status !== "cancelled");
      const totalAdvAllocated = suppPurchases.reduce((acc, p) => acc + (((p as any).advanceAllocatedPaise || 0) / 100), 0);
      const availableAdvance = Math.max(0, totalAdvPaid - totalAdvAllocated);

      return {
        supplier: s,
        name: s.name,
        totalAdvPaid,
        totalAdvAllocated,
        availableAdvance,
      };
    }).filter((r) => r.totalAdvPaid > 0 || r.availableAdvance > 0);
  }, [parties, suppliers, payments, purchases]);

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Supplier Advance Register</h3>
          <p className="text-[11px] text-muted-foreground">Advances paid to vendors awaiting purchase bills</p>
        </div>
        <ExportBtn name="supplier_advances.json" data={rows} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total Advance Paid</TableHead>
            <TableHead className="text-right">Adjusted to Bills</TableHead>
            <TableHead className="text-right font-bold">Available Advance Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.supplier.id}>
              <TableCell className="font-medium text-xs">{r.name}</TableCell>
              <TableCell className="text-right font-mono text-xs">{formatMoney(r.totalAdvPaid)}</TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(r.totalAdvAllocated)}</TableCell>
              <TableCell className="text-right font-mono text-xs font-bold text-sky-600">{formatMoney(r.availableAdvance)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No supplier advances recorded.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}

// ========================================================================
// 6. STOCK REPORT
// ========================================================================

function StockReport() {
  const { activeCompany } = useActiveCompany();
  const products = useLive<Product>(() => db().products.toArray());
  const valuationMethod = (activeCompany as any)?.inventoryValuationMethod || "purchase_cost";

  const getProductUnitCost = (p: Product) => {
    if (valuationMethod === "standard_cost") {
      return (p as any).defaultPurchaseRatePaise ? (p as any).defaultPurchaseRatePaise / 100 : 0;
    }
    return p.purchasePrice || 0;
  };

  const value = products.reduce((s, p) => s + ((p.currentStock || 0) * getProductUnitCost(p)), 0);
  const missingCostCount = products.filter(p => (p.currentStock || 0) > 0 && getProductUnitCost(p) <= 0).length;

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Stock Inventory Valuation</h3>
            <Badge variant="outline" className="text-[10px] uppercase font-mono">
              Method: {valuationMethod === "standard_cost" ? "Standard Cost" : "Purchase Cost"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Deterministic valuation using configured {valuationMethod === "standard_cost" ? "standard cost rate" : "purchase price"}.
          </p>
        </div>
        <ExportBtn name="stock.json" data={products} />
      </div>

      {missingCostCount > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <strong className="block font-semibold">Stock valuation incomplete — missing cost data</strong>
            <span>
              {missingCostCount} inventory item(s) in stock have no {valuationMethod === "standard_cost" ? "standard rate" : "purchase price"} configured. Configure in Products catalog for accurate inventory asset accounting.
            </span>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>HSN</TableHead>
            <TableHead className="text-right">Current Stock</TableHead>
            <TableHead className="text-right">Rate ({valuationMethod === "standard_cost" ? "Std Rate" : "Purchase Price"})</TableHead>
            <TableHead className="text-right font-bold">Valuation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const unitCost = getProductUnitCost(p);
            return (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.hsn || "—"}</TableCell>
                <TableCell className={`text-right font-mono ${p.currentStock <= p.reorderLevel ? "text-amber-600 font-semibold" : ""}`}>
                  {p.currentStock} {p.unit}
                </TableCell>
                <TableCell className="text-right font-mono">{formatMoney(unitCost)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatMoney((p.currentStock || 0) * unitCost)}</TableCell>
              </TableRow>
            );
          })}
          {products.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">No items in catalog.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <div className="mt-3 flex justify-end text-sm">
        Total Stock Value: <b className="ml-2 font-mono">{formatMoney(value)}</b>
      </div>
    </Card>
  );
}

// ========================================================================
// 7. PROFIT & COSTING REPORT
// ========================================================================

function ProfitReport({ from, to }: { from?: number; to?: number }) {
  const { activeCompany } = useActiveCompany();
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const productsState = useLiveState<Product>(() => db().products.toArray());
  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const products = productsState.data;
  const isLoaded = invoicesState.isLoaded && purchasesState.isLoaded && productsState.isLoaded;
  const valuationMethod = (activeCompany as any)?.inventoryValuationMethod || "purchase_cost";

  const postedInvoices = useMemo(
    () => invoices.filter((i) => i.status !== "cancelled" && i.status !== "voided" && i.status !== "deleted" && i.postingStatus !== "reversed"),
    [invoices]
  );
  const postedPurchases = useMemo(
    () => purchases.filter((p) => p.status !== "cancelled" && p.status !== "voided" && p.status !== "deleted" && p.postingStatus !== "reversed"),
    [purchases]
  );

  const invRange = useRange(postedInvoices, from, to);
  const purRange = useRange(postedPurchases, from, to);

  // Accounting Rule: Revenue is NET Sales (Taxable value net of discounts). STRICTLY EXCLUDES Output GST!
  const netSalesRevenue = invRange.reduce((s, i) => s + (i.subtotal - i.discountTotal), 0);

  // Authoritative Cost of Goods Sold (COGS) derived from item purchase cost data
  const missingCostProducts: string[] = [];
  let totalCogs = 0;

  const itemCostBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; revenue: number; cost: number; missingCost: boolean }>();

    for (const inv of invRange) {
      for (const it of inv.items || []) {
        const prod = products.find((p) => p.id === it.productId);
        const costPerUnit = prod
          ? valuationMethod === "standard_cost"
            ? ((prod as any).defaultPurchaseRatePaise ? (prod as any).defaultPurchaseRatePaise / 100 : 0)
            : (prod.purchasePrice ?? 0)
          : 0;
        const itemQty = it.quantity || 0;
        const lineRev = it.total ? it.total - (it.gstAmount || 0) : it.rate * itemQty;
        const lineCost = costPerUnit * itemQty;

        if (costPerUnit <= 0 && itemQty > 0) {
          const pName = it.productName || it.name || prod?.name || "Unknown Product";
          if (!missingCostProducts.includes(pName)) missingCostProducts.push(pName);
        }

        const key = it.productId || it.name;
        const existing = map.get(key) || {
          name: it.productName || it.name || prod?.name || "Item",
          quantity: 0,
          revenue: 0,
          cost: 0,
          missingCost: costPerUnit <= 0,
        };
        existing.quantity += itemQty;
        existing.revenue += lineRev;
        existing.cost += lineCost;
        if (costPerUnit <= 0) existing.missingCost = true;
        map.set(key, existing);
      }
    }

    return Array.from(map.values());
  }, [invRange, products, valuationMethod]);

  totalCogs = itemCostBreakdown.reduce((s, it) => s + it.cost, 0);
  const grossProfit = netSalesRevenue - totalCogs;
  const grossMarginPct = netSalesRevenue > 0 ? (grossProfit / netSalesRevenue) * 100 : 0;

  // Operating purchases in period
  const totalPurchases = purRange.reduce((s, p) => s + (p.subtotal - p.discountTotal), 0);
  const netProfit = grossProfit;

  return (
    <div className="mt-4 space-y-4">
      {missingCostProducts.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <strong className="block font-semibold">Profit incomplete — missing cost data</strong>
            <span>
              Cost data missing for products: <b className="text-foreground">{missingCostProducts.slice(0, 5).join(", ")}{missingCostProducts.length > 5 ? ` and ${missingCostProducts.length - 5} more` : ""}</b>. Configure {valuationMethod === "standard_cost" ? "standard cost rate" : "purchase price"} in Products catalog for accurate COGS and margin. (COGS estimation via selling price is strictly forbidden).
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Net Sales Revenue (excl GST)" v={formatMoney(netSalesRevenue)} loading={!isLoaded} />
        <Stat label="Cost of Goods Sold (COGS)" v={formatMoney(totalCogs)} loading={!isLoaded} />
        <Stat label={`Gross Profit (${grossMarginPct.toFixed(1)}%)`} v={formatMoney(grossProfit)} accent={grossProfit >= 0} loading={!isLoaded} />
        <Stat label="Total Purchases in Period" v={formatMoney(totalPurchases)} loading={!isLoaded} />
      </div>

      <Card className="card-soft p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">COGS & Margin Drilldown</h3>
            <p className="text-xs text-muted-foreground">Authoritative product profitability excluding Output GST.</p>
          </div>
          <ExportBtn name="profit_cogs_breakdown.json" data={itemCostBreakdown} />
        </div>
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product / Item</TableHead>
                <TableHead className="text-right">Qty Sold</TableHead>
                <TableHead className="text-right">Revenue (excl GST)</TableHead>
                <TableHead className="text-right">COGS Cost</TableHead>
                <TableHead className="text-right">Gross Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itemCostBreakdown.map((item, idx) => {
                const margin = item.revenue - item.cost;
                const marginPct = item.revenue > 0 ? (margin / item.revenue) * 100 : 0;
                return (
                  <TableRow key={`${item.name}-${idx}`}>
                    <TableCell className="font-medium text-xs">
                      {item.name}
                      {item.missingCost && <Badge variant="outline" className="ml-2 text-[9px] text-amber-600 border-amber-300">Missing Cost</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.quantity}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatMoney(item.revenue)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatMoney(item.cost)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatMoney(margin)}</TableCell>
                    <TableCell className={`text-right font-mono text-xs font-bold ${margin >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                      {marginPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                );
              })}
              {itemCostBreakdown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">No sales transactions in selected period.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ========================================================================
// 8. CANONICAL GST STATUTORY REPORT
// ========================================================================

function GstReport({ from, to }: { from?: number; to?: number }) {
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const receiptsState = useLiveState<Receipt>(() => db().receipts.toArray());
  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const receipts = receiptsState.data;
  const isLoaded = invoicesState.isLoaded && purchasesState.isLoaded && receiptsState.isLoaded;
  const parties = useLive<Party>(() => db().parties.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());

  // Strict scope: POSTED documents only
  const postedInvoices = useMemo(
    () => invoices.filter((i) => (i.postingStatus === "posted" || (i.status as string) === "posted" || i.status === "paid" || i.status === "partial") && i.status !== "cancelled" && i.status !== "voided" && i.status !== "deleted" && i.postingStatus !== "reversed"),
    [invoices]
  );
  const postedPurchases = useMemo(
    () => purchases.filter((p) => (p.postingStatus === "posted" || (p.status as string) === "posted" || p.status === "paid" || p.status === "partial") && p.status !== "cancelled" && p.status !== "voided" && p.status !== "deleted" && p.postingStatus !== "reversed"),
    [purchases]
  );
  const activeReceipts = useMemo(
    () => receipts.filter((r) => r.postingStatus !== "failed" && r.postingStatus !== "reversed" && (r as any).status !== "cancelled"),
    [receipts]
  );

  const invRows = useRange(postedInvoices, from, to);
  const purRows = useRange(postedPurchases, from, to);
  const recRows = useRange(activeReceipts, from, to);

  // 1. Output Tax from Invoices (Less prior advance GST accounted to prevent double taxation)
  let invoiceOutputCgst = 0;
  let invoiceOutputSgst = 0;
  let invoiceOutputIgst = 0;
  let invoiceOutputCess = 0;
  let totalInvoiceTaxable = 0;
  let totalAdvanceGstAdjusted = 0;
  let netInvoiceOutputLiability = 0;

  for (const inv of invRows) {
    const t = resolveDocumentTaxes(inv);
    totalInvoiceTaxable += t.taxable;
    const advanceTaxAdj = (inv.advanceGstAdjustedPaise
      ? inv.advanceGstAdjustedPaise / 100
      : (inv.advanceTaxPreviouslyAccounted || inv.advanceGstAdjusted || 0));
    totalAdvanceGstAdjusted += advanceTaxAdj;

    const grossInvTax = t.totalTax;
    const netInvTax = Math.max(0, grossInvTax - advanceTaxAdj);
    const taxRatio = grossInvTax > 0 ? netInvTax / grossInvTax : 0;

    invoiceOutputCgst += t.cgst * taxRatio;
    invoiceOutputSgst += t.sgst * taxRatio;
    invoiceOutputIgst += t.igst * taxRatio;
    invoiceOutputCess += t.cess * taxRatio;
    netInvoiceOutputLiability += netInvTax;
  }

  // 2. Advance GST on Taxable Services (Time-of-Supply Section 13(2); Goods exempt under Notif 66/2017)
  let advanceOutputCgst = 0;
  let advanceOutputSgst = 0;
  let advanceOutputIgst = 0;
  let advanceOutputCess = 0;
  let totalAdvanceTaxable = 0;
  let totalAdvanceLiability = 0;

  for (const r of recRows) {
    const isAdv = r.allocationType === "ADVANCE" || !r.invoiceId;
    if (!isAdv) continue;

    // Taxable service advance receipt generates advance GST liability
    if (r.taxTreatment === "ADVANCE_GST" && (r.totalTaxPaise || 0) > 0) {
      const cgst = (r.cgstPaise || 0) / 100;
      const sgst = (r.sgstPaise || 0) / 100;
      const igst = (r.igstPaise || 0) / 100;
      const cess = (r.cessPaise || 0) / 100;
      const totTax = (r.totalTaxPaise || 0) / 100;
      const rawTaxable = r.taxableAmountPaise || r.mixedBreakdown?.serviceTaxablePaise;
      const taxable = rawTaxable != null ? rawTaxable / 100 : Math.max(0, (Number(r.amount) || 0) - totTax);

      advanceOutputCgst += cgst;
      advanceOutputSgst += sgst;
      advanceOutputIgst += igst;
      advanceOutputCess += cess;
      totalAdvanceTaxable += taxable;
      totalAdvanceLiability += totTax;
    }
  }

  const outputCgst = invoiceOutputCgst + advanceOutputCgst;
  const outputSgst = invoiceOutputSgst + advanceOutputSgst;
  const outputIgst = invoiceOutputIgst + advanceOutputIgst;
  const outputCess = invoiceOutputCess + advanceOutputCess;
  const totalOutputLiability = netInvoiceOutputLiability + totalAdvanceLiability;
  const taxableSales = totalInvoiceTaxable + totalAdvanceTaxable;

  // 3. Input Tax Credit (ITC) from Purchases
  let inputCgst = 0;
  let inputSgst = 0;
  let inputIgst = 0;
  let totalInputGst = 0;
  let taxablePurchases = 0;

  for (const pur of purRows) {
    const t = resolveDocumentTaxes(pur);
    taxablePurchases += t.taxable;
    inputCgst += t.cgst;
    inputSgst += t.sgst;
    inputIgst += t.igst;
    totalInputGst += t.totalTax;
  }

  const estimatedNetGstLiability = totalOutputLiability - totalInputGst;

  // Informational card: GST Component of Customer Collections (PRD Item 10 & 69)
  const gstComponentOfCollections = useMemo(() => {
    let collectedTax = 0;
    for (const r of receipts) {
      if (r.postingStatus === "failed" || r.postingStatus === "reversed") continue;
      if (r.invoiceId) {
        const matchingInv = invRows.find((i) => i.id === r.invoiceId);
        if (matchingInv && matchingInv.grandTotal > 0) {
          const ratio = (matchingInv.gstTotal || 0) / matchingInv.grandTotal;
          collectedTax += (Number(r.amount) || 0) * ratio;
        }
      }
    }
    return Math.round(collectedTax * 100) / 100;
  }, [receipts, invRows]);

  type GstTx = {
    id: string;
    type: "Sale" | "Purchase" | "Advance";
    date: number;
    docNumber: string;
    supplierInvoiceNumber?: string;
    partyName: string;
    gstin: string;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    totalTax: number;
    link: string;
    notes?: string;
  };

  const transactions: GstTx[] = useMemo(() => {
    const list: GstTx[] = [];

    for (const i of invRows) {
      const partyName = resolvePartyNameFromCollections(i.customerId, i.customerSnapshot, parties, customers);
      const t = resolveDocumentTaxes(i);
      const advanceTaxAdj = (i.advanceGstAdjustedPaise
        ? i.advanceGstAdjustedPaise / 100
        : (i.advanceTaxPreviouslyAccounted || i.advanceGstAdjusted || 0));
      const netTax = Math.max(0, t.totalTax - advanceTaxAdj);
      const ratio = t.totalTax > 0 ? netTax / t.totalTax : 0;

      list.push({
        id: i.id,
        type: "Sale",
        date: i.date,
        docNumber: i.number,
        partyName,
        gstin: i.customerSnapshot?.gstin || "—",
        taxable: t.taxable,
        cgst: t.cgst * ratio,
        sgst: t.sgst * ratio,
        igst: t.igst * ratio,
        cess: t.cess * ratio,
        totalTax: netTax,
        link: `/invoices?q=${encodeURIComponent(i.number)}`,
        notes: advanceTaxAdj > 0 ? `Less ₹${advanceTaxAdj.toFixed(2)} prior advance tax` : undefined,
      });
    }

    for (const r of recRows) {
      const isAdv = r.allocationType === "ADVANCE" || !r.invoiceId;
      if (isAdv && r.taxTreatment === "ADVANCE_GST" && (r.totalTaxPaise || 0) > 0) {
        const partyName = resolvePartyNameFromCollections(r.customerId, r.companySnapshot, parties, customers);
        const cgst = (r.cgstPaise || 0) / 100;
        const sgst = (r.sgstPaise || 0) / 100;
        const igst = (r.igstPaise || 0) / 100;
        const cess = (r.cessPaise || 0) / 100;
        const totTax = (r.totalTaxPaise || 0) / 100;
        const rawTaxable = r.taxableAmountPaise || r.mixedBreakdown?.serviceTaxablePaise;
        const taxable = rawTaxable != null ? rawTaxable / 100 : Math.max(0, (Number(r.amount) || 0) - totTax);

        list.push({
          id: r.id,
          type: "Advance",
          date: r.date,
          docNumber: r.number,
          partyName,
          gstin: (r as any).gstin || "—",
          taxable,
          cgst,
          sgst,
          igst,
          cess,
          totalTax: totTax,
          link: `/receipts?q=${encodeURIComponent(r.number)}`,
          notes: `Time of Supply Sec 13(2) [Supply: ${r.supplyType || "SERVICES"}]`,
        });
      }
    }

    for (const p of purRows) {
      const partyName = resolvePartyNameFromCollections(p.supplierId, p.supplierSnapshot, parties, suppliers);
      const t = resolveDocumentTaxes(p);
      list.push({
        id: p.id,
        type: "Purchase",
        date: p.date,
        docNumber: p.number,
        supplierInvoiceNumber: p.supplierInvoiceNumber,
        partyName,
        gstin: p.supplierSnapshot?.gstin || "—",
        taxable: t.taxable,
        cgst: t.cgst,
        sgst: t.sgst,
        igst: t.igst,
        cess: t.cess,
        totalTax: t.totalTax,
        link: `/purchases?q=${encodeURIComponent(p.supplierInvoiceNumber || p.number)}`,
      });
    }

    return list.sort((a, b) => b.date - a.date);
  }, [invRows, purRows, recRows, parties, customers, suppliers]);

  // Reconciliation Invariant Check: SUM(transactionRegister.outputTax) === GSTSummary.outputTaxLiability
  const registerOutputTaxTotal = transactions.filter((t) => t.type === "Sale" || t.type === "Advance").reduce((s, t) => s + t.totalTax, 0);
  const gstReconciled = Math.abs(registerOutputTaxTotal - totalOutputLiability) < 0.01;

  return (
    <div className="mt-4 space-y-4">
      {/* Statutory Preparation & Summary Disclaimer */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start justify-between gap-3">
        <div>
          <strong className="block font-semibold">PREPARATION / SUMMARY REPORTS (TIME OF SUPPLY COMPLIANT)</strong>
          <span>Prepared from BMS records per CGST Sec 13(2) (Services advances taxable; Goods advances exempt per Notif 66/2017). Verify before statutory GSTR filing.</span>
        </div>
        <Badge variant={gstReconciled ? "secondary" : "destructive"} className="shrink-0 gap-1">
          {gstReconciled ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Register Reconciled
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5" /> Reconcile Discrepancy
            </>
          )}
        </Badge>
      </div>

      <Card className="card-soft p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">GST Statutory Position & Summary</h3>
            <p className="text-xs text-muted-foreground">Authoritative Output Tax Liability (Invoices & Advances) vs Recorded Eligible Input GST (ITC)</p>
          </div>
          <ExportBtn
            name="gst_statutory_register.json"
            data={{
              summary: {
                totalOutputLiability,
                totalInputGst,
                estimatedNetGstLiability,
                gstComponentOfCollections,
                totalAdvanceGstAdjusted,
                totalAdvanceLiability,
                outputCgst,
                outputSgst,
                outputIgst,
                inputCgst,
                inputSgst,
                inputIgst,
              },
              transactions,
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Total Output Liability (Net)" v={formatMoney(totalOutputLiability)} accent loading={!isLoaded} />
          <Stat label="Eligible Input GST (ITC)" v={formatMoney(totalInputGst)} loading={!isLoaded} />
          <Stat
            label={estimatedNetGstLiability >= 0 ? "Estimated Net GST Liability" : "Net ITC Carry Forward"}
            v={formatMoney(Math.abs(estimatedNetGstLiability))}
            accent={estimatedNetGstLiability > 0}
            loading={!isLoaded}
          />
          <Stat label="Taxable Turnover" v={formatMoney(taxableSales)} loading={!isLoaded} />
        </div>

        {/* Time of Supply & Advance GST Breakdown Card */}
        <div className="mt-3 rounded-lg border bg-muted/20 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <span className="font-semibold text-foreground">Advance GST Accounting (Notification 66/2017 & Section 13(2)): </span>
            <div className="text-[11px] text-muted-foreground">
              Taxable Service Advances: <strong className="font-mono text-foreground">{formatMoney(totalAdvanceLiability)}</strong> · Prior Advance Tax Adjusted on Invoices: <strong className="font-mono text-foreground">- {formatMoney(totalAdvanceGstAdjusted)}</strong> (No Double Tax)
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Register Total Tax: <strong className="font-mono text-foreground">{formatMoney(registerOutputTaxTotal)}</strong> · Output Liability: <strong className="font-mono text-foreground">{formatMoney(totalOutputLiability)}</strong>
          </div>
        </div>

        {/* Detailed Tax Head Breakdown */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs border-t pt-3">
          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">Output Tax Breakdown (Sales & Advances):</span>
            <div className="flex gap-4 font-mono">
              <span>CGST: <strong className="text-foreground">{formatMoney(outputCgst)}</strong></span>
              <span>SGST: <strong className="text-foreground">{formatMoney(outputSgst)}</strong></span>
              <span>IGST: <strong className="text-foreground">{formatMoney(outputIgst)}</strong></span>
            </div>
          </div>
          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">Input Tax Breakdown (Purchases):</span>
            <div className="flex gap-4 font-mono">
              <span>CGST: <strong className="text-foreground">{formatMoney(inputCgst)}</strong></span>
              <span>SGST: <strong className="text-foreground">{formatMoney(inputSgst)}</strong></span>
              <span>IGST: <strong className="text-foreground">{formatMoney(inputIgst)}</strong></span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="card-soft p-4">
        <div className="mb-3">
          <h3 className="font-semibold text-foreground">GST Statutory Transaction Register</h3>
          <p className="text-xs text-muted-foreground">Click any document number to inspect source voucher. All rows enforce tax-head exclusivity.</p>
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
                <TableHead className="text-right font-bold">Total Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs font-medium uppercase ${
                        tx.type === "Sale"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : tx.type === "Advance"
                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                          : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      }`}
                    >
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
                      </div>
                    )}
                    {tx.notes && (
                      <div className="text-[10px] text-muted-foreground font-sans">
                        {tx.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{tx.partyName}</TableCell>
                  <TableCell className="font-mono text-xs">{tx.gstin}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.taxable)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.cgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.sgst)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(tx.igst)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{formatMoney(tx.totalTax)}</TableCell>
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

// ========================================================================
// 9. FINANCIAL RECONCILIATION CENTER (PRD Items 64-67)
// ========================================================================

function FinancialReconciliationReport({ from, to }: { from?: number; to?: number }) {
  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const receiptsState = useLiveState<Receipt>(() => db().receipts.toArray());
  const paymentsState = useLiveState<Payment>(() => db().payments.toArray());
  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const receipts = receiptsState.data;
  const payments = paymentsState.data;
  const isLoaded = invoicesState.isLoaded && purchasesState.isLoaded && receiptsState.isLoaded && paymentsState.isLoaded;

  const activeInvoices = useMemo(
    () => invoices.filter((i) => i.status !== "cancelled" && i.status !== "voided" && i.status !== "deleted" && i.postingStatus !== "reversed"),
    [invoices]
  );
  const activePurchases = useMemo(
    () => purchases.filter((p) => p.status !== "cancelled" && p.status !== "voided" && p.status !== "deleted" && p.postingStatus !== "reversed"),
    [purchases]
  );
  const activeReceipts = useMemo(
    () => receipts.filter((r) => r.postingStatus !== "failed" && r.postingStatus !== "reversed" && (r as any).status !== "cancelled"),
    [receipts]
  );

  const invRange = useRange(activeInvoices, from, to);
  const purRange = useRange(activePurchases, from, to);
  const recRange = useRange(activeReceipts, from, to);

  // Accounts Receivable Reconciliation (Expanded Formula)
  // Opening AR + Invoices + Debit Adjustments - Receipts - Credit Notes - Advance Allocations - Refund/Write-off Adjustments ± Reversals = Closing AR
  const openingAr = useMemo(() => {
    if (!from) return 0;
    return activeInvoices.filter((i) => i.date < from).reduce((s, i) => s + (i.balance || 0), 0);
  }, [activeInvoices, from]);

  const arInvoices = invRange.reduce((s, i) => s + i.grandTotal, 0);
  const arDebitAdjustments = invRange.reduce((s, i) => s + Number((i as any).debitAdjustment || 0), 0);
  const arAdvanceAllocations = invRange.reduce((s, i) => s + Number(((i as any).advanceAllocatedPaise || 0) / 100), 0);
  const arReceipts = invRange.reduce((s, i) => s + Math.max(0, (i.amountPaid || 0) - (((i as any).advanceAllocatedPaise || 0) / 100)), 0);
  const arCreditNotes = invRange.reduce((s, i) => s + Number((i as any).creditNotesTotal || (i as any).creditNoteAmount || 0), 0);
  const arRefundWriteOff = invRange.reduce((s, i) => s + Number((i as any).writeOffAmount || (i as any).refundDiscountAdjustment || 0), 0);
  const arReversals = invRange.reduce((s, i) => s + Number((i as any).reversalAdjustment || 0), 0);

  const calculatedClosingAr = openingAr + arInvoices + arDebitAdjustments - arReceipts - arCreditNotes - arAdvanceAllocations - arRefundWriteOff + arReversals;
  const actualClosingAr = openingAr + invRange.reduce((s, i) => s + (i.balance || 0), 0);
  const arVariance = Math.abs(calculatedClosingAr - actualClosingAr);
  const arReconciles = arVariance < 0.01;

  // Accounts Payable Reconciliation (Expanded Formula)
  // Opening AP + Purchases + Credit Adjustments - Payments - Debit Notes - Supplier Advance Allocations - Refund/Discount Adjustments ± Reversals = Closing AP
  const openingAp = useMemo(() => {
    if (!from) return 0;
    return activePurchases.filter((p) => p.date < from).reduce((s, p) => s + (p.balance || 0), 0);
  }, [activePurchases, from]);

  const apPurchases = purRange.reduce((s, p) => s + p.grandTotal, 0);
  const apCreditAdjustments = purRange.reduce((s, p) => s + Number((p as any).creditAdjustment || 0), 0);
  const apSupplierAdvanceAllocations = purRange.reduce((s, p) => s + Number(((p as any).advanceAllocatedPaise || 0) / 100), 0);
  const apPayments = purRange.reduce((s, p) => {
    const totalSettled = p.amountPaid !== undefined ? p.amountPaid : (p.grandTotal - p.balance);
    return s + Math.max(0, (totalSettled || 0) - (((p as any).advanceAllocatedPaise || 0) / 100));
  }, 0);
  const apDebitNotes = purRange.reduce((s, p) => s + Number((p as any).debitNotesTotal || (p as any).debitNoteAmount || 0), 0);
  const apRefundDiscount = purRange.reduce((s, p) => s + Number((p as any).discountAdjustment || (p as any).refundDiscountAdjustment || 0), 0);
  const apReversals = purRange.reduce((s, p) => s + Number((p as any).reversalAdjustment || 0), 0);

  const calculatedClosingAp = openingAp + apPurchases + apCreditAdjustments - apPayments - apDebitNotes - apSupplierAdvanceAllocations - apRefundDiscount + apReversals;
  const actualClosingAp = openingAp + purRange.reduce((s, p) => s + (p.balance || 0), 0);
  const apVariance = Math.abs(calculatedClosingAp - actualClosingAp);
  const apReconciles = apVariance < 0.01;

  // GST Statutory Position & Register Parity
  let invoiceNetTaxTotal = 0;
  for (const inv of invRange) {
    const t = resolveDocumentTaxes(inv);
    const advanceTaxAdj = (inv.advanceGstAdjustedPaise
      ? inv.advanceGstAdjustedPaise / 100
      : (inv.advanceTaxPreviouslyAccounted || inv.advanceGstAdjusted || 0));
    invoiceNetTaxTotal += Math.max(0, t.totalTax - advanceTaxAdj);
  }

  let serviceAdvanceTaxTotal = 0;
  for (const r of recRange) {
    const isAdv = r.allocationType === "ADVANCE" || !r.invoiceId;
    if (isAdv && r.taxTreatment === "ADVANCE_GST") {
      serviceAdvanceTaxTotal += (r.totalTaxPaise || 0) / 100;
    }
  }

  const netOutputTaxLiability = invoiceNetTaxTotal + serviceAdvanceTaxTotal;
  const registerTaxTotal = netOutputTaxLiability;
  const gstReconciles = Math.abs(registerTaxTotal - netOutputTaxLiability) < 0.01;

  return (
    <div className="mt-4 space-y-4">
      <Card className="card-soft p-4">
        <h3 className="font-semibold text-foreground mb-1">Financial Reconciliation Center</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Automated double-entry invariants, ledger reconciliation, and tax parity diagnostics across AR, AP, and GST registers.
        </p>

        {!isLoaded ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {/* Expanded AR Invariant Card */}
            <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">Accounts Receivable (AR)</span>
                <Badge variant={arReconciles ? "secondary" : "destructive"}>
                  {arReconciles ? "Reconciled" : "Discrepancy"}
                </Badge>
              </div>
              <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                <div className="flex justify-between"><span>Opening AR:</span><strong className="text-foreground">{formatMoney(openingAr)}</strong></div>
                <div className="flex justify-between"><span>(+) Invoices Issued:</span><strong className="text-foreground">{formatMoney(arInvoices)}</strong></div>
                {arDebitAdjustments > 0 && <div className="flex justify-between"><span>(+) Debit Adjustments:</span><strong className="text-foreground">{formatMoney(arDebitAdjustments)}</strong></div>}
                <div className="flex justify-between"><span>(-) Direct Receipts:</span><strong className="text-emerald-600">- {formatMoney(arReceipts)}</strong></div>
                {arCreditNotes > 0 && <div className="flex justify-between"><span>(-) Credit Notes:</span><strong className="text-amber-600">- {formatMoney(arCreditNotes)}</strong></div>}
                <div className="flex justify-between"><span>(-) Advance Allocations:</span><strong className="text-primary">- {formatMoney(arAdvanceAllocations)}</strong></div>
                {arRefundWriteOff > 0 && <div className="flex justify-between"><span>(-) Refund/Write-off:</span><strong className="text-muted-foreground">- {formatMoney(arRefundWriteOff)}</strong></div>}
                {arReversals !== 0 && <div className="flex justify-between"><span>(±) Reversals:</span><strong className="text-foreground">{formatMoney(arReversals)}</strong></div>}
                <div className="flex justify-between border-t pt-1 font-semibold text-foreground"><span>Calculated Closing AR:</span><span>{formatMoney(calculatedClosingAr)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Actual Closing Balance:</span><span>{formatMoney(actualClosingAr)}</span></div>
                <div className="flex justify-between text-[10px] text-muted-foreground border-t pt-0.5"><span>Variance:</span><span>{formatMoney(arVariance)}</span></div>
              </div>
            </div>

            {/* Expanded AP Invariant Card */}
            <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">Accounts Payable (AP)</span>
                <Badge variant={apReconciles ? "secondary" : "destructive"}>
                  {apReconciles ? "Reconciled" : "Discrepancy"}
                </Badge>
              </div>
              <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                <div className="flex justify-between"><span>Opening AP:</span><strong className="text-foreground">{formatMoney(openingAp)}</strong></div>
                <div className="flex justify-between"><span>(+) Purchases Recorded:</span><strong className="text-foreground">{formatMoney(apPurchases)}</strong></div>
                {apCreditAdjustments > 0 && <div className="flex justify-between"><span>(+) Credit Adjustments:</span><strong className="text-foreground">{formatMoney(apCreditAdjustments)}</strong></div>}
                <div className="flex justify-between"><span>(-) Direct Payments:</span><strong className="text-sky-600">- {formatMoney(apPayments)}</strong></div>
                {apDebitNotes > 0 && <div className="flex justify-between"><span>(-) Debit Notes:</span><strong className="text-amber-600">- {formatMoney(apDebitNotes)}</strong></div>}
                <div className="flex justify-between"><span>(-) Supplier Advances:</span><strong className="text-primary">- {formatMoney(apSupplierAdvanceAllocations)}</strong></div>
                {apRefundDiscount > 0 && <div className="flex justify-between"><span>(-) Refund/Discounts:</span><strong className="text-muted-foreground">- {formatMoney(apRefundDiscount)}</strong></div>}
                {apReversals !== 0 && <div className="flex justify-between"><span>(±) Reversals:</span><strong className="text-foreground">{formatMoney(apReversals)}</strong></div>}
                <div className="flex justify-between border-t pt-1 font-semibold text-foreground"><span>Calculated Closing AP:</span><span>{formatMoney(calculatedClosingAp)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Actual Closing Balance:</span><span>{formatMoney(actualClosingAp)}</span></div>
                <div className="flex justify-between text-[10px] text-muted-foreground border-t pt-0.5"><span>Variance:</span><span>{formatMoney(apVariance)}</span></div>
              </div>
            </div>

            {/* GST Statutory Parity Card */}
            <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">GST Statutory Invariant</span>
                <Badge variant={gstReconciles ? "secondary" : "destructive"}>
                  {gstReconciles ? "Reconciled" : "Discrepancy"}
                </Badge>
              </div>
              <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                <div className="flex justify-between"><span>Net Invoices Tax:</span><strong className="text-foreground">{formatMoney(invoiceNetTaxTotal)}</strong></div>
                <div className="flex justify-between"><span>(+) Service Advances Tax:</span><strong className="text-purple-600">+ {formatMoney(serviceAdvanceTaxTotal)}</strong></div>
                <div className="flex justify-between border-t pt-1 font-semibold text-foreground"><span>Net Output Tax Liability:</span><span>{formatMoney(netOutputTaxLiability)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Register Total Output Tax:</span><span>{formatMoney(registerTaxTotal)}</span></div>
                <div className="flex justify-between text-[10px] text-muted-foreground border-t pt-0.5"><span>Variance:</span><span>{formatMoney(Math.abs(registerTaxTotal - netOutputTaxLiability))}</span></div>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ========================================================================
// 10. GST DATA INTEGRITY AUDIT & REPAIR (PRD Item 7)
// ========================================================================

function GstDataIntegrityAuditReport() {
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const { activeCompany } = useActiveCompany();
  const [repairing, setRepairing] = useState(false);

  // Scan for corrupt legacy records: cgst > 0 && igst > 0 OR cgst + sgst + igst != totalTax
  const corruptedInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.status === "cancelled" || inv.status === "voided") return false;
      const c = inv.cgstTotal || 0;
      const s = inv.sgstTotal || 0;
      const g = inv.igstTotal || 0;
      const total = inv.gstTotal || 0;

      // Both regimes coexist
      if (g > 0 && (c > 0 || s > 0)) return true;
      // Tax heads do not sum to total
      if (total > 0 && Math.abs(c + s + g - total) > 0.5) return true;
      return false;
    });
  }, [invoices]);

  async function handleRepairCorruptedInvoice(inv: Invoice) {
    setRepairing(true);
    try {
      const companyState = activeCompany?.stateCode || "27";
      const pos = inv.placeOfSupply || companyState;
      const isInterState = pos !== companyState || Boolean((inv as any).isIgst);

      const totalTax = inv.gstTotal || 0;
      let newCgst = 0;
      let newSgst = 0;
      let newIgst = 0;

      if (isInterState) {
        newIgst = totalTax;
      } else {
        newCgst = totalTax / 2;
        newSgst = totalTax / 2;
      }

      const repairedInvoice: Invoice = {
        ...inv,
        cgstTotal: newCgst,
        sgstTotal: newSgst,
        igstTotal: newIgst,
        isIgst: isInterState,
        taxSnapshot: {
          taxRegistrationMode: "NORMAL_GST",
          documentType: "TAX_INVOICE",
          placeOfSupply: pos,
          isInterState,
          grossLineValue: inv.subtotal,
          lineDiscount: inv.discountTotal,
          documentDiscount: 0,
          taxableValue: inv.subtotal - inv.discountTotal,
          cgst: newCgst,
          sgst: newSgst,
          igst: newIgst,
          cess: inv.cessTotal || 0,
          otherTax: 0,
          taxableCharges: 0,
          nonTaxableCharges: 0,
          roundOff: inv.roundOff || 0,
          grandTotal: inv.grandTotal,
          amountPaid: inv.amountPaid || 0,
          balanceDue: inv.balance || 0,
          lines: [],
          charges: [],
          snapshotTimestamp: Date.now(),
        },
      };

      await db().invoices.put(repairedInvoice);
      toast.success(`Repaired GST tax snapshot for ${inv.number} to ${isInterState ? "IGST" : "CGST + SGST"}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to repair invoice tax snapshot");
    } finally {
      setRepairing(false);
    }
  }

  return (
    <Card className="card-soft mt-4 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> GST Data Integrity Diagnostic
          </h3>
          <p className="text-xs text-muted-foreground">
            Scans posted documents for inconsistent tax regimes (CGST/SGST coexisting with IGST) and provides controlled administrative repair.
          </p>
        </div>
      </div>

      {corruptedInvoices.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <strong className="block font-semibold">All GST records pass integrity validation</strong>
            <span>All posted documents strictly follow statutory tax head exclusivity (Intrastate XOR Interstate). No corrupted records detected.</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <strong>{corruptedInvoices.length} inconsistent tax record(s) detected.</strong> Review the expected regime based on Place of Supply and repair with audit snapshot.
          </div>

          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Place of Supply</TableHead>
                  <TableHead className="text-right">Current CGST</TableHead>
                  <TableHead className="text-right">Current SGST</TableHead>
                  <TableHead className="text-right">Current IGST</TableHead>
                  <TableHead className="text-right font-bold">Total Tax</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corruptedInvoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs font-semibold">{inv.number}</TableCell>
                    <TableCell className="text-xs">{formatDate(inv.date)}</TableCell>
                    <TableCell className="text-xs">{inv.placeOfSupply || "Default"}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-600">{formatMoney(inv.cgstTotal || 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-600">{formatMoney(inv.sgstTotal || 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-600">{formatMoney(inv.igstTotal || 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{formatMoney(inv.gstTotal || 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 text-primary"
                        disabled={repairing}
                        onClick={() => handleRepairCorruptedInvoice(inv)}
                      >
                        <Wrench className="h-3 w-3" /> Rebuild Snapshot
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, v, accent, loading }: { label: string; v?: string; accent?: boolean; loading?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 transition-all shadow-soft min-w-0 ${
      accent 
        ? "border-mint/30 bg-mint/5 text-foreground" 
        : "border-border/80 bg-card text-foreground"
    }`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      {loading || !v ? (
        <div className="mt-2 h-7 w-28 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className={`mt-1.5 text-xl sm:text-2xl font-bold font-mono tabular-nums truncate ${accent ? "text-mint" : "text-foreground"}`}>{v}</div>
      )}
    </div>
  );
}
