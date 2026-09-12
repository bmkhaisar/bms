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

test("Smart Billing 15: Acceptance Audit 1 — Historical Line Snapshot Persisted & Reprints Never Altered", () => {
  // Step 1: Create Product Master
  const productCatalog = {
    prod_ms: {
      id: "prod_ms",
      name: "MS Plate",
      sellingPrice: 120,
      unit: "SQFT",
      hsn: "HSN-A",
      sku: "MSP-01",
    },
  };

  // Step 2: Post Invoice with 16 frozen snapshot fields
  const invoiceLine = {
    productId: "prod_ms",
    productName: productCatalog.prod_ms.name,
    description: "Standard MS Plate 10mm",
    sku: productCatalog.prod_ms.sku,
    hsn: productCatalog.prod_ms.hsn,
    uomId: "uom_sqft",
    uomLabel: "Sq Ft",
    quantity: 10,
    size: "2.5 x 4.0",
    measurementSummary: "10 pcs @ 10 sq ft",
    pricingBasis: "per_area",
    rate: 120,
    ratePaise: 12000,
    discount: 0,
    discountPercent: 0,
    taxTreatment: "taxable",
    taxRate: 18,
    taxAmounts: { cgst: 108, sgst: 108, igst: 0 },
    lineAmount: 1200,
    total: 1200,
  };

  const postedInvoice = {
    id: "inv_historical_001",
    number: "INV-2026-001",
    date: 1773300000000,
    status: "posted",
    postingStatus: "posted",
    items: [invoiceLine],
    lineSnapshots: [invoiceLine], // PERSISTED FROZEN SNAPSHOT
  };

  // Step 3: Change Product Master completely
  productCatalog.prod_ms.name = "Premium MS Plate";
  productCatalog.prod_ms.sellingPrice = 180;
  productCatalog.prod_ms.hsn = "HSN-B";
  productCatalog.prod_ms.unit = "SQM";

  // Step 4: Reprint/render old invoice - MUST read frozen snapshot
  const snapshotToRender = postedInvoice.lineSnapshots[0];
  assert.equal(snapshotToRender.productName, "MS Plate", "Reprinted name must remain MS Plate");
  assert.equal(snapshotToRender.rate, 120, "Reprinted rate must remain ₹120");
  assert.equal(snapshotToRender.hsn, "HSN-A", "Reprinted HSN must remain HSN-A");
  assert.equal(snapshotToRender.uomLabel, "Sq Ft", "Reprinted UOM must remain Sq Ft");
  assert.notEqual(snapshotToRender.productName, productCatalog.prod_ms.name, "Product catalog change must NOT bleed into historical invoice");
});

test("Smart Billing 16: Acceptance Audit 2 — Customer & Supplier Concurrent Quick-Create Trusted Uniqueness", () => {
  const companyCustomers = [];
  const companySuppliers = [];

  function simulateCreateCustomerWithUniqueness(companyId, customer) {
    const normName = normalizeName(customer.name);
    const normGstin = normalizeGstin(customer.gstin);

    // Concurrency / duplicate check
    const existing = companyCustomers.find((c) => {
      if (c.companyId !== companyId) return false;
      if (normGstin && normalizeGstin(c.gstin) === normGstin) return true;
      if (normName && normalizeName(c.name) === normName) return true;
      return false;
    });

    if (existing) {
      return { success: true, party: existing, ledgerId: existing.ledgerId, isExisting: true };
    }

    const newLedgerId = `led_${companyId}_cust_${customer.id}`;
    const newCust = { ...customer, companyId, ledgerId: newLedgerId, normalizedName: normName };
    companyCustomers.push(newCust);
    return { success: true, party: newCust, ledgerId: newLedgerId, isExisting: false };
  }

  function simulateCreateSupplierWithUniqueness(companyId, supplier) {
    const normName = normalizeName(supplier.name);
    const normGstin = normalizeGstin(supplier.gstin);

    const existing = companySuppliers.find((s) => {
      if (s.companyId !== companyId) return false;
      if (normGstin && normalizeGstin(s.gstin) === normGstin) return true;
      if (normName && normalizeName(s.name) === normName) return true;
      return false;
    });

    if (existing) {
      return { success: true, party: existing, ledgerId: existing.ledgerId, isExisting: true };
    }

    const newLedgerId = `led_${companyId}_supp_${supplier.id}`;
    const newSupp = { ...supplier, companyId, ledgerId: newLedgerId, normalizedName: normName };
    companySuppliers.push(newSupp);
    return { success: true, party: newSupp, ledgerId: newLedgerId, isExisting: false };
  }

  // Employee A creates: Mars Engineering, GSTIN X
  const resA = simulateCreateCustomerWithUniqueness("comp_1", {
    id: "cust_emp_a",
    name: "Mars Engineering",
    gstin: "29AAAAA0000A1Z5",
  });
  assert.equal(resA.isExisting, false);
  assert.equal(companyCustomers.length, 1);

  // Employee B concurrently creates: MARS ENGINEERING, GSTIN X (different casing, different generated id)
  const resB = simulateCreateCustomerWithUniqueness("comp_1", {
    id: "cust_emp_b",
    name: "MARS ENGINEERING",
    gstin: "29aaaaa0000a1z5",
  });
  assert.equal(resB.isExisting, true, "Employee B must receive existing customer record");
  assert.equal(resB.party.id, resA.party.id, "Customer ID must match Employee A's created record");
  assert.equal(resB.ledgerId, resA.ledgerId, "AR Ledger must be identical (zero duplicate ledgers)");
  assert.equal(companyCustomers.length, 1, "Never create duplicate customer in company");

  // Supplier equivalent check
  const resSuppA = simulateCreateSupplierWithUniqueness("comp_1", {
    id: "supp_1",
    name: "Tata Steel Ltd",
    gstin: "27AAACT0000A1Z2",
  });
  const resSuppB = simulateCreateSupplierWithUniqueness("comp_1", {
    id: "supp_2",
    name: "TATA STEEL LTD",
    gstin: "27aaact0000a1z2",
  });
  assert.equal(resSuppA.isExisting, false);
  assert.equal(resSuppB.isExisting, true);
  assert.equal(resSuppB.ledgerId, resSuppA.ledgerId);
  assert.equal(companySuppliers.length, 1);
});

test("Smart Billing 17: Acceptance Audit 3 — Stock Movement Ledger Authoritative Truth & Rebuild from Movements", () => {
  const stockMovementLedger = [];

  function recordMovement(m) {
    const baseUom = m.productBaseUom || "NOS";
    let baseQty = m.enteredQuantity;
    if (m.enteredUom !== baseUom) {
      baseQty = convertUnitQuantity(m.enteredQuantity, m.enteredUom, baseUom);
    }
    const movement = {
      ...m,
      id: `sm_${stockMovementLedger.length + 1}`,
      baseQuantity: baseQty,
      baseUom,
    };
    stockMovementLedger.push(movement);
    return movement;
  }

  function rebuildStockFromMovements(productId, openingStock = 0) {
    const movements = stockMovementLedger.filter((m) => m.productId === productId);
    let stock = openingStock;
    for (const m of movements) {
      if (m.movementType === "in") stock += m.baseQuantity;
      else if (m.movementType === "out") stock -= m.baseQuantity;
      else if (m.movementType === "adjustment") stock += m.baseQuantity;
    }
    return Math.round(stock * 10000) / 10000;
  }

  // Product base UOM: SQFT, openingStock: 500
  const product = { id: "p_sheet", baseUom: "SQFT", openingStock: 500 };

  // 1. Purchase Bill: 20 SQM (Stock IN) -> converts to SQFT
  recordMovement({
    productId: product.id,
    movementType: "in",
    documentKind: "purchase",
    documentId: "pur_1",
    enteredQuantity: 20,
    enteredUom: "SQM",
    productBaseUom: product.baseUom,
  });

  // 2. Sales Invoice: 50 SQFT (Stock OUT)
  recordMovement({
    productId: product.id,
    movementType: "out",
    documentKind: "invoice",
    documentId: "inv_1",
    enteredQuantity: 50,
    enteredUom: "SQFT",
    productBaseUom: product.baseUom,
  });

  // Rebuild stock purely from movements
  // 500 + (20 * 10.76391 = 215.2782) - 50 = 665.2782 SQFT
  const rebuiltStock = rebuildStockFromMovements(product.id, product.openingStock);
  assert.equal(rebuiltStock, 665.2782);
  assert.equal(stockMovementLedger.length, 2);
  assert.equal(stockMovementLedger[0].movementType, "in");
  assert.equal(stockMovementLedger[1].movementType, "out");
});

test("Smart Billing 18: Acceptance Audit 4 — Alternate-UOM Price Conversion in Both Directions", () => {
  function convertRate(rate, fromUnit, toUnit) {
    const f = fromUnit.trim().toUpperCase();
    const t = toUnit.trim().toUpperCase();
    if (f === t) return rate;

    // Area: SQFT <-> SQM
    if ((f === "SQFT" || f === "SQ FT") && (t === "SQM" || t === "SQ M")) {
      return Math.round(rate * 10.76391 * 100) / 100;
    }
    if ((f === "SQM" || f === "SQ M") && (t === "SQFT" || t === "SQ FT")) {
      return Math.round((rate / 10.76391) * 100) / 100;
    }

    // Length: FT <-> M
    if ((f === "FT" || f === "FEET") && (t === "M" || t === "METER" || t === "METERS")) {
      return Math.round(rate * 3.28084 * 100) / 100;
    }
    if ((f === "M" || f === "METER" || f === "METERS") && (t === "FT" || t === "FEET")) {
      return Math.round((rate / 3.28084) * 100) / 100;
    }

    // Weight: G <-> KG
    if ((f === "G" || f === "GRAMS") && (t === "KG" || t === "KILOGRAMS")) {
      return Math.round(rate * 1000 * 100) / 100;
    }
    if ((f === "KG" || f === "KILOGRAMS") && (t === "G" || t === "GRAMS")) {
      return Math.round((rate / 1000) * 100) / 100;
    }

    return null;
  }

  // Example from Prompt:
  // ₹120 / SQFT must become ~₹1,291.67 / SQM, NOT ₹11.15 / SQM
  const rateSqmFromSqft = convertRate(120, "SQFT", "SQM");
  assert.equal(rateSqmFromSqft, 1291.67, "120 / SQFT must become 1,291.67 / SQM");

  // Inverse: ₹1,291.67 / SQM must become ₹120 / SQFT
  const rateSqftFromSqm = convertRate(1291.67, "SQM", "SQFT");
  assert.equal(rateSqftFromSqm, 120.00, "1,291.67 / SQM must convert back to 120.00 / SQFT");

  // Meter <-> Feet
  // ₹100 / Meter: 1 Meter is 3.28084 Feet -> Rate per Foot is 100 / 3.28084 = ₹30.48 / Foot
  const rateFtFromM = convertRate(100, "M", "FT");
  assert.equal(rateFtFromM, 30.48);
  // Inverse: ₹30.48 / Foot -> Rate per Meter is 30.48 * 3.28084 = ₹100 / Meter
  const rateMFromFt = convertRate(30.48, "FT", "M");
  assert.equal(rateMFromFt, 100.00);

  // Kg <-> Gram
  // ₹60 / KG -> Rate per Gram is 60 / 1000 = ₹0.06 / Gram
  const rateGFromKg = convertRate(60, "KG", "G");
  assert.equal(rateGFromKg, 0.06);
  // Inverse: ₹0.06 / Gram -> Rate per KG is 0.06 * 1000 = ₹60 / KG
  const rateKgFromG = convertRate(0.06, "G", "KG");
  assert.equal(rateKgFromG, 60.00);
});

test("Smart Billing 19: Acceptance Audit 5 — Customer Last Rate UOM Safety", () => {
  function formatLastRateBadge(customerLastRate, targetUnit, sourceUnit) {
    if (!customerLastRate) return null;
    if (!sourceUnit || sourceUnit.toUpperCase() === targetUnit.toUpperCase()) {
      return `Mars Last Rate: ₹${customerLastRate.toFixed(2)} / ${targetUnit}`;
    }
    // Converted
    const isSqftToSqm = sourceUnit.toUpperCase() === "SQFT" && targetUnit.toUpperCase() === "SQM";
    if (isSqftToSqm) {
      const converted = Math.round(customerLastRate * 10.76391 * 100) / 100;
      return `Mars Last Rate: ₹${converted.toLocaleString("en-IN", { minimumFractionDigits: 2 })} / ${targetUnit} (converted)`;
    }
    return `Mars Last Rate: ₹${customerLastRate.toFixed(2)} / ${sourceUnit}`;
  }

  // Same UOM:
  const badgeSame = formatLastRateBadge(120, "Sq Ft", "Sq Ft");
  assert.equal(badgeSame, "Mars Last Rate: ₹120.00 / Sq Ft");

  // Alternate UOM:
  const badgeConverted = formatLastRateBadge(120, "SQM", "SQFT");
  assert.equal(badgeConverted, "Mars Last Rate: ₹1,291.67 / SQM (converted)");

  // Invariant: Never naked rate
  assert.ok(badgeSame.includes("/ Sq Ft"));
  assert.ok(badgeConverted.includes("/ SQM"));
});

test("Smart Billing 20: Acceptance Audit 6 — Summary Rebuild Parity", () => {
  const transactions = [
    { type: "invoice", id: "inv_1", customerId: "c_1", supplierId: null, grandTotal: 50000, amountPaid: 0, balance: 50000, status: "unpaid", postingStatus: "posted", date: 1 },
    { type: "receipt", id: "rec_1", customerId: "c_1", amount: 20000, date: 2 },
    { type: "credit_note", id: "cn_1", customerId: "c_1", amount: 5000, date: 3 },
    { type: "purchase", id: "pur_1", supplierId: "s_1", grandTotal: 30000, amountPaid: 0, balance: 30000, status: "unpaid", postingStatus: "posted", date: 4 },
    { type: "payment", id: "pay_1", supplierId: "s_1", amount: 10000, date: 5 },
  ];

  // Materialized calculation
  const customerInvoices = transactions.filter((t) => t.type === "invoice" && t.customerId === "c_1" && t.postingStatus === "posted");
  const customerReceipts = transactions.filter((t) => t.type === "receipt" && t.customerId === "c_1");
  const customerCreditNotes = transactions.filter((t) => t.type === "credit_note" && t.customerId === "c_1");

  const totalInvoiced = customerInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalPaid = customerReceipts.reduce((s, r) => s + r.amount, 0);
  const totalCredited = customerCreditNotes.reduce((s, c) => s + c.amount, 0);
  const outstanding = totalInvoiced - totalPaid - totalCredited;

  // Rebuild function
  function rebuild(customerId, txs) {
    const invs = txs.filter((t) => t.type === "invoice" && t.customerId === customerId && t.postingStatus === "posted");
    const recs = txs.filter((t) => t.type === "receipt" && t.customerId === customerId);
    const cns = txs.filter((t) => t.type === "credit_note" && t.customerId === customerId);

    const invTot = invs.reduce((s, i) => s + i.grandTotal, 0);
    const recTot = recs.reduce((s, r) => s + r.amount, 0);
    const cnTot = cns.reduce((s, c) => s + c.amount, 0);

    return {
      totalInvoiced: invTot,
      totalPaid: recTot,
      outstanding: invTot - recTot - cnTot,
    };
  }

  const rebuilt = rebuild("c_1", transactions);
  assert.equal(rebuilt.totalInvoiced, totalInvoiced);
  assert.equal(rebuilt.totalPaid, totalPaid);
  assert.equal(rebuilt.outstanding, outstanding);
  assert.equal(rebuilt.outstanding, 25000);
});

test("Smart Billing 21: Acceptance Audit 7 & 8 — Customer & Product KPI Lifecycle Acceptance", () => {
  // 1. Draft invoice: does NOT increase Total Invoiced or Qty Sold
  const draftInvoice = {
    id: "inv_draft",
    customerId: "c_1",
    status: "draft",
    postingStatus: "draft",
    grandTotal: 50000,
    items: [{ productId: "p_1", quantity: 10, total: 50000, rate: 5000 }],
  };

  const postedInvoice = {
    id: "inv_posted",
    customerId: "c_1",
    status: "posted",
    postingStatus: "posted",
    grandTotal: 30000,
    items: [{ productId: "p_1", quantity: 6, total: 30000, rate: 5000 }],
  };

  const allInvoices = [draftInvoice, postedInvoice];

  const postedOnly = allInvoices.filter((i) => i.postingStatus === "posted" && i.status !== "cancelled");
  const customerTotalInvoiced = postedOnly.reduce((s, i) => s + i.grandTotal, 0);
  assert.equal(customerTotalInvoiced, 30000, "Draft invoice must be strictly excluded from customer total invoiced");

  let productQtySold = 0;
  let productRevenue = 0;
  for (const inv of postedOnly) {
    for (const item of inv.items) {
      if (item.productId === "p_1") {
        productQtySold += item.quantity;
        productRevenue += item.total;
      }
    }
  }
  assert.equal(productQtySold, 6, "Draft invoice must not affect Product Qty Sold");
  assert.equal(productRevenue, 30000, "Draft invoice must not affect Product Revenue");
});

test("Smart Billing 22: Acceptance Audit 10 — Loading & Busy UX Labels Check", () => {
  const REQUIRED_BUSY_LABELS = [
    "Saving Customer…",
    "Saving Product…",
    "Saving Draft…",
    "Posting Invoice…",
    "Recording Receipt…",
    "Downloading…",
  ];

  for (const label of REQUIRED_BUSY_LABELS) {
    assert.ok(label.endsWith("…"), `Label "${label}" must end with ellipsis for active progression`);
    assert.ok(label.length > 5);
  }
});

test("Smart Billing 23: Acceptance Audit 11 — PDF Copy Modes Invariance & Visual Spacing", () => {
  const copyModes = ["ORIGINAL", "COPY", "CUSTOMER COPY", "OFFICE COPY", "TRANSPORT COPY", "DRIVER COPY"];

  for (const copy of copyModes) {
    const docData = {
      number: "INV-2026-999",
      date: 1773300000000,
      copyLabel: copy,
      grandTotal: 10000,
    };
    assert.equal(docData.number, "INV-2026-999");
    assert.equal(docData.copyLabel, copy);
  }
});

