/**
 * Canonical Service for Saved Report Views
 * 
 * Pre-Merge Blocker 1:
 * - ZERO ad-hoc browser key-value persistence.
 * - Canonical storage: Dexie bms_cache_v1 savedReportViews table (Version 5). Legacy bms_db_v1 is untouched.
 * - Saved views strictly NEVER grant or alter RBAC permissions.
 */


import type { SavedReportView } from "@/lib/db";
import { getCacheDb } from "@/modules/sync/dexieCache";

/**
 * Lists saved report views for the current company (or global views if companyId not set).
 * Never grants permissions.
 * Persisted in canonical bms_cache_v1 (Version 5). Legacy bms_db_v1 is untouched.
 */
export async function listSavedReportViews(companyId?: string): Promise<SavedReportView[]> {
  if (typeof window === "undefined") return [];
  try {
    const table = getCacheDb().savedReportViews;
    if (!table) return [];
    let views: SavedReportView[] = [];
    if (companyId) {
      views = await table.where("companyId").equals(companyId).toArray();
      if (views.length === 0) {
        // Also load company-unscoped views
        const all = await table.toArray();
        views = all.filter((v) => !v.companyId || v.companyId === companyId);
      }
    } else {
      views = await table.toArray();
    }
    return views.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn("[savedReportViewsService] Failed to load saved report views:", err);
    return [];
  }
}

/**
 * Saves or updates a report view in canonical bms_cache_v1.
 */
export async function saveReportView(view: SavedReportView): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const table = getCacheDb().savedReportViews;
    if (!table) return;
    await table.put(view);
  } catch (err) {
    console.warn("[savedReportViewsService] Failed to save report view:", err);
    throw err;
  }
}

/**
 * Deletes a saved report view from canonical bms_cache_v1.
 */
export async function deleteReportView(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const table = getCacheDb().savedReportViews;
    if (!table) return;
    await table.delete(id);
  } catch (err) {
    console.warn("[savedReportViewsService] Failed to delete report view:", err);
    throw err;
  }
}

