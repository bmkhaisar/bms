/**
 * Controlled Server-Side Legacy Branch Migration (Hardening Task 1)
 * 
 * Invariants:
 * 1. Audits all historical operational records created before Branch support:
 *    invoices, quotations, receipts, payments, purchases, vouchers,
 *    stockMovements, salesReturns, creditNotes.
 * 2. Any record lacking branchId is migrated ONCE to the company's canonical Main Branch.
 * 3. Writes an atomic migration marker: companyData/{companyId}/migrationMarkers/legacyBranchBackfill.
 * 4. Idempotent: If marker exists and force !== true, skips migration.
 * 5. Eliminates runtime UI fallbacks like branchId ?? mainBranchId.
 */

import type { Database } from "firebase-admin/database";
import type { Branch } from "../../modules/company/types.ts";

export interface MigrationSummary {
  companyId: string;
  mainBranchId: string;
  mainBranchCode: string;
  proposedMainBranch?: { id: string; name: string; code: string };
  alreadyMigrated: boolean;
  dryRun?: boolean;
  timestamp: number;
  migratedCounts: {
    invoices: number;
    quotations: number;
    receipts: number;
    payments: number;
    purchases: number;
    vouchers: number;
    stockMovements: number;
    salesReturns: number;
    creditNotes: number;
  };
  totalRecordsScanned: number;
  totalRecordsMigrated: number;
  recordsMissingBranchId?: number;
}

export async function runLegacyBranchBackfill(
  db: Database,
  companyId: string,
  callerUid: string = "system",
  force: boolean = false,
  dryRun: boolean = false
): Promise<MigrationSummary> {
  const root = `companyData/${companyId}`;
  const markerRef = db.ref(`${root}/migrationMarkers/legacyBranchBackfill`);

  // 1. Check idempotency marker
  if (!force) {
    const markerSnap = await markerRef.once("value");
    if (markerSnap.exists()) {
      const val = markerSnap.val();
      return {
        companyId,
        mainBranchId: val.mainBranchId || "",
        mainBranchCode: val.mainBranchCode || "MAIN",
        alreadyMigrated: true,
        timestamp: val.completedAt || val.timestamp || Date.now(),
        migratedCounts: val.migratedCounts || {
          invoices: 0, quotations: 0, receipts: 0, payments: 0,
          purchases: 0, vouchers: 0, stockMovements: 0, salesReturns: 0, creditNotes: 0,
        },
        totalRecordsScanned: val.totalRecordsScanned || 0,
        totalRecordsMigrated: val.totalRecordsMigrated || 0,
      };
    }
  }

  // 2. Resolve or create company's canonical Main Branch
  const branchesSnap = await db.ref(`${root}/branches`).once("value");
  const branches: Record<string, Branch> = branchesSnap.val() || {};
  let mainBranch: Branch | null = null;

  for (const b of Object.values(branches)) {
    if (b.isMainBranch && b.active !== false && b.status !== "inactive") {
      mainBranch = b;
      break;
    }
  }

  // Fallback: earliest active branch
  if (!mainBranch) {
    const activeList = Object.values(branches).filter((b) => b.active !== false && b.status !== "inactive");
    if (activeList.length > 0) {
      activeList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      mainBranch = activeList[0];
    }
  }

  const now = Date.now();
  const updates: Record<string, unknown> = {};

  // If no branch exists at all, bootstrap the canonical Main Branch
  if (!mainBranch) {
    const mainBranchId = `br_main_${companyId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
    mainBranch = {
      id: mainBranchId,
      branchId: mainBranchId,
      companyId,
      organizationId: companyId,
      name: "Main Branch",
      code: "MAIN",
      branchCode: "MAIN",
      status: "active",
      active: true,
      isMainBranch: true,
      isBillingDefault: true,
      address: "",
      city: "",
      state: "",
      pincode: "",
      country: "India",
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
    };
    updates[`${root}/branches/${mainBranchId}`] = mainBranch;
  } else if (!mainBranch.isMainBranch) {
    // Ensure marked isMainBranch: true
    updates[`${root}/branches/${mainBranch.id}/isMainBranch`] = true;
  }

  const targetBranchId = mainBranch.id;

  // 3. Scan all operational collections
  const collections = [
    "invoices",
    "quotations",
    "receipts",
    "payments",
    "purchases",
    "vouchers",
    "stockMovements",
    "salesReturns",
    "creditNotes",
  ] as const;

  const migratedCounts = {
    invoices: 0,
    quotations: 0,
    receipts: 0,
    payments: 0,
    purchases: 0,
    vouchers: 0,
    stockMovements: 0,
    salesReturns: 0,
    creditNotes: 0,
  };

  let totalRecordsScanned = 0;
  let totalRecordsMigrated = 0;

  for (const coll of collections) {
    const snap = await db.ref(`${root}/${coll}`).once("value");
    if (!snap.exists()) continue;

    const records: Record<string, any> = snap.val();
    for (const [id, rec] of Object.entries(records)) {
      totalRecordsScanned++;
      if (!rec || typeof rec !== "object") continue;

      if (!rec.branchId) {
        updates[`${root}/${coll}/${id}/branchId`] = targetBranchId;
        // Also populate branchSnapshot if missing
        if (!rec.branchSnapshot) {
          updates[`${root}/${coll}/${id}/branchSnapshot`] = {
            id: targetBranchId,
            name: mainBranch.name,
            code: mainBranch.code,
            isMainBranch: true,
          };
        }
        migratedCounts[coll]++;
        totalRecordsMigrated++;
      }
    }
  }

  // 4. Audit Log entry
  const auditId = `audit_${now}_legacy_branch_backfill`;
  updates[`${root}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "branch",
    entityId: targetBranchId,
    action: "LEGACY_BRANCH_MIGRATION",
    performedBy: callerUid,
    timestamp: now,
    details: {
      mainBranchId: targetBranchId,
      mainBranchCode: mainBranch.code,
      migratedCounts,
      totalRecordsMigrated,
      totalRecordsScanned,
    },
  };

  // 5. Migration Marker
  updates[`${root}/migrationMarkers/legacyBranchBackfill`] = {
    completedAt: now,
    timestamp: now,
    performedBy: callerUid,
    mainBranchId: targetBranchId,
    mainBranchCode: mainBranch.code,
    migratedCounts,
    totalRecordsScanned,
    totalRecordsMigrated,
    status: "completed",
    version: 1,
  };

  // If dry-run, return proposed changes and scanned entity counts without executing database write (Hardening Item 17)
  if (dryRun) {
    return {
      companyId,
      mainBranchId: targetBranchId,
      mainBranchCode: mainBranch.code,
      proposedMainBranch: { id: targetBranchId, name: mainBranch.name, code: mainBranch.code },
      alreadyMigrated: false,
      dryRun: true,
      timestamp: now,
      migratedCounts,
      totalRecordsScanned,
      totalRecordsMigrated,
      recordsMissingBranchId: totalRecordsMigrated,
    };
  }

  // 6. Apply atomic updates
  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  return {
    companyId,
    mainBranchId: targetBranchId,
    mainBranchCode: mainBranch.code,
    proposedMainBranch: { id: targetBranchId, name: mainBranch.name, code: mainBranch.code },
    alreadyMigrated: false,
    dryRun: false,
    timestamp: now,
    migratedCounts,
    totalRecordsScanned,
    totalRecordsMigrated,
    recordsMissingBranchId: totalRecordsMigrated,
  };
}
