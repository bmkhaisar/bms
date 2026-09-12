import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { db, uid, type Customer } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { createCustomerWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";

interface QuickCreateCustomerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerCreated: (customer: Customer) => void;
  defaultName?: string;
}

export function QuickCreateCustomerDrawer({
  open,
  onOpenChange,
  onCustomerCreated,
  defaultName = "",
}: QuickCreateCustomerProps) {
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
    shippingAddress: "",
    city: "",
    state: activeCompany?.state || "",
    pincode: "",
    customerType: "business" as "business" | "individual",
    taxRegistrationType: "regular" as "regular" | "unregistered" | "composition",
    openingBalance: 0,
  });

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Customer name is required");
      return;
    }

    setSaving(true);
    try {
      const customerId = uid();
      let linkedLedgerId: string | undefined = undefined;

      const newCustomer: Customer = {
        id: customerId,
        name: trimmedName,
        company: form.company.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        email: form.email.trim() || undefined,
        gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        createdAt: Date.now(),
      };

      // 1. Atomic Customer + Accounts Receivable Ledger creation (Correction 3)
      if (activeCompany?.id && user?.uid) {
        const res = await createCustomerWithLedger({
          companyId: activeCompany.id,
          customer: newCustomer,
          uid: user.uid,
          idempotencyKey: `mut_cust_${customerId}`,
        });
        if (res.success && res.ledgerId) {
          (newCustomer as any).ledgerId = res.ledgerId;
        }
      }

      // 2. Update local Dexie table for instant UI reaction
      await db().customers.put(newCustomer);

      toast.success(`Customer "${newCustomer.name}" created and selected`);
      onCustomerCreated(newCustomer);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create customer:", err);
      toast.error("Unable to create customer. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" /> Quick Add Customer
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Customer / Trade Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Acme Corporation or Rajesh Sharma"
              autoFocus
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
              placeholder="billing@customer.com"
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

          <div className="space-y-1">
            <Label className="text-xs">State</Label>
            <Input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              placeholder="e.g. Karnataka or Delhi"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Billing Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Building, street, area"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">City</Label>
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="City"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Pincode</Label>
            <Input
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value })}
              placeholder="560001"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Save & Select Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
