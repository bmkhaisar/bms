/**
 * Canonical Service for Saved Report Views
 * 
 * Production Hardening Requirement (Item 1):
 * - ZERO ad-hoc localStorage persistence.
 * - Preferred local option: Dexie bms_db_v1 savedReportViews table.
 * - Saved views strictly NEVER grant or alter RBAC permissions.
 */

import { db, type SavedReportView } from "@/lib/db";

/**
 * Lists saved report views for the current company (or global views if companyId not set).
 * Never grants permissions.
 */
export async function listSavedReportViews(companyId?: string): Promise<SavedReportView[]> {
  if (typeof window === "undefined") return [];
  try {
    const table = db().savedReportViews;
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
 * Saves or updates a report view in Dexie.
 */
export async function saveReportView(view: SavedReportView): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const table = db().savedReportViews;
    if (!table) return;
    await table.put(view);
  } catch (err) {
    console.warn("[savedReportViewsService] Failed to save report view:", err);
    throw err;
  }
}

/**
 * Deletes a saved report view from Dexie.
 */
export async function deleteReportView(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const table = db().savedReportViews;
    if (!table) return;
    await table.delete(id);
  } catch (err) {
    console.warn("[savedReportViewsService] Failed to delete report view:", err);
    throw err;
  }
}
