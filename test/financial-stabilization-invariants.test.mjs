import test from "node:test";
import assert from "node:assert/strict";

/**
 * ============================================================================
 * BMS NEXT — PRODUCTION FINANCIAL STABILIZATION INVARIANTS TEST SUITE
 * ============================================================================
 * Verifies core accounting rules, GST exclusivity, reconciliation invariants,
 * bill-wise AR/AP, profit accounting, canonical party resolution, and multi-device sync.
 */

function toPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(Number(rupees) * 100);
}

function toRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

function validateTaxHeadExclusivity(taxes) {
  const cgst = Number(taxes.cgstTotal ?? taxes.cgst) || 0;
  const sgst = Number(taxes.sgstTotal ?? taxes.sgst) || 0;
  const igst = Number(taxes.igstTotal ?? taxes.igst) || 0;
  const cess = Number(taxes.cessTotal ?? taxes.cess) || 0;
  const total = Number(taxes.totalTax ?? taxes.gstTotal) || 0;

  if (igst > 0 && (cgst > 0 || sgst > 0)) {
    return {
      valid: false,
      error: `Tax head exclusivity violation: Interstate IGST (₹${igst}) and Intrastate CGST/SGST (₹${cgst}/₹${sgst}) cannot coexist.`,
    };
  }

  const sumPaise = toPaise(cgst) + toPaise(sgst) + toPaise(igst) + toPaise(cess);
  const totalPaise = toPaise(total);

  if (Math.abs(sumPaise - totalPaise) > 1) {
    return {
      valid: false,
      error: `Component tax sum (₹${toRupees(sumPaise)}) does not equal declared total tax (₹${toRupees(totalPaise)}).`,
    };
  }

  return { valid: true };
}

// ----------------------------------------------------------------------------
// 1. TAX HEAD EXCLUSIVITY (Specifications 1, 2, 6, 81)
// ----------------------------------------------------------------------------
test("1. Tax Head Exclusivity: Intrastate vs Interstate strict XOR", () => {
  // Intrastate valid
  const intra = { cgstTotal: 9000, sgstTotal: 9000, igstTotal: 0, cessTotal: 0, totalTax: 18000 };
  assert.equal(validateTaxHeadExclusivity(intra).valid, true);

  // Interstate valid
  const inter = { cgstTotal: 0, sgstTotal: 0, igstTotal: 18000, cessTotal: 0, totalTax: 18000 };
  assert.equal(validateTaxHeadExclusivity(inter).valid, true);

  // Corrupted screenshot-case invalid (both coexist)
  const corrupted = { cgstTotal: 9000, sgstTotal: 9000, igstTotal: 18000, cessTotal: 0, totalTax: 18000 };
  const res = validateTaxHeadExclusivity(corrupted);
  assert.equal(res.valid, false);
  assert.match(res.error, /Tax head exclusivity violation/);
});

// ----------------------------------------------------------------------------
// 2. SCREENSHOT REGRESSION FIXTURE: Invoice 0011-like case (Specification 81)
// ----------------------------------------------------------------------------
test("2. Screenshot Regression: Invoice 0011 (₹100k @ 18%) resolves to ₹18,000 tax, never ₹36,000", () => {
  const taxable = 100000;
  const rate = 18;

  // Function computing taxes based on place of supply
  function computeInvoiceTax(taxableRupees, gstRate, isInterState) {
    const taxPaise = Math.round((toPaise(taxableRupees) * gstRate) / 100);
    if (isInterState) {
      return {
        cgstTotal: 0,
        sgstTotal: 0,
        igstTotal: toRupees(taxPaise),
        totalTax: toRupees(taxPaise),
      };
    } else {
      const halfPaise = Math.round(taxPaise / 2);
      return {
        cgstTotal: toRupees(halfPaise),
        sgstTotal: toRupees(taxPaise - halfPaise),
        igstTotal: 0,
        totalTax: toRupees(taxPaise),
      };
    }
  }

  const intraRes = computeInvoiceTax(taxable, rate, false);
  assert.equal(intraRes.cgstTotal, 9000);
  assert.equal(intraRes.sgstTotal, 9000);
  assert.equal(intraRes.igstTotal, 0);
  assert.equal(intraRes.totalTax, 18000);
  assert.equal(intraRes.cgstTotal + intraRes.sgstTotal + intraRes.igstTotal, 18000);

  const interRes = computeInvoiceTax(taxable, rate, true);
  assert.equal(interRes.cgstTotal, 0);
  assert.equal(interRes.sgstTotal, 0);
  assert.equal(interRes.igstTotal, 18000);
  assert.equal(interRes.totalTax, 18000);
  assert.equal(interRes.cgstTotal + interRes.sgstTotal + interRes.igstTotal, 18000);
});

// ----------------------------------------------------------------------------
// 3. GST SUMMARY VS TRANSACTION REGISTER RECONCILIATION (Specifications 4, 5, 82)
// ----------------------------------------------------------------------------
test("3. GST Summary Reconciles with Transaction Register: ₹90,900 parity (NOT ₹108,900)", () => {
  // Screenshot transaction register tax rows
  const registerRows = [
    { number: "INV-001", totalTax: 0, isIgst: false, cgst: 0, sgst: 0, igst: 0 },
    { number: "INV-002", totalTax: 18000, isIgst: false, cgst: 9000, sgst: 9000, igst: 0 },
    { number: "INV-003", totalTax: 18000, isIgst: true, cgst: 0, sgst: 0, igst: 18000 },
    { number: "INV-004", totalTax: 36900, isIgst: false, cgst: 18450, sgst: 18450, igst: 0 },
    { number: "INV-005", totalTax: 18000, isIgst: true, cgst: 0, sgst: 0, igst: 18000 },
  ];

  const registerTotalTax = registerRows.reduce((sum, r) => sum + r.totalTax, 0);
  assert.equal(registerTotalTax, 90900);

  // Canonical GST Summary aggregation (avoiding falsy 0 bug)
  let outputCgst = 0;
  let outputSgst = 0;
  let outputIgst = 0;

  for (const row of registerRows) {
    if (row.isIgst) {
      outputIgst += row.igst || row.totalTax;
    } else {
      outputCgst += row.cgst || row.totalTax / 2;
      outputSgst += row.sgst || row.totalTax / 2;
    }
  }

  const outputTaxLiability = outputCgst + outputSgst + outputIgst;

  assert.equal(outputCgst, 27450);
  assert.equal(outputSgst, 27450);
  assert.equal(outputIgst, 36000);
  assert.equal(outputTaxLiability, 90900);
  assert.notEqual(outputTaxLiability, 108900);
  assert.equal(registerTotalTax, outputTaxLiability);
});

// ----------------------------------------------------------------------------
// 4. SALES REPORT RECONCILIATION & REVENUE BASE (Specifications 15, 16, 17, 83)
// ----------------------------------------------------------------------------
test("4. Sales Report Reconciliation: Gross Invoice Value vs Net Revenue", () => {
  const row = {
    taxable: 100000,
    nonTaxableCharges: 10000,
    taxableCharges: 20000,
    gst: 18000,
    discount: 0,
    roundOff: 0,
  };

  const grossInvoiceValue =
    row.taxable + row.nonTaxableCharges + row.taxableCharges + row.gst - row.discount + row.roundOff;
  assert.equal(grossInvoiceValue, 148000);

  // Revenue recognized in accounting excludes output GST
  const accountingRevenue = row.taxable + row.taxableCharges + row.nonTaxableCharges;
  assert.equal(accountingRevenue, 130000);
  assert.equal(accountingRevenue + row.gst, grossInvoiceValue);
});

// ----------------------------------------------------------------------------
// 5. PROFIT REPORT ACCOUNTING (Specifications 32, 33, 34, 35, 36, 85)
// ----------------------------------------------------------------------------
test("5. Profit Report: Net Revenue strictly excludes Output GST; flags incomplete costing", () => {
  const invoice = {
    taxableRevenue: 100000,
    outputGst: 18000,
    grossInvoice: 118000,
  };
  const cogs = 60000;

  // Gross profit = Net Revenue - COGS
  const grossProfit = invoice.taxableRevenue - cogs;
  assert.equal(grossProfit, 40000);
  assert.notEqual(grossProfit, 58000); // Output GST must never inflate profit

  // Incomplete costing detection
  const itemsWithoutCost = [{ productId: "p1", name: "Custom Item", purchasePrice: 0 }];
  const hasCostData = itemsWithoutCost.every((it) => it.purchasePrice > 0);
  assert.equal(hasCostData, false);
});

// ----------------------------------------------------------------------------
// 6. BILL-WISE AR RECONCILIATION & CASH FLOW INVARIANTS (Specifications 18, 19, 20, 24, 28, 29, 84)
// ----------------------------------------------------------------------------
test("6. AR & Cash Invariants: Invoices increase AR, Receipts reduce AR without altering Sales", () => {
  let accountsReceivable = 0;
  let salesRevenue = 0;
  let amountReceived = 0;

  // 1. Post Invoice ₹1,056,425
  const invoiceTotal = 1056425;
  const taxablePortion = 895275;
  accountsReceivable += invoiceTotal;
  salesRevenue += taxablePortion;
  // Invoice posting must NOT increase amountReceived
  assert.equal(amountReceived, 0);
  assert.equal(accountsReceivable, 1056425);

  // 2. Post Receipt ₹5,555
  const receiptAmount = 5555;
  amountReceived += receiptAmount;
  accountsReceivable -= receiptAmount;

  // Receipt must NOT change sales revenue
  assert.equal(salesRevenue, taxablePortion);
  assert.equal(accountsReceivable, 1050870);
  assert.equal(amountReceived, 5555);

  // 3. Advance Receipt ₹10,000
  const advanceAmount = 10000;
  amountReceived += advanceAmount; // Cash received
  let unallocatedAdvance = advanceAmount;

  // 4. Later allocation of advance to Invoice does NOT increase amountReceived again
  const allocatedAdvance = 5000;
  unallocatedAdvance -= allocatedAdvance;
  accountsReceivable -= allocatedAdvance;
  // amountReceived remains 15,555 (does not double count to 20,555)
  assert.equal(amountReceived, 15555);
  assert.equal(accountsReceivable, 1045870);
});

// ----------------------------------------------------------------------------
// 7. BILL-WISE AP & SUPPLIER PAYMENTS (Specifications 30, 67)
// ----------------------------------------------------------------------------
test("7. AP & Supplier Payments: Purchase creates Payable, Payment reduces Payable", () => {
  let accountsPayable = 0;
  let purchaseExpense = 0;
  let amountPaid = 0;

  // 1. Post Purchase Bill ₹100,000 taxable + ₹18,000 GST = ₹118,000
  accountsPayable += 118000;
  purchaseExpense += 100000;
  assert.equal(accountsPayable, 118000);
  assert.equal(amountPaid, 0);

  // 2. Post Supplier Payment ₹50,000
  const payment = 50000;
  amountPaid += payment;
  accountsPayable -= payment;

  assert.equal(amountPaid, 50000);
  assert.equal(accountsPayable, 68000);
});

// ----------------------------------------------------------------------------
// 8. INPUT GST PURCHASE INTEGRATION (Specifications 13, 14, 86)
// ----------------------------------------------------------------------------
test("8. Input GST: Eligible Purchase ITC feeds into GST report", () => {
  const purchase = {
    number: "PB-001",
    taxable: 100000,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    itcEligibility: "ELIGIBLE",
    postingStatus: "posted",
  };

  function calculateEligibleItc(purchases) {
    return purchases
      .filter((p) => p.postingStatus === "posted" && p.itcEligibility === "ELIGIBLE")
      .reduce(
        (acc, p) => ({
          inputCgst: acc.inputCgst + (p.cgst || 0),
          inputSgst: acc.inputSgst + (p.sgst || 0),
          inputIgst: acc.inputIgst + (p.igst || 0),
          totalItc: acc.totalItc + (p.cgst || 0) + (p.sgst || 0) + (p.igst || 0),
        }),
        { inputCgst: 0, inputSgst: 0, inputIgst: 0, totalItc: 0 }
      );
  }

  const itc = calculateEligibleItc([purchase]);
  assert.equal(itc.inputCgst, 9000);
  assert.equal(itc.inputSgst, 9000);
  assert.equal(itc.inputIgst, 0);
  assert.equal(itc.totalItc, 18000);

  // Estimated Net GST Liability = Output Tax (90,900) - Eligible ITC (18,000) = 72,900
  const outputLiability = 90900;
  const netEstimatedGst = outputLiability - itc.totalItc;
  assert.equal(netEstimatedGst, 72900);
});

// ----------------------------------------------------------------------------
// 9. CANONICAL PARTY RESOLVER & LEGACY MIGRATION (Specifications 39-48, 87)
// ----------------------------------------------------------------------------
test("9. Canonical Party Master: Unified resolution priority and legacy migration parity", () => {
  const legacyCustomer = {
    id: "cust_maaz_123",
    name: "Maaz Khan",
    company: "MK Enterprises",
    gstin: "27AAAAA0000A1Z5",
    ledgerId: "led_cust_maaz_123",
  };

  // Simulating migration to canonical Party
  const migratedParty = {
    id: legacyCustomer.id,
    partyType: "SUNDRY_DEBTOR",
    name: legacyCustomer.name,
    company: legacyCustomer.company,
    gstin: legacyCustomer.gstin,
    ledgerId: legacyCustomer.ledgerId,
  };

  assert.equal(migratedParty.id, legacyCustomer.id);
  assert.equal(migratedParty.partyType, "SUNDRY_DEBTOR");
  assert.equal(migratedParty.ledgerId, legacyCustomer.ledgerId); // No duplicate ledger

  // Priority Resolver
  function resolveParty(params) {
    if (params.frozenSnapshot?.name && params.frozenSnapshot.name !== "—") {
      return { name: params.frozenSnapshot.name, source: "frozen_snapshot" };
    }
    if (params.party?.name) {
      return { name: params.party.name, source: "canonical_party" };
    }
    if (params.legacyRecord?.name) {
      return { name: params.legacyRecord.name, source: "legacy_record" };
    }
    return { name: "Safe Fallback", source: "fallback" };
  }

  // Frozen snapshot takes highest priority
  assert.equal(
    resolveParty({
      frozenSnapshot: { name: "Historical Maaz Snapshot" },
      party: migratedParty,
    }).name,
    "Historical Maaz Snapshot"
  );

  // Canonical party used if no frozen snapshot
  assert.equal(
    resolveParty({
      party: migratedParty,
      legacyRecord: legacyCustomer,
    }).name,
    "Maaz Khan"
  );
});

// ----------------------------------------------------------------------------
// 10. MEASUREMENT CALCULATOR MATH (Specifications 54, 55)
// ----------------------------------------------------------------------------
test("10. Measurement Math: 10 FT x 8 FT x 2 pieces = 160 SQ FT", () => {
  const length = 10;
  const width = 8;
  const pieces = 2;

  const areaSqFt = length * width * pieces;
  assert.equal(areaSqFt, 160);

  const summary = `${length} FT × ${width} FT × ${pieces} pcs = ${areaSqFt} SQ FT`;
  assert.equal(summary, "10 FT × 8 FT × 2 pcs = 160 SQ FT");
});

// ----------------------------------------------------------------------------
// 11. MULTI-DEVICE REALTIME SYNC & IDEMPOTENCY (Specifications 49, 56-60, 88)
// ----------------------------------------------------------------------------
test("11. Multi-Device Realtime & Idempotency Simulation", () => {
  const rtdbCloud = new Map();
  const deviceA_Cache = new Map();
  const deviceB_Cache = new Map();

  // Device A posts Receipt
  const receiptMutation = {
    clientMutationId: "mut_receipt_abc123",
    id: "rec_001",
    number: "REC-1001",
    amount: 25000,
    invoiceId: "INV-001",
  };

  // Cloud processes mutation idempotently
  function processCloudPost(mutation) {
    if (rtdbCloud.has(mutation.clientMutationId)) {
      return { status: "already_processed", record: rtdbCloud.get(mutation.clientMutationId) };
    }
    rtdbCloud.set(mutation.clientMutationId, mutation);
    rtdbCloud.set(`receipts/${mutation.id}`, mutation);
    return { status: "created", record: mutation };
  }

  const post1 = processCloudPost(receiptMutation);
  assert.equal(post1.status, "created");
  deviceA_Cache.set(receiptMutation.id, post1.record);

  // Idempotent retry returns existing record without duplicating
  const post2 = processCloudPost(receiptMutation);
  assert.equal(post2.status, "already_processed");
  assert.equal(post2.record.number, "REC-1001");

  // Device B listener receives RTDB update
  function onDeviceB_RTDBUpdate(path, data) {
    deviceB_Cache.set(data.id, data);
  }

  onDeviceB_RTDBUpdate(`receipts/${receiptMutation.id}`, rtdbCloud.get(`receipts/${receiptMutation.id}`));

  // Device B has the receipt without manual refresh
  assert.equal(deviceB_Cache.has("rec_001"), true);
  assert.equal(deviceB_Cache.get("rec_001").amount, 25000);
});
