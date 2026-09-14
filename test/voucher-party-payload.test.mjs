import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveVoucherPartyMetadata,
  VoucherPartyValidationError,
} from "../src/server/accounting/voucherPartyResolution.ts";
import {
  assertNoUndefinedValues,
  findUndefinedPath,
} from "../src/server/firebasePayloadInvariant.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

const customerLedger = {
  id: "led_customer",
  name: "Customer Receivable",
  groupId: "grp_sundry_debtors",
  partyType: "customer",
  partyId: "party_customer",
};
const supplierLedger = {
  id: "led_supplier",
  name: "Supplier Payable",
  groupId: "grp_sundry_creditors",
  partyType: "supplier",
  partyId: "party_supplier",
};
const generalLedger = {
  id: "led_sales",
  name: "Sales Revenue",
  groupId: "grp_direct_income",
  partyType: "general",
};

test("customer invoice AR line receives canonical SUNDRY_DEBTOR from Party Master", () => {
  const result = resolveVoucherPartyMetadata({
    lineNumber: 1,
    requestedPartyId: "party_customer",
    ledger: customerLedger,
    party: { id: "party_customer", partyType: "CUSTOMER" },
  });
  assert.deepEqual(result, { partyId: "party_customer", partyType: "SUNDRY_DEBTOR" });
});

test("purchase and payment AP lines receive canonical SUNDRY_CREDITOR", () => {
  for (const partyType of ["SUPPLIER", "SUNDRY_CREDITOR", "BOTH"]) {
    const result = resolveVoucherPartyMetadata({
      lineNumber: 1,
      requestedPartyId: "party_supplier",
      ledger: supplierLedger,
      party: { id: "party_supplier", partyType },
    });
    assert.equal(result.partyType, "SUNDRY_CREDITOR");
  }
});

test("receipt customer line resolves as debtor while journal and contra general lines omit party fields", () => {
  assert.equal(resolveVoucherPartyMetadata({
    lineNumber: 2,
    ledger: customerLedger,
    party: { id: "party_customer", partyType: "SUNDRY_DEBTOR" },
  }).partyType, "SUNDRY_DEBTOR");
  const nonParty = resolveVoucherPartyMetadata({ lineNumber: 2, ledger: generalLedger });
  assert.deepEqual(nonParty, {});
  assertNoUndefinedValues({ vouchers: { v1: { lines: [{ ...nonParty, ledgerId: "led_sales" }] } } });
});

test("malformed or incompatible Party Master data is rejected before a mutation can run", () => {
  let mutationCalled = false;
  assert.throws(() => {
    resolveVoucherPartyMetadata({
      lineNumber: 1,
      requestedPartyId: "party_customer",
      ledger: customerLedger,
      party: { id: "party_customer" },
    });
    mutationCalled = true;
  }, VoucherPartyValidationError);
  assert.equal(mutationCalled, false);

  assert.throws(() => resolveVoucherPartyMetadata({
    lineNumber: 1,
    requestedPartyId: "party_supplier",
    ledger: customerLedger,
    party: { id: "party_supplier", partyType: "SUPPLIER" },
  }), /requires SUNDRY_DEBTOR/);
});

test("Firebase payload invariant identifies undefined and never silently strips it", () => {
  const unsafe = { vouchers: { v1: { lines: [{ partyType: undefined }] } } };
  assert.equal(findUndefinedPath(unsafe), "values.vouchers.v1.lines.0.partyType");
  assert.throws(() => assertNoUndefinedValues(unsafe), /partyType/);
});

test("all document party flows send partyId and both posting and reversal audit payloads before update", () => {
  const documents = read("src/modules/accounting/services/documentPostingService.ts");
  assert.match(documents, /partyId: invoice\.customerId/);
  assert.match(documents, /partyId: purchase\.supplierId/);
  assert.match(documents, /partyId: receipt\.partyId \|\| receipt\.customerId/);
  assert.match(documents, /partyId: payment\.supplierId/);
  assert.match(read("src/modules/accounting/services/partyAdvanceService.ts"), /partyId: receipt\.partyId \|\| receipt\.customerId/);

  for (const file of ["src/server/accounting/postingEngine.ts", "src/server/accounting/reversalEngine.ts"]) {
    const source = read(file);
    assert.ok(source.indexOf("assertNoUndefinedValues(updates)") < source.indexOf("await db.ref().update(updates)"));
  }
  assert.ok(documents.indexOf("if (voucherRes.success && voucherRes.voucher)") < documents.indexOf("postingStatus: \"posted\""));
  assert.match(read("src/server/accounting/postingEngine.ts"), /p: l\.partyId \|\| ""/);
});
