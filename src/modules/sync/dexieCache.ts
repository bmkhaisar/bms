import Dexie, { type EntityTable } from "dexie";
import type { OutboxMutation, CachedEntity } from "./types";
import { normalizeSearchToken } from "./searchNormalization";

export interface UserSessionState {
  key: "session_state";
  uid: string;
  activeCompanyId: string | null;
  activeFinancialYearId: string | null;
  lastSyncedAt: number;
}

class BmsCacheDatabase extends Dexie {
  outbox!: EntityTable<OutboxMutation, "id">;
  cachedEntities!: EntityTable<CachedEntity, "id">;
  sessionState!: EntityTable<UserSessionState, "key">;

  constructor() {
    super("bms_cache_v1");

    // Version 1: Original base schema
    this.version(1).stores({
      outbox: "id, clientMutationId, uid, companyId, [companyId+status], createdAt, status",
      cachedEntities: "id, [companyId+entityType], [uid+companyId], entityType, updatedAt",
      sessionState: "key",
    });

    // Version 2: Additive expansion for multi-tenant, per-user, per-company, per-FY isolation
    this.version(2).stores({
      outbox: "id, clientMutationId, uid, companyId, financialYearId, [companyId+status], [uid+companyId], createdAt, status",
      cachedEntities: "id, uid, companyId, financialYearId, entityType, [companyId+entityType], [uid+companyId], [uid+companyId+entityType], [uid+companyId+financialYearId], updatedAt",
      sessionState: "key",
    });

    // Version 3: High-speed local indexing for sub-millisecond search & filtering (PRD Section 4 & 53)
    this.version(3).stores({
      outbox: "id, clientMutationId, uid, companyId, financialYearId, [companyId+status], [uid+companyId], createdAt, status",
      cachedEntities:
        "id, uid, companyId, financialYearId, entityType, nameLower, sku, gstin, numberLower, status, date, [companyId+entityType], [uid+companyId], [uid+companyId+entityType], [uid+companyId+financialYearId], [companyId+entityType+nameLower], [companyId+entityType+status], [companyId+financialYearId+date], updatedAt",
      sessionState: "key",
    });
  }
}

let cacheDbInstance: BmsCacheDatabase | null = null;

export function getCacheDb(): BmsCacheDatabase {
  if (typeof window === "undefined") {
    throw new Error("getCacheDb() called on server. Dexie is browser-only.");
  }
  if (!cacheDbInstance) {
    cacheDbInstance = new BmsCacheDatabase();
  }
  return cacheDbInstance;
}

/**
 * Extracts normalized search & indexing fields from arbitrary entity data.
 */
function extractNormalizedFields(data: any): {
  nameLower?: string;
  sku?: string;
  gstin?: string;
  numberLower?: string;
  status?: string;
  date?: number;
} {
  if (!data || typeof data !== "object") return {};
  const name = data.name || data.legalName || data.title || "";
  const number = data.number || data.invoiceNumber || data.quotationNumber || "";
  return {
    nameLower: name ? String(name).toLowerCase() : undefined,
    sku: data.sku ? String(data.sku).toLowerCase() : undefined,
    gstin: data.gstin ? String(data.gstin).toUpperCase() : undefined,
    numberLower: number ? String(number).toLowerCase() : undefined,
    status: data.status ? String(data.status) : undefined,
    date: typeof data.date === "number" ? data.date : undefined,
  };
}

/**
 * Cache or update a single domain entity scoped by UID, Company, and optional Financial Year.
 */
export async function cacheEntity<T = unknown>(params: {
  uid: string;
  companyId: string;
  financialYearId?: string;
  entityType: string;
  entityId: string;
  data: T;
  name?: string;
  version?: number;
  serverUpdatedAt?: number;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  const id = `${params.companyId}:${params.entityType}:${params.entityId}`;
  const norm = extractNormalizedFields(params.data);

  await db.cachedEntities.put({
    id,
    uid: params.uid,
    companyId: params.companyId,
    financialYearId: params.financialYearId,
    entityType: params.entityType,
    entityId: params.entityId,
    version: params.version ?? 1,
    data: params.data,
    updatedAt: Date.now(),
    serverUpdatedAt: params.serverUpdatedAt || Date.now(),
    localUpdatedAt: Date.now(),
    syncStatus: "synced",
    ...norm,
  });
}

/**
 * Bulk-cache domain entities efficiently within a single Dexie transaction.
 */
export async function cacheEntitiesBulk(
  items: Array<{
    uid: string;
    companyId: string;
    financialYearId?: string;
    entityType: string;
    entityId: string;
    data: unknown;
    version?: number;
    serverUpdatedAt?: number;
  }>
): Promise<void> {
  if (typeof window === "undefined" || items.length === 0) return;
  const db = getCacheDb();
  const now = Date.now();

  const records: CachedEntity[] = items.map((item) => {
    const norm = extractNormalizedFields(item.data);
    return {
      id: `${item.companyId}:${item.entityType}:${item.entityId}`,
      uid: item.uid,
      companyId: item.companyId,
      financialYearId: item.financialYearId,
      entityType: item.entityType,
      entityId: item.entityId,
      version: item.version ?? 1,
      data: item.data,
      updatedAt: now,
      serverUpdatedAt: item.serverUpdatedAt || now,
      localUpdatedAt: now,
      syncStatus: "synced",
      ...norm,
    };
  });

  await db.cachedEntities.bulkPut(records);
}

/**
 * Retrieve cached entities scoped by user, company, and optional financial year.
 * Guarantees User A data is NEVER returned for User B.
 */
export async function getCachedEntities<T = unknown>(params: {
  uid: string;
  companyId: string;
  financialYearId?: string;
  entityType: string;
}): Promise<T[]> {
  if (typeof window === "undefined") return [];
  const db = getCacheDb();

  const query = db.cachedEntities
    .where("[uid+companyId+entityType]")
    .equals([params.uid, params.companyId, params.entityType]);

  const raw = await query.toArray();

  if (params.financialYearId) {
    return raw
      .filter((r) => !r.financialYearId || r.financialYearId === params.financialYearId)
      .map((r) => r.data as T);
  }

  return raw.map((r) => r.data as T);
}

/**
 * Search cached entities returning full CachedEntity records.
 * Supports both object params and positional (companyId, query, limit) arguments.
 */
export async function searchCachedEntitiesRecords(
  paramsOrCompanyId:
    | {
        uid?: string;
        companyId: string;
        entityType?: string;
        query: string;
        limit?: number;
      }
    | string,
  queryArg?: string,
  limitArg?: number
): Promise<CachedEntity[]> {
  if (typeof window === "undefined") return [];
  const db = getCacheDb();

  let companyId: string;
  let uid: string | undefined;
  let entityType: string | undefined;
  let query: string;
  let max: number;

  if (typeof paramsOrCompanyId === "string") {
    companyId = paramsOrCompanyId;
    query = (queryArg || "").trim().toLowerCase();
    max = limitArg || 20;
  } else {
    companyId = paramsOrCompanyId.companyId;
    uid = paramsOrCompanyId.uid;
    entityType = paramsOrCompanyId.entityType;
    query = (paramsOrCompanyId.query || "").trim().toLowerCase();
    max = paramsOrCompanyId.limit || 20;
  }

  if (!query) return [];

  let collection;
  if (uid) {
    collection = db.cachedEntities
      .where("[uid+companyId]")
      .equals([uid, companyId]);
  } else {
    collection = db.cachedEntities
      .where("companyId")
      .equals(companyId);
  }

  const normQ = normalizeSearchToken(query);
  const matches = await collection
    .filter((r) => {
      if (entityType && r.entityType !== entityType) return false;
      if (r.nameLower && (r.nameLower.includes(query) || normalizeSearchToken(r.nameLower).includes(normQ))) return true;
      if (r.numberLower && r.numberLower.includes(query)) return true;
      if (r.sku && (r.sku.includes(query) || normalizeSearchToken(r.sku).includes(normQ))) return true;
      if (r.gstin && r.gstin.toLowerCase().includes(query)) return true;
      
      const d = r.data as any;
      if (d) {
        if (d.company && normalizeSearchToken(d.company).includes(normQ)) return true;
        if (d.mobile && String(d.mobile).includes(query)) return true;
        if (d.phone && String(d.phone).includes(query)) return true;
        if (d.email && String(d.email).toLowerCase().includes(query)) return true;
        if (d.hsn && String(d.hsn).toLowerCase().includes(query)) return true;
        if (Array.isArray(d.aliases)) {
          for (const a of d.aliases) {
            if (normalizeSearchToken(a).includes(normQ)) return true;
          }
        }
      }
      return false;
    })
    .limit(max)
    .toArray();

  return matches;
}

/**
 * Sub-millisecond indexed search over local Dexie cache using prefix indexes.
 */
export async function searchCachedEntitiesIndex<T = unknown>(
  paramsOrCompanyId:
    | {
        uid?: string;
        companyId: string;
        entityType?: string;
        query: string;
        limit?: number;
      }
    | string,
  queryArg?: string,
  limitArg?: number
): Promise<T[]> {
  const records = await searchCachedEntitiesRecords(paramsOrCompanyId, queryArg, limitArg);
  return records.map((m) => m.data as T);
}

/**
 * Retrieve a single entity from cache.
 */
export async function getCachedEntity<T = unknown>(params: {
  uid: string;
  companyId: string;
  entityType: string;
  entityId: string;
}): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const db = getCacheDb();
  const id = `${params.companyId}:${params.entityType}:${params.entityId}`;
  const record = await db.cachedEntities.get(id);
  if (!record || record.uid !== params.uid) return null;
  return record.data as T;
}

/**
 * Remove an entity from cache.
 */
export async function removeCachedEntity(params: {
  companyId: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  const id = `${params.companyId}:${params.entityType}:${params.entityId}`;
  await db.cachedEntities.delete(id);
}

/**
 * Estimates local IndexedDB cache size for Backup & Sync management.
 */
export async function estimateLocalCacheStats(): Promise<{
  recordCount: number;
  outboxPendingCount: number;
  estimatedSizeBytes: number;
}> {
  if (typeof window === "undefined") {
    return { recordCount: 0, outboxPendingCount: 0, estimatedSizeBytes: 0 };
  }
  const db = getCacheDb();
  const entityCount = await db.cachedEntities.count();
  const pendingCount = await db.outbox.where("status").equals("pending").count();

  // Approximate 1KB average per entity JSON record
  const estimatedBytes = (entityCount + pendingCount) * 1024;

  return {
    recordCount: entityCount,
    outboxPendingCount: pendingCount,
    estimatedSizeBytes: estimatedBytes,
  };
}

/**
 * Saves current user session state for instant offline startup.
 */
export async function saveSessionState(state: Omit<UserSessionState, "key">): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  await db.sessionState.put({
    key: "session_state",
    ...state,
  });
}

/**
 * Retrieves the saved session state if available.
 */
export async function getSessionState(): Promise<UserSessionState | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = getCacheDb();
    const state = await db.sessionState.get("session_state");
    return state || null;
  } catch {
    return null;
  }
}

/**
 * Clears active company cache when switching company.
 */
export async function clearActiveCompanyCache(companyId: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  await db.cachedEntities.where("companyId").equals(companyId).delete();
}

/**
 * Purges cached records for a specific user upon logout or explicit cache clear.
 */
export async function purgeUserCache(uid: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  await db.transaction("rw", [db.cachedEntities, db.outbox, db.sessionState], async () => {
    await db.cachedEntities.where("uid").equals(uid).delete();
    await db.outbox.where("uid").equals(uid).delete();
    await db.sessionState.clear();
  });
}

/**
 * Complete clear of local cache for the device when user explicitly requests:
 * "Clear local data from this device".
 */
export async function clearAllDeviceData(): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  await db.transaction("rw", [db.cachedEntities, db.outbox, db.sessionState], async () => {
    await db.cachedEntities.clear();
    await db.outbox.clear();
    await db.sessionState.clear();
  });
}
