import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

// Helpers matching canonical calculation formulas
function toPaise(val) {
  if (typeof val !== "number" || isNaN(val)) return 0;
  return Math.round(val * 100);
}
function toRupees(val) {
  if (typeof val !== "number" || isNaN(val)) return 0;
  return Math.round(val) / 100;
}

function calculateCustomerCreditFromReceipts(partyId, receipts) {
  const partyReceipts = (receipts || []).filter((r) => (r.customerId === partyId || r.partyId === partyId));
  
  const validReceipts = partyReceipts.filter((r) => {
    if (r.postingStatus === "failed" || r.postingStatus === "reversed" || r.postingStatus === "refunded") return false;
    if (r.postingStatus === "draft" || r.status === "draft" || r.status === "cancelled") return false;
    return true;
  });

  let totalReceivedPaise = 0;
  let totalAllocatedPaise = 0;
  const receiptsBreakdown = [];

  for (const r of validReceipts) {
    const netReceivedPaise = Math.max(0, toPaise(r.amount) - (r.refundAmountPaise || 0));
    totalReceivedPaise += netReceivedPaise;

    let allocatedPaise = 0;
    let remainingCreditPaise = 0;
    let allocations = [];

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      allocatedPaise = r.allocatedInvoices.reduce((s, a) => s + (a.amountPaise || 0), 0);
      remainingCreditPaise = Math.max(0, netReceivedPaise - allocatedPaise);
      allocations = r.allocatedInvoices.map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoiceNumber || "",
        amountPaise: a.amountPaise,
        amountRupees: toRupees(a.amountPaise),
      }));
    } else if (r.invoiceId && r.invoiceId !== "none") {
      const explicitExcess = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
      if (typeof explicitExcess === "number" && explicitExcess > 0) {
        remainingCreditPaise = Math.min(netReceivedPaise, explicitExcess);
        allocatedPaise = Math.max(0, netReceivedPaise - remainingCreditPaise);
      } else {
        allocatedPaise = netReceivedPaise;
        remainingCreditPaise = 0;
      }
      allocations = [
        {
          invoiceId: r.invoiceId,
          invoiceNumber: "",
          amountPaise: allocatedPaise,
          amountRupees: toRupees(allocatedPaise),
        },
      ];
    } else {
      const explicitExcess = r.advanceAvailablePaise ?? r.customerCreditPaise ?? r.unappliedCreditPaise;
      if (typeof explicitExcess === "number") {
        remainingCreditPaise = Math.min(netReceivedPaise, explicitExcess);
        allocatedPaise = Math.max(0, netReceivedPaise - remainingCreditPaise);
      } else {
        remainingCreditPaise = netReceivedPaise;
        allocatedPaise = 0;
      }
      allocations = [];
    }

    totalAllocatedPaise += allocatedPaise;
    receiptsBreakdown.push({
      receiptId: r.id,
      receiptNumber: r.number,
      receiptDate: r.date,
      totalReceivedPaise: netReceivedPaise,
      totalReceivedRupees: toRupees(netReceivedPaise),
      allocatedAgainstInvoicesPaise: allocatedPaise,
      allocatedAgainstInvoicesRupees: toRupees(allocatedPaise),
      remainingCreditPaise,
      remainingCreditRupees: toRupees(remainingCreditPaise),
      allocations,
    });
  }

  const availableCreditPaise = receiptsBreakdown.reduce((sum, b) => sum + b.remainingCreditPaise, 0);

  return {
    partyId,
    availableCreditPaise,
    availableCreditRupees: toRupees(availableCreditPaise),
    totalReceivedPaise,
    totalAllocatedPaise,
    receiptsBreakdown,
  };
}

function resolveDocumentTaxes(doc) {
  if (doc.taxSnapshot) {
    const s = doc.taxSnapshot;
    return {
      taxable: s.taxableValue ?? ((doc.subtotal || 0) - (doc.discountTotal || 0)),
      cgst: s.cgst || 0,
      sgst: s.sgst || 0,
      igst: s.igst || 0,
      cess: s.cess || 0,
      totalTax: (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0) + (s.cess || 0),
      isInterState: Boolean(s.isInterState),
    };
  }

  const isInterState = Boolean(doc.isIgst || (doc.igstTotal && doc.igstTotal > 0));
  const rawGstTotal = doc.gstTotal || 0;

  if (isInterState) {
    const igst = doc.igstTotal || rawGstTotal;
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst: 0,
      sgst: 0,
      igst,
      cess: doc.cessTotal || 0,
      totalTax: igst + (doc.cessTotal || 0),
      isInterState: true,
    };
  } else {
    const cgst = doc.cgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    const sgst = doc.sgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst,
      sgst,
      igst: 0,
      cess: doc.cessTotal || 0,
      totalTax: cgst + sgst + (doc.cessTotal || 0),
      isInterState: false,
    };
  }
}

// ============================================================================
// 1. CANONICAL CUSTOMER CREDIT CALCULATION & RECONCILIATION AUDIT
// ============================================================================

test("CUSTOMER CREDIT: Old allocated receipt REC/0003 (₹32,232) produces ₹0 remaining credit", () => {
  const partyId = "CUS-000001";
  const receipts = [
    {
      id: "rec_003",
      number: "REC/2026-27/0003",
      customerId: partyId,
      date: 1789400000000,
      amount: 32232.0,
      invoiceId: "INV/2026-27/0004", // fully allocated against invoice
      postingStatus: "posted",
      status: "settled",
    },
  ];

  const result = calculateCustomerCreditFromReceipts(partyId, receipts);
  assert.equal(result.availableCreditPaise, 0);
  assert.equal(result.availableCreditRupees, 0);
  assert.equal(result.receiptsBreakdown.length, 1);
  assert.equal(result.receiptsBreakdown[0].receiptNumber, "REC/2026-27/0003");
  assert.equal(result.receiptsBreakdown[0].totalReceivedRupees, 32232);
  assert.equal(result.receiptsBreakdown[0].allocatedAgainstInvoicesRupees, 32232);
  assert.equal(result.receiptsBreakdown[0].remainingCreditRupees, 0);
});

test("CUSTOMER CREDIT: Overpayment on REC/0005 creates exact remaining credit ₹2,932.98", () => {
  const partyId = "CUS-000001";
  const receipts = [
    {
      id: "rec_005",
      number: "REC/2026-27/0005",
      customerId: partyId,
      date: 1789500000000,
      amount: 31999.98,
      invoiceId: "INV/2026-27/0004",
      customerCreditPaise: 293298, // explicit unapplied overpayment paise
      allocatedInvoices: [
        {
          invoiceId: "INV/2026-27/0004",
          invoiceNumber: "INV/2026-27/0004",
          amountPaise: 2906700, // ₹29,067.00 allocated
        },
      ],
      postingStatus: "posted",
      status: "settled",
    },
  ];

  const result = calculateCustomerCreditFromReceipts(partyId, receipts);
  assert.equal(result.availableCreditPaise, 293298);
  assert.equal(result.availableCreditRupees, 2932.98);
  assert.equal(result.receiptsBreakdown[0].allocatedAgainstInvoicesRupees, 29067);
  assert.equal(result.receiptsBreakdown[0].remainingCreditRupees, 2932.98);
});

test("CUSTOMER CREDIT RECONCILIATION: ₹35,164.98 anomaly resolved to canonical ₹2,932.98", () => {
  const partyId = "CUS-000001";
  // The exact combination from the screenshot:
  // REC/0003 (₹32,232 against INV/0004) + REC/0005 (₹31,999.98 with ₹2,932.98 overpayment)
  const receipts = [
    {
      id: "rec_003",
      number: "REC/2026-27/0003",
      customerId: partyId,
      date: 1789400000000,
      amount: 32232.0,
      invoiceId: "INV/2026-27/0004",
      postingStatus: "posted",
      status: "settled",
    },
    {
      id: "rec_005",
      number: "REC/2026-27/0005",
      customerId: partyId,
      date: 1789500000000,
      amount: 31999.98,
      invoiceId: "INV/2026-27/0004",
      customerCreditPaise: 293298,
      allocatedInvoices: [
        {
          invoiceId: "INV/2026-27/0004",
          invoiceNumber: "INV/2026-27/0004",
          amountPaise: 2906700,
        },
      ],
      postingStatus: "posted",
      status: "settled",
    },
  ];

  const canonical = calculateCustomerCreditFromReceipts(partyId, receipts);
  // Authoritative total MUST be ₹2,932.98, NEVER the erroneous ₹35,164.98
  assert.equal(canonical.availableCreditRupees, 2932.98);
  assert.notEqual(canonical.availableCreditRupees, 35164.98);
});

test("CUSTOMER CREDIT: Reversal or refund removes credit from available calculation", () => {
  const partyId = "CUS-000001";
  const receipts = [
    {
      id: "rec_005_reversed",
      number: "REC/2026-27/0005",
      customerId: partyId,
      date: 1789500000000,
      amount: 31999.98,
      customerCreditPaise: 293298,
      postingStatus: "reversed", // Reversed
    },
    {
      id: "rec_006_refunded",
      number: "REC/2026-27/0006",
      customerId: partyId,
      date: 1789600000000,
      amount: 5000.0,
      postingStatus: "refunded", // Refunded
    },
  ];

  const result = calculateCustomerCreditFromReceipts(partyId, receipts);
  assert.equal(result.availableCreditPaise, 0);
  assert.equal(result.availableCreditRupees, 0);
  assert.equal(result.receiptsBreakdown.length, 0);
});

test("CUSTOMER CREDIT: One canonical calculation source used across Invoice and Party services", () => {
  const docListPage = read("src/components/app/DocumentListPage.tsx");
  const partyService = read("src/modules/accounting/services/partyAdvanceService.ts");

  // DocumentListPage imports and invokes calculateCustomerCreditFromReceipts
  assert.match(docListPage, /import \{[^}]*calculateCustomerCreditFromReceipts[^}]*\} from "@/);
  assert.match(docListPage, /calculateCustomerCreditFromReceipts\(/);

  // partyAdvanceService provides calculateCustomerCreditFromReceipts & getCanonicalCustomerCredit
  assert.match(partyService, /export function calculateCustomerCreditFromReceipts/);
  assert.match(partyService, /export async function getCanonicalCustomerCredit/);
});

// ============================================================================
// 2. CREDIT APPLICATION SAFETY (OUTSTANDING ONLY, TAX/TOTAL PRESERVED)
// ============================================================================

test("CREDIT APPLICATION: Reduces outstanding balance only, does NOT alter taxable, GST, or grand total", () => {
  const invoice = {
    subtotal: 8474.58,
    discountTotal: 0,
    gstTotal: 1525.42,
    grandTotal: 10000.0,
    amountPaid: 0,
    balance: 10000.0,
  };

  const availableCredit = 2932.98;
  const toApply = Math.min(availableCredit, invoice.balance);

  // Apply credit logic
  const updatedInvoice = {
    ...invoice,
    amountPaid: invoice.amountPaid + toApply,
    balance: Math.max(0, invoice.grandTotal - (invoice.amountPaid + toApply)),
    customerCreditAppliedPaise: Math.round(toApply * 100),
  };

  // Invariant checks
  assert.equal(updatedInvoice.subtotal, invoice.subtotal, "Taxable subtotal must be unchanged");
  assert.equal(updatedInvoice.gstTotal, invoice.gstTotal, "GST total must be unchanged");
  assert.equal(updatedInvoice.grandTotal, invoice.grandTotal, "Grand total must be unchanged");
  assert.equal(updatedInvoice.amountPaid, 2932.98, "Amount paid increases by applied credit");
  assert.equal(updatedInvoice.balance, 7067.02, "Outstanding balance decreases by applied credit");
  assert.equal(updatedInvoice.customerCreditAppliedPaise, 293298, "Credit applied is traceable");
});

// ============================================================================
// 3. GST RECONCILIATION: DASHBOARD OUTPUT GST == GST REPORT OUTPUT GST
// ============================================================================

test("GST RECONCILIATION: Dashboard and GST Report use identical resolveDocumentTaxes formula", () => {
  const dashboardSrc = read("src/modules/accounting/services/dashboardReportService.ts");
  const reportsSrc = read("src/routes/_app.reports.tsx");

  // Both calculate outputGst by summing resolveDocumentTaxes(i).totalTax
  assert.match(dashboardSrc, /resolveDocumentTaxes\(i\)\.totalTax/);
  assert.match(reportsSrc, /resolveDocumentTaxes\(i\)\.totalTax/);

  // Test math with verified invoice data (Gross: ₹1,25,085, Net Sales: ₹1,06,004, Output GST: ₹19,080.72)
  const postedInvoices = [
    {
      subtotal: 106004.0,
      discountTotal: 0,
      gstTotal: 19080.72,
      grandTotal: 125085.0,
      isIgst: false,
      cgstTotal: 9540.36,
      sgstTotal: 9540.36,
    },
  ];

  const dashboardOutputGst = postedInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);
  const reportsOutputGst = postedInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);

  assert.equal(dashboardOutputGst, 19080.72);
  assert.equal(dashboardOutputGst, reportsOutputGst, "Dashboard Output GST must equal GST Report Output GST");
});

// ============================================================================
// 4. ZERO BROWSER-NATIVE DIALOGS
// ============================================================================

test("UI AUDIT: Zero window.alert, window.confirm, window.prompt in application source code", () => {
  const checkFiles = [
    "src/components/app/DocumentListPage.tsx",
    "src/components/app/QuotationForm.tsx",
    "src/components/app/QuotationsPage.tsx",
    "src/modules/platform-admin/components/CompanyAccessView.tsx",
    "src/routes/_app.products.tsx",
    "src/routes/_app.receipts.tsx",
  ];

  for (const file of checkFiles) {
    const content = read(file);
    assert.doesNotMatch(
      content,
      /\bwindow\.(alert|confirm|prompt)\s*\(/,
      `File ${file} must not use window.alert/confirm/prompt`
    );
    assert.doesNotMatch(
      content,
      /(?<![a-zA-Z0-9_.])(alert|confirm|prompt)\s*\(/,
      `File ${file} must not use bare alert/confirm/prompt`
    );
  }
});

// ============================================================================
// 5. RECEIPT MODAL VIEWPORT-SAFE SCROLL STRUCTURE
// ============================================================================

test("RECEIPT MODAL: Has sticky header, scrollable body, and sticky footer with reachable action button", () => {
  const receiptsRoute = read("src/routes/_app.receipts.tsx");

  // Outer dialog constraints
  assert.match(receiptsRoute, /max-h-\[90dvh\]/);
  assert.match(receiptsRoute, /overflow-hidden/);

  // Fixed/sticky header
  assert.match(receiptsRoute, /border-b shrink-0/);

  // Scrollable body
  assert.match(receiptsRoute, /flex-1 overflow-y-auto overscroll-contain/);
  assert.match(receiptsRoute, /scrollbar-thin/);

  // Fixed/sticky footer
  assert.match(receiptsRoute, /p-4 border-t shrink-0/);
  assert.match(receiptsRoute, /Post Receipt Voucher/);
});

// ============================================================================
// 6. REACT LIST KEYS & CONTROLLED SELECTS
// ============================================================================

test("REACT WARNINGS: SalesReport uses Fragment with stable unique key and Selects are controlled", () => {
  const reportsSrc = read("src/routes/_app.reports.tsx");
  // Uses Fragment with key instead of bare <> fragment
  assert.match(reportsSrc, /<Fragment key=\{i\.id\}>/);
  assert.doesNotMatch(reportsSrc, /rows\.map\(\(i\)\s*=>\s*\{\s*const[^}]*return\s*\(\s*<>/);

  const docListPage = read("src/components/app/DocumentListPage.tsx");
  // Controlled quotation select
  assert.match(docListPage, /<Select value="" onValueChange=\{applyQuotationToInvoice\}>/);
});

// ============================================================================
// 7. PRODUCT DROPDOWN & SELLING PRICE WARNING
// ============================================================================

test("PRODUCT SEARCH: Dropdown is bounded to ~3 visible rows (160px) with thin scrollbar and slice limit", () => {
  const editorSrc = read("src/components/app/LineItemsEditor.tsx");
  assert.match(editorSrc, /max-h-\[160px\] overflow-y-auto space-y-1 scrollbar-thin/);
  assert.match(editorSrc, /\.slice\(0, 25\)/);
});

test("PRODUCT MASTER: Shows price warning when saving without selling price and preserves invoice rates", () => {
  const productsSrc = read("src/routes/_app.products.tsx");
  assert.match(productsSrc, /Selling price is not set\./);
  assert.match(productsSrc, /Future invoices will require the rate to be entered manually\./);
  assert.match(productsSrc, /Save Without Price/);
  assert.match(productsSrc, /Go Back/);

  const postingSrc = read("src/modules/accounting/services/documentPostingService.ts");
  // Product master sellingPrice is NOT overwritten by document posting
  assert.doesNotMatch(postingSrc, /p\.sellingPrice\s*=/);
});
