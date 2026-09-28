/**
 * Standalone Script: Migrate Legacy Operational Records to Canonical Main Branch
 * 
 * Usage:
 *   node scripts/migrate-legacy-branch-records.mjs <companyId> [--force]
 */

import admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const companyId = process.argv[2];
const force = process.argv.includes("--force");

if (!companyId) {
  console.error("Usage: node scripts/migrate-legacy-branch-records.mjs <companyId> [--force]");
  process.exit(1);
}

// Initialize Admin SDK if not already initialized
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || resolve(process.cwd(), "serviceAccountKey.json");
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf-8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || "https://bms-h70209-default-rtdb.asia-southeast1.firebasedatabase.app",
    });
  } else {
    // Emulator or default application credentials
    admin.initializeApp({
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || "http://127.0.0.1:9000?ns=bms-h70209-default-rtdb",
    });
  }
}

const db = admin.database();

async function main() {
  console.log(`Starting Legacy Branch Migration for company: ${companyId} (force: ${force})...`);
  const root = `companyData/${companyId}`;
  const markerRef = db.ref(`${root}/migrationMarkers/legacyBranchBackfill`);

  if (!force) {
    const markerSnap = await markerRef.once("value");
    if (markerSnap.exists()) {
      console.log("Migration marker already present. Skipping migration.");
      console.log("Existing marker details:", markerSnap.val());
      process.exit(0);
    }
  }

  // 1. Resolve or create Main Branch
  const branchesSnap = await db.ref(`${root}/branches`).once("value");
  const branches = branchesSnap.val() || {};
  let mainBranch = null;

  for (const b of Object.values(branches)) {
    if (b.isMainBranch && b.active !== false && b.status !== "inactive") {
      mainBranch = b;
      break;
    }
  }

  if (!mainBranch) {
    const activeList = Object.values(branches).filter((b) => b.active !== false && b.status !== "inactive");
    if (activeList.length > 0) {
      activeList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      mainBranch = activeList[0];
    }
  }

  const now = Date.now();
  const updates = {};

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
      createdBy: "migration_script",
      updatedAt: now,
    };
    updates[`${root}/branches/${mainBranchId}`] = mainBranch;
    console.log(`Created new canonical Main Branch: ${mainBranch.name} (${mainBranch.id})`);
  }

  const targetBranchId = mainBranch.id;
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
  ];

  const migratedCounts = {};
  let totalRecordsScanned = 0;
  let totalRecordsMigrated = 0;

  for (const coll of collections) {
    migratedCounts[coll] = 0;
    const snap = await db.ref(`${root}/${coll}`).once("value");
    if (!snap.exists()) continue;

    const records = snap.val();
    for (const [id, rec] of Object.entries(records)) {
      totalRecordsScanned++;
      if (!rec || typeof rec !== "object") continue;

      if (!rec.branchId) {
        updates[`${root}/${coll}/${id}/branchId`] = targetBranchId;
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

  // Audit log
  const auditId = `audit_${now}_legacy_branch_backfill`;
  updates[`${root}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "branch",
    entityId: targetBranchId,
    action: "LEGACY_BRANCH_MIGRATION",
    performedBy: "migration_script",
    timestamp: now,
    details: {
      mainBranchId: targetBranchId,
      mainBranchCode: mainBranch.code,
      migratedCounts,
      totalRecordsMigrated,
      totalRecordsScanned,
    },
  };

  // Migration Marker
  updates[`${root}/migrationMarkers/legacyBranchBackfill`] = {
    completedAt: now,
    timestamp: now,
    performedBy: "migration_script",
    mainBranchId: targetBranchId,
    mainBranchCode: mainBranch.code,
    migratedCounts,
    totalRecordsScanned,
    totalRecordsMigrated,
    status: "completed",
    version: 1,
  };

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
    console.log(`Successfully migrated ${totalRecordsMigrated} records to Main Branch (${targetBranchId}).`);
    console.log("Counts per collection:", migratedCounts);
  } else {
    console.log("No unmigrated records found. System already compliant.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
