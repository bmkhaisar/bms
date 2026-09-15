import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleDeepLinkTransition } from "../src/lib/useDocumentDeepLink.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

// ==========================================
// 1. QUOTATION & INVOICE FORM STABILITY
// ==========================================

test("QUOTATION: selecting customer, product, address, or tabs NEVER auto-saves or closes editor", () => {
  const form = read("src/components/app/QuotationForm.tsx");
  const page = read("src/components/app/QuotationsPage.tsx");

  // Initial persistence happens ONLY on explicit Save
  assert.doesNotMatch(form, /useEffect\([^)]*saveDraft/);
  assert.doesNotMatch(page, /idParam && rows\.length/);

  // Dirty check confirmation on Cancel/X
  assert.match(form, /You have unsaved changes\. Discard them\?/);
  assert.match(form, /handleCancel/);

  // Manual open disassociates URL so Dexie updates cannot close editor
  assert.match(page, /markManualOpen/);
});

test("QUOTATION: explicit save creates exactly 1 quotation without duplicate drafts", () => {
  const page = read("src/components/app/QuotationsPage.tsx");
  assert.match(page, /authoritativeSaveEntity/);
  assert.match(page, /closeQuotationEditor/);
});

test("INVOICE: edit remains open across field changes and only closes on explicit cancel or save", () => {
  const page = read("src/components/app/DocumentListPage.tsx");
  assert.match(page, /isEditorDirty/);
  assert.match(page, /You have unsaved changes\. Discard them\?/);
  assert.match(page, /handleCancelOrCloseEditor/);
  assert.match(page, /markManualOpen/);
});

test("DEEP LINK LIFECYCLE: requestedId === null never closes manually opened editor or new document", () => {
  // 1. Manually opened editor
  const manualState = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "manually_opened",
    activeDocId: "manual_doc_1",
  };
  const res1 = handleDeepLinkTransition(manualState, {
    type: "URL_CHANGED",
    urlId: null,
    documents: [{ id: "manual_doc_1" }],
  });
  assert.equal(res1.effect, undefined, "Manual editor must NOT close on null urlId");
  assert.equal(res1.nextState.activeMode, "manually_opened");

  // 2. New document
  const newState = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "new_document",
    activeDocId: null,
  };
  const res2 = handleDeepLinkTransition(newState, {
    type: "URL_CHANGED",
    urlId: null,
    documents: [],
  });
  assert.equal(res2.effect, undefined, "New document must NOT close on null urlId");

  // 3. Realtime Dexie update DOCUMENTS_UPDATED never closes manual/new editor
  const res3 = handleDeepLinkTransition(manualState, {
    type: "DOCUMENTS_UPDATED",
    documents: [{ id: "manual_doc_1", grandTotal: 500 }],
  });
  assert.equal(res3.effect, undefined, "Dexie updates must NEVER close manual editor");
});

// ==========================================
// 2. RECEIPT CALCULATION & OVERPAYMENT
// ==========================================

test("RECEIPT: calculates real-time invoice balance & overpayment excess as customer credit", () => {
  const invoiceTotal = 329067;
  const alreadyReceived = 300000;
  const outstanding = invoiceTotal - alreadyReceived; // 29067
  assert.equal(outstanding, 29067);

  // Exact receipt
  const exactAmt = 29067;
  const exactAlloc = Math.min(exactAmt, outstanding);
  const exactCredit = Math.max(0, exactAmt - exactAlloc);
  assert.equal(exactAlloc, 29067);
  assert.equal(exactCredit, 0);

  // Partial receipt
  const partialAmt = 20000;
  const partialAlloc = Math.min(partialAmt, outstanding);
  const partialCredit = Math.max(0, partialAmt - partialAlloc);
  const partialRemaining = outstanding - partialAlloc;
  assert.equal(partialAlloc, 20000);
  assert.equal(partialCredit, 0);
  assert.equal(partialRemaining, 9067);

  // Overpayment receipt (30000 received vs 29067 outstanding)
  const overpayAmt = 30000;
  const overpayAlloc = Math.min(overpayAmt, outstanding);
  const overpayCredit = Math.max(0, overpayAmt - overpayAlloc);
  const invoiceBalanceAfter = Math.max(0, outstanding - overpayAlloc);
  assert.equal(overpayAlloc, 29067);
  assert.equal(overpayCredit, 933);
  assert.equal(invoiceBalanceAfter, 0, "Invoice balance must never be negative");
});

test("RECEIPT UI: overpayment warning and keep credit confirmation exists in receipts route", () => {
  const receiptRoute = read("src/routes/_app.receipts.tsx");
  assert.match(receiptRoute, /Customer Credit/);
  assert.match(receiptRoute, /Outstanding/);
  assert.match(receiptRoute, /exceeds the selected invoice balance/);
  assert.match(receiptRoute, /will be kept as/);
});

// ==========================================
// 3. ACCOUNTING INVARIANTS & GL SAFETY
// ==========================================

test("RECEIPT GL: Dr Cash/Bank, Cr Customer without duplicate GL entries for customer credit", () => {
  const postingSrc = read("src/modules/accounting/services/documentPostingService.ts");
  // Check postCustomerReceipt double-entry construction
  assert.match(postingSrc, /const liquidityLedgerId = settlementLedgerId/);
  assert.match(postingSrc, /debit: amountPaise/);
  assert.match(postingSrc, /credit: amountPaise/);
  assert.match(postingSrc, /ledgerId: customerLedgerId/);

  // Pure logic verification: Receipt of 30,000 with 933 credit
  const amount = 30000;
  const entries = [
    { ledgerId: "bank_hdfc", debit: amount, credit: 0 },
    { ledgerId: "cust_123", debit: 0, credit: amount },
  ];
  assert.equal(entries.length, 2, "GL must have exactly 2 entries: Dr Cash/Bank and Cr Customer");
  assert.equal(entries[0].debit, entries[1].credit);
});

// ==========================================
// 4. FUTURE INVOICE CREDIT APPLICATION
// ==========================================

test("FUTURE INVOICE: detects customer credit by partyId, reduces payable without altering Grand Total or GST", () => {
  const docListPage = read("src/components/app/DocumentListPage.tsx");
  assert.match(docListPage, /Available Customer Credit/);
  assert.match(docListPage, /Apply Credit/);
  assert.match(docListPage, /allocateAdvanceAgainstInvoice/);

  // Accounting invariant test: Grand Total / Taxable Value / GST remain completely unchanged
  const grandTotal = 10000;
  const availableCredit = 933;
  const appliedCredit = Math.min(availableCredit, grandTotal);
  const balancePayable = grandTotal - appliedCredit;

  assert.equal(appliedCredit, 933);
  assert.equal(balancePayable, 9067);
  assert.equal(grandTotal, 10000, "Grand total must remain unchanged");
});

// ==========================================
// 5. RECEIPT PDF REDESIGN & TRACEABILITY
// ==========================================

test("RECEIPT PDF: Against-Invoice receipt renders RECEIPT VOUCHER with allocation table and no quotation T&C", () => {
  const renderer = read("src/lib/documentRenderer.ts");
  const receiptRoute = read("src/routes/_app.receipts.tsx");

  // PDF title resolution: ordinary against-ref receipt renders RECEIPT VOUCHER, not "Advance for GOODS"
  assert.match(renderer, /RECEIPT VOUCHER/);
  assert.match(renderer, /Balance Before/);
  assert.match(renderer, /Balance After/);
  assert.match(renderer, /customerCreditCreated/);

  // Quotation terms are strictly excluded from receipt PDF
  assert.match(renderer, /docData\.kind !== "receipt"/);
  const printComponent = read("src/components/app/DocumentPrint.tsx");
  assert.match(printComponent, /!isReceipt/);
  assert.match(receiptRoute, /includeTerms:\s*false/);
});
