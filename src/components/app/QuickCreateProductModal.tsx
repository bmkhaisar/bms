import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { PackagePlus, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { db, uid, type Product, type Category, type PricingBasis, type ProductType } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { getAllUoms } from "@/modules/inventory/uomMaster";
import { createProductWithUniqueness } from "@/modules/inventory/productService";
import { detectProductDuplicates, type DuplicateMatch } from "@/modules/sync/searchNormalization";

interface QuickCreateProductProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductCreated: (product: Product) => void;
  defaultName?: string;
  defaultRate?: number;
}

export function QuickCreateProductModal({
  open,
  onOpenChange,
  onProductCreated,
  defaultName = "",
  defaultRate = 0,
}: QuickCreateProductProps) {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const categories = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const existingProducts = useLive<Product>(() => db().products.toArray());
  const allUoms = getAllUoms();

  const [saving, setSaving] = useState(false);
  const [forceCreate, setForceCreate] = useState(false);

  const [form, setForm] = useState({
    name: defaultName,
    sku: "",
    categoryId: "",
    productType: "stock_item" as ProductType,
    pricingBasis: "per_unit" as PricingBasis,
    unit: "PCS",
    hsn: "",
    gstRate: 18,
    sellingPrice: defaultRate || 0,
    purchasePrice: 0,
    openingStock: 0,
    reorderLevel: 5,
    trackInventory: true,
    aliases: "",
  });

  useEffect(() => {
    if (open) {
      setForm((prev) => ({
        ...prev,
        name: defaultName || prev.name,
        sellingPrice: defaultRate > 0 ? defaultRate : prev.sellingPrice,
      }));
      setForceCreate(false);
    }
  }, [defaultName, defaultRate, open]);

  // Adjust trackInventory and unit defaults based on productType & pricingBasis
  function handleTypeChange(val: ProductType) {
    setForm((prev) => ({
      ...prev,
      productType: val,
      trackInventory: val === "stock_item",
      pricingBasis: val === "service" ? "fixed" : prev.pricingBasis,
    }));
  }

  function handlePricingBasisChange(val: PricingBasis) {
    let suggestedUnit = form.unit;
    if (val === "per_area") suggestedUnit = "SQFT";
    else if (val === "per_length") suggestedUnit = "FT";
    else if (val === "per_weight") suggestedUnit = "KG";
    else if (val === "fixed") suggestedUnit = "JOB";

    setForm((prev) => ({
      ...prev,
      pricingBasis: val,
      unit: suggestedUnit,
    }));
  }

  // Tenant-scoped duplicate detection
  const duplicateCheck: DuplicateMatch<Product> = useMemo(() => {
    if (!form.name && !form.sku) return { isDuplicate: false, severity: "info" };
    return detectProductDuplicates(
      {
        name: form.name,
        sku: form.sku,
        aliases: form.aliases
          ? form.aliases.split(",").map((a) => a.trim()).filter(Boolean)
          : undefined,
      },
      existingProducts,
      activeCompany?.id
    );
  }, [form.name, form.sku, form.aliases, existingProducts, activeCompany?.id]);

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Product name is required");
      return;
    }

    if (duplicateCheck.isDuplicate && duplicateCheck.severity === "critical" && !forceCreate) {
      toast.error("Product with this SKU already exists. Review details or click Use Existing.");
      return;
    }

    setSaving(true);
    try {
      const productId = uid();
      const parsedAliases = form.aliases
        ? form.aliases.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      const sellingPriceNum = Number(form.sellingPrice) || 0;
      const purchasePriceNum = Number(form.purchasePrice) || 0;

      const newProduct: Product = {
        id: productId,
        name: trimmedName,
        sku: form.sku.trim() || undefined,
        categoryId: form.categoryId || undefined,
        productType: form.productType,
        pricingBasis: form.pricingBasis,
        unit: form.unit.trim() || "PCS",
        hsn: form.hsn.trim() || undefined,
        gstRate: Number(form.gstRate) || 0,
        sellingPrice: sellingPriceNum,
        purchasePrice: purchasePriceNum,
        defaultSalesRatePaise: Math.round(sellingPriceNum * 100),
        defaultPurchaseRatePaise: Math.round(purchasePriceNum * 100),
        openingStock: Number(form.openingStock) || 0,
        currentStock: Number(form.openingStock) || 0,
        reorderLevel: Number(form.reorderLevel) || 5,
        trackInventory: form.trackInventory,
        aliases: parsedAliases.length > 0 ? parsedAliases : undefined,
        createdAt: Date.now(),
        active: true,
      };

      // Concurrency-safe creation with uniqueness check
      if (activeCompany?.id && user?.uid) {
        const res = await createProductWithUniqueness({
          companyId: activeCompany.id,
          product: newProduct,
          uid: user.uid,
          clientMutationId: `mut_prod_${productId}`,
          allowDuplicate: forceCreate,
        });

        if (!res.success && res.conflictType) {
          toast.error(res.error || "Conflict detected");
          setSaving(false);
          return;
        }
      } else {
        await db().products.put(newProduct);
      }

      toast.success(`Product "${newProduct.name}" added to catalog`);
      onProductCreated(newProduct);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create product:", err);
      toast.error("Unable to create product. Invoice draft preserved. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <PackagePlus className="h-5 w-5 text-primary" /> Quick Add Product / Item
          </DialogTitle>
        </DialogHeader>

        {/* Duplicate Warning */}
        {duplicateCheck.isDuplicate && duplicateCheck.matchedItem && (
          <Alert className="my-1 border-amber-500/50 bg-amber-500/10 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="space-y-1">
              <AlertTitle className="text-xs font-semibold">Similar Product Found</AlertTitle>
              <AlertDescription className="text-xs">{duplicateCheck.message}</AlertDescription>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => {
                    if (duplicateCheck.matchedItem) {
                      onProductCreated(duplicateCheck.matchedItem);
                      onOpenChange(false);
                      toast.info(`Selected existing product "${duplicateCheck.matchedItem.name}"`);
                    }
                  }}
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Use Existing Product
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setForceCreate(true)}>
                  Create Anyway
                </Button>
              </div>
            </div>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 text-xs pt-1">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Product Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. ACP Wall Panel or Fabrication Service"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Product Type</Label>
            <Select value={form.productType} onValueChange={(v) => handleTypeChange(v as ProductType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stock_item">Stock Item (Inventory)</SelectItem>
                <SelectItem value="service">Service (No stock)</SelectItem>
                <SelectItem value="non_stock_item">Non-Stock Consumable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Pricing Basis</Label>
            <Select value={form.pricingBasis} onValueChange={(v) => handlePricingBasisChange(v as PricingBasis)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_unit">Per Unit (Standard Qty × Rate)</SelectItem>
                <SelectItem value="per_area">Per Area (Sq Ft / Sq M dimension math)</SelectItem>
                <SelectItem value="per_length">Per Length (Feet / Meter math)</SelectItem>
                <SelectItem value="per_weight">Per Weight (Kg / Ton math)</SelectItem>
                <SelectItem value="fixed">Fixed Rate (Lump sum)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Unit of Measurement (UOM)</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allUoms.map((u) => (
                  <SelectItem key={u.id} value={u.code}>
                    {u.code} — {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">SKU / Code</Label>
            <Input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="e.g. ACP-4MM-01"
              className="font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Default Selling Price (₹)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.sellingPrice || ""}
              onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) || 0 })}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Default Purchase Price (₹)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.purchasePrice || ""}
              onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) || 0 })}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">HSN / SAC Code</Label>
            <Input
              value={form.hsn}
              onChange={(e) => setForm({ ...form, hsn: e.target.value })}
              placeholder="e.g. 7606 / 9954"
              className="font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">GST Tax Profile (%)</Label>
            <Select value={String(form.gstRate)} onValueChange={(v) => setForm({ ...form, gstRate: Number(v) })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0% (Exempt)</SelectItem>
                <SelectItem value="5">5% GST</SelectItem>
                <SelectItem value="12">12% GST</SelectItem>
                <SelectItem value="18">18% GST (Standard)</SelectItem>
                <SelectItem value="28">28% GST</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Aliases / Keywords (comma separated)</Label>
            <Input
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              placeholder="e.g. GI Sheet, GI Plate, Galvanized Sheet"
            />
          </div>

          {form.productType === "stock_item" && (
            <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/20 sm:col-span-2">
              <div>
                <div className="font-semibold text-xs">Track Inventory Stock</div>
                <div className="text-[10px] text-muted-foreground">
                  Record Stock In on Purchases and Stock Out on Invoices
                </div>
              </div>
              <Switch
                checked={form.trackInventory}
                onCheckedChange={(c) => setForm({ ...form, trackInventory: c })}
              />
            </div>
          )}
        </div>

        <DialogFooter className="pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating Product…
              </>
            ) : (
              "Save Product to Catalog"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
