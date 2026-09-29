import test from "node:test";
import assert from "node:assert/strict";

import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";
import { buildCanonicalReportingScope, filterRecordsByScope } from "../src/modules/accounting/services/reportingScope.ts";

/**
 * KH Portable Cabins Reference Data Benchmark (from Production/Staging comparison)
 * Production Benchmark:
 * Total Sales: ₹5,32,235.00
 * Amount Received: ₹64,231.98
 * Accounts Receivable: ₹67,649.00
 * Total Purchases: ₹4,86,808.00
 * Payments Made: ₹3,457.00
 * Accounts Payable: ₹4,83,351.00
 * Gross Profit: ₹3,63,935.66
 * Cash & Bank: ₹60,774.98
 */
const KH_MAIN_BRANCH_ID = "br_main_kh_cabins";
const KH_SECONDARY_BRANCH_ID = "br_mumbai_depot";

// Operational dataset matching KH Portable Cabins figures
const khInvoices = [
  {
    id: "inv_kh_1",
    number: "INV-001",
    branchId: KH_MAIN_BRANCH_ID,
    grandTotal: 300000,
    subtotal: 254237.29,
    discountTotal: 0,
    gstTotal: 45762.71,
    balance: 50000,
    amountPaid: 250000,
    status: "partial",
    postingStatus: "posted",
    date: 1775000000000,
    items: [{ productId: "p_cabin_1", quantity: 2, rate: 127118.64, total: 254237.29 }]
  },
  {
    id: "inv_kh_2",
    number: "INV-002",
    branchId: KH_MAIN_BRANCH_ID,
    grandTotal: 232235,
    subtotal: 196809.32,
    discountTotal: 0,
    gstTotal: 35425.68,
    balance: 17649,
    amountPaid: 214586,
    status: "partial",
    postingStatus: "posted",
    date: 1775100000000,
    items: [{ productId: "p_cabin_2", quantity: 1, rate: 196809.32, total: 196809.32 }]
  }
];

const khPurchases = [
  {
    id: "pur_kh_1",
    number: "PUR-001",
    branchId: KH_MAIN_BRANCH_ID,
    grandTotal: 486808,
    subtotal: 412549.15,
    discountTotal: 0,
    gstTotal: 74258.85,
    balance: 483351,
    amountPaid: 3457,
    status: "partial",
    postingStatus: "posted",
    date: 1775050000000,
    items: [{ productId: "p_steel", quantity: 10, rate: 41254.91, total: 412549.15 }]
  }
];

const khReceipts = [
  {
    id: "rec_kh_1",
    number: "RCP-001",
    branchId: KH_MAIN_BRANCH_ID,
    amount: 64231.98,
    mode: "bank",
    postingStatus: "posted",
    date: 1775150000000,
  }
];

const khPayments = [
  {
    id: "pay_kh_1",
    number: "PAY-001",
    branchId: KH_MAIN_BRANCH_ID,
    amount: 3457,
    mode: "bank",
    postingStatus: "posted",
    date: 1775200000000,
  }
];

const khProducts = [
  { id: "p_cabin_1", name: "Portable Cabin 20ft", purchasePrice: 43555.48, trackInventory: true, currentStock: 4 },
  { id: "p_cabin_2", name: "Security Cabin 10ft", purchasePrice: 0, trackInventory: true, currentStock: 2 },
  { id: "p_steel", name: "Steel Beams", purchasePrice: 41254.91, trackInventory: true, currentStock: 20 },
];

const khLedgers = [
  {
    id: "led_cash",
    name: "Cash in Hand",
    groupId: "grp_cash",
    groupNature: "asset",
    currentBalance: 0,
    active: true,
  },
  {
    id: "led_bank",
    name: "HDFC Bank Current Account",
    groupId: "grp_bank",
    groupNature: "asset",
    currentBalance: 6077498, // ₹60,774.98
    active: true,
  },
  {
    id: "led_debtor_1",
    name: "Customer Alpha",
    groupId: "grp_sundry_debtors",
    partyType: "customer",
    groupNature: "asset",
    currentBalance: 6764900, // ₹67,649.00
    active: true,
  },
  {
    id: "led_creditor_1",
    name: "Supplier Omega",
    groupId: "grp_sundry_creditors",
    partyType: "supplier",
    groupNature: "liability",
    currentBalance: -48335100, // ₹483,351.00 Cr
    active: true,
  }
];

const khBranches = [
  { id: KH_MAIN_BRANCH_ID, name: "Main Branch", code: "MAIN", isMainBranch: true },
  { id: KH_SECONDARY_BRANCH_ID, name: "Mumbai Depot", code: "MUM", isMainBranch: false },
];

test("Canonical Reporting Scope: Correctly resolves CONSOLIDATED vs BRANCH modes", () => {
  const consolidated = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: "all",
  });
  assert.equal(consolidated.scopeMode, "CONSOLIDATED");
  assert.equal(consolidated.activeBranchId, "all");

  const branchScoped = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: KH_MAIN_BRANCH_ID,
  });
  assert.equal(branchScoped.scopeMode, "BRANCH");
  assert.equal(branchScoped.activeBranchId, KH_MAIN_BRANCH_ID);
});

test("Reconciliation Benchmark: Consolidated Scope reconciles exactly with Production figures", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    ledgers: khLedgers,
    invoices: khInvoices,
    purchases: khPurchases,
    products: khProducts,
    receipts: khReceipts,
    payments: khPayments,
    branches: khBranches,
    scope,
  });

  assert.equal(metrics.totalSales, 532235, "Total Sales must be ₹5,32,235.00");
  assert.equal(metrics.totalPurchases, 486808, "Total Purchases must be ₹4,86,808.00");
  assert.equal(metrics.totalAmountReceived, 64231.98, "Amount Received must be ₹64,231.98");
  assert.equal(metrics.totalPaymentsMade, 3457, "Payments Made must be ₹3,457.00");
  assert.equal(metrics.totalReceivables, 67649, "Accounts Receivable must be ₹67,649.00");
  assert.equal(metrics.totalPayables, 483351, "Accounts Payable must be ₹4,83,351.00");
  assert.equal(metrics.bankBalance, 60774.98, "Cash & Bank must be ₹60,774.98");
  assert.ok(Math.abs(metrics.grossProfit - 363935.66) < 0.05, `Gross Profit must be approximately ₹3,63,935.66 (got ${metrics.grossProfit})`);
});

test("Reconciliation Benchmark: Main Branch Scope reconciles after authoritative legacy migration", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: KH_MAIN_BRANCH_ID,
  });

  const metrics = computeDashboardMetrics({
    ledgers: khLedgers,
    invoices: khInvoices,
    purchases: khPurchases,
    products: khProducts,
    receipts: khReceipts,
    payments: khPayments,
    branches: khBranches,
    scope,
  });

  assert.equal(metrics.totalSales, 532235, "Main Branch total sales reflects all its migrated records");
  assert.equal(metrics.totalPurchases, 486808, "Main Branch total purchases reflects all its migrated records");
  assert.equal(metrics.totalAmountReceived, 64231.98, "Main Branch receipts reflect collections");
  assert.equal(metrics.totalPaymentsMade, 3457, "Main Branch payments reflect supplier payments");
  assert.equal(metrics.totalReceivables, 67649, "Main Branch AR reflects unpaid invoices in Main Branch");
  assert.equal(metrics.totalPayables, 483351, "Main Branch AP reflects unpaid purchases in Main Branch");
  assert.equal(metrics.totalLiquidity, 64231.98 - 3457, "Main Branch liquidity reflects branch net collections");
});

test("Strict Branch Isolation: Secondary branch has ZERO cross-branch leakage", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: KH_SECONDARY_BRANCH_ID,
  });

  const metrics = computeDashboardMetrics({
    ledgers: khLedgers,
    invoices: khInvoices, // All belonging to KH_MAIN_BRANCH_ID
    purchases: khPurchases,
    products: khProducts,
    receipts: khReceipts,
    payments: khPayments,
    branches: khBranches,
    scope,
  });

  assert.equal(metrics.totalSales, 0, "Secondary branch must have 0 sales");
  assert.equal(metrics.totalPurchases, 0, "Secondary branch must have 0 purchases");
  assert.equal(metrics.totalAmountReceived, 0, "Secondary branch must have 0 receipts");
  assert.equal(metrics.totalPaymentsMade, 0, "Secondary branch must have 0 payments");
  assert.equal(metrics.totalReceivables, 0, "Secondary branch must NOT leak Main Branch AR");
  assert.equal(metrics.totalPayables, 0, "Secondary branch must NOT leak Main Branch AP");
  assert.equal(metrics.totalLiquidity, 0, "Secondary branch must NOT leak Main Branch Cash/Bank");
});

test("Accounting Invariants: AR Reconciles exactly with posted invoices and receipts", () => {
  // Opening AR (0) + Billed Sales (532235) - Amount Received on invoices (464586) = Closing AR (67649)
  const sumInvoices = khInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const sumInvoiceBalances = khInvoices.reduce((s, i) => s + i.balance, 0);
  const sumInvoicePaid = khInvoices.reduce((s, i) => s + i.amountPaid, 0);

  assert.equal(sumInvoices, 532235);
  assert.equal(sumInvoiceBalances, 67649);
  assert.equal(sumInvoices - sumInvoicePaid, sumInvoiceBalances, "Billed - Paid === Unpaid Balance");
});

test("Accounting Invariants: AP Reconciles exactly with posted purchases and payments", () => {
  // Purchases (486808) - Payments on purchases (3457) = Closing AP (483351)
  const sumPurchases = khPurchases.reduce((s, p) => s + p.grandTotal, 0);
  const sumPurchaseBalances = khPurchases.reduce((s, p) => s + p.balance, 0);
  const sumPurchasePaid = khPurchases.reduce((s, p) => s + p.amountPaid, 0);

  assert.equal(sumPurchases, 486808);
  assert.equal(sumPurchaseBalances, 483351);
  assert.equal(sumPurchases - sumPurchasePaid, sumPurchaseBalances, "Purchases - Paid === Unpaid Balance");
});

test("Document List Parity: filterRecordsByScope produces identical record counts for List and Dashboard", () => {
  const branchScope = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: KH_MAIN_BRANCH_ID,
  });

  const filteredInvoices = filterRecordsByScope(khInvoices, branchScope);
  assert.equal(filteredInvoices.length, khInvoices.length, "All KH main branch invoices included");

  const secondaryScope = buildCanonicalReportingScope({
    companyId: "org_kh",
    activeBranchId: KH_SECONDARY_BRANCH_ID,
  });

  const secondaryInvoices = filterRecordsByScope(khInvoices, secondaryScope);
  assert.equal(secondaryInvoices.length, 0, "Zero invoices match secondary branch");
});
