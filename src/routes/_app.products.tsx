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
import { PackagePlus, Pencil, Plus, Trash2, BarChart3, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, removeCachedEntity } from "@/modules/sync/dexieCache";
import { QuickCreateCategoryModal } from "@/components/app/QuickCreateCategoryModal";
import { ProductInsightDrawer } from "@/components/app/ProductInsightDrawer";
import { performOptimisticMutation } from "@/lib/mutationPipeline";
import { checkEntityHistoricalUsage, type HistoricalUsageResult } from "@/lib/historicalUsage";

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
  defaultDescription: "",
  active: true,
  createdAt: 0,
};

function ProductsPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Product>(() => db().products.orderBy("name").toArray());
  const [, setCloudRows] = useState<Product[]>([]);
  const cats = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ALL" | "INACTIVE">("ACTIVE");
  const [open, setOpen] = useState(false);
  const [openCatModal, setOpenCatModal] = useState(false);
  const [editing, setEditing] = useState<Product>(empty);
  const [saving, setSaving] = useState(false);
  const [selectedProductIdForDrawer, setSelectedProductIdForDrawer] = useState<string | null>(null);
  const [showPriceWarning, setShowPriceWarning] = useState(false);

  // Deletion / Deactivation modal target state
  const [deleteTarget, setDeleteTarget] = useState<{
    product: Product;
    usage: HistoricalUsageResult;
  } | null>(null);

  // The company-level ordered realtime synchronizer is the single read owner.
  const rows = dexieRows;

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

  const filtered = rows.filter((r) => {
    if (statusFilter === "ACTIVE" && r.active === false) return false;
    if (statusFilter === "INACTIVE" && r.active !== false) return false;

    const s = q.toLowerCase().trim();
    if (!s) return true;
    return (
      r.name.toLowerCase().includes(s) ||
      (r.sku ?? "").toLowerCase().includes(s) ||
      (r.hsn ?? "").toLowerCase().includes(s)
    );
  });

  const pager = usePagination(filtered);

  async function promptDelete(product: Product) {
    const usage = await checkEntityHistoricalUsage({
      entityType: "product",
      entityId: product.id,
    });
    setDeleteTarget({ product, usage });
  }

  async function removePermanent(product: Product) {
    await performOptimisticMutation<Product>({
      entityType: "product",
      entityId: product.id,
      action: "delete",
      companyId: activeCompany?.id,
      uid: user?.uid,
      capturePreviousState: () => product,
      onOptimistic: () => {
        // Immediate UI removal
        setCloudRows((prev) => prev.filter((p) => p.id !== product.id));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => [prev, ...list]);
        }
      },
      syncDexie: async () => {
        await db().products.delete(product.id);
        if (activeCompany?.id) {
          await removeCachedEntity({
            companyId: activeCompany.id,
            entityType: "product",
            entityId: product.id,
          });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().products.put(prev);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "product",
              entityId: prev.id,
              data: prev,
            });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${product.id}`);
          await rtdbRemove(prodRef);
        }
      },
      queryKeys: [
        ["products", activeCompany?.id],
        ["dashboard", activeCompany?.id],
      ],
      successToast: "Product deleted",
      errorToast: "Couldn't delete this product. It has been restored.",
    });
  }

  async function deactivateProduct(product: Product) {
    const deactivatedProduct: Product = { ...product, active: false };

    await performOptimisticMutation<Product>({
      entityType: "product",
      entityId: product.id,
      action: "deactivate",
      companyId: activeCompany?.id,
      uid: user?.uid,
      optimisticData: deactivatedProduct,
      capturePreviousState: () => product,
      onOptimistic: () => {
        setCloudRows((prev) =>
          prev.map((p) => (p.id === product.id ? deactivatedProduct : p))
        );
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) =>
            list.map((p) => (p.id === prev.id ? prev : p))
          );
        }
      },
      syncDexie: async () => {
        await db().products.put(deactivatedProduct);
        if (activeCompany?.id && user?.uid) {
          await cacheEntity({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "product",
            entityId: deactivatedProduct.id,
            data: deactivatedProduct,
          });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().products.put(prev);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "product",
              entityId: prev.id,
              data: prev,
            });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${product.id}`);
          await set(prodRef, sanitizeForFirebase(deactivatedProduct));
        }
      },
      queryKeys: [
        ["products", activeCompany?.id],
        ["dashboard", activeCompany?.id],
      ],
      successToast: `Product "${product.name}" deactivated`,
      errorToast: "Couldn't deactivate product. Changes were reverted.",
    });
  }

  function handleSaveClick() {
    if (!editing.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    const price = Number(editing.sellingPrice);
    if (!price || price <= 0) {
      setShowPriceWarning(true);
      return;
    }
    saveProduct();
  }

  async function saveProduct() {
    setShowPriceWarning(false);
    setSaving(true);
    try {
      const productToSave: Product = {
        ...editing,
        name: editing.name.trim(),
        sku: editing.sku?.trim() || undefined,
        hsn: editing.hsn?.trim() || undefined,
        active: editing.active !== false,
      };

      const isNew =
        !rows.some((p) => p.id === productToSave.id) &&
        !dexieRows.some((p) => p.id === productToSave.id);

      await performOptimisticMutation<Product>({
        entityType: "product",
        entityId: productToSave.id,
        action: isNew ? "create" : "update",
        companyId: activeCompany?.id,
        uid: user?.uid,
        optimisticData: productToSave,
        onOptimistic: () => {
          setCloudRows((prev) => {
            const exists = prev.some((p) => p.id === productToSave.id);
            if (exists) {
              return prev.map((p) => (p.id === productToSave.id ? productToSave : p));
            } else {
              return [productToSave, ...prev];
            }
          });
        },
        onRollback: (prev) => {
          setCloudRows((prevList) => {
            if (isNew) {
              return prevList.filter((p) => p.id !== productToSave.id);
            } else if (prev) {
              return prevList.map((p) => (p.id === prev.id ? prev : p));
            }
            return prevList;
          });
        },
        syncDexie: async () => {
          await db().products.put(productToSave);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "product",
              entityId: productToSave.id,
              data: productToSave,
            });
          }
        },
        rollbackDexie: async (prev) => {
          if (isNew) {
            await db().products.delete(productToSave.id);
            if (activeCompany?.id) {
              await removeCachedEntity({
                companyId: activeCompany.id,
                entityType: "product",
                entityId: productToSave.id,
              });
            }
          } else if (prev) {
            await db().products.put(prev);
          }
        },
        serverMutation: async () => {
          if (activeCompany?.id && firebaseDb) {
            const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${productToSave.id}`);
            await set(prodRef, sanitizeForFirebase(productToSave));
          }
        },
        queryKeys: [
          ["products", activeCompany?.id],
          ["dashboard", activeCompany?.id],
        ],
        successToast: isNew ? "Product saved to catalog" : "Product updated",
        errorToast: "Unable to save product. Please check your connection.",
      });

      setOpen(false);
    } catch (err) {
      console.error("Failed to save product:", err);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => r.active !== false).length;
  const inactiveCount = rows.filter((r) => r.active === false).length;

  return (
    <AppShell title="Products">
      <PageHeader
        title="Products & Inventory"
        description="Catalog items with unified pricing, HSN codes, GST rates, and stock monitoring."
        actions={
          <Button
            className="gap-2 shadow-sm"
            onClick={() => {
              setEditing({ ...empty, id: uid(), createdAt: Date.now() });
              setOpen(true);
            }}
          >
            <PackagePlus className="h-4 w-4" /> Add product
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex-1">
          <ListToolbar
            query={q}
            onQuery={setQ}
            placeholder="Search by name, SKU, or HSN…"
          />
        </div>
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as any)}
          className="w-full sm:w-auto"
        >
          <TabsList className="h-9 w-full sm:w-auto text-xs grid grid-cols-3">
            <TabsTrigger value="ACTIVE">Active ({activeCount})</TabsTrigger>
            <TabsTrigger value="ALL">All ({rows.length})</TabsTrigger>
            <TabsTrigger value="INACTIVE">Inactive ({inactiveCount})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === "INACTIVE" ? "No inactive products" : "No products found"}
          description={
            statusFilter === "INACTIVE"
              ? "All products are currently active."
              : q
              ? `No products matching "${q}".`
              : "Add products with pricing, GST and stock levels."
          }
          action={
            statusFilter !== "INACTIVE" && !q ? (
              <Button
                className="mt-2 gap-2"
                onClick={() => {
                  setEditing({ ...empty, id: uid(), createdAt: Date.now() });
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add product
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30 text-[11px] font-semibold text-muted-foreground uppercase border-b border-border/70">
                  <TableHead>Name</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">GST%</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Sell</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((r) => {
                  const low = r.trackInventory !== false && r.currentStock <= r.reorderLevel;
                  const isInactive = r.active === false;
                  return (
                    <TableRow key={r.id} className={isInactive ? "opacity-60 bg-muted/20" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedProductIdForDrawer(r.id)}
                            className="text-left font-semibold text-foreground hover:text-primary hover:underline"
                          >
                            {r.name}
                          </button>
                          {isInactive && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        {r.sku ? <div className="text-xs text-muted-foreground">{r.sku}</div> : null}
                        {(r.defaultDescription || r.description) ? (
                          <div className="text-[11px] text-muted-foreground/80 line-clamp-1 max-w-sm truncate" title={r.defaultDescription || r.description}>
                            {r.defaultDescription || r.description}
                          </div>
                        ) : null}
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
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="View Product Performance & Stock"
                            onClick={() => setSelectedProductIdForDrawer(r.id)}
                          >
                            <BarChart3 className="h-3.5 w-3.5 text-primary" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit Product"
                            onClick={() => {
                              setEditing({ ...r });
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title={isInactive ? "Delete Product" : "Delete or Deactivate Product"}
                            onClick={() => promptDelete(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
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

      {/* Product Edit / Create Modal */}
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
              <F label="Default Technical Description (Auto-fills into Quotations & Invoices)">
                <Textarea
                  rows={4}
                  value={editing.defaultDescription ?? editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, defaultDescription: e.target.value, description: e.target.value })}
                  placeholder="e.g. MS Portable Site Office Cabin with interior MDF board cladding, UPVC sliding two-track windows 3'x3'... with all necessary internal wiring and electrical fittings."
                  className="text-xs leading-relaxed font-normal"
                />
              </F>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Saving…
                </>
              ) : (
                "Save Product"
              )}
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

      {/* Target-Specific Confirmation Dialog for Delete / Deactivate */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={
          deleteTarget?.usage.hasHistory
            ? `Deactivate "${deleteTarget.product.name}"?`
            : `Delete "${deleteTarget?.product.name}"?`
        }
        description={
          deleteTarget?.usage.hasHistory
            ? deleteTarget.usage.reason
            : `"${deleteTarget?.product.name}" will be permanently removed from active Products.`
        }
        destructive={!deleteTarget?.usage.hasHistory}
        confirmText={deleteTarget?.usage.hasHistory ? "Deactivate" : "Delete Product"}
        busyText={deleteTarget?.usage.hasHistory ? "Deactivating…" : "Deleting…"}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.usage.hasHistory) {
            await deactivateProduct(deleteTarget.product);
          } else {
            await removePermanent(deleteTarget.product);
          }
          setDeleteTarget(null);
        }}
      />

      <ConfirmDialog
        open={showPriceWarning}
        onOpenChange={setShowPriceWarning}
        title="Selling price is not set."
        description="Future invoices will require the rate to be entered manually."
        cancelText="Go Back"
        confirmText="Save Without Price"
        onConfirm={async () => {
          await saveProduct();
        }}
      />

      <ProductInsightDrawer
        productId={selectedProductIdForDrawer}
        open={Boolean(selectedProductIdForDrawer)}
        onOpenChange={(o) => !o && setSelectedProductIdForDrawer(null)}
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
