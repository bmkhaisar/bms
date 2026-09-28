import test from "node:test";
import assert from "node:assert/strict";

import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";
import { hasBranchAccess, hasBranchPermission } from "../src/modules/auth/permissions.ts";

test("Strict Branch Isolation: Restricted user cannot access other branches", () => {
  const userBangalore = {
    userId: "user_blr",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_blr", permissions: ["INVOICE_VIEW", "REPORTS_VIEW"] }
    ]
  };

  const userMysore = {
    userId: "user_mys",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_mys", permissions: ["INVOICE_VIEW", "REPORTS_VIEW"] }
    ]
  };

  // Bangalore user assertions
  assert.equal(hasBranchAccess(userBangalore, "branch_blr"), true);
  assert.equal(hasBranchAccess(userBangalore, "branch_mys"), false, "Bangalore user cannot access Mysore branch");
  assert.equal(hasBranchAccess(userBangalore, "branch_main"), false, "Bangalore user cannot access Main branch");

  // Mysore user assertions
  assert.equal(hasBranchAccess(userMysore, "branch_mys"), true);
  assert.equal(hasBranchAccess(userMysore, "branch_blr"), false, "Mysore user cannot access Bangalore branch");
  assert.equal(hasBranchAccess(userMysore, "branch_main"), false, "Mysore user cannot access Main branch");
});

test("Strict Branch Isolation: Dashboard & Reports metrics isolate operational records per branch", () => {
  const sampleInvoices = [
    {
      id: "inv_blr_1",
      number: "INV-BLR-001",
      branchId: "branch_blr",
      grandTotal: 10000,
      subtotal: 10000,
      discountTotal: 0,
      gstTotal: 1800,
      balance: 0,
      amountPaid: 10000,
      status: "paid",
      postingStatus: "posted",
      date: 1775000000000,
      items: [{ productId: "p1", quantity: 1, rate: 10000, total: 10000 }]
    },
    {
      id: "inv_mys_1",
      number: "INV-MYS-001",
      branchId: "branch_mys",
      grandTotal: 25000,
      subtotal: 25000,
      discountTotal: 0,
      gstTotal: 4500,
      balance: 25000,
      amountPaid: 0,
      status: "unpaid",
      postingStatus: "posted",
      date: 1775000000000,
      items: [{ productId: "p2", quantity: 2, rate: 12500, total: 25000 }]
    }
  ];

  const branches = [
    { id: "branch_blr", name: "Bangalore Branch", isMain: false },
    { id: "branch_mys", name: "Mysore Branch", isMain: false },
  ];

  // 1. Bangalore Branch View
  const blrMetrics = computeDashboardMetrics({
    invoices: sampleInvoices,
    purchases: [],
    products: [],
    receipts: [],
    payments: [],
    salesReturns: [],
    branches,
    branchId: "branch_blr",
  });

  assert.equal(blrMetrics.totalSales, 10000, "Bangalore total sales must be 10,000");
  assert.equal(blrMetrics.totalReceivables, 0, "Bangalore receivables must be 0");

  // 2. Mysore Branch View
  const mysMetrics = computeDashboardMetrics({
    invoices: sampleInvoices,
    purchases: [],
    products: [],
    receipts: [],
    payments: [],
    salesReturns: [],
    branches,
    branchId: "branch_mys",
  });

  assert.equal(mysMetrics.totalSales, 25000, "Mysore total sales must be 25,000");
  assert.equal(mysMetrics.totalReceivables, 25000, "Mysore receivables must be 25,000");

  // 3. Consolidated View (All Branches)
  const consolidatedMetrics = computeDashboardMetrics({
    invoices: sampleInvoices,
    purchases: [],
    products: [],
    receipts: [],
    payments: [],
    salesReturns: [],
    branches,
    branchId: "all",
  });

  assert.equal(consolidatedMetrics.totalSales, 35000, "Consolidated total sales must be 35,000");
  assert.equal(consolidatedMetrics.totalReceivables, 25000, "Consolidated total receivables must be 25,000");
  assert.equal(consolidatedMetrics.branchMetrics?.length, 2, "Consolidated view must list both branches without duplicating");
});

test("Strict Branch Isolation: Operational records without branchId do not bleed across branches", () => {
  const isolatedInvoices = [
    {
      id: "inv_legacy",
      number: "INV-LEGACY",
      branchId: "branch_main",
      grandTotal: 5000,
      subtotal: 5000,
      discountTotal: 0,
      gstTotal: 900,
      balance: 0,
      status: "paid",
      postingStatus: "posted",
      date: 1775000000000,
      items: []
    }
  ];

  // Scoped to Bangalore branch
  const blrMetrics = computeDashboardMetrics({
    invoices: isolatedInvoices,
    purchases: [],
    products: [],
    receipts: [],
    payments: [],
    salesReturns: [],
    branches: [{ id: "branch_blr", name: "Bangalore", isMain: false }],
    branchId: "branch_blr",
  });

  assert.equal(blrMetrics.totalSales, 0, "Main branch records must not appear in Bangalore metrics");
});
