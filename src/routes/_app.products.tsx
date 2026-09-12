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
import { PackagePlus, Pencil, Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, onValue, off, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, cacheEntitiesBulk, getCachedEntities, removeCachedEntity } from "@/modules/sync/dexieCache";
import { QuickCreateCategoryModal } from "@/components/app/QuickCreateCategoryModal";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "Products — BMS NEXT" }] }),
  component: ProductsPage,
});

const empty: Product = {
  id: "",
  name: "",
  sku: "",
  categoryId: "",
  unit: "pcs",
  hsn: "",
  gstRate: 18,
  purchasePrice: 0,
  sellingPrice: 0,
  openingStock: 0,
  currentStock: 0,
  reorderLevel: 5,
  trackInventory: true,
  description: "",
  createdAt: 0,
};

function ProductsPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Product>(() => db().products.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Product[]>([]);
  const cats = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [openCatModal, setOpenCatModal] = useState(false);
  const [editing, setEditing] = useState<Product>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 1. Initial cached retrieval + Realtime Firebase synchronization
  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    // Load from Dexie cache immediately for fast startup
    getCachedEntities<Product>({
      uid: user.uid,
      companyId: activeCompany.id,
      entityType: "product",
    }).then((cached) => {
      if (active && cached.length > 0) {
        setCloudRows(cached);
      }
    });

    if (!firebaseDb) return;

    const productsRef = ref(firebaseDb, `companyData/${activeCompany.id}/products`);
    const onData = (snap: any) => {
      if (!active) return;
      if (snap.exists()) {
        const val = snap.val();
        const list: Product[] = Object.values(val);
        setCloudRows(list);

        // Update Dexie cache in background
        cacheEntitiesBulk(
          list.map((p) => ({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "product",
            entityId: p.id,
            data: p,
          }))
        );

        // Sync into local legacy Dexie store
        for (const p of list) {
          db().products.put(p);
        }
      } else {
        setCloudRows([]);
      }
    };

    onValue(productsRef, onData);

    return () => {
      active = false;
      off(productsRef, "value", onData);
    };
  }, [activeCompany?.id, user?.uid]);

  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

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

  const filtered = rows.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.sku ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.hsn ?? "").toLowerCase().includes(q.toLowerCase())
  );
  const pager = usePagination(filtered);

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    setSaving(true);
    try {
      const productToSave: Product = {
        ...editing,
        name: editing.name.trim(),
        sku: editing.sku?.trim() || undefined,
        hsn: editing.hsn?.trim() || undefined,
      };

      // 1. Save to Firebase RTDB
      if (activeCompany?.id && firebaseDb) {
        const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${productToSave.id}`);
        await set(prodRef, sanitizeForFirebase(productToSave));
      }

      // 2. Cache in local Dexie bms_cache_v1
      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "product",
          entityId: productToSave.id,
          data: productToSave,
        });
      }

      // 3. Keep local legacy Dexie database updated
      await db().products.put(productToSave);

      toast.success("Product saved to catalog");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save product:", err);
      toast.error("Unable to save product. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      if (activeCompany?.id && firebaseDb) {
        const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${id}`);
        await rtdbRemove(prodRef);
      }
      if (activeCompany?.id) {
        await removeCachedEntity({
          companyId: activeCompany.id,
          entityType: "product",
          entityId: id,
        });
      }
      await db().products.delete(id);
      toast.success("Product deleted");
    } catch (err) {
      console.error("Failed to delete product:", err);
      toast.error("Unable to delete product");
    }
  }

  return (
    <AppShell title="Products">
      <PageHeader
        title="Products & Inventory"
        description="Catalog items with unified pricing, HSN codes, GST rates, and stock monitoring."
        actions={
          <Button
            className="gap-2"
            onClick={() => {
              setEditing({ ...empty, id: uid(), createdAt: Date.now() });
              setOpen(true);
            }}
          >
            <PackagePlus className="h-4 w-4" /> Add product
          </Button>
        }
      />
      <ListToolbar query={q} onQuery={setQ} placeholder="Search by name, SKU, or HSN…" />
      {rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add products with pricing, GST and stock levels."
          action={
            <Button
              className="mt-2 gap-2"
              onClick={() => {
                setEditing({ ...empty, id: uid(), createdAt: Date.now() });
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add product
            </Button>
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">GST%</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Sell</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((r) => {
                  const low = r.trackInventory !== false && r.currentStock <= r.reorderLevel;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.sku ? <div className="text-xs text-muted-foreground">{r.sku}</div> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.hsn || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{r.gstRate}%</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.purchasePrice)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.sellingPrice)}</TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          low ? "text-amber-600 dark:text-amber-400 font-semibold" : ""
                        }`}
                      >
                        {r.trackInventory === false ? "Non-stock" : `${r.currentStock} ${r.unit}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing({ ...r });
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {rows.find((r) => r.id === editing.id) ? "Edit Product" : "Add Product"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <F label="Name *">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Product name"
              />
            </F>
            <F label="SKU / Item Code">
              <Input
                value={editing.sku ?? ""}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                placeholder="Unique SKU"
              />
            </F>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Category</Label>
                <button
                  type="button"
                  onClick={() => setOpenCatModal(true)}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> New
                </button>
              </div>
              <Select
                value={editing.categoryId || "none"}
                onValueChange={(v) => setEditing({ ...editing, categoryId: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {cats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <F label="Unit of Measure">
              <Input
                value={editing.unit}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                placeholder="pcs, kg, mtr, set"
              />
            </F>
            <F label="HSN / SAC Code">
              <Input
                value={editing.hsn ?? ""}
                onChange={(e) => setEditing({ ...editing, hsn: e.target.value })}
                placeholder="4 or 6 digit code"
              />
            </F>
            <F label="GST Rate (%)">
              <Select
                value={String(editing.gstRate)}
                onValueChange={(v) => setEditing({ ...editing, gstRate: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0% (Nil / Exempt)</SelectItem>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="12">12%</SelectItem>
                  <SelectItem value="18">18% (Standard)</SelectItem>
                  <SelectItem value="28">28%</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Purchase Price (Cost)">
              <Input
                type="number"
                step="0.01"
                value={editing.purchasePrice || ""}
                onChange={(e) => setEditing({ ...editing, purchasePrice: Number(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </F>
            <F label="Selling Price (MRP / Bill)">
              <Input
                type="number"
                step="0.01"
                value={editing.sellingPrice || ""}
                onChange={(e) => setEditing({ ...editing, sellingPrice: Number(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </F>
            <F label="Opening Stock">
              <Input
                type="number"
                step="0.01"
                value={editing.openingStock || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    openingStock: Number(e.target.value) || 0,
                    currentStock: rows.find((r) => r.id === editing.id)
                      ? editing.currentStock
                      : Number(e.target.value) || 0,
                  })
                }
                placeholder="0"
              />
            </F>
            <F label="Current Stock">
              <Input
                type="number"
                step="0.01"
                value={editing.currentStock || ""}
                onChange={(e) => setEditing({ ...editing, currentStock: Number(e.target.value) || 0 })}
                placeholder="0"
              />
            </F>
            <F label="Reorder Alert Level">
              <Input
                type="number"
                step="0.01"
                value={editing.reorderLevel || ""}
                onChange={(e) => setEditing({ ...editing, reorderLevel: Number(e.target.value) || 0 })}
                placeholder="5"
              />
            </F>
            <div className="sm:col-span-2">
              <F label="Description & Notes">
                <Textarea
                  rows={2}
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Technical details, specifications"
                />
              </F>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickCreateCategoryModal
        open={openCatModal}
        onOpenChange={setOpenCatModal}
        onCategoryCreated={(newCat) => {
          setEditing({ ...editing, categoryId: newCat.id });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete product?"
        description="This will remove the product from the catalog. Historical transactions and ledgers will remain protected."
        destructive
        confirmText="Delete"
        onConfirm={async () => {
          if (deleteId) await remove(deleteId);
          setDeleteId(null);
        }}
      />
    </AppShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
