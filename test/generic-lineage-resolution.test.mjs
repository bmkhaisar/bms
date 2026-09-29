import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isAllocationForInvoice,
  resolveCanonicalInvoiceOutstanding,
} from "../src/modules/accounting/services/canonicalOutstandingService.ts";
import { getComprehensiveFinancialReconciliation } from "../src/modules/accounting/services/reportEngine.ts";
import {
  analyzeLegacyDocumentLineage,
  buildLineageAuditLogs,
} from "../src/modules/accounting/migrations/legacyDocumentLineageBackfill.ts";

test("Generic Lineage 1: Legacy conversion lineage resolves dynamically via sourceQuotationId and inv_from_ prefix", () => {
  const companyId = "company-gen-alpha";
  const customerId = "customer-gen-x";
  const quotationId = "quotation-uuid-84729";
  const invoiceId = "invoice-uuid-19384";

  const invoice = {
    id: invoiceId,
    number: "INV-GEN-1001",
    companyId,
    customerId,
    branchId: "br-hq",
    sourceQuotationId: quotationId,
    sourceQuotationNumber: "QT-GEN-0050",
    grandTotal: 25000,
    status: "posted",
    postingStatus: "posted",
  };

  const receipt = {
    id: "rec-uuid-55112",
    number: "REC-GEN-2001",
    companyId,
    customerId,
    branchId: "br-hq",
    amount: 15000,
    status: "posted",
    postingStatus: "posted",
    allocatedInvoices: [
      {
        invoiceId: `inv_from_${quotationId}`,
        amount: 15000,
      },
    ],
  };

  const ctx = { companyId, customerId, branchId: "br-hq" };

  // Direct check
  assert.equal(
    isAllocationForInvoice(`inv_from_${quotationId}`, invoice, ctx),
    true,
    "Dynamic candidate inv_from_${sourceQuotationId} must match without runtime lookup table"
  );

  // Settlement detail check
  const settlement = resolveCanonicalInvoiceOutstanding(invoice, [receipt]);
  assert.equal(settlement.effectiveBilledTotal, 25000, "Billed total = 25,000");
  assert.equal(settlement.totalSettled, 15000, "Receipt allocation of 15,000 applied");
  assert.equal(settlement.remainingBalance, 10000, "Remaining balance = 10,000");
});

test("Generic Lineage 2: Amended invoice lineage resolves dynamically via amendedFromId and amendedFromNumber", () => {
  const companyId = "company-gen-beta";
  const customerId = "customer-gen-y";
  const origId = "inv-orig-uuid-12345";
  const invoiceId = "inv-amended-uuid-67890";

  const invoice = {
    id: invoiceId,
    number: "INV-GEN-2002-REV",
    companyId,
    customerId,
    branchId: "br-main",
    amendedFromId: origId,
    amendedFromNumber: "INV-GEN-2001",
    grandTotal: 50000,
    status: "posted",
    postingStatus: "posted",
  };

  const receipt = {
    id: "rec-uuid-99001",
    companyId,
    customerId,
    branchId: "br-main",
    amount: 20000,
    status: "posted",
    postingStatus: "posted",
    allocatedInvoices: [
      {
        invoiceNumber: "INV-GEN-2001",
        amount: 20000,
      },
    ],
  };

  const ctx = { companyId, customerId, branchId: "br-main" };

  assert.equal(isAllocationForInvoice(origId, invoice, ctx), true, "Matches amendedFromId");
  assert.equal(isAllocationForInvoice("INV-GEN-2001", invoice, ctx), true, "Matches amendedFromNumber");

  const settlement = resolveCanonicalInvoiceOutstanding(invoice, [receipt]);
  assert.equal(settlement.remainingBalance, 30000, "Remaining balance = 30,000 after 20,000 allocation");
});

test("Generic Lineage 3: Cross-tenant safety strictly rejects allocations across companies", () => {
  const invoiceA = {
    id: "inv-comp-a",
    number: "INV-COMMON-001",
    companyId: "company-A",
    customerId: "cust-common",
    grandTotal: 10000,
    status: "posted",
  };

  const foreignContext = {
    companyId: "company-B",
    customerId: "cust-common",
  };

  assert.equal(
    isAllocationForInvoice("INV-COMMON-001", invoiceA, foreignContext),
    false,
    "Invoice matching must be rejected when companyId does not match"
  );
});

test("Generic Lineage 4: Branch isolation strictly rejects cross-branch allocations", () => {
  const invoice = {
    id: "inv-br-1",
    number: "INV-001",
    companyId: "company-A",
    customerId: "cust-1",
    branchId: "branch-hq",
    grandTotal: 10000,
    status: "posted",
  };

  const depotContext = {
    companyId: "company-A",
    customerId: "cust-1",
    branchId: "branch-depot",
  };

  assert.equal(
    isAllocationForInvoice("INV-001", invoice, depotContext),
    false,
    "Invoice matching must be rejected when branchId differs and is not 'all'"
  );
});

test("Generic Lineage 5: Party validation strictly rejects cross-party allocations", () => {
  const invoice = {
    id: "inv-cust-1",
    number: "INV-001",
    companyId: "company-A",
    customerId: "cust-alpha",
    grandTotal: 10000,
    status: "posted",
  };

  const betaContext = {
    companyId: "company-A",
    customerId: "cust-beta",
  };

  assert.equal(
    isAllocationForInvoice("INV-001", invoice, betaContext),
    false,
    "Invoice matching must be rejected when customerId differs"
  );
});

test("Generic Lineage 6: Unresolved document lineage is detected and surfaced as LINEAGE_UNRESOLVED in CA Review", () => {
  const companyId = "company-audit-test";
  const customerId = "cust-audit-1";

  const invoice = {
    id: "inv-known",
    number: "INV-AUDIT-001",
    companyId,
    customerId,
    grandTotal: 10000,
    status: "posted",
    postingStatus: "posted",
    date: Date.now(),
  };

  const receiptWithOrphanTarget = {
    id: "rec-orphan-1",
    number: "REC-AUDIT-001",
    companyId,
    customerId,
    amount: 5000,
    status: "posted",
    postingStatus: "posted",
    date: Date.now(),
    allocatedInvoices: [
      {
        invoiceId: "unknown-document-target-9999",
        amount: 5000,
      },
    ],
  };

  const recon = getComprehensiveFinancialReconciliation({
    ledgers: [],
    accountGroups: [],
    vouchers: [],
    invoices: [invoice],
    receipts: [receiptWithOrphanTarget],
    purchases: [],
    payments: [],
    salesReturns: [],
    creditNotes: [],
    products: [],
  });

  const lineageException = recon.exceptions.find((e) => e.id.startsWith("lineage_unresolved_"));
  assert.ok(lineageException, "Must generate a LINEAGE_UNRESOLVED exception for unresolvable target");
  assert.match(lineageException.what, /LINEAGE_UNRESOLVED/);

  const checklistItem = recon.monthEndChecklist.find((chk) => chk.id === "chk_lineage");
  assert.ok(checklistItem, "Month end checklist must include Document Lineage Integrity");
  assert.equal(checklistItem.status, "ATTENTION", "Lineage check must fail with ATTENTION on orphan allocation");
});

test("Generic Lineage 7: Idempotent migration analyzeLegacyDocumentLineage detects missing lineage safely using persisted evidence", () => {
  const companyId = "company-mig-test";
  const customerId = "cust-mig-1";

  // Invoice missing lineage fields
  const legacyInvoice = {
    id: "inv-unlinked-uuid-1",
    number: "INV-LEGACY-001",
    companyId,
    customerId,
    grandTotal: 30000,
    status: "posted",
  };

  // Quotation with authoritative convertedInvoiceId
  const matchingQuotation = {
    id: "quot-source-uuid-1",
    number: "QT-LEGACY-001",
    companyId,
    customerId,
    convertedInvoiceId: "inv-unlinked-uuid-1",
    convertedInvoiceNumber: "INV-LEGACY-001",
  };

  const report = analyzeLegacyDocumentLineage({
    companyId,
    invoices: [legacyInvoice],
    quotations: [matchingQuotation],
    receipts: [],
  });

  assert.equal(report.repairCandidates.length, 1, "Detects exactly 1 repair candidate");
  const candidate = report.repairCandidates[0];
  assert.equal(candidate.documentId, "inv-unlinked-uuid-1");
  assert.equal(candidate.newMetadata.sourceQuotationId, "quot-source-uuid-1");
  assert.equal(candidate.newMetadata.sourceQuotationNumber, "QT-LEGACY-001");
  assert.equal(candidate.newMetadata.amendedFromId, "inv_from_quot-source-uuid-1");

  // Invariant: Already valid invoice is never modified
  const validInvoice = {
    id: "inv-already-valid",
    number: "INV-VALID-002",
    companyId,
    customerId,
    sourceQuotationId: "quot-existing",
    grandTotal: 15000,
  };

  const reportAfter = analyzeLegacyDocumentLineage({
    companyId,
    invoices: [validInvoice],
    quotations: [matchingQuotation],
    receipts: [],
  });

  assert.equal(reportAfter.repairCandidates.length, 0, "Already valid invoice is skipped");
  assert.equal(reportAfter.alreadyValidCount, 1, "Already valid count is 1");

  // Test Audit Log generation
  const logs = buildLineageAuditLogs({
    candidates: report.repairCandidates,
    migratedBy: "unit_test_runner",
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].migratedBy, "unit_test_runner");
  assert.equal(logs[0].companyId, companyId);
});

test("Generic Lineage 8: Zero runtime hardcoding invariant — CANONICAL_INVOICE_LINEAGE_ALIASES does NOT exist", () => {
  const servicePath = resolve(process.cwd(), "src/modules/accounting/services/canonicalOutstandingService.ts");
  const content = readFileSync(servicePath, "utf-8");

  assert.equal(
    content.includes("CANONICAL_INVOICE_LINEAGE_ALIASES"),
    false,
    "CANONICAL_INVOICE_LINEAGE_ALIASES must not exist in canonicalOutstandingService.ts"
  );

  const prohibitedLiterals = [
    "mu1r36x0dfidoscx",
    "inv_from_mu1r4p1ncqkwmn0i",
    "mu1r4p1ncqkwmn0i",
    "mu1hy1xelmsuzhqj",
    "mu33uxfm0ojb6ggi",
  ];

  for (const literal of prohibitedLiterals) {
    assert.equal(
      content.includes(literal),
      false,
      `Prohibited literal '${literal}' must not exist in canonicalOutstandingService.ts`
    );
  }
});
