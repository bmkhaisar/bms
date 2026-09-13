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
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, get, set, update } from "firebase/database";
import { cacheEntitiesBulk } from "@/modules/sync/dexieCache";

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
}): Promise<{
  migratedCount: number;
  partiesCount: number;
}> {
  const { companyId, uid } = params;

  // 1. Fetch all local and existing parties
  const existingParties = await db().parties.toArray();
  const existingPartyIds = new Set(existingParties.map((p) => p.id));
  const existingPartyGstins = new Set(existingParties.map((p) => p.gstin?.trim().toUpperCase()).filter(Boolean));
  const existingPartyNames = new Set(existingParties.map((p) => p.name.trim().toLowerCase()));

  // 2. Fetch legacy customers
  const legacyCustomers = await db().customers.toArray();
  const legacySuppliers = await db().suppliers.toArray();

  const toCreate: Party[] = [];
  let migratedCount = 0;

  for (const c of legacyCustomers) {
    if (existingPartyIds.has(c.id)) {
      continue;
    }
    const cleanGstin = c.gstin?.trim().toUpperCase();
    if (cleanGstin && existingPartyGstins.has(cleanGstin)) {
      continue;
    }
    const cleanName = c.name?.trim().toLowerCase();
    if (cleanName && existingPartyNames.has(cleanName)) {
      continue;
    }

    const newParty: Party = {
      id: c.id, // Preserve same ID so historical invoice.customerId directly matches!
      name: c.name,
      company: c.company,
      partyType: "SUNDRY_DEBTOR",
      paymentPolicy: c.paymentPolicy || "CREDIT",
      mobile: c.mobile,
      phone: c.phone,
      email: c.email,
      gstin: c.gstin,
      pan: c.pan,
      address: c.address || c.billingAddress,
      billingAddress: c.billingAddress || c.address,
      shippingAddress: c.shippingAddress || c.billingAddress || c.address,
      city: c.city,
      state: c.state,
      stateCode: c.stateCode,
      country: c.country || "India",
      pincode: c.pincode || "000000",
      creditLimit: c.creditLimit,
      creditDays: c.creditDays ?? 30,
      openingBalance: (c as any).openingBalance || 0,
      createdAt: c.createdAt || Date.now(),
      notes: c.notes,
    };

    toCreate.push(newParty);
    existingPartyIds.add(newParty.id);
    if (cleanGstin) existingPartyGstins.add(cleanGstin);
    if (cleanName) existingPartyNames.add(cleanName);
    migratedCount++;
  }

  for (const s of legacySuppliers) {
    if (existingPartyIds.has(s.id)) {
      continue;
    }
    const cleanGstin = s.gstin?.trim().toUpperCase();
    if (cleanGstin && existingPartyGstins.has(cleanGstin)) {
      continue;
    }
    const cleanName = s.name?.trim().toLowerCase();
    if (cleanName && existingPartyNames.has(cleanName)) {
      continue;
    }

    const newParty: Party = {
      id: s.id, // Preserve same ID so historical purchase.supplierId directly matches!
      name: s.name,
      company: s.company,
      partyType: "SUNDRY_CREDITOR",
      paymentPolicy: "CREDIT",
      mobile: s.mobile,
      phone: s.phone,
      email: s.email,
      gstin: s.gstin,
      pan: s.pan,
      address: s.address,
      billingAddress: s.address,
      shippingAddress: s.address,
      city: s.city,
      state: s.state,
      stateCode: s.stateCode,
      country: s.country || "India",
      pincode: s.pincode || "000000",
      openingBalance: (s as any).openingBalance || 0,
      createdAt: s.createdAt || Date.now(),
      notes: s.notes,
    };

    toCreate.push(newParty);
    existingPartyIds.add(newParty.id);
    if (cleanGstin) existingPartyGstins.add(cleanGstin);
    if (cleanName) existingPartyNames.add(cleanName);
    migratedCount++;
  }

  if (toCreate.length > 0) {
    // 1. Put into Dexie parties table
    for (const p of toCreate) {
      await db().parties.put(p);
    }

    // 2. Sync to Firebase RTDB & Dexie cache
    if (firebaseDb) {
      const updates: Record<string, unknown> = {};
      for (const p of toCreate) {
        updates[`companyData/${companyId}/parties/${p.id}`] = sanitizeForFirebase(p);
      }
      try {
        await update(ref(firebaseDb), updates);
      } catch (err) {
        console.warn("RTDB party migration warning:", err);
      }
    }

    try {
      await cacheEntitiesBulk(
        toCreate.map((p) => ({
          uid,
          companyId,
          entityType: "party",
          entityId: p.id,
          data: p,
        }))
      );
    } catch (cErr) {
      console.warn("Party cache bulk warning:", cErr);
    }
  }

  const finalTotal = await db().parties.count();
  return {
    migratedCount,
    partiesCount: finalTotal,
  };
}
