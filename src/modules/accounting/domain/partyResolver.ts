/**
 * Canonical Party Display Resolver & Legacy Migration Engine (PRD §§ 39-49)
 * 
 * Provides single authoritative resolution for customer/vendor party identities:
 * 1. Document frozen party snapshot (Highest Priority - Reprints never change)
 * 2. Canonical Party Master entity (SUNDRY_DEBTOR / SUNDRY_CREDITOR)
 * 3. Legacy mapped customer/supplier record
 * 4. Safe historical fallback (Never blank '—' if name exists anywhere)
 */

import {
  db,
  type Party,
  type Customer,
  type Supplier,
  type PartyType,
  isSundryDebtor,
  isSundryCreditor,
  normalizePartyType,
} from "@/lib/db";
import { cacheEntitiesBulk } from "@/modules/sync/dexieCache";
import { migrateLegacyPartiesServerFn } from "@/functions/migrateLegacyPartiesFn";

export interface PartyDisplayInfo {
  name: string;
  companyName?: string;
  gstin: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  isResolved: boolean;
  source: "frozen_snapshot" | "canonical_party" | "legacy_record" | "fallback";
}

export function resolvePartyDisplay(params: {
  partyId?: string;
  frozenSnapshot?: {
    name?: string;
    partyName?: string;
    tradingName?: string;
    company?: string;
    gstin?: string;
    phone?: string;
    mobile?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    email?: string;
  } | null;
  party?: Party | null;
  legacyRecord?: Customer | Supplier | null;
  fallbackLabel?: string;
}): PartyDisplayInfo {
  const { partyId, frozenSnapshot, party, legacyRecord, fallbackLabel } = params;

  // 1. Priority 1: Document frozen party snapshot
  const snapName = frozenSnapshot?.partyName || frozenSnapshot?.name || frozenSnapshot?.tradingName;
  if (snapName && snapName.trim() && snapName.trim() !== "—" && snapName.trim() !== "Customer" && snapName.trim() !== "Supplier") {
    return {
      name: snapName.trim(),
      companyName: frozenSnapshot?.company || undefined,
      gstin: frozenSnapshot?.gstin || "—",
      phone: frozenSnapshot?.phone || frozenSnapshot?.mobile || undefined,
      email: frozenSnapshot?.email || undefined,
      address: frozenSnapshot?.address || undefined,
      city: frozenSnapshot?.city || undefined,
      state: frozenSnapshot?.state || undefined,
      pincode: frozenSnapshot?.pincode || undefined,
      isResolved: true,
      source: "frozen_snapshot",
    };
  }

  // 2. Priority 2: Canonical Party Master entity
  if (party && party.name && party.name.trim()) {
    return {
      name: party.name.trim(),
      companyName: party.company || party.tradingName || undefined,
      gstin: party.gstin || "—",
      phone: party.mobile || party.phone || undefined,
      email: party.email || undefined,
      address: party.address || party.billingAddress || undefined,
      city: party.city || undefined,
      state: party.state || undefined,
      pincode: party.pincode || undefined,
      isResolved: true,
      source: "canonical_party",
    };
  }

  // 3. Priority 3: Legacy mapped record
  if (legacyRecord && legacyRecord.name && legacyRecord.name.trim()) {
    const cust = legacyRecord as Customer;
    return {
      name: legacyRecord.name.trim(),
      companyName: legacyRecord.company || undefined,
      gstin: cust.gstin || "—",
      phone: cust.mobile || cust.phone || undefined,
      email: legacyRecord.email || undefined,
      address: cust.address || cust.billingAddress || undefined,
      city: cust.city || undefined,
      state: cust.state || undefined,
      pincode: cust.pincode || undefined,
      isResolved: true,
      source: "legacy_record",
    };
  }

  // 4. Fallback if snapshot has a generic name but at least gstin or phone
  if (snapName && snapName.trim()) {
    return {
      name: snapName.trim(),
      companyName: frozenSnapshot?.company || undefined,
      gstin: frozenSnapshot?.gstin || "—",
      phone: frozenSnapshot?.phone || frozenSnapshot?.mobile || undefined,
      email: frozenSnapshot?.email || undefined,
      address: frozenSnapshot?.address || undefined,
      city: frozenSnapshot?.city || undefined,
      state: frozenSnapshot?.state || undefined,
      pincode: frozenSnapshot?.pincode || undefined,
      isResolved: true,
      source: "frozen_snapshot",
    };
  }

  // 5. Final Safe Fallback
  return {
    name: fallbackLabel || "—",
    gstin: "—",
    isResolved: false,
    source: "fallback",
  };
}

/**
 * Synchronous resolver against loaded memory arrays of parties, customers, suppliers.
 */
export function resolvePartyNameFromCollections(
  partyId: string | undefined,
  frozenSnapshot: any,
  parties: Party[] = [],
  customers: Customer[] = [],
  suppliers: Supplier[] = [],
  fallback = "—"
): string {
  const party = partyId ? parties.find((p) => p.id === partyId) : undefined;
  const legacy = partyId
    ? (customers.find((c) => c.id === partyId) || suppliers.find((s) => s.id === partyId))
    : undefined;

  const res = resolvePartyDisplay({
    partyId,
    frozenSnapshot,
    party,
    legacyRecord: legacy,
    fallbackLabel: fallback,
  });

  return res.name;
}

/**
 * Idempotent migration of legacy Customers and Suppliers into Canonical Party Master (PRD §§ 41-43).
 * Guarantees zero duplicate ledgers and seamless historical linking.
 */
export async function migrateLegacyCustomersAndSuppliersToParties(params: {
  companyId: string;
  uid: string;
  idToken: string;
}): Promise<{
  migratedCount: number;
  partiesCount: number;
}> {
  const { companyId, uid, idToken } = params;
  const result = await migrateLegacyPartiesServerFn({ data: { companyId, idToken } });
  if (!result.success) throw new Error(result.error || "Legacy party migration failed");
  const parties = (result.parties || []) as Party[];
  if (parties.length) {
    await db().parties.bulkPut(parties);
    await cacheEntitiesBulk(parties.map((party) => ({ uid, companyId, entityType: "party", entityId: party.id, data: party })));
  }
  return { migratedCount: result.migratedCount, partiesCount: result.partiesCount };
}
