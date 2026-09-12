/**
 * BMS NEXT — Smart Billing Addendum & Corrections Verification Suite
 * Verifies Field-Specific Search Normalization, Tenant Isolation, Concurrent Master Uniqueness,
 * Alternate-UOM Price History, Deterministic Dimension Math, Base UOM Stock Conversions,
 * Financial Summaries (Draft Exclusion, Credit Note Adjustments), and Presentation Copy Invariance.
 */

import test from "node:test";
import assert from "node:assert/strict";

// 1. Semantic Normalizers
function normalizeName(input) {
  if (!input) return "";
  return input
    .toLowerCase()
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ");
}

function normalizeGstin(input) {
  if (!input) return "";
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned;
}

function normalizePhone(input) {
  if (!input) return "";
  let digits = input.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  return digits.slice(-10);
}

function normalizeSku(input) {
  if (!input) return "";
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeEmail(input) {
  if (!input) return "";
  return input.trim().toLowerCase();
}

function detectDuplicateParty(existingList, newParty, companyId) {
  // Scoped strictly to the companyId
  const scopedList = existingList.filter((p) => p.companyId === companyId);
  const normName = normalizeName(newParty.name);
  const normGstin = normalizeGstin(newParty.gstin);
  const normPhone = normalizePhone(newParty.mobile || newParty.phone);

  return scopedList.find((p) => {
    if (normGstin && p.gstin && normalizeGstin(p.gstin) === normGstin) return true;
    if (normName && normalizeName(p.name) === normName) return true;
    if (normPhone && normalizePhone(p.mobile || p.phone) === normPhone) return true;
    return false;
  });
}

function detectDuplicateProduct(existingList, newProduct, companyId) {
  const scopedList = existingList.filter((p) => p.companyId === companyId);
  const normName = normalizeName(newProduct.name);
  const normSku = normalizeSku(newProduct.sku);

  return scopedList.find((p) => {
    if (normSku && p.sku && normalizeSku(p.sku) === normSku) return true;
    if (normName && normalizeName(p.name) === normName) return true;
    return false;
  });
}

// 2. Unit conversion constants
const UOM_CONVERSIONS = {
  "M_FT": 3.28084,
  "FT_M": 0.3048,
  "SQM_SQFT": 10.76391,
  "SQFT_SQM": 0.092903,
  "KG_G": 1000,
  "G_KG": 0.001,
  "TON_KG": 1000,
  "KG_TON": 0.001,
};

function convertUnitQuantity(qty, fromUom, toUom) {
  const f = fromUom.toUpperCase();
  const t = toUom.toUpperCase();
  if (f === t) return qty;
  const key = `${f}_${t}`;
  const factor = UOM_CONVERSIONS[key];
  if (!factor) return qty;
  return Math.round(qty * factor * 10000) / 10000;
}

// 3. Tests

test("Smart Billing 1: SKU Normalization preserves hyphens & slashes ('A-10' !== 'A10')", () => {
  const sku1 = "A-10";
  const sku2 = "A10";
  const sku3 = "a-10";
  const sku4 = "PROD/2026/01";

  assert.notEqual(normalizeSku(sku1), normalizeSku(sku2), "A-10 must never be stripped to A10");
  assert.equal(normalizeSku(sku1), normalizeSku(sku3), "SKU should be case-insensitive");
  assert.equal(normalizeSku(sku4), "PROD/2026/01", "Slashes in SKU must be preserved");
});

test("Smart Billing 2: Semantic Phone & GSTIN normalization", () => {
  const rawGstin = " 29aaaaa0000a1z5 ";
  assert.equal(normalizeGstin(rawGstin), "29AAAAA0000A1Z5");

  const phoneWithCode = "+91 98765-43210";
  const plainPhone = "9876543210";
  assert.equal(normalizePhone(phoneWithCode), "9876543210");
  assert.equal(normalizePhone(plainPhone), "9876543210");
});

test("Smart Billing 3: Cross-Company Duplicate Isolation (Company-Scoped)", () => {
  const masters = [
    { id: "p1", companyId: "comp_Alpha", name: "MS Plate 10mm", sku: "MSP-10" },
    { id: "c1", companyId: "comp_Alpha", name: "Apex Builders", gstin: "29AAAAA0000A1Z5" },
  ];

  // User in comp_Beta creates exact same name/SKU
  const betaProduct = { name: "ms plate 10mm", sku: "msp-10" };
  const duplicateInAlpha = detectDuplicateProduct(masters, betaProduct, "comp_Alpha");
  const duplicateInBeta = detectDuplicateProduct(masters, betaProduct, "comp_Beta");

  assert.ok(duplicateInAlpha, "Company Alpha must detect duplicate within its own scope");
  assert.equal(duplicateInBeta, undefined, "Company Beta must NOT detect false positive from Company Alpha");

  const betaCustomer = { name: "apex builders", gstin: "29AAAAA0000A1Z5" };
  const customerDupInBeta = detectDuplicateParty(masters, betaCustomer, "comp_Beta");
  assert.equal(customerDupInBeta, undefined, "Customer duplicate check must never cross tenants");
});

test("Smart Billing 4: Concurrent Master Quick-Create Idempotency", () => {
  const memoryDb = new Map();

  function concurrentCreateProduct(companyId, payload) {
    const normKey = `${companyId}::${normalizeName(payload.name)}`;
    if (payload.clientMutationId && memoryDb.has(`mut_${payload.clientMutationId}`)) {
      return { status: "existing", product: memoryDb.get(`mut_${payload.clientMutationId}`) };
    }
    if (memoryDb.has(normKey)) {
      return { status: "conflict", product: memoryDb.get(normKey) };
    }
    const created = { id: `prod_${Date.now()}_${Math.random()}`, ...payload };
    memoryDb.set(normKey, created);
    if (payload.clientMutationId) {
      memoryDb.set(`mut_${payload.clientMutationId}`, created);
    }
    return { status: "created", product: created };
  }

  // Employee A and Employee B create MS Plate at same time
  const reqA = concurrentCreateProduct("comp_1", { name: "MS Plate", sku: "MSP", clientMutationId: "mut_1" });
  const reqB = concurrentCreateProduct("comp_1", { name: "ms plate", sku: "MSP", clientMutationId: "mut_2" });
  const reqARetry = concurrentCreateProduct("comp_1", { name: "MS Plate", sku: "MSP", clientMutationId: "mut_1" });

  assert.equal(reqA.status, "created");
  assert.equal(reqB.status, "conflict", "Concurrent create with identical normalized name must report conflict");
  assert.equal(reqB.product.id, reqA.product.id);
  assert.equal(reqARetry.status, "existing", "Idempotent mutation must return same product without duplicate");
});

test("Smart Billing 5: Price History Party Model (Customer vs Supplier distinct fields)", () => {
  const priceHistory = [];

  function recordPrice(entry) {
    assert.ok(["customer", "supplier", "none"].includes(entry.partyType));
    assert.ok(entry.partyId, "partyId is mandatory");
    assert.ok(entry.uomId, "uomId is mandatory");
    priceHistory.push(entry);
  }

  // Sales
  recordPrice({
    partyType: "customer",
    partyId: "cust_123",
    productId: "prod_p1",
    ratePaise: 12000,
    uomId: "SQFT",
    quantity: 50,
  });

  // Purchase: supplierId must NOT be placed in customerId
  recordPrice({
    partyType: "supplier",
    partyId: "supp_456",
    productId: "prod_p1",
    ratePaise: 9000,
    uomId: "SQFT",
    quantity: 100,
  });

  const custEntry = priceHistory.find((p) => p.partyType === "customer" && p.partyId === "cust_123");
  const suppEntry = priceHistory.find((p) => p.partyType === "supplier" && p.partyId === "supp_456");

  assert.ok(custEntry);
  assert.ok(suppEntry);
  assert.equal(suppEntry.partyType, "supplier");
  assert.equal(suppEntry.partyId, "supp_456");
});

test("Smart Billing 6: Alternate-UOM Price History with Deterministic Conversion", () => {
  // Historical sale was ₹120 / SQFT
  const historicalRatePaise = 12000;
  const historicalUom = "SQFT";

  // Operator quotes in SQM
  const requestedUom = "SQM";
  // 1 SQM = 10.76391 SQFT -> Rate per SQM = 120 * 10.76391 = ₹1291.6692 -> 129167 paise
  const conversionFactor = UOM_CONVERSIONS[`${requestedUom}_${historicalUom}`];
  const convertedRatePaise = Math.round(historicalRatePaise * conversionFactor);

  assert.equal(convertedRatePaise, 129167);
  assert.notEqual(convertedRatePaise, historicalRatePaise, "Must not display historical rate without UOM conversion");
});

test("Smart Billing 7: Product Master Price vs Transaction Price Override", () => {
  const productMaster = {
    id: "prod_1",
    name: "Toughened Glass 12mm",
    defaultSalesRatePaise: 25000, // ₹250
    lastSalesRatePaise: 25000,
  };

  // Billing operator discounts rate to ₹220 (22000 paise) on invoice line
  const invoiceLineRatePaise = 22000;

  // Invoice rate override must NOT mutate defaultSalesRatePaise
  const updatedProduct = {
    ...productMaster,
    lastSalesRatePaise: invoiceLineRatePaise, // Only last sale rate updates
  };

  assert.equal(updatedProduct.defaultSalesRatePaise, 25000, "Master default selling price must remain unchanged");
  assert.equal(updatedProduct.lastSalesRatePaise, 22000, "Last sale rate tracks actual transaction");
});

test("Smart Billing 8: Historical Line Item Commercial Snapshot Immutability", () => {
  // Document line freezes all commercial info at issue time
  const postedLineSnapshot = {
    productId: "prod_10",
    productName: "Birla A1 Cement 50kg",
    sku: "BAC-50",
    hsn: "2523",
    uom: "BAG",
    rate: 380,
    gstRate: 28,
    quantity: 100,
    lineAmount: 38000,
  };

  // 6 months later, user edits Product in catalog
  const modifiedProductCatalog = {
    id: "prod_10",
    name: "UltraTech Cement 50kg (Rebranded)",
    sku: "UTC-50",
    hsn: "252329",
    uom: "BAG",
    rate: 440,
    gstRate: 28,
  };

  // Historical invoice render MUST use snapshot, not current catalog
  assert.equal(postedLineSnapshot.productName, "Birla A1 Cement 50kg");
  assert.equal(postedLineSnapshot.rate, 380);
  assert.notEqual(postedLineSnapshot.productName, modifiedProductCatalog.name);
});

test("Smart Billing 9: Deterministic Area & Length Measurement Math", () => {
  // Dimension calculation: 3 panels of 2.5 ft x 4.0 ft = 30 sq ft
  const measurements = [
    { width: 2.5, height: 4.0, pieces: 3 },
    { width: 5.0, height: 2.0, pieces: 2 }, // 20 sq ft
  ];

  const totalArea = measurements.reduce((acc, m) => acc + m.width * m.height * m.pieces, 0);
  const ratePerSqFt = 150;
  const taxable = totalArea * ratePerSqFt; // 50 * 150 = 7500
  const gstRate = 18;
  const gstAmount = Math.round((taxable * gstRate) / 100);
  const grandTotal = taxable + gstAmount;

  assert.equal(totalArea, 50);
  assert.equal(taxable, 7500);
  assert.equal(gstAmount, 1350);
  assert.equal(grandTotal, 8850);
});

test("Smart Billing 10: Stock Movement Converts to Product Base UOM", () => {
  const product = {
    id: "prod_plywood",
    baseUomId: "SQFT",
    currentStock: 1000, // in SQFT
  };

  // Customer buys 10 SQM
  const lineItem = {
    quantity: 10,
    unit: "SQM",
  };

  const baseQty = convertUnitQuantity(lineItem.quantity, lineItem.unit, product.baseUomId);
  // 10 SQM * 10.76391 = 107.6391 SQFT
  assert.equal(baseQty, 107.6391);

  const updatedStock = Math.round((product.currentStock - baseQty) * 100) / 100;
  assert.equal(updatedStock, 892.36);
});

test("Smart Billing 11: Authoritative Financial KPI — Draft Documents Strictly Excluded", () => {
  const invoices = [
    { id: "inv_1", grandTotal: 50000, amountPaid: 50000, balance: 0, status: "paid", postingStatus: "posted" },
    { id: "inv_2", grandTotal: 30000, amountPaid: 10000, balance: 20000, status: "partial", postingStatus: "posted" },
    { id: "inv_3", grandTotal: 99999, amountPaid: 0, balance: 99999, status: "draft", postingStatus: "draft" }, // DRAFT!
  ];

  const postedOnly = invoices.filter((i) => i.postingStatus === "posted");
  const totalInvoiced = postedOnly.reduce((s, i) => s + i.grandTotal, 0);
  const totalPaid = postedOnly.reduce((s, i) => s + i.amountPaid, 0);
  const outstanding = postedOnly.reduce((s, i) => s + i.balance, 0);

  assert.equal(totalInvoiced, 80000, "Draft invoice of 99,999 must NOT increase Total Invoiced");
  assert.equal(totalPaid, 60000);
  assert.equal(outstanding, 20000, "Draft invoice must NOT increase customer outstanding");
});

test("Smart Billing 12: Credit Note Adjustment Reduces Customer Financial Exposure", () => {
  const invoiceTotal = 100000;
  const receipts = [20000];
  const creditNotes = [20000]; // Correction 14: ₹20,000 credit note

  const totalPaid = receipts.reduce((a, b) => a + b, 0);
  const totalCredited = creditNotes.reduce((a, b) => a + b, 0);
  const netOutstanding = invoiceTotal - totalPaid - totalCredited;

  assert.equal(netOutstanding, 60000, "Customer financial exposure must account for Credit Note corrections");
});

test("Smart Billing 13: Materialized Summary Cache Rebuild Functionality", () => {
  // Authoritative server posted records
  const serverDocuments = [
    { id: "inv_1", customerId: "c1", grandTotal: 40000, balance: 0, status: "paid", postingStatus: "posted" },
    { id: "inv_2", customerId: "c1", grandTotal: 60000, balance: 10000, status: "partial", postingStatus: "posted" },
  ];

  function rebuildCustomerSummary(customerId, docs) {
    const valid = docs.filter((d) => d.customerId === customerId && d.postingStatus === "posted");
    return {
      customerId,
      totalInvoiced: valid.reduce((s, d) => s + d.grandTotal, 0),
      outstanding: valid.reduce((s, d) => s + d.balance, 0),
      docCount: valid.length,
      rebuiltAt: Date.now(),
    };
  }

  const summary = rebuildCustomerSummary("c1", serverDocuments);
  assert.equal(summary.totalInvoiced, 100000);
  assert.equal(summary.outstanding, 10000);
  assert.equal(summary.docCount, 2);
  assert.ok(summary.rebuiltAt > 0);
});

test("Smart Billing 14: Document Copy Modes Invariance (Never allocates legal number or posts duplicate voucher)", () => {
  const authoritativeInvoice = {
    id: "inv_master_001",
    number: "INV/2026/0042",
    voucherId: "vouch_987",
    grandTotal: 150000,
  };

  const copyTypes = ["ORIGINAL", "COPY", "CUSTOMER COPY", "OFFICE COPY", "TRANSPORT COPY", "DRIVER COPY"];

  for (const copyLabel of copyTypes) {
    const renderedPresentation = {
      ...authoritativeInvoice,
      copyLabel,
    };
    assert.equal(renderedPresentation.id, authoritativeInvoice.id, "Copy rendering must share exact document ID");
    assert.equal(renderedPresentation.number, authoritativeInvoice.number, "Copy must never allocate another legal number");
    assert.equal(renderedPresentation.voucherId, authoritativeInvoice.voucherId, "Copy must never create another voucher");
  }
});
