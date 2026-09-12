import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tags } from "lucide-react";
import { db, uid, type Category } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";

interface QuickCreateCategoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCategoryCreated: (category: Category) => void;
  defaultName?: string;
}

export function QuickCreateCategoryModal({
  open,
  onOpenChange,
  onCategoryCreated,
  defaultName = "",
}: QuickCreateCategoryProps) {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Category name is required");
      return;
    }

    setSaving(true);
    try {
      const categoryId = uid();
      const newCat: Category = {
        id: categoryId,
        name: trimmed,
        createdAt: Date.now(),
      };

      // 1. Cloud write to Firebase RTDB
      if (activeCompany?.id && firebaseDb) {
        const catRef = ref(firebaseDb, `companyData/${activeCompany.id}/categories/${categoryId}`);
        await set(catRef, sanitizeForFirebase(newCat));
      }

      // 2. Cache in local Dexie bms_cache_v1
      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "category",
          entityId: categoryId,
          data: newCat,
        });
      }

      // 3. Update legacy Dexie table
      await db().categories.put(newCat);

      toast.success(`Category "${newCat.name}" created`);
      onCategoryCreated(newCat);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create category:", err);
      toast.error("Unable to create category. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-primary" /> Quick Add Category
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Category Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Raw Materials, Finished Goods, Services"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
