import { db, type Party, type Customer } from "../../../lib/db.ts";
import type { SharePartyInfo } from "./bmsShareTypes";

/**
 * Resolves contact information strictly by partyId from the canonical Party Master.
 * Never matches by customer name per PRD § 3 and Correction 3.
 * Legacy customers collection is only accessed as a read-only fallback for historical records.
 */
export async function resolvePartyContact(
  partyId?: string,
  fallbackSnapshot?: Partial<Party | Customer>
): Promise<SharePartyInfo> {
  if (!partyId) {
    return {
      partyId: "",
      partyCode: fallbackSnapshot?.partyCode,
      name: fallbackSnapshot?.name || "Customer",
      companyName: fallbackSnapshot?.company || (fallbackSnapshot as any)?.tradingName,
      email: fallbackSnapshot?.email?.trim(),
      phone: fallbackSnapshot?.mobile?.trim() || fallbackSnapshot?.phone?.trim(),
      country: fallbackSnapshot?.country,
    };
  }

  try {
    // 1. Canonical Party Master lookup
    const party = await db().parties.get(partyId);
    if (party) {
      return {
        partyId: party.id,
        partyCode: party.partyCode,
        name: party.name,
        companyName: party.company || party.tradingName,
        email: party.email?.trim(),
        phone: party.mobile?.trim() || party.phone?.trim(),
        country: party.country,
      };
    }

    // 2. Read-only historical compatibility fallback
    const legacyCustomer = await db().customers.get(partyId);
    if (legacyCustomer) {
      return {
        partyId: legacyCustomer.id,
        partyCode: legacyCustomer.partyCode,
        name: legacyCustomer.name,
        companyName: legacyCustomer.company || (legacyCustomer as any)?.tradingName,
        email: legacyCustomer.email?.trim(),
        phone: legacyCustomer.mobile?.trim() || legacyCustomer.phone?.trim(),
        country: legacyCustomer.country,
      };
    }
  } catch (err) {
    console.warn("Failed to lookup party in Party Master:", err);
  }

  // Safe fallback to snapshot only when ID was provided but not found in DB
  return {
    partyId,
    partyCode: fallbackSnapshot?.partyCode,
    name: fallbackSnapshot?.name || "Customer",
    companyName: fallbackSnapshot?.company || (fallbackSnapshot as any)?.tradingName,
    email: fallbackSnapshot?.email?.trim(),
    phone: fallbackSnapshot?.mobile?.trim() || fallbackSnapshot?.phone?.trim(),
    country: fallbackSnapshot?.country,
  };
}
