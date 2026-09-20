import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("1. defaultGroups.ts automatically provisions foundational Bank Account ledger", () => {
  const defaultGroupsSrc = read("src/modules/accounting/defaultGroups.ts");
  assert.ok(
    defaultGroupsSrc.includes("led_${companyId}_bank"),
    "Must include led_${companyId}_bank in getDefaultSystemLedgers"
  );
  assert.ok(
    defaultGroupsSrc.includes("name: \"Bank Account\""),
    "Bank ledger must be named 'Bank Account'"
  );
  assert.ok(
    defaultGroupsSrc.includes("groupId: \"grp_bank\""),
    "Bank ledger must belong to grp_bank"
  );
  assert.ok(
    defaultGroupsSrc.includes("partyType: \"bank\""),
    "Bank ledger partyType must be bank"
  );
});

test("2. postingEngine.ts implements self-healing for missing referenced system and party ledgers", () => {
  const engineSrc = read("src/server/accounting/postingEngine.ts");
  assert.ok(
    engineSrc.includes("getDefaultSystemLedgers(input.companyId, now)"),
    "postingEngine must check getDefaultSystemLedgers when referenced ledger does not exist"
  );
  assert.ok(
    engineSrc.includes("requestedId.includes(\"_supp_\")"),
    "postingEngine must self-heal missing supplier subledgers"
  );
  assert.ok(
    engineSrc.includes("requestedId.includes(\"_cust_\")"),
    "postingEngine must self-heal missing customer subledgers"
  );
});

test("3. PartySearchSelect combobox trigger uses flex-1 min-w-0 and Insights button is prominently visible without clipping", () => {
  const partySelectSrc = read("src/components/app/PartySearchSelect.tsx");
  assert.ok(
    partySelectSrc.includes("flex-1 min-w-0 justify-between h-9 text-xs font-normal bg-background"),
    "Combobox trigger must have flex-1 min-w-0 to allow sibling Insights button to remain fully visible"
  );
  assert.ok(
    partySelectSrc.includes("whitespace-nowrap"),
    "Insights button must have whitespace-nowrap to prevent text clipping"
  );
  assert.ok(
    partySelectSrc.includes("Insights"),
    "Insights button must display Insights text"
  );
  assert.ok(
    partySelectSrc.includes("truncate font-medium flex items-center gap-1.5 min-w-0"),
    "Combobox label container must have min-w-0 for truncate to function correctly"
  );
});

test("4. receipts and payments forms self-heal liquidity and party ledgers before calling posting service", () => {
  const receiptsSrc = read("src/routes/_app.receipts.tsx");
  assert.ok(
    receiptsSrc.includes("ensureLiquidityLedger"),
    "Receipts page must import and use ensureLiquidityLedger"
  );
  assert.ok(
    receiptsSrc.includes("ensureSupplierLedger"),
    "Receipts page must ensure supplier ledger exists before posting payment"
  );
  assert.ok(
    receiptsSrc.includes("ensureCustomerLedger"),
    "Receipts page must ensure customer ledger exists before posting receipt"
  );
  assert.ok(
    receiptsSrc.includes('l.groupId === "grp_bank"') && receiptsSrc.includes('l.groupId === "grp_bank_accounts"'),
    "Bank ledger filter must recognize grp_bank and grp_bank_accounts"
  );
});

test("5. Receipt and Payment dialogs are styled for mobile responsiveness", () => {
  const receiptsSrc = read("src/routes/_app.receipts.tsx");
  assert.ok(
    receiptsSrc.includes("w-[calc(100vw-1.5rem)]"),
    "Dialogs must adapt to mobile viewport width with margins"
  );
  assert.ok(
    receiptsSrc.includes("flex-col-reverse sm:flex-row"),
    "Dialog footers must stack buttons comfortably on mobile"
  );
});
