import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8");
const rulesJson = JSON.parse(raw).rules;

test("Security Rule 1: Root disallows unrestricted public access", () => {
  assert.equal(rulesJson[".read"], undefined, "Root should not have public .read");
  assert.equal(rulesJson[".write"], undefined, "Root should not have public .write");
});

test("Security Rule 2: Client cannot write to /memberships tree", () => {
  assert.equal(rulesJson.memberships.$companyId[".write"], false, "Memberships tree must be write: false for clients");
});

test("Security Rule 3: Client cannot write to /userCompanies reverse index", () => {
  assert.equal(rulesJson.userCompanies.$uid[".write"], false, "userCompanies must be write: false for clients");
});

test("Security Rule 4: Document counters (docCounters) are server-only", () => {
  assert.equal(rulesJson.companyData.$companyId.docCounters[".write"], false, "docCounters must be write: false for clients");
});

test("Security Rule 5: Audit logs (auditLogs) are server-only", () => {
  assert.equal(rulesJson.companyData.$companyId.auditLogs[".write"], false, "auditLogs must be write: false for clients");
});

test("Security Rule 6: Double-entry vouchers and lines are server-only", () => {
  assert.equal(rulesJson.companyData.$companyId.vouchers[".write"], false, "vouchers must be write: false for clients");
  assert.equal(rulesJson.companyData.$companyId.voucherLines[".write"], false, "voucherLines must be write: false for clients");
});

test("Security Rule 7: Stock movements ledger is server-only", () => {
  assert.equal(rulesJson.companyData.$companyId.stockMovements[".write"], false, "stockMovements must be write: false for clients");
});

test("Security Rule 8: Company data requires authenticated active membership", () => {
  const readRule = rulesJson.companyData.$companyId[".read"];
  assert.ok(readRule.includes("auth != null"), "Must require authentication");
  assert.ok(readRule.includes("memberships"), "Must check memberships tree");
  assert.ok(readRule.includes("active"), "Must check membership status === 'active'");
});

test("Security Rule 9: Query indexOn rules defined for all critical collections", () => {
  const cd = rulesJson.companyData.$companyId;
  assert.ok(Array.isArray(cd.customers[".indexOn"]), "customers must have .indexOn");
  assert.ok(Array.isArray(cd.products[".indexOn"]), "products must have .indexOn");
  assert.ok(Array.isArray(cd.invoices[".indexOn"]), "invoices must have .indexOn");
  assert.ok(Array.isArray(cd.purchases[".indexOn"]), "purchases must have .indexOn");
  assert.ok(Array.isArray(cd.receipts[".indexOn"]), "receipts must have .indexOn");
  assert.ok(Array.isArray(cd.payments[".indexOn"]), "payments must have .indexOn");
  assert.ok(Array.isArray(cd.financialYears[".indexOn"]), "financialYears must have .indexOn");
});
