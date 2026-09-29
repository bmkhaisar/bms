/**
 * Centralized Multi-Device Realtime Company Synchronization (PRD §§ 49, 56-59, 77-78)
 * 
 * Synchronizes active company data (parties, documents, receipts, payments, ledgers)
 * between Firebase Realtime Database and local Dexie databases without requiring
 * manual browser page reloads (F5).
 * 
 * ============================================================================
 * REALTIME LISTENER ARCHITECTURE CLASSIFICATIONS (Pre-Merge Blocker 4):
 * 
 * 1. ORGANIZATION-WIDE MASTER (Shared master entities across the organization):
 *    - parties, customers, suppliers, products, categories, productSizes, sizes,
 *      termsTemplates, generalInfoTemplates, techSpecTemplates, bankAccounts,
 *      quotationTemplates, branches, companySettings, operationalReset.
 * 
 * 2. BRANCH-SCOPED OPERATIONAL (Transactional records scoped to a physical branch):
 *    - invoices, purchases, receipts, payments, quotations, salesReturns, creditNotes.
 *    For branch-restricted users, subscriptions are bounded:
 *    `query(ref, orderByChild("branchId"), equalTo(activeBranchId))`
 *    guaranteeing that the client never receives foreign branch payloads over the wire.
 * 
 * 3. OWNER CONSOLIDATED:
 *    - Consolidated organization-wide operational subscriptions across all branches,
 *      strictly permitted only when `isOwner === true` or `activeBranchId === "all"`.
 * ============================================================================
 */

import { firebaseDb } from "@/config/firebase";
import { ref, query, orderByChild, equalTo, onValue, type Unsubscribe } from "firebase/database";
import { db } from "@/lib/db";
import { cacheEntitiesBulk, removeCachedEntity, purgeCompanyCacheAndOutbox } from "./dexieCache";
import { normalizeQuotationRecord } from "@/modules/documents/quotationNormalization";

export interface CompanyRealtimeSyncOptions {
  companyId: string;
  uid?: string;
  financialYearId?: string;
  activeBranchId?: string;
  authorizedBranchIds?: string[];
  isOwner?: boolean;
}

export function startCompanyRealtimeSync(options: CompanyRealtimeSyncOptions): () => void {
  const {
    companyId,
    uid = "system",
    financialYearId,
    activeBranchId,
    authorizedBranchIds = [],
    isOwner = false,
  } = options;

  if (!companyId || !firebaseDb || typeof window === "undefined") {
    return () => {};
  }

  const currentDb = firebaseDb;
  const unsubs: Unsubscribe[] = [];

  // Master collections: organization-wide, shared across all branches
  const masterCollections = [
    { name: "parties", table: db().parties, entityType: "party" },
    { name: "customers", table: db().customers, entityType: "customer" },
    { name: "suppliers", table: db().suppliers, entityType: "supplier" },
    { name: "products", table: db().products, entityType: "product" },
    { name: "categories", table: db().categories, entityType: "category" },
    { name: "productSizes", table: db().productSizes, entityType: "productSize" },
    { name: "sizes", table: db().sizes, entityType: "size" },
    { name: "termsTemplates", table: db().termsTemplates, entityType: "termsTemplate" },
    { name: "generalInfoTemplates", table: db().generalInfoTemplates, entityType: "generalInfoTemplate" },
    { name: "techSpecTemplates", table: db().techSpecTemplates, entityType: "techSpecTemplate" },
    { name: "bankAccounts", table: db().bankAccounts, entityType: "bankAccount" },
    { name: "quotationTemplates", table: db().quotationTemplates, entityType: "quotationTemplate" },
    { name: "branches", table: db().branches, entityType: "branch" },
  ];

  // Operational collections: transactional, strictly branch-scoped
  const operationalCollections = [
    { name: "invoices", table: db().invoices, entityType: "invoice" },
    { name: "purchases", table: db().purchases, entityType: "purchase" },
    { name: "receipts", table: db().receipts, entityType: "receipt" },
    { name: "payments", table: db().payments, entityType: "payment" },
    { name: "quotations", table: db().quotations, entityType: "quotation", normalize: normalizeQuotationRecord },
    { name: "salesReturns", table: db().salesReturns, entityType: "salesReturn" },
    { name: "creditNotes", table: db().creditNotes, entityType: "creditNote" },
  ];

  // Serialize snapshots per collection so a slow older reconciliation can never overwrite a newer event.
  const queues = new Map<string, Promise<void>>();

  // 1. Organization Reset Listener
  const resetRef = ref(firebaseDb, `companyData/${companyId}/operationalReset`);
  const resetUnsub = onValue(resetRef, async (snapshot) => {
    const resetAt = Number(snapshot.val()?.completedAt || 0);
    if (!resetAt) return;
    const markerKey = `bms-reset:${companyId}`;
    if (Number(localStorage.getItem(markerKey) || 0) >= resetAt) return;
    await Promise.all([
      db().invoices.clear(), db().quotations.clear(), db().purchases.clear(), db().receipts.clear(), db().payments.clear(),
      db().salesReturns.clear(), db().creditNotes.clear(),
      db().parties.clear(), db().customers.clear(), db().suppliers.clear(), db().productSizes.clear(), db().sizes.clear(),
    ]);
    await purgeCompanyCacheAndOutbox(companyId);
    localStorage.setItem(markerKey, String(resetAt));
  });
  unsubs.push(resetUnsub);

  // 2. Central Company Settings Realtime Listener: Syncs company profile & bank details to Dexie
  const companyProfileRef = ref(firebaseDb, `companies/${companyId}`);
  const compProfileUnsub = onValue(companyProfileRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const companyData = snapshot.val();
    if (!companyData) return;

    try {
      const normalizedSettings = {
        ...companyData,
        id: companyId,
        updatedAt: companyData.updatedAt || Date.now(),
      };

      await db().companySettings.put(normalizedSettings);
      await db().companySettings.put({
        ...normalizedSettings,
        id: "singleton",
      });

      await cacheEntitiesBulk([{
        uid,
        companyId,
        financialYearId,
        entityType: "company",
        entityId: "profile",
        data: normalizedSettings,
        version: companyData.version || 1,
        serverUpdatedAt: companyData.updatedAt || Date.now(),
      }]);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("bms:company-settings-updated", {
            detail: { companyId, company: normalizedSettings },
          })
        );
      }
    } catch (err) {
      console.warn("[companyRealtimeSync] Failed to reconcile company profile:", err);
    }
  });
  unsubs.push(compProfileUnsub);

  // Helper function to bind and handle collection snapshot
  const bindCollectionListener = (col: (typeof masterCollections)[0], isOperational: boolean) => {
    let colRef: any;

    if (isOperational && !isOwner && activeBranchId && activeBranchId !== "all") {
      // BRANCH-SCOPED OPERATIONAL: Bound query subscription to caller's branch only
      colRef = query(
        ref(currentDb, `companyData/${companyId}/${col.name}`),
        orderByChild("branchId"),
        equalTo(activeBranchId)
      );
    } else {
      // ORGANIZATION-WIDE MASTER or OWNER CONSOLIDATED
      colRef = ref(currentDb, `companyData/${companyId}/${col.name}`);
    }

    const unsub = onValue(
      colRef,
      (snapshot) => {
        const prior = queues.get(col.name) || Promise.resolve();
        const next = prior.then(async () => {
          try {
            if (!snapshot.exists() || !snapshot.val()) {
              if (!isOperational || isOwner || activeBranchId === "all") {
                const localRows = await (col.table as any).toArray();
                if (localRows.length > 0) {
                  const idsToDelete = localRows.map((r: any) => r.id).filter(Boolean);
                  if (idsToDelete.length > 0) {
                    await (col.table as any).bulkDelete(idsToDelete);
                    for (const id of idsToDelete) {
                      await removeCachedEntity({ companyId, entityType: col.entityType, entityId: id });
                    }
                  }
                }
              }
              return;
            }

            const val = snapshot.val();
            let records = Object.entries(val).map(([id, record]: [string, any]) => {
              const raw = { ...record, id: record?.id || id };
              return "normalize" in col && (col as any).normalize ? (col as any).normalize(raw) : raw;
            });

            // NO_UNAUTHORIZED_REALTIME_PAYLOAD: For branch-restricted users, ensure non-authorized branch records are discarded
            if (isOperational && !isOwner && activeBranchId && activeBranchId !== "all") {
              records = records.filter((r) => !r.branchId || r.branchId === activeBranchId);
            }

            const cloudIds = new Set(records.map((r: any) => r.id));

            // Authoritative Deletion Reconciliation
            const localRows = await (col.table as any).toArray();
            const idsToDelete = localRows
              .filter((r: any) => {
                if (!r.id) return false;
                if (isOperational && !isOwner && activeBranchId && activeBranchId !== "all") {
                  return r.branchId === activeBranchId && !cloudIds.has(r.id);
                }
                return !cloudIds.has(r.id);
              })
              .map((r: any) => r.id);

            if (idsToDelete.length > 0) {
              await (col.table as any).bulkDelete(idsToDelete);
              for (const id of idsToDelete) {
                await removeCachedEntity({ companyId, entityType: col.entityType, entityId: id });
              }
            }

            if (records.length === 0) return;

            // Update application Dexie table
            await (col.table as any).bulkPut(records);

            // Mirror into bms_cache_v1
            const cacheItems = records.map((r) => ({
              uid,
              companyId,
              branchId: r.branchId || (isOperational ? activeBranchId : undefined),
              financialYearId,
              entityType: col.entityType,
              entityId: r.id || String(r),
              data: r,
              version: r.version || 1,
              serverUpdatedAt: r.updatedAt || Date.now(),
            }));
            await cacheEntitiesBulk(cacheItems);
          } catch (err) {
            console.warn(`[companyRealtimeSync] Failed to sync ${col.name}:`, err);
          }
        });
        queues.set(col.name, next);
      },
      (error) => {
        console.warn(`[companyRealtimeSync] Listener error on ${col.name}:`, error);
      }
    );
    unsubs.push(unsub);
  };

  // Bind Organization-Wide Master listeners
  for (const col of masterCollections) {
    bindCollectionListener(col, false);
  }

  // Bind Branch-Scoped Operational listeners
  for (const col of operationalCollections) {
    bindCollectionListener(col, true);
  }

  // Authoritative listener teardown callback
  return () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {}
    }
    queues.clear();
  };
}

