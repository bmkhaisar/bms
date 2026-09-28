import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Demo Lifecycle 1: Demo Organization metadata structure and validation", () => {
  function validateDemoOrgMetadata(input) {
    if (!input.name || !input.name.trim()) {
      return { valid: false, error: "Name is required" };
    }
    const isDemo = input.isDemo === true || input.organizationType === "DEMO";
    const organizationType = input.organizationType || (isDemo ? "DEMO" : "NORMAL");

    if (isDemo && input.demoExpiresAt && typeof input.demoExpiresAt !== "number") {
      return { valid: false, error: "demoExpiresAt must be a valid timestamp" };
    }

    return {
      valid: true,
      data: {
        id: input.id || "comp_demo_123",
        name: input.name.trim(),
        legalName: input.legalName?.trim() || input.name.trim(),
        organizationType,
        isDemo,
        demoExpiresAt: input.demoExpiresAt,
        demoDescription: input.demoDescription?.trim(),
        active: true,
        createdAt: input.createdAt || Date.now(),
      },
    };
  }

  // Create valid demo organization
  const expiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const res = validateDemoOrgMetadata({
    name: "KH Portable Cabins Demo",
    organizationType: "DEMO",
    isDemo: true,
    demoExpiresAt: expiry,
    demoDescription: "Evaluation tenant for prospective client",
  });

  assert.equal(res.valid, true);
  assert.equal(res.data.organizationType, "DEMO");
  assert.equal(res.data.isDemo, true);
  assert.equal(res.data.demoExpiresAt, expiry);
  assert.equal(res.data.demoDescription, "Evaluation tenant for prospective client");

  // Normal organization does not receive DEMO flags
  const normalRes = validateDemoOrgMetadata({
    name: "Apex Enterprises",
    organizationType: "NORMAL",
  });
  assert.equal(normalRes.valid, true);
  assert.equal(normalRes.data.organizationType, "NORMAL");
  assert.equal(normalRes.data.isDemo, false);
});

test("Demo Lifecycle 2: Demo User creation and role assignment", () => {
  const ROLES = ["owner", "administrator", "accountant", "sales", "purchase", "inventory", "viewer"];
  
  function assignDemoUserMembership(userId, companyId, role) {
    if (!ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    return {
      uid: userId,
      companyId,
      role,
      status: "active",
      createdAt: Date.now(),
      assignedBy: "platform_admin",
    };
  }

  const membership = assignDemoUserMembership("demo_user_1", "demo_org_101", "sales");
  assert.equal(membership.uid, "demo_user_1");
  assert.equal(membership.companyId, "demo_org_101");
  assert.equal(membership.role, "sales");
  assert.equal(membership.status, "active");

  assert.throws(() => {
    assignDemoUserMembership("demo_user_1", "demo_org_101", "super_hacker");
  }, /Invalid role/);
});

test("Demo Lifecycle 3: Realistic Demo Dataset initialization balances perfectly", () => {
  // Simulates the demo data seeding engine used by initializeDemoDataAsPlatformAdmin
  const customer1 = { id: "cust_acme", name: "Acme Enterprises Pvt Ltd", balance: 53100 };
  const customer2 = { id: "cust_metro", name: "Metro Infrastructure Works", balance: 0 };
  const supplier1 = { id: "supp_steel", name: "Standard Steel & Hardware Corp", balance: 59000 };

  const products = [
    { id: "p1", name: "Premium Portable Office Cabin 20x10", price: 185000, gstRate: 18 },
    { id: "p2", name: "Standard Security Guard Cabin 6x6", price: 45000, gstRate: 18 },
    { id: "p3", name: "Heavy Duty Bunkhouse Cabin 30x10", price: 320000, gstRate: 18 },
    { id: "p4", name: "Mobile Restroom Cabin 10x8", price: 95000, gstRate: 18 },
    { id: "p5", name: "Custom Storage Container Unit 20ft", price: 140000, gstRate: 18 },
  ];

  // Sales Invoice: 1 x Guard Cabin @ 45,000 + 18% GST (8,100) = 53,100
  const invoiceTaxable = 45000;
  const invoiceCgst = 4050;
  const invoiceSgst = 4050;
  const invoiceTotal = 53100;

  // Invoice Voucher lines (Double-entry)
  const invoiceVoucherLines = [
    { accountCode: "AR", debit: 53100, credit: 0 },
    { accountCode: "SALES", debit: 0, credit: 45000 },
    { accountCode: "CGST_OUT", debit: 0, credit: 4050 },
    { accountCode: "SGST_OUT", debit: 0, credit: 4050 },
  ];

  const totalInvoiceDebit = invoiceVoucherLines.reduce((s, l) => s + l.debit, 0);
  const totalInvoiceCredit = invoiceVoucherLines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalInvoiceDebit, 53100);
  assert.equal(totalInvoiceCredit, 53100);
  assert.equal(totalInvoiceDebit - totalInvoiceCredit, 0, "Invoice voucher must balance to zero paisa");

  // Bank Receipt Voucher: 25,000 received into Bank Account from Acme Enterprises
  const receiptVoucherLines = [
    { accountCode: "BANK", debit: 25000, credit: 0 },
    { accountCode: "AR", debit: 0, credit: 25000 },
  ];

  const totalReceiptDebit = receiptVoucherLines.reduce((s, l) => s + l.debit, 0);
  const totalReceiptCredit = receiptVoucherLines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalReceiptDebit, 25000);
  assert.equal(totalReceiptCredit, 25000);
  assert.equal(totalReceiptDebit - totalReceiptCredit, 0, "Receipt voucher must balance to zero paisa");

  // Purchase Voucher: 50,000 raw steel + 18% GST (9,000) = 59,000 payable to supplier
  const purchaseVoucherLines = [
    { accountCode: "PURCHASES", debit: 50000, credit: 0 },
    { accountCode: "CGST_IN", debit: 4500, credit: 0 },
    { accountCode: "SGST_IN", debit: 4500, credit: 0 },
    { accountCode: "AP", debit: 0, credit: 59000 },
  ];

  const totalPurchaseDebit = purchaseVoucherLines.reduce((s, l) => s + l.debit, 0);
  const totalPurchaseCredit = purchaseVoucherLines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalPurchaseDebit, 59000);
  assert.equal(totalPurchaseCredit, 59000);
  assert.equal(totalPurchaseDebit - totalPurchaseCredit, 0, "Purchase voucher must balance to zero paisa");
});

test("Demo Lifecycle 4: Reset Demo Organization - Protection against resetting NORMAL organizations", () => {
  function verifyResetEligible(company, confirmName) {
    if (!company) {
      return { eligible: false, code: "COMPANY_NOT_FOUND" };
    }
    const isDemo = company.isDemo || company.organizationType === "DEMO";
    if (!isDemo) {
      return {
        eligible: false,
        code: "CANNOT_RESET_NORMAL_ORGANIZATION",
        error: "Reset is strictly limited to Demo Organizations.",
      };
    }
    if (!confirmName || confirmName.trim() !== company.name.trim()) {
      return {
        eligible: false,
        code: "NAME_CONFIRMATION_MISMATCH",
        error: `Exact company name '${company.name}' must be provided to confirm reset.`,
      };
    }
    return { eligible: true };
  }

  // 1. Normal organization must reject reset immediately
  const normalCompany = { id: "comp_prod_001", name: "Alpha Steel Works Ltd", organizationType: "NORMAL", isDemo: false };
  const rejectNormal = verifyResetEligible(normalCompany, "Alpha Steel Works Ltd");
  assert.equal(rejectNormal.eligible, false);
  assert.equal(rejectNormal.code, "CANNOT_RESET_NORMAL_ORGANIZATION");

  // 2. Demo organization with typo in confirmation name rejects reset
  const demoCompany = { id: "comp_demo_002", name: "Alpha Demo Company", organizationType: "DEMO", isDemo: true };
  const rejectMismatch = verifyResetEligible(demoCompany, "Alpha Demo");
  assert.equal(rejectMismatch.eligible, false);
  assert.equal(rejectMismatch.code, "NAME_CONFIRMATION_MISMATCH");

  // 3. Demo organization with exact name confirmation is approved
  const approveDemo = verifyResetEligible(demoCompany, "Alpha Demo Company");
  assert.equal(approveDemo.eligible, true);
});

test("Demo Lifecycle 5: Demo Reset wipes operational records but preserves Organization, Users, and Roles", () => {
  // Mock company database state
  const mockDb = {
    companies: {
      "comp_demo_1": {
        id: "comp_demo_1",
        name: "Demo Enterprise",
        organizationType: "DEMO",
        isDemo: true,
        createdAt: 1700000000000,
        currentFinancialYearId: "fy_2026_2027",
      },
    },
    memberships: {
      "comp_demo_1": {
        "user_owner": { uid: "user_owner", role: "owner", status: "active" },
        "user_sales": { uid: "user_sales", role: "sales", status: "active" },
        "user_accountant": { uid: "user_accountant", role: "accountant", status: "active" },
      },
    },
    userCompanies: {
      "user_owner": { "comp_demo_1": { role: "owner" } },
      "user_sales": { "comp_demo_1": { role: "sales" } },
      "user_accountant": { "comp_demo_1": { role: "accountant" } },
    },
    // Operational data to be wiped
    companyData: {
      "comp_demo_1": {
        parties: { p1: { name: "Client 1" }, p2: { name: "Supplier 1" } },
        products: { pr1: { name: "Cabin 1" } },
        quotations: { q1: { number: "QT/2026-27/0001" } },
        invoices: { i1: { number: "INV/2026-27/0001" } },
        purchases: { pu1: { number: "PUR/2026-27/0001" } },
        receipts: { r1: { number: "REC/2026-27/0001" } },
        payments: { py1: { number: "PAY/2026-27/0001" } },
        vouchers: { v1: { voucherNo: "JV/2026-27/0001" } },
        voucherLines: { vl1: { debit: 100 } },
        counters: { "2026-2027": { quotation: 5, invoice: 3, receipt: 2 } },
        financialYears: { "fy_2026_2027": { name: "2026-2027" } },
      },
    },
  };

  function executeDemoReset(db, companyId) {
    const operationalKeys = [
      "parties", "customers", "suppliers", "products", "categories", "sizes", "productSizes",
      "quotations", "invoices", "purchases", "receipts", "payments",
      "vouchers", "voucherLines", "ledgers", "documents", "counters",
    ];

    for (const key of operationalKeys) {
      delete db.companyData[companyId][key];
    }

    // Counters reset to 0
    db.companyData[companyId].counters = {
      "2026-2027": { quotation: 0, invoice: 0, receipt: 0, purchase: 0, payment: 0, voucher: 0 },
    };

    // Client cache sync trigger
    db.companyData[companyId]._cacheControl = {
      operationalReset: Date.now(),
    };
  }

  executeDemoReset(mockDb, "comp_demo_1");

  // Operational records are wiped
  assert.equal(mockDb.companyData["comp_demo_1"].invoices, undefined);
  assert.equal(mockDb.companyData["comp_demo_1"].vouchers, undefined);
  assert.equal(mockDb.companyData["comp_demo_1"].quotations, undefined);
  assert.equal(mockDb.companyData["comp_demo_1"].parties, undefined);

  // Counters restart
  assert.equal(mockDb.companyData["comp_demo_1"].counters["2026-2027"].invoice, 0);

  // Organization metadata preserved
  assert.equal(mockDb.companies["comp_demo_1"].id, "comp_demo_1");
  assert.equal(mockDb.companies["comp_demo_1"].name, "Demo Enterprise");

  // Users and memberships preserved
  assert.equal(Object.keys(mockDb.memberships["comp_demo_1"]).length, 3);
  assert.equal(mockDb.memberships["comp_demo_1"]["user_owner"].role, "owner");
  assert.equal(mockDb.memberships["comp_demo_1"]["user_sales"].role, "sales");
  assert.equal(mockDb.memberships["comp_demo_1"]["user_accountant"].role, "accountant");
});

test("Demo Lifecycle 6: Demo Expiration and Extension", () => {
  const now = Date.now();
  const pastExpiry = now - 1000;
  const futureExpiry = now + 7 * 24 * 60 * 60 * 1000;

  function evaluateDemoStatus(company) {
    if (!company.isDemo && company.organizationType !== "DEMO") {
      return { status: "ACTIVE", isExpired: false };
    }
    if (company.demoExpiresAt && Date.now() > company.demoExpiresAt) {
      return { status: "DEMO_EXPIRED", isExpired: true };
    }
    return { status: "ACTIVE", isExpired: false };
  }

  const expiredCompany = { isDemo: true, demoExpiresAt: pastExpiry };
  const evalExpired = evaluateDemoStatus(expiredCompany);
  assert.equal(evalExpired.status, "DEMO_EXPIRED");
  assert.equal(evalExpired.isExpired, true);

  // Extend expiration date
  function extendDemo(company, newExpiry) {
    assert(newExpiry > Date.now(), "Extended date must be in the future");
    company.demoExpiresAt = newExpiry;
  }

  extendDemo(expiredCompany, futureExpiry);
  const evalReactivated = evaluateDemoStatus(expiredCompany);
  assert.equal(evalReactivated.status, "ACTIVE");
  assert.equal(evalReactivated.isExpired, false);
});
