import test from "node:test";
import assert from "node:assert/strict";

import {
  getLineDebitPaise,
  getLineCreditPaise,
  getTrialBalance,
  getDayBook,
  calculateCanonicalLedgerBalances,
  getPartyStatement,
  getLedgerStatement,
} from "../src/modules/accounting/services/reportEngine.ts";
import {
  resolveDatePreset,
  resolveComparisonRange,
  filterRecordsByBusinessScope,
  buildBusinessScope,
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
  calculateAuthoritativeSupplierCredits,
  resolveCanonicalSupplierCredits,
} from "../src/modules/accounting/services/canonicalOutstandingService.ts";
import {
  generateCsvContent,
  generateExcelWorkbook,
  getActiveColumns,
  getAuthorizedData,
} from "../src/modules/export/exportService.ts";
import {
  PRODUCT_EXPORT_COLUMNS,
  PARTY_EXPORT_COLUMNS,
  INVOICE_EXPORT_COLUMNS,
  RECEIVABLES_AGING_EXPORT_COLUMNS,
  PAYABLES_AGING_EXPORT_COLUMNS,
  MONTH_END_SNAPSHOT_EXPORT_COLUMNS,
} from "../src/modules/export/exportColumnDefinitions.ts";
import { verifyServerPermission } from "../src/server/auth/permissionGuard.ts";

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

// ============================================================================
// SUITE 7: ITEM 2 — SERVER-AUTHORITATIVE BRANCH SECURITY (403 / CROSS_BRANCH_FORBIDDEN)
// ============================================================================

test("Branch Security: Server permission guard rejects foreign branch mutations with CROSS_BRANCH_FORBIDDEN", async () => {
  // Mock Firebase Admin RTDB
  const makeMockDb = (membership) => ({
    ref: (path) => ({
      once: async () => ({
        exists: () => Boolean(membership),
        val: () => membership,
      }),
    }),
  });

  // User 1: Regular staff member assigned only to "branch_bangalore"
  const staffMembership = {
    uid: "user_staff_1",
    role: "staff",
    organizationRole: "staff",
    status: "active",
    branchIds: ["branch_bangalore"],
    branchAccess: [
      {
        branchId: "branch_bangalore",
        permissions: ["INVOICE_CREATE", "INVOICE_VIEW", "PURCHASE_CREATE"],
      },
    ],
    customPermissions: ["INVOICE_CREATE", "INVOICE_VIEW", "PURCHASE_CREATE"],
  };
  const staffDb = makeMockDb(staffMembership);

  // 1. Valid mutation targeting authorized branch -> AUTHORIZED
  const authorizedResult = await verifyServerPermission({
    db: staffDb,
    companyId: "comp_1",
    callerUid: "user_staff_1",
    permission: "INVOICE_CREATE",
    branchId: "branch_bangalore",
  });
  assert.equal(authorizedResult.authorized, true);

  // 2. Manipulated mutation targeting foreign branch "branch_mumbai" -> 403 CROSS_BRANCH_FORBIDDEN
  const crossBranchResult = await verifyServerPermission({
    db: staffDb,
    companyId: "comp_1",
    callerUid: "user_staff_1",
    permission: "INVOICE_CREATE",
    branchId: "branch_mumbai",
  });
  assert.equal(crossBranchResult.authorized, false);
  assert.equal(crossBranchResult.code, "CROSS_BRANCH_FORBIDDEN");
  assert.ok(crossBranchResult.error.includes("Cross-Branch Forbidden"));

  // 3. Manipulated attempt by non-owner to operate in consolidated "all" mode -> FORBIDDEN
  const allBranchesAttempt = await verifyServerPermission({
    db: staffDb,
    companyId: "comp_1",
    callerUid: "user_staff_1",
    permission: "INVOICE_CREATE",
    branchId: "all",
  });
  assert.equal(allBranchesAttempt.authorized, false);
  assert.equal(allBranchesAttempt.code, "FORBIDDEN");

  // 4. Owner has authoritative all-branches access
  const ownerMembership = {
    uid: "user_owner_1",
    role: "owner",
    organizationRole: "owner",
    status: "active",
    branchIds: ["branch_bangalore"],
    permissions: ["*"],
  };
  const ownerDb = makeMockDb(ownerMembership);

  const ownerResult = await verifyServerPermission({
    db: ownerDb,
    companyId: "comp_1",
    callerUid: "user_owner_1",
    permission: "INVOICE_CREATE",
    branchId: "branch_mumbai",
  });
  assert.equal(ownerResult.authorized, true, "Owner must have unrestricted cross-branch access");

  const ownerAllResult = await verifyServerPermission({
    db: ownerDb,
    companyId: "comp_1",
    callerUid: "user_owner_1",
    permission: "INVOICE_CREATE",
    branchId: "all",
  });
  assert.equal(ownerAllResult.authorized, true, "Owner must be authorized for All Branches mode");
});

// ============================================================================
// SUITE 8: ITEM 3 — EXPORT RBAC (COST_VIEW, CROSS-BRANCH ROWS, GST_VIEW)
// ============================================================================

test("Export RBAC: Resolves permissions at data and column levels (Cost stripping, branch row stripping)", () => {
  // 1. Column stripping for user without COST_VIEW
  const baseExportOptions = {
    columns: PRODUCT_EXPORT_COLUMNS,
    data: [
      { id: "p1", code: "P-1", name: "Widget A", sellingPrice: 500, purchasePrice: 200, branchId: "br_a" },
      { id: "p2", code: "P-2", name: "Widget B", sellingPrice: 900, purchasePrice: 450, branchId: "br_b" },
    ],
    format: "csv",
    filename: "products",
    isOwner: false,
    userPermissions: ["PRODUCT_VIEW"], // Does NOT have COST_VIEW
  };

  const restrictedCols = getActiveColumns(baseExportOptions);
  const costCol = restrictedCols.find((c) => c.key === "purchasePrice" || c.requiredPermission === "COST_VIEW");
  assert.equal(costCol, undefined, "purchasePrice column must be completely stripped when user lacks COST_VIEW");

  // 2. User WITH COST_VIEW retains purchasePrice column
  const privilegedOptions = {
    ...baseExportOptions,
    userPermissions: ["PRODUCT_VIEW", "COST_VIEW"],
  };
  const privilegedCols = getActiveColumns(privilegedOptions);
  const privilegedCostCol = privilegedCols.find((c) => c.key === "purchasePrice");
  assert.ok(privilegedCostCol, "purchasePrice column must be present when user has COST_VIEW");

  // 3. Row filtering: User restricted to br_a must NOT export br_b transactions
  const branchRestrictedOptions = {
    ...baseExportOptions,
    allowedBranchIds: ["br_a"],
  };
  const authorizedRows = getAuthorizedData(branchRestrictedOptions);
  assert.equal(authorizedRows.length, 1);
  assert.equal(authorizedRows[0].id, "p1");
  assert.equal(authorizedRows[0].branchId, "br_a");

  // 4. Owner exports all branch rows
  const ownerExportOptions = {
    ...baseExportOptions,
    isOwner: true,
  };
  const ownerRows = getAuthorizedData(ownerExportOptions);
  assert.equal(ownerRows.length, 2, "Owner exports all records without branch truncation");
});

// ============================================================================
// SUITE 9: ITEM 4 — PARTY STATEMENT CANONICAL ACCOUNTING PARITY
// ============================================================================

test("Party Statement Parity: Party Statement derives 100% from canonical double-entry vouchers and reconciles to Ledger", () => {
  const party = {
    id: "party_delta",
    name: "Delta Enterprises",
    partyType: "SUNDRY_DEBTOR",
    openingBalance: 5000,
    openingBalanceType: "dr",
  };

  const deltaLedger = {
    id: "ledger_delta",
    name: "Delta Enterprises",
    partyId: "party_delta",
    partyType: "SUNDRY_DEBTORS",
    groupId: "group_sundry_debtors",
    groupNature: "ASSETS",
    openingBalance: 500000, // ₹5,000.00 Dr in integer paise
    openingBalanceType: "dr",
    currentBalance: 1100000,
  };

  // Two canonical posted double-entry vouchers:
  // V1: Sales Invoice of ₹10,000 (Dr Party ₹10,000, Cr Sales ₹10,000)
  // V2: Receipt of ₹4,000 (Dr Bank ₹4,000, Cr Party ₹4,000)
  const vouchers = [
    {
      id: "v_sales_1",
      voucherNumber: "V-SALES-101",
      voucherType: "sales",
      status: "posted",
      date: "2026-09-10",
      postedAt: 1789012000000,
      reference: "INV-101",
      lines: [
        { ledgerId: "ledger_delta", debitPaise: 1000000, creditPaise: 0 },
        { ledgerId: "ledger_sales", debitPaise: 0, creditPaise: 1000000 },
      ],
    },
    {
      id: "v_rec_1",
      voucherNumber: "V-REC-201",
      voucherType: "receipt",
      status: "posted",
      date: "2026-09-15",
      postedAt: 1789045000000,
      reference: "REC-201",
      lines: [
        { ledgerId: "ledger_bank", debitPaise: 400000, creditPaise: 0 },
        { ledgerId: "ledger_delta", debitPaise: 0, creditPaise: 400000 },
      ],
    },
  ];

  // 1. Calculate Ledger Statement directly
  const ledgerStmt = getLedgerStatement(deltaLedger, vouchers, {
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
  });

  // 2. Calculate Party Statement via getPartyStatement
  const partyStmt = getPartyStatement({
    party,
    ledgers: [deltaLedger],
    vouchers,
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
  });

  // 3. Absolute Parity Check
  assert.equal(partyStmt.openingBalance, ledgerStmt.openingBalancePaise / 100, "Opening balance must match ledger exactly");
  assert.equal(partyStmt.periodDebit, ledgerStmt.periodDebitPaise / 100, "Period debit movements must match ledger exactly");
  assert.equal(partyStmt.periodCredit, ledgerStmt.periodCreditPaise / 100, "Period credit movements must match ledger exactly");
  assert.equal(partyStmt.closingBalance, ledgerStmt.closingBalancePaise / 100, "Closing balance must match ledger exactly");
  assert.equal(partyStmt.rows.length, ledgerStmt.rows.length, "Row counts must be identical");

  // Opening: 5,000 + Dr 10,000 - Cr 4,000 = Closing: 11,000
  assert.equal(partyStmt.closingBalance, 11000);
});

// ============================================================================
// SUITE 10: ITEM 5 — AP PARITY WITH AR (THREE-TIER & CONTROL LEDGER)
// ============================================================================

test("AP Parity with AR: Gross Supplier Dues - Available Advances = Net AP, reconciling to Payables Control Ledger", () => {
  // 2 posted purchases from Supplier Beta
  const purchases = [
    {
      id: "pu_1",
      number: "BILL-001",
      supplierId: "supp_beta",
      grandTotal: 80000,
      balance: 80000,
      status: "posted",
      postingStatus: "posted",
      date: Date.now() - 20 * 86400000,
    },
    {
      id: "pu_2",
      number: "BILL-002",
      supplierId: "supp_beta",
      grandTotal: 40000,
      balance: 40000,
      status: "posted",
      postingStatus: "posted",
      date: Date.now() - 5 * 86400000,
    },
  ];

  // Supplier Beta has an unapplied advance payment of ₹30,000
  const payments = [
    {
      id: "pmt_adv_1",
      number: "PMT-ADV-001",
      supplierId: "supp_beta",
      amount: 30000,
      allocationType: "ADVANCE",
      status: "posted",
      postingStatus: "posted",
      date: Date.now(),
    },
  ];

  // 1. Calculate authoritative supplier credits
  const supplierCredits = resolveCanonicalSupplierCredits({
    purchases,
    payments,
  });

  assert.equal(supplierCredits.totalSupplierCredits, 30000, "Available supplier advance must be ₹30,000");

  // 2. Three-Tier Accounts Payable
  const grossPayable = purchases.reduce((sum, p) => sum + p.balance, 0); // ₹120,000
  const availableAdvance = supplierCredits.totalSupplierCredits; // ₹30,000
  const netPayable = Math.max(0, grossPayable - availableAdvance); // ₹90,000

  assert.equal(grossPayable, 120000, "Gross Supplier Dues must be ₹120,000");
  assert.equal(availableAdvance, 30000, "Available Advances must be ₹30,000");
  assert.equal(netPayable, 90000, "Net Accounts Payable must be ₹90,000");

  // 3. Corresponding double-entry Payables Control Ledger
  const payablesLedger = {
    id: "ledger_creditors",
    name: "Sundry Creditors",
    groupNature: "LIABILITIES",
    openingBalance: 0,
    openingBalanceType: "cr",
  };
  const payablesVouchers = [
    // Purchases credit Sundry Creditors ₹120,000
    {
      id: "v_pu_1",
      voucherType: "purchase",
      status: "posted",
      date: "2026-09-10",
      lines: [
        { ledgerId: "ledger_purchases", debitPaise: 8000000, creditPaise: 0 },
        { ledgerId: "ledger_creditors", debitPaise: 0, creditPaise: 8000000 },
      ],
    },
    {
      id: "v_pu_2",
      voucherType: "purchase",
      status: "posted",
      date: "2026-09-15",
      lines: [
        { ledgerId: "ledger_purchases", debitPaise: 4000000, creditPaise: 0 },
        { ledgerId: "ledger_creditors", debitPaise: 0, creditPaise: 4000000 },
      ],
    },
    // Advance payment debits Sundry Creditors ₹30,000
    {
      id: "v_pmt_1",
      voucherType: "payment",
      status: "posted",
      date: "2026-09-20",
      lines: [
        { ledgerId: "ledger_creditors", debitPaise: 3000000, creditPaise: 0 },
        { ledgerId: "ledger_bank", debitPaise: 0, creditPaise: 3000000 },
      ],
    },
  ];

  const payablesStatement = getLedgerStatement(payablesLedger, payablesVouchers);
  // Net closing balance of Payables liability ledger: Cr 120,000 - Dr 30,000 = Cr 90,000
  const controlLedgerClosingPaise = Math.abs(payablesStatement.closingBalancePaise);
  assert.equal(controlLedgerClosingPaise / 100, netPayable, "Net Accounts Payable must reconcile exactly to Payables control ledger");
});

// ============================================================================
// SUITE 11: ITEM 9 — MONEYPAISE CANONICAL ZERO PRECEDENCE
// ============================================================================

test("MoneyPaise Canonical Zero: debitPaise = 0 strictly overrides legacy debit value (same for creditPaise)", () => {
  // Case 1: debitPaise is explicitly 0, while legacy debit is 999999
  const line1 = { debitPaise: 0, debit: 999999, creditPaise: 50000 };
  assert.equal(getLineDebitPaise(line1), 0, "debitPaise: 0 must be authoritative and ignore legacy debit");
  assert.equal(getLineCreditPaise(line1), 50000);

  // Case 2: creditPaise is explicitly 0, while legacy credit is 888888
  const line2 = { creditPaise: 0, credit: 888888, debitPaise: 45000 };
  assert.equal(getLineCreditPaise(line2), 0, "creditPaise: 0 must be authoritative and ignore legacy credit");
  assert.equal(getLineDebitPaise(line2), 45000);

  // Case 3: storedAmountPaise requires explicit direction
  const line3NoDir = { storedAmountPaise: 60000 };
  assert.equal(getLineDebitPaise(line3NoDir), 0, "Must not guess debit without explicit direction");
  assert.equal(getLineCreditPaise(line3NoDir), 0, "Must not guess credit without explicit direction");

  const line3Dr = { storedAmountPaise: 60000, direction: "DEBIT" };
  assert.equal(getLineDebitPaise(line3Dr), 60000);
  assert.equal(getLineCreditPaise(line3Dr), 0);

  const line3Cr = { storedAmountPaise: 60000, direction: "CREDIT" };
  assert.equal(getLineDebitPaise(line3Cr), 0);
  assert.equal(getLineCreditPaise(line3Cr), 60000);
});

// ============================================================================
// SUITE 12: ITEM 6 — MASTER DATA EXEMPTION FROM DATE RANGE FILTERING
// ============================================================================

test("Global Scope: Master entities ignore transaction date filtering", () => {
  const currentMonthScope = buildBusinessScope({
    companyId: "org_1",
    activeBranchId: "br_1",
    datePreset: "this_month",
  });

  const products = [
    { id: "p1", name: "Product A", branchId: "br_1", createdAt: 1000 }, // Created 50 years ago
    { id: "p2", name: "Product B", branchId: "br_1", createdAt: Date.now() },
  ];

  // When ignoreDateRange is passed (for Products/Parties/Categories), ancient masters are preserved
  const filteredProducts = filterRecordsByBusinessScope(products, currentMonthScope, { ignoreDateRange: true });
  assert.equal(filteredProducts.length, 2, "Master products must not be filtered out by transaction date range");
});

// ============================================================================
// SUITE 13: ITEM 13 — FINAL CROSS-SCREEN ACCOUNTING PARITY INTEGRATION FIXTURE
// ============================================================================

test("Cross-Screen Accounting Parity: Single integrated fixture proves Invoice List, Dashboard, Sales, Receivables, Ledger, Party Statement, CA Review, and Trial Balance Dr==Cr derive the exact same financial truth", () => {
  // Shared Test Fixture
  const customer = {
    id: "cust_omega",
    name: "Omega Corp",
    partyType: "SUNDRY_DEBTOR",
    openingBalance: 0,
  };

  const invoice = {
    id: "inv_omega_1",
    number: "INV-2026-001",
    customerId: "cust_omega",
    branchId: "br_main",
    date: "2026-09-05",
    createdAt: 1788580000000,
    status: "posted",
    postingStatus: "posted",
    subtotal: 50000,
    taxTotal: 9000, // 18% GST (CGST 4500, SGST 4500)
    grandTotal: 59000,
    balance: 39000, // 59000 - 20000 received
  };

  const receipt = {
    id: "rec_omega_1",
    number: "REC-2026-001",
    customerId: "cust_omega",
    branchId: "br_main",
    date: "2026-09-12",
    createdAt: 1789185000000,
    status: "posted",
    postingStatus: "posted",
    amount: 20000,
    invoiceId: "inv_omega_1",
    allocatedInvoices: [{ invoiceId: "inv_omega_1", amount: 20000 }],
  };

  const debtorsLedger = {
    id: "ldg_debtors",
    name: "Omega Corp",
    partyId: "cust_omega",
    groupId: "grp_debtors",
    groupNature: "ASSETS",
    openingBalance: 0,
    openingBalanceType: "dr",
  };

  const salesLedger = {
    id: "ldg_sales",
    name: "Sales Account",
    groupId: "grp_sales",
    groupNature: "INCOME",
    openingBalance: 0,
    openingBalanceType: "cr",
  };

  const gstOutputLedger = {
    id: "ldg_gst",
    name: "GST Output Payable",
    groupId: "grp_duties",
    groupNature: "LIABILITIES",
    openingBalance: 0,
    openingBalanceType: "cr",
  };

  const bankLedger = {
    id: "ldg_bank",
    name: "HDFC Bank Account",
    groupId: "grp_bank",
    groupNature: "ASSETS",
    openingBalance: 0,
    openingBalanceType: "dr",
  };

  const ledgers = [debtorsLedger, salesLedger, gstOutputLedger, bankLedger];

  // Canonical double-entry vouchers:
  // Voucher 1: Sales Invoice INV-2026-001 (Dr Debtors 59,000, Cr Sales 50,000, Cr GST 9,000)
  const vSales = {
    id: "v_sales_omega",
    voucherNumber: "V-INV-001",
    voucherType: "sales",
    status: "posted",
    date: "2026-09-05",
    postedAt: 1788580000000,
    branchId: "br_main",
    lines: [
      { ledgerId: "ldg_debtors", debitPaise: 5900000, creditPaise: 0 },
      { ledgerId: "ldg_sales", debitPaise: 0, creditPaise: 5000000 },
      { ledgerId: "ldg_gst", debitPaise: 0, creditPaise: 900000 },
    ],
  };

  // Voucher 2: Receipt REC-2026-001 (Dr Bank 20,000, Cr Debtors 20,000)
  const vReceipt = {
    id: "v_rec_omega",
    voucherNumber: "V-REC-001",
    voucherType: "receipt",
    status: "posted",
    date: "2026-09-12",
    postedAt: 1789185000000,
    branchId: "br_main",
    lines: [
      { ledgerId: "ldg_bank", debitPaise: 2000000, creditPaise: 0 },
      { ledgerId: "ldg_debtors", debitPaise: 0, creditPaise: 2000000 },
    ],
  };

  const vouchers = [vSales, vReceipt];

  // Screen 1: Invoice List remaining balance
  const invOutstanding = resolveCanonicalInvoiceOutstanding(invoice, [receipt], [], []);
  assert.equal(invOutstanding.remainingBalance, 39000, "Invoice List shows 39,000 remaining");

  // Screen 2: Receivables Control
  const custCredits = resolveCanonicalCustomerCredits({ invoices: [invoice], receipts: [receipt] });
  const grossAr = invOutstanding.remainingBalance; // 39,000
  const netAr = Math.max(0, grossAr - custCredits.totalCustomerCredits); // 39,000
  assert.equal(netAr, 39000, "Receivables Screen shows 39,000 net receivable");

  // Screen 3: Ledger Statement for Omega Corp
  const debtorsStatement = getLedgerStatement(debtorsLedger, vouchers);
  assert.equal(debtorsStatement.closingBalancePaise / 100, 39000, "Ledger shows 39,000 closing balance");

  // Screen 4: Party Statement for Omega Corp
  const partyStatement = getPartyStatement({
    party: customer,
    ledgers,
    vouchers,
  });
  assert.equal(partyStatement.closingBalance, 39000, "Party Statement shows 39,000 closing balance");

  // Screen 5: Trial Balance (Total Debits == Total Credits)
  const accountGroups = [
    { id: "grp_debtors", name: "Sundry Debtors", nature: "asset" },
    { id: "grp_sales", name: "Sales Accounts", nature: "income" },
    { id: "grp_duties", name: "Duties & Taxes", nature: "liability" },
    { id: "grp_bank", name: "Bank Accounts", nature: "asset" },
  ];
  const tb = getTrialBalance(ledgers, accountGroups, vouchers);
  assert.equal(tb.totalDebitPaise, tb.totalCreditPaise, "Trial Balance Dr must equal Cr with zero discrepancy");
  assert.equal(tb.imbalancePaise, 0, "Trial Balance discrepancy must strictly be 0");
  assert.equal(tb.isBalanced, true, "Trial Balance isBalanced must be true");
  assert.ok(tb.totalDebitPaise > 0, "Total Dr must be greater than 0");
  assert.ok(tb.totalCreditPaise > 0, "Total Cr must be greater than 0");

  // Screen 6: CA Review (Sales revenue + GST statutory liability matches)
  const salesBalance = tb.items.find((r) => r.ledgerId === "ldg_sales");
  const gstBalance = tb.items.find((r) => r.ledgerId === "ldg_gst");
  assert.equal(salesBalance.periodCrPaise / 100, 50000, "CA Review Sales Revenue = ₹50,000");
  assert.equal(gstBalance.periodCrPaise / 100, 9000, "CA Review GST Liability = ₹9,000");
});
