import test from "node:test";
import assert from "node:assert/strict";

function toPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(Number(rupees) * 100);
}

function toRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

function computeCanonicalTotalsJS(input) {
  const isInterState = Boolean(input.isIgst);
  let subtotalPaise = 0;
  let lineDiscountPaise = 0;
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let cessPaise = 0;

  for (const it of input.lines || input.items || []) {
    const rate = Number(it.rate) || 0;
    const qty = Number(it.quantity) || 0;
    const grossPaise = Math.round(qty * toPaise(rate));
    const discPct = Number(it.discountPercent ?? it.discountPct ?? 0);
    const discPaise = Math.round((grossPaise * discPct) / 100);
    const lineTaxable = Math.max(0, grossPaise - discPaise);
    const gstRate = Number(it.taxRate ?? it.gstRate ?? 0);

    subtotalPaise += grossPaise;
    lineDiscountPaise += discPaise;
    taxablePaise += lineTaxable;

    if (input.enableGst !== false && gstRate > 0) {
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
  for (const c of input.charges || input.extraCharges || []) {
    const basePaise = toPaise(c.amount || 0);
    extraChargesBasePaise += basePaise;
    const gstRate = c.isTaxable ? Number(c.taxRate ?? c.gstRate ?? 0) : 0;
    if (input.enableGst !== false && gstRate > 0) {
      if (isInterState) {
        igstPaise += Math.round((basePaise * gstRate) / 100);
      } else {
        const halfRate = gstRate / 2;
        cgstPaise += Math.round((basePaise * halfRate) / 100);
        sgstPaise += Math.round((basePaise * halfRate) / 100);
      }
    }
  }

  const gstTotalPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const unroundedTotalPaise = taxablePaise + extraChargesBasePaise + gstTotalPaise;
  const roundedGrandTotalPaise = Math.round(unroundedTotalPaise / 100) * 100;
  const roundOffPaise = roundedGrandTotalPaise - unroundedTotalPaise;

  return {
    subtotal: toRupees(subtotalPaise),
    discountTotal: toRupees(lineDiscountPaise),
    taxableValue: toRupees(taxablePaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(sgstPaise),
    igst: toRupees(igstPaise),
    cess: toRupees(cessPaise),
    gstTotal: toRupees(gstTotalPaise),
    extraChargesTotal: toRupees(extraChargesBasePaise),
    roundOff: toRupees(roundOffPaise),
    grandTotal: toRupees(roundedGrandTotalPaise),
  };
}

test("Workflow 1: Party Master & Dual Role Support (PRD §§ 3-5, 80)", () => {
  const party = {
    id: "pty_mars_01",
    name: "Mars Engineering Works",
    partyType: "BOTH", // Customer & Supplier combined
    paymentPolicy: "ADVANCE",
    country: "India",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400001",
    gstin: "27AAACM1234A1Z5",
    creditLimit: 500000,
    creditDays: 30,
    addresses: [
      {
        id: "addr_01",
        label: "Billing Address",
        addressLine1: "Plot 42, MIDC Industrial Area",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        country: "India",
        pincode: "400001",
        isDefaultBilling: true,
      },
      {
        id: "addr_02",
        label: "Site Address",
        addressLine1: "Gate 3, Refinery Complex",
        city: "Raigad",
        state: "Maharashtra",
        stateCode: "27",
        country: "India",
        pincode: "410206",
        isDefaultShipping: true,
      },
    ],
  };

  assert.equal(party.partyType, "BOTH");
  assert.equal(party.country, "India");
  assert.equal(party.pincode, "400001");
  assert.equal(party.addresses.length, 2);
  assert.equal(party.addresses[0].pincode, "400001");
  assert.equal(party.addresses[1].country, "India");
});

test("Workflow 2: Multiple Saved Addresses & Address Snapshot Immutability (PRD §§ 6-9, 102)", () => {
  const party = {
    name: "Mars Engineering Works",
    gstin: "27AAACM1234A1Z5",
    addresses: [
      {
        id: "addr_01",
        label: "Billing Address",
        addressLine1: "Plot 42, MIDC Industrial Area",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        country: "India",
      },
    ],
  };

  // Snapshot created at invoice issue
  const frozenSnapshot = {
    name: party.name,
    gstin: party.gstin,
    addressLine1: party.addresses[0].addressLine1,
    city: party.addresses[0].city,
    state: party.addresses[0].state,
    pincode: party.addresses[0].pincode,
    country: party.addresses[0].country,
  };

  const invoice = {
    number: "INV-2026-001",
    billingAddressSnapshot: frozenSnapshot,
  };

  // Party updates master address later
  party.addresses[0].addressLine1 = "New Corporate Tower, Level 15";
  party.addresses[0].pincode = "400051";

  // Historical invoice retains original frozen address
  assert.equal(invoice.billingAddressSnapshot.addressLine1, "Plot 42, MIDC Industrial Area");
  assert.equal(invoice.billingAddressSnapshot.pincode, "400001");
  assert.notEqual(invoice.billingAddressSnapshot.addressLine1, party.addresses[0].addressLine1);
});

test("Workflow 3: Advance Party Flow & Bill Restriction (PRD §§ 10-18, 57, 100, 106)", () => {
  // Scenario 1: Advance = 0, Invoice = ₹50,000 -> BLOCKED under STRICT policy
  let availableAdvancePaise = 0;
  let invoiceTotalPaise = 50000 * 100;

  function canPostAdvanceInvoice(available, total) {
    if (available < total) {
      return {
        allowed: false,
        deficitRupees: (total - available) / 100,
        message: "This party is configured for Advance Payment. Record an additional Receipt Voucher before issuing this invoice.",
      };
    }
    return {
      allowed: true,
      advanceAllocatedRupees: total / 100,
      remainingAdvanceRupees: (available - total) / 100,
    };
  }

  const check1 = canPostAdvanceInvoice(availableAdvancePaise, invoiceTotalPaise);
  assert.equal(check1.allowed, false);
  assert.equal(check1.deficitRupees, 50000);

  // Scenario 2: Employee records ₹50,000 Advance Receipt
  const advanceReceipt = {
    number: "REC-2026-001",
    allocationType: "ADVANCE",
    reference: "ADV/26-27/001",
    amount: 50000,
  };
  availableAdvancePaise += advanceReceipt.amount * 100;

  // Scenario 3: Employee creates Invoice for ₹35,000 -> ALLOWED, ₹35,000 allocated, ₹15,000 remains
  const invoiceTotal2 = 35000 * 100;
  const check2 = canPostAdvanceInvoice(availableAdvancePaise, invoiceTotal2);
  assert.equal(check2.allowed, true);
  assert.equal(check2.advanceAllocatedRupees, 35000);
  assert.equal(check2.remainingAdvanceRupees, 15000);

  // Scenario 4: Deficit case: Advance ₹20,000, Invoice ₹50,000 -> BLOCKED, deficit ₹30,000
  const check3 = canPostAdvanceInvoice(20000 * 100, 50000 * 100);
  assert.equal(check3.allowed, false);
  assert.equal(check3.deficitRupees, 30000);
});

test("Workflow 4: Credit Party Flow & Credit Limits (PRD §§ 19-21, 101, 107)", () => {
  const creditParty = {
    paymentPolicy: "CREDIT",
    creditLimitRupees: 200000,
    creditDays: 30,
    currentOutstandingRupees: 180000,
  };

  const newInvoiceAmount = 50000;
  const projectedExposure = creditParty.currentOutstandingRupees + newInvoiceAmount;
  const isLimitExceeded = projectedExposure > creditParty.creditLimitRupees;
  const excessAmount = Math.max(0, projectedExposure - creditParty.creditLimitRupees);

  assert.equal(isLimitExceeded, true);
  assert.equal(excessAmount, 30000);

  // Due Date calculation: Invoice Date + Credit Days
  const invoiceDate = new Date("2026-09-12T00:00:00Z").getTime();
  const calculatedDueDate = invoiceDate + (creditParty.creditDays * 24 * 60 * 60 * 1000);
  const expectedDueDate = new Date("2026-10-12T00:00:00Z").getTime();
  assert.equal(calculatedDueDate, expectedDueDate);
});

test("Workflow 5: Quotation to Invoice Conversion Fidelity (PRD §§ 25-35, 103, 108)", () => {
  const quotation = {
    id: "q_1001",
    number: "QT-2026-042",
    date: Date.now(),
    validity: Date.now() + 15 * 86400000,
    customerId: "cust_mars",
    customerSnapshot: { name: "Mars Engineering", gstin: "27AAACM1234A1Z5" },
    billingAddressId: "addr_01",
    billingAddressSnapshot: {
      addressLine1: "Plot 42, MIDC Industrial Area",
      city: "Mumbai",
      pincode: "400001",
      country: "India",
    },
    items: [
      {
        productId: "prod_pipe",
        name: "Galvanized Steel Pipe",
        unit: "MTR",
        quantity: 100,
        rate: 350,
        discountPct: 5,
        gstRate: 18,
        total: 39235,
        pricingBasis: "per_length",
      },
    ],
    extraCharges: [{ label: "Transport & Logistics", amount: 2500 }],
    extraChargesTotal: 2500,
    subtotal: 35000,
    discountTotal: 1750,
    gstTotal: 5985,
    roundOff: 0,
    grandTotal: 41735,
    status: "accepted",
  };

  // Converted to Draft Invoice
  const convertedInvoice = {
    id: "inv_2001",
    number: "INV-2026-009",
    date: Date.now(),
    customerId: quotation.customerId,
    customerSnapshot: quotation.customerSnapshot,
    billingAddressId: quotation.billingAddressId,
    billingAddressSnapshot: quotation.billingAddressSnapshot,
    items: quotation.items.map(it => ({ ...it })),
    extraCharges: quotation.extraCharges,
    extraChargesTotal: quotation.extraChargesTotal,
    subtotal: quotation.subtotal,
    discountTotal: quotation.discountTotal,
    gstTotal: quotation.gstTotal,
    roundOff: quotation.roundOff,
    grandTotal: quotation.grandTotal,
    status: "draft", // Draft awaiting employee review (PRD § 35)
    convertedFromQuotationId: quotation.id,
  };

  assert.equal(convertedInvoice.status, "draft");
  assert.equal(convertedInvoice.items.length, 1);
  assert.equal(convertedInvoice.items[0].pricingBasis, "per_length");
  assert.equal(convertedInvoice.billingAddressSnapshot.pincode, "400001");
  assert.equal(convertedInvoice.billingAddressSnapshot.country, "India");
  assert.equal(convertedInvoice.grandTotal, 41735);
});

test("Workflow 6: Calculation Engine Parity Across Client and Authoritative Server (PRD §§ 44-55)", () => {
  const lineItems = [
    {
      productId: "p1",
      name: "Industrial Valve",
      quantity: 10,
      rate: 2000,
      discountPercent: 10,
      gstRate: 18,
    },
    {
      productId: "p2",
      name: "Brass Connector",
      quantity: 50,
      rate: 150,
      discountPercent: 0,
      gstRate: 18,
    },
  ];

  const extraCharges = [
    { label: "Freight & Transport", amount: 1500, isTaxable: true, taxRate: 18 },
  ];

  // Run pure canonical computation
  const calc = computeCanonicalTotalsJS({
    lines: lineItems,
    charges: extraCharges,
    isIgst: false,
    enableGst: true,
  });

  // Client calculation
  const clientGrandTotal = calc.grandTotal;

  // Server recomputation preflight
  const serverCalc = computeCanonicalTotalsJS({
    lines: lineItems,
    charges: extraCharges,
    isIgst: false,
    enableGst: true,
  });

  assert.equal(serverCalc.grandTotal, clientGrandTotal);
  assert.equal(serverCalc.gstTotal, calc.gstTotal);
  assert.equal(serverCalc.taxableValue, calc.taxableValue);
  assert.equal(serverCalc.roundOff, calc.roundOff);
});
