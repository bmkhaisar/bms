import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { db, type LineItem, type Product } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { computeLine, computeTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import { Plus, Trash2, PackagePlus } from "lucide-react";
import { QuickCreateProductModal } from "./QuickCreateProductModal";

export function LineItemsEditor({
  items,
  onChange,
  mode = "sales",
  isIgst = false,
  enableGst = true,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  mode?: "sales" | "purchase";
  isIgst?: boolean;
  enableGst?: boolean;
}) {
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const totals = computeTotals(items, isIgst, { enableGst });
  const [quickAddIndex, setQuickAddIndex] = useState<number | null>(null);
  const [openProductModal, setOpenProductModal] = useState(false);

  function update(i: number, patch: Partial<LineItem>) {
    const next = [...items];
    next[i] = computeLine({ ...next[i], ...patch });
    onChange(next);
  }

  function pickProduct(i: number, productId: string) {
    if (productId === "__new__") {
      setQuickAddIndex(i);
      setOpenProductModal(true);
      return;
    }
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    update(i, {
      productId: p.id,
      name: p.name,
      hsn: p.hsn,
      unit: p.unit,
      rate: mode === "sales" ? p.sellingPrice : p.purchasePrice,
      gstRate: enableGst ? p.gstRate : 0,
    });
  }

  function addRow() {
    onChange([
      ...items,
      computeLine({
        productId: "",
        name: "",
        quantity: 1,
        rate: 0,
        discountPct: 0,
        gstRate: enableGst ? 18 : 0,
        unit: "pcs",
      }),
    ]);
  }

  function removeRow(i: number) {
    const n = [...items];
    n.splice(i, 1);
    onChange(n);
  }

  return (
    <div className="space-y-3">
      {/* Mobile Card View */}
      <div className="space-y-3 sm:hidden">
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
            No items. Tap "Add line item" to begin.
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border bg-card/90 backdrop-blur p-3 shadow-sm space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-foreground">Item {i + 1}</div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeRow(i)}
                aria-label="Remove item"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="space-y-2">
              <Select
                value={it.productId || "custom"}
                onValueChange={(v) =>
                  v === "custom"
                    ? update(i, { productId: "" })
                    : pickProduct(i, v)
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom Line Item</SelectItem>
                  <SelectItem value="__new__" className="text-primary font-semibold">
                    + Add New Product...
                  </SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-9"
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Item name / description"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  className="h-9"
                  value={it.hsn ?? ""}
                  onChange={(e) => update(i, { hsn: e.target.value })}
                  placeholder="HSN/SAC"
                />
                <Input
                  className="h-9"
                  value={it.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  placeholder="Unit"
                />
                <Input
                  className="h-9 text-right"
                  type="number"
                  step="0.01"
                  value={it.quantity}
                  onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                  placeholder="Qty"
                />
                <Input
                  className="h-9 text-right"
                  type="number"
                  step="0.01"
                  value={it.rate}
                  onChange={(e) => update(i, { rate: Number(e.target.value) })}
                  placeholder="Rate (₹)"
                />
                <Input
                  className="h-9 text-right"
                  type="number"
                  step="0.01"
                  value={it.discountPct}
                  onChange={(e) => update(i, { discountPct: Number(e.target.value) })}
                  placeholder="Disc %"
                />
                {enableGst && (
                  <Select
                    value={String(it.gstRate)}
                    onValueChange={(v) => update(i, { gstRate: Number(v) })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="GST%" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="5">5%</SelectItem>
                      <SelectItem value="12">12%</SelectItem>
                      <SelectItem value="18">18%</SelectItem>
                      <SelectItem value="28">28%</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Line Total</span>
                <span className="font-mono font-semibold text-foreground">
                  {formatMoney(it.total)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden max-w-full overflow-x-auto scrollbar-hidden rounded-xl border border-border/60 bg-card/85 backdrop-blur sm:block">
        <Table className="min-w-[760px] text-xs">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[30%]">Product / Description</TableHead>
              <TableHead className="w-24">HSN/SAC</TableHead>
              <TableHead className="w-20 text-right">Qty</TableHead>
              <TableHead className="w-24 text-right">Rate (₹)</TableHead>
              <TableHead className="w-20 text-right">Disc %</TableHead>
              {enableGst && <TableHead className="w-24 text-right">GST %</TableHead>}
              <TableHead className="text-right">Line Total</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={enableGst ? 8 : 7}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  No items. Click "Add line item" to start billing.
                </TableCell>
              </TableRow>
            )}
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Select
                    value={it.productId || "custom"}
                    onValueChange={(v) =>
                      v === "custom"
                        ? update(i, { productId: "" })
                        : pickProduct(i, v)
                    }
                  >
                    <SelectTrigger className="h-8 min-w-[180px]">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom Line Item</SelectItem>
                      <SelectItem value="__new__" className="text-primary font-semibold">
                        + Add New Product...
                      </SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="mt-1 h-7 text-xs"
                    value={it.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Item description"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-20 font-mono text-xs"
                    value={it.hsn ?? ""}
                    onChange={(e) => update(i, { hsn: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-16 text-right font-mono text-xs"
                    type="number"
                    step="0.01"
                    value={it.quantity}
                    onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-20 text-right font-mono text-xs"
                    type="number"
                    step="0.01"
                    value={it.rate}
                    onChange={(e) => update(i, { rate: Number(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-16 text-right font-mono text-xs"
                    type="number"
                    step="0.01"
                    value={it.discountPct}
                    onChange={(e) => update(i, { discountPct: Number(e.target.value) })}
                  />
                </TableCell>
                {enableGst && (
                  <TableCell>
                    <Select
                      value={String(it.gstRate)}
                      onValueChange={(v) => update(i, { gstRate: Number(v) })}
                    >
                      <SelectTrigger className="h-8 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">0%</SelectItem>
                        <SelectItem value="5">5%</SelectItem>
                        <SelectItem value="12">12%</SelectItem>
                        <SelectItem value="18">18%</SelectItem>
                        <SelectItem value="28">28%</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                )}
                <TableCell className="text-right font-mono font-medium">
                  {formatMoney(it.total)}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRow} className="gap-2">
            <Plus className="h-4 w-4" /> Add line item
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuickAddIndex(items.length);
              setOpenProductModal(true);
            }}
            className="gap-1.5 text-xs text-primary"
          >
            <PackagePlus className="h-3.5 w-3.5" /> New Product
          </Button>
        </div>

        {/* Calculation Summary Box */}
        <div className="ml-auto grid w-full max-w-sm gap-1 rounded-xl border border-border/60 bg-card/85 backdrop-blur p-3 text-xs">
          <Row label="Subtotal" v={formatMoney(totals.subtotal)} />
          {totals.discountTotal > 0 && (
            <Row label="Discount" v={`- ${formatMoney(totals.discountTotal)}`} />
          )}
          {enableGst && (
            <>
              {isIgst ? (
                <Row label="IGST (Inter-state)" v={formatMoney(totals.igstTotal)} />
              ) : (
                <>
                  <Row label="CGST" v={formatMoney(totals.cgstTotal)} />
                  <Row label="SGST" v={formatMoney(totals.sgstTotal)} />
                </>
              )}
            </>
          )}
          {totals.roundOff !== 0 && (
            <Row label="Round off" v={formatMoney(totals.roundOff)} />
          )}
          <div className="mt-1 flex justify-between border-t pt-2 text-sm font-bold">
            <span>Grand Total</span>
            <span className="font-mono text-primary">{formatMoney(totals.grandTotal)}</span>
          </div>
        </div>
      </div>

      <QuickCreateProductModal
        open={openProductModal}
        onOpenChange={setOpenProductModal}
        onProductCreated={(product) => {
          if (quickAddIndex !== null && quickAddIndex < items.length) {
            update(quickAddIndex, {
              productId: product.id,
              name: product.name,
              hsn: product.hsn,
              unit: product.unit,
              rate: mode === "sales" ? product.sellingPrice : product.purchasePrice,
              gstRate: enableGst ? product.gstRate : 0,
            });
          } else {
            // Append as new row
            onChange([
              ...items,
              computeLine({
                productId: product.id,
                name: product.name,
                hsn: product.hsn,
                unit: product.unit,
                quantity: 1,
                rate: mode === "sales" ? product.sellingPrice : product.purchasePrice,
                discountPct: 0,
                gstRate: enableGst ? product.gstRate : 0,
              }),
            ]);
          }
          setQuickAddIndex(null);
        }}
      />
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
