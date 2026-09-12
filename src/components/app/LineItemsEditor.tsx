import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { db, type LineItem, type Product } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { computeLine, computeTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";

export function LineItemsEditor({
  items, onChange, mode = "sales", isIgst = false,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  mode?: "sales" | "purchase";
  isIgst?: boolean;
}) {
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const totals = computeTotals(items, isIgst);

  function update(i: number, patch: Partial<LineItem>) {
    const next = [...items];
    next[i] = computeLine({ ...next[i], ...patch });
    onChange(next);
  }
  function pickProduct(i: number, productId: string) {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    update(i, {
      productId: p.id, name: p.name, hsn: p.hsn, unit: p.unit,
      rate: mode === "sales" ? p.sellingPrice : p.purchasePrice, gstRate: p.gstRate,
    });
  }
  function addRow() { onChange([...items, computeLine({ productId: "", name: "", quantity: 1, rate: 0, discountPct: 0, gstRate: 0, unit: "pcs" })]); }
  function removeRow(i: number) { const n = [...items]; n.splice(i, 1); onChange(n); }

  return (
    <div className="space-y-3">
      <div className="space-y-3 sm:hidden">
        {items.length === 0 && (
          <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">No items. Tap "Add row" to begin.</div>
        )}
        {items.map((it, i) => (
          <div key={i} className="rounded-md border bg-card p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Item {i + 1}</div>
              <Button size="icon" variant="ghost" onClick={() => removeRow(i)} aria-label="Remove item"><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
            <div className="space-y-2">
              <Select value={it.productId || "custom"} onValueChange={v => v === "custom" ? update(i, { productId: "" }) : pickProduct(i, v)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom item</SelectItem>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-10" value={it.name} onChange={e => update(i, { name: e.target.value })} placeholder="Item name" />
              <div className="grid grid-cols-2 gap-2">
                <Input className="h-10" value={it.hsn ?? ""} onChange={e => update(i, { hsn: e.target.value })} placeholder="HSN" />
                <Input className="h-10" value={it.unit} onChange={e => update(i, { unit: e.target.value })} placeholder="Unit" />
                <Input className="h-10 text-right" type="number" step="0.01" value={it.quantity} onChange={e => update(i, { quantity: Number(e.target.value) })} placeholder="Qty" />
                <Input className="h-10 text-right" type="number" step="0.01" value={it.rate} onChange={e => update(i, { rate: Number(e.target.value) })} placeholder="Rate" />
                <Input className="h-10 text-right" type="number" step="0.01" value={it.discountPct} onChange={e => update(i, { discountPct: Number(e.target.value) })} placeholder="Disc%" />
                <Input className="h-10 text-right" type="number" step="0.01" value={it.gstRate} onChange={e => update(i, { gstRate: Number(e.target.value) })} placeholder="GST%" />
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono font-semibold">{formatMoney(it.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden max-w-full overflow-x-auto scrollbar-hidden rounded-md border sm:block">
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead className="w-[28%]">Product</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Disc%</TableHead>
              <TableHead className="text-right">GST%</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No items. Click "Add row" to begin.</TableCell></TableRow>}
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Select value={it.productId || "custom"} onValueChange={v => v === "custom" ? update(i, { productId: "" }) : pickProduct(i, v)}>
                    <SelectTrigger className="h-9 min-w-[180px]"><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom item</SelectItem>
                      {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input className="mt-1 h-8" value={it.name} onChange={e => update(i, { name: e.target.value })} placeholder="Description" />
                </TableCell>
                <TableCell><Input className="h-9 w-24" value={it.hsn ?? ""} onChange={e => update(i, { hsn: e.target.value })} /></TableCell>
                <TableCell><Input className="h-9 w-20 text-right" type="number" step="0.01" value={it.quantity} onChange={e => update(i, { quantity: Number(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-9 w-24 text-right" type="number" step="0.01" value={it.rate} onChange={e => update(i, { rate: Number(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-9 w-16 text-right" type="number" step="0.01" value={it.discountPct} onChange={e => update(i, { discountPct: Number(e.target.value) })} /></TableCell>
                <TableCell><Input className="h-9 w-16 text-right" type="number" step="0.01" value={it.gstRate} onChange={e => update(i, { gstRate: Number(e.target.value) })} /></TableCell>
                <TableCell className="text-right font-mono">{formatMoney(it.total)}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button variant="outline" size="sm" onClick={addRow} className="gap-2"><Plus className="h-4 w-4" /> Add row</Button>

      <div className="ml-auto grid w-full max-w-sm gap-1 rounded-md border bg-muted/30 p-3 text-sm">
        <Row label="Subtotal" v={formatMoney(totals.subtotal)} />
        <Row label="Discount" v={`- ${formatMoney(totals.discountTotal)}`} />
        {isIgst ? (
          <Row label="IGST" v={formatMoney(totals.igstTotal)} />
        ) : (
          <>
            <Row label="CGST" v={formatMoney(totals.cgstTotal)} />
            <Row label="SGST" v={formatMoney(totals.sgstTotal)} />
          </>
        )}
        <Row label="Round off" v={formatMoney(totals.roundOff)} />
        <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
          <span>Grand Total</span><span className="font-mono">{formatMoney(totals.grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="font-mono">{v}</span></div>;
}
