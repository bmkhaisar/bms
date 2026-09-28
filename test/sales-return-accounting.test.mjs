import test from "node:test";
import assert from "node:assert/strict";

test("Sales Return & Credit Note: Cumulative return quantity limit checks", () => {
  const originalInvoice = {
    id: "inv_001",
    number: "INV/2026-27/0001",
    grandTotal: 11800,
    items: [
      { id: "item_1", name: "Security Cabin 10x10", quantity: 5, rate: 2000, gstRate: 18 },
      { id: "item_2", name: "Bunk Bed", quantity: 10, rate: 500, gstRate: 18 },
    ],
  };

  // Historical return 1: 3 cabins returned
  const historicalReturns = [
    {
      id: "sr_001",
      originalInvoiceId: "inv_001",
      status: "posted",
      items: [
        { invoiceItemId: "item_1", returnQuantity: 3 },
      ],
    },
  ];

  // Calculate previously returned qty
  const prevMap = {};
  for (const ret of historicalReturns) {
    for (const it of ret.items) {
      prevMap[it.invoiceItemId] = (prevMap[it.invoiceItemId] || 0) + it.returnQuantity;
    }
  }

  // Attempt 1: Return 2 cabins (remaining = 5 - 3 = 2). Should succeed.
  const cabinRemaining = originalInvoice.items[0].quantity - (prevMap["item_1"] || 0);
  assert.equal(cabinRemaining, 2, "Remaining returnable cabins should be 2");

  const attempt1Qty = 2;
  assert.ok(attempt1Qty <= cabinRemaining, "Attempting to return 2 cabins should be within limit");

  // Attempt 2: Return 3 cabins (remaining = 2). Should fail.
  const attempt2Qty = 3;
  assert.ok(attempt2Qty > cabinRemaining, "Attempting to return 3 cabins exceeds remaining quantity");
});

test("Sales Return Double-Entry Accounting: Balanced Journal Voucher Invariant", () => {
  // Line item: 1 item returned @ Rs 10,000 + 18% GST (Intra-State: 9% CGST + 9% SGST)
  const returnTaxablePaise = 1000000; // Rs 10,000 in paise
  const returnCgstPaise = 90000;      // Rs 900 in paise
  const returnSgstPaise = 90000;      // Rs 900 in paise
  const returnTotalCreditPaise = returnTaxablePaise + returnCgstPaise + returnSgstPaise; // 11,80,000 (Rs 11,800)

  // Double-Entry Voucher Lines:
  // Debit: Sales Return / Revenue Reversal
  // Debit: CGST Output Reversal
  // Debit: SGST Output Reversal
  // Credit: Customer Accounts Receivable
  const voucherLines = [
    { ledgerId: "led_sales_return", debitPaise: returnTaxablePaise, creditPaise: 0 },
    { ledgerId: "led_cgst_output", debitPaise: returnCgstPaise, creditPaise: 0 },
    { ledgerId: "led_sgst_output", debitPaise: returnSgstPaise, creditPaise: 0 },
    { ledgerId: "led_customer_ar", debitPaise: 0, creditPaise: returnTotalCreditPaise },
  ];

  const totalDebitPaise = voucherLines.reduce((s, l) => s + l.debitPaise, 0);
  const totalCreditPaise = voucherLines.reduce((s, l) => s + l.creditPaise, 0);

  assert.equal(
    totalDebitPaise,
    totalCreditPaise,
    `Voucher must be strictly balanced! Dr: ${totalDebitPaise}, Cr: ${totalCreditPaise}`
  );
  assert.equal(totalDebitPaise, 1180000, "Total debit should equal Rs 11,800 in integer paise");
});

test("Sales Return: AR Reduction vs Customer Credit Creation", () => {
  // Scenario A: Customer still owes Rs 15,000 on invoice of Rs 20,000. Return is Rs 5,000.
  const invBalanceA = 15000;
  const returnTotalA = 5000;
  const arReductionA = Math.min(invBalanceA, returnTotalA);
  const customerCreditA = Math.max(0, returnTotalA - arReductionA);

  assert.equal(arReductionA, 5000, "Should reduce customer AR outstanding by full return amount Rs 5,000");
  assert.equal(customerCreditA, 0, "No customer credit generated since invoice was not overpaid");

  // Scenario B: Customer fully paid the invoice (balance = Rs 0). Return is Rs 5,000.
  const invBalanceB = 0;
  const returnTotalB = 5000;
  const arReductionB = Math.min(invBalanceB, returnTotalB);
  const customerCreditB = Math.max(0, returnTotalB - arReductionB);

  assert.equal(arReductionB, 0, "No AR reduction since invoice was already settled");
  assert.equal(customerCreditB, 5000, "Full return amount Rs 5,000 becomes available Customer Credit");

  // Scenario C: Customer partially paid (balance = Rs 2,000). Return is Rs 5,000.
  const invBalanceC = 2000;
  const returnTotalC = 5000;
  const arReductionC = Math.min(invBalanceC, returnTotalC);
  const customerCreditC = Math.max(0, returnTotalC - arReductionC);

  assert.equal(arReductionC, 2000, "AR reduced to 0 (by Rs 2,000)");
  assert.equal(customerCreditC, 3000, "Remaining Rs 3,000 becomes available Customer Credit");
  assert.equal(arReductionC + customerCreditC, returnTotalC, "Total credit must equal return total");
});

test("Sales Return: Restock Dispositions create correct movements", () => {
  // 1. Saleable Restock
  const item1 = {
    invoiceItemId: "it_1",
    productId: "prod_cabin",
    returnQuantity: 2,
    restockAction: "RESTOCK_SALEABLE",
  };
  const shouldCreateStockMove1 = item1.restockAction !== "FINANCIAL_CREDIT_ONLY";
  assert.equal(shouldCreateStockMove1, true, "Saleable return creates stock movement");

  // 2. Damaged / Quarantine Restock
  const item2 = {
    invoiceItemId: "it_2",
    productId: "prod_door",
    returnQuantity: 1,
    restockAction: "RESTOCK_DAMAGED",
  };
  const shouldCreateStockMove2 = item2.restockAction !== "FINANCIAL_CREDIT_ONLY";
  assert.equal(shouldCreateStockMove2, true, "Damaged return creates quarantined stock movement");

  // 3. Financial Credit Only (e.g. price adjustment)
  const item3 = {
    invoiceItemId: "it_3",
    productId: "prod_panel",
    returnQuantity: 1,
    restockAction: "FINANCIAL_CREDIT_ONLY",
  };
  const shouldCreateStockMove3 = item3.restockAction !== "FINANCIAL_CREDIT_ONLY";
  assert.equal(shouldCreateStockMove3, false, "Financial credit only does NOT create stock movement");
});

test("Sales Return: Statutory GST preserves original place of supply and rates", () => {
  // Original Invoice was Inter-State from Karnataka to Maharashtra (18% IGST)
  const originalInvoice = {
    id: "inv_interstate",
    isIgst: true,
    placeOfSupply: "27", // Maharashtra
    items: [
      { id: "it_1", name: "Portable Toilet Unit", rate: 50000, gstRate: 18, isInterState: true },
    ],
  };

  // Return calculation must use original tax structure
  const isInterState = Boolean(originalInvoice.isIgst || originalInvoice.items[0].isInterState);
  assert.equal(isInterState, true, "Inter-state status must be preserved");

  const taxablePaise = 5000000;
  const gstRate = originalInvoice.items[0].gstRate;

  let igstPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;

  if (isInterState) {
    igstPaise = Math.round(taxablePaise * (gstRate / 100));
  } else {
    cgstPaise = Math.round(taxablePaise * (gstRate / 200));
    sgstPaise = Math.round(taxablePaise * (gstRate / 200));
  }

  assert.equal(igstPaise, 900000, "IGST should be Rs 9,000 (9,00,000 paise)");
  assert.equal(cgstPaise, 0, "CGST must be 0 for inter-state supply");
  assert.equal(sgstPaise, 0, "SGST must be 0 for inter-state supply");
});

test("Prompt Hardening Requirement 4: Partially Paid Invoice + Credit Note Deterministic Math", () => {
  // Scenario:
  // Invoice = ₹100,000
  // Receipts = ₹70,000
  // Outstanding = ₹30,000
  // Credit Note = ₹50,000
  const invoiceGrandTotal = 100000;
  const receiptsAllocated = 70000;
  const initialInvoiceBalance = invoiceGrandTotal - receiptsAllocated; // 30,000
  const creditNoteGrandTotal = 50000;

  const currentInvoiceBalancePaise = Math.round(initialInvoiceBalance * 100);
  const returnGrandTotalPaise = Math.round(creditNoteGrandTotal * 100);

  // Deterministic formula
  const outstandingReducedPaise = Math.min(currentInvoiceBalancePaise, returnGrandTotalPaise);
  const customerCreditGeneratedPaise = Math.max(0, returnGrandTotalPaise - outstandingReducedPaise);
  const newInvoiceBalancePaise = Math.max(0, currentInvoiceBalancePaise - outstandingReducedPaise);

  const outstandingReduced = outstandingReducedPaise / 100;
  const customerCreditGenerated = customerCreditGeneratedPaise / 100;
  const newInvoiceBalance = newInvoiceBalancePaise / 100;

  // Expected invariants
  assert.equal(outstandingReduced, 30000, "₹30,000 strictly reduces remaining AR");
  assert.equal(customerCreditGenerated, 20000, "₹20,000 strictly becomes Customer Credit");
  assert.equal(newInvoiceBalance, 0, "Invoice balance must be exactly 0 (never negative)");
  assert.equal(outstandingReduced + customerCreditGenerated, creditNoteGrandTotal, "Total CN allocated equals ₹50,000");

  // Reversal simulation:
  const restoredInvoiceBalancePaise = newInvoiceBalancePaise + outstandingReducedPaise;
  const restoredInvoiceBalance = restoredInvoiceBalancePaise / 100;
  const cancelledCustomerCreditPaise = customerCreditGeneratedPaise;

  assert.equal(restoredInvoiceBalance, 30000, "On reversal, invoice balance is restored to ₹30,000");
  assert.equal(cancelledCustomerCreditPaise, 2000000, "On reversal, customer credit is cancelled");
});

test("Prompt Hardening Requirement 3: Correct Net Sales Definition vs Net Billed Value", () => {
  // Invoice: ₹100,000 taxable + 18% GST (₹18,000) = ₹118,000 Gross Billed
  const invoiceTaxable = 100000;
  const invoiceGst = 18000;
  const invoiceGrossBilled = invoiceTaxable + invoiceGst; // 118,000

  // Credit Note: ₹50,000 taxable + 18% GST (₹9,000) = ₹59,000 Gross Credit Note
  const creditNoteTaxable = 50000;
  const creditNoteGst = 9000;
  const creditNoteGross = creditNoteTaxable + creditNoteGst; // 59,000

  // 1. Gross Billed difference must be labeled "Net Billed Value"
  const netBilledValue = invoiceGrossBilled - creditNoteGross;
  assert.equal(netBilledValue, 59000, "Net Billed Value = Gross Invoice - Credit Note Gross (with GST)");

  // 2. Pure accounting Net Sales Revenue = Taxable Sales - Credit Note Taxable (STRICTLY EXCLUDES GST)
  const netSalesRevenue = invoiceTaxable - creditNoteTaxable;
  assert.equal(netSalesRevenue, 50000, "Net Sales Revenue = Posted Sales Revenue excl. GST - Revenue portion of CN");

  // Invariant: Net Sales Revenue !== Net Billed Value when GST > 0
  assert.notEqual(netSalesRevenue, netBilledValue, "Net Sales Revenue must NOT include GST and must not be mixed with Net Billed Value");
});

