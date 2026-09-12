import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Product, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ListToolbar, EmptyState, usePagination, Pager } from "@/components/app/ListHelpers";
import { PackagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "Products — Business Management" }] }),
  component: ProductsPage,
});

const empty: Product = { id: "", name: "", sku: "", categoryId: "", unit: "pcs", hsn: "", gstRate: 18, purchasePrice: 0, sellingPrice: 0, openingStock: 0, currentStock: 0, reorderLevel: 5, description: "", createdAt: 0 };

function ProductsPage() {
  const rows = useLive<Product>(() => db().products.orderBy("name").toArray());
  const cats = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Deep-link support: auto-filter and open product editor if id or q present in URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    const idParam = params.get("id");
    if (queryParam) setQ(queryParam);
    if (idParam && rows.length > 0) {
      const match = rows.find((r) => r.id === idParam);
      if (match) {
        setEditing({ ...match });
        setOpen(true);
      }
    }
  }, [rows]);

  const filtered = rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.sku ?? "").toLowerCase().includes(q.toLowerCase()));
  const pager = usePagination(filtered);

  return (
    <AppShell title="Products">
      <PageHeader title="Products & Stock" actions={<Button className="gap-2" onClick={() => { setEditing({ ...empty, id: uid(), createdAt: Date.now() }); setOpen(true); }}><PackagePlus className="h-4 w-4" /> Add product</Button>} />
      <ListToolbar query={q} onQuery={setQ} placeholder="Search by name or SKU…" />
      {rows.length === 0 ? (
        <EmptyState title="No products yet" description="Add products with pricing, GST and stock levels." action={<Button className="mt-2 gap-2" onClick={() => { setEditing({ ...empty, id: uid(), createdAt: Date.now() }); setOpen(true); }}><Plus className="h-4 w-4" /> Add product</Button>} />
      ) : (
        <Card className="card-soft overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>HSN</TableHead><TableHead className="text-right">GST%</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Sell</TableHead>
                <TableHead className="text-right">Stock</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pager.items.map(r => {
                  const low = r.currentStock <= r.reorderLevel;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.sku}</div></TableCell>
                      <TableCell className="font-mono text-xs">{r.hsn}</TableCell>
                      <TableCell className="text-right">{r.gstRate}%</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.purchasePrice)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.sellingPrice)}</TableCell>
                      <TableCell className={`text-right font-mono ${low ? "text-amber-600 font-semibold" : ""}`}>{r.currentStock} {r.unit}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing({ ...r }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      <Pager {...pager} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{rows.find(r => r.id === editing.id) ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Name *"><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></F>
            <F label="SKU"><Input value={editing.sku ?? ""} onChange={e => setEditing({ ...editing, sku: e.target.value })} /></F>
            <F label="Category">
              <Select value={editing.categoryId || "none"} onValueChange={v => setEditing({ ...editing, categoryId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Unit"><Input value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} /></F>
            <F label="HSN"><Input value={editing.hsn ?? ""} onChange={e => setEditing({ ...editing, hsn: e.target.value })} /></F>
            <F label="GST %"><Input type="number" step="0.01" value={editing.gstRate} onChange={e => setEditing({ ...editing, gstRate: Number(e.target.value) })} /></F>
            <F label="Purchase Price"><Input type="number" step="0.01" value={editing.purchasePrice} onChange={e => setEditing({ ...editing, purchasePrice: Number(e.target.value) })} /></F>
            <F label="Selling Price"><Input type="number" step="0.01" value={editing.sellingPrice} onChange={e => setEditing({ ...editing, sellingPrice: Number(e.target.value) })} /></F>
            <F label="Opening Stock"><Input type="number" step="0.01" value={editing.openingStock} onChange={e => setEditing({ ...editing, openingStock: Number(e.target.value), currentStock: rows.find(r => r.id === editing.id) ? editing.currentStock : Number(e.target.value) })} /></F>
            <F label="Current Stock"><Input type="number" step="0.01" value={editing.currentStock} onChange={e => setEditing({ ...editing, currentStock: Number(e.target.value) })} /></F>
            <F label="Reorder Level"><Input type="number" step="0.01" value={editing.reorderLevel} onChange={e => setEditing({ ...editing, reorderLevel: Number(e.target.value) })} /></F>
            <div className="sm:col-span-2"><F label="Description"><Textarea rows={2} value={editing.description ?? ""} onChange={e => setEditing({ ...editing, description: e.target.value })} /></F></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!editing.name.trim()) { toast.error("Name required"); return; }
              await db().products.put(editing);
              toast.success("Product saved"); setOpen(false);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)} title="Delete product?" destructive confirmText="Delete" onConfirm={async () => { if (deleteId) { await db().products.delete(deleteId); toast.success("Deleted"); } }} />
    </AppShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>);
}
