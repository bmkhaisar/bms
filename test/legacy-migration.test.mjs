import test from "node:test";
import assert from "node:assert/strict";
import { runLegacyBranchBackfill } from "../src/server/migrations/legacyBranchBackfill.ts";

/**
 * Mock Firebase Realtime Database for testing migration
 */
class MockDatabase {
  constructor(initialData = {}) {
    this.data = JSON.parse(JSON.stringify(initialData));
  }

  ref(path = "") {
    const cleanPath = path.replace(/^\/+|\/+$/g, "");
    const segments = cleanPath ? cleanPath.split("/") : [];

    const getTarget = (create = false) => {
      let current = this.data;
      for (const seg of segments) {
        if (current[seg] === undefined) {
          if (create) current[seg] = {};
          else return undefined;
        }
        current = current[seg];
      }
      return current;
    };

    return {
      once: async () => {
        const val = getTarget(false);
        return {
          exists: () => val !== undefined && val !== null,
          val: () => (val !== undefined ? JSON.parse(JSON.stringify(val)) : null),
        };
      },
      update: async (updates) => {
        for (const [upPath, upVal] of Object.entries(updates)) {
          const upSegs = upPath.replace(/^\/+|\/+$/g, "").split("/");
          let cur = this.data;
          for (let i = 0; i < upSegs.length - 1; i++) {
            if (!cur[upSegs[i]] || typeof cur[upSegs[i]] !== "object") {
              cur[upSegs[i]] = {};
            }
            cur = cur[upSegs[i]];
          }
          cur[upSegs[upSegs.length - 1]] = upVal;
        }
        return null;
      },
    };
  }
}

test("Legacy Branch Migration: Audits and migrates all operational records without branchId", async () => {
  const companyId = "comp_legacy_001";
  const initialData = {
    companyData: {
      [companyId]: {
        branches: {
          br_main: {
            id: "br_main",
            branchId: "br_main",
            name: "Head Office",
            code: "HO",
            isMainBranch: true,
            active: true,
          },
        },
        invoices: {
          inv_1: { id: "inv_1", number: "INV/001", grandTotal: 1000 }, // No branchId
          inv_2: { id: "inv_2", number: "INV/002", branchId: "br_branch2" }, // Already has branchId
        },
        quotations: {
          qt_1: { id: "qt_1", number: "QT/001" }, // No branchId
        },
        receipts: {
          rec_1: { id: "rec_1", number: "REC/001" }, // No branchId
        },
        payments: {
          pmt_1: { id: "pmt_1", number: "PMT/001" }, // No branchId
        },
        purchases: {
          po_1: { id: "po_1", number: "PO/001" }, // No branchId
        },
        vouchers: {
          vch_1: { id: "vch_1", number: "VCH/001" }, // No branchId
        },
        stockMovements: {
          sm_1: { id: "sm_1", productId: "p_1" }, // No branchId
        },
        salesReturns: {
          sr_1: { id: "sr_1", number: "SR/001" }, // No branchId
        },
        creditNotes: {
          cn_1: { id: "cn_1", number: "CN/001" }, // No branchId
        },
      },
    },
  };

  const db = new MockDatabase(initialData);

  // 1. Run migration
  const summary = await runLegacyBranchBackfill(db, companyId, "caller_test", false);

  assert.equal(summary.companyId, companyId);
  assert.equal(summary.mainBranchId, "br_main");
  assert.equal(summary.alreadyMigrated, false);
  assert.equal(summary.totalRecordsMigrated, 9, "9 un-scoped operational records must be migrated");

  // 2. Verify all records in database now have branchId === 'br_main'
  const root = db.data.companyData[companyId];
  assert.equal(root.invoices.inv_1.branchId, "br_main");
  assert.equal(root.invoices.inv_2.branchId, "br_branch2", "Pre-existing branch assignment must not be overwritten");
  assert.equal(root.quotations.qt_1.branchId, "br_main");
  assert.equal(root.receipts.rec_1.branchId, "br_main");
  assert.equal(root.payments.pmt_1.branchId, "br_main");
  assert.equal(root.purchases.po_1.branchId, "br_main");
  assert.equal(root.vouchers.vch_1.branchId, "br_main");
  assert.equal(root.stockMovements.sm_1.branchId, "br_main");
  assert.equal(root.salesReturns.sr_1.branchId, "br_main");
  assert.equal(root.creditNotes.cn_1.branchId, "br_main");

  // 3. Verify migration marker exists
  const marker = root.migrationMarkers.legacyBranchBackfill;
  assert.ok(marker, "Migration marker must be written");
  assert.equal(marker.status, "completed");
  assert.equal(marker.mainBranchId, "br_main");
  assert.equal(marker.totalRecordsMigrated, 9);

  // 4. Verify idempotency: subsequent run without force skips
  const secondRun = await runLegacyBranchBackfill(db, companyId, "caller_test", false);
  assert.equal(secondRun.alreadyMigrated, true, "Subsequent run must recognize existing marker and skip");
});

test("Legacy Branch Migration: Auto-creates Main Branch if organization had 0 branches", async () => {
  const companyId = "comp_no_branches_002";
  const initialData = {
    companyData: {
      [companyId]: {
        invoices: {
          inv_x: { id: "inv_x", number: "INV/100" },
        },
      },
    },
  };

  const db = new MockDatabase(initialData);

  const summary = await runLegacyBranchBackfill(db, companyId, "owner_123", false);

  assert.equal(summary.totalRecordsMigrated, 1);
  assert.ok(summary.mainBranchId.startsWith("br_main_"));

  const root = db.data.companyData[companyId];
  const createdBranch = root.branches[summary.mainBranchId];
  assert.ok(createdBranch, "Main branch must be automatically created in companyData/branches");
  assert.equal(createdBranch.isMainBranch, true);
  assert.equal(createdBranch.code, "MAIN");
  assert.equal(root.invoices.inv_x.branchId, summary.mainBranchId);
});
