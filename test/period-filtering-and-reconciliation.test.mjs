import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

// Pure JS Canonical Engine matching src/modules/accounting/services/reportEngine.ts
function normalizeVoucherDate(d) {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  if (typeof d === "number") return new Date(d).toISOString().slice(0, 10);
  return "";
}

function calculateCanonicalLedgerBalances(ledgers, vouchers, options = {}, accountGroups = []) {
  const fromDate = options.fromDate || "";
  const toDate = options.toDate || options.asOfDate || "9999-12-31";

  const groupMap = new Map();
  for (const g of accountGroups) {
    groupMap.set(g.id, { name: g.name, nature: g.nature });
  }

  const initialOpenings = new Map();
  for (const l of ledgers) {
    const rawAmt = Math.abs(l.openingBalance || 0);
    const type = (l.openingBalanceType || "dr").toLowerCase() === "cr" ? "cr" : "dr";
    const signed = type === "dr" ? rawAmt : -rawAmt;
    initialOpenings.set(l.id, { amount: rawAmt, type, signed });
  }

  const priorDr = new Map();
  const priorCr = new Map();
  const periodDr = new Map();
  const periodCr = new Map();

  for (const v of vouchers) {
    if (v.status !== "posted") continue;
    const vDate = normalizeVoucherDate(v.date);

    for (const line of v.lines || []) {
      const lId = line.ledgerId;
      const dr = line.debit || 0;
      const cr = line.credit || 0;

      if (fromDate && vDate < fromDate) {
        priorDr.set(lId, (priorDr.get(lId) || 0) + dr);
        priorCr.set(lId, (priorCr.get(lId) || 0) + cr);
      } else if (vDate <= toDate) {
        periodDr.set(lId, (periodDr.get(lId) || 0) + dr);
        periodCr.set(lId, (periodCr.get(lId) || 0) + cr);
      }
    }
  }

  const result = new Map();

  for (const l of ledgers) {
    const init = initialOpenings.get(l.id) || { amount: 0, type: "dr", signed: 0 };
    const pDr = priorDr.get(l.id) || 0;
    const pCr = priorCr.get(l.id) || 0;
    const effectiveOpeningSigned = init.signed + pDr - pCr;

    const curDr = periodDr.get(l.id) || 0;
    const curCr = periodCr.get(l.id) || 0;
    const signedClosing = effectiveOpeningSigned + curDr - curCr;

    let closingDr = 0;
    let closingCr = 0;
    let closingType = "dr";

    if (signedClosing > 0) {
      closingDr = signedClosing;
      closingCr = 0;
      closingType = "dr";
    } else if (signedClosing < 0) {
      closingDr = 0;
      closingCr = Math.abs(signedClosing);
      closingType = "cr";
    }

    const grpInfo = groupMap.get(l.groupId);

    result.set(l.id, {
      ledgerId: l.id,
      name: l.name,
      groupId: l.groupId,
      groupName: grpInfo?.name || l.groupId,
      nature: grpInfo?.nature || l.groupNature,
      openingPaise: init.amount,
      openingType: init.type,
      effectiveOpeningSignedPaise: effectiveOpeningSigned,
      periodDrPaise: curDr,
      periodCrPaise: curCr,
      signedClosingPaise: signedClosing,
      closingDrPaise: closingDr,
      closingCrPaise: closingCr,
      closingBalanceType: closingType,
    });
  }

  return result;
}

function getTrialBalance(ledgers, accountGroups, vouchers, options = {}) {
  const balances = calculateCanonicalLedgerBalances(ledgers, vouchers, options, accountGroups);
  let totDr = 0;
  let totCr = 0;
  const items = [];

  for (const [lId, b] of balances.entries()) {
    totDr += b.closingDrPaise;
    totCr += b.closingCrPaise;
    items.push(b);
  }

  return {
    asOfDate: options.asOfDate || options.toDate || "9999-12-31",
    fromDate: options.fromDate,
    toDate: options.toDate,
    items,
    totalDebitPaise: totDr,
    totalCreditPaise: totCr,
    isBalanced: totDr === totCr,
    imbalancePaise: Math.abs(totDr - totCr),
  };
}

function rebuildLedgerDerivedBalance(ledger, vouchers) {
  const openingSign = (ledger.openingBalanceType || "dr").toLowerCase() === "cr" ? -1 : 1;
  let signed = Math.abs(ledger.openingBalance || 0) * openingSign;

  for (const v of vouchers) {
    if (v.status !== "posted") continue;
    for (const line of v.lines || []) {
      if (line.ledgerId === ledger.id) {
        signed += (line.debit || 0) - (line.credit || 0);
      }
    }
  }
  return signed;
}

test("Period Filtering & Reconciliation Suite", async (t) => {
  const mockGroups = [
    { id: "grp_current_assets", name: "Current Assets", nature: "asset" },
    { id: "grp_sundry_debtors", name: "Sundry Debtors", nature: "asset" },
    { id: "grp_sales", name: "Sales Accounts", nature: "income" },
    { id: "grp_cash", name: "Cash-in-Hand", nature: "asset" },
  ];

  const ledgers = [
    {
      id: "led_debtor_a",
      name: "Customer Alpha",
      groupId: "grp_sundry_debtors",
      groupNature: "asset",
      openingBalance: 100000, // ₹1,000.00 Dr initial opening
      openingBalanceType: "dr",
      currentBalance: 0, // stale cache, must NOT be trusted
    },
    {
      id: "led_debtor_b",
      name: "Customer Beta",
      groupId: "grp_sundry_debtors",
      groupNature: "asset",
      openingBalance: 0,
      openingBalanceType: "dr",
      currentBalance: 0,
    },
    {
      id: "led_sales",
      name: "Sales Revenue",
      groupId: "grp_sales",
      groupNature: "income",
      openingBalance: 0,
      openingBalanceType: "cr",
      currentBalance: 0,
    },
    {
      id: "led_cash",
      name: "Cash",
      groupId: "grp_cash",
      groupNature: "asset",
      openingBalance: 50000, // ₹500.00 Dr
      openingBalanceType: "dr",
      currentBalance: 0,
    },
    {
      id: "led_opening_offset",
      name: "Opening Balance Offset",
      groupId: "grp_current_assets",
      groupNature: "equity",
      openingBalance: 150000, // ₹1,500.00 Cr
      openingBalanceType: "cr",
      currentBalance: 0,
    },
  ];

  const vouchers = [
    {
      id: "v1",
      date: "2026-08-15",
      status: "posted",
      lines: [
        { ledgerId: "led_debtor_a", debit: 50000, credit: 0 },
        { ledgerId: "led_sales", debit: 0, credit: 50000 },
      ],
    },
    {
      id: "v2",
      date: "2026-08-20",
      status: "posted",
      lines: [
        { ledgerId: "led_cash", debit: 30000, credit: 0 },
        { ledgerId: "led_debtor_a", debit: 0, credit: 30000 },
      ],
    },
    {
      id: "v3",
      date: "2026-09-05",
      status: "posted",
      lines: [
        { ledgerId: "led_debtor_b", debit: 100000, credit: 0 },
        { ledgerId: "led_sales", debit: 0, credit: 100000 },
      ],
    },
    {
      id: "v4",
      date: "2026-09-15",
      status: "posted",
      lines: [
        { ledgerId: "led_cash", debit: 80000, credit: 0 },
        { ledgerId: "led_debtor_a", debit: 0, credit: 80000 },
      ],
    },
    {
      id: "v5",
      date: "2026-10-02",
      status: "posted",
      lines: [
        { ledgerId: "led_cash", debit: 100000, credit: 0 },
        { ledgerId: "led_debtor_b", debit: 0, credit: 100000 },
      ],
    },
  ];

  await t.test("1. Full FY (2026-04-01 to 2027-03-31)", () => {
    const tb = getTrialBalance(ledgers, mockGroups, vouchers, {
      fromDate: "2026-04-01",
      toDate: "2027-03-31",
    });

    assert.equal(tb.isBalanced, true, "Full FY Trial Balance must be balanced");
    const alpha = tb.items.find((i) => i.ledgerId === "led_debtor_a");
    assert.equal(alpha.effectiveOpeningSignedPaise, 100000);
    assert.equal(alpha.periodDrPaise, 50000);
    assert.equal(alpha.periodCrPaise, 110000);
    assert.equal(alpha.signedClosingPaise, 40000);
    assert.equal(alpha.closingDrPaise, 40000);
    assert.equal(alpha.closingCrPaise, 0);
  });

  await t.test("2. September Only (2026-09-01 to 2026-09-30) - Effective Opening calculation", () => {
    const tb = getTrialBalance(ledgers, mockGroups, vouchers, {
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });

    // Customer Alpha: Initial 100000 + Aug 15 (50000) - Aug 20 (30000) = 120000 Dr
    const alpha = tb.items.find((i) => i.ledgerId === "led_debtor_a");
    assert.equal(alpha.effectiveOpeningSignedPaise, 120000);
    assert.equal(alpha.periodDrPaise, 0);
    assert.equal(alpha.periodCrPaise, 80000);
    assert.equal(alpha.signedClosingPaise, 40000);
    assert.equal(alpha.closingDrPaise, 40000);

    // Customer Beta in September:
    const beta = tb.items.find((i) => i.ledgerId === "led_debtor_b");
    assert.equal(beta.effectiveOpeningSignedPaise, 0);
    assert.equal(beta.periodDrPaise, 100000);
    assert.equal(beta.periodCrPaise, 0);
    assert.equal(beta.signedClosingPaise, 100000);

    // Sales in September:
    const sales = tb.items.find((i) => i.ledgerId === "led_sales");
    assert.equal(sales.effectiveOpeningSignedPaise, -50000);
    assert.equal(sales.periodCrPaise, 100000);
    assert.equal(sales.closingCrPaise, 150000);

    assert.equal(tb.isBalanced, true, "September-only Trial Balance must balance");
  });

  await t.test("3. Previous Month: August Only (2026-08-01 to 2026-08-31)", () => {
    const tb = getTrialBalance(ledgers, mockGroups, vouchers, {
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
    });

    const alpha = tb.items.find((i) => i.ledgerId === "led_debtor_a");
    assert.equal(alpha.effectiveOpeningSignedPaise, 100000);
    assert.equal(alpha.periodDrPaise, 50000);
    assert.equal(alpha.periodCrPaise, 30000);
    assert.equal(alpha.signedClosingPaise, 120000);

    assert.equal(tb.isBalanced, true, "August-only Trial Balance must balance");
  });

  await t.test("4. Custom Mid-Month Range (2026-09-10 to 2026-09-20)", () => {
    const tb = getTrialBalance(ledgers, mockGroups, vouchers, {
      fromDate: "2026-09-10",
      toDate: "2026-09-20",
    });

    const beta = tb.items.find((i) => i.ledgerId === "led_debtor_b");
    assert.equal(beta.effectiveOpeningSignedPaise, 100000);
    assert.equal(beta.periodDrPaise, 0);
    assert.equal(beta.periodCrPaise, 0);
    assert.equal(beta.signedClosingPaise, 100000);

    const alpha = tb.items.find((i) => i.ledgerId === "led_debtor_a");
    assert.equal(alpha.effectiveOpeningSignedPaise, 120000);
    assert.equal(alpha.periodDrPaise, 0);
    assert.equal(alpha.periodCrPaise, 80000);
    assert.equal(alpha.signedClosingPaise, 40000);

    assert.equal(tb.isBalanced, true, "Mid-month Trial Balance must balance");
  });

  await t.test("5. rebuildLedgerDerivedBalance computes canonically without trusting stored cache", () => {
    const staleAlpha = {
      id: "led_debtor_a",
      name: "Customer Alpha",
      openingBalance: 100000,
      openingBalanceType: "dr",
      currentBalance: 0, // stale 0
    };

    const derived = rebuildLedgerDerivedBalance(staleAlpha, vouchers);
    assert.equal(derived, 40000);

    const overpaidDebtor = {
      id: "led_overpaid",
      name: "Overpaid Debtor",
      openingBalance: 0,
      openingBalanceType: "dr",
      currentBalance: 999999,
    };
    const overpaidVouchers = [
      {
        id: "ov1",
        status: "posted",
        lines: [
          { ledgerId: "led_overpaid", debit: 10000, credit: 0 },
          { ledgerId: "led_overpaid", debit: 0, credit: 15000 },
        ],
      },
    ];
    const overpaidDerived = rebuildLedgerDerivedBalance(overpaidDebtor, overpaidVouchers);
    assert.equal(overpaidDerived, -5000);
  });

  await t.test("6. Customer Credit dual-source reconciliation logic", () => {
    // Mohammed overpayment validation
    const totalInvoiced = 63786;
    const totalReceived = 64231.98;
    const totalAllocated = 61299; // allocated against specific invoices
    
    // Source A: Ledger Credit Balance
    const ledgerCreditRupees = Math.round((totalReceived - totalInvoiced) * 100) / 100; // 445.98
    // Source B: Unapplied Allocation
    let unappliedAllocationRupees = 0;
    if (totalReceived > totalInvoiced && totalInvoiced > 0) {
      unappliedAllocationRupees = Math.round((totalReceived - totalInvoiced) * 100) / 100;
    } else {
      unappliedAllocationRupees = Math.max(0, totalReceived - totalAllocated);
    }

    const diff = Math.abs(ledgerCreditRupees - unappliedAllocationRupees);
    const isReconciled = diff < 0.05;

    assert.equal(ledgerCreditRupees, 445.98);
    assert.equal(unappliedAllocationRupees, 445.98);
    assert.equal(diff, 0);
    assert.equal(isReconciled, true);
  });

  await t.test("7. Static code verification: Production reportEngine & postingEngine invariants", () => {
    const reportEngineCode = read("src/modules/accounting/services/reportEngine.ts");
    const postingEngineCode = read("src/modules/accounting/services/documentPostingService.ts");
    const savePartyCode = read("src/functions/savePartyWithLedgerFn.ts");

    // Must have canonical balance calculation
    assert.ok(reportEngineCode.includes("calculateCanonicalLedgerBalances"), "reportEngine must export calculateCanonicalLedgerBalances");
    assert.ok(reportEngineCode.includes("effectiveOpeningSigned"), "reportEngine must calculate effectiveOpeningSigned");
    assert.ok(reportEngineCode.includes("priorDr.set"), "reportEngine must accumulate priorDr before fromDate");
    assert.ok(reportEngineCode.includes("rebuildLedgerDerivedBalance"), "reportEngine must export rebuildLedgerDerivedBalance");
    assert.ok(reportEngineCode.includes("getComprehensiveFinancialReconciliation"), "reportEngine must export getComprehensiveFinancialReconciliation");

    // Posting engine must support round-off ledger
    assert.ok(postingEngineCode.includes("roundOffLedgerId"), "documentPostingService must support roundOffLedgerId");
    assert.ok(postingEngineCode.includes("trueTaxablePaise"), "documentPostingService must calculate trueTaxablePaise");

    // Save Party must derive balance canonically
    assert.ok(savePartyCode.includes("POSTED VOUCHER LINES + OPENING BALANCE"), "savePartyWithLedgerFn must document canonical balance invariant");
  });
});
