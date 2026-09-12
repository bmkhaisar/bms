import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { db, uid, type Supplier } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { createSupplierWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";

interface QuickCreateSupplierProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSupplierCreated: (supplier: Supplier) => void;
  defaultName?: string;
}

export function QuickCreateSupplierDrawer({
  open,
  onOpenChange,
  onSupplierCreated,
  defaultName = "",
}: QuickCreateSupplierProps) {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: defaultName,
    company: "",
    mobile: "",
    email: "",
    gstin: "",
    address: "",
    openingBalance: 0,
  });

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Supplier name is required");
      return;
    }

    setSaving(true);
    try {
      const supplierId = uid();
      let linkedLedgerId: string | undefined = undefined;

      const newSupplier: Supplier = {
        id: supplierId,
        name: trimmedName,
        company: form.company.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : undefined,
        address: form.address.trim() || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        createdAt: Date.now(),
      };

      // 1. Atomic Supplier + Accounts Payable Ledger creation (Correction 3)
      if (activeCompany?.id && user?.uid) {
        const res = await createSupplierWithLedger({
          companyId: activeCompany.id,
          supplier: newSupplier,
          uid: user.uid,
          idempotencyKey: `mut_supp_${supplierId}`,
        });
        if (res.success && res.ledgerId) {
          (newSupplier as any).ledgerId = res.ledgerId;
        }
      }

      // 2. Update local Dexie table for instant UI reaction
      await db().suppliers.put(newSupplier);

      toast.success(`Supplier "${newSupplier.name}" created and selected`);
      onSupplierCreated(newSupplier);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create supplier:", err);
      toast.error("Unable to create supplier. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> Quick Add Supplier / Vendor
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Supplier / Vendor Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Bharat Steel Works"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Company / Trade Name</Label>
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              placeholder="Trade name"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Mobile Number</Label>
            <Input
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="vendor@company.com"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">GSTIN (Optional)</Label>
            <Input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              placeholder="29AAAAA0000A1Z5"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Vendor factory/warehouse address"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Save & Select Supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
