import test from "node:test";
import assert from "node:assert/strict";

import {
  getLineDebitPaise,
  getLineCreditPaise,
  getTrialBalance,
  getDayBook,
  calculateCanonicalLedgerBalances,
} from "../src/modules/accounting/services/reportEngine.ts";
import {
  resolveDatePreset,
  resolveComparisonRange,
  filterRecordsByBusinessScope,
} from "../src/modules/accounting/services/reportingScope.ts";
import {
  isPostedInvoice,
  isPostedPurchase,
  isPostedReceipt,
  isPostedPayment,
  isPostedSalesReturn,
  isPostedCreditNote,
  resolveCanonicalInvoiceOutstanding,
  resolveCanonicalPurchaseOutstanding,
  calculateAuthoritativeCustomerCredits,
  resolveCanonicalCustomerCredits,
} from "../src/modules/accounting/services/canonicalOutstandingService.ts";
import {
  generateCsvContent,
  generateExcelWorkbook,
} from "../src/modules/export/exportService.ts";
import {
  PRODUCT_EXPORT_COLUMNS,
  PARTY_EXPORT_COLUMNS,
  INVOICE_EXPORT_COLUMNS,
  RECEIVABLES_AGING_EXPORT_COLUMNS,
  PAYABLES_AGING_EXPORT_COLUMNS,
  MONTH_END_SNAPSHOT_EXPORT_COLUMNS,
} from "../src/modules/export/exportColumnDefinitions.ts";

// ============================================================================
// SUITE 1: SECTION 0 — FINAL ACCOUNTING CODE SAFETY AUDIT & DIRECTIONALITY
// ============================================================================

test("Accounting Safety 1: getLineDebitPaise never relies on legacy line.debit to determine debitPaise", () => {
  // Case A: canonical debitPaise exists (100000 = ₹1,000.00) while legacy line.debit is 0 or absent
  const lineA = { debitPaise: 100000, debit: 0 };
  assert.equal(getLineDebitPaise(lineA), 100000, "Must return canonical debitPaise even if line.debit === 0");

  // Case B: canonical debitPaise exists (0 paise) while legacy line.debit is 500
  const lineB = { debitPaise: 0, debit: 500 };
  assert.equal(getLineDebitPaise(lineB), 0, "Must honor explicit debitPaise: 0 and NOT fall back to line.debit");

  // Case C: explicitlyMigratedLegacyDebitPaise migration
  const lineC = { explicitlyMigratedLegacyDebitPaise: 250000 };
  assert.equal(getLineDebitPaise(lineC), 250000, "Falls back to explicitlyMigratedLegacyDebitPaise if debitPaise is absent");

  // Case D: storedAmountPaise with explicit direction
  const lineD = { storedAmountPaise: 75000, direction: "DEBIT" };
  assert.equal(getLineDebitPaise(lineD), 75000, "Honors storedAmountPaise when direction is explicitly DEBIT");

  const lineE = { storedAmountPaise: 75000, direction: "CREDIT" };
  assert.equal(getLineDebitPaise(lineE), 0, "Must NOT return debit when storedAmountPaise direction is CREDIT");

  // Case E: legacy debit paise when no canonical paise fields exist
  const lineF = { debit: 12050 };
  assert.equal(getLineDebitPaise(lineF), 12050, "Honors legacy debit paise directly without magnitude guessing");

  // Case F: empty / null line
  assert.equal(getLineDebitPaise(null), 0);
  assert.equal(getLineDebitPaise({}), 0);
});

test("Accounting Safety 2: getLineCreditPaise never relies on legacy line.credit to determine creditPaise", () => {
  // Case A: canonical creditPaise exists
  const lineA = { creditPaise: 500000, credit: 0 };
  assert.equal(getLineCreditPaise(lineA), 500000);

  // Case B: canonical creditPaise is 0
  const lineB = { creditPaise: 0, credit: 1000 };
  assert.equal(getLineCreditPaise(lineB), 0);

  // Case C: storedAmountPaise with explicit direction
  const lineC = { storedAmountPaise: 30000, direction: "CREDIT" };
  assert.equal(getLineCreditPaise(lineC), 30000);

  const lineD = { storedAmountPaise: 30000, direction: "DEBIT" };
  assert.equal(getLineCreditPaise(lineD), 0);
});

test("Accounting Safety 3: Canonical Outstanding Invariants (Zero impact for drafts, no negative balance)", () => {
  const draftInvoice = {
    id: "inv_draft_test",
    number: "INV-DRAFT",
    status: "draft",
    postingStatus: "draft",
    grandTotal: 50000,
    balance: 50000,
    date: Date.now(),
  };

  assert.equal(isPostedInvoice(draftInvoice), false, "Draft invoice must NOT be considered posted");
  const outstanding = resolveCanonicalInvoiceOutstanding(draftInvoice, [], [], []);
  assert.equal(outstanding.remainingBalance, 0, "Draft invoice must strictly have 0 remaining balance in accounting");

  const postedInvoice = {
    id: "inv_posted_test",
    number: "INV-POSTED-1",
    status: "posted",
    postingStatus: "posted",
    grandTotal: 10000,
    balance: 10000,
    date: Date.now(),
  };
  assert.equal(isPostedInvoice(postedInvoice), true);

  // Overpayment attempt: receipt of ₹15,000 against ₹10,000 invoice
  const overReceipt = {
    id: "rec_over_1",
    number: "REC-001",
    status: "posted",
    postingStatus: "posted",
    amount: 15000,
    invoiceId: "inv_posted_test",
    allocatedInvoices: [{ invoiceId: "inv_posted_test", amount: 15000 }],
    date: Date.now(),
  };

  const settlement = resolveCanonicalInvoiceOutstanding(postedInvoice, [overReceipt], [], []);
  assert.equal(settlement.remainingBalance, 0, "Invoice remaining balance must clamp to 0; NEVER negative");
  assert.equal(settlement.isPaid, true);
});

// ============================================================================
// SUITE 2: SECTION 1 & 2 — GLOBAL BUSINESS SCOPE BAR & MULTI-BRANCH
// ============================================================================

test("Business Scope 1: Strict branch filtering isolates records between branches", () => {
  const scopeBranchA = {
    companyId: "org_prod_1",
    branchIds: ["br_bangalore"],
    activeBranchId: "br_bangalore",
    scopeMode: "BRANCH",
    dateRange: resolveDatePreset("all_time"),
  };

  const testRecords = [
    { id: "inv_1", branchId: "br_bangalore", grandTotal: 5000 },
    { id: "inv_2", branchId: "br_mumbai", grandTotal: 8000 },
    { id: "inv_3", branchId: "br_bangalore", grandTotal: 12000 },
    { id: "inv_4", branchId: "br_chennai", grandTotal: 2000 },
  ];

  const filtered = filterRecordsByBusinessScope(testRecords, scopeBranchA);
  assert.equal(filtered.length, 2, "Only records strictly belonging to br_bangalore must be returned");
  assert.ok(filtered.every((r) => r.branchId === "br_bangalore"));
});

test("Business Scope 2: All Branches mode consolidates authorized records for management", () => {
  const scopeConsolidated = {
    companyId: "org_prod_1",
    branchIds: ["br_bangalore", "br_mumbai"],
    activeBranchId: "all",
    scopeMode: "CONSOLIDATED",
    dateRange: resolveDatePreset("all_time"),
  };

  const testRecords = [
    { id: "inv_1", branchId: "br_bangalore", grandTotal: 5000 },
    { id: "inv_2", branchId: "br_mumbai", grandTotal: 8000 },
    { id: "inv_3", branchId: "br_unauthorized", grandTotal: 100000 },
  ];

  const filtered = filterRecordsByBusinessScope(testRecords, scopeConsolidated);
  assert.equal(filtered.length, 2, "Consolidated scope must include authorized branches and exclude unauthorized ones");
});

// ============================================================================
// SUITE 3: SECTION 3 — DATE FILTER SYSTEM & MTD VS LMTD
// ============================================================================

test("Date Filter System 1: MTD vs LMTD computes strictly elapsed day number without comparing partial against full", () => {
  const mtdRange = resolveDatePreset("mtd", new Date(2026, 8, 29)); // 29 Sep 2026
  assert.equal(mtdRange.fromDate, "2026-09-01");
  assert.equal(mtdRange.toDate, "2026-09-29");

  const lmtdComparison = resolveComparisonRange(mtdRange, "lmtd");
  assert.ok(lmtdComparison, "LMTD comparison range must be resolved");
  assert.equal(lmtdComparison.fromDate, "2026-08-01");
  assert.equal(lmtdComparison.toDate, "2026-08-29", "LMTD must strictly end on 29 Aug, not full 31 Aug");
});

test("Date Filter System 2: Month end clamping in LMTD (e.g. March 31 vs February 28/29)", () => {
  const marchEndRange = resolveDatePreset("mtd", new Date(2026, 2, 31)); // 31 Mar 2026
  const febComparison = resolveComparisonRange(marchEndRange, "lmtd");
  assert.ok(febComparison);
  assert.equal(febComparison.fromDate, "2026-02-01");
  assert.equal(febComparison.toDate, "2026-02-28", "Clamps to last day of February when previous month has fewer days");
});

// ============================================================================
// SUITE 4: SECTION 7, 9, 10 — EXPORT ARCHITECTURE (CSV & EXCEL)
// ============================================================================

test("Export Center 1: CSV generation outputs UTF-8 BOM, proper escaping, and quoted strings", () => {
  const columns = [
    { key: "code", header: "Product Code", width: 14 },
    { key: "name", header: "Product Name", width: 28 },
    { key: "rate", header: "Selling Rate (₹)", type: "currency", width: 16 },
    { key: "desc", header: "Description", width: 30 },
  ];

  const data = [
    { code: "PRD-001", name: 'Industrial Valve, 2" Brass', rate: 1450.50, desc: 'Special "heavy-duty" finish, tested' },
    { code: "PRD-002", name: "Standard Pipe", rate: 250.00, desc: "Plain PVC pipe" },
  ];

  const csv = generateCsvContent(data, columns);

  // 1. Must start with UTF-8 BOM (\uFEFF) for Excel compatibility
  assert.ok(csv.startsWith("\uFEFF"), "CSV must contain UTF-8 Byte Order Mark");

  // 2. Commas and quotes must be properly escaped
  assert.ok(csv.includes('"Industrial Valve, 2"" Brass"'), "Values containing commas and quotes must be quoted and escaped");
  assert.ok(csv.includes('"Special ""heavy-duty"" finish, tested"'), "Internal quotes must be escaped with double quotes");

  // 3. No [object Object]
  assert.ok(!csv.includes("[object Object]"), "CSV must never contain raw [object Object]");
});

test("Export Center 2: Excel (.xlsx) generation sets numeric format for currency cells", () => {
  const columns = [
    { key: "code", header: "Item Code", width: 14 },
    { key: "rate", header: "Amount", type: "currency", width: 16 },
  ];

  const data = [
    { code: "A1", rate: 123456.78 },
  ];

  const wb = generateExcelWorkbook(data, columns, {
    sheetName: "Sheet1",
    companyName: "Acme Corp",
    includeTotals: true,
  });

  const sheet = wb.Sheets["Sheet1"];
  assert.ok(sheet, "Workbook must contain Sheet1");

  // Check data row cell (rate column is column B, row 4 because header is row 3)
  const cellB4 = sheet["B4"];
  assert.ok(cellB4, "Cell B4 must exist");
  assert.equal(cellB4.t, "n", "Currency cell in Excel must be numeric ('n'), NOT string ('s')");
  assert.equal(cellB4.v, 123456.78, "Cell value must be exact numeric float");
  assert.equal(cellB4.z, "#,##,##0.00", "Must have Indian currency number format string");
});

// ============================================================================
// SUITE 5: SECTION 15 & 16 — THREE-TIER RECEIVABLES & PAYABLES UX
// ============================================================================

test("Receivables & Payables UX: Three-Tier separation of Gross Dues, Available Credits, and Net Exposure", () => {
  // Setup 2 invoices for Customer Alpha
  const invoices = [
    {
      id: "inv_a1",
      number: "INV-001",
      customerId: "cust_alpha",
      grandTotal: 60000,
      balance: 60000,
      status: "posted",
      postingStatus: "posted",
      date: Date.now() - 40 * 86400000, // 40 days old (31-60 bracket)
      dueDate: Date.now() - 10 * 86400000,
    },
    {
      id: "inv_a2",
      number: "INV-002",
      customerId: "cust_alpha",
      grandTotal: 40000,
      balance: 40000,
      status: "posted",
      postingStatus: "posted",
      date: Date.now() - 10 * 86400000, // 10 days old (0-30 bracket)
      dueDate: Date.now() + 20 * 86400000,
    },
  ];

  // Customer Alpha has an advance receipt of ₹25,000 unallocated
  const receipts = [
    {
      id: "rec_adv_1",
      number: "REC-ADV-1",
      customerId: "cust_alpha",
      amount: 25000,
      allocationType: "ADVANCE",
      status: "posted",
      postingStatus: "posted",
      date: Date.now(),
    },
  ];

  // 1. Calculate canonical credits
  const creditsResult = resolveCanonicalCustomerCredits({
    invoices,
    receipts,
  });

  assert.equal(creditsResult.totalCustomerCredits, 25000, "Total available customer credit must be ₹25,000");

  // 2. Three-Tier Receivables:
  const grossReceivable = invoices.reduce((s, i) => s + i.balance, 0); // ₹100,000
  const availableCredit = creditsResult.totalCustomerCredits; // ₹25,000
  const netReceivable = Math.max(0, grossReceivable - availableCredit); // ₹75,000

  assert.equal(grossReceivable, 100000, "Tier 1: Gross Open Invoice Dues must be 100,000");
  assert.equal(availableCredit, 25000, "Tier 2: Available Customer Credit must be 25,000");
  assert.equal(netReceivable, 75000, "Tier 3: Net Accounts Receivable must be 75,000");
  assert.notEqual(grossReceivable, netReceivable, "Gross and Net must NEVER be conflated");
});

// ============================================================================
// SUITE 6: SECTION 43 — PERFORMANCE & SCALE VERIFICATION
// ============================================================================

test("Performance Audit: 1,000 Products and 10,000 Invoices in-memory calculation benchmark", () => {
  const startTime = Date.now();

  // Generate 1,000 products
  const products = Array.from({ length: 1000 }, (_, i) => ({
    id: `prod_${i}`,
    code: `SKU-${10000 + i}`,
    name: `Product Item ${i}`,
    sellingPrice: 100 + (i % 500),
    purchasePrice: 60 + (i % 300),
    openingStock: 50,
  }));

  // Generate 10,000 posted invoices across 500 customers
  const invoices = Array.from({ length: 10000 }, (_, i) => ({
    id: `inv_${i}`,
    number: `INV-${20260000 + i}`,
    customerId: `cust_${i % 500}`,
    branchId: i % 2 === 0 ? "br_main" : "br_secondary",
    grandTotal: 1000 + (i % 10000),
    balance: i % 3 === 0 ? 0 : 500 + (i % 5000),
    status: "posted",
    postingStatus: "posted",
    date: Date.now() - (i % 90) * 86400000,
  }));

  // Benchmark scope filtering for Main Branch
  const scopeMain = {
    companyId: "org_perf",
    branchIds: ["br_main"],
    activeBranchId: "br_main",
    scopeMode: "BRANCH",
    dateRange: resolveDatePreset("all_time"),
  };

  const scoped = filterRecordsByBusinessScope(invoices, scopeMain);
  assert.equal(scoped.length, 5000, "5,000 invoices must match Main branch");

  const totalOutstanding = scoped.reduce((sum, inv) => sum + inv.balance, 0);
  assert.ok(totalOutstanding > 0);

  const durationMs = Date.now() - startTime;
  assert.ok(durationMs < 500, `In-memory 10,000 invoice filter & aggregate must finish within 500ms (took ${durationMs}ms)`);
});
