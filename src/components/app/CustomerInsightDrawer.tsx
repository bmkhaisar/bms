import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney, formatDate } from "@/lib/format";
import { computeCustomerSummary, type CustomerFinancialSummary } from "@/modules/summary/summaryService";
import { getPartyDualFinancialPosition, type PartyDualFinancialPosition } from "@/modules/accounting/services/partyAdvanceService";
import { db, type Customer, type Invoice, type Party } from "@/lib/db";
import {
  TrendingUp,
  CreditCard,
  AlertCircle,
  FileText,
  Calendar,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  Split,
  Building2,
  ShoppingCart,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { documentDeepLink } from "@/lib/useDocumentDeepLink";

interface Props {
  customerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectInvoice?: (invoiceId: string) => void;
}

export function CustomerInsightDrawer({ customerId, open, onOpenChange, onSelectInvoice }: Props) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<CustomerFinancialSummary | null>(null);
  const [dualPosition, setDualPosition] = useState<PartyDualFinancialPosition | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId || !open) {
      setSummary(null);
      setCustomer(null);
      setDualPosition(null);
      return;
    }

    let active = true;
    setLoading(true);

    Promise.all([
      db().parties.get(customerId).then((p) => p || db().customers.get(customerId)),
      computeCustomerSummary(customerId),
      getPartyDualFinancialPosition(customerId),
    ])
      .then(([c, s, d]) => {
        if (active) {
          setCustomer((c as Customer) || null);
          setSummary(s);
          setDualPosition(d);
        }
      })
      .catch((err) => console.error("Failed to load customer insight:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, open]);

  if (!customerId) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-4 sm:p-6">
        <SheetHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider text-primary">
              Customer Insight
            </Badge>
            {summary?.isCreditExceeded && (
              <Badge variant="destructive" className="gap-1 text-[10px]">
                <ShieldAlert className="h-3 w-3" /> Credit Exceeded
              </Badge>
            )}
          </div>
          <SheetTitle className="text-lg font-bold truncate">
            {customer?.name || "Customer Profile"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {customer?.company ? `${customer.company} · ` : ""}
            {customer?.gstin ? `GSTIN: ${customer.gstin}` : "Realtime posted ledger & invoice statistics"}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
            Loading customer financial records…
          </div>
        ) : summary ? (
          <div className="py-4 space-y-4 text-xs">
            {/* PRD Addendum § 16, 17, 18: Party Type BOTH — AR/AP Must Remain Separate */}
            {dualPosition && (dualPosition.partyType === "BOTH" || customer?.partyType === "BOTH") ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <Split className="h-4 w-4" /> Party Type: BOTH (Customer + Supplier)
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    Accounts Receivable and Accounts Payable are strictly isolated. Balances are never automatically netted.
                  </p>
                </div>

                {/* SALES SIDE (AR POSITION) */}
                <div className="rounded-xl border border-emerald-500/20 bg-card p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
                      <Building2 className="h-3.5 w-3.5" /> Sales Side (Accounts Receivable)
                    </span>
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                      Customer Position
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <div className="bg-muted/40 p-2 rounded">
                      <span className="text-[10px] text-muted-foreground block">Total Invoiced</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(dualPosition.salesSide.totalInvoicedRupees)}
                      </span>
                    </div>
                    <div className="bg-muted/40 p-2 rounded">
                      <span className="text-[10px] text-muted-foreground block">Receipts</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(dualPosition.salesSide.receiptsRupees)}
                      </span>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded">
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 block font-semibold">Receivable Due</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {formatMoney(dualPosition.salesSide.receivableOutstandingRupees)}
                      </span>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded">
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-semibold">Customer Advance</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {formatMoney(dualPosition.salesSide.advanceReceivedRupees)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* PURCHASE SIDE (AP POSITION) */}
                <div className="rounded-xl border border-blue-500/20 bg-card p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
                      <ShoppingCart className="h-3.5 w-3.5" /> Purchase Side (Accounts Payable)
                    </span>
                    <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-500/30">
                      Supplier Position
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <div className="bg-muted/40 p-2 rounded">
                      <span className="text-[10px] text-muted-foreground block">Total Purchased</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(dualPosition.purchaseSide.totalPurchasedRupees)}
                      </span>
                    </div>
                    <div className="bg-muted/40 p-2 rounded">
                      <span className="text-[10px] text-muted-foreground block">Payments</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(dualPosition.purchaseSide.paymentsRupees)}
                      </span>
                    </div>
                    <div className="bg-rose-500/10 border border-rose-500/20 p-2 rounded">
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 block font-semibold">Payable Due</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {formatMoney(dualPosition.purchaseSide.payableOutstandingRupees)}
                      </span>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 p-2 rounded">
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 block font-semibold">Supplier Advance</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400">
                        {formatMoney(dualPosition.purchaseSide.supplierAdvanceRupees)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Standard KPI Cards Grid for Single Customers */
              <div className="grid grid-cols-2 gap-2.5">
                <Card className="p-3 bg-muted/30 border-border/60">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total Invoiced</div>
                  <div className="text-sm font-bold text-foreground font-mono mt-0.5">
                    {formatMoney(summary.totalInvoiced)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {summary.invoiceCount} posted invoice{summary.invoiceCount === 1 ? "" : "s"}
                  </div>
                </Card>

                <Card className="p-3 bg-muted/30 border-border/60">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total Paid</div>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                    {formatMoney(summary.totalPaid)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Last: {summary.lastPaymentDate ? formatDate(summary.lastPaymentDate) : "—"}
                  </div>
                </Card>

                <Card className={`p-3 border-border/60 ${summary.outstanding > 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-muted/30"}`}>
                  <div className="text-[10px] uppercase font-semibold text-amber-600 dark:text-amber-400">
                    Outstanding Due
                  </div>
                  <div className="text-sm font-bold text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                    {formatMoney(summary.outstanding)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {summary.creditLimit > 0 ? `Limit: ${formatMoney(summary.creditLimit)}` : "No limit set"}
                  </div>
                </Card>

                <Card className={`p-3 border-border/60 ${summary.overdue > 0 ? "bg-rose-500/10 border-rose-500/30" : "bg-muted/30"}`}>
                  <div className="text-[10px] uppercase font-semibold text-rose-600 dark:text-rose-400">
                    Overdue Amount
                  </div>
                  <div className="text-sm font-bold text-rose-600 dark:text-rose-400 font-mono mt-0.5">
                    {formatMoney(summary.overdue)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {summary.creditDays === 0 ? "Terms: Due Immediately (0d)" : summary.creditDays > 0 ? `Terms: ${summary.creditDays} days` : "Standard terms"}
                  </div>
                </Card>
              </div>
            )}

            {/* Additional Metrics */}
            <div className="rounded-xl border border-border/50 bg-card/60 p-3 space-y-2">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Average Invoice Value</span>
                <span className="font-mono font-medium text-foreground">{formatMoney(summary.averageInvoice)}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>First Transaction</span>
                <span className="font-mono text-foreground">{summary.firstSaleDate ? formatDate(summary.firstSaleDate) : "—"}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Last Sale Date</span>
                <span className="font-mono text-foreground">{summary.lastSaleDate ? formatDate(summary.lastSaleDate) : "—"}</span>
              </div>
            </div>

            <Separator />

            {/* Recent Invoices */}
            <div className="space-y-2">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>Recent Invoices</span>
                <span className="text-[10px] text-muted-foreground">Last {summary.recentInvoices.length} records</span>
              </div>

              {summary.recentInvoices.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground border border-dashed rounded-lg">
                  No posted invoices yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {summary.recentInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      onClick={() => {
                        onOpenChange(false);
                        if (onSelectInvoice) onSelectInvoice(inv.id);
                        else navigate({ to: documentDeepLink("/invoices", inv.id) as never });
                      }}
                      className="group flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-semibold flex items-center gap-1.5 text-foreground">
                          {inv.number}
                          <Badge
                            variant={inv.balance <= 0.01 ? "secondary" : "outline"}
                            className="text-[9px] px-1 py-0"
                          >
                            {inv.balance <= 0.01 ? "PAID" : inv.paid > 0 ? "PARTIAL" : "UNPAID"}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(inv.date)} · Bal: {formatMoney(inv.balance)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-foreground">{formatMoney(inv.amount)}</div>
                        <span className="text-[10px] text-primary flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                          Open <ArrowRight className="h-2.5 w-2.5" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
