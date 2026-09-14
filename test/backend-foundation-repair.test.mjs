import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDefaultSystemLedgers } from "../src/modules/accounting/defaultGroups.ts";
import { normalizeQuotationRecord } from "../src/modules/documents/quotationNormalization.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("product atomic create sanitizes audit metadata as well as the product", () => {
  const source = read("src/modules/inventory/productService.ts");
  assert.match(source, /update\(ref\(firebaseDb\), sanitizeForFirebase\(updates\)\)/);
});

test("voucher posting additively repairs legacy chart and default branch", () => {
  const source = read("src/server/accounting/postingEngine.ts");
  assert.match(source, /ensureCompanyChartOfAccounts\(db, input\.companyId, callerUid\)/);
  assert.match(source, /branchId !== "br_main"/);
  assert.match(source, /transaction\(\(current\) => current \|\| defaultBranch\)/);
  assert.match(source, /action: "ensure_main_branch"/);
  assert.doesNotMatch(source, /branches\/\$\{branchId\}.*\.set\(/s);
});

test("canonical system ledgers cover every fixed ledger referenced by document posting", () => {
  const companyId = "comp_contract_test";
  const ledgerIds = new Set(getDefaultSystemLedgers(companyId, 1).map((ledger) => ledger.id));
  for (const suffix of ["sales", "purchase", "output_gst", "input_gst", "advance_gst_adjustment"]) {
    assert.equal(ledgerIds.has(`led_${companyId}_${suffix}`), true, `missing canonical ${suffix} ledger`);
  }
});

test("legacy Firebase quotations are normalized into safe arrays", () => {
  const quotation = normalizeQuotationRecord({
    id: "q1",
    number: "Q-1",
    customerId: "c1",
    items: { 0: { description: "Item" } },
    structuredSections: { 0: { id: "s1", rows: { 0: { id: "r1" } } } },
    structuredTermsSnapshot: { 0: { title: "Terms", items: { 0: { text: "Term" } } } },
  });
  assert.equal(Array.isArray(quotation.items), true);
  assert.equal(quotation.items.length, 1);
  assert.deepEqual(quotation.extraCharges, []);
  assert.equal(quotation.structuredSections?.[0].rows.length, 1);
  assert.equal(Array.isArray(quotation.structuredTermsSnapshot?.[0].items), true);
});

test("company foundation audit is read-only and never emits credential values", () => {
  const source = read("scripts/audit-company-foundation.mjs");
  assert.match(source, /\.once\("value"\)/);
  assert.doesNotMatch(source, /\.set\(|\.update\(|\.remove\(/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(privateKey|clientEmail|databaseURL)/);
});

test("controlled company repair is dry-run by default and preserves existing balances", () => {
  const source = read("scripts/repair-company-foundation.mjs");
  assert.match(source, /--confirm=REPAIR:<company-id>/);
  assert.match(source, /confirmation !== `REPAIR:\$\{companyId\}`/);
  assert.match(source, /current\.ledgers\[ledger\.id\] \|\|=/);
  assert.doesNotMatch(source, /current\.quotations/);
  assert.match(source, /transaction\(\(current\) =>/);
  assert.doesNotMatch(source, /current\.ledgers\s*=\s*Object\.fromEntries/);
});
