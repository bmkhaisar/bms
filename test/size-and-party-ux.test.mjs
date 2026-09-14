import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Size UX: shared Quotation/Invoice editor exposes first-class Size and Custom Size", () => {
  const editor = read("src/components/app/LineItemsEditor.tsx");
  assert.match(editor, /<TableHead className="w-40">Size<\/TableHead>/);
  assert.match(editor, /Custom Size/);
  assert.match(editor, /Recent \/ Saved Sizes/);
  assert.match(editor, /rememberProductSize/);

  const forms = [
    read("src/components/app/QuotationForm.tsx"),
    read("src/components/app/DocumentListPage.tsx"),
  ];
  for (const source of forms) assert.match(source, /<LineItemsEditor/);
});

test("Product size memory is company-scoped, realtime, structured, and snapshot-safe", () => {
  const model = read("src/lib/db.ts");
  const service = read("src/modules/inventory/productSizeService.ts");
  const sync = read("src/modules/sync/companyRealtimeSync.ts");
  assert.match(model, /interface ProductSizePreference extends SizeSnapshot/);
  assert.match(model, /sizeSnapshot\?: SizeSnapshot/);
  assert.match(service, /companyData\/\$\{companyId\}\/productSizes/);
  assert.match(service, /usageCount:/);
  assert.match(service, /lastUsedAt:/);
  assert.match(sync, /name: "productSizes"/);
});

test("Quotation and Invoice PDFs render Size as a dedicated column and never render partyCode", () => {
  const invoiceRenderer = read("src/lib/documentRenderer.ts");
  const quotationRenderer = read("src/lib/quotationExport.ts");
  assert.match(invoiceRenderer, /"SL No\.", "Particulars", "Size"/);
  assert.match(quotationRenderer, /"#", "Item \/ Description", "Size"/);
  assert.doesNotMatch(invoiceRenderer, /partyCode/);
  assert.doesNotMatch(quotationRenderer, /partyCode/);
});

test("Party UX uses customer/supplier labels while retaining internal accounting types", () => {
  const parties = read("src/routes/_app.parties.tsx");
  const model = read("src/lib/db.ts");
  assert.match(parties, /New Customer/);
  assert.match(parties, /New Supplier/);
  assert.doesNotMatch(parties, /New Sundry Debtor/);
  assert.doesNotMatch(parties, /New Sundry Creditor/);
  assert.match(parties, /ID: \{party\.partyCode\}/);
  assert.match(model, /"SUNDRY_DEBTOR"/);
  assert.match(model, /"SUNDRY_CREDITOR"/);
});

test("Party IDs use a trusted atomic, idempotent company-scoped allocator", () => {
  const server = read("src/server/accounting/numberingEngine.ts");
  const endpoint = read("src/functions/allocatePartyCodeFn.ts");
  assert.match(server, /partyNumbering/);
  assert.match(server, /assignments\?\.\[partyId\]/);
  assert.match(server, /CUS/);
  assert.match(server, /SUP/);
  assert.match(server, /transaction/);
  assert.match(endpoint, /verifyIdToken/);
  assert.match(endpoint, /membership/);
});

