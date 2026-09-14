import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  assert.match(source, /transaction\(\(current\) =>/);
  assert.doesNotMatch(source, /current\.ledgers\s*=\s*Object\.fromEntries/);
});
