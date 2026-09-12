import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Plus } from "lucide-react";
import type { Party, Customer, Supplier, PartyAddress, AddressSnapshot } from "@/lib/db";
import { AddressDrawer, createAddressSnapshot, formatAddressLines } from "./AddressDrawer";

interface PartyAddressSelectProps {
  party: Party | Customer | Supplier | null | undefined;
  selectedAddressId?: string;
  onChange: (snapshot: AddressSnapshot, addressId?: string) => void;
  label?: string;
  disabled?: boolean;
}

export function PartyAddressSelect({
  party,
  selectedAddressId,
  onChange,
  label = "Billing Address",
  disabled = false,
}: PartyAddressSelectProps) {
  const [openDrawer, setOpenDrawer] = useState(false);
  const [currentAddressId, setCurrentAddressId] = useState<string>(selectedAddressId || "");

  // Collect addresses
  const savedAddresses: PartyAddress[] = party?.addresses || [];

  // If party has a single flat address or default address, make sure it is represented
  const hasPrimaryAddress = Boolean(
    party?.billingAddress || party?.address || party?.city || party?.pincode
  );

  useEffect(() => {
    if (!party) {
      setCurrentAddressId("");
      return;
    }

    // Determine default selection
    if (selectedAddressId) {
      setCurrentAddressId(selectedAddressId);
      const found = savedAddresses.find((a) => a.id === selectedAddressId);
      if (found) {
        onChange(createAddressSnapshot(party, found), found.id);
        return;
      }
    }

    // Try default billing address
    const defaultBilling = savedAddresses.find((a) => a.isDefaultBilling) || savedAddresses[0];
    if (defaultBilling) {
      setCurrentAddressId(defaultBilling.id);
      onChange(createAddressSnapshot(party, defaultBilling), defaultBilling.id);
    } else if (hasPrimaryAddress) {
      setCurrentAddressId("primary");
      onChange(createAddressSnapshot(party, null), "primary");
    }
  }, [party?.id]);

  function handleSelect(id: string) {
    if (id === "__add_new__") {
      setOpenDrawer(true);
      return;
    }
    setCurrentAddressId(id);
    if (id === "primary") {
      onChange(createAddressSnapshot(party, null), "primary");
    } else {
      const found = savedAddresses.find((a) => a.id === id);
      if (found) {
        onChange(createAddressSnapshot(party, found), found.id);
      }
    }
  }

  function handleAddressSaved(newAddress: PartyAddress) {
    setCurrentAddressId(newAddress.id);
    onChange(createAddressSnapshot(party, newAddress), newAddress.id);
  }

  const selectedSnapshot = (() => {
    if (!party) return null;
    if (currentAddressId === "primary") return createAddressSnapshot(party, null);
    const found = savedAddresses.find((a) => a.id === currentAddressId);
    return found ? createAddressSnapshot(party, found) : createAddressSnapshot(party, null);
  })();

  const formattedLines = formatAddressLines(selectedSnapshot);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5 font-medium">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </Label>
        {party && !disabled && (
          <button
            type="button"
            onClick={() => setOpenDrawer(true)}
            className="text-[11px] text-primary hover:underline flex items-center gap-0.5 font-medium"
          >
            <Plus className="h-3 w-3" /> Add Address
          </button>
        )}
      </div>

      <Select
        value={currentAddressId || (hasPrimaryAddress ? "primary" : undefined)}
        onValueChange={handleSelect}
        disabled={disabled || !party}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder={party ? "Select saved address…" : "Select a party first"} />
        </SelectTrigger>
        <SelectContent>
          {hasPrimaryAddress && (
            <SelectItem value="primary" className="text-xs">
              Primary: {[party?.city, party?.state, party?.pincode].filter(Boolean).join(", ") || party?.billingAddress || party?.address || "Master Address"}
            </SelectItem>
          )}
          {savedAddresses.map((addr) => (
            <SelectItem key={addr.id} value={addr.id} className="text-xs">
              {addr.label}: {[addr.addressLine1, addr.city, addr.pincode].filter(Boolean).join(", ")}
            </SelectItem>
          ))}
          <SelectItem value="__add_new__" className="text-xs font-semibold text-primary">
            + Add New Address to {party?.name || "Party"}…
          </SelectItem>
        </SelectContent>
      </Select>

      {formattedLines && (
        <div className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-line font-mono">
          {formattedLines}
        </div>
      )}

      {/* Inline Address Drawer without resetting document state */}
      {party && (
        <AddressDrawer
          open={openDrawer}
          onOpenChange={setOpenDrawer}
          party={party as Party}
          onAddressSaved={handleAddressSaved}
        />
      )}
    </div>
  );
}
