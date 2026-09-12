import Dexie, { type EntityTable } from "dexie";
import type { OutboxMutation, CachedEntity } from "./types";

/**
 * Dedicated cache database bms_cache_v1.
 * Intentionally completely distinct from the legacy bms_db_v1 to prevent any data loss.
 * Extended additively with Version 2 for strict uid + companyId + financialYearId scoping.
 */
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
 * Cache or update a single domain entity scoped by UID, Company, and optional Financial Year.
 */
export async function cacheEntity<T = unknown>(params: {
  uid: string;
  companyId: string;
  financialYearId?: string;
  entityType: string;
  entityId: string;
  data: T;
  version?: number;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const db = getCacheDb();
  const id = `${params.companyId}:${params.entityType}:${params.entityId}`;

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
  }>
): Promise<void> {
  if (typeof window === "undefined" || items.length === 0) return;
  const db = getCacheDb();
  const now = Date.now();

  const records: CachedEntity[] = items.map((item) => ({
    id: `${item.companyId}:${item.entityType}:${item.entityId}`,
    uid: item.uid,
    companyId: item.companyId,
    financialYearId: item.financialYearId,
    entityType: item.entityType,
    entityId: item.entityId,
    version: item.version ?? 1,
    data: item.data,
    updatedAt: now,
  }));

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

  let query = db.cachedEntities
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
 * Strictly prevents cross-user visibility on shared browsers.
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
