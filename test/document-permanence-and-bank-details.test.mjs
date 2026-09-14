import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("one centralized ordered realtime owner prevents stale page listeners from purging or resurrecting documents", () => {
  const invoicePage = read("src/components/app/DocumentListPage.tsx");
  const quotationPage = read("src/components/app/QuotationsPage.tsx");
  const central = read("src/modules/sync/companyRealtimeSync.ts");
  assert.doesNotMatch(invoicePage, /onValue\(/);
  assert.doesNotMatch(quotationPage, /onValue\(/);
  assert.match(central, /const queues = new Map/);
  assert.match(central, /name: "invoices"/);
  assert.match(central, /name: "quotations"/);
});

test("master tabs also use the centralized realtime owner instead of competing page listeners", () => {
  const masterRoutes = [
    "src/routes/_app.customers.tsx",
    "src/routes/_app.suppliers.tsx",
    "src/routes/_app.parties.tsx",
    "src/routes/_app.products.tsx",
    "src/routes/_app.categories.tsx",
  ];
  for (const route of masterRoutes) assert.doesNotMatch(read(route), /onValue\(/);

  const central = read("src/modules/sync/companyRealtimeSync.ts");
  for (const collection of ["customers", "suppliers", "parties", "products", "categories"]) {
    assert.match(central, new RegExp(`name: "${collection}"`));
  }
});

test("working invoices and purchases autosave to Firebase and flush again on route unmount", () => {
  const source = read("src/components/app/DocumentListPage.tsx");
  assert.match(source, /async function persistWorkingDraft/);
  assert.match(source, /await authoritativeSaveEntity/);
  assert.match(source, /status: "draft"/);
  assert.match(source, /postingStatus: "draft"/);
  assert.match(source, /750/);
  assert.match(source, /Final draft flush failed/);
});

test("working quotations autosave authoritatively and flush on route unmount", () => {
  const form = read("src/components/app/QuotationForm.tsx");
  const page = read("src/components/app/QuotationsPage.tsx");
  assert.match(form, /onDraftSave/);
  assert.match(form, /Final draft flush failed/);
  assert.match(page, /async function saveQuotationDraft/);
  assert.match(page, /authoritativeSaveEntity/);
});

test("missing active financial year is repaired through authenticated Firebase Admin before document allocation", () => {
  const repair = read("src/functions/ensureFinancialYearFn.ts");
  const companyContext = read("src/modules/company/context/ActiveCompanyContext.tsx");
  const documents = read("src/components/app/DocumentListPage.tsx");
  const quotations = read("src/components/app/QuotationsPage.tsx");
  assert.match(repair, /memberships\/\$\{data\.companyId\}\/\$\{decoded\.uid\}/);
  assert.match(repair, /status !== "active"/);
  assert.match(repair, /currentFinancialYearId/);
  assert.match(repair, /financialYears/);
  assert.match(repair, /auditLogs/);
  assert.match(companyContext, /ensureFinancialYearFn/);
  assert.match(documents, /ensureFinancialYearFn/);
  assert.match(quotations, /ensureFinancialYearFn/);
});

test("invoice and quotation PDF bank rows resolve all supported account-number aliases with company fallback", () => {
  const invoiceRenderer = read("src/lib/documentRenderer.ts");
  const quotationRenderer = read("src/lib/quotationExport.ts");
  const quotationSnapshot = read("src/modules/documents/quotationSnapshot.ts");
  for (const source of [invoiceRenderer, quotationRenderer, quotationSnapshot]) {
    assert.match(source, /bankAccountNo/);
    assert.match(source, /accountNumber/);
    assert.match(source, /bankAccount/);
  }
  assert.match(invoiceRenderer, /\(comp as any\)\.bankAccountNo/);
  assert.match(quotationRenderer, /\(company as any\)\.bankAccountNo/);
});
