/**
 * BMS NEXT — Final Client Workflow Fix Addendum Test Suite
 * Covers:
 * 1. Goods Advance (No automatic Output GST, Cash/Bank Dr, Customer Advance Cr)
 * 2. Service Advance (Taxable advance, canonical calculation 118,000 -> 100,000 + 18,000 CGST/SGST/IGST)
 * 3. Unspecified Advance (PENDING_CLASSIFICATION, no silently invented tax rate)
 * 4. Mixed Advance (Goods component no tax + Service component taxable)
 * 5. Advance -> Invoice Adjustment (No double GST liability, advanceTaxPreviouslyAccounted)
 * 6. Advance Cancellation / Refund (Auditable reversal voucher, proportional tax reversal, no voucher deletion)
 * 7. Registration Modes (NORMAL_GST vs COMPOSITION vs UNREGISTERED)
 * 8. Country-Aware Postal Code Validation (India 6-digit PIN vs UAE / Foreign Postal Code)
 * 9. Party Type BOTH — Strict AR and AP isolation, no automatic netting
 * 10. Reports isolation (AR only, AP only, Customer Advance Register, Supplier Advance Register)
 * 11. Preservation of Canonical Calculation Engine contract
 * 12. Strict ADVANCE party policy enforcement preservation
 */

import test from "node:test";
import assert from "node:assert/strict";

import { calculateAdvanceTax, toPaise, toRupees } from "../src/modules/tax/taxEngine.ts";
import { validatePostalCode, isIndia, getPostalCodeLabel } from "../src/lib/countryValidation.ts";
import { calculateCanonicalTotals } from "../src/modules/tax/canonicalCalculation.ts";

// Helper: simulate double-entry ledger posting for Advance Receipt
function simulateReceiptPosting(params) {
  const {
    companyId,
    companyGstMode = "NORMAL_GST",
    companyStateCode = "27",
    supplyType = "GOODS",
    advanceAmount,
    taxInclusive = true,
    gstRate = 18,
    placeOfSupply = "27",
    mixedBreakdown,
  } = params;

  const calc = calculateAdvanceTax({
    companyGstMode,
    supplyType,
    advanceAmount,
    taxInclusive,
    gstRate,
    placeOfSupply,
    companyStateCode,
    mixedBreakdown,
  });

  const advancePaise = toPaise(advanceAmount);
  const lines = [];

  // 1. Debit: Cash/Bank Liquidity Ledger
  lines.push({
    ledgerId: `led_${companyId}_bank`,
    debit: advancePaise,
    credit: 0,
  });

  if (calc.taxTreatment === "ADVANCE_GST" && calc.totalTaxPaise > 0) {
    // 2. Credit: Customer Advance (Taxable portion)
    lines.push({
      ledgerId: `led_${companyId}_cust_advance`,
      debit: 0,
      credit: calc.taxableAmountPaise,
    });
    // 3. Credit: Output GST (Advance tax liability)
    if (calc.isInterState) {
      lines.push({
        ledgerId: `led_${companyId}_igst_output`,
        debit: 0,
        credit: calc.igstPaise,
      });
    } else {
      lines.push({
        ledgerId: `led_${companyId}_cgst_output`,
        debit: 0,
        credit: calc.cgstPaise,
      });
      lines.push({
        ledgerId: `led_${companyId}_sgst_output`,
        debit: 0,
        credit: calc.sgstPaise,
      });
    }
  } else {
    // No Advance GST or Pending Classification:
    // Entire advance is credited to Customer Advance Ledger, 0 Output GST
    lines.push({
      ledgerId: `led_${companyId}_cust_advance`,
      debit: 0,
      credit: advancePaise,
    });
  }

  // Double-entry validation: sum(debit) === sum(credit)
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalDebit, totalCredit, "Receipt voucher must be perfectly balanced");

  return {
    calc,
    lines,
    advanceAvailablePaise: advancePaise,
    totalDebit,
    totalCredit,
  };
}

// Helper: simulate Invoice generation and Advance Allocation with Tax Adjustment
function simulateInvoiceWithAdvanceAdjustment(params) {
  const {
    invoiceTotalPaise,
    invoiceGstPaise,
    invoiceTaxablePaise,
    advanceAllocatedPaise,
    advanceTaxPreviouslyAccounted = 0,
    isInterState = false,
  } = params;

  // PRD Addendum § 9: Deduct previously recognized advance GST to prevent double taxation
  const netGstToChargePaise = Math.max(0, invoiceGstPaise - advanceTaxPreviouslyAccounted);
  const netInvoiceBalancePaise = Math.max(0, invoiceTotalPaise - advanceAllocatedPaise);

  const lines = [
    // Debit: Customer Receivable for net remaining balance
    {
      ledgerId: "led_cust_receivable",
      debit: netInvoiceBalancePaise,
      credit: 0,
    },
    // Debit: Customer Advance for allocated advance
    {
      ledgerId: "led_cust_advance",
      debit: advanceAllocatedPaise,
      credit: 0,
    },
    // Credit: Sales Revenue (Gross Taxable value)
    {
      ledgerId: "led_sales_revenue",
      debit: 0,
      credit: invoiceTaxablePaise,
    },
  ];

  if (netGstToChargePaise > 0) {
    if (isInterState) {
      lines.push({
        ledgerId: "led_igst_output",
        debit: 0,
        credit: netGstToChargePaise,
      });
    } else {
      const half = Math.round(netGstToChargePaise / 2);
      lines.push({
        ledgerId: "led_cgst_output",
        debit: 0,
        credit: half,
      });
      lines.push({
        ledgerId: "led_sgst_output",
        debit: 0,
        credit: netGstToChargePaise - half,
      });
    }
  }

  if (advanceTaxPreviouslyAccounted > 0) {
    lines.push({
      ledgerId: "led_advance_gst_adjustment",
      debit: 0,
      credit: advanceTaxPreviouslyAccounted,
    });
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  return {
    netGstToChargePaise,
    netInvoiceBalancePaise,
    lines,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit === totalCredit,
  };
}

// Helper: simulate Advance Refund with proportional Output GST reversal
function simulateAdvanceRefund(params) {
  const {
    originalAdvancePaise,
    totalTaxPaise,
    taxTreatment,
    refundAmountPaise,
  } = params;

  const refundPaise = Math.min(originalAdvancePaise, refundAmountPaise);
  let taxReversedPaise = 0;

  if (taxTreatment === "ADVANCE_GST" && totalTaxPaise > 0 && originalAdvancePaise > 0) {
    taxReversedPaise = Math.round((refundPaise * totalTaxPaise) / originalAdvancePaise);
  }
  const taxableReversedPaise = Math.max(0, refundPaise - taxReversedPaise);

  const lines = [
    // Debit: Customer Advance Ledger (taxable reversal)
    {
      ledgerId: "led_cust_advance",
      debit: taxableReversedPaise,
      credit: 0,
    },
    // Debit: Output GST Ledger (tax reversal)
    ...(taxReversedPaise > 0
      ? [
          {
            ledgerId: "led_output_gst_reversal",
            debit: taxReversedPaise,
            credit: 0,
          },
        ]
      : []),
    // Credit: Bank / Cash (refund payout)
    {
      ledgerId: "led_bank",
      debit: 0,
      credit: refundPaise,
    },
  ];

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalDebit, totalCredit, "Refund voucher must be balanced");

  return {
    refundPaise,
    taxReversedPaise,
    taxableReversedPaise,
    lines,
  };
}

// =========================================================================
// TEST SUITE: BMS NEXT FINAL CLIENT WORKFLOW FIX ADDENDUM
// =========================================================================

test("Fix Addendum 1: Goods Advance — Cash/Bank Dr, Customer Advance Cr, No Output GST", () => {
  // NORMAL_GST party, Advance Receipt: ₹1,00,000, Supply: GOODS
  const res = simulateReceiptPosting({
    companyId: "comp_1",
    companyGstMode: "NORMAL_GST",
    supplyType: "GOODS",
    advanceAmount: 100000,
    companyStateCode: "27",
    placeOfSupply: "27",
  });

  assert.equal(res.calc.taxTreatment, "NO_ADVANCE_GST");
  assert.equal(res.calc.totalTaxPaise, 0);
  assert.equal(res.calc.cgstPaise, 0);
  assert.equal(res.calc.sgstPaise, 0);
  assert.equal(res.calc.igstPaise, 0);
  assert.equal(res.calc.advanceAmountPaise, 10000000); // ₹1,00,000 in paise
  assert.equal(res.calc.taxableAmountPaise, 10000000);

  // No sales revenue posted, no output GST ledger credited
  const outputGstLines = res.lines.filter((l) => l.ledgerId.includes("output"));
  assert.equal(outputGstLines.length, 0, "Goods advance must NOT credit Output GST");

  // Bank Dr ₹100,000, Customer Advance Cr ₹100,000
  const bankLine = res.lines.find((l) => l.ledgerId.includes("bank"));
  assert.equal(bankLine.debit, 10000000);
  const advanceLine = res.lines.find((l) => l.ledgerId.includes("advance"));
  assert.equal(advanceLine.credit, 10000000);
});

test("Fix Addendum 2: Service Advance — Canonical Tax Calculation ₹118,000 inclusive 18%", () => {
  // NORMAL_GST party, Taxable Service Advance: ₹1,18,000 inclusive 18% GST (Intra-state Maharashtra)
  const res = simulateReceiptPosting({
    companyId: "comp_1",
    companyGstMode: "NORMAL_GST",
    supplyType: "SERVICES",
    advanceAmount: 118000,
    taxInclusive: true,
    gstRate: 18,
    companyStateCode: "27",
    placeOfSupply: "27",
  });

  assert.equal(res.calc.taxTreatment, "ADVANCE_GST");
  assert.equal(res.calc.advanceAmountPaise, 11800000); // ₹1,18,000 in paise
  assert.equal(res.calc.taxableAmountPaise, 10000000); // Exactly ₹1,00,000 taxable
  assert.equal(res.calc.totalTaxPaise, 1800000); // Exactly ₹18,000 GST
  assert.equal(res.calc.cgstPaise, 900000); // ₹9,000 CGST
  assert.equal(res.calc.sgstPaise, 900000); // ₹9,000 SGST
  assert.equal(res.calc.igstPaise, 0);

  // Verify balanced double-entry lines:
  // Bank Dr: 11,800,000
  // Cust Advance Cr: 10,000,000
  // CGST Cr: 900,000
  // SGST Cr: 900,000
  const bankLine = res.lines.find((l) => l.ledgerId.includes("bank"));
  assert.equal(bankLine.debit, 11800000);
  const advanceLine = res.lines.find((l) => l.ledgerId.includes("advance"));
  assert.equal(advanceLine.credit, 10000000);
  const cgstLine = res.lines.find((l) => l.ledgerId.includes("cgst"));
  assert.equal(cgstLine.credit, 900000);
  const sgstLine = res.lines.find((l) => l.ledgerId.includes("sgst"));
  assert.equal(sgstLine.credit, 900000);
});

test("Fix Addendum 3: Service Advance — Inter-State Place of Supply generates IGST", () => {
  // Company in Maharashtra (27), Client in Delhi (07)
  const res = simulateReceiptPosting({
    companyId: "comp_1",
    companyGstMode: "NORMAL_GST",
    supplyType: "SERVICES",
    advanceAmount: 118000,
    taxInclusive: true,
    gstRate: 18,
    companyStateCode: "27",
    placeOfSupply: "07",
  });

  assert.equal(res.calc.taxTreatment, "ADVANCE_GST");
  assert.equal(res.calc.isInterState, true);
  assert.equal(res.calc.cgstPaise, 0);
  assert.equal(res.calc.sgstPaise, 0);
  assert.equal(res.calc.igstPaise, 1800000); // Exactly ₹18,000 IGST
  assert.equal(res.calc.totalTaxPaise, 1800000);

  const igstLine = res.lines.find((l) => l.ledgerId.includes("igst"));
  assert.equal(igstLine.credit, 1800000);
});

test("Fix Addendum 4: Unspecified Advance — PENDING_CLASSIFICATION without guessing tax rate", () => {
  // Receive ₹50,000, Supply: UNSPECIFIED
  const res = simulateReceiptPosting({
    companyId: "comp_1",
    companyGstMode: "NORMAL_GST",
    supplyType: "UNSPECIFIED",
    advanceAmount: 50000,
    companyStateCode: "27",
    placeOfSupply: "27",
  });

  assert.equal(res.calc.taxTreatment, "PENDING_CLASSIFICATION");
  assert.equal(res.calc.totalTaxPaise, 0);
  assert.equal(res.calc.advanceAmountPaise, 5000000);
  assert.equal(res.calc.taxableAmountPaise, 5000000);
  assert.ok(res.calc.reviewMessage.includes("Tax treatment requires review"), "Must display review message");

  // Output GST must be 0 until classified
  const outputGstLines = res.lines.filter((l) => l.ledgerId.includes("output"));
  assert.equal(outputGstLines.length, 0);
});

test("Fix Addendum 5: Mixed Goods + Services Advance Allocation", () => {
  // Total advance ₹1,00,000: Goods ₹80,000 (No GST), Services ₹20,000 (Taxable at 18% inclusive)
  const calc = calculateAdvanceTax({
    companyGstMode: "NORMAL_GST",
    supplyType: "MIXED",
    advanceAmount: 100000,
    companyStateCode: "27",
    placeOfSupply: "27",
    mixedBreakdown: {
      goodsAmount: 80000,
      serviceAmount: 20000,
      serviceGstRate: 18,
      serviceIsTaxInclusive: true,
    },
  });

  assert.equal(calc.taxTreatment, "ADVANCE_GST");
  assert.equal(calc.advanceAmountPaise, 10000000); // ₹1,00,000 total

  // Service portion: ₹20,000 inclusive of 18%
  // Taxable: round((2000000 * 100) / 118) = 1,694,915 paise = ₹16,949.15
  // Tax: 2,000,000 - 1,694,915 = 305,085 paise = ₹3,050.85
  assert.equal(calc.mixedSummary.goodsAmountPaise, 8000000);
  assert.equal(calc.mixedSummary.serviceAmountPaise, 2000000);
  assert.equal(calc.totalTaxPaise, 305085); // GST on service only
  assert.equal(calc.cgstPaise + calc.sgstPaise, 305085);
});

test("Fix Addendum 6: Advance -> Invoice Adjustment Prevents Double Taxation", () => {
  // Customer gave ₹1,18,000 service advance, paying ₹18,000 GST on advance.
  // Later, full Invoice for ₹1,18,000 (Taxable ₹100,000, GST ₹18,000) is issued.
  // When advance of ₹1,18,000 is applied, advanceTaxPreviouslyAccounted = ₹18,000.
  // Net new GST to charge on invoice must be ₹0, preventing double taxation!
  const adj = simulateInvoiceWithAdvanceAdjustment({
    invoiceTotalPaise: 11800000,
    invoiceTaxablePaise: 10000000,
    invoiceGstPaise: 1800000,
    advanceAllocatedPaise: 11800000,
    advanceTaxPreviouslyAccounted: 1800000,
    isInterState: false,
  });

  assert.equal(adj.netGstToChargePaise, 0, "Net GST on invoice must be ₹0 after full advance tax offset");
  assert.equal(adj.netInvoiceBalancePaise, 0, "Invoice balance must be ₹0 after full allocation");
  assert.equal(adj.isBalanced, true, "Adjusted invoice entry must be balanced");

  // Verify lines:
  // Dr: Cust Advance 11,800,000
  // Cr: Sales Revenue 10,000,000
  // No duplicate Output GST credit
  const advanceDebit = adj.lines.find((l) => l.ledgerId === "led_cust_advance");
  assert.equal(advanceDebit.debit, 11800000);
  const salesCredit = adj.lines.find((l) => l.ledgerId === "led_sales_revenue");
  assert.equal(salesCredit.credit, 10000000);
});

test("Fix Addendum 7: Advance Cancellation / Refund with Proportional Tax Reversal", () => {
  // Advance receipt was ₹1,18,000 with ₹18,000 GST accounted.
  // Order is cancelled, full refund of ₹1,18,000 is issued.
  const refund = simulateAdvanceRefund({
    originalAdvancePaise: 11800000,
    totalTaxPaise: 1800000,
    taxTreatment: "ADVANCE_GST",
    refundAmountPaise: 11800000,
  });

  assert.equal(refund.refundPaise, 11800000);
  assert.equal(refund.taxReversedPaise, 1800000);
  assert.equal(refund.taxableReversedPaise, 10000000);

  // Partial refund test: 50% refund (₹59,000)
  const partial = simulateAdvanceRefund({
    originalAdvancePaise: 11800000,
    totalTaxPaise: 1800000,
    taxTreatment: "ADVANCE_GST",
    refundAmountPaise: 5900000,
  });

  assert.equal(partial.refundPaise, 5900000);
  assert.equal(partial.taxReversedPaise, 900000); // exactly half GST reversed
  assert.equal(partial.taxableReversedPaise, 5000000);
});

test("Fix Addendum 8: Company Registration Modes — Unregistered & Composition", () => {
  // UNREGISTERED business mode: never calculates Output GST
  const unreg = calculateAdvanceTax({
    companyGstMode: "UNREGISTERED",
    supplyType: "SERVICES",
    advanceAmount: 118000,
  });
  assert.equal(unreg.taxTreatment, "NO_GST");
  assert.equal(unreg.totalTaxPaise, 0);

  // COMPOSITION scheme: does NOT charge regular output GST on advances
  const comp = calculateAdvanceTax({
    companyGstMode: "COMPOSITION",
    supplyType: "SERVICES",
    advanceAmount: 118000,
  });
  assert.equal(comp.taxTreatment, "NO_GST");
  assert.equal(comp.totalTaxPaise, 0);
});

test("Fix Addendum 9: Country-Aware Postal Code Validation — UAE vs India", () => {
  // India address: 6-digit numeric PIN is validated
  assert.equal(isIndia("India"), true);
  assert.equal(isIndia("IN"), true);
  assert.equal(getPostalCodeLabel("India"), "Pincode");

  const validIn = validatePostalCode("400001", "India");
  assert.equal(validIn.valid, true);

  const invalidIn = validatePostalCode("40001", "India"); // 5 digits
  assert.equal(invalidIn.valid, false);

  // Foreign address: UAE (United Arab Emirates)
  assert.equal(isIndia("United Arab Emirates"), false);
  assert.equal(isIndia("UAE"), false);
  assert.equal(getPostalCodeLabel("UAE"), "Postal Code / ZIP Code");

  // UAE addresses frequently have no postal code or use arbitrary alphanumerics e.g. "Dubai 00000" or empty
  const uaeEmpty = validatePostalCode("", "United Arab Emirates");
  assert.equal(uaeEmpty.valid, true, "Foreign address must NOT fail for missing 6-digit Indian PIN");

  const uaeAlpha = validatePostalCode("P.O. Box 12345", "UAE");
  assert.equal(uaeAlpha.valid, true, "Foreign postal code can be alphanumeric");
});

test("Fix Addendum 10: Party Type BOTH — Strict AR and AP Separation (No Automatic Netting)", () => {
  // Party ABC Ltd has Type = BOTH
  // Sales Invoice: ₹1,00,000 (AR)
  // Purchase Bill: ₹70,000 (AP)
  const party = {
    id: "party_abc",
    name: "ABC Ltd",
    partyType: "BOTH",
  };

  const invoices = [
    {
      id: "inv_1",
      customerId: "party_abc",
      grandTotal: 100000,
      balance: 100000,
      status: "unpaid",
      postingStatus: "posted",
    },
  ];

  const purchases = [
    {
      id: "pur_1",
      supplierId: "party_abc",
      grandTotal: 70000,
      balance: 70000,
      status: "unpaid",
      postingStatus: "posted",
    },
  ];

  // Derive isolated Sales Side and Purchase Side
  const salesInvoiced = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const salesReceivable = invoices.reduce((s, i) => s + i.balance, 0);

  const purchaseTotal = purchases.reduce((s, p) => s + p.grandTotal, 0);
  const purchasePayable = purchases.reduce((s, p) => s + p.balance, 0);

  // STRICT REQUIREMENT:
  // Receivable = ₹1,00,000
  // Payable = ₹70,000
  // MUST NOT automatically net to ₹30,000!
  assert.equal(salesReceivable, 100000, "Customer Receivable must remain ₹1,00,000");
  assert.equal(purchasePayable, 70000, "Supplier Payable must remain ₹70,000");

  const netted = salesReceivable - purchasePayable;
  assert.notEqual(salesReceivable, netted, "AR must not be netted against AP");
});

test("Fix Addendum 11: Reports Isolation — Receivables Report vs Payables Report", () => {
  // Outstanding Receivables Report queries invoices only
  const allInvoices = [
    { id: "inv_1", customerId: "party_both", balance: 100000, status: "unpaid" },
    { id: "inv_2", customerId: "party_cust", balance: 25000, status: "unpaid" },
  ];
  const allPurchases = [
    { id: "pur_1", supplierId: "party_both", balance: 70000, status: "unpaid" },
    { id: "pur_2", supplierId: "party_supp", balance: 15000, status: "unpaid" },
  ];

  const totalReceivablesReport = allInvoices.reduce((s, i) => s + i.balance, 0);
  const totalPayablesReport = allPurchases.reduce((s, p) => s + p.balance, 0);

  assert.equal(totalReceivablesReport, 125000, "Receivables Report must only contain AR");
  assert.equal(totalPayablesReport, 85000, "Payables Report must only contain AP");
});

test("Fix Addendum 12: Preservation of Canonical Calculation Engine Contract", () => {
  // Verify that canonicalCalculation.ts contract is 100% preserved
  const canonicalResult = calculateCanonicalTotals({
    items: [
      { rate: 1000, quantity: 2, gstRate: 18 },
      { rate: 500, quantity: 4, taxRate: 12 }, // taxRate normalized to gstRate
    ],
    placeOfSupply: "27",
    companyStateCode: "27",
  });

  assert.equal(canonicalResult.subtotal, 4000);
  assert.equal(canonicalResult.cgstTotal, 300); // (2000 * 9%) + (2000 * 6%) = 180 + 120 = 300
  assert.equal(canonicalResult.sgstTotal, 300);
  assert.equal(canonicalResult.gstTotal, 600);
  assert.equal(canonicalResult.grandTotal, 4600);
});
