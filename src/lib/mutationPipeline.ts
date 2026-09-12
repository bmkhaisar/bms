import { toast } from "sonner";
import { appQueryClient } from "./queryClient";
import { db } from "./db";
import { cacheEntity, removeCachedEntity, getCacheDb } from "@/modules/sync/dexieCache";

export interface OptimisticMutationOptions<T = any> {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | "deactivate";
  companyId?: string;
  uid?: string;
  optimisticData?: T;
  clientMutationId?: string;
  capturePreviousState?: () => Promise<T | null | undefined> | T | null | undefined;
  onOptimistic?: (optimisticData?: T) => void;
  onRollback?: (previousState: T | null | undefined) => void;
  onSuccessReconcile?: (serverResult: any) => void;
  syncDexie?: () => Promise<void>;
  rollbackDexie?: (previousState: T | null | undefined) => Promise<void>;
  serverMutation: () => Promise<any>;
  queryKeys?: any[][];
  successToast?: string | ((result: any) => string);
  errorToast?: string | ((error: any) => string);
  busyToast?: string;
  showToast?: boolean;
}

export interface MutationResult<T = any> {
  success: boolean;
  data?: T;
  error?: any;
  clientMutationId: string;
}

// Track recent mutation IDs in-memory to prevent duplicate realtime application
const appliedMutationIds = new Set<string>();
const mutationTimestamps = new Map<string, number>();

export function isMutationAlreadyApplied(mutationId?: string): boolean {
  if (!mutationId) return false;
  return appliedMutationIds.has(mutationId);
}

export function recordAppliedMutation(mutationId?: string): void {
  if (!mutationId) return;
  appliedMutationIds.add(mutationId);
  mutationTimestamps.set(mutationId, Date.now());

  // Prune entries older than 5 minutes
  if (appliedMutationIds.size > 200) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, ts] of mutationTimestamps.entries()) {
      if (ts < cutoff) {
        appliedMutationIds.delete(id);
        mutationTimestamps.delete(id);
      }
    }
  }
}

/**
 * Universal optimistic mutation engine for BMS NEXT.
 * Executes:
 * 1. Capture snapshot of previous state
 * 2. Instant local UI optimistic update (no page reload)
 * 3. Dexie dual cache sync (bms_cache_v1 + bms_db_v1)
 * 4. React Query cache invalidation
 * 5. Server mutation with idempotency token
 * 6. Authoritative state reconciliation
 * 7. Graceful rollback on failure with human-friendly feedback
 */
export async function performOptimisticMutation<T = any>(
  options: OptimisticMutationOptions<T>
): Promise<MutationResult<T>> {
  const {
    entityType,
    entityId,
    action,
    companyId,
    uid,
    optimisticData,
    capturePreviousState,
    onOptimistic,
    onRollback,
    onSuccessReconcile,
    syncDexie,
    rollbackDexie,
    serverMutation,
    queryKeys = [],
    successToast,
    errorToast,
    busyToast,
    showToast = true,
  } = options;

  const clientMutationId =
    options.clientMutationId ||
    `mut_${entityType}_${entityId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Snapshot previous state
  let previousState: T | null | undefined = null;
  try {
    if (capturePreviousState) {
      previousState = await capturePreviousState();
    } else if (companyId && uid) {
      // Try to read from Dexie cache
      const cacheDb = getCacheDb();
      const cached = await cacheDb.cachedEntities.get(`${companyId}:${entityType}:${entityId}`);
      if (cached) {
        previousState = cached.data as T;
      }
    }
  } catch (err) {
    console.warn(`[MutationPipeline] Failed to capture previous state for ${entityType}:${entityId}`, err);
  }

  // 2. Instant local UI update
  try {
    if (onOptimistic) {
      onOptimistic(optimisticData);
    }
  } catch (err) {
    console.error(`[MutationPipeline] Error in onOptimistic handler:`, err);
  }

  // 3. Update Dexie cache immediately
  try {
    if (syncDexie) {
      await syncDexie();
    } else if (companyId) {
      if (action === "delete") {
        await removeCachedEntity({
          companyId,
          entityType,
          entityId,
        });
      } else if (optimisticData && uid) {
        await cacheEntity({
          uid,
          companyId,
          entityType,
          entityId,
          data: optimisticData,
        });
      }
    }
  } catch (err) {
    console.warn(`[MutationPipeline] Dexie sync warning:`, err);
  }

  // 4. Invalidate relevant query keys
  if (queryKeys.length > 0) {
    for (const key of queryKeys) {
      appQueryClient.invalidateQueries({ queryKey: key });
    }
  }

  let toastId: string | number | undefined;
  if (busyToast && showToast) {
    toastId = toast.loading(busyToast);
  }

  recordAppliedMutation(clientMutationId);

  // 5. Execute server mutation
  try {
    const serverResult = await serverMutation();

    if (onSuccessReconcile) {
      onSuccessReconcile(serverResult);
    }

    // Invalidate queries to confirm fresh authoritative state
    if (queryKeys.length > 0) {
      for (const key of queryKeys) {
        appQueryClient.invalidateQueries({ queryKey: key });
      }
    }

    if (showToast) {
      let msg = "";
      if (typeof successToast === "function") {
        msg = successToast(serverResult);
      } else if (successToast) {
        msg = successToast;
      } else {
        if (action === "delete") msg = `${capitalize(entityType)} deleted`;
        else if (action === "deactivate") msg = `${capitalize(entityType)} deactivated`;
        else if (action === "create") msg = `${capitalize(entityType)} created`;
        else msg = `${capitalize(entityType)} saved`;
      }

      if (toastId) {
        toast.success(msg, { id: toastId });
      } else {
        toast.success(msg);
      }
    }

    return {
      success: true,
      data: serverResult,
      clientMutationId,
    };
  } catch (serverErr: any) {
    console.error(`[MutationPipeline] Mutation failed for ${entityType}:${entityId}:`, serverErr);

    // 6. Rollback UI state
    try {
      if (onRollback) {
        onRollback(previousState);
      }
    } catch (rbErr) {
      console.error(`[MutationPipeline] UI Rollback failed:`, rbErr);
    }

    // 7. Rollback Dexie
    try {
      if (rollbackDexie) {
        await rollbackDexie(previousState);
      } else if (companyId && previousState) {
        if (action === "delete" && uid) {
          // Restore deleted entity in Dexie
          await cacheEntity({
            uid,
            companyId,
            entityType,
            entityId,
            data: previousState,
          });
        }
      }
    } catch (rbDexieErr) {
      console.error(`[MutationPipeline] Dexie Rollback failed:`, rbDexieErr);
    }

    // Invalidate queries after rollback
    if (queryKeys.length > 0) {
      for (const key of queryKeys) {
        appQueryClient.invalidateQueries({ queryKey: key });
      }
    }

    if (showToast) {
      let errMsg = "";
      if (typeof errorToast === "function") {
        errMsg = errorToast(serverErr);
      } else if (errorToast) {
        errMsg = errorToast;
      } else {
        if (action === "delete") {
          errMsg = `Couldn't delete this ${entityType}. It has been restored.`;
        } else {
          errMsg = `Unable to save ${entityType}. Changes were reverted.`;
        }
      }

      if (toastId) {
        toast.error(errMsg, { id: toastId });
      } else {
        toast.error(errMsg);
      }
    }

    return {
      success: false,
      error: serverErr,
      clientMutationId,
    };
  }
}

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
