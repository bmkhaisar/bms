import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Users, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { db, uid, type Customer, type Party } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useLive } from "@/lib/useLive";
import { createCustomerWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { detectCustomerDuplicates, type DuplicateMatch } from "@/modules/sync/searchNormalization";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";

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
  const existingCustomers = useLive<Customer>(() => db().customers.toArray());
  const [saving, setSaving] = useState(false);
  const [forceCreate, setForceCreate] = useState(false);

  const [form, setForm] = useState({
    name: defaultName,
    company: "",
    mobile: "",
    email: "",
    gstin: "",
    address: "",
    city: "",
    state: activeCompany?.state || "",
    pincode: "",
    taxRegistrationType: "regular" as "regular" | "unregistered" | "composition",
    creditLimit: 0,
    creditDays: 0,
    openingBalance: 0,
  });

  useEffect(() => {
    if (defaultName && open) {
      setForm((prev) => ({ ...prev, name: defaultName }));
      setForceCreate(false);
    }
  }, [defaultName, open]);

  // Company-scoped duplicate detection (Correction 4)
  const duplicateCheck: DuplicateMatch<Customer> = useMemo(() => {
    if (!form.name && !form.gstin && !form.mobile && !form.email) {
      return { isDuplicate: false, severity: "info" };
    }
    return detectCustomerDuplicates(
      {
        name: form.name,
        gstin: form.gstin,
        mobile: form.mobile,
        email: form.email,
      },
      existingCustomers,
      activeCompany?.id
    );
  }, [form.name, form.gstin, form.mobile, form.email, existingCustomers, activeCompany?.id]);

  async function handleSave() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error("Customer name is required");
      return;
    }

    if (duplicateCheck.isDuplicate && duplicateCheck.severity === "critical" && !forceCreate) {
      toast.error("Exact GSTIN already exists. Click 'Use Existing' or verify details.");
      return;
    }

    setSaving(true);
    try {
      const customerId = uid();
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
        creditLimit: Number(form.creditLimit) || 0,
        creditDays:
          form.creditDays !== undefined && form.creditDays !== null && !isNaN(Number(form.creditDays))
            ? Math.max(0, Math.floor(Number(form.creditDays)))
            : 0,
        partyType: "SUNDRY_DEBTORS",
        taxRegistrationType: form.taxRegistrationType,
        createdAt: Date.now(),
      };

      // Atomic Customer + Accounts Receivable Ledger creation
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

      const newParty: Party = {
        ...newCustomer,
        partyType: "SUNDRY_DEBTOR",
        paymentPolicy: "CREDIT",
        country: "India",
        billingAddress: newCustomer.address,
        shippingAddress: newCustomer.address,
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
        await db().customers.put(newCustomer);
      }

      toast.success(`Customer "${newCustomer.name}" created and selected`);
      onCustomerCreated(newCustomer);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to quick-create customer:", err);
      toast.error("Unable to create customer. Invoice draft preserved. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Users className="h-4 w-4 text-primary" /> New Sundry Debtor (Customer)
          </DialogTitle>
        </DialogHeader>

        {/* Duplicate Intelligence Warning Banner (Correction 4) */}
        {duplicateCheck.isDuplicate && duplicateCheck.matchedItem && (
          <Alert variant={duplicateCheck.severity === "critical" ? "destructive" : "default"} className="my-1 border-amber-500/50 bg-amber-500/10 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="space-y-1">
              <AlertTitle className="text-xs font-semibold">Possible Duplicate Found</AlertTitle>
              <AlertDescription className="text-xs">
                {duplicateCheck.message}
              </AlertDescription>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => {
                    if (duplicateCheck.matchedItem) {
                      onCustomerCreated(duplicateCheck.matchedItem);
                      onOpenChange(false);
                      toast.info(`Selected existing customer "${duplicateCheck.matchedItem.name}"`);
                    }
                  }}
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Use Existing Customer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => setForceCreate(true)}
                >
                  Create Anyway
                </Button>
              </div>
            </div>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 text-xs pt-1">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Customer Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mars Engineering or Rajesh Sharma"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Company / Trading Name</Label>
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              placeholder="e.g. Mars Enterprises"
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
            <Label className="text-xs">Email Address</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="billing@mars.com"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Billing Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Full address, road, industrial area"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">City</Label>
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="e.g. Mumbai"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">State</Label>
            <Input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              placeholder="e.g. Maharashtra"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Credit Limit (₹)</Label>
            <Input
              type="number"
              value={form.creditLimit || ""}
              onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) || 0 })}
              placeholder="0 (No limit)"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Credit Terms (Days)</Label>
              <span className="text-[10px] text-muted-foreground">0 = due immediately</span>
            </div>
            <Input
              type="number"
              min="0"
              value={form.creditDays !== undefined && form.creditDays !== null ? form.creditDays : 0}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Number(e.target.value);
                setForm({ ...form, creditDays: isNaN(val) ? 0 : Math.max(0, Math.floor(val)) });
              }}
              placeholder="0"
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving Customer…
              </>
            ) : (
              "Save Customer & AR Ledger"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
