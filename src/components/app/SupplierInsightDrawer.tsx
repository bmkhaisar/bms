import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney, formatDate } from "@/lib/format";
import { computeSupplierSummary, type SupplierFinancialSummary } from "@/modules/summary/summaryService";
import { db, type Supplier } from "@/lib/db";
import { ArrowRight, Truck } from "lucide-react";

interface Props {
  supplierId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPurchase?: (purchaseId: string) => void;
}

export function SupplierInsightDrawer({ supplierId, open, onOpenChange, onSelectPurchase }: Props) {
  const [summary, setSummary] = useState<SupplierFinancialSummary | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supplierId || !open) {
      setSummary(null);
      setSupplier(null);
      return;
    }

    let active = true;
    setLoading(true);

    Promise.all([
      db().suppliers.get(supplierId),
      computeSupplierSummary(supplierId),
    ])
      .then(([s, sum]) => {
        if (active) {
          setSupplier(s || null);
          setSummary(sum);
        }
      })
      .catch((err) => console.error("Failed to load supplier insight:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [supplierId, open]);

  if (!supplierId) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-4 sm:p-6">
        <SheetHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider text-sky-600">
              Supplier Insight
            </Badge>
          </div>
          <SheetTitle className="text-lg font-bold truncate">
            {supplier?.name || "Supplier Profile"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {supplier?.company ? `${supplier.company} · ` : ""}
            {supplier?.gstin ? `GSTIN: ${supplier.gstin}` : "Realtime posted purchases & payables"}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
            Loading supplier financial records…
          </div>
        ) : summary ? (
          <div className="py-4 space-y-4 text-xs">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total Purchased</div>
                <div className="text-sm font-bold text-foreground font-mono mt-0.5">
                  {formatMoney(summary.totalPurchased)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {summary.purchaseCount} bill{summary.purchaseCount === 1 ? "" : "s"}
                </div>
              </Card>

              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total Paid</div>
                <div className="text-sm font-bold text-sky-600 dark:text-sky-400 font-mono mt-0.5">
                  {formatMoney(summary.totalPaid)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Settled bills
                </div>
              </Card>

              <Card className={`p-3 border-border/60 col-span-2 ${summary.outstanding > 0 ? "bg-rose-500/10 border-rose-500/30" : "bg-muted/30"}`}>
                <div className="text-[10px] uppercase font-semibold text-rose-600 dark:text-rose-400">
                  Outstanding Payable
                </div>
                <div className="text-sm font-bold text-rose-600 dark:text-rose-400 font-mono mt-0.5">
                  {formatMoney(summary.outstanding)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Vendor liability owed
                </div>
              </Card>
            </div>

            {/* Additional Metrics */}
            <div className="rounded-xl border border-border/50 bg-card/60 p-3 space-y-2">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Average Bill Value</span>
                <span className="font-mono font-medium text-foreground">{formatMoney(summary.averagePurchase)}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>First Purchase Date</span>
                <span className="font-mono text-foreground">{summary.firstPurchaseDate ? formatDate(summary.firstPurchaseDate) : "—"}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Last Purchase Date</span>
                <span className="font-mono text-foreground">{summary.lastPurchaseDate ? formatDate(summary.lastPurchaseDate) : "—"}</span>
              </div>
            </div>

            <Separator />

            {/* Recent Purchases */}
            <div className="space-y-2">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>Recent Purchase Bills</span>
                <span className="text-[10px] text-muted-foreground">Last {summary.recentPurchases.length} records</span>
              </div>

              {summary.recentPurchases.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground border border-dashed rounded-lg">
                  No posted purchase bills yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {summary.recentPurchases.map((pu) => (
                    <div
                      key={pu.id}
                      onClick={() => {
                        if (onSelectPurchase) onSelectPurchase(pu.id);
                      }}
                      className="group flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-semibold flex items-center gap-1.5 text-foreground flex-wrap">
                          <span>{pu.number}</span>
                          {pu.supplierInvoiceNumber && (
                            <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-mono">
                              Inv: {pu.supplierInvoiceNumber}
                            </span>
                          )}
                          <Badge
                            variant={pu.balance <= 0.01 ? "secondary" : "outline"}
                            className="text-[9px] px-1 py-0"
                          >
                            {pu.balance <= 0.01 ? "PAID" : pu.paid > 0 ? "PARTIAL" : "UNPAID"}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(pu.date)}
                          {pu.supplierInvoiceDate ? ` (Inv Date: ${formatDate(pu.supplierInvoiceDate)})` : ""} · Bal: {formatMoney(pu.balance)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-foreground">{formatMoney(pu.amount)}</div>
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
