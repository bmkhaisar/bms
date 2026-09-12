import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { db, uid, type Product, type Category } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";

interface QuickCreateProductProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductCreated: (product: Product) => void;
  defaultName?: string;
}

export function QuickCreateProductModal({
  open,
  onOpenChange,
  onProductCreated,
  defaultName = "",
}: QuickCreateProductProps) {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const categories = useLive<Category>(() => db().categories.orderBy("name").toArray());
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: defaultName,
    sku: "",
    categoryId: "",
    unit: "pcs",
    hsn: "",
    gstRate: 18,
    sellingPrice: 0,
    purchasePrice: 0,
    openingStock: 0,
    reorderLevel: 5,
    trackInventory: true,
  });

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Product name is required");
      return;
    }

    setSaving(true);
    try {
      const productId = uid();
      const newProduct: Product = {
        id: productId,
        name: trimmedName,
        sku: form.sku.trim() || undefined,
        categoryId: form.categoryId || undefined,
        unit: form.unit.trim() || "pcs",
        hsn: form.hsn.trim() || undefined,
        gstRate: Number(form.gstRate) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        openingStock: Number(form.openingStock) || 0,
        currentStock: Number(form.openingStock) || 0,
        reorderLevel: Number(form.reorderLevel) || 5,
        trackInventory: form.trackInventory,
        createdAt: Date.now(),
      };

      // 1. Cloud write to Firebase RTDB
      if (activeCompany?.id && firebaseDb) {
        const prodRef = ref(firebaseDb, `companyData/${activeCompany.id}/products/${productId}`);
        await set(prodRef, sanitizeForFirebase(newProduct));
      }

      // 2. Cache in local Dexie bms_cache_v1
      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "product",
          entityId: productId,
          data: newProduct,
        });
      }

      // 3. Update legacy Dexie table
      await db().products.put(newProduct);

      toast.success(`Product "${newProduct.name}" added to catalog`);
      onProductCreated(newProduct);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create product:", err);
      toast.error("Unable to create product. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-primary" /> Quick Add Product / Item
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Product / Item Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mild Steel Sheet 2mm or Consultation Service"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">SKU / Item Code</Label>
            <Input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="e.g. MS-2MM-01"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select
              value={form.categoryId || "none"}
              onValueChange={(v) => setForm({ ...form, categoryId: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">HSN / SAC Code</Label>
            <Input
              value={form.hsn}
              onChange={(e) => setForm({ ...form, hsn: e.target.value })}
              placeholder="7208"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">GST Rate (%)</Label>
            <Select
              value={String(form.gstRate)}
              onValueChange={(v) => setForm({ ...form, gstRate: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0% (Nil / Exempt)</SelectItem>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="12">12%</SelectItem>
                <SelectItem value="18">18% (Standard)</SelectItem>
                <SelectItem value="28">28% (Luxury/Demerit)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Selling Price (₹)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.sellingPrice || ""}
              onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) || 0 })}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Purchase Price (₹)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.purchasePrice || ""}
              onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) || 0 })}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Unit of Measure</Label>
            <Input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="pcs, kg, mtr, set"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Initial Opening Stock</Label>
            <Input
              type="number"
              step="0.01"
              value={form.openingStock || ""}
              onChange={(e) => setForm({ ...form, openingStock: Number(e.target.value) || 0 })}
              placeholder="0"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Add & Select Product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
