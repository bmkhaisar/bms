import { ref, get, set, update } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import type { Ledger } from "../types";
import { cacheEntity, getCachedEntities } from "@/modules/sync/dexieCache";

export interface CustomerParty {
  id: string;
  name: string;
  company?: string;
  mobile?: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  openingBalance?: number;
  ledgerId?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface SupplierParty {
  id: string;
  name: string;
  company?: string;
  mobile?: string;
  email?: string;
  gstin?: string;
  address?: string;
  openingBalance?: number;
  ledgerId?: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Idempotently links or creates an Accounts Receivable Subledger for a Customer.
 * Guarantees zero duplicate ledgers across retries or reconnections.
 */
export async function ensureCustomerLedger(params: {
  companyId: string;
  customer: CustomerParty;
  uid: string;
}): Promise<string> {
  const { companyId, customer, uid } = params;
  const canonicalLedgerId = customer.ledgerId || `led_${companyId}_cust_${customer.id}`;

  if (firebaseDb) {
    const existingLedgerRef = ref(firebaseDb, `companyData/${companyId}/ledgers/${canonicalLedgerId}`);
    const snap = await get(existingLedgerRef);

    if (snap.exists()) {
      // Existing ledger found: update metadata idempotently without overwriting balances
      await update(existingLedgerRef, {
        name: customer.company ? `${customer.name} (${customer.company})` : customer.name,
        gstin: customer.gstin || null,
        partyType: "customer",
        partyId: customer.id,
        updatedAt: Date.now(),
      });
      return canonicalLedgerId;
    }

    // Also check if any ledger exists for this partyId
    const allLedgersRef = ref(firebaseDb, `companyData/${companyId}/ledgers`);
    const allSnap = await get(allLedgersRef);
    if (allSnap.exists()) {
      const ledgers = allSnap.val();
      for (const [lId, l] of Object.entries(ledgers) as [string, any][]) {
        if (l.partyType === "customer" && l.partyId === customer.id) {
          return lId;
        }
      }
    }

    // Create new customer receivable subledger under Sundry Debtors
    const openingPaise = Math.round((customer.openingBalance || 0) * 100);
    const newLedger: Ledger = {
      id: canonicalLedgerId,
      companyId,
      name: customer.company ? `${customer.name} (${customer.company})` : customer.name,
      groupId: "grp_sundry_debtors",
      groupNature: "asset",
      openingBalance: Math.abs(openingPaise),
      openingBalanceType: openingPaise < 0 ? "cr" : "dr",
      currentBalance: openingPaise, // Debits are positive for assets
      currency: "INR",
      gstin: customer.gstin,
      partyType: "customer",
      partyId: customer.id,
      active: true,
      createdAt: customer.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await set(existingLedgerRef, newLedger);

    // Save in local Dexie cache
    await cacheEntity({
      uid,
      companyId,
      entityType: "ledger",
      entityId: canonicalLedgerId,
      data: newLedger,
    });

    return canonicalLedgerId;
  }

  return canonicalLedgerId;
}

/**
 * Idempotently links or creates an Accounts Payable Subledger for a Supplier.
 * Guarantees zero duplicate ledgers across retries or reconnections.
 */
export async function ensureSupplierLedger(params: {
  companyId: string;
  supplier: SupplierParty;
  uid: string;
}): Promise<string> {
  const { companyId, supplier, uid } = params;
  const canonicalLedgerId = supplier.ledgerId || `led_${companyId}_supp_${supplier.id}`;

  if (firebaseDb) {
    const existingLedgerRef = ref(firebaseDb, `companyData/${companyId}/ledgers/${canonicalLedgerId}`);
    const snap = await get(existingLedgerRef);

    if (snap.exists()) {
      // Existing ledger found: update metadata idempotently
      await update(existingLedgerRef, {
        name: supplier.company ? `${supplier.name} (${supplier.company})` : supplier.name,
        gstin: supplier.gstin || null,
        partyType: "supplier",
        partyId: supplier.id,
        updatedAt: Date.now(),
      });
      return canonicalLedgerId;
    }

    // Check if any ledger exists for this partyId
    const allLedgersRef = ref(firebaseDb, `companyData/${companyId}/ledgers`);
    const allSnap = await get(allLedgersRef);
    if (allSnap.exists()) {
      const ledgers = allSnap.val();
      for (const [lId, l] of Object.entries(ledgers) as [string, any][]) {
        if (l.partyType === "supplier" && l.partyId === supplier.id) {
          return lId;
        }
      }
    }

    // Create new supplier payable subledger under Sundry Creditors
    const openingPaise = Math.round((supplier.openingBalance || 0) * 100);
    const newLedger: Ledger = {
      id: canonicalLedgerId,
      companyId,
      name: supplier.company ? `${supplier.name} (${supplier.company})` : supplier.name,
      groupId: "grp_sundry_creditors",
      groupNature: "liability",
      openingBalance: Math.abs(openingPaise),
      openingBalanceType: openingPaise < 0 ? "dr" : "cr",
      currentBalance: -Math.abs(openingPaise), // Credits are negative (liability owed)
      currency: "INR",
      gstin: supplier.gstin,
      partyType: "supplier",
      partyId: supplier.id,
      active: true,
      createdAt: supplier.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await set(existingLedgerRef, newLedger);

    // Save in local Dexie cache
    await cacheEntity({
      uid,
      companyId,
      entityType: "ledger",
      entityId: canonicalLedgerId,
      data: newLedger,
    });

    return canonicalLedgerId;
  }

  return canonicalLedgerId;
}
