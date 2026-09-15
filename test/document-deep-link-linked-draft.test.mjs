import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { documentDeepLink, withoutDocumentId } from "../src/lib/useDocumentDeepLink.ts";
import { applyQuotationToLinkedDraft } from "../src/modules/documents/linkedDraftInvoice.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Party Insight builds an immutable-ID invoice link", () => {
  assert.equal(documentDeepLink("/invoices", "inv/id 42"), "/invoices?id=inv%2Fid%2042");
  const insight = read("src/components/app/CustomerInsightDrawer.tsx");
  assert.match(insight, /documentDeepLink\("\/invoices", inv\.id\)/);
  assert.doesNotMatch(insight, /documentDeepLink\("\/invoices", inv\.number\)/);
});

test("invoice and quotation close remove id while preserving other search and hash state", () => {
  assert.equal(
    withoutDocumentId("https://example.test/quotations?q=steel&id=q_1#list"),
    "/quotations?q=steel#list",
  );
  const hook = read("src/lib/useDocumentDeepLink.ts");
  assert.match(hook, /history\.replaceState/);
  assert.match(hook, /onCloseRef\.current\(\)/);
});

test("closed deep-link modal cannot reopen from Dexie row changes and Back/Forward is synchronized", () => {
  const hook = read("src/lib/useDocumentDeepLink.ts");
  assert.match(hook, /window\.addEventListener\("popstate", syncFromHistory\)/);
  assert.match(hook, /setRequestedId\(null\)/);
  assert.match(hook, /openedIdRef\.current !== requestedId/);
  assert.match(hook, /document\.id === requestedId/);
  const quotations = read("src/components/app/QuotationsPage.tsx");
  const documents = read("src/components/app/DocumentListPage.tsx");
  assert.doesNotMatch(quotations, /idParam && rows\.length/);
  assert.doesNotMatch(documents, /idParam && rows\.length/);
  assert.match(quotations, /onCancel=\{closeQuotationEditor\}/);
  assert.match(documents, /onClick=\{closeDocument\}[^>]*>Cancel/);
});

test("linked draft invoice updates explicitly while retaining immutable identity", () => {
  const invoice = {
    id: "inv_1", number: "INV/1", date: 1, customerId: "old", items: [], subtotal: 1,
    discountTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, gstTotal: 0,
    roundOff: 0, grandTotal: 1, amountPaid: 0, balance: 1, isIgst: false,
    status: "draft", postingStatus: "draft", createdAt: 10,
  };
  const quotation = {
    id: "q_1", number: "Q/1", date: 2, customerId: "cust_2", items: [{ id: "line_1", quantity: 2 }],
    subtotal: 200, discountTotal: 0, gstTotal: 36, cgstTotal: 18, sgstTotal: 18,
    roundOff: 0, grandTotal: 236, status: "draft", createdAt: 20, updatedAt: 30,
  };
  const updated = applyQuotationToLinkedDraft(quotation, invoice, 40);
  assert.equal(updated.id, "inv_1");
  assert.equal(updated.number, "INV/1");
  assert.equal(updated.customerId, "cust_2");
  assert.equal(updated.grandTotal, 236);
  assert.equal(updated.sourceQuotationUpdatedAt, 30);
});

test("posted linked invoice cannot be overwritten", () => {
  const posted = {
    id: "inv_1", number: "INV/1", status: "posted", postingStatus: "posted", voucherId: "v_1",
  };
  assert.throws(() => applyQuotationToLinkedDraft({ id: "q_1", number: "Q/1" }, posted), /already posted/);
  const conversion = read("src/modules/documents/quotationConversion.ts");
  assert.match(conversion, /runTransaction/);
  assert.match(conversion, /applyQuotationToLinkedDraft\(quotation, current as Invoice/);
});

test("source links and post-commit fast reconciliation use the shared pattern", () => {
  const documents = read("src/components/app/DocumentListPage.tsx");
  const quotations = read("src/components/app/QuotationsPage.tsx");
  assert.match(documents, /documentDeepLink\("\/quotations", sourceId\)/);
  assert.match(quotations, /documentDeepLink\("\/invoices", linkedInvoice\.id\)/);
  assert.match(documents, /setOptimisticOverrides[\s\S]*closeDocument\(\)[\s\S]*Invoice posted/);
  assert.match(read("src/modules/accounting/services/documentPostingService.ts"), /void \(async \(\) => \{/);
});
