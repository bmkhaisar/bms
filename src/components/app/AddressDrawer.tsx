import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { MapPin, Plus, Loader2 } from "lucide-react";
import { db, uid, type PartyAddress, type Party, type AddressSnapshot } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, update } from "firebase/database";

interface AddressDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: Party | null;
  onAddressSaved: (newAddress: PartyAddress) => void;
}

export const ADDRESS_LABELS = [
  "Billing Address",
  "Shipping Address",
  "Site Address",
  "Branch Address",
  "Warehouse Address",
  "Other Address",
];

export function AddressDrawer({
  open,
  onOpenChange,
  party,
  onAddressSaved,
}: AddressDrawerProps) {
  const { activeCompany } = useActiveCompany();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<Omit<PartyAddress, "id">>({
    label: "Billing Address",
    addressLine1: "",
    addressLine2: "",
    city: party?.city || "",
    district: party?.district || "",
    state: party?.state || activeCompany?.state || "",
    stateCode: party?.stateCode || "",
    country: party?.country || activeCompany?.country || "India",
    pincode: party?.pincode || "",
    contactPerson: party?.contactPerson || "",
    phone: party?.mobile || party?.phone || "",
    isDefaultBilling: false,
    isDefaultShipping: false,
  });

  async function handleSave() {
    if (!party) {
      toast.error("Please select a Party first");
      return;
    }
    if (!form.addressLine1.trim()) {
      toast.error("Address Line 1 is required");
      return;
    }
    if (!form.city.trim()) {
      toast.error("City is required");
      return;
    }
    if (!form.state.trim()) {
      toast.error("State is required");
      return;
    }
    if (!form.pincode.trim()) {
      toast.error("Pincode is mandatory per client requirements");
      return;
    }

    setSaving(true);
    try {
      const newAddress: PartyAddress = {
        ...form,
        id: uid(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2?.trim() || undefined,
        city: form.city.trim(),
        district: form.district?.trim() || undefined,
        state: form.state.trim(),
        stateCode: form.stateCode?.trim() || undefined,
        country: form.country.trim() || "India",
        pincode: form.pincode.trim(),
        contactPerson: form.contactPerson?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
      };

      const existingAddresses: PartyAddress[] = party.addresses || [];
      const updatedAddresses = [...existingAddresses, newAddress];

      const updatedParty: Party = {
        ...party,
        addresses: updatedAddresses,
        updatedAt: Date.now(),
      };

      // 1. Update local Dexie tables immediately
      await db().parties.put(updatedParty);
      await db().customers.put(updatedParty as any);
      await db().suppliers.put(updatedParty as any);

      // 2. Persist to Firebase RTDB if available
      if (activeCompany?.id && firebaseDb) {
        const updates: Record<string, unknown> = {};
        updates[`companyData/${activeCompany.id}/parties/${party.id}/addresses`] = sanitizeForFirebase(updatedAddresses);
        updates[`companyData/${activeCompany.id}/customers/${party.id}/addresses`] = sanitizeForFirebase(updatedAddresses);
        await update(ref(firebaseDb), updates);
      }

      toast.success(`Address "${newAddress.label}" saved to ${party.name}`);
      onAddressSaved(newAddress);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to save address to party:", err);
      toast.error("Could not save address. Draft preserved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <MapPin className="h-5 w-5 text-primary" /> Add Address to {party?.name || "Party"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          <div>
            <Label className="text-xs">Address Type / Label *</Label>
            <Select value={form.label} onValueChange={(val) => setForm((p) => ({ ...p, label: val }))}>
              <SelectTrigger className="mt-1 h-8">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {ADDRESS_LABELS.map((lbl) => (
                  <SelectItem key={lbl} value={lbl}>
                    {lbl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Address Line 1 *</Label>
            <Input
              value={form.addressLine1}
              onChange={(e) => setForm((p) => ({ ...p, addressLine1: e.target.value }))}
              placeholder="Building, Street, Area"
              className="mt-1 h-8"
            />
          </div>

          <div>
            <Label className="text-xs">Address Line 2 (Optional)</Label>
            <Input
              value={form.addressLine2}
              onChange={(e) => setForm((p) => ({ ...p, addressLine2: e.target.value }))}
              placeholder="Landmark, Suite, Unit"
              className="mt-1 h-8"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">City *</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                placeholder="City"
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label className="text-xs">District</Label>
              <Input
                value={form.district}
                onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
                placeholder="District"
                className="mt-1 h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">State *</Label>
              <Input
                value={form.state}
                onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))}
                placeholder="State"
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Pincode * (Mandatory)</Label>
              <Input
                value={form.pincode}
                onChange={(e) => setForm((p) => ({ ...p, pincode: e.target.value }))}
                placeholder="6-digit Pincode"
                className="mt-1 h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Country * (Mandatory)</Label>
              <Input
                value={form.country}
                onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
                placeholder="Country"
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Contact Person</Label>
              <Input
                value={form.contactPerson}
                onChange={(e) => setForm((p) => ({ ...p, contactPerson: e.target.value }))}
                placeholder="Site contact"
                className="mt-1 h-8"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="Contact phone"
              className="mt-1 h-8"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Save & Select Address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Creates an immutable AddressSnapshot frozen onto an Invoice or Quotation (PRD § 9).
 */
export function createAddressSnapshot(party?: Party | null, address?: PartyAddress | null): AddressSnapshot {
  if (address) {
    return {
      name: party?.name || "",
      tradingName: party?.tradingName,
      gstin: party?.gstin,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      district: address.district,
      state: address.state,
      stateCode: address.stateCode,
      country: address.country || "India",
      pincode: address.pincode,
      contactPerson: address.contactPerson || party?.contactPerson,
      phone: address.phone || party?.phone || party?.mobile,
    };
  }
  return {
    name: party?.name || "",
    tradingName: party?.tradingName,
    gstin: party?.gstin,
    addressLine1: party?.billingAddress || party?.address || "",
    city: party?.city || "",
    district: party?.district,
    state: party?.state || "",
    stateCode: party?.stateCode,
    country: party?.country || "India",
    pincode: party?.pincode || "",
    contactPerson: party?.contactPerson,
    phone: party?.mobile || party?.phone,
  };
}

/**
 * Formats a snapshot or address object as a clean multi-line or single-line string.
 */
export function formatAddressLines(snapshot?: AddressSnapshot | null): string {
  if (!snapshot) return "";
  const parts = [
    snapshot.addressLine1,
    snapshot.addressLine2,
    [snapshot.city, snapshot.district].filter(Boolean).join(", "),
    [snapshot.state, snapshot.pincode].filter(Boolean).join(" - "),
    snapshot.country,
  ].filter(Boolean);
  return parts.join("\n");
}
