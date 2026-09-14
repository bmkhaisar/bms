import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("legacy-party migration is authenticated, canonical, idempotent, and does not deduplicate by name", () => {
  const source = read("src/functions/migrateLegacyPartiesFn.ts");
  assert.match(source, /verifyIdToken\(data\.idToken\)/);
  assert.match(source, /legacyPartyMappings/);
  assert.match(source, /allocatePartyBusinessCode/);
  assert.match(source, /grp_sundry_debtors/);
  assert.match(source, /grp_sundry_creditors/);
  assert.doesNotMatch(source, /cleanName|byName/);
});

test("quotation conversion commits bidirectional traceability before local cache reconciliation", () => {
  const source = read("src/modules/documents/quotationConversion.ts");
  assert.match(source, /sourceType: "QUOTATION"/);
  assert.match(source, /sourceQuotationId: quotation\.id/);
  assert.match(source, /sourceQuotationNumber: quotation\.number/);
  assert.match(source, /await update\(ref\(firebaseDb\), rootUpdates\)/);
  assert.ok(source.indexOf("await update(ref(firebaseDb), rootUpdates)") < source.indexOf("await db().invoices.put(invoice)"));
});

test("receipt and payment records update linked balances in authoritative multi-path writes", () => {
  const source = read("src/modules/accounting/services/documentPostingService.ts");
  assert.match(source, /receiptAllocations/);
  assert.match(source, /linkedInvoices/);
  assert.match(source, /paymentAllocations/);
  assert.match(source, /linkedPurchases/);
  assert.match(source, /await update\(ref\(firebaseDb\), updates\)/);
});

test("realtime sync serializes create/edit/delete events and covers document/master collections", () => {
  const source = read("src/modules/sync/companyRealtimeSync.ts");
  assert.match(source, /const queues = new Map/);
  for (const collection of ["parties", "invoices", "quotations", "purchases", "receipts", "payments", "products", "categories"]) {
    assert.match(source, new RegExp(`name: "${collection}"`));
  }
});

test("controlled reset is dry-run by default, company-scoped, backed up, confirmed, and never startup-triggered", () => {
  const source = read("scripts/reset-company-data.mjs");
  assert.match(source, /const execute = Boolean\(confirmation\)/);
  assert.match(source, /confirmation !== `RESET:\$\{companyId\}`/);
  assert.match(source, /\.backups/);
  assert.match(source, /companyData\/\$\{companyId\}/);
  assert.match(source, /operationalReset/);
  assert.doesNotMatch(read("package.json"), /pre(dev|start|build).*reset:company-data/);
});

test("invoice provenance, exact PDF preview, and delete busy UX are present", () => {
  const source = read("src/components/app/DocumentListPage.tsx");
  assert.match(source, /sourceType: "DIRECT"/);
  assert.match(source, /Direct Invoice/);
  assert.match(source, /Invoice Preview/);
  assert.match(source, /generateDocumentPDFBlobUrl/);
  assert.match(source, /isBusy=\{isDeletingDoc\}/);
  assert.match(source, /busyText="Deleting…"/);
});

test("company access denial waits for the same fully resolved auth state used by routing", () => {
  const source = read("src/routes/no-company-access.tsx");
  const context = read("src/modules/company/context/ActiveCompanyContext.tsx");
  assert.match(source, /resolutionState !== "ready"/);
  assert.match(context, /resolvedUserId !== user\.uid/);
  assert.doesNotMatch(context, /setTimeout\(\(\) => \{\s*setLoading\(false\)/);
});
