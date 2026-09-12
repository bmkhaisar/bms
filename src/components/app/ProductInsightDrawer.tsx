import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney, formatDate } from "@/lib/format";
import { computeProductSummary, type ProductFinancialSummary } from "@/modules/summary/summaryService";
import { db, type Product } from "@/lib/db";
import { ArrowRight, Package, TrendingUp } from "lucide-react";

interface Props {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectInvoice?: (invoiceId: string) => void;
}

export function ProductInsightDrawer({ productId, open, onOpenChange, onSelectInvoice }: Props) {
  const [summary, setSummary] = useState<ProductFinancialSummary | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId || !open) {
      setSummary(null);
      setProduct(null);
      return;
    }

    let active = true;
    setLoading(true);

    Promise.all([
      db().products.get(productId),
      computeProductSummary(productId),
    ])
      .then(([p, sum]) => {
        if (active) {
          setProduct(p || null);
          setSummary(sum);
        }
      })
      .catch((err) => console.error("Failed to load product insight:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [productId, open]);

  if (!productId) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-4 sm:p-6">
        <SheetHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider text-emerald-600">
              Product Insight
            </Badge>
            {product?.sku && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                SKU: {product.sku}
              </Badge>
            )}
          </div>
          <SheetTitle className="text-lg font-bold truncate">
            {product?.name || "Product Profile"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Unit: {product?.unit || "NOS"} · Base Selling Rate: {formatMoney(product?.sellingPrice || 0)}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
            Loading product sales records…
          </div>
        ) : summary ? (
          <div className="py-4 space-y-4 text-xs">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Quantity Sold</div>
                <div className="text-sm font-bold text-foreground font-mono mt-0.5">
                  {summary.quantitySold} {product?.unit || "NOS"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Across posted invoices
                </div>
              </Card>

              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total Sales Value</div>
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  {formatMoney(summary.revenue)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Gross revenue
                </div>
              </Card>

              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Available Stock</div>
                <div className="text-sm font-bold text-sky-600 dark:text-sky-400 font-mono mt-0.5">
                  {summary.availableStock} {product?.unit || "NOS"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {product?.trackInventory ? "Inventory tracked" : "Non-stock service"}
                </div>
              </Card>

              <Card className="p-3 bg-muted/30 border-border/60">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Last Selling Rate</div>
                <div className="text-sm font-bold text-foreground font-mono mt-0.5">
                  {formatMoney(summary.lastSaleRate)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Avg: {formatMoney(summary.averageSaleRate)}
                </div>
              </Card>
            </div>

            {/* Additional Metrics */}
            <div className="rounded-xl border border-border/50 bg-card/60 p-3 space-y-2">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Top Customer</span>
                <span className="font-semibold text-foreground truncate max-w-[200px]">
                  {summary.topCustomerName || "—"} {summary.topCustomerVolume > 0 ? `(${summary.topCustomerVolume} ${product?.unit || "NOS"})` : ""}
                </span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>First Sale Date</span>
                <span className="font-mono text-foreground">{summary.firstSaleDate ? formatDate(summary.firstSaleDate) : "—"}</span>
              </div>
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Last Sale Date</span>
                <span className="font-mono text-foreground">{summary.lastSaleDate ? formatDate(summary.lastSaleDate) : "—"}</span>
              </div>
            </div>

            <Separator />

            {/* Recent Sales */}
            <div className="space-y-2">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>Recent Invoices Sold</span>
                <span className="text-[10px] text-muted-foreground">Last {summary.recentSales.length} sales</span>
              </div>

              {summary.recentSales.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground border border-dashed rounded-lg">
                  No sales recorded yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {summary.recentSales.map((sale, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        if (onSelectInvoice) onSelectInvoice(sale.invoiceId);
                      }}
                      className="group flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-semibold flex items-center gap-1.5 text-foreground">
                          {sale.invoiceNumber}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                          {sale.customerName} · {formatDate(sale.date)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold text-foreground">
                          {sale.quantity} {sale.unit} @ {formatMoney(sale.rate)}
                        </div>
                        <div className="text-[10px] font-bold text-foreground font-mono">
                          {formatMoney(sale.amount)}
                        </div>
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
