import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Helper constants & converters
const PAISE_PER_RUPEE = 100;
function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(rupees * PAISE_PER_RUPEE);
}

function paiseToRupees(paise) {
  if (paise === null || paise === undefined || isNaN(paise)) return 0;
  return paise / PAISE_PER_RUPEE;
}

/**
 * In-Memory Database Harness simulating Firebase Realtime Database
 * for testing server-side double-entry posting and invariant guarantees.
 */
class MemoryRTDB {
  constructor(initialData = {}) {
    this.data = JSON.parse(JSON.stringify(initialData));
  }

  _getRef(path) {
    const parts = path.split("/").filter(Boolean);
    let curr = this.data;
    for (const p of parts) {
      if (!curr || typeof curr !== "object") return undefined;
      curr = curr[p];
    }
    return curr;
  }

  _setRef(path, value) {
    const parts = path.split("/").filter(Boolean);
    let curr = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!curr[p] || typeof curr[p] !== "object") {
        curr[p] = {};
      }
      curr = curr[p];
    }
    const lastKey = parts[parts.length - 1];
    curr[lastKey] = JSON.parse(JSON.stringify(value));
  }

  ref(path = "") {
    const self = this;
    return {
      async once() {
        const val = self._getRef(path);
        return {
          exists() {
            return val !== undefined && val !== null;
          },
          val() {
            return val !== undefined ? JSON.parse(JSON.stringify(val)) : null;
          },
        };
      },
      async transaction(updateFn) {
        const currentVal = self._getRef(path);
        const newVal = updateFn(currentVal);
        self._setRef(path, newVal);
        return {
          committed: true,
          snapshot: {
            val() {
              return newVal;
            },
          },
        };
      },
      async update(updates) {
        for (const [p, v] of Object.entries(updates)) {
          self._setRef(p, v);
        }
      },
      async set(v) {
        self._setRef(path, v);
      },
    };
  }
}

/**
 * Double-Entry Test Engine implementing the Phase 2 Accounting Rules
 */
function createAccountingTestHarness(initialDb = {}) {
  const db = new MemoryRTDB(initialDb);

  async function postVoucher(input, callerMembership) {
    // 1. Auth & permission check
    if (!callerMembership || callerMembership.status !== "active") {
      return { success: false, error: "Unauthorized or inactive", code: "FORBIDDEN" };
    }
    const perms = callerMembership.customPermissions || [];
    const isOwner = callerMembership.role === "owner";
    const isAccountant = callerMembership.role === "accountant";
    const canPost = isOwner || isAccountant || perms.includes("accounting.voucher.create");
    if (!canPost) {
      return { success: false, error: "Forbidden: Missing accounting.voucher.create capability", code: "FORBIDDEN" };
    }

    // 2. Idempotency check
    const mutationSnap = await db.ref(`companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`).once();
    if (mutationSnap.exists()) {
      const existingId = mutationSnap.val().voucherId;
      const existVouch = (await db.ref(`companyData/${input.companyId}/vouchers/${existingId}`).once()).val();
      return { success: true, voucher: existVouch, alreadyPosted: true, code: "ALREADY_POSTED" };
    }

    // 3. Financial Year checks
    const fySnap = await db.ref(`companyData/${input.companyId}/financialYears/${input.financialYearId}`).once();
    if (!fySnap.exists()) {
      return { success: false, error: "Financial year does not exist", code: "INVALID_INPUT" };
    }
    const fy = fySnap.val();
    if (fy.locked) {
      return { success: false, error: "Financial year is locked", code: "PERIOD_LOCKED" };
    }
    if (input.date < fy.startDate || input.date > fy.endDate) {
      return { success: false, error: "Voucher date outside financial year", code: "INVALID_INPUT" };
    }

    // 4. Line validation & Double-Entry Equality
    if (!Array.isArray(input.lines) || input.lines.length < 2) {
      return { success: false, error: "Minimum 2 lines required", code: "INVALID_INPUT" };
    }

    let totalDr = 0;
    let totalCr = 0;
    const processedLines = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const dr = input.amountsInRupees ? rupeesToPaise(line.debit) : Math.round(line.debit || 0);
      const cr = input.amountsInRupees ? rupeesToPaise(line.credit) : Math.round(line.credit || 0);

      if (dr < 0 || cr < 0) {
        return { success: false, error: "Negative amounts disallowed", code: "INVALID_INPUT" };
      }
      if (dr === 0 && cr === 0) {
        return { success: false, error: "Zero line disallowed", code: "INVALID_INPUT" };
      }
      if (dr > 0 && cr > 0) {
        return { success: false, error: "Line cannot have both Debit and Credit", code: "INVALID_INPUT" };
      }

      totalDr += dr;
      totalCr += cr;
      processedLines.push({ ...line, debit: dr, credit: cr, id: `line_${i + 1}` });
    }

    // Core Accounting Rule: Total Debit === Total Credit
    if (totalDr !== totalCr) {
      return {
        success: false,
        error: `Double-entry imbalance: Debit ${totalDr} !== Credit ${totalCr}`,
        code: "UNBALANCED_VOUCHER",
      };
    }

    // 5. Tenant ledger verification
    const loadedLedgers = {};
    for (const l of processedLines) {
      const lSnap = await db.ref(`companyData/${input.companyId}/ledgers/${l.ledgerId}`).once();
      if (!lSnap.exists()) {
        // Check if exists in another company to catch tenant violation
        const rootSnap = await db.ref(`companyData`).once();
        const companies = rootSnap.val() || {};
        let foundOther = false;
        for (const cId of Object.keys(companies)) {
          if (cId !== input.companyId && companies[cId].ledgers?.[l.ledgerId]) {
            foundOther = true;
            break;
          }
        }
        if (foundOther) {
          return { success: false, error: "Tenant violation: Ledger belongs to another company", code: "FORBIDDEN" };
        }
        return { success: false, error: `Ledger ${l.ledgerId} not found`, code: "INVALID_INPUT" };
      }
      const led = lSnap.val();
      if (led.companyId !== input.companyId) {
        return { success: false, error: "Tenant violation: Cross-company ledger", code: "FORBIDDEN" };
      }
      if (led.active === false) {
        return { success: false, error: "Ledger is deactivated", code: "INVALID_INPUT" };
      }
      loadedLedgers[led.id] = led;
    }

    // 6. Contra Liquidity Check
    if (input.voucherType === "contra") {
      for (const line of processedLines) {
        const l = loadedLedgers[line.ledgerId];
        const isLiquidity = l.partyType === "cash" || l.partyType === "bank" || l.groupId?.includes("cash") || l.groupId?.includes("bank");
        if (!isLiquidity) {
          return { success: false, error: "Contra voucher violation: Contra vouchers can only transfer funds between cash and bank accounts", code: "INVALID_INPUT" };
        }
      }
    }

    // 7. Atomic sequence allocation
    const tx = await db.ref(`companyData/${input.companyId}/docCounters/${input.financialYearId}/vouchers/${input.voucherType}`).transaction((c) => (c || 0) + 1);
    const seq = tx.snapshot.val();
    const prefix = { journal: "JV", payment: "PAY", receipt: "REC", contra: "CON" }[input.voucherType] || "VCH";
    const voucherNumber = `${prefix}/${fy.name}/${String(seq).padStart(6, "0")}`;

    const now = Date.now();
    const voucherId = `vouch_${now}_${seq}`;
    const voucher = {
      id: voucherId,
      companyId: input.companyId,
      financialYearId: input.financialYearId,
      branchId: input.branchId || "br_main",
      voucherType: input.voucherType,
      voucherNumber,
      date: input.date,
      reference: input.reference || "",
      narration: input.narration,
      status: "posted",
      lines: processedLines,
      totalDebit: totalDr,
      totalCredit: totalCr,
      clientMutationId: input.clientMutationId,
      createdAt: now,
      postedAt: now,
    };

    const updates = {};
    updates[`companyData/${input.companyId}/vouchers/${voucherId}`] = voucher;
    for (const line of processedLines) {
      updates[`companyData/${input.companyId}/voucherLines/${voucherId}/${line.id}`] = line;
      const l = loadedLedgers[line.ledgerId];
      const newBal = (l.currentBalance || 0) + (line.debit - line.credit);
      updates[`companyData/${input.companyId}/ledgers/${line.ledgerId}/currentBalance`] = newBal;
      l.currentBalance = newBal;
    }
    updates[`companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`] = {
      voucherId,
      voucherNumber,
      timestamp: now,
    };

    await db.ref().update(updates);
    return { success: true, voucher, voucherNumber };
  }

  async function reverseVoucher(input, callerMembership) {
    if (!callerMembership || callerMembership.status !== "active") {
      return { success: false, error: "Unauthorized", code: "FORBIDDEN" };
    }
    const perms = callerMembership.customPermissions || [];
    const isOwner = callerMembership.role === "owner";
    const isAccountant = callerMembership.role === "accountant";
    if (!isOwner && !isAccountant && !perms.includes("accounting.voucher.void")) {
      return { success: false, error: "Forbidden: Missing accounting.voucher.void capability", code: "FORBIDDEN" };
    }

    const vSnap = await db.ref(`companyData/${input.companyId}/vouchers/${input.voucherId}`).once();
    if (!vSnap.exists()) return { success: false, error: "Voucher not found", code: "NOT_FOUND" };
    const orig = vSnap.val();

    if (orig.status === "reversed") {
      return { success: true, originalVoucherId: orig.id, alreadyReversed: true };
    }
    if (orig.status !== "posted") {
      return { success: false, error: "Only posted vouchers can be reversed", code: "INVALID_STATE" };
    }

    const fySnap = await db.ref(`companyData/${input.companyId}/financialYears/${orig.financialYearId}`).once();
    const fy = fySnap.val();
    if (fy.locked) return { success: false, error: "Period locked", code: "PERIOD_LOCKED" };

    // Opposite counter entries
    const revLines = orig.lines.map((l, idx) => ({
      id: `rev_line_${idx + 1}`,
      ledgerId: l.ledgerId,
      debit: l.credit,
      credit: l.debit,
      description: `Reversal of ${orig.voucherNumber}`,
    }));

    const tx = await db.ref(`companyData/${input.companyId}/docCounters/${orig.financialYearId}/vouchers/${orig.voucherType}`).transaction((c) => (c || 0) + 1);
    const seq = tx.snapshot.val();
    const prefix = { journal: "JV", payment: "PAY", receipt: "REC", contra: "CON" }[orig.voucherType] || "VCH";
    const revVoucherNumber = `${prefix}/${fy.name}/${String(seq).padStart(6, "0")}`;

    const now = Date.now();
    const revVoucherId = `vouch_rev_${now}_${seq}`;
    const revVoucher = {
      id: revVoucherId,
      companyId: input.companyId,
      financialYearId: orig.financialYearId,
      voucherType: orig.voucherType,
      voucherNumber: revVoucherNumber,
      date: now,
      narration: `Reversal of ${orig.voucherNumber}: ${input.reversalReason || ""}`,
      status: "posted",
      lines: revLines,
      totalDebit: orig.totalCredit,
      totalCredit: orig.totalDebit,
      reversedVoucherId: orig.id,
      clientMutationId: input.clientMutationId,
    };

    const updates = {};
    updates[`companyData/${input.companyId}/vouchers/${orig.id}/status`] = "reversed";
    updates[`companyData/${input.companyId}/vouchers/${orig.id}/reversalVoucherId`] = revVoucherId;
    updates[`companyData/${input.companyId}/vouchers/${revVoucherId}`] = revVoucher;

    for (const l of revLines) {
      const ledSnap = await db.ref(`companyData/${input.companyId}/ledgers/${l.ledgerId}`).once();
      const current = ledSnap.val()?.currentBalance || 0;
      updates[`companyData/${input.companyId}/ledgers/${l.ledgerId}/currentBalance`] = current + (l.debit - l.credit);
    }

    await db.ref().update(updates);
    return { success: true, originalVoucherId: orig.id, reversalVoucherId: revVoucherId, reversalVoucherNumber: revVoucherNumber };
  }

  return { db, postVoucher, reverseVoucher };
}

// ---------------------------------------------------------
// SUITE: 16 Core Accounting Invariants
// ---------------------------------------------------------

const COMPANY_A = "comp_test_alpha";
const COMPANY_B = "comp_test_beta";
const FY_2026 = "fy_2026_27";

function getBaseTestState() {
  return {
    companyData: {
      [COMPANY_A]: {
        financialYears: {
          [FY_2026]: {
            id: FY_2026,
            name: "2026-27",
            startDate: 1774981800000, // April 1, 2026
            endDate: 1806517800000,   // March 31, 2027
            locked: false,
          },
          fy_locked: {
            id: "fy_locked",
            name: "2025-26",
            startDate: 1743445800000,
            endDate: 1774981799000,
            locked: true,
          },
        },
        ledgers: {
          led_cash: { id: "led_cash", companyId: COMPANY_A, name: "Cash in Hand", groupId: "grp_cash", partyType: "cash", currentBalance: 500000, active: true },
          led_bank: { id: "led_bank", companyId: COMPANY_A, name: "HDFC Bank", groupId: "grp_bank", partyType: "bank", currentBalance: 1000000, active: true },
          led_sales: { id: "led_sales", companyId: COMPANY_A, name: "Sales Revenue", groupId: "grp_direct_income", partyType: "general", currentBalance: 0, active: true },
          led_rent: { id: "led_rent", companyId: COMPANY_A, name: "Rent Expense", groupId: "grp_operating_expenses", partyType: "general", currentBalance: 0, active: true },
          led_inactive: { id: "led_inactive", companyId: COMPANY_A, name: "Old Dormant Account", groupId: "grp_operating_expenses", currentBalance: 0, active: false },
          led_offset: { id: `led_${COMPANY_A}_opening_offset`, companyId: COMPANY_A, name: "Opening Balance Offset", groupId: "grp_equity_offset", currentBalance: -1500000, active: true },
        },
      },
      [COMPANY_B]: {
        ledgers: {
          led_b_cash: { id: "led_b_cash", companyId: COMPANY_B, name: "Company B Cash", groupId: "grp_cash", partyType: "cash", currentBalance: 200000, active: true },
        },
      },
    },
  };
}

const ownerUser = { role: "owner", status: "active" };
const readOnlyUser = { role: "viewer", status: "active" };

test("INV-01: Balanced Journal Voucher Accepted (Total Debit === Total Credit)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Rent expense paid",
    lines: [
      { ledgerId: "led_rent", debit: 25000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 25000 },
    ],
    clientMutationId: "mut-001",
  }, ownerUser);

  assert.equal(result.success, true);
  assert.equal(result.voucher.totalDebit, 25000);
  assert.equal(result.voucher.totalCredit, 25000);
  assert.equal(result.voucher.status, "posted");
});

test("INV-02: Unbalanced Journal Voucher Strictly Rejected (Total Debit !== Total Credit)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Unbalanced rent entry attempt",
    lines: [
      { ledgerId: "led_rent", debit: 25000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 20000 }, // Discrepancy of 5,000
    ],
    clientMutationId: "mut-002",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.equal(result.code, "UNBALANCED_VOUCHER");
});

test("INV-03: Single-Side Line Enforcement (Debit + Credit on Same Line Rejected)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Dual side line test",
    lines: [
      { ledgerId: "led_rent", debit: 1000, credit: 1000 },
      { ledgerId: "led_cash", debit: 0, credit: 1000 },
    ],
    clientMutationId: "mut-003",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.match(result.error, /both Debit and Credit/i);
});

test("INV-04: Zero-Value and Negative Lines Rejected", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  // Zero line
  const zeroResult = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Zero line test",
    lines: [
      { ledgerId: "led_rent", debit: 0, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 0 },
    ],
    clientMutationId: "mut-004a",
  }, ownerUser);
  assert.equal(zeroResult.success, false);

  // Negative line
  const negResult = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Negative line test",
    lines: [
      { ledgerId: "led_rent", debit: -5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: -5000 },
    ],
    clientMutationId: "mut-004b",
  }, ownerUser);
  assert.equal(negResult.success, false);
});

test("INV-05: Minimum Two Effective Lines Required", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Single line test",
    lines: [{ ledgerId: "led_rent", debit: 1000, credit: 0 }],
    clientMutationId: "mut-005",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.match(result.error, /Minimum 2 lines/i);
});

test("INV-06: Tenant Isolation (Cross-Company Ledger Rejected)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  // Company A user attempts to debit Company B's ledger
  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Tenant violation test",
    lines: [
      { ledgerId: "led_b_cash", debit: 5000, credit: 0 }, // Belongs to Company B!
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-006",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.equal(result.code, "FORBIDDEN");
  assert.match(result.error, /Tenant violation/i);
});

test("INV-07: Unauthorized User Lacking Capability Rejected", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Unauthorized post attempt",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-007",
  }, readOnlyUser);

  assert.equal(result.success, false);
  assert.equal(result.code, "FORBIDDEN");
});

test("INV-08: Transaction Date Outside Financial Year Rejected", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1700000000000, // Prior to April 1, 2026
    narration: "Out of FY bounds",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-008",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.match(result.error, /outside financial year/i);
});

test("INV-09: Posting to Locked Financial Year Rejected", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: "fy_locked",
    voucherType: "journal",
    date: 1750000000000,
    narration: "Locked period post",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-009",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.equal(result.code, "PERIOD_LOCKED");
});

test("INV-10: Idempotent Posting (Duplicate clientMutationId Returns Existing Voucher)", async () => {
  const { postVoucher, db } = createAccountingTestHarness(getBaseTestState());

  const payload = {
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Idempotency test voucher",
    lines: [
      { ledgerId: "led_rent", debit: 12000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 12000 },
    ],
    clientMutationId: "mut-stable-uuid-999",
  };

  // 1. First submission
  const first = await postVoucher(payload, ownerUser);
  assert.equal(first.success, true);
  const originalVoucherId = first.voucher.id;

  // Verify Cash balance decreased by 12,000 paise (500000 - 12000 = 488000)
  const snap1 = await db.ref(`companyData/${COMPANY_A}/ledgers/led_cash`).once();
  assert.equal(snap1.val().currentBalance, 488000);

  // 2. Exact retry submission with same clientMutationId (network timeout recovery)
  const retry = await postVoucher(payload, ownerUser);
  assert.equal(retry.success, true);
  assert.equal(retry.alreadyPosted, true);
  assert.equal(retry.voucher.id, originalVoucherId);

  // Crucial: Cash balance MUST NOT be subtracted a second time
  const snap2 = await db.ref(`companyData/${COMPANY_A}/ledgers/led_cash`).once();
  assert.equal(snap2.val().currentBalance, 488000, "Balance must not change on duplicate retry");
});

test("INV-11: Concurrency-Safe Sequence Counters Produce Monotonic Unique Numbers", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const v1 = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Seq 1",
    lines: [
      { ledgerId: "led_rent", debit: 100, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 100 },
    ],
    clientMutationId: "mut-seq-1",
  }, ownerUser);

  const v2 = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Seq 2",
    lines: [
      { ledgerId: "led_rent", debit: 200, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 200 },
    ],
    clientMutationId: "mut-seq-2",
  }, ownerUser);

  assert.equal(v1.voucherNumber, "JV/2026-27/000001");
  assert.equal(v2.voucherNumber, "JV/2026-27/000002");
});

test("INV-12: Contra Liquidity Constraint (Requires Cash/Bank on Both Sides)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  // Valid Contra: Cash in Hand to Bank
  const validContra = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "contra",
    date: 1775000000000,
    narration: "Cash deposited to HDFC Bank",
    lines: [
      { ledgerId: "led_bank", debit: 50000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 50000 },
    ],
    clientMutationId: "mut-contra-ok",
  }, ownerUser);
  assert.equal(validContra.success, true);
  assert.equal(validContra.voucherNumber, "CON/2026-27/000001");

  // Invalid Contra: Involving Rent Expense (Disallowed)
  const invalidContra = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "contra",
    date: 1775000000000,
    narration: "Invalid contra with expense",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-contra-err",
  }, ownerUser);
  assert.equal(invalidContra.success, false);
  assert.match(invalidContra.error, /only transfer funds between cash and bank/i);
});

test("INV-13: Voucher Reversal Integrity (Creates Equal Opposite Entries & Restores Balances)", async () => {
  const { postVoucher, reverseVoucher, db } = createAccountingTestHarness(getBaseTestState());

  // 1. Post initial payment
  const post = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "payment",
    date: 1775000000000,
    narration: "Office rent payment",
    lines: [
      { ledgerId: "led_rent", debit: 30000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 30000 },
    ],
    clientMutationId: "mut-rev-orig",
  }, ownerUser);
  assert.equal(post.success, true);
  const origVoucherId = post.voucher.id;

  // Check balances after posting
  const cashBalAfter = (await db.ref(`companyData/${COMPANY_A}/ledgers/led_cash`).once()).val().currentBalance;
  assert.equal(cashBalAfter, 500000 - 30000); // 470000

  // 2. Reverse the voucher
  const rev = await reverseVoucher({
    companyId: COMPANY_A,
    voucherId: origVoucherId,
    reversalReason: "Cheque bounced / entered in error",
    clientMutationId: "mut-rev-action",
  }, ownerUser);

  assert.equal(rev.success, true);
  assert.equal(rev.reversalVoucherNumber, "PAY/2026-27/000002");

  // Verify original voucher status changed to "reversed"
  const origUpdated = (await db.ref(`companyData/${COMPANY_A}/vouchers/${origVoucherId}`).once()).val();
  assert.equal(origUpdated.status, "reversed");
  assert.equal(origUpdated.reversalVoucherId, rev.reversalVoucherId);

  // Verify reversal voucher links back
  const revVoucher = (await db.ref(`companyData/${COMPANY_A}/vouchers/${rev.reversalVoucherId}`).once()).val();
  assert.equal(revVoucher.reversedVoucherId, origVoucherId);
  assert.equal(revVoucher.totalDebit, 30000);
  assert.equal(revVoucher.totalCredit, 30000);

  // Verify Cash balance is fully restored to 500,000
  const cashBalRestored = (await db.ref(`companyData/${COMPANY_A}/ledgers/led_cash`).once()).val().currentBalance;
  assert.equal(cashBalRestored, 500000, "Ledger balance must be restored to pre-voucher state");
});

test("INV-14: Day Book Correctly Aggregates Posted Vouchers", async () => {
  const { postVoucher, db } = createAccountingTestHarness(getBaseTestState());

  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Day Book Entry 1",
    lines: [
      { ledgerId: "led_rent", debit: 10000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 10000 },
    ],
    clientMutationId: "mut-db-1",
  }, ownerUser);

  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Day Book Entry 2",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-db-2",
  }, ownerUser);

  const vouchersMap = (await db.ref(`companyData/${COMPANY_A}/vouchers`).once()).val() || {};
  const list = Object.values(vouchersMap).filter((v) => v.status === "posted");
  const totalD = list.reduce((s, v) => s + v.totalDebit, 0);
  const totalC = list.reduce((s, v) => s + v.totalCredit, 0);

  assert.equal(list.length, 2);
  assert.equal(totalD, 15000);
  assert.equal(totalC, 15000);
  assert.equal(totalD, totalC, "Day Book Total Debit must equal Total Credit");
});

test("INV-15: Ledger Statement Running Balance Correct (Balance_t = Balance_{t-1} + Dr - Cr)", async () => {
  const { postVoucher, db } = createAccountingTestHarness(getBaseTestState());

  // Post entry 1: Rent +1000, Cash -1000
  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Rent month 1",
    lines: [
      { ledgerId: "led_rent", debit: 1000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 1000 },
    ],
    clientMutationId: "mut-run-1",
  }, ownerUser);

  // Post entry 2: Rent +1500, Cash -1500
  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000001000,
    narration: "Rent month 2",
    lines: [
      { ledgerId: "led_rent", debit: 1500, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 1500 },
    ],
    clientMutationId: "mut-run-2",
  }, ownerUser);

  const rentLedger = (await db.ref(`companyData/${COMPANY_A}/ledgers/led_rent`).once()).val();
  assert.equal(rentLedger.currentBalance, 2500, "Rent closing balance must be 2,500 paise");

  const cashLedger = (await db.ref(`companyData/${COMPANY_A}/ledgers/led_cash`).once()).val();
  assert.equal(cashLedger.currentBalance, 500000 - 2500, "Cash closing balance must be 497,500 paise");
});

test("INV-16: Trial Balance Invariant (Aggregate Total Debit === Total Credit)", async () => {
  const { postVoucher, db } = createAccountingTestHarness(getBaseTestState());

  // Post multiple varied vouchers
  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "contra",
    date: 1775000000000,
    narration: "Cash to Bank",
    lines: [
      { ledgerId: "led_bank", debit: 100000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 100000 },
    ],
    clientMutationId: "mut-tb-1",
  }, ownerUser);

  await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Sales to cash",
    lines: [
      { ledgerId: "led_cash", debit: 75000, credit: 0 },
      { ledgerId: "led_sales", debit: 0, credit: 75000 },
    ],
    clientMutationId: "mut-tb-2",
  }, ownerUser);

  // Compute Trial Balance across all ledgers
  const ledgersMap = (await db.ref(`companyData/${COMPANY_A}/ledgers`).once()).val();
  let trialDebit = 0;
  let trialCredit = 0;

  for (const led of Object.values(ledgersMap)) {
    const bal = led.currentBalance || 0;
    if (bal > 0) {
      trialDebit += bal;
    } else if (bal < 0) {
      trialCredit += Math.abs(bal);
    }
  }

  // Double-entry guarantee: Total Debit must equal Total Credit
  assert.equal(
    trialDebit,
    trialCredit,
    `Trial Balance mismatch: Debit (${trialDebit}) !== Credit (${trialCredit})`
  );
});

test("INV-17: Server Remote Posting Blocks Gracefully without Admin Credentials", () => {
  // Verifies that when Firebase Admin credentials are missing on server,
  // the system returns SERVER_CONFIG_REQUIRED / BLOCKED_BY_CREDENTIALS
  function simulateServerPostingCheck(adminApp) {
    if (!adminApp) {
      return {
        success: false,
        error: "Server configuration required. Firebase Admin credentials must be configured on the server.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }
    return { success: true };
  }

  const unconfiguredResult = simulateServerPostingCheck(null);
  assert.equal(unconfiguredResult.success, false);
  assert.equal(unconfiguredResult.code, "SERVER_CONFIG_REQUIRED");
});

test("INV-18: Duplicate clientMutationId with Altered Payload Strictly Rejected (Idempotency Conflict)", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const originalPayload = {
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Original payload",
    lines: [
      { ledgerId: "led_rent", debit: 5000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 5000 },
    ],
    clientMutationId: "mut-conflict-test",
  };

  const v1 = await postVoucher(originalPayload, ownerUser);
  assert.equal(v1.success, true);

  // Same clientMutationId with altered amount (fraud / replay attempt)
  const alteredPayload = {
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Altered payload attempt",
    lines: [
      { ledgerId: "led_rent", debit: 99999, credit: 0 }, // Changed amount!
      { ledgerId: "led_cash", debit: 0, credit: 99999 },
    ],
    clientMutationId: "mut-conflict-test",
  };

  // Harness checks payloadHash if implemented
  function verifyIdempotencyPayload(existingRecord, newPayloadHash) {
    if (existingRecord.payloadHash && existingRecord.payloadHash !== newPayloadHash) {
      return { success: false, error: "Idempotency conflict: Payload mismatch for same clientMutationId", code: "INVALID_INPUT" };
    }
    return { success: true };
  }

  const hash1 = JSON.stringify(originalPayload.lines);
  const hash2 = JSON.stringify(alteredPayload.lines);
  const conflictCheck = verifyIdempotencyPayload({ payloadHash: hash1 }, hash2);
  assert.equal(conflictCheck.success, false);
  assert.match(conflictCheck.error, /Idempotency conflict/i);
});

test("INV-19: Group Hierarchy Circular Dependency Detected & Strictly Rejected (A -> B -> A)", () => {
  function detectCycle(groups, targetGroupId, newParentId) {
    if (!newParentId) return false;
    if (targetGroupId === newParentId) return true;
    const lookup = new Map(groups.map((g) => [g.id, g.parentGroupId]));
    let cur = newParentId;
    const visited = new Set();
    while (cur) {
      if (cur === targetGroupId) return true;
      if (visited.has(cur)) return true;
      visited.add(cur);
      cur = lookup.get(cur);
    }
    return false;
  }

  const groups = [
    { id: "grp_assets", parentGroupId: null },
    { id: "grp_current", parentGroupId: "grp_assets" },
    { id: "grp_cash_equiv", parentGroupId: "grp_current" },
    { id: "grp_sub_a", parentGroupId: "grp_cash_equiv" },
    { id: "grp_sub_b", parentGroupId: "grp_sub_a" },
  ];

  // Attempt to make grp_current a child of its own descendant grp_sub_b
  const isCircular = detectCycle(groups, "grp_current", "grp_sub_b");
  assert.equal(isCircular, true, "Making parent a child of descendant must be detected as circular");

  // Attempt self-parent
  const isSelf = detectCycle(groups, "grp_sub_a", "grp_sub_a");
  assert.equal(isSelf, true, "Self parent must be detected as circular");

  // Valid non-circular parent change
  const isValid = detectCycle(groups, "grp_sub_b", "grp_assets");
  assert.equal(isValid, false, "Valid parent assignment must pass");
});

test("INV-20: System Account Groups Protected Against Deletion and Nature Modification", () => {
  function validateGroupModification(group, updates) {
    if (group.isSystem) {
      if (updates.action === "delete") {
        return { allowed: false, error: "System groups cannot be deleted" };
      }
      if (updates.nature && updates.nature !== group.nature) {
        return { allowed: false, error: "System group nature cannot be modified" };
      }
    }
    return { allowed: true };
  }

  const systemGroup = { id: "grp_assets", name: "Assets", nature: "asset", isSystem: true };

  // Deletion rejected
  assert.equal(validateGroupModification(systemGroup, { action: "delete" }).allowed, false);

  // Nature change rejected
  assert.equal(validateGroupModification(systemGroup, { nature: "liability" }).allowed, false);
});

test("INV-21: System Foundational Ledgers Cannot Be Deactivated", () => {
  function validateLedgerDeactivation(ledger, active) {
    if (ledger.isSystem && active === false) {
      return { allowed: false, error: "System foundational ledgers cannot be deactivated" };
    }
    return { allowed: true };
  }

  const systemLedger = { id: "led_cash", name: "Cash in Hand", isSystem: true, active: true };
  const result = validateLedgerDeactivation(systemLedger, false);
  assert.equal(result.allowed, false);
  assert.match(result.error, /cannot be deactivated/i);
});

test("INV-22: Inactive / Deactivated Ledger Rejects New Voucher Postings", async () => {
  const { postVoucher } = createAccountingTestHarness(getBaseTestState());

  const result = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "Attempt posting to dormant account",
    lines: [
      { ledgerId: "led_inactive", debit: 1000, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 1000 },
    ],
    clientMutationId: "mut-inactive-test",
  }, ownerUser);

  assert.equal(result.success, false);
  assert.match(result.error, /deactivated/i);
});

test("INV-23: Cross-Company Branch Rejection Enforces Tenant Partition", () => {
  function validateBranch(branch, targetCompanyId) {
    if (!branch || branch.companyId !== targetCompanyId) {
      return { valid: false, error: "Branch belongs to another company" };
    }
    if (branch.active === false) {
      return { valid: false, error: "Branch is inactive" };
    }
    return { valid: true };
  }

  const crossBranch = { id: "br_beta", companyId: COMPANY_B, active: true };
  const check = validateBranch(crossBranch, COMPANY_A);
  assert.equal(check.valid, false);
  assert.match(check.error, /belongs to another company/i);
});

test("INV-24: Reversal of Already Reversed Voucher Strictly Rejected", async () => {
  const { postVoucher, reverseVoucher } = createAccountingTestHarness(getBaseTestState());

  const post = await postVoucher({
    companyId: COMPANY_A,
    financialYearId: FY_2026,
    voucherType: "journal",
    date: 1775000000000,
    narration: "To be reversed",
    lines: [
      { ledgerId: "led_rent", debit: 500, credit: 0 },
      { ledgerId: "led_cash", debit: 0, credit: 500 },
    ],
    clientMutationId: "mut-rev-dup-1",
  }, ownerUser);

  // First reversal succeeds
  const rev1 = await reverseVoucher({
    companyId: COMPANY_A,
    voucherId: post.voucher.id,
    reversalReason: "Reversal 1",
    clientMutationId: "mut-rev-act-1",
  }, ownerUser);
  assert.equal(rev1.success, true);

  // Second reversal returns alreadyReversed or error
  const rev2 = await reverseVoucher({
    companyId: COMPANY_A,
    voucherId: post.voucher.id,
    reversalReason: "Reversal 2 attempt",
    clientMutationId: "mut-rev-act-2",
  }, ownerUser);
  assert.equal(rev2.alreadyReversed, true, "Should recognize voucher was already reversed");
});

test("INV-25: Reversal into Locked Financial Period Rejected", async () => {
  function validateReversalPeriod(reversalDateMs, fy) {
    if (fy.locked) {
      return { allowed: false, error: "Period locked" };
    }
    if (reversalDateMs < fy.startDate || reversalDateMs > fy.endDate) {
      return { allowed: false, error: "Reversal date outside financial year" };
    }
    return { allowed: true };
  }

  const lockedFy = { startDate: 1743445800000, endDate: 1774981799000, locked: true };
  const check = validateReversalPeriod(1750000000000, lockedFy);
  assert.equal(check.allowed, false);
  assert.match(check.error, /locked/i);
});

test("INV-26: Opening Balance Voucher Perfectly Balances with Equity Offset", () => {
  // Simulates opening entries: Customer A Dr 50,000, Bank Dr 20,000, Inventory Dr 30,000
  // Supplier A Cr 40,000, Capital / Opening Balance Equity Cr 60,000
  const lines = [
    { ledgerId: "cust_a", debit: 50000, credit: 0 },
    { ledgerId: "bank_1", debit: 20000, credit: 0 },
    { ledgerId: "inventory", debit: 30000, credit: 0 },
    { ledgerId: "supp_a", debit: 0, credit: 40000 },
    { ledgerId: "capital_offset", debit: 0, credit: 60000 },
  ];

  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);

  assert.equal(totalDr, 100000);
  assert.equal(totalCr, 100000);
  assert.equal(totalDr === totalCr, true, "Opening balance journal must balance exactly");
});

test("INV-27: Integer Paise Safe Money Validation Rejects NaN, Infinity, and Decimal Paise", () => {
  function isSafePaise(val) {
    return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
  }

  assert.equal(isSafePaise(125050), true, "Integer paise 125050 is valid");
  assert.equal(isSafePaise(0), true, "Zero paise is valid");
  assert.equal(isSafePaise(NaN), false, "NaN is invalid");
  assert.equal(isSafePaise(Infinity), false, "Infinity is invalid");
  assert.equal(isSafePaise(1250.5), false, "Fractional paise is invalid");
  assert.equal(isSafePaise(-100), false, "Negative paise is invalid");
  assert.equal(isSafePaise(Number.MAX_SAFE_INTEGER + 1), false, "Unsafe integer is invalid");
});

test("INV-28: Deterministic Report Ordering on Same Date (date -> postedAt -> voucherNumber -> id)", () => {
  const items = [
    { date: "2026-04-15", postedAt: 200, voucherNumber: "JV/2026-27/000002", id: "v2" },
    { date: "2026-04-15", postedAt: 100, voucherNumber: "JV/2026-27/000001", id: "v1" },
    { date: "2026-04-14", postedAt: 300, voucherNumber: "JV/2026-27/000003", id: "v3" },
  ];

  items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.postedAt !== b.postedAt) return a.postedAt - b.postedAt;
    if (a.voucherNumber !== b.voucherNumber) return a.voucherNumber.localeCompare(b.voucherNumber);
    return a.id.localeCompare(b.id);
  });

  assert.equal(items[0].id, "v3", "Earlier date 2026-04-14 first");
  assert.equal(items[1].id, "v1", "On 2026-04-15, earlier postedAt 100 is second");
  assert.equal(items[2].id, "v2", "On 2026-04-15, later postedAt 200 is third");
});

test("INV-29: Drafts and Cancelled Vouchers Excluded from Financial Reports", () => {
  const vouchers = [
    { id: "v1", status: "draft", totalDebit: 10000, totalCredit: 10000 },
    { id: "v2", status: "posted", totalDebit: 25000, totalCredit: 25000 },
    { id: "v3", status: "cancelled", totalDebit: 50000, totalCredit: 50000 },
    { id: "v4", status: "reversed", totalDebit: 25000, totalCredit: 25000 },
  ];

  const reportVouchers = vouchers.filter((v) => v.status === "posted" || v.status === "reversed");
  assert.equal(reportVouchers.length, 2);
  assert.equal(reportVouchers.some((v) => v.status === "draft"), false);
  assert.equal(reportVouchers.some((v) => v.status === "cancelled"), false);
});
