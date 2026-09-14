/**
 * Centralized Multi-Device Realtime Company Synchronization (PRD §§ 49, 56-59, 77-78)
 * 
 * Synchronizes active company data (parties, documents, receipts, payments, ledgers)
 * between Firebase Realtime Database and local Dexie databases without requiring
 * manual browser page reloads (F5).
 */

import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off, type Unsubscribe } from "firebase/database";
import { db } from "@/lib/db";
import { cacheEntitiesBulk, removeCachedEntity, purgeCompanyCacheAndOutbox } from "./dexieCache";

export interface CompanyRealtimeSyncOptions {
  companyId: string;
  uid?: string;
  financialYearId?: string;
}

export function startCompanyRealtimeSync(options: CompanyRealtimeSyncOptions): () => void {
  const { companyId, uid = "system", financialYearId } = options;
  if (!companyId || !firebaseDb || typeof window === "undefined") {
    return () => {};
  }

  const unsubs: Unsubscribe[] = [];

  const collections = [
    { name: "parties", table: db().parties, entityType: "party" },
    { name: "customers", table: db().customers, entityType: "customer" },
    { name: "suppliers", table: db().suppliers, entityType: "supplier" },
    { name: "invoices", table: db().invoices, entityType: "invoice" },
    { name: "purchases", table: db().purchases, entityType: "purchase" },
    { name: "receipts", table: db().receipts, entityType: "receipt" },
    { name: "payments", table: db().payments, entityType: "payment" },
    { name: "quotations", table: db().quotations, entityType: "quotation" },
    { name: "products", table: db().products, entityType: "product" },
    { name: "categories", table: db().categories, entityType: "category" },
    { name: "productSizes", table: db().productSizes, entityType: "productSize" },
    { name: "termsTemplates", table: db().termsTemplates, entityType: "termsTemplate" },
    { name: "generalInfoTemplates", table: db().generalInfoTemplates, entityType: "generalInfoTemplate" },
    { name: "techSpecTemplates", table: db().techSpecTemplates, entityType: "techSpecTemplate" },
    { name: "bankAccounts", table: db().bankAccounts, entityType: "bankAccount" },
    { name: "quotationTemplates", table: db().quotationTemplates, entityType: "quotationTemplate" },
  ];

  // Serialize snapshots per collection so a slow older reconciliation can never overwrite a newer event.
  const queues = new Map<string, Promise<void>>();

  const resetRef = ref(firebaseDb, `companyData/${companyId}/operationalReset`);
  const resetUnsub = onValue(resetRef, async (snapshot) => {
    const resetAt = Number(snapshot.val()?.completedAt || 0);
    if (!resetAt) return;
    const markerKey = `bms-reset:${companyId}`;
    if (Number(localStorage.getItem(markerKey) || 0) >= resetAt) return;
    await Promise.all([
      db().invoices.clear(), db().quotations.clear(), db().purchases.clear(), db().receipts.clear(), db().payments.clear(),
      db().parties.clear(), db().customers.clear(), db().suppliers.clear(), db().productSizes.clear(),
    ]);
    await purgeCompanyCacheAndOutbox(companyId);
    localStorage.setItem(markerKey, String(resetAt));
  });
  unsubs.push(resetUnsub);

  for (const col of collections) {
    const colRef = ref(firebaseDb, `companyData/${companyId}/${col.name}`);
    const unsub = onValue(
      colRef,
      (snapshot) => {
        const prior = queues.get(col.name) || Promise.resolve();
        const next = prior.then(async () => {
        try {
          if (!snapshot.exists() || !snapshot.val()) {
            // Cloud collection is completely empty: purge Dexie table & cache for this collection
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
            return;
          }

          const val = snapshot.val();
          const records = Object.entries(val).map(([id, record]: [string, any]) => ({ ...record, id: record?.id || id }));
          const cloudIds = new Set(records.map((r: any) => r.id));

          // 1. Authoritative Deletion Reconciliation: purge local rows no longer present in Firebase cloud
          const localRows = await (col.table as any).toArray();
          const idsToDelete = localRows
            .filter((r: any) => r.id && !cloudIds.has(r.id))
            .map((r: any) => r.id);

          if (idsToDelete.length > 0) {
            await (col.table as any).bulkDelete(idsToDelete);
            for (const id of idsToDelete) {
              await removeCachedEntity({ companyId, entityType: col.entityType, entityId: id });
            }
          }

          if (records.length === 0) return;

          // 2. Update application Dexie table (triggers reactive UI updates across all useLive hooks on all devices)
          await (col.table as any).bulkPut(records);

          // 3. Mirror into bms_cache_v1 for multi-tenant indexed offline retrieval
          const cacheItems = records.map((r) => ({
            uid,
            companyId,
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
  }

  return () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {}
    }
  };
}
