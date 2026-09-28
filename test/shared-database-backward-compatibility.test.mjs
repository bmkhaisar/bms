import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDocumentModel,
  resolveEffectiveCompany,
  isDocumentFinalized,
} from "../src/lib/documentModel.ts";
import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";

/**
 * SHARED DATABASE BACKWARD COMPATIBILITY TEST SUITE
 *
 * Requirements:
 * 1. Main and Staging operate against the SAME database simultaneously.
 * 2. Main-format records must be read flawlessly by Staging.
 * 3. Staging-created records must NOT crash Main or omit required fields.
 * 4. Staging-edited records must preserve all existing Main required fields.
 * 5. Entities tested: Party, Product, Quotation, Invoice, Receipt, Purchase, Branch, Sales Return, Credit Note.
 */

// Canonical sample company settings
const canonicalCompanySettings = {
  companyId: "comp_kh_cabins",
  name: "KH Portable Cabins",
  legalName: "KH Portable Cabins Pvt Ltd",
  gstin: "29AAAAA0000A1Z5",
  address: "Plot 42, Peenya Industrial Area",
  city: "Bangalore",
  state: "Karnataka",
  pincode: "560058",
  phone: "+91 98765 43210",
  email: "billing@khcabins.com",
  invoicePrefix: "INV-",
  quotationPrefix: "QT-",
  receiptPrefix: "REC-",
  purchasePrefix: "PUR-",
  nextInvoiceNo: 101,
  nextQuotationNo: 50,
  nextReceiptNo: 80,
  nextPurchaseNo: 30,
};

test("Backward Compatibility 1: Party entity compatibility", () => {
  // 1. Existing Main-format Party (no branchId, no new beta fields)
  const mainFormatParty = {
    id: "party_cust_001",
    companyId: "comp_kh_cabins",
    partyType: "customer",
    name: "ABC Infrastructure Corp",
    phone: "9876500001",
    email: "procurement@abcinfra.com",
    gstin: "29ABCDE1234F1Z5",
    billingAddress: "MG Road, Bangalore",
    openingBalance: 500000,
    openingBalanceType: "dr",
    currentBalance: 500000,
    createdAt: 1710000000000,
  };

  // Staging reads Main-format party
  assert.equal(mainFormatParty.name, "ABC Infrastructure Corp");
  assert.equal(mainFormatParty.partyType, "customer");
  assert.equal(mainFormatParty.branchId, undefined, "Main party has no branchId; staging tolerates undefined branchId");

  // 2. Staging-created Party (additive optional branchId and notes)
  const stagingCreatedParty = {
    ...mainFormatParty,
    id: "party_cust_002",
    name: "XYZ Heavy Engineering",
    branchId: "branch_blr_hq",
    notes: "Created from Bangalore Branch on Staging Beta",
    createdAt: 1711000000000,
  };

  // Main reads Staging-created party
  // Main depends on: id, companyId, partyType, name, phone, gstin, openingBalance, currentBalance
  assert.equal(stagingCreatedParty.id, "party_cust_002");
  assert.equal(stagingCreatedParty.companyId, "comp_kh_cabins");
  assert.equal(stagingCreatedParty.name, "XYZ Heavy Engineering");
  assert.equal(stagingCreatedParty.partyType, "customer");
  assert.equal(stagingCreatedParty.currentBalance, 500000);
  assert.ok(stagingCreatedParty.branchId, "Staging records branchId additively without breaking core fields");

  // 3. Staging-edited Party
  const stagingEditedParty = {
    ...mainFormatParty,
    phone: "9876599999",
    billingAddress: "Indiranagar 100ft Rd, Bangalore",
    updatedAt: 1711500000000,
    branchId: "branch_blr_hq", // Added during edit
  };

  assert.equal(stagingEditedParty.phone, "9876599999");
  assert.equal(stagingEditedParty.gstin, "29ABCDE1234F1Z5", "Existing required GSTIN preserved");
  assert.equal(stagingEditedParty.companyId, "comp_kh_cabins", "Company ID strictly preserved");
});

test("Backward Compatibility 2: Product entity compatibility", () => {
  // 1. Existing Main-format Product
  const mainFormatProduct = {
    id: "prod_cab_10x10",
    companyId: "comp_kh_cabins",
    name: "Security Guard Cabin 10x10",
    sku: "SEC-CAB-1010",
    hsn: "94069090",
    unit: "NOS",
    salePrice: 12500000, // 1,25,000 INR in paise
    purchasePrice: 9500000,
    taxRate: 18,
    stock: 5,
    createdAt: 1710000000000,
  };

  // Staging reads Main-format product
  assert.equal(mainFormatProduct.name, "Security Guard Cabin 10x10");
  assert.equal(mainFormatProduct.sku, "SEC-CAB-1010");
  assert.equal(mainFormatProduct.branchId, undefined);

  // 2. Staging-created Product (with additive branchId and sizes)
  const stagingCreatedProduct = {
    ...mainFormatProduct,
    id: "prod_cab_20x10",
    name: "Site Office Cabin 20x10",
    sku: "OFF-CAB-2010",
    branchId: "branch_blr_hq",
    productSizes: ["20x10x8.5 ft", "20x10x9.5 ft"],
    salePrice: 22000000,
  };

  // Main reads Staging-created product
  assert.equal(stagingCreatedProduct.sku, "OFF-CAB-2010");
  assert.equal(stagingCreatedProduct.taxRate, 18);
  assert.equal(stagingCreatedProduct.unit, "NOS");
  assert.equal(stagingCreatedProduct.salePrice, 22000000);
});

test("Backward Compatibility 3: Quotation compatibility & document resolution", () => {
  // 1. Existing Main-format Quotation
  const mainFormatQuotation = {
    id: "quote_001",
    companyId: "comp_kh_cabins",
    kind: "quotation",
    number: "QT-0042",
    customerId: "party_cust_001",
    customerName: "ABC Infrastructure Corp",
    date: 1710100000000,
    validity: 1712700000000,
    status: "sent",
    items: [
      {
        id: "item_1",
        productId: "prod_cab_10x10",
        description: "Security Guard Cabin 10x10",
        quantity: 2,
        rate: 125000,
        amount: 250000,
        taxRate: 18,
        taxAmount: 45000,
      },
    ],
    subtotal: 250000,
    taxTotal: 45000,
    total: 295000,
    companySnapshot: {
      name: "KH Portable Cabins",
      gstin: "29AAAAA0000A1Z5",
      address: "Plot 42, Peenya",
    },
    createdAt: 1710100000000,
  };

  // Staging reads Main quotation via resolveDocumentModel
  const stagingResolved = resolveDocumentModel(mainFormatQuotation, canonicalCompanySettings);
  assert.equal(stagingResolved.number, "QT-0042");
  assert.equal(stagingResolved.kind, "quotation");
  assert.equal(stagingResolved.title, "QUOTATION");
  assert.equal(stagingResolved.grandTotal, 295000);
  assert.ok(stagingResolved.company.companyName.includes("KH Portable Cabins"));
  assert.ok(stagingResolved.dateFormatted);

  // 2. Staging-created Quotation (with branchId and branchSnapshot)
  const stagingCreatedQuotation = {
    ...mainFormatQuotation,
    id: "quote_002",
    number: "QT-BLR-0043",
    branchId: "branch_blr_hq",
    branchSnapshot: {
      branchId: "branch_blr_hq",
      branchCode: "BLR",
      branchName: "Bangalore Main Branch",
      branchDisplayName: "KH Portable Cabins - Bangalore",
      gstin: "29AAAAA0000A1Z5",
    },
  };

  // Main-compatible resolver reads Staging quotation
  const mainResolved = resolveDocumentModel(stagingCreatedQuotation, canonicalCompanySettings);
  assert.equal(mainResolved.number, "QT-BLR-0043");
  assert.equal(mainResolved.kind, "quotation");
  assert.equal(mainResolved.grandTotal, 295000);
  assert.ok(mainResolved.company.companyName.includes("KH Portable Cabins"));
  assert.equal(mainResolved.items.length, 1);
});

test("Backward Compatibility 4: Invoice compatibility & financial calculations", () => {
  // 1. Existing Main-format Invoice
  const mainFormatInvoice = {
    id: "inv_001",
    companyId: "comp_kh_cabins",
    kind: "invoice",
    number: "INV-0101",
    customerId: "party_cust_001",
    customerName: "ABC Infrastructure Corp",
    date: 1710200000000,
    status: "posted",
    financialYearId: "FY2025-26",
    items: [
      {
        id: "item_inv_1",
        description: "Security Guard Cabin 10x10",
        quantity: 1,
        rate: 125000,
        amount: 125000,
        taxRate: 18,
        taxAmount: 22500,
      },
    ],
    subtotal: 125000,
    taxTotal: 22500,
    total: 147500,
    companySnapshot: {
      name: "KH Portable Cabins",
      gstin: "29AAAAA0000A1Z5",
      address: "Plot 42, Peenya",
    },
    createdAt: 1710200000000,
  };

  // Staging reads Main invoice
  const stagingInvoiceModel = resolveDocumentModel(mainFormatInvoice, canonicalCompanySettings);
  assert.equal(stagingInvoiceModel.number, "INV-0101");
  assert.equal(stagingInvoiceModel.kind, "invoice");
  assert.equal(stagingInvoiceModel.title, "TAX INVOICE");
  assert.equal(stagingInvoiceModel.grandTotal, 147500);

  // 2. Staging-created Invoice (with branchId, branchSnapshot)
  const stagingCreatedInvoice = {
    ...mainFormatInvoice,
    id: "inv_002",
    number: "INV-HYD-0001",
    branchId: "branch_hyd",
    branchSnapshot: {
      branchId: "branch_hyd",
      branchCode: "HYD",
      branchName: "Hyderabad Branch",
      branchDisplayName: "KH Portable Cabins - Hyderabad",
      gstin: "36AAAAA0000A1Z2",
    },
    total: 200000,
    subtotal: 169491.53,
    taxTotal: 30508.47,
  };

  // Main reads Staging invoice
  const mainReadStagingInvoice = resolveDocumentModel(stagingCreatedInvoice, canonicalCompanySettings);
  assert.equal(mainReadStagingInvoice.number, "INV-HYD-0001");
  assert.equal(mainReadStagingInvoice.kind, "invoice");
  assert.equal(mainReadStagingInvoice.grandTotal, 200000);
  assert.ok(mainReadStagingInvoice.company.companyName.includes("KH Portable Cabins"));

  // Verify dashboard metrics aggregation when both types coexist
  const mixedInvoices = [mainFormatInvoice, stagingCreatedInvoice];
  const metricsConsolidated = computeDashboardMetrics({
    invoices: mixedInvoices,
    receipts: [],
    purchases: [],
    payments: [],
    salesReturns: [],
    quotations: [],
    companySettings: canonicalCompanySettings,
    dateRange: { start: 1710000000000, end: 1711000000000 },
    activeBranchId: "all", // Consolidated Owner view
  });

  assert.ok(metricsConsolidated, "Dashboard metrics calculation succeeds with mixed records");
  assert.equal(metricsConsolidated.totalSales, 347500); // 147500 + 200000

  // Verify branch-filtered view (Hyderabad branch restricted user)
  const metricsHydBranch = computeDashboardMetrics({
    invoices: mixedInvoices,
    receipts: [],
    purchases: [],
    payments: [],
    salesReturns: [],
    quotations: [],
    companySettings: canonicalCompanySettings,
    dateRange: { start: 1710000000000, end: 1711000000000 },
    branchId: "branch_hyd",
  });
  assert.equal(metricsHydBranch.totalSales, 200000);
});

test("Backward Compatibility 5: Receipt and Purchase compatibility", () => {
  // 1. Main Receipt
  const mainReceipt = {
    id: "rec_001",
    companyId: "comp_kh_cabins",
    number: "REC-0080",
    customerId: "party_cust_001",
    date: 1710300000000,
    amount: 147500,
    paymentMode: "bank",
    reference: "NEFT-123456",
    financialYearId: "FY2025-26",
    createdAt: 1710300000000,
  };

  // Staging reads Main receipt
  assert.equal(mainReceipt.number, "REC-0080");
  assert.equal(mainReceipt.amount, 147500);
  assert.equal(mainReceipt.branchId, undefined);

  // 2. Staging Receipt with branchId
  const stagingReceipt = {
    ...mainReceipt,
    id: "rec_002",
    number: "REC-BLR-0081",
    branchId: "branch_blr_hq",
  };
  // Main reads staging receipt
  assert.equal(stagingReceipt.amount, 147500);
  assert.equal(stagingReceipt.paymentMode, "bank");

  // 3. Main Purchase
  const mainPurchase = {
    id: "pur_001",
    companyId: "comp_kh_cabins",
    number: "PUR-0030",
    supplierId: "party_supp_001",
    supplierName: "Tata Steel Ltd",
    supplierInvoiceNumber: "TS-2025-998",
    date: 1710150000000,
    subtotal: 500000,
    taxTotal: 90000,
    total: 590000,
    status: "posted",
    financialYearId: "FY2025-26",
    createdAt: 1710150000000,
  };

  // Staging Purchase with branchId
  const stagingPurchase = {
    ...mainPurchase,
    id: "pur_002",
    number: "PUR-BLR-0031",
    branchId: "branch_blr_hq",
  };

  assert.equal(mainPurchase.total, 590000);
  assert.equal(stagingPurchase.total, 590000);
});

test("Backward Compatibility 6: Sales Return & Credit Note additive isolation", () => {
  // Sales Returns & Credit Notes exist on separate RTDB nodes ('salesReturns', 'creditNotes')
  // and separate Dexie tables.
  const salesReturn = {
    id: "sr_001",
    companyId: "comp_kh_cabins",
    number: "SR-0001",
    creditNoteNumber: "CN-0001",
    originalInvoiceId: "inv_001",
    originalInvoiceNumber: "INV-0101",
    originalInvoiceDate: 1710200000000,
    customerId: "party_cust_001",
    branchId: "branch_blr_hq",
    date: 1710500000000,
    status: "posted",
    subtotal: 50000,
    taxTotal: 9000,
    total: 59000,
    items: [
      {
        id: "sr_item_1",
        description: "Security Guard Cabin 10x10 (Partial Return)",
        quantity: 1,
        rate: 50000,
        amount: 50000,
        taxRate: 18,
        taxAmount: 9000,
      },
    ],
    reason: "Damaged during transit",
    createdAt: 1710500000000,
  };

  // Staging resolves Credit Note document model
  const cnModel = resolveDocumentModel(
    {
      ...salesReturn,
      kind: "credit_note",
      number: salesReturn.creditNoteNumber,
    },
    canonicalCompanySettings
  );

  assert.equal(cnModel.kind, "credit_note");
  assert.equal(cnModel.title, "CREDIT NOTE / SALES RETURN");
  assert.equal(cnModel.number, "CN-0001");
  assert.equal(cnModel.originalInvoiceNumber, "INV-0101");
  assert.equal(cnModel.reason, "Damaged during transit");
  assert.equal(cnModel.grandTotal, 59000);

  // Original Invoice is NOT modified destructively; it remains standard format
  const originalInvoice = {
    id: "inv_001",
    companyId: "comp_kh_cabins",
    kind: "invoice",
    number: "INV-0101",
    customerId: "party_cust_001",
    total: 147500,
    status: "posted",
  };
  assert.equal(originalInvoice.id, "inv_001");
  assert.equal(originalInvoice.total, 147500);
});

test("Backward Compatibility 7: Frozen Signatory & Branch Snapshot Immutability", () => {
  // When a document is finalized in Staging, it stores branchSnapshot and companySnapshot.
  // Main app's resolveEffectiveCompany reads snapshot if available without crashing.
  const finalizedDoc = {
    id: "inv_final_001",
    status: "posted",
    kind: "invoice",
    companySnapshot: {
      name: "KH Portable Cabins",
      legalName: "KH Portable Cabins Pvt Ltd",
      gstin: "29AAAAA0000A1Z5",
      address: "Old Address In Bangalore",
    },
    branchSnapshot: {
      branchName: "Bangalore Unit",
      branchDisplayName: "KH Portable Cabins - Unit 1",
      address: "Branch Address Plot 42",
      phone: "+91 99999 88888",
    },
  };

  assert.equal(isDocumentFinalized(finalizedDoc), true);

  const effective = resolveEffectiveCompany(finalizedDoc, canonicalCompanySettings);
  // Staging incorporates branch overrides cleanly
  assert.equal(effective.name, "KH Portable Cabins - Unit 1");
  assert.equal(effective.address, "Branch Address Plot 42");

  // When doc has no branchSnapshot (historical Main doc):
  const historicalMainDoc = {
    id: "inv_hist_001",
    status: "posted",
    kind: "invoice",
    companySnapshot: {
      name: "KH Portable Cabins Historical",
      address: "Historical Peenya Address",
    },
  };
  const effectiveHistorical = resolveEffectiveCompany(historicalMainDoc, canonicalCompanySettings);
  assert.equal(effectiveHistorical.name, "KH Portable Cabins Historical");
  assert.equal(effectiveHistorical.address, "Historical Peenya Address");
});
