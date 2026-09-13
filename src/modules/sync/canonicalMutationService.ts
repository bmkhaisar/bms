/**
 * Canonical Authoritative Cloud Mutation Service (PRD §§ 49, 56-59, 77-78)
 * 
 * Flow for EVERY entity (Invoice, Quotation, Purchase, Receipt, Payment, Party, Product, Address):
 * 1. User Action
 * 2. Trusted server/Firebase RTDB authoritative write/update
 * 3. Await Firebase success
 * 4. Return authoritative saved record/result
 * 5. Update React/query state
 * 6. Update Dexie (bms_db_v1) & Cache (bms_cache_v1)
 * 7. Realtime listener broadcasts change to every logged-in device without refresh.
 * 
 * Rules:
 * - Firebase RTDB is the single authoritative source of truth.
 * - Dexie/local state is never treated as final authority.
 * - DRAFT: true delete in RTDB -> Dexie remove -> React remove -> Realtime propagate.
 * - POSTED: voided/cancelled in RTDB with reversal accounting -> active list excludes -> history retains -> Realtime propagate.
 * - Never show success toast until Firebase succeeds. On failure, rollback local state and show error.
 */

import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove, update as rtdbUpdate } from "firebase/database";
import { db, type Invoice, type Quotation, type Purchase, type Receipt, type Payment, type Party, type Product, type PartyAddress } from "@/lib/db";
import { cacheEntity, removeCachedEntity } from "./dexieCache";
import { reconcileDocumentPostSuccess } from "@/lib/reconciliation";
import { reverseVoucherServerFn } from "@/functions/reverseVoucherFn";
import { applyStockDelta } from "@/lib/calc";

export type EntityKind =
  | "invoice"
  | "quotation"
  | "purchase"
  | "receipt"
  | "payment"
  | "party"
  | "product"
  | "address";

function getCollectionName(kind: EntityKind): string {
  switch (kind) {
    case "invoice": return "invoices";
    case "quotation": return "quotations";
    case "purchase": return "purchases";
    case "receipt": return "receipts";
    case "payment": return "payments";
    case "party": return "parties";
    case "product": return "products";
    case "address": return "parties";
    default: return `${kind}s`;
  }
}

function getDexieTable(kind: EntityKind): any {
  switch (kind) {
    case "invoice": return db().invoices;
    case "quotation": return db().quotations;
    case "purchase": return db().purchases;
    case "receipt": return db().receipts;
    case "payment": return db().payments;
    case "party": return db().parties;
    case "product": return db().products;
    default: return null;
  }
}

export interface AuthoritativeDeleteDraftParams {
  companyId: string;
  kind: "invoice" | "quotation" | "purchase" | "receipt" | "payment" | "party" | "product";
  id: string;
  uid?: string;
  itemsToRevertStock?: any[];
  stockDeltaDirection?: 1 | -1;
}

/**
 * Authoritatively deletes a DRAFT entity from Firebase RTDB first, then purges Dexie and cache.
 */
export async function authoritativeDeleteDraft(params: AuthoritativeDeleteDraftParams): Promise<{ success: boolean; error?: string }> {
  const { companyId, kind, id, uid = "system", itemsToRevertStock, stockDeltaDirection } = params;
  if (!companyId || !id) {
    throw new Error("Missing companyId or entity id for authoritative delete");
  }

  const collection = getCollectionName(kind);

  // 1. Authoritatively delete from Firebase RTDB FIRST
  if (firebaseDb) {
    const docRef = ref(firebaseDb, `companyData/${companyId}/${collection}/${id}`);
    await rtdbRemove(docRef);

    if (kind === "party") {
      // Clean up legacy paths if applicable
      await rtdbRemove(ref(firebaseDb, `companyData/${companyId}/customers/${id}`)).catch(() => {});
      await rtdbRemove(ref(firebaseDb, `companyData/${companyId}/suppliers/${id}`)).catch(() => {});
    }
  }

  // 2. On Firebase success: Revert any temporary reserved stock if required
  if (itemsToRevertStock && itemsToRevertStock.length > 0 && stockDeltaDirection) {
    try {
      await applyStockDelta(itemsToRevertStock, stockDeltaDirection);
    } catch (stockErr) {
      console.warn("[authoritativeDeleteDraft] Stock revert delta warning:", stockErr);
    }
  }

  // 3. Remove from Dexie reactive table
  const table = getDexieTable(kind);
  if (table) {
    await table.delete(id);
    if (kind === "party") {
      await db().customers.delete(id).catch(() => {});
      await db().suppliers.delete(id).catch(() => {});
    }
  }

  // 4. Purge from local tenant cache bms_cache_v1
  await removeCachedEntity({ companyId, entityType: kind, entityId: id });
  if (kind === "party") {
    await removeCachedEntity({ companyId, entityType: "customer", entityId: id }).catch(() => {});
    await removeCachedEntity({ companyId, entityType: "supplier", entityId: id }).catch(() => {});
  }

  // 5. Invalidate React Query caches for instant UI update
  reconcileDocumentPostSuccess({
    entityType: kind,
    companyId,
    action: "delete",
  });

  return { success: true };
}

export interface AuthoritativeVoidPostedParams {
  companyId: string;
  financialYearId?: string;
  kind: "invoice" | "purchase" | "receipt" | "payment";
  doc: any;
  user?: any;
  idToken?: string;
  reversalReason?: string;
}

/**
 * Authoritatively voids a POSTED financial document.
 * Does NOT physically destroy accounting history.
 * 1. Reverses accounting voucher on server (if posted with voucher)
 * 2. Writes status = "cancelled" / postingStatus = "reversed" to Firebase RTDB authoritatively
 * 3. Updates Dexie & cache
 * 4. Reverts inventory stock movements
 * 5. Broadcasts realtime void to all devices
 */
export async function authoritativeVoidPosted(params: AuthoritativeVoidPostedParams): Promise<{ success: boolean; voidedDoc: any; error?: string }> {
  const { companyId, financialYearId, kind, doc, user, idToken, reversalReason } = params;
  if (!companyId || !doc?.id) {
    throw new Error("Missing companyId or document for authoritative void");
  }

  const collection = getCollectionName(kind);
  const now = Date.now();

  const voidedDoc = {
    ...doc,
    status: "cancelled",
    postingStatus: "reversed",
    cancelledAt: now,
    updatedAt: now,
    reversalReason: reversalReason || `${kind.toUpperCase()} voided with reversal accounting`,
  };

  // 1. If document has a posted voucher, reverse it on server
  if (doc.voucherId && idToken && financialYearId) {
    try {
      const revRes = await reverseVoucherServerFn({
        data: {
          idToken,
          companyId,
          voucherId: doc.voucherId,
          reversalReason: voidedDoc.reversalReason,
          clientMutationId: `rev_${doc.id}_${now}`,
        },
      });
      if (!revRes.success) {
        throw new Error(revRes.error || "Failed to reverse accounting voucher on server");
      }
    } catch (vErr: any) {
      console.error("[authoritativeVoidPosted] Voucher reversal failed:", vErr);
      throw new Error(vErr.message || "Failed to reverse accounting voucher");
    }
  }

  // 2. Write authoritative voided status to Firebase RTDB FIRST
  if (firebaseDb) {
    const docRef = ref(firebaseDb, `companyData/${companyId}/${collection}/${doc.id}`);
    await set(docRef, sanitizeForFirebase(voidedDoc));
  }

  // 3. Revert physical inventory stock delta
  if (doc.items && doc.items.length > 0) {
    try {
      if (kind === "invoice") {
        await applyStockDelta(doc.items, 1); // Sales void: restock
      } else if (kind === "purchase") {
        await applyStockDelta(doc.items, -1); // Purchase void: unstock
      }
    } catch (stkErr) {
      console.warn("[authoritativeVoidPosted] Stock delta adjustment warning:", stkErr);
    }
  }

  // 4. Update Dexie reactive table immediately
  const table = getDexieTable(kind);
  if (table) {
    await table.put(voidedDoc);
  }

  // 5. Update tenant cache bms_cache_v1
  await cacheEntity({
    uid: user?.uid || "system",
    companyId,
    financialYearId,
    entityType: kind,
    entityId: doc.id,
    data: voidedDoc,
  });

  // 6. Invalidate React queries so active lists and reports update immediately
  reconcileDocumentPostSuccess({
    entityType: kind,
    companyId,
    document: voidedDoc,
    action: "void",
  });

  return { success: true, voidedDoc };
}

export interface AuthoritativeSaveEntityParams {
  companyId: string;
  financialYearId?: string;
  kind: EntityKind;
  entity: any;
  uid?: string;
  action?: "create" | "update";
}

/**
 * Authoritatively saves an entity to Firebase RTDB FIRST, then saves to Dexie and local cache.
 */
export async function authoritativeSaveEntity(params: AuthoritativeSaveEntityParams): Promise<{ success: boolean; data: any }> {
  const { companyId, financialYearId, kind, entity, uid = "system", action = "update" } = params;
  if (!companyId || !entity?.id) {
    throw new Error("Missing companyId or entity for authoritative save");
  }

  const collection = getCollectionName(kind);
  const toSave = {
    ...entity,
    updatedAt: Date.now(),
  };

  // 1. Authoritative write to Firebase RTDB FIRST
  if (firebaseDb) {
    const docRef = ref(firebaseDb, `companyData/${companyId}/${collection}/${entity.id}`);
    await set(docRef, sanitizeForFirebase(toSave));

    if (kind === "party") {
      const pType = String(toSave.partyType || "").toUpperCase();
      const isCustomer = pType === "CUSTOMER" || pType === "BOTH" || pType.includes("DEBTOR");
      const isSupplier = pType === "SUPPLIER" || pType === "BOTH" || pType.includes("CREDITOR");

      if (isCustomer) {
        await set(ref(firebaseDb, `companyData/${companyId}/customers/${entity.id}`), sanitizeForFirebase(toSave)).catch(() => {});
      }
      if (isSupplier) {
        await set(ref(firebaseDb, `companyData/${companyId}/suppliers/${entity.id}`), sanitizeForFirebase(toSave)).catch(() => {});
      }
    }
  }

  // 2. On Firebase success: Save to local Dexie database
  const table = getDexieTable(kind);
  if (table) {
    await table.put(toSave);
    if (kind === "party") {
      const pType = String(toSave.partyType || "").toUpperCase();
      const isCustomer = pType === "CUSTOMER" || pType === "BOTH" || pType.includes("DEBTOR");
      const isSupplier = pType === "SUPPLIER" || pType === "BOTH" || pType.includes("CREDITOR");

      if (isCustomer) {
        await db().customers.put(toSave as any).catch(() => {});
      }
      if (isSupplier) {
        await db().suppliers.put(toSave as any).catch(() => {});
      }
    }
  }

  // 3. Save to local tenant cache bms_cache_v1
  await cacheEntity({
    uid,
    companyId,
    financialYearId,
    entityType: kind,
    entityId: entity.id,
    data: toSave,
  });

  // 4. Invalidate queries
  reconcileDocumentPostSuccess({
    entityType: kind as any,
    companyId,
    document: toSave,
    action,
  });

  return { success: true, data: toSave };
}

export interface AuthoritativeSaveAddressesParams {
  companyId: string;
  party: Party;
  addresses: PartyAddress[];
  uid?: string;
}

/**
 * Authoritatively saves party addresses to Firebase RTDB FIRST, then updates Dexie.
 */
export async function authoritativeSavePartyAddresses(params: AuthoritativeSaveAddressesParams): Promise<{ success: boolean; updatedParty: Party }> {
  const { companyId, party, addresses, uid = "system" } = params;
  if (!companyId || !party?.id) {
    throw new Error("Missing companyId or party for address update");
  }

  const updatedParty: Party = {
    ...party,
    addresses,
    updatedAt: Date.now(),
  };

  // 1. Authoritative write to Firebase RTDB FIRST
  if (firebaseDb) {
    const updates: Record<string, unknown> = {};
    updates[`companyData/${companyId}/parties/${party.id}/addresses`] = sanitizeForFirebase(addresses);
    updates[`companyData/${companyId}/customers/${party.id}/addresses`] = sanitizeForFirebase(addresses);
    updates[`companyData/${companyId}/suppliers/${party.id}/addresses`] = sanitizeForFirebase(addresses);
    updates[`companyData/${companyId}/parties/${party.id}/updatedAt`] = updatedParty.updatedAt;
    await rtdbUpdate(ref(firebaseDb), updates);
  }

  // 2. On Firebase success: Update Dexie
  await db().parties.put(updatedParty);
  await db().customers.put(updatedParty as any).catch(() => {});
  await db().suppliers.put(updatedParty as any).catch(() => {});

  // 3. Update cache
  await cacheEntity({
    uid,
    companyId,
    entityType: "party",
    entityId: party.id,
    data: updatedParty,
  });

  reconcileDocumentPostSuccess({
    entityType: "party",
    companyId,
    document: updatedParty,
    action: "update",
  });

  return { success: true, updatedParty };
}
