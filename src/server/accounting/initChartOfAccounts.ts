import type { Database } from "firebase-admin/database";
import { SYSTEM_ACCOUNT_GROUPS, getDefaultSystemLedgers } from "@/modules/accounting/defaultGroups";

export interface InitChartOfAccountsResult {
  success: boolean;
  groupsCreated: number;
  ledgersCreated: number;
  error?: string;
}

/**
 * Ensures a company has the complete system Chart of Accounts (account groups + foundational ledgers).
 * Can populate an updates map for atomic multi-path commit or execute standalone.
 */
export async function ensureCompanyChartOfAccounts(
  db: Database,
  companyId: string,
  callerUid: string,
  now = Date.now(),
  updatesMap?: Record<string, unknown>
): Promise<InitChartOfAccountsResult> {
  const isAtomicMode = Boolean(updatesMap);
  const targetUpdates = updatesMap || {};

  try {
    let groupsCreated = 0;
    let ledgersCreated = 0;

    // 1. Check existing account groups
    let existingGroups: Record<string, unknown> = {};
    if (!isAtomicMode) {
      const snap = await db.ref(`companyData/${companyId}/accountGroups`).once("value");
      if (snap.exists()) {
        existingGroups = snap.val() || {};
      }
    }

    for (const grp of SYSTEM_ACCOUNT_GROUPS) {
      if (!existingGroups[grp.id]) {
        targetUpdates[`companyData/${companyId}/accountGroups/${grp.id}`] = {
          ...grp,
          companyId,
          createdAt: now,
        };
        groupsCreated++;
      }
    }

    // 2. Check default system ledgers
    let existingLedgers: Record<string, unknown> = {};
    if (!isAtomicMode) {
      const snap = await db.ref(`companyData/${companyId}/ledgers`).once("value");
      if (snap.exists()) {
        existingLedgers = snap.val() || {};
      }
    }

    const defaultLedgers = getDefaultSystemLedgers(companyId, now);
    for (const led of defaultLedgers) {
      if (!existingLedgers[led.id]) {
        targetUpdates[`companyData/${companyId}/ledgers/${led.id}`] = {
          ...led,
          updatedAt: now,
        };
        ledgersCreated++;
      }
    }

    if (!isAtomicMode && Object.keys(targetUpdates).length > 0) {
      await db.ref().update(targetUpdates);
    }

    return {
      success: true,
      groupsCreated,
      ledgersCreated,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to initialize Chart of Accounts";
    console.error("Error initializing Chart of Accounts:", err);
    return {
      success: false,
      groupsCreated: 0,
      ledgersCreated: 0,
      error: msg,
    };
  }
}

/**
 * Convenience wrapper for ensuring chart of accounts standalone
 */
export async function ensureChartOfAccounts(
  companyId: string,
  callerUid = "system"
): Promise<InitChartOfAccountsResult> {
  const { getFirebaseAdmin } = await import("../firebaseAdmin");
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      groupsCreated: 0,
      ledgersCreated: 0,
      error: "Firebase Admin not initialized",
    };
  }
  return ensureCompanyChartOfAccounts(adminApp.database(), companyId, callerUid);
}
