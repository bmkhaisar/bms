import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Truck, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { db, uid, type Supplier, type Party } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useLive } from "@/lib/useLive";
import { createSupplierWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { normalizeName, normalizeGstin, normalizePhone, normalizeEmail } from "@/modules/sync/searchNormalization";
import { authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";

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
  const existingSuppliers = useLive<Supplier>(() => db().suppliers.toArray());
  const [saving, setSaving] = useState(false);
  const [forceCreate, setForceCreate] = useState(false);

  const [form, setForm] = useState({
    name: defaultName,
    company: "",
    mobile: "",
    email: "",
    gstin: "",
    address: "",
    openingBalance: 0,
  });

  useEffect(() => {
    if (defaultName && open) {
      setForm((prev) => ({ ...prev, name: defaultName }));
      setForceCreate(false);
    }
  }, [defaultName, open]);

  const duplicateSupplier = useMemo(() => {
    if (!form.name && !form.gstin && !form.mobile) return null;
    const normName = normalizeName(form.name);
    const normGstin = normalizeGstin(form.gstin);
    const normPhone = normalizePhone(form.mobile);

    for (const s of existingSuppliers) {
      if (normGstin && s.gstin && normalizeGstin(s.gstin) === normGstin) {
        return { item: s, reason: `Exact GSTIN matches existing supplier "${s.name}".` };
      }
      if (normPhone && s.mobile && normalizePhone(s.mobile) === normPhone) {
        return { item: s, reason: `Phone number matches existing supplier "${s.name}".` };
      }
      if (normName && normalizeName(s.name) === normName) {
        return { item: s, reason: `Supplier named "${s.name}" already exists.` };
      }
    }
    return null;
  }, [form.name, form.gstin, form.mobile, existingSuppliers]);

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Supplier name is required");
      return;
    }

    if (duplicateSupplier && !forceCreate && duplicateSupplier.reason.includes("GSTIN")) {
      toast.error("Supplier with this GSTIN already exists. Click 'Use Existing' or verify.");
      return;
    }

    setSaving(true);
    try {
      const supplierId = uid();
      const newSupplier: Supplier = {
        id: supplierId,
        name: trimmedName,
        company: form.company.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : undefined,
        address: form.address.trim() || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        partyType: "SUNDRY_CREDITOR",
        createdAt: Date.now(),
      };

      // Atomic Supplier + Accounts Payable Ledger creation
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

      const newParty: Party = {
        ...newSupplier,
        partyType: "SUNDRY_CREDITOR",
        paymentPolicy: "CREDIT",
        country: "India",
        billingAddress: newSupplier.address,
        shippingAddress: newSupplier.address,
      };

      if (activeCompany?.id) {
        await authoritativeSaveEntity({
          companyId: activeCompany.id,
          kind: "party",
          entity: newParty,
          uid: user?.uid,
          action: "create",
        });
      } else {
        await db().parties.put(newParty);
        await db().suppliers.put(newSupplier);
      }

      toast.success(`Supplier "${newSupplier.name}" created and selected`);
      onSupplierCreated(newSupplier);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create supplier:", err);
      toast.error("Unable to create supplier. Draft preserved. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Truck className="h-5 w-5 text-primary" /> New Supplier
          </DialogTitle>
        </DialogHeader>

        {duplicateSupplier && (
          <Alert className="my-1 border-amber-500/50 bg-amber-500/10 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="space-y-1">
              <AlertTitle className="text-xs font-semibold">Possible Duplicate Supplier</AlertTitle>
              <AlertDescription className="text-xs">{duplicateSupplier.reason}</AlertDescription>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => {
                    onSupplierCreated(duplicateSupplier.item);
                    onOpenChange(false);
                    toast.info(`Selected existing supplier "${duplicateSupplier.item.name}"`);
                  }}
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Use Existing Supplier
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
            <Label className="text-xs">GSTIN (Optional)</Label>
            <Input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
              placeholder="27ABCDE1234F1Z5"
              className="font-mono uppercase"
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

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Address / Factory location"
            />
          </div>
        </div>

        <DialogFooter className="pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving Supplier…
              </>
            ) : (
              "Save Supplier & AP Ledger"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
