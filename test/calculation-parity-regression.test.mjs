import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure Canonical Calculation Logic (Pure JS mirror for Node test runner)
 */
function toPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(Number(rupees) * 100);
}

function toRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

function calculateCanonicalTotalsJS(input) {
  const isInterState = input.placeOfSupply !== input.companyStateCode;
  let subtotalPaise = 0;
  let lineDiscountPaise = 0;
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let cessPaise = 0;

  for (const it of input.items || []) {
    const rate = Number(it.rate) || 0;
    const qty = Number(it.quantity) || 0;
    const grossPaise = Math.round(qty * toPaise(rate));
    const discPct = Number(it.discountPct) || 0;
    const discPaise = Math.round((grossPaise * discPct) / 100);
    const lineTaxable = Math.max(0, grossPaise - discPaise);
    const gstRate = Number(it.gstRate) || 0;

    subtotalPaise += grossPaise;
    lineDiscountPaise += discPaise;
    taxablePaise += lineTaxable;

    if (gstRate > 0) {
      if (isInterState) {
        igstPaise += Math.round((lineTaxable * gstRate) / 100);
      } else {
        const halfRate = gstRate / 2;
        cgstPaise += Math.round((lineTaxable * halfRate) / 100);
        sgstPaise += Math.round((lineTaxable * halfRate) / 100);
      }
    }
  }

  let extraChargesBasePaise = 0;
  let extraChargesTaxPaise = 0;

  for (const c of input.extraCharges || []) {
    const basePaise = toPaise(c.amount || 0);
    extraChargesBasePaise += basePaise;
    const gstRate = c.isTaxable ? Number(c.gstRate) || 0 : 0;
    if (gstRate > 0) {
      if (isInterState) {
        const tax = Math.round((basePaise * gstRate) / 100);
        igstPaise += tax;
        extraChargesTaxPaise += tax;
      } else {
        const halfRate = gstRate / 2;
        const halfTax = Math.round((basePaise * halfRate) / 100);
        cgstPaise += halfTax;
        sgstPaise += halfTax;
        extraChargesTaxPaise += halfTax * 2;
      }
    }
  }

  const totalGstPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const netBeforeRoundPaise = taxablePaise + totalGstPaise + extraChargesBasePaise;
  const grandTotalPaise = Math.round(netBeforeRoundPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - netBeforeRoundPaise;

  return {
    subtotal: toRupees(subtotalPaise),
    totalDiscount: toRupees(lineDiscountPaise),
    taxableAmount: toRupees(taxablePaise),
    gstTotal: toRupees(totalGstPaise),
    cgstTotal: toRupees(cgstPaise),
    sgstTotal: toRupees(sgstPaise),
    igstTotal: toRupees(igstPaise),
    cessTotal: toRupees(cessPaise),
    extraChargesTotal: toRupees(extraChargesBasePaise),
    extraChargesTaxTotal: toRupees(extraChargesTaxPaise),
    roundOff: toRupees(roundOffPaise),
    grandTotal: toRupees(grandTotalPaise),
    isInterState,
  };
}

function extractCanonicalInputFromInvoiceJS(invoice, company) {
  const companyState = company?.state || "27";
  const placeOfSupply = invoice.placeOfSupply || invoice.customerSnapshot?.state || companyState;

  const items = (invoice.items || []).map((it) => {
    const gstRate = it.gstRate !== undefined ? Number(it.gstRate) : it.taxRate !== undefined ? Number(it.taxRate) : 0;
    const discountPct = it.discountPct !== undefined ? Number(it.discountPct) : it.discountPercent !== undefined ? Number(it.discountPercent) : 0;
    return {
      name: it.name || "Item",
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      discountPct,
      gstRate,
    };
  });

  const extraCharges = (invoice.extraCharges || []).map((c) => ({
    name: c.name || c.label || "Charge",
    amount: Number(c.amount) || 0,
    isTaxable: c.isTaxable !== false,
    gstRate: c.gstRate !== undefined ? Number(c.gstRate) : c.taxRate !== undefined ? Number(c.taxRate) : 0,
  }));

  return {
    items,
    extraCharges,
    companyStateCode: companyState,
    placeOfSupply,
  };
}

test("Calculation Parity 1: Reproduce ₹291,000 client vs ₹255,000 server bug mechanism", () => {
  // Real client scenario observed in production:
  // Item: Industrial Assembly ₹200,000 with 18% GST (₹36,000)
  // Extra charge: Freight & Transport ₹55,000 non-taxable
  // Expected commercial grandTotal: 200,000 + 36,000 + 55,000 = ₹291,000
  const invoicePayload = {
    id: "inv-repro-01",
    number: "INV-26-27/001",
    date: Date.now(),
    customerId: "cust-mars",
    customerSnapshot: { state: "27", name: "Mars Engineering" },
    items: [
      {
        productId: "p1",
        name: "Industrial Assembly",
        quantity: 1,
        rate: 200000,
        gstRate: 18, // In UI LineItem, property is gstRate
        taxRate: undefined, // In old server code, it.taxRate was checked and was undefined!
        discountPct: 0,
      },
    ],
    extraCharges: [
      {
        name: "Freight & Transport",
        amount: 55000,
        isTaxable: false,
        taxRate: 0,
      },
    ],
    grandTotal: 291000,
  };

  const company = {
    state: "27",
    taxRegistrationMode: "NORMAL_GST",
  };

  // 1. OLD BUGGY SERVER:
  // Evaluated `gstRate: it.taxRate || 0`
  // Since it.taxRate was undefined, gstRate became 0!
  const buggyServerItems = invoicePayload.items.map((it) => ({
    ...it,
    gstRate: it.taxRate || 0, // Old bug!
  }));
  const buggyInput = {
    items: buggyServerItems,
    extraCharges: invoicePayload.extraCharges,
    companyStateCode: "27",
    placeOfSupply: "27",
  };
  const buggyResult = calculateCanonicalTotalsJS(buggyInput);

  assert.equal(buggyResult.grandTotal, 255000, "Old buggy server recomputed ₹255,000");
  assert.equal(invoicePayload.grandTotal, 291000, "Client payload claimed ₹291,000");
  assert.equal(Math.abs(invoicePayload.grandTotal - buggyResult.grandTotal), 36000, "Observed discrepancy was exactly ₹36,000 (18% of ₹200,000)");

  // 2. CANONICAL CONTRACT FIX:
  // With extractCanonicalInputFromInvoice, gstRate falls back to it.gstRate ?? it.taxRate ?? 0
  const canonicalInput = extractCanonicalInputFromInvoiceJS(invoicePayload, company);
  const authoritative = calculateCanonicalTotalsJS(canonicalInput);

  assert.equal(authoritative.grandTotal, 291000, "Authoritative recomputation produces exact ₹291,000");
  assert.equal(authoritative.subtotal, 200000);
  assert.equal(authoritative.gstTotal, 36000);
  assert.equal(authoritative.cgstTotal, 18000);
  assert.equal(authoritative.sgstTotal, 18000);
  assert.equal(authoritative.extraChargesTotal, 55000);

  // Client and Server results match with 0.00 drift!
  const diff = Math.abs(invoicePayload.grandTotal - authoritative.grandTotal);
  assert.equal(diff, 0, "Discrepancy eliminated through canonical contract");
});

test("Calculation Parity 2: Interstate IGST with mixed rates and taxable freight", () => {
  const invoice = {
    id: "inv-repro-02",
    number: "INV-26-27/002",
    date: Date.now(),
    placeOfSupply: "29", // Karnataka (Interstate from MH 27)
    items: [
      {
        name: "Item A (18%)",
        quantity: 10,
        rate: 1000,
        gstRate: 18,
        discountPct: 10, // Gross 10,000 - 1,000 discount = 9,000 taxable. 18% IGST = 1,620
      },
      {
        name: "Item B (5%)",
        quantity: 5,
        rate: 2000,
        gstRate: 5,
        discountPct: 0, // Gross 10,000. 5% IGST = 500
      },
    ],
    extraCharges: [
      {
        name: "Taxable Transport (18%)",
        amount: 2000,
        isTaxable: true,
        gstRate: 18, // 2,000 + 18% IGST (360) = 2,360
      },
    ],
  };

  const company = { state: "27", taxRegistrationMode: "NORMAL_GST" };
  const input = extractCanonicalInputFromInvoiceJS(invoice, company);
  const result = calculateCanonicalTotalsJS(input);

  assert.equal(result.isInterState, true);
  assert.equal(result.taxableAmount, 19000);
  assert.equal(result.extraChargesTotal, 2000);
  assert.equal(result.igstTotal, 2480);
  assert.equal(result.cgstTotal, 0);
  assert.equal(result.sgstTotal, 0);
  assert.equal(result.grandTotal, 23480);
});

test("Calculation Parity 3: Document-level preflight validation rejects real tampering", () => {
  const invoice = {
    items: [{ quantity: 1, rate: 1000, gstRate: 18 }],
    grandTotal: 500, // Tampered client payload claiming 500 when reality is 1180
  };
  const company = { state: "27" };
  const input = extractCanonicalInputFromInvoiceJS(invoice, company);
  const authoritative = calculateCanonicalTotalsJS(input);

  const matches = Math.abs(invoice.grandTotal - authoritative.grandTotal) <= 1.0;
  assert.equal(matches, false, "Tampered payload must be flagged for recalculation / rejection");
  assert.equal(authoritative.grandTotal, 1180);
});
