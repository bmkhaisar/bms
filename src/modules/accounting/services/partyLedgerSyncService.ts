import { ref, get, set, update } from "firebase/database";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
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

    await set(existingLedgerRef, sanitizeForFirebase(newLedger));

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

    await set(existingLedgerRef, sanitizeForFirebase(newLedger));

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

export interface CreateCustomerWithLedgerParams {
  companyId: string;
  customer: CustomerParty;
  uid: string;
  idempotencyKey?: string;
}

export interface CreateSupplierWithLedgerParams {
  companyId: string;
  supplier: SupplierParty;
  uid: string;
  idempotencyKey?: string;
}

export interface PartyWithLedgerResult<P> {
  success: boolean;
  party: P;
  ledgerId: string;
  ledger: Ledger;
  isExisting?: boolean;
  error?: string;
}

/**
 * ATOMIC & IDEMPOTENT customer + Accounts Receivable subledger provisioning.
 * PRD Correction 3: Guarantees party, ledger, audit, and idempotency key are committed
 * atomically in a single multi-path database transaction.
 * Double-submission or retry safely returns the existing party and ledger without duplicate ledgers.
 */
export async function createCustomerWithLedger(
  params: CreateCustomerWithLedgerParams
): Promise<PartyWithLedgerResult<CustomerParty>> {
  const { companyId, customer, uid, idempotencyKey } = params;
  const canonicalLedgerId = customer.ledgerId || `led_${companyId}_cust_${customer.id}`;
  const now = Date.now();

  try {
    if (firebaseDb) {
      // 1. Idempotency Check via idempotencyKey or existing customer
      if (idempotencyKey) {
        const mutSnap = await get(ref(firebaseDb, `companyData/${companyId}/partyMutations/${idempotencyKey}`));
        if (mutSnap.exists()) {
          const mut = mutSnap.val();
          const existCustSnap = await get(ref(firebaseDb, `companyData/${companyId}/customers/${mut.customerId}`));
          const existLedSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${mut.ledgerId}`));
          if (existCustSnap.exists() && existLedSnap.exists()) {
            return {
              success: true,
              party: existCustSnap.val(),
              ledgerId: mut.ledgerId,
              ledger: existLedSnap.val(),
              isExisting: true,
            };
          }
        }
      }

      // Check if customer already exists
      const custRef = ref(firebaseDb, `companyData/${companyId}/customers/${customer.id}`);
      const custSnap = await get(custRef);
      if (custSnap.exists()) {
        const existingCust = custSnap.val();
        const lId = existingCust.ledgerId || canonicalLedgerId;
        const ledSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${lId}`));
        return {
          success: true,
          party: existingCust,
          ledgerId: lId,
          ledger: ledSnap.exists() ? ledSnap.val() : ({} as Ledger),
          isExisting: true,
        };
      }
    }

    // 2. Prepare Ledger Record under Sundry Debtors
    const openingPaise = Math.round((customer.openingBalance || 0) * 100);
    const ledger: Ledger = {
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
      createdAt: customer.createdAt || now,
      updatedAt: now,
    };

    const customerToSave: CustomerParty = {
      ...customer,
      ledgerId: canonicalLedgerId,
      createdAt: customer.createdAt || now,
      updatedAt: now,
    };

    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

    // 3. Commit ATOMIC multi-path update to Firebase RTDB
    if (firebaseDb) {
      const updates: Record<string, unknown> = {};
      updates[`companyData/${companyId}/customers/${customer.id}`] = sanitizeForFirebase(customerToSave);
      updates[`companyData/${companyId}/ledgers/${canonicalLedgerId}`] = sanitizeForFirebase(ledger);
      updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
        id: auditId,
        entityType: "customer",
        entityId: customer.id,
        action: "create_with_ledger",
        performedBy: uid,
        timestamp: now,
        details: {
          customerName: customer.name,
          ledgerId: canonicalLedgerId,
          openingPaise,
        },
      };

      if (idempotencyKey) {
        updates[`companyData/${companyId}/partyMutations/${idempotencyKey}`] = {
          customerId: customer.id,
          ledgerId: canonicalLedgerId,
          timestamp: now,
          performedBy: uid,
        };
      }

      await update(ref(firebaseDb), updates);
    }

    // 4. Update local Dexie bms_cache_v1 mirror
    await cacheEntity({
      uid,
      companyId,
      entityType: "customer",
      entityId: customer.id,
      data: customerToSave,
    });

    await cacheEntity({
      uid,
      companyId,
      entityType: "ledger",
      entityId: canonicalLedgerId,
      data: ledger,
    });

    return {
      success: true,
      party: customerToSave,
      ledgerId: canonicalLedgerId,
      ledger,
      isExisting: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed atomic createCustomerWithLedger:", err);
    return {
      success: false,
      party: customer,
      ledgerId: canonicalLedgerId,
      ledger: {} as Ledger,
      error: msg,
    };
  }
}

/**
 * ATOMIC & IDEMPOTENT supplier + Accounts Payable subledger provisioning.
 * PRD Correction 3: Guarantees supplier, ledger, audit, and idempotency key are committed
 * atomically in a single multi-path database transaction.
 */
export async function createSupplierWithLedger(
  params: CreateSupplierWithLedgerParams
): Promise<PartyWithLedgerResult<SupplierParty>> {
  const { companyId, supplier, uid, idempotencyKey } = params;
  const canonicalLedgerId = supplier.ledgerId || `led_${companyId}_supp_${supplier.id}`;
  const now = Date.now();

  try {
    if (firebaseDb) {
      if (idempotencyKey) {
        const mutSnap = await get(ref(firebaseDb, `companyData/${companyId}/partyMutations/${idempotencyKey}`));
        if (mutSnap.exists()) {
          const mut = mutSnap.val();
          const existSuppSnap = await get(ref(firebaseDb, `companyData/${companyId}/suppliers/${mut.supplierId}`));
          const existLedSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${mut.ledgerId}`));
          if (existSuppSnap.exists() && existLedSnap.exists()) {
            return {
              success: true,
              party: existSuppSnap.val(),
              ledgerId: mut.ledgerId,
              ledger: existLedSnap.val(),
              isExisting: true,
            };
          }
        }
      }

      const suppRef = ref(firebaseDb, `companyData/${companyId}/suppliers/${supplier.id}`);
      const suppSnap = await get(suppRef);
      if (suppSnap.exists()) {
        const existingSupp = suppSnap.val();
        const lId = existingSupp.ledgerId || canonicalLedgerId;
        const ledSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${lId}`));
        return {
          success: true,
          party: existingSupp,
          ledgerId: lId,
          ledger: ledSnap.exists() ? ledSnap.val() : ({} as Ledger),
          isExisting: true,
        };
      }
    }

    const openingPaise = Math.round((supplier.openingBalance || 0) * 100);
    const ledger: Ledger = {
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
      createdAt: supplier.createdAt || now,
      updatedAt: now,
    };

    const supplierToSave: SupplierParty = {
      ...supplier,
      ledgerId: canonicalLedgerId,
      createdAt: supplier.createdAt || now,
      updatedAt: now,
    };

    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

    if (firebaseDb) {
      const updates: Record<string, unknown> = {};
      updates[`companyData/${companyId}/suppliers/${supplier.id}`] = sanitizeForFirebase(supplierToSave);
      updates[`companyData/${companyId}/ledgers/${canonicalLedgerId}`] = sanitizeForFirebase(ledger);
      updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
        id: auditId,
        entityType: "supplier",
        entityId: supplier.id,
        action: "create_with_ledger",
        performedBy: uid,
        timestamp: now,
        details: {
          supplierName: supplier.name,
          ledgerId: canonicalLedgerId,
          openingPaise,
        },
      };

      if (idempotencyKey) {
        updates[`companyData/${companyId}/partyMutations/${idempotencyKey}`] = {
          supplierId: supplier.id,
          ledgerId: canonicalLedgerId,
          timestamp: now,
          performedBy: uid,
        };
      }

      await update(ref(firebaseDb), updates);
    }

    await cacheEntity({
      uid,
      companyId,
      entityType: "supplier",
      entityId: supplier.id,
      data: supplierToSave,
    });

    await cacheEntity({
      uid,
      companyId,
      entityType: "ledger",
      entityId: canonicalLedgerId,
      data: ledger,
    });

    return {
      success: true,
      party: supplierToSave,
      ledgerId: canonicalLedgerId,
      ledger,
      isExisting: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed atomic createSupplierWithLedger:", err);
    return {
      success: false,
      party: supplier,
      ledgerId: canonicalLedgerId,
      ledger: {} as Ledger,
      error: msg,
    };
  }
}
