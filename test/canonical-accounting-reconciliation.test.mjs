import test from "node:test";
import assert from "node:assert/strict";

import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";
import { buildCanonicalReportingScope } from "../src/modules/accounting/services/reportingScope.ts";
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
} from "../src/modules/accounting/services/canonicalOutstandingService.ts";

const BRANCH_MAIN = "br_main";
const BRANCH_SEC = "br_secondary";

// Fixture: Current Staging Benchmark Dataset
const stagingInvoices = [
  // 3 DRAFT Invoices (Zero Accounting Authority)
  {
    id: "inv_draft_36",
    number: "INV/2026-27/0036",
    branchId: BRANCH_MAIN,
    grandTotal: 118000,
    subtotal: 100000,
    discountTotal: 0,
    gstTotal: 18000,
    balance: 118000,
    status: "draft",
    postingStatus: "draft",
    date: 1775000000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 100000, total: 100000 }],
  },
  {
    id: "inv_draft_32",
    number: "INV/2026-27/0032",
    branchId: BRANCH_MAIN,
    grandTotal: 144800,
    subtotal: 122711.86,
    discountTotal: 0,
    gstTotal: 22088.14,
    balance: 144800,
    status: "draft",
    postingStatus: "draft",
    date: 1775010000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 122711.86, total: 122711.86 }],
  },
  {
    id: "inv_draft_18",
    number: "INV/2026-27/0018",
    branchId: BRANCH_MAIN,
    grandTotal: 138000,
    subtotal: 116949.15,
    discountTotal: 0,
    gstTotal: 21050.85,
    balance: 138000,
    status: "draft",
    postingStatus: "draft",
    date: 1775020000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 116949.15, total: 116949.15 }],
  },
  // 2 POSTED Invoices
  {
    id: "inv_posted_15",
    number: "INV/2026-27/0015",
    branchId: BRANCH_MAIN,
    customerId: "cust_beta",
    grandTotal: 67649,
    subtotal: 57329.66,
    discountTotal: 0,
    gstTotal: 10319.34,
    balance: 67649,
    amountPaid: 0,
    status: "posted",
    postingStatus: "posted",
    date: 1775030000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 57329.66, total: 57329.66 }],
  },
  {
    id: "inv_posted_02",
    number: "INV/2026-27/0002",
    branchId: BRANCH_MAIN,
    customerId: "cust_alpha",
    grandTotal: 63786,
    subtotal: 54055.93,
    discountTotal: 0,
    gstTotal: 9730.07,
    balance: 63786, // Stale balance in legacy row
    amountPaid: 0,
    status: "posted",
    postingStatus: "posted",
    date: 1775040000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 54055.93, total: 54055.93 }],
  },
];

const stagingReceipts = [
  {
    id: "rec_1",
    number: "RCP-001",
    branchId: BRANCH_MAIN,
    customerId: "cust_alpha",
    amount: 64231.98,
    mode: "bank",
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
    invoiceId: "inv_posted_02",
    allocatedInvoices: [
      {
        invoiceId: "inv_posted_02",
        invoiceNumber: "INV/2026-27/0002",
        amount: 63786,
      },
    ],
  },
];

const stagingPurchases = [
  {
    id: "pur_1",
    number: "PUR-001",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    grandTotal: 486808,
    subtotal: 412549.15,
    discountTotal: 0,
    gstTotal: 74258.85,
    balance: 483351,
    amountPaid: 3457,
    status: "partial",
    postingStatus: "posted",
    date: 1775060000000,
  },
  // Draft Purchase (Must contribute ₹0)
  {
    id: "pur_draft",
    number: "PUR-DRAFT",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    grandTotal: 100000,
    subtotal: 84745.76,
    discountTotal: 0,
    gstTotal: 15254.24,
    balance: 100000,
    amountPaid: 0,
    status: "draft",
    postingStatus: "draft",
    date: 1775065000000,
  },
];

const stagingPayments = [
  {
    id: "pay_1",
    number: "PAY-001",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    amount: 3457,
    mode: "bank",
    status: "posted",
    postingStatus: "posted",
    date: 1775070000000,
    purchaseId: "pur_1",
  },
];

const stagingProducts = [
  { id: "prod_1", name: "Prefab Cabin", purchasePrice: 40000, currentStock: 10, trackInventory: true },
];

const stagingBranches = [
  { id: BRANCH_MAIN, name: "Main HQ", isMainBranch: true },
  { id: BRANCH_SEC, name: "Depot", isMainBranch: false },
];

test("Rule 1 & 3: Draft invoices strictly excluded from Total Billed Sales", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // Gross posted invoices = 67,649 + 63,786 = 131,435
  // Drafts (118,000 + 144,800 + 138,000 = 400,800) must contribute ₹0
  assert.equal(metrics.totalSales, 131435, "Total Billed Sales must sum only posted invoices (₹1,31,435.00)");
  assert.notEqual(metrics.totalSales, 532235, "Total Sales must NOT include drafts (₹5,32,235.00 is wrong)");
});

test("Rule 4 & 5: Accounts Receivable derives from authoritative bill-wise receipt allocation", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // INV 0002 (63,786) was settled by receipt of 64,231.98 -> balance = 0
  // INV 0015 (67,649) is open -> balance = 67,649
  // 3 Draft invoices contribute ₹0
  // Total AR must be exactly 67,649
  assert.equal(metrics.totalReceivables, 67649, "Authoritative AR must be exactly ₹67,649.00");
  assert.notEqual(metrics.totalReceivables, 532235, "AR must NEVER include draft invoices");
});

test("Rule 5 & 18: Unallocated receipt excess creates explainable Customer Credit", () => {
  // Receipt of ₹64,231.98 with ₹63,786 allocated against INV 0002
  // Leaves 64,231.98 - 63,786 = ₹445.98 customer credit
  const { creditItems } = calculateAuthoritativeCustomerCredits({
    invoices: stagingInvoices,
    receipts: stagingReceipts,
  });

  assert.equal(creditItems.length, 1, "Exactly one customer credit trace expected");
  assert.equal(creditItems[0].customerId, "cust_alpha");
  assert.equal(creditItems[0].remainingCredit, 445.98, "Remaining credit must be exactly ₹445.98");
  assert.equal(creditItems[0].originatingNumber, "RCP-001");
});

test("Rule 6: Canonical Outstanding Resolver eliminates stale invoice balance", () => {
  const inv0002 = stagingInvoices.find((i) => i.number === "INV/2026-27/0002");
  const canonicalBal = resolveCanonicalInvoiceOutstanding(inv0002, stagingReceipts).remainingBalance;
  assert.equal(canonicalBal, 0, "INV/2026-27/0002 must resolve to ₹0.00 (PAID) despite stale row balance");

  const inv0015 = stagingInvoices.find((i) => i.number === "INV/2026-27/0015");
  const canonicalBal15 = resolveCanonicalInvoiceOutstanding(inv0015, stagingReceipts).remainingBalance;
  assert.equal(canonicalBal15, 67649, "INV/2026-27/0015 remains fully outstanding at ₹67,649.00");

  const draftInv = stagingInvoices.find((i) => i.number === "INV/2026-27/0036");
  const draftBal = resolveCanonicalInvoiceOutstanding(draftInv, stagingReceipts).remainingBalance;
  assert.equal(draftBal, 0, "Draft invoice must ALWAYS resolve to 0 canonical outstanding");
});

test("Rule 7: Cash & Bank correctly subtracts supplier payments from receipts", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // Receipts (64,231.98) - Supplier Payments (3,457.00) = 60,774.98
  assert.equal(metrics.totalAmountReceived, 64231.98, "Amount Received must be ₹64,231.98");
  assert.equal(metrics.totalPaymentsMade, 3457, "Payments Made must be ₹3,457.00");
  assert.equal(metrics.totalLiquidity, 60774.98, "Closing Cash & Bank must be ₹60,774.98 (Receipts - Payments)");
});

test("Rule 8 & 9: Sales Return reduces Net Sales, AR, and Output GST", () => {
  const returnAgainst0015 = {
    id: "ret_1",
    number: "SR-001",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    customerId: "cust_beta",
    taxableAmount: 20000,
    cgst: 1800,
    sgst: 1800,
    igst: 0,
    taxTotal: 3600,
    grandTotal: 23600,
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    date: 1775080000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 20000, total: 20000 }],
  };

  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    salesReturns: [returnAgainst0015],
    branches: stagingBranches,
    scope,
  });

  // Gross posted invoices = 131,435. Return = 23,600. Net Billed Value = 107,835
  assert.equal(metrics.totalSales, 131435, "Total Billed Sales reflects gross posted invoices");
  assert.equal(metrics.totalSalesReturns, 23600, "Returns tracked");
  assert.equal(metrics.netBilledValue, 107835, "Net Billed Value reduces by return grand total");
  // AR for INV 0015 was 67,649 - 23,600 = 44,049
  assert.equal(metrics.totalReceivables, 44049, "AR reduces by return grand total");
});

test("Rule 9: Sales return exceeding outstanding creates Customer Credit without negative AR", () => {
  // INV 0015 outstanding is 67,649. Return of 80,000 exceeds outstanding by 12,351.
  const largeReturn = {
    id: "ret_large",
    number: "SR-LARGE",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    customerId: "cust_beta",
    grandTotal: 80000,
    status: "posted",
    postingStatus: "posted",
    date: 1775085000000,
  };

  const inv0015 = stagingInvoices.find((i) => i.number === "INV/2026-27/0015");
  const remBal = resolveCanonicalInvoiceOutstanding(inv0015, [], [largeReturn]).remainingBalance;

  assert.equal(remBal, 0, "AR must not become negative; stops at ₹0.00");

  const { creditItems } = calculateAuthoritativeCustomerCredits({
    invoices: [inv0015],
    salesReturns: [largeReturn],
  });

  assert.equal(creditItems.length, 1);
  assert.equal(creditItems[0].remainingCredit, 80000 - 67649, "Excess 12,351 must become Customer Credit");
});

test("Rule 10: Restocked return reverses COGS deterministically using cost basis", () => {
  const returnRestocked = {
    id: "ret_cost",
    number: "SR-RESTOCK",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    taxableAmount: 50000,
    taxTotal: 9000,
    grandTotal: 59000,
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    date: 1775090000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 50000, total: 50000 }],
  };

  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const baseMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  const returnMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    products: stagingProducts,
    salesReturns: [returnRestocked],
    branches: stagingBranches,
    scope,
  });

  // Product 1 cost is 40,000. 1 qty returned to stock reduces COGS by 40,000
  assert.equal(baseMetrics.costOfGoodsSold - returnMetrics.costOfGoodsSold, 40000, "COGS must reduce by item cost basis (₹40,000.00)");
});

test("Rule 13: Draft purchases strictly excluded from Total Purchases and Accounts Payable", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // pur_1 grand total is 486,808; pur_draft is 100,000 (draft)
  assert.equal(metrics.totalPurchases, 486808, "Total Purchases must exclude draft purchase");
  // AP: pur_1 balance is 483,351; pur_draft balance is 100,000 (draft)
  assert.equal(metrics.totalPayables, 483351, "AP must exclude draft purchase");
});

test("Rule 14: Strict Scope Isolation between Branch Mode and Consolidated Mode", () => {
  const consolidatedScope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });
  const secBranchScope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: BRANCH_SEC,
  });

  const consolidatedMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    branches: stagingBranches,
    scope: consolidatedScope,
  });

  const secBranchMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    branches: stagingBranches,
    scope: secBranchScope,
  });

  assert.equal(consolidatedMetrics.totalSales, 131435, "Consolidated shows all posted sales");
  assert.equal(secBranchMetrics.totalSales, 0, "Secondary branch has 0 sales (no records match BRANCH_SEC)");
  assert.equal(secBranchMetrics.totalReceivables, 0, "Secondary branch has 0 receivables");
  assert.equal(secBranchMetrics.totalPayables, 0, "Secondary branch has 0 payables");
});
