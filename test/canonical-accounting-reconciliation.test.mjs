import test from "node:test";
import assert from "node:assert/strict";

import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";
import { buildCanonicalReportingScope } from "../src/modules/accounting/services/reportingScope.ts";
import {
  isPostedInvoice,
  isPostedPurchase,
  isPostedReceipt,
  isPostedPayment,
  isPostedSalesReturn,
  isPostedCreditNote,
  resolveCanonicalInvoiceOutstanding,
  resolveCanonicalPurchaseOutstanding,
  calculateAuthoritativeCustomerCredits,
} from "../src/modules/accounting/services/canonicalOutstandingService.ts";

const BRANCH_MAIN = "br_main";
const BRANCH_SEC = "br_secondary";

// Fixture: Current Staging Benchmark Dataset
const stagingInvoices = [
  // 3 DRAFT Invoices (Zero Accounting Authority)
  {
    id: "inv_draft_36",
    number: "INV/2026-27/0036",
    branchId: BRANCH_MAIN,
    grandTotal: 118000,
    subtotal: 100000,
    discountTotal: 0,
    gstTotal: 18000,
    balance: 118000,
    status: "draft",
    postingStatus: "draft",
    date: 1775000000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 100000, total: 100000 }],
  },
  {
    id: "inv_draft_32",
    number: "INV/2026-27/0032",
    branchId: BRANCH_MAIN,
    grandTotal: 144800,
    subtotal: 122711.86,
    discountTotal: 0,
    gstTotal: 22088.14,
    balance: 144800,
    status: "draft",
    postingStatus: "draft",
    date: 1775010000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 122711.86, total: 122711.86 }],
  },
  {
    id: "inv_draft_18",
    number: "INV/2026-27/0018",
    branchId: BRANCH_MAIN,
    grandTotal: 138000,
    subtotal: 116949.15,
    discountTotal: 0,
    gstTotal: 21050.85,
    balance: 138000,
    status: "draft",
    postingStatus: "draft",
    date: 1775020000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 116949.15, total: 116949.15 }],
  },
  // 2 POSTED Invoices
  {
    id: "inv_posted_15",
    number: "INV/2026-27/0015",
    branchId: BRANCH_MAIN,
    customerId: "cust_beta",
    grandTotal: 67649,
    subtotal: 57329.66,
    discountTotal: 0,
    gstTotal: 10319.34,
    balance: 67649,
    amountPaid: 0,
    status: "posted",
    postingStatus: "posted",
    date: 1775030000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 57329.66, total: 57329.66 }],
  },
  {
    id: "inv_posted_02",
    number: "INV/2026-27/0002",
    branchId: BRANCH_MAIN,
    customerId: "cust_alpha",
    grandTotal: 63786,
    subtotal: 54055.93,
    discountTotal: 0,
    gstTotal: 9730.07,
    balance: 63786, // Stale balance in legacy row
    amountPaid: 0,
    status: "posted",
    postingStatus: "posted",
    date: 1775040000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 54055.93, total: 54055.93 }],
  },
];

const stagingReceipts = [
  {
    id: "rec_1",
    number: "RCP-001",
    branchId: BRANCH_MAIN,
    customerId: "cust_alpha",
    amount: 64231.98,
    mode: "bank",
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
    invoiceId: "inv_posted_02",
    allocatedInvoices: [
      {
        invoiceId: "inv_posted_02",
        invoiceNumber: "INV/2026-27/0002",
        amount: 63786,
      },
    ],
  },
];

const stagingPurchases = [
  {
    id: "pur_1",
    number: "PUR-001",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    grandTotal: 486808,
    subtotal: 412549.15,
    discountTotal: 0,
    gstTotal: 74258.85,
    balance: 483351,
    amountPaid: 3457,
    status: "partial",
    postingStatus: "posted",
    date: 1775060000000,
  },
  // Draft Purchase (Must contribute ₹0)
  {
    id: "pur_draft",
    number: "PUR-DRAFT",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    grandTotal: 100000,
    subtotal: 84745.76,
    discountTotal: 0,
    gstTotal: 15254.24,
    balance: 100000,
    amountPaid: 0,
    status: "draft",
    postingStatus: "draft",
    date: 1775065000000,
  },
];

const stagingPayments = [
  {
    id: "pay_1",
    number: "PAY-001",
    branchId: BRANCH_MAIN,
    supplierId: "supp_1",
    amount: 3457,
    mode: "bank",
    status: "posted",
    postingStatus: "posted",
    date: 1775070000000,
    purchaseId: "pur_1",
  },
];

const stagingProducts = [
  { id: "prod_1", name: "Prefab Cabin", purchasePrice: 40000, currentStock: 10, trackInventory: true },
];

const stagingBranches = [
  { id: BRANCH_MAIN, name: "Main HQ", isMainBranch: true },
  { id: BRANCH_SEC, name: "Depot", isMainBranch: false },
];

test("Rule 1 & 3: Draft invoices strictly excluded from Total Billed Sales", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // Gross posted invoices = 67,649 + 63,786 = 131,435
  // Drafts (118,000 + 144,800 + 138,000 = 400,800) must contribute ₹0
  assert.equal(metrics.totalSales, 131435, "Total Billed Sales must sum only posted invoices (₹1,31,435.00)");
  assert.notEqual(metrics.totalSales, 532235, "Total Sales must NOT include drafts (₹5,32,235.00 is wrong)");
});

test("Rule 4 & 5: Accounts Receivable derives from authoritative bill-wise receipt allocation", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // INV 0002 (63,786) was settled by receipt of 64,231.98 -> balance = 0
  // INV 0015 (67,649) is open -> balance = 67,649
  // 3 Draft invoices contribute ₹0
  // Total AR must be exactly 67,649
  assert.equal(metrics.totalReceivables, 67649, "Authoritative AR must be exactly ₹67,649.00");
  assert.notEqual(metrics.totalReceivables, 532235, "AR must NEVER include draft invoices");
});

test("Rule 5 & 18: Unallocated receipt excess creates explainable Customer Credit", () => {
  // Receipt of ₹64,231.98 with ₹63,786 allocated against INV 0002
  // Leaves 64,231.98 - 63,786 = ₹445.98 customer credit
  const { creditItems } = calculateAuthoritativeCustomerCredits({
    invoices: stagingInvoices,
    receipts: stagingReceipts,
  });

  assert.equal(creditItems.length, 1, "Exactly one customer credit trace expected");
  assert.equal(creditItems[0].customerId, "cust_alpha");
  assert.equal(creditItems[0].remainingCredit, 445.98, "Remaining credit must be exactly ₹445.98");
  assert.equal(creditItems[0].originatingNumber, "RCP-001");
});

test("Rule 6: Canonical Outstanding Resolver eliminates stale invoice balance", () => {
  const inv0002 = stagingInvoices.find((i) => i.number === "INV/2026-27/0002");
  const canonicalBal = resolveCanonicalInvoiceOutstanding(inv0002, stagingReceipts).remainingBalance;
  assert.equal(canonicalBal, 0, "INV/2026-27/0002 must resolve to ₹0.00 (PAID) despite stale row balance");

  const inv0015 = stagingInvoices.find((i) => i.number === "INV/2026-27/0015");
  const canonicalBal15 = resolveCanonicalInvoiceOutstanding(inv0015, stagingReceipts).remainingBalance;
  assert.equal(canonicalBal15, 67649, "INV/2026-27/0015 remains fully outstanding at ₹67,649.00");

  const draftInv = stagingInvoices.find((i) => i.number === "INV/2026-27/0036");
  const draftBal = resolveCanonicalInvoiceOutstanding(draftInv, stagingReceipts).remainingBalance;
  assert.equal(draftBal, 0, "Draft invoice must ALWAYS resolve to 0 canonical outstanding");
});

test("Rule 7: Cash & Bank correctly subtracts supplier payments from receipts", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // Receipts (64,231.98) - Supplier Payments (3,457.00) = 60,774.98
  assert.equal(metrics.totalAmountReceived, 64231.98, "Amount Received must be ₹64,231.98");
  assert.equal(metrics.totalPaymentsMade, 3457, "Payments Made must be ₹3,457.00");
  assert.equal(metrics.totalLiquidity, 60774.98, "Closing Cash & Bank must be ₹60,774.98 (Receipts - Payments)");
});

test("Rule 8 & 9: Sales Return reduces Net Sales, AR, and Output GST", () => {
  const returnAgainst0015 = {
    id: "ret_1",
    number: "SR-001",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    customerId: "cust_beta",
    taxableAmount: 20000,
    cgst: 1800,
    sgst: 1800,
    igst: 0,
    taxTotal: 3600,
    grandTotal: 23600,
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    date: 1775080000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 20000, total: 20000 }],
  };

  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    salesReturns: [returnAgainst0015],
    branches: stagingBranches,
    scope,
  });

  // Gross posted invoices = 131,435. Return = 23,600. Net Billed Value = 107,835
  assert.equal(metrics.totalSales, 131435, "Total Billed Sales reflects gross posted invoices");
  assert.equal(metrics.totalSalesReturns, 23600, "Returns tracked");
  assert.equal(metrics.netBilledValue, 107835, "Net Billed Value reduces by return grand total");
  // AR for INV 0015 was 67,649 - 23,600 = 44,049
  assert.equal(metrics.totalReceivables, 44049, "AR reduces by return grand total");
});

test("Rule 9: Sales return exceeding outstanding creates Customer Credit without negative AR", () => {
  // INV 0015 outstanding is 67,649. Return of 80,000 exceeds outstanding by 12,351.
  const largeReturn = {
    id: "ret_large",
    number: "SR-LARGE",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    customerId: "cust_beta",
    grandTotal: 80000,
    status: "posted",
    postingStatus: "posted",
    date: 1775085000000,
  };

  const inv0015 = stagingInvoices.find((i) => i.number === "INV/2026-27/0015");
  const remBal = resolveCanonicalInvoiceOutstanding(inv0015, [], [largeReturn]).remainingBalance;

  assert.equal(remBal, 0, "AR must not become negative; stops at ₹0.00");

  const { creditItems } = calculateAuthoritativeCustomerCredits({
    invoices: [inv0015],
    salesReturns: [largeReturn],
  });

  assert.equal(creditItems.length, 1);
  assert.equal(creditItems[0].remainingCredit, 80000 - 67649, "Excess 12,351 must become Customer Credit");
});

test("Rule 10: Restocked return reverses COGS deterministically using cost basis", () => {
  const returnRestocked = {
    id: "ret_cost",
    number: "SR-RESTOCK",
    branchId: BRANCH_MAIN,
    invoiceId: "inv_posted_15",
    taxableAmount: 50000,
    taxTotal: 9000,
    grandTotal: 59000,
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    date: 1775090000000,
    items: [{ productId: "prod_1", quantity: 1, rate: 50000, total: 50000 }],
  };

  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const baseMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  const returnMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    products: stagingProducts,
    salesReturns: [returnRestocked],
    branches: stagingBranches,
    scope,
  });

  // Product 1 cost is 40,000. 1 qty returned to stock reduces COGS by 40,000
  assert.equal(baseMetrics.costOfGoodsSold - returnMetrics.costOfGoodsSold, 40000, "COGS must reduce by item cost basis (₹40,000.00)");
});

test("Rule 13: Draft purchases strictly excluded from Total Purchases and Accounts Payable", () => {
  const scope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // pur_1 grand total is 486,808; pur_draft is 100,000 (draft)
  assert.equal(metrics.totalPurchases, 486808, "Total Purchases must exclude draft purchase");
  // AP: pur_1 balance is 483,351; pur_draft balance is 100,000 (draft)
  assert.equal(metrics.totalPayables, 483351, "AP must exclude draft purchase");
});

test("Rule 14: Strict Scope Isolation between Branch Mode and Consolidated Mode", () => {
  const consolidatedScope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: "all",
  });
  const secBranchScope = buildCanonicalReportingScope({
    companyId: "comp_test",
    activeBranchId: BRANCH_SEC,
  });

  const consolidatedMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    branches: stagingBranches,
    scope: consolidatedScope,
  });

  const secBranchMetrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    branches: stagingBranches,
    scope: secBranchScope,
  });

  assert.equal(consolidatedMetrics.totalSales, 131435, "Consolidated shows all posted sales");
  assert.equal(secBranchMetrics.totalSales, 0, "Secondary branch has 0 sales (no records match BRANCH_SEC)");
  assert.equal(secBranchMetrics.totalReceivables, 0, "Secondary branch has 0 receivables");
  assert.equal(secBranchMetrics.totalPayables, 0, "Secondary branch has 0 payables");
});

// ============================================================================
// HARDENED ACCOUNTING INVARIANT RECONCILIATION TESTS (PRD HARDENING)
// ============================================================================

test("Hardening 1: Cash & Bank derived strictly from posted double-entry voucher lines", () => {
  const ledBank = { id: "led_bank_1", name: "HDFC Bank A/c", groupId: "grp_bank", currentBalance: 0 };
  const ledCash = { id: "led_cash_1", name: "Main Cash", groupId: "grp_cash", currentBalance: 0 };
  const ledDebtor = { id: "led_debtor_1", name: "Customer Alpha", groupId: "grp_sundry_debtors", partyType: "customer" };
  const ledCreditor = { id: "led_creditor_1", name: "Supplier 1", groupId: "grp_sundry_creditors", partyType: "supplier" };
  const ledExp = { id: "led_exp_1", name: "Office Rent", groupId: "grp_indirect_expenses", groupNature: "expense" };

  const postedVouchers = [
    // Voucher 1: Customer Receipt (64,231.98 into Bank)
    {
      id: "vch_rcp_1",
      voucherNumber: "VCH-RCP-001",
      status: "posted",
      voucherType: "receipt",
      date: 1775050000000,
      lines: [
        { ledgerId: "led_bank_1", debit: 6423198, credit: 0 },
        { ledgerId: "led_debtor_1", debit: 0, credit: 6423198 },
      ],
    },
    // Voucher 2: Supplier Payment (3,457.00 out of Bank)
    {
      id: "vch_pay_1",
      voucherNumber: "VCH-PAY-001",
      status: "posted",
      voucherType: "payment",
      date: 1775070000000,
      lines: [
        { ledgerId: "led_creditor_1", debit: 345700, credit: 0 },
        { ledgerId: "led_bank_1", debit: 0, credit: 345700 },
      ],
    },
    // Voucher 3: Direct Expense paid from Cash (1,500.00 out of Cash)
    {
      id: "vch_exp_1",
      voucherNumber: "VCH-EXP-001",
      status: "posted",
      voucherType: "payment",
      date: 1775075000000,
      lines: [
        { ledgerId: "led_exp_1", debit: 150000, credit: 0 },
        { ledgerId: "led_cash_1", debit: 0, credit: 150000 },
      ],
    },
    // Voucher 4: Draft Voucher (Must have ZERO accounting authority)
    {
      id: "vch_draft_1",
      voucherNumber: "VCH-DRAFT",
      status: "draft",
      date: 1775078000000,
      lines: [
        { ledgerId: "led_bank_1", debit: 10000000, credit: 0 },
      ],
    },
  ];

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    ledgers: [ledBank, ledCash, ledDebtor, ledCreditor, ledExp],
    vouchers: postedVouchers,
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    products: stagingProducts,
    scope,
  });

  // Bank = 64,231.98 - 3,457.00 = 60,774.98
  assert.equal(metrics.bankBalance, 60774.98, "Bank closing balance must be derived from double-entry lines (₹60,774.98)");
  // Cash = -1,500.00 (spent 1500 without prior cash deposit)
  assert.equal(metrics.cashInHand, -1500, "Cash in hand must reflect signed movements (-₹1,500.00)");
  // Total liquidity = 60,774.98 - 1,500.00 = 59,274.98
  assert.equal(metrics.totalLiquidity, 59274.98, "Total Liquidity is signed sum of all Cash & Bank ledgers");
});

test("Hardening 2: Opening Cash & Bank balances included naturally in closing ledger balances", () => {
  const ledBank = {
    id: "led_bank_open",
    name: "ICICI Current A/c",
    groupId: "grp_bank",
    openingBalance: 5000000, // ₹50,000.00
    openingBalanceType: "dr",
  };
  const ledCash = {
    id: "led_cash_open",
    name: "Petty Cash",
    groupId: "grp_cash",
    openingBalance: 1000000, // ₹10,000.00
    openingBalanceType: "dr",
  };

  const vouchers = [
    {
      id: "vch_1",
      status: "posted",
      date: 1775050000000,
      lines: [
        { ledgerId: "led_bank_open", debit: 2000000, credit: 0 }, // +₹20,000
        { ledgerId: "led_cash_open", debit: 0, credit: 500000 },  // -₹5,000
      ],
    },
  ];

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    ledgers: [ledBank, ledCash],
    vouchers,
    invoices: [],
    purchases: [],
    products: [],
    scope,
  });

  assert.equal(metrics.bankBalance, 70000, "Bank closing = Opening 50,000 + Debit 20,000 = ₹70,000");
  assert.equal(metrics.cashInHand, 5000, "Cash closing = Opening 10,000 - Credit 5,000 = ₹5,000");
  assert.equal(metrics.totalLiquidity, 75000, "Total liquidity = 70,000 + 5,000 = ₹75,000");
});

test("Hardening 3: Contra transfer moves funds between cash and bank without altering total liquidity", () => {
  const ledBank = { id: "led_b", name: "State Bank of India", groupId: "grp_bank", openingBalance: 2000000, openingBalanceType: "dr" }; // ₹20,000
  const ledCash = { id: "led_c", name: "Office Cash", groupId: "grp_cash", openingBalance: 5000000, openingBalanceType: "dr" };        // ₹50,000

  // Contra Voucher: Cash deposit into bank of ₹30,000
  const contraVoucher = {
    id: "vch_contra_1",
    status: "posted",
    voucherType: "contra",
    date: 1775050000000,
    lines: [
      { ledgerId: "led_b", debit: 3000000, credit: 0 }, // Dr Bank +30,000
      { ledgerId: "led_c", debit: 0, credit: 3000000 }, // Cr Cash -30,000
    ],
  };

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    ledgers: [ledBank, ledCash],
    vouchers: [contraVoucher],
    invoices: [],
    purchases: [],
    products: [],
    scope,
  });

  assert.equal(metrics.bankBalance, 50000, "Bank increases to ₹50,000 after contra deposit");
  assert.equal(metrics.cashInHand, 20000, "Cash decreases to ₹20,000 after contra deposit");
  assert.equal(metrics.totalLiquidity, 70000, "Total liquidity conserved at ₹70,000");
});

test("Hardening 4: Negative bank / overdraft balance preserved and not clamped to zero", () => {
  const ledBank = { id: "led_od", name: "Bank Overdraft A/c", groupId: "grp_bank", openingBalance: 0 };
  const ledCreditor = { id: "led_supp", name: "Steel Vendor", groupId: "grp_sundry_creditors" };

  // Vendor payment of ₹45,000 issued via overdraft
  const odPayment = {
    id: "vch_od_1",
    status: "posted",
    voucherType: "payment",
    date: 1775050000000,
    lines: [
      { ledgerId: "led_supp", debit: 4500000, credit: 0 },
      { ledgerId: "led_od", debit: 0, credit: 4500000 }, // Cr Bank 45,000 -> -45,000 balance
    ],
  };

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    ledgers: [ledBank, ledCreditor],
    vouchers: [odPayment],
    invoices: [],
    purchases: [],
    products: [],
    scope,
  });

  assert.equal(metrics.bankBalance, -45000, "Bank balance must legitimately be negative (-₹45,000.00)");
  assert.equal(metrics.totalLiquidity, -45000, "Total liquidity must preserve signed negative balance");
});

test("Hardening 5: Credit note in subsequent period causing negative net sales is preserved", () => {
  // Period with 0 sales and a return of ₹35,000
  const returnDoc = {
    id: "ret_neg",
    number: "SR-NEG",
    branchId: BRANCH_MAIN,
    taxableAmount: 30000,
    gstTotal: 5400,
    grandTotal: 35400,
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
  };

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    invoices: [],
    purchases: [],
    products: [],
    salesReturns: [returnDoc],
    scope,
  });

  assert.equal(metrics.netSalesRevenue, -30000, "Net taxable sales revenue must be signed (-₹30,000)");
  assert.equal(metrics.netBilledValue, -35400, "Net billed value must be signed (-₹35,400)");
  assert.equal(metrics.outputGst, -5400, "Output GST after credit notes must be signed (-₹5,400)");
});

test("Hardening 6: Full AR formula maintains Opening AR, Debit Adjustments, Write-offs, and Advances", () => {
  const invoice = {
    id: "inv_full_ar",
    number: "INV/FULL/001",
    grandTotal: 50000,
    openingArPaise: 1000000,       // ₹10,000 opening AR
    debitAdjustmentsPaise: 200000,  // ₹2,000 debit adjustments (freight/interest)
    writeOffPaise: 100000,         // ₹1,000 dispute write-off
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
  };

  // Receipt allocating ₹20,000
  const receipts = [
    {
      id: "rcp_ar",
      number: "RCP-AR",
      status: "posted",
      postingStatus: "posted",
      amount: 20000,
      invoiceId: "inv_full_ar",
    },
  ];

  // Sales Return of ₹5,000
  const returns = [
    {
      id: "ret_ar",
      number: "SR-AR",
      originalInvoiceId: "inv_full_ar",
      grandTotal: 5000,
      status: "posted",
      postingStatus: "posted",
    },
  ];

  // Advance allocation applied of ₹4,000
  invoice.advanceAllocatedPaise = 400000;

  // Formula:
  // Effective Billed = Opening AR (10,000) + Invoices (50,000) + Debit Adjustments (2,000) = 62,000
  // Total Settled = Receipts (20,000) + Credit Notes (5,000) + Advance (4,000) + Write-off (1,000) = 30,000
  // Closing AR = 62,000 - 30,000 = 32,000
  const settlement = resolveCanonicalInvoiceOutstanding(invoice, receipts, returns);

  assert.equal(settlement.effectiveBilledTotal, 62000, "Effective billed = 10,000 + 50,000 + 2,000 = ₹62,000");
  assert.equal(settlement.totalSettled, 30000, "Total settled = 20,000 + 5,000 + 4,000 + 1,000 = ₹30,000");
  assert.equal(settlement.remainingBalance, 32000, "Closing AR = ₹32,000");
  assert.equal(settlement.isPaid, false);
});

test("Hardening 7: Full AP formula maintains Opening AP, Credit Adjustments, Debit Notes, and Discounts", () => {
  const purchase = {
    id: "pur_full_ap",
    number: "PUR/FULL/001",
    grandTotal: 40000,
    openingApPaise: 1500000,        // ₹15,000 opening AP
    creditAdjustmentsPaise: 150000, // ₹1,500 freight / supplementary bill
    debitNoteAllocatedPaise: 300000,// ₹3,000 debit note
    discountPaise: 50000,           // ₹500 settlement cash discount
    supplierAdvancesAppliedPaise: 200000, // ₹2,000 supplier advance applied
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
  };

  const payments = [
    {
      id: "pay_ap",
      number: "PAY-AP",
      purchaseId: "pur_full_ap",
      amount: 18000,
      status: "posted",
      postingStatus: "posted",
    },
  ];

  // Formula:
  // Effective Billed = Opening AP (15,000) + Purchases (40,000) + Credit Adj (1,500) = 56,500
  // Total Settled = Payments (18,000) + Debit Note (3,000) + Supplier Advance (2,000) + Discount (500) = 23,500
  // Closing AP = 56,500 - 23,500 = 33,000
  const settlement = resolveCanonicalPurchaseOutstanding(purchase, payments);

  assert.equal(settlement.effectiveBilledTotal, 56500, "Effective billed = 15,000 + 40,000 + 1,500 = ₹56,500");
  assert.equal(settlement.totalSettled, 23500, "Total settled = 18,000 + 3,000 + 2,000 + 500 = ₹23,500");
  assert.equal(settlement.remainingBalance, 33000, "Closing AP = ₹33,000");
  assert.equal(settlement.isPaid, false);
});

test("Hardening 8: Customer credit ₹445.98 audit trail and receipt reversal lifecycle", () => {
  const result = calculateAuthoritativeCustomerCredits({
    invoices: stagingInvoices,
    receipts: stagingReceipts,
  });

  assert.equal(result.totalCustomerCredits, 445.98, "Customer credit must be exactly ₹445.98");
  const credit = result.creditItems[0];
  assert.equal(credit.receiptNumber, "RCP-001", "Linked to receipt number");
  assert.equal(credit.customerId, "cust_alpha", "Linked to customer");
  assert.equal(credit.invoiceNumber, "INV/2026-27/0002", "Linked to settled invoice");
  assert.equal(credit.branchId, BRANCH_MAIN, "Linked to branch");
  assert.equal(credit.amountCreated, 445.98, "Credit amount created");
  assert.equal(credit.amountApplied, 63786, "Amount applied to invoice");
  assert.equal(credit.remainingAmount, 445.98, "Remaining available credit");

  // Reversing the receipt must cancel and zero out the customer credit
  const reversedReceipt = { ...stagingReceipts[0], postingStatus: "reversed" };
  const reversedResult = calculateAuthoritativeCustomerCredits({
    invoices: stagingInvoices,
    receipts: [reversedReceipt],
  });

  assert.equal(reversedResult.totalCustomerCredits, 0, "Reversed receipt creates ZERO customer credit");
  assert.equal(reversedResult.creditItems.length, 0, "No active credit items from reversed receipt");
});

test("Hardening 9: Sales Return reverses original frozen historical COGS, flags incomplete if missing", () => {
  const origInvoice = {
    id: "inv_cogs_orig",
    number: "INV/COGS/001",
    status: "posted",
    postingStatus: "posted",
    items: [
      {
        id: "item_orig_1",
        productId: "prod_cab",
        quantity: 2,
        costPrice: 42000, // Frozen historical purchase cost at sale time
        rate: 60000,
        total: 120000,
      },
    ],
  };

  // Product catalog cost subsequently changed to 75,000
  const currentCatalog = [
    { id: "prod_cab", name: "Cabin Unit", purchasePrice: 75000, currentStock: 5, trackInventory: true },
  ];

  // Return of 1 unit
  const returnDoc = {
    id: "ret_frozen",
    number: "SR-FROZEN",
    originalInvoiceId: "inv_cogs_orig",
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    items: [
      {
        invoiceItemId: "item_orig_1",
        productId: "prod_cab",
        returnQuantity: 1,
        rate: 60000,
      },
    ],
  };

  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    invoices: [origInvoice],
    purchases: [],
    products: currentCatalog,
    salesReturns: [returnDoc],
    scope,
  });

  // Gross COGS for 2 sold units at frozen cost 42,000 = 84,000
  // Returned COGS for 1 restocked unit must reverse frozen cost 42,000, NOT changed catalog price 75,000
  // Net COGS = 84,000 - 42,000 = 42,000
  assert.equal(metrics.costOfGoodsSold, 42000, "COGS must reverse frozen historical cost (₹42,000), not catalog cost (₹75,000)");
  assert.equal(metrics.isCostingIncomplete, false, "Costing is complete because historical cost was frozen");

  // Incomplete costing exception test
  const returnWithoutHistory = {
    id: "ret_nohistory",
    number: "SR-NOHIST",
    status: "posted",
    postingStatus: "posted",
    disposition: "RESTOCK_SALEABLE",
    items: [{ productId: "prod_missing_cost", returnQuantity: 1, rate: 50000 }],
  };

  const metricsIncomplete = computeDashboardMetrics({
    invoices: [],
    purchases: [],
    products: [{ id: "prod_missing_cost", name: "Unknown Part", purchasePrice: 0 }],
    salesReturns: [returnWithoutHistory],
    scope,
  });

  assert.equal(metricsIncomplete.isCostingIncomplete, true, "Must flag isCostingIncomplete when cost basis is missing");
});

test("Hardening 10: Cross-screen consistency for INV/2026-27/0002 after ₹63,786 allocation", () => {
  const inv0002 = stagingInvoices.find((i) => i.number === "INV/2026-27/0002");
  const settlement = resolveCanonicalInvoiceOutstanding(inv0002, stagingReceipts);

  // Settlement truth
  assert.equal(settlement.remainingBalance, 0, "Outstanding balance must be exactly ₹0.00");
  assert.equal(settlement.isPaid, true, "Invoice status must be Paid");
  assert.equal(settlement.totalSettled, 63786, "Settled amount must be ₹63,786.00");

  // Dashboard AR reflects 0 for INV 0002
  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });
  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  assert.equal(metrics.totalReceivables, 67649, "Only open invoice INV 0015 contributes to AR (₹67,649.00)");
  // INV 0002 is not in aging receivables (>0 only)
  assert.equal(metrics.agingReceivables.reduce((s, a) => s + a.amount, 0), 67649, "Aging only contains ₹67,649.00");
});

test("Hardening 11: Bill-wise allocation matching across invoice ID, invoice number, and correction lineage", () => {
  const invoice = {
    id: "inv_uuid_unique_999",
    number: "INV/2026-27/0002",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
  };

  // Receipt 1: allocation record stores human invoice number in invoiceId field with empty invoiceNumber
  const receiptHumanNumber = {
    id: "rcp_test_1",
    number: "REC-TEST-1",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "INV/2026-27/0002",
        invoiceNumber: "",
        amountPaise: 6378600,
      },
    ],
  };

  const settlement1 = resolveCanonicalInvoiceOutstanding(invoice, [receiptHumanNumber]);
  assert.equal(settlement1.remainingBalance, 0, "Matches allocation when invoiceId contains invoice number");
  assert.equal(settlement1.isPaid, true);

  // Receipt 2: allocation stores normalized formatting (dashes instead of slashes, lowercase)
  const receiptNormalized = {
    id: "rcp_test_2",
    number: "REC-TEST-2",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "inv-2026-27-0002",
        amountPaise: 6378600,
      },
    ],
  };

  const settlement2 = resolveCanonicalInvoiceOutstanding(invoice, [receiptNormalized]);
  assert.equal(settlement2.remainingBalance, 0, "Matches allocation with formatting variances");

  // Receipt 3: allocation was made to predecessor invoice (amendedFromId)
  const correctedInvoice = {
    id: "inv_uuid_corrected",
    number: "INV/2026-27/0002",
    amendedFromId: "INV/2026-27/0004",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
    date: 1775050000000,
  };

  const receiptToPredecessor = {
    id: "rcp_test_3",
    number: "REC-TEST-3",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    invoiceId: "INV/2026-27/0004",
  };

  const settlement3 = resolveCanonicalInvoiceOutstanding(correctedInvoice, [receiptToPredecessor]);
  assert.equal(settlement3.remainingBalance, 0, "Allocation to predecessor invoice correctly settles corrected invoice");
});

test("Hardening 12: 100% Cross-Screen Single Source of Truth Parity", () => {
  const scope = buildCanonicalReportingScope({ companyId: "comp_test", activeBranchId: "all" });

  const metrics = computeDashboardMetrics({
    invoices: stagingInvoices,
    purchases: stagingPurchases,
    receipts: stagingReceipts,
    payments: stagingPayments,
    products: stagingProducts,
    branches: stagingBranches,
    scope,
  });

  // Calculate row balances exactly as DocumentListPage does:
  const postedInvs = stagingInvoices.filter(isPostedInvoice);
  const rowSettlements = postedInvs.map((inv) =>
    resolveCanonicalInvoiceOutstanding(inv, stagingReceipts)
  );

  const sumRowBalances = rowSettlements.reduce((sum, s) => sum + s.remainingBalance, 0);

  // 1. Dashboard AR MUST equal sum of Invoice row balances
  assert.equal(metrics.totalReceivables, sumRowBalances, "Dashboard AR equals sum of invoice row balances");

  // 2. Receivables Aging total MUST equal Dashboard AR
  const agingTotal = metrics.agingReceivables.reduce((sum, a) => sum + a.amount, 0);
  assert.equal(agingTotal, metrics.totalReceivables, "Receivables Aging total strictly equals Dashboard AR");

  // 3. Paid invoice INV/0002 has 0 balance and status Paid
  const inv0002Settlement = rowSettlements.find((s) => s.invoiceNumber === "INV/2026-27/0002");
  assert.equal(inv0002Settlement.remainingBalance, 0);
  assert.equal(inv0002Settlement.isPaid, true);

  // 4. Open invoice INV/0015 has 67,649 balance and is unpaid
  const inv0015Settlement = rowSettlements.find((s) => s.invoiceNumber === "INV/2026-27/0015");
  assert.equal(inv0015Settlement.remainingBalance, 67649);
  assert.equal(inv0015Settlement.isPaid, false);
});

test("Hardening 13: Customer Credit Audit — REC/0005 (₹31,999.98) unapplied excess ₹2,932.98 vs ₹445.98 residual", () => {
  // Customer Alpha / Mohammed dataset:
  // REC/0003: Received ₹32,232.00 against invoice
  // REC/0005: Received ₹31,999.98 with ₹29,067.00 allocated against invoice and ₹2,932.98 overpayment
  const rec0003 = {
    id: "rec_003",
    number: "REC/2026-27/0003",
    customerId: "cust_alpha",
    amount: 32232.0,
    invoiceId: "INV/2026-27/0002",
    status: "posted",
    postingStatus: "posted",
  };

  const rec0005 = {
    id: "rec_005",
    number: "REC/2026-27/0005",
    customerId: "cust_alpha",
    amount: 31999.98,
    invoiceId: "INV/2026-27/0002",
    customerCreditPaise: 293298, // Pre-application unapplied overpayment
    allocatedInvoices: [
      {
        invoiceId: "INV/2026-27/0002",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 2906700, // ₹29,067.00 allocated
      },
    ],
    status: "posted",
    postingStatus: "posted",
  };

  // Pre-application Customer Credit calculation:
  const initialCreditCalc = calculateAuthoritativeCustomerCredits({
    receipts: [rec0003, rec0005],
    invoices: [],
  });

  // Authoritative pre-application customer credit on REC/0005 is exactly ₹2,932.98
  assert.equal(initialCreditCalc.totalCustomerCredits, 2932.98, "Pre-application customer credit is ₹2,932.98 from REC/0005");
  const creditItem = initialCreditCalc.creditItems[0];
  assert.equal(creditItem.receiptNumber, "REC/2026-27/0005");
  assert.equal(creditItem.amountCreated, 2932.98);
  assert.equal(creditItem.amountApplied, 29067);

  // Settlement reconciliation against invoice of ₹63,786.00:
  // REC/0003 allocated: ₹32,232.00
  // REC/0005 allocated: ₹29,067.00
  // Total explicitly allocated: ₹32,232 + ₹29,067 = ₹61,299.00
  // Remaining invoice gap before credit application: ₹63,786 - ₹61,299 = ₹2,487.00
  // Applying ₹2,487.00 of available credit clears the invoice:
  const invoiceWithCredit = {
    id: "inv_alpha_002",
    number: "INV/2026-27/0002",
    grandTotal: 63786,
    customerCreditAppliedPaise: 248700, // ₹2,487.00 applied from REC/0005 credit
    status: "posted",
    postingStatus: "posted",
  };

  const finalSettlement = resolveCanonicalInvoiceOutstanding(invoiceWithCredit, [rec0003, rec0005]);
  assert.equal(finalSettlement.remainingBalance, 0, "Invoice is fully settled (₹0.00)");
  assert.equal(finalSettlement.isPaid, true);
  assert.equal(finalSettlement.totalSettled, 63786, "Total settled equals grand total ₹63,786.00");

  // Residual customer credit after covering ₹2,487.00:
  // ₹2,932.98 - ₹2,487.00 = exactly ₹445.98!
  const residualCustomerCredit = Math.round((2932.98 - 2487.00) * 100) / 100;
  assert.equal(residualCustomerCredit, 445.98, "Residual customer credit is exactly ₹445.98");
});

test("Hardening 14: Receipt allocation by internal invoice ID", () => {
  const invoice = {
    id: "inv_internal_uuid_101",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    companyId: "comp_1",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
  };
  const receipt = {
    id: "rec_by_id",
    number: "REC-ID-1",
    customerId: "cust_alpha",
    companyId: "comp_1",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "inv_internal_uuid_101",
        amountPaise: 6378600,
      },
    ],
  };

  const settlement = resolveCanonicalInvoiceOutstanding(invoice, [receipt]);
  assert.equal(settlement.remainingBalance, 0);
  assert.equal(settlement.isPaid, true);
  assert.equal(settlement.totalSettled, 63786);
});

test("Hardening 15: Receipt allocation by invoice number", () => {
  const invoice = {
    id: "inv_internal_uuid_102",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    companyId: "comp_1",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
  };
  const receipt = {
    id: "rec_by_num",
    number: "REC-NUM-1",
    customerId: "cust_alpha",
    companyId: "comp_1",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 6378600,
      },
    ],
  };

  const settlement = resolveCanonicalInvoiceOutstanding(invoice, [receipt]);
  assert.equal(settlement.remainingBalance, 0);
  assert.equal(settlement.isPaid, true);
});

test("Hardening 16: Wrong-party allocation rejection", () => {
  const invoiceCustomerAlpha = {
    id: "inv_party_test_1",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    companyId: "comp_1",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
  };

  // Receipt is from Customer Beta with an allocation trying to reference Alpha's invoice number
  const receiptCustomerBeta = {
    id: "rec_wrong_party",
    number: "REC-BETA-1",
    customerId: "cust_beta", // DIFFERENT CUSTOMER
    companyId: "comp_1",
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "inv_party_test_1",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 6378600,
      },
    ],
  };

  // Must reject wrong-party allocation
  const settlement = resolveCanonicalInvoiceOutstanding(invoiceCustomerAlpha, [receiptCustomerBeta]);
  assert.equal(settlement.remainingBalance, 63786, "Wrong-party receipt cannot settle Customer Alpha's invoice");
  assert.equal(settlement.isPaid, false);
});

test("Hardening 17: Wrong-branch allocation rejection", () => {
  const invoiceBranch1 = {
    id: "inv_branch_test_1",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    companyId: "comp_1",
    branchId: "branch_mumbai",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
  };

  // Receipt is from Delhi branch
  const receiptBranch2 = {
    id: "rec_wrong_branch",
    number: "REC-DELHI-1",
    customerId: "cust_alpha",
    companyId: "comp_1",
    branchId: "branch_delhi", // DIFFERENT BRANCH
    status: "posted",
    postingStatus: "posted",
    amount: 63786,
    allocatedInvoices: [
      {
        invoiceId: "inv_branch_test_1",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 6378600,
      },
    ],
  };

  const settlement = resolveCanonicalInvoiceOutstanding(invoiceBranch1, [receiptBranch2]);
  assert.equal(settlement.remainingBalance, 63786, "Wrong-branch receipt cannot settle Branch 1's invoice");
  assert.equal(settlement.isPaid, false);
});

test("Hardening 18: Authoritative Customer Credit: Creation vs Explicit Application vs Available Residual", () => {
  const rec0003 = {
    id: "rec_003",
    number: "REC/2026-27/0003",
    customerId: "cust_alpha",
    amount: 32232.0,
    status: "posted",
    postingStatus: "posted",
    allocatedInvoices: [
      {
        invoiceId: "inv_002",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 3223200,
      },
    ],
  };

  const rec0005 = {
    id: "rec_005",
    number: "REC/2026-27/0005",
    customerId: "cust_alpha",
    amount: 31999.98,
    status: "posted",
    postingStatus: "posted",
    customerCreditPaise: 293298, // ₹2,932.98 created
    allocatedInvoices: [
      {
        invoiceId: "inv_002",
        invoiceNumber: "INV/2026-27/0002",
        amountPaise: 2906700,
      },
    ],
  };

  // Case A: Before explicit credit application
  const inv0002Unapplied = {
    id: "inv_002",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
  };

  const settlementBefore = resolveCanonicalInvoiceOutstanding(inv0002Unapplied, [rec0003, rec0005]);
  assert.equal(settlementBefore.remainingBalance, 2487, "Without explicit credit application, invoice outstanding is ₹2,487.00");
  assert.equal(settlementBefore.isPaid, false);

  const creditsBefore = calculateAuthoritativeCustomerCredits({
    receipts: [rec0003, rec0005],
    invoices: [inv0002Unapplied],
  });
  assert.equal(creditsBefore.customerCreditsCreated, 2932.98, "Credit Created = ₹2,932.98");
  assert.equal(creditsBefore.customerCreditsApplied, 0, "Credit Applied = ₹0.00");
  assert.equal(creditsBefore.customerCreditsAvailable, 2932.98, "Credit Available = ₹2,932.98");

  // Case B: After explicit credit application of ₹2,487.00
  const inv0002Applied = {
    id: "inv_002",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    grandTotal: 63786,
    customerCreditAppliedPaise: 248700, // Explicit allocation of ₹2,487.00
    status: "posted",
    postingStatus: "posted",
  };

  const settlementAfter = resolveCanonicalInvoiceOutstanding(inv0002Applied, [rec0003, rec0005]);
  assert.equal(settlementAfter.remainingBalance, 0, "With explicit credit application, invoice outstanding is ₹0.00 (PAID)");
  assert.equal(settlementAfter.isPaid, true);

  const creditsAfter = calculateAuthoritativeCustomerCredits({
    receipts: [rec0003, rec0005],
    invoices: [inv0002Applied],
  });
  assert.equal(creditsAfter.customerCreditsCreated, 2932.98, "Credit Created = ₹2,932.98");
  assert.equal(creditsAfter.customerCreditsApplied, 2487.0, "Credit Applied = ₹2,487.00");
  assert.equal(creditsAfter.customerCreditsAvailable, 445.98, "Credit Available = ₹445.98");
});

test("Hardening 19: Accounting Invariant — Gross Open Dues - Available Credits = Net AR Control Balance = ₹67,203.02", () => {
  // Scenario A: Before explicit credit application
  // Open Invoices:
  // INV/0002: Grand Total ₹63,786 - ₹61,299 receipt allocation = ₹2,487 outstanding
  // INV/0015: Grand Total ₹67,649 - ₹0 allocation = ₹67,649 outstanding
  // Gross Open Invoice Dues = ₹2,487 + ₹67,649 = ₹70,136.00
  // Available Customer Credit = ₹2,932.98
  // Net AR = ₹70,136.00 - ₹2,932.98 = ₹67,203.02

  const inv0002Before = {
    id: "inv_002",
    number: "INV/2026-27/0002",
    customerId: "cust_alpha",
    grandTotal: 63786,
    status: "posted",
    postingStatus: "posted",
    date: 1775010000000,
  };
  const inv0015 = {
    id: "inv_015",
    number: "INV/2026-27/0015",
    customerId: "cust_beta",
    grandTotal: 67649,
    status: "posted",
    postingStatus: "posted",
    date: 1775020000000,
  };

  const rec0003 = {
    id: "rec_003",
    number: "REC/2026-27/0003",
    customerId: "cust_alpha",
    amount: 32232.0,
    status: "posted",
    postingStatus: "posted",
    date: 1775030000000,
    allocatedInvoices: [{ invoiceId: "inv_002", amountPaise: 3223200 }],
  };

  const rec0005 = {
    id: "rec_005",
    number: "REC/2026-27/0005",
    customerId: "cust_alpha",
    amount: 31999.98,
    status: "posted",
    postingStatus: "posted",
    date: 1775040000000,
    customerCreditPaise: 293298,
    allocatedInvoices: [{ invoiceId: "inv_002", amountPaise: 2906700 }],
  };

  const debtorLedger = {
    id: "led_debtor",
    name: "Sundry Debtors",
    groupId: "grp_sundry_debtors",
    partyType: "SUNDRY_DEBTOR",
    openingBalance: 0,
    openingBalanceType: "dr",
  };

  // Double-entry vouchers:
  // Voucher 1: Sale 1 (INV/0002) Dr Sundry Debtors 63,786
  // Voucher 2: Sale 2 (INV/0015) Dr Sundry Debtors 67,649
  // Voucher 3: Receipt 1 (REC/0003) Cr Sundry Debtors 32,232
  // Voucher 4: Receipt 2 (REC/0005) Cr Sundry Debtors 31,999.98
  const vouchers = [
    {
      id: "v_1",
      status: "posted",
      date: 1775010000000,
      lines: [{ ledgerId: "led_debtor", debit: 6378600, credit: 0, storedAmountPaise: 6378600 }],
    },
    {
      id: "v_2",
      status: "posted",
      date: 1775020000000,
      lines: [{ ledgerId: "led_debtor", debit: 6764900, credit: 0, storedAmountPaise: 6764900 }],
    },
    {
      id: "v_3",
      status: "posted",
      date: 1775030000000,
      lines: [{ ledgerId: "led_debtor", debit: 0, credit: 3223200, storedAmountPaise: 3223200 }],
    },
    {
      id: "v_4",
      status: "posted",
      date: 1775040000000,
      lines: [{ ledgerId: "led_debtor", debit: 0, credit: 3199998, storedAmountPaise: 3199998 }],
    },
  ];

  const metricsBefore = computeDashboardMetrics({
    invoices: [inv0002Before, inv0015],
    purchases: [],
    receipts: [rec0003, rec0005],
    payments: [],
    products: [],
    ledgers: [debtorLedger],
    vouchers,
  });

  assert.equal(metricsBefore.grossReceivables, 70136, "Gross Open Invoice Dues = ₹70,136.00");
  assert.equal(metricsBefore.customerCreditsAvailable, 2932.98, "Available Customer Credit = ₹2,932.98");
  assert.equal(metricsBefore.netReceivables, 67203.02, "Net AR = ₹67,203.02");
  assert.equal(metricsBefore.controlLedgerReceivable, 67203.02, "Control Ledger = ₹67,203.02");
  assert.equal(metricsBefore.isArReconciled, true, "AR is 100% reconciled with customer control ledger");

  // Scenario B: After explicit credit application of ₹2,487 to INV/0002
  const inv0002After = {
    ...inv0002Before,
    customerCreditAppliedPaise: 248700,
  };

  const metricsAfter = computeDashboardMetrics({
    invoices: [inv0002After, inv0015],
    purchases: [],
    receipts: [rec0003, rec0005],
    payments: [],
    products: [],
    ledgers: [debtorLedger],
    vouchers,
  });

  assert.equal(metricsAfter.grossReceivables, 67649, "Gross Open Invoice Dues = ₹67,649.00");
  assert.equal(metricsAfter.customerCreditsCreated, 2932.98, "Credit Created = ₹2,932.98");
  assert.equal(metricsAfter.customerCreditsApplied, 2487, "Credit Applied = ₹2,487.00");
  assert.equal(metricsAfter.customerCreditsAvailable, 445.98, "Credit Available = ₹445.98");
  assert.equal(metricsAfter.netReceivables, 67203.02, "Net AR remains exactly ₹67,203.02");
  assert.equal(metricsAfter.controlLedgerReceivable, 67203.02, "Control Ledger remains exactly ₹67,203.02");
  assert.equal(metricsAfter.isArReconciled, true, "AR remains 100% reconciled");
});


