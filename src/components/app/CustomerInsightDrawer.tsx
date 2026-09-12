import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney, formatDate } from "@/lib/format";
import { computeCustomerSummary, type CustomerFinancialSummary } from "@/modules/summary/summaryService";
import { db, type Customer, type Invoice } from "@/lib/db";
import {
  TrendingUp,
  CreditCard,
  AlertCircle,
  FileText,
  Calendar,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";

interface Props {
  customerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectInvoice?: (invoiceId: string) => void;
}

export function CustomerInsightDrawer({ customerId, open, onOpenChange, onSelectInvoice }: Props) {
  const [summary, setSummary] = useState<CustomerFinancialSummary | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId || !open) {
      setSummary(null);
      setCustomer(null);
      return;
    }

    let active = true;
    setLoading(true);

    Promise.all([
      db().customers.get(customerId),
      computeCustomerSummary(customerId),
    ])
      .then(([c, s]) => {
        if (active) {
          setCustomer(c || null);
          setSummary(s);
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
            {/* KPI Cards Grid */}
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
                  {summary.creditDays > 0 ? `Terms: ${summary.creditDays} days` : "Standard terms"}
                </div>
              </Card>
            </div>

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
                        if (onSelectInvoice) onSelectInvoice(inv.id);
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
