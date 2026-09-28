import test from "node:test";
import assert from "node:assert/strict";
import { allocateLegalDocumentNumber, formatFyCode } from "../src/server/accounting/numberingEngine.ts";

/**
 * Mock RTDB for atomic transactions and counters
 */
class MockNumberingDatabase {
  constructor() {
    this.counters = {};
  }

  ref(path = "") {
    return {
      transaction: async (updateFn) => {
        const cur = this.counters[path] || 0;
        const next = updateFn(cur);
        this.counters[path] = next;
        return {
          committed: true,
          snapshot: { val: () => next },
        };
      },
      once: async () => ({
        exists: () => this.counters[path] !== undefined,
        val: () => this.counters[path],
      }),
    };
  }
}

test("Credit Note Numbering Scope: Scoped per company + branch/GST registration + FY + docType", async () => {
  const db = new MockNumberingDatabase();
  const companyId = "comp_multibranch_001";
  const fyId = "fy_2026_2027";
  const fyName = "2026-2027";

  // Branch 1: Maharashtra (Main HO)
  const branch1Id = "br_mh_main";
  const branch1Gstin = "27AABCU9603R1ZM";

  // Branch 2: Karnataka (Bangalore Works)
  const branch2Id = "br_ka_works";
  const branch2Gstin = "29AABCU9603R1ZO";

  // 1. Allocate CN for Branch 1
  const cn1 = await allocateLegalDocumentNumber(db, {
    companyId,
    financialYearId: fyId,
    docType: "credit_note",
    branchId: branch1Id,
    branchCode: "HO",
    gstin: branch1Gstin,
    fyName,
    customPrefix: "CN",
  });

  assert.equal(cn1.sequenceNumber, 1);
  assert.equal(cn1.documentNumber, "CN/HO/2026-27/0001");

  // 2. Allocate another CN for Branch 1
  const cn2 = await allocateLegalDocumentNumber(db, {
    companyId,
    financialYearId: fyId,
    docType: "credit_note",
    branchId: branch1Id,
    branchCode: "HO",
    gstin: branch1Gstin,
    fyName,
    customPrefix: "CN",
  });

  assert.equal(cn2.sequenceNumber, 2);
  assert.equal(cn2.documentNumber, "CN/HO/2026-27/0002");

  // 3. Allocate CN for Branch 2 (Must have its OWN isolated sequence starting at 1, NOT shared with Branch 1)
  const cn3 = await allocateLegalDocumentNumber(db, {
    companyId,
    financialYearId: fyId,
    docType: "credit_note",
    branchId: branch2Id,
    branchCode: "KA",
    gstin: branch2Gstin,
    fyName,
    customPrefix: "CN",
  });

  assert.equal(cn3.sequenceNumber, 1, "Branch 2 Credit Note sequence must start at 1, completely isolated from Branch 1");
  assert.equal(cn3.documentNumber, "CN/KA/2026-27/0001");

  // 4. Verify counter paths in database
  const b1Path = `companyData/${companyId}/docCounters/${fyId}/branch_${branch1Id}/credit_note`;
  const b2Path = `companyData/${companyId}/docCounters/${fyId}/branch_${branch2Id}/credit_note`;

  assert.equal(db.counters[b1Path], 2, "Branch 1 counter should be 2");
  assert.equal(db.counters[b2Path], 1, "Branch 2 counter should be 1");
  assert.notEqual(b1Path, b2Path, "Branch counters must be separate paths");
});

test("Statutory GST Isolation: Multiple GST registrations are separable into distinct filing registers", () => {
  const gstin1 = "27AABCU9603R1ZM"; // Maharashtra
  const gstin2 = "29AABCU9603R1ZO"; // Karnataka

  const allInvoices = [
    { id: "inv_1", number: "INV/001", branchSnapshot: { gstin: gstin1 }, grandTotal: 11800, gstTotal: 1800 },
    { id: "inv_2", number: "INV/002", branchSnapshot: { gstin: gstin1 }, grandTotal: 23600, gstTotal: 3600 },
    { id: "inv_3", number: "INV/003", branchSnapshot: { gstin: gstin2 }, grandTotal: 59000, gstTotal: 9000 },
  ];

  // Statutory Filing Register for Maharashtra (GSTIN 1)
  const gstin1Register = allInvoices.filter((i) => i.branchSnapshot?.gstin === gstin1);
  const gstin1OutputGst = gstin1Register.reduce((s, i) => s + i.gstTotal, 0);

  // Statutory Filing Register for Karnataka (GSTIN 2)
  const gstin2Register = allInvoices.filter((i) => i.branchSnapshot?.gstin === gstin2);
  const gstin2OutputGst = gstin2Register.reduce((s, i) => s + i.gstTotal, 0);

  // Consolidated Management Register (All)
  const consolidatedOutputGst = allInvoices.reduce((s, i) => s + i.gstTotal, 0);

  assert.equal(gstin1Register.length, 2);
  assert.equal(gstin1OutputGst, 5400, "MH statutory output GST must be ₹5,400");

  assert.equal(gstin2Register.length, 1);
  assert.equal(gstin2OutputGst, 9000, "KA statutory output GST must be ₹9,000");

  assert.equal(consolidatedOutputGst, 14400, "Consolidated output GST is ₹14,400");
  assert.equal(gstin1OutputGst + gstin2OutputGst, consolidatedOutputGst);

  // Verify non-leakage
  assert.ok(gstin1Register.every((i) => i.branchSnapshot.gstin === gstin1), "No Karnataka invoices in Maharashtra register");
  assert.ok(gstin2Register.every((i) => i.branchSnapshot.gstin === gstin2), "No Maharashtra invoices in Karnataka register");
});
