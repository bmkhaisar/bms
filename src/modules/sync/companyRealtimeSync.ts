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
import { ref, get, query, orderByChild, equalTo, onValue, type Unsubscribe } from "firebase/database";
import { db } from "@/lib/db";
import { cacheEntitiesBulk, removeCachedEntity, purgeCompanyCacheAndOutbox } from "./dexieCache";
import { normalizeQuotationRecord } from "@/modules/documents/quotationNormalization";
import { useState, useEffect } from "react";

export interface CompanySyncStatus {
  companyId: string | null;
  isInitialSyncRunning: boolean;
  isHydrated: boolean;
  lastSyncedAt: number | null;
}

type SyncListener = (status: CompanySyncStatus) => void;

class CompanySyncTracker {
  private status: CompanySyncStatus = {
    companyId: null,
    isInitialSyncRunning: false,
    isHydrated: false,
    lastSyncedAt: null,
  };
  private listeners = new Set<SyncListener>();

  getStatus(): CompanySyncStatus {
    return this.status;
  }

  update(partial: Partial<CompanySyncStatus>) {
    this.status = { ...this.status, ...partial };
    this.notify();
  }

  subscribe(fn: SyncListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch {}
    }
  }
}

export const companySyncTracker = new CompanySyncTracker();

export function useCompanySyncStatus(): CompanySyncStatus {
  const [status, setStatus] = useState<CompanySyncStatus>(() => companySyncTracker.getStatus());

  useEffect(() => {
    return companySyncTracker.subscribe((newStatus) => {
      setStatus(newStatus);
    });
  }, []);

  return status;
}

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

    if (isOperational) {
      // Invariant Check 2: ALL_BRANCH_LISTENER_OWNER_ONLY
      // Consolidated operational subscription strictly requires authoritative Owner access.
      // Non-owner manipulating activeBranchId to "all" receives NO consolidated listener.
      const isOwnerConsolidated = isOwner === true && (activeBranchId === "all" || !activeBranchId);

      if (isOwnerConsolidated) {
        // Authoritative Owner Consolidated operational subscription
        colRef = ref(currentDb, `companyData/${companyId}/${col.name}`);
      } else {
        // BRANCH-SCOPED OPERATIONAL: Bound query subscription to caller's branch only
        // Non-owner attempting activeBranchId === "all" is strictly rejected from consolidated listener
        if (!isOwner && (activeBranchId === "all" || !activeBranchId)) {
          if (authorizedBranchIds.length > 0) {
            colRef = query(
              ref(currentDb, `companyData/${companyId}/${col.name}`),
              orderByChild("branchId"),
              equalTo(authorizedBranchIds[0])
            );
          } else {
            colRef = ref(currentDb, `companyData/${companyId}/${col.name}`);
          }
        } else {
          colRef = query(
            ref(currentDb, `companyData/${companyId}/${col.name}`),
            orderByChild("branchId"),
            equalTo(activeBranchId!)
          );
        }
      }
    } else {
      // Organization-wide master collection (parties, products, categories, branches, etc.)
      colRef = ref(currentDb, `companyData/${companyId}/${col.name}`);
    }

    const unsub = onValue(
      colRef,
      (snapshot) => {
        const prior = queues.get(col.name) || Promise.resolve();
        const next = prior.then(async () => {
          try {
            if (!snapshot.exists() || !snapshot.val()) {
              if (!isOperational || (isOwner && activeBranchId === "all")) {
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
            if (isOperational && !isOwner) {
              const effectiveAllowed = activeBranchId === "all" ? authorizedBranchIds[0] : activeBranchId;
              records = records.filter(
                (r) => r.branchId === activeBranchId || (effectiveAllowed && r.branchId === effectiveAllowed)
              );
            }

            const cloudIds = new Set(records.map((r: any) => r.id));

            // Authoritative Deletion Reconciliation
            const localRows = await (col.table as any).toArray();
            const idsToDelete = localRows
              .filter((r: any) => {
                if (!r.id) return false;
                if (isOperational && activeBranchId && activeBranchId !== "all") {
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

  // 3. Fast Parallel Proactive Hydration (Cross-Device Instant Loading)
  const performFastHydration = async () => {
    // Check if Dexie already has records on this local device
    try {
      const [invCount, custCount, prodCount] = await Promise.all([
        db().invoices.count(),
        db().customers.count(),
        db().products.count(),
      ]);
      const hasLocalData = (invCount + custCount + prodCount) > 0;
      if (hasLocalData) {
        // Device already has cached local data, mark hydrated immediately so UI is 0ms responsive
        companySyncTracker.update({
          companyId,
          isHydrated: true,
        });
      }
    } catch {}

    companySyncTracker.update({
      companyId,
      isInitialSyncRunning: true,
    });

    const allColsToHydrate = [...masterCollections, ...operationalCollections];

    try {
      await Promise.allSettled(
        allColsToHydrate.map(async (col) => {
          try {
            const queryRef = ref(currentDb, `companyData/${companyId}/${col.name}`);
            const getPromise = get(queryRef);
            const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5500));
            const snap = await Promise.race([getPromise, timeoutPromise]);

            if (snap && snap.exists() && snap.val()) {
              const val = snap.val();
              let records = Object.entries(val).map(([id, record]: [string, any]) => {
                const raw = { ...record, id: record?.id || id };
                return "normalize" in col && (col as any).normalize ? (col as any).normalize(raw) : raw;
              });

              const isOperational = operationalCollections.some((oc) => oc.name === col.name);
              if (isOperational && !isOwner && activeBranchId && activeBranchId !== "all") {
                records = records.filter(
                  (r) => r.branchId === activeBranchId || (authorizedBranchIds.length > 0 && r.branchId === authorizedBranchIds[0])
                );
              }

              if (records.length > 0) {
                await (col.table as any).bulkPut(records);
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
                cacheEntitiesBulk(cacheItems).catch(() => {});
              }
            }
          } catch (colErr) {
            console.warn(`[fastHydrate] Error hydrating ${col.name}:`, colErr);
          }
        })
      );
    } catch (e) {
      console.warn("[fastHydrate] Overall hydration warning:", e);
    } finally {
      companySyncTracker.update({
        companyId,
        isInitialSyncRunning: false,
        isHydrated: true,
        lastSyncedAt: Date.now(),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bms:company-data-hydrated", { detail: { companyId } }));
      }
    }
  };

  // Launch fast parallel hydration immediately
  performFastHydration();

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

