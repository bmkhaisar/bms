import { ref, get, set, update } from "firebase/database";
import { firebaseAuth, firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { allocatePartyCodeServerFn } from "@/functions/allocatePartyCodeFn";
import { savePartyWithLedgerServerFn } from "@/functions/savePartyWithLedgerFn";
import type { Ledger } from "../types";
import { cacheEntity, getCachedEntities } from "@/modules/sync/dexieCache";

export interface CustomerParty {
  id: string;
  partyCode?: string;
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
  partyCode?: string;
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

export function normalizePartyName(name?: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePartyGstin(gstin?: string): string {
  return (gstin || "").trim().toUpperCase();
}

const MEMORY_COMPANY_CUSTOMERS: Record<string, Array<{ customer: CustomerParty; ledger: Ledger }>> = {};
const MEMORY_COMPANY_SUPPLIERS: Record<string, Array<{ supplier: SupplierParty; ledger: Ledger }>> = {};

export type PartyCodeKind = "customer" | "supplier";

/**
 * Allocates one immutable, company-scoped business reference. Assignments and counters
 * share a single RTDB transaction, so retries for the same partyId return the same code.
 */
export async function allocatePartyCode(params: {
  companyId: string;
  partyId: string;
  kind: PartyCodeKind;
}): Promise<string> {
  const { companyId, partyId, kind } = params;
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser) throw new Error("Sign in is required to allocate a party ID");
  const result = await allocatePartyCodeServerFn({
    data: { idToken: await currentUser.getIdToken(), companyId, partyId, kind },
  });
  if (!result.success || !result.partyCode) throw new Error(result.error || "Party ID allocation failed");
  return result.partyCode;
}

export interface PartyWithLedgerResult<P> {
  success: boolean;
  party: P;
  ledgerId: string;
  ledger: Ledger;
  isExisting?: boolean;
  conflictType?: "gstin" | "name" | "id";
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
  if (!customer.partyCode && firebaseDb) {
    customer.partyCode = await allocatePartyCode({ companyId, partyId: customer.id, kind: "customer" });
  }
  if (firebaseDb && firebaseAuth?.currentUser) {
    const saved = await savePartyWithLedgerServerFn({
      data: {
        idToken: await firebaseAuth.currentUser.getIdToken(),
        companyId,
        party: { ...customer, partyType: "SUNDRY_DEBTOR", paymentPolicy: (customer as any).paymentPolicy || "CREDIT" },
        idempotencyKey,
      },
    });
    if (!saved.success || !saved.party || !saved.ledgerId) {
      return { success: false, party: customer, ledgerId: "", ledger: {} as Ledger, error: saved.error || "Customer save failed" };
    }
    Object.assign(customer, saved.party);
    return { success: true, party: saved.party, ledgerId: saved.ledgerId, ledger: {} as Ledger, isExisting: saved.isExisting };
  }
  const canonicalLedgerId = customer.ledgerId || `led_${companyId}_cust_${customer.id}`;
  const now = Date.now();

    const normGstin = normalizePartyGstin(customer.gstin);

    if (!MEMORY_COMPANY_CUSTOMERS[companyId]) {
      MEMORY_COMPANY_CUSTOMERS[companyId] = [];
    }
    const memList = MEMORY_COMPANY_CUSTOMERS[companyId];

    // Check in-memory list for instant collision resolution
    for (const item of memList) {
      if (item.customer.id === customer.id) {
        return { success: true, party: item.customer, ledgerId: item.customer.ledgerId || canonicalLedgerId, ledger: item.ledger, isExisting: true, conflictType: "id" };
      }
      if (normGstin && normalizePartyGstin(item.customer.gstin) === normGstin) {
        return { success: true, party: item.customer, ledgerId: item.customer.ledgerId || canonicalLedgerId, ledger: item.ledger, isExisting: true, conflictType: "gstin" };
      }
      // Same-name parties are valid; GSTIN and immutable IDs are the collision keys.
    }

    try {
      if (firebaseDb) {
        // 1. Idempotency Check via idempotencyKey
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

        // 2. Concurrency Conflict Check in Company Customers
        const allCustRef = ref(firebaseDb, `companyData/${companyId}/customers`);
        const allCustSnap = await get(allCustRef);
        if (allCustSnap.exists()) {
          const custMap = allCustSnap.val();
          for (const ext of Object.values(custMap) as CustomerParty[]) {
            const isIdMatch = ext.id === customer.id;
            const isGstinMatch = Boolean(normGstin && normalizePartyGstin(ext.gstin) === normGstin);
            if (isIdMatch || isGstinMatch) {
              const lId = ext.ledgerId || `led_${companyId}_cust_${ext.id}`;
              const ledSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${lId}`));
              const foundLedger = ledSnap.exists() ? ledSnap.val() : ({} as Ledger);
              return {
                success: true,
                party: ext,
                ledgerId: lId,
                ledger: foundLedger,
                isExisting: true,
                conflictType: isGstinMatch ? "gstin" : "id",
              };
            }
          }
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

    memList.push({ customer: customerToSave, ledger });

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
  if (!supplier.partyCode && firebaseDb) {
    supplier.partyCode = await allocatePartyCode({ companyId, partyId: supplier.id, kind: "supplier" });
  }
  if (firebaseDb && firebaseAuth?.currentUser) {
    const saved = await savePartyWithLedgerServerFn({
      data: {
        idToken: await firebaseAuth.currentUser.getIdToken(),
        companyId,
        party: { ...supplier, partyType: "SUNDRY_CREDITOR", paymentPolicy: (supplier as any).paymentPolicy || "CREDIT" },
        idempotencyKey,
      },
    });
    if (!saved.success || !saved.party || !saved.apLedgerId) {
      return { success: false, party: supplier, ledgerId: "", ledger: {} as Ledger, error: saved.error || "Supplier save failed" };
    }
    Object.assign(supplier, saved.party);
    return { success: true, party: saved.party, ledgerId: saved.apLedgerId, ledger: {} as Ledger, isExisting: saved.isExisting };
  }
  const canonicalLedgerId = supplier.ledgerId || `led_${companyId}_supp_${supplier.id}`;
  const now = Date.now();

  const normGstin = normalizePartyGstin(supplier.gstin);

  if (!MEMORY_COMPANY_SUPPLIERS[companyId]) {
    MEMORY_COMPANY_SUPPLIERS[companyId] = [];
  }
  const memList = MEMORY_COMPANY_SUPPLIERS[companyId];

  // Check in-memory list for instant collision resolution
  for (const item of memList) {
    if (item.supplier.id === supplier.id) {
      return { success: true, party: item.supplier, ledgerId: item.supplier.ledgerId || canonicalLedgerId, ledger: item.ledger, isExisting: true, conflictType: "id" };
    }
    if (normGstin && normalizePartyGstin(item.supplier.gstin) === normGstin) {
      return { success: true, party: item.supplier, ledgerId: item.supplier.ledgerId || canonicalLedgerId, ledger: item.ledger, isExisting: true, conflictType: "gstin" };
    }
    // Same-name suppliers are valid; GSTIN and immutable IDs are the collision keys.
  }

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

      // Concurrency Conflict Check in Company Suppliers
      const allSuppRef = ref(firebaseDb, `companyData/${companyId}/suppliers`);
      const allSuppSnap = await get(allSuppRef);
      if (allSuppSnap.exists()) {
        const suppMap = allSuppSnap.val();
        for (const ext of Object.values(suppMap) as SupplierParty[]) {
          const isIdMatch = ext.id === supplier.id;
          const isGstinMatch = Boolean(normGstin && normalizePartyGstin(ext.gstin) === normGstin);
          if (isIdMatch || isGstinMatch) {
            const lId = ext.ledgerId || `led_${companyId}_supp_${ext.id}`;
            const ledSnap = await get(ref(firebaseDb, `companyData/${companyId}/ledgers/${lId}`));
            const foundLedger = ledSnap.exists() ? ledSnap.val() : ({} as Ledger);
            return {
              success: true,
              party: ext,
              ledgerId: lId,
              ledger: foundLedger,
              isExisting: true,
              conflictType: isGstinMatch ? "gstin" : "id",
            };
          }
        }
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

    memList.push({ supplier: supplierToSave, ledger });

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

/**
 * ATOMIC & IDEMPOTENT Party Master provisioning (PRD §§ 3, 4, 10, 24, 80).
 * Handles CUSTOMER, SUPPLIER, and BOTH party types with dedicated AR/AP subledgers.
 */
export async function createPartyWithLedger(
  params: {
    companyId: string;
    party: any; // Party type
    uid: string;
    idempotencyKey?: string;
  }
): Promise<{
  success: boolean;
  party: any;
  ledgerId?: string;
  apLedgerId?: string;
  isExisting?: boolean;
  error?: string;
}> {
  const { companyId, party, uid, idempotencyKey } = params;
  const partyType = party.partyType || "CUSTOMER";
  const now = Date.now();
  const isCustomer = ["CUSTOMER", "SUNDRY_DEBTOR", "SUNDRY_DEBTORS", "BOTH"].includes(partyType);
  const isSupplier = ["SUPPLIER", "SUNDRY_CREDITOR", "SUNDRY_CREDITORS", "BOTH"].includes(partyType);

  if (!party.partyCode && firebaseDb) {
    party.partyCode = await allocatePartyCode({
      companyId,
      partyId: party.id,
      kind: isSupplier && !isCustomer ? "supplier" : "customer",
    });
  }

  if (firebaseDb && firebaseAuth?.currentUser) {
    const result = await savePartyWithLedgerServerFn({
      data: {
        idToken: await firebaseAuth.currentUser.getIdToken(),
        companyId,
        party,
        idempotencyKey,
      },
    });
    if (!result.success || !result.party) return { success: false, party, error: result.error || "Party save failed" };
    Object.assign(party, result.party);
    await cacheEntity({ uid, companyId, entityType: "party", entityId: party.id, data: result.party });
    return {
      success: true,
      party: result.party,
      ledgerId: result.ledgerId,
      apLedgerId: result.apLedgerId,
      isExisting: result.isExisting,
    };
  }

  const canonicalArLedgerId = party.ledgerId || `led_${companyId}_ar_${party.id}`;
  const canonicalApLedgerId = party.apLedgerId || `led_${companyId}_ap_${party.id}`;

  try {
    const openingPaise = Math.round((party.openingBalance || 0) * 100);
    const updates: Record<string, unknown> = {};

    let arLedger: Ledger | undefined;
    let apLedger: Ledger | undefined;

    if (isCustomer) {
      arLedger = {
        id: canonicalArLedgerId,
        companyId,
        name: party.tradingName || (party.company ? `${party.name} (${party.company})` : party.name),
        groupId: "grp_sundry_debtors",
        groupNature: "asset",
        openingBalance: Math.abs(openingPaise),
        openingBalanceType: openingPaise < 0 ? "cr" : "dr",
        currentBalance: openingPaise,
        currency: "INR",
        gstin: party.gstin,
        partyType: "customer",
        partyId: party.id,
        active: true,
        createdAt: party.createdAt || now,
        updatedAt: now,
      };
      updates[`companyData/${companyId}/ledgers/${canonicalArLedgerId}`] = sanitizeForFirebase(arLedger);
    }

    if (isSupplier) {
      apLedger = {
        id: canonicalApLedgerId,
        companyId,
        name: party.tradingName || (party.company ? `${party.name} (${party.company})` : party.name),
        groupId: "grp_sundry_creditors",
        groupNature: "liability",
        openingBalance: Math.abs(openingPaise),
        openingBalanceType: openingPaise < 0 ? "dr" : "cr",
        currentBalance: -Math.abs(openingPaise),
        currency: "INR",
        gstin: party.gstin,
        partyType: "supplier",
        partyId: party.id,
        active: true,
        createdAt: party.createdAt || now,
        updatedAt: now,
      };
      updates[`companyData/${companyId}/ledgers/${canonicalApLedgerId}`] = sanitizeForFirebase(apLedger);
    }

    const partyToSave = {
      ...party,
      partyType,
      ledgerId: arLedger ? canonicalArLedgerId : party.ledgerId,
      apLedgerId: apLedger ? canonicalApLedgerId : party.apLedgerId,
      createdAt: party.createdAt || now,
      updatedAt: now,
    };

    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/parties/${party.id}`] = sanitizeForFirebase(partyToSave);

    // Mirror to legacy collections for seamless backward compatibility
    if (isCustomer) {
      updates[`companyData/${companyId}/customers/${party.id}`] = sanitizeForFirebase(partyToSave);
    }
    if (isSupplier) {
      updates[`companyData/${companyId}/suppliers/${party.id}`] = sanitizeForFirebase(partyToSave);
    }

    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "party",
      entityId: party.id,
      action: "create_party_with_ledger",
      performedBy: uid,
      timestamp: now,
      details: {
        name: party.name,
        partyType,
        paymentPolicy: party.paymentPolicy || "CREDIT",
        arLedgerId: arLedger?.id,
        apLedgerId: apLedger?.id,
      },
    };

    if (idempotencyKey) {
      updates[`companyData/${companyId}/partyMutations/${idempotencyKey}`] = {
        partyId: party.id,
        timestamp: now,
        performedBy: uid,
      };
    }

    if (firebaseDb) {
      await update(ref(firebaseDb), updates);
    }

    // Cache locally
    await cacheEntity({
      uid,
      companyId,
      entityType: "party",
      entityId: party.id,
      data: partyToSave,
    });
    if (isCustomer) {
      await cacheEntity({
        uid,
        companyId,
        entityType: "customer",
        entityId: party.id,
        data: partyToSave,
      });
    }
    if (isSupplier) {
      await cacheEntity({
        uid,
        companyId,
        entityType: "supplier",
        entityId: party.id,
        data: partyToSave,
      });
    }

    return {
      success: true,
      party: partyToSave,
      ledgerId: arLedger?.id,
      apLedgerId: apLedger?.id,
      isExisting: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed createPartyWithLedger:", err);
    return {
      success: false,
      party,
      error: msg,
    };
  }
}

/**
 * Idempotently ensures a default system liquidity ledger (cash or bank) exists.
 */
export async function ensureLiquidityLedger(params: {
  companyId: string;
  type: "cash" | "bank";
  uid?: string;
}): Promise<string> {
  const { companyId, type, uid = "system" } = params;
  const canonicalId = `led_${companyId}_${type}`;

  if (firebaseDb) {
    try {
      const ledgerRef = ref(firebaseDb, `companyData/${companyId}/ledgers/${canonicalId}`);
      const snap = await get(ledgerRef);
      if (!snap.exists()) {
        const now = Date.now();
        const newLedger: Ledger = {
          id: canonicalId,
          companyId,
          name: type === "cash" ? "Cash in Hand" : "Bank Account",
          code: type === "cash" ? "CASH" : "BANK",
          groupId: type === "cash" ? "grp_cash" : "grp_bank",
          groupNature: "asset",
          openingBalance: 0,
          openingBalanceType: "dr",
          currentBalance: 0,
          currency: "INR",
          partyType: type,
          isSystem: true,
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        await set(ledgerRef, sanitizeForFirebase(newLedger));
        await cacheEntity({
          uid,
          companyId,
          entityType: "ledger",
          entityId: canonicalId,
          data: newLedger,
        });
      }
    } catch (e) {
      console.warn("Failed to check/create liquidity ledger in Firebase:", e);
    }
  }

  return canonicalId;
}

