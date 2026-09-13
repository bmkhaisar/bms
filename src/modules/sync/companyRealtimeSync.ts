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
import { cacheEntitiesBulk } from "./dexieCache";

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
  ];

  for (const col of collections) {
    const colRef = ref(firebaseDb, `companyData/${companyId}/${col.name}`);
    const unsub = onValue(
      colRef,
      async (snapshot) => {
        if (!snapshot.exists()) return;
        const val = snapshot.val();
        if (!val) return;

        const records = Object.values(val) as any[];
        if (records.length === 0) return;

        try {
          // 1. Update application Dexie table (triggers reactive UI updates across all useLive hooks)
          await (col.table as any).bulkPut(records);

          // 2. Mirror into bms_cache_v1 for multi-tenant indexed offline retrieval
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
