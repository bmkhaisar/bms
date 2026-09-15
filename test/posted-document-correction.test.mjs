import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPostedDocumentNotDirectlyMutable,
  createPostedDocumentCorrectionDraft,
  isPostedFinancialDocument,
} from "../src/modules/documents/postedDocumentCorrection.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

const postedInvoice = {
  id: "inv_original",
  number: "INV/26-27/0001",
  customerId: "party_1",
  items: [{ productId: "prod_1", quantity: 2, rate: 100, size: "10x8" }],
  subtotal: 200,
  discountTotal: 0,
  cgstTotal: 18,
  sgstTotal: 18,
  igstTotal: 0,
  gstTotal: 36,
  roundOff: 0,
  grandTotal: 236,
  amountPaid: 0,
  balance: 236,
  isIgst: false,
  status: "unpaid",
  postingStatus: "posted",
  voucherId: "voucher_original",
  version: 1,
  createdAt: 1,
};

test("posted invoice cannot enter the normal direct-mutation save path", () => {
  assert.equal(isPostedFinancialDocument(postedInvoice), true);
  assert.throws(
    () => assertPostedDocumentNotDirectlyMutable(postedInvoice, { ...postedInvoice, grandTotal: 999 }),
    /immutable.*Correct Posted Invoice/i,
  );
});

test("controlled invoice correction receives a new identity and complete traceability", () => {
  const draft = createPostedDocumentCorrectionDraft({
    original: postedInvoice,
    replacementId: "inv_corrected",
    replacementNumber: "INV/26-27/0002",
    reason: "Correct quantity and GST",
    now: 50,
  });
  assert.equal(draft.id, "inv_corrected");
  assert.equal(draft.number, "INV/26-27/0002");
  assert.equal(draft.amendedFromId, postedInvoice.id);
  assert.equal(draft.originalDocumentId, postedInvoice.id);
  assert.equal(draft.correctionReason, "Correct quantity and GST");
  assert.equal(draft.postingStatus, "draft");
  assert.equal(draft.voucherId, undefined);
  assert.equal(postedInvoice.postingStatus, "posted");
});

test("correction requires a reason and never reuses the posted immutable ID", () => {
  assert.throws(() => createPostedDocumentCorrectionDraft({
    original: postedInvoice,
    replacementId: postedInvoice.id,
    replacementNumber: "INV/2",
    reason: "fix",
  }), /new immutable document ID/i);
  assert.throws(() => createPostedDocumentCorrectionDraft({
    original: postedInvoice,
    replacementId: "inv_2",
    replacementNumber: "INV/2",
    reason: "   ",
  }), /reason is required/i);
});

test("UI gates posted invoice and purchase edits while drafts remain editable", () => {
  const page = read("src/components/app/DocumentListPage.tsx");
  assert.match(page, /isPostedFinancialDocument\(r as Invoice \| Purchase\)/);
  assert.match(page, /Correct Posted \{kind === "invoice" \? "Invoice" : "Purchase"\}/);
  assert.match(page, /assertPostedDocumentNotDirectlyMutable/);
  assert.match(page, /createPostedDocumentCorrectionDraft/);
  assert.match(page, /correctionReason/);
});

test("invoice correction reverses first, preserves audit links, and posts a replacement", () => {
  const service = read("src/modules/accounting/services/documentPostingService.ts");
  const reverseAt = service.indexOf("reverseVoucherServerFn");
  const postAt = service.lastIndexOf("postInvoiceTransaction({");
  assert.ok(reverseAt >= 0 && postAt > reverseAt);
  assert.match(service, /originalInvoice\.id === correctedInvoice\.id/);
  assert.match(service, /supersededByInvoiceId: amendedToPost\.id/);
  assert.match(service, /correctedInvoiceId: amendedToPost\.id/);
  assert.match(service, /reversalVoucherId/);
});

test("purchase reversal uses idempotent stock movement and receipt/payment expose no edit action", () => {
  const mutation = read("src/modules/sync/canonicalMutationService.ts");
  const stock = read("src/modules/inventory/stockMovementService.ts");
  const receiptPage = read("src/routes/_app.receipts.tsx");
  assert.match(mutation, /sm_reverse_\$\{doc\.id\}/);
  assert.match(stock, /params\.movementId/);
  assert.doesNotMatch(receiptPage, /setEditingReceipt\(\{ \.\.\.r/);
  assert.doesNotMatch(receiptPage, /setEditingPayment\(\{ \.\.\.payment/);
});
