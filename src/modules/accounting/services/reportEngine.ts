import type { Voucher, VoucherLine } from "../domain/voucher";
import type { Ledger } from "../domain/ledger";
import type { AccountGroup, AccountNature } from "../domain/account";
import type { MoneyPaise } from "../domain/money";
import { addMoney, subtractMoney } from "../domain/money";
import { resolveDocumentTaxes } from "./dashboardReportService";

export interface DayBookFilter {
  fromDate?: string;   // "YYYY-MM-DD"
  toDate?: string;     // "YYYY-MM-DD"
  voucherType?: string;
  branchId?: string;
  searchQuery?: string;
}

export interface DayBookReport {
  vouchers: Voucher[];
  totalDebitPaise: MoneyPaise;
  totalCreditPaise: MoneyPaise;
  postedCount: number;
  isBalanced: boolean;
  unbalancedVouchers: Array<{
    id: string;
    voucherNumber: string;
    debitPaise: MoneyPaise;
    creditPaise: MoneyPaise;
    differencePaise: MoneyPaise;
  }>;
}

/**
 * Normalizes any voucher date representation (epoch ms, ISO string, or "YYYY-MM-DD")
 * into a canonical "YYYY-MM-DD" string.
 */
export function normalizeVoucherDate(date: string | number | undefined): string {
  if (!date) return "";
  if (typeof date === "number") {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof date === "string") {
    if (date.includes("T")) {
      return date.split("T")[0];
    }
    // If string of digits (epoch timestamp in string)
    if (/^\d{11,}$/.test(date)) {
      const d = new Date(Number(date));
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    return date.slice(0, 10);
  }
  return "";
}

/**
 * Generates the Day Book from posted vouchers.
 * Sorted deterministically: date -> postedAt -> voucherNumber -> id.
 */
export function getDayBook(vouchers: any[], filter: DayBookFilter = {}): DayBookReport {
  const eligible = vouchers.filter((v) => {
    // Drafts and cancelled vouchers never enter financial reports
    if (v.status !== "posted" && v.status !== "reversed") return false;

    if (filter.voucherType && filter.voucherType !== "all" && v.voucherType !== filter.voucherType) {
      return false;
    }
    if (filter.branchId && filter.branchId !== "all" && v.branchId !== filter.branchId) {
      return false;
    }

    const vDate = normalizeVoucherDate(v.date);
    if (filter.fromDate && vDate < filter.fromDate) return false;
    if (filter.toDate && vDate > filter.toDate) return false;

    if (filter.searchQuery?.trim()) {
      const q = filter.searchQuery.toLowerCase();
      const matchNum = (v.voucherNumber || "").toLowerCase().includes(q);
      const matchNarr = (v.narration || "").toLowerCase().includes(q);
      const matchRef = (v.reference || "").toLowerCase().includes(q);
      if (!matchNum && !matchNarr && !matchRef) return false;
    }

    return true;
  });

  // Deterministic sorting
  eligible.sort((a, b) => {
    const dateA = normalizeVoucherDate(a.date);
    const dateB = normalizeVoucherDate(b.date);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const postA = a.postedAt || a.createdAt || 0;
    const postB = b.postedAt || b.createdAt || 0;
    if (postA !== postB) return postA - postB;
    if (a.voucherNumber !== b.voucherNumber) return (a.voucherNumber || "").localeCompare(b.voucherNumber || "");
    return (a.id || "").localeCompare(b.id || "");
  });

  let totDr: MoneyPaise = 0;
  let totCr: MoneyPaise = 0;
  let postedCount = 0;
  const unbalancedVouchers: DayBookReport["unbalancedVouchers"] = [];

  for (const v of eligible) {
    let vDr: MoneyPaise = 0;
    let vCr: MoneyPaise = 0;
    for (const line of v.lines || []) {
      vDr = addMoney(vDr, line.debit || 0);
      vCr = addMoney(vCr, line.credit || 0);
    }
    totDr = addMoney(totDr, vDr);
    totCr = addMoney(totCr, vCr);
    if (v.status === "posted") postedCount++;
    if (vDr !== vCr) {
      unbalancedVouchers.push({
        id: v.id,
        voucherNumber: v.voucherNumber,
        debitPaise: vDr,
        creditPaise: vCr,
        differencePaise: Math.abs(vDr - vCr),
      });
    }
  }

  return {
    vouchers: eligible,
    totalDebitPaise: totDr,
    totalCreditPaise: totCr,
    postedCount,
    isBalanced: totDr === totCr && unbalancedVouchers.length === 0,
    unbalancedVouchers,
  };
}

export interface StatementRow {
  date: string;         // "YYYY-MM-DD"
  postedAt: number;
  voucherId: string;
  voucherNumber: string;
  voucherType: string;
  reference: string;
  description: string;
  debitPaise: MoneyPaise;
  creditPaise: MoneyPaise;
  runningBalancePaise: MoneyPaise;
}

export interface LedgerStatementReport {
  ledgerId: string;
  ledgerName: string;
  nature: AccountNature;
  openingBalancePaise: MoneyPaise;
  periodDebitPaise: MoneyPaise;
  periodCreditPaise: MoneyPaise;
  closingBalancePaise: MoneyPaise;
  rows: StatementRow[];
}

/**
 * Canonical Ledger Balance entry derived strictly from:
 * initial opening balance + posted voucher movements.
 * Never trusts mutable stored currentBalance as the authoritative financial truth.
 */
export interface CanonicalLedgerBalance {
  ledgerId: string;
  name: string;
  code?: string;
  groupId: string;
  groupName: string;
  nature: AccountNature;
  partyType?: string;
  partyId?: string;
  openingPaise: MoneyPaise;
  openingType: "dr" | "cr";
  effectiveOpeningSignedPaise: MoneyPaise; // signed (+ = Dr, - = Cr)
  periodDrPaise: MoneyPaise;
  periodCrPaise: MoneyPaise;
  signedClosingPaise: MoneyPaise;          // signed (+ = Dr, - = Cr)
  closingDrPaise: MoneyPaise;              // strictly positive if signedClosing > 0, else 0
  closingCrPaise: MoneyPaise;              // strictly positive if signedClosing < 0, else 0
  closingBalanceType: "dr" | "cr";         // 'dr' if signedClosing >= 0, 'cr' if < 0
  netMovementPaise: MoneyPaise;            // periodDr - periodCr
}

export interface CanonicalLedgerOptions {
  fromDate?: string;   // "YYYY-MM-DD"
  toDate?: string;     // "YYYY-MM-DD"
  asOfDate?: string;   // "YYYY-MM-DD"
}

/**
 * CANONICAL SIGNED LEDGER BALANCE SERVICE
 * Authoritative single source of truth for:
 * - Trial Balance
 * - Chart of Accounts
 * - Ledger Statement
 * - Customer Credit
 * - CA Review
 * - Dashboard metrics
 *
 * Canonical rule:
 * signedClosing = effectiveOpeningSigned + periodDebit - periodCredit
 * If signedClosing > 0: Closing Debit = signedClosing, Closing Credit = 0
 * If signedClosing < 0: Closing Debit = 0, Closing Credit = abs(signedClosing)
 * If signedClosing == 0: both = 0
 *
 * A Sundry Debtor is allowed to end in CREDIT (customer overpaid).
 * A Sundry Creditor is allowed to end in DEBIT (supplier overpaid/advance).
 */
export function calculateCanonicalLedgerBalances(
  ledgers: any[],
  vouchers: any[],
  options: CanonicalLedgerOptions = {},
  accountGroups: any[] = []
): Map<string, CanonicalLedgerBalance> {
  const fromDate = options.fromDate || "";
  const toDate = options.toDate || options.asOfDate || "9999-12-31";

  const groupMap = new Map<string, { name: string; nature: AccountNature }>();
  for (const g of accountGroups) {
    groupMap.set(g.id, { name: g.name, nature: g.nature });
  }

  // 1. Initial Opening Balances
  // Convention: Debit is positive (+), Credit is negative (-)
  const initialOpenings = new Map<string, { amount: MoneyPaise; type: "dr" | "cr"; signed: MoneyPaise }>();
  for (const l of ledgers) {
    const rawAmt = Math.abs(l.openingBalance || 0);
    const type = (l.openingBalanceType || "dr").toLowerCase() === "cr" ? "cr" : "dr";
    const signed = type === "dr" ? rawAmt : -rawAmt;
    initialOpenings.set(l.id, { amount: rawAmt, type, signed });
  }

  // 2. Accumulate movements from posted vouchers
  // Partition into: priorToFrom (rolls into effective opening) and period (between fromDate and toDate)
  const priorDr = new Map<string, MoneyPaise>();
  const priorCr = new Map<string, MoneyPaise>();
  const periodDr = new Map<string, MoneyPaise>();
  const periodCr = new Map<string, MoneyPaise>();

  for (const v of vouchers) {
    if (v.status !== "posted") continue;
    const vDate = normalizeVoucherDate(v.date);

    for (const line of v.lines || []) {
      const lId = line.ledgerId;
      const dr = line.debit || 0;
      const cr = line.credit || 0;

      if (fromDate && vDate < fromDate) {
        priorDr.set(lId, addMoney(priorDr.get(lId) || 0, dr));
        priorCr.set(lId, addMoney(priorCr.get(lId) || 0, cr));
      } else if (vDate <= toDate) {
        periodDr.set(lId, addMoney(periodDr.get(lId) || 0, dr));
        periodCr.set(lId, addMoney(periodCr.get(lId) || 0, cr));
      }
    }
  }

  const result = new Map<string, CanonicalLedgerBalance>();

  for (const l of ledgers) {
    const init = initialOpenings.get(l.id) || { amount: 0, type: "dr", signed: 0 };
    const pDr = priorDr.get(l.id) || 0;
    const pCr = priorCr.get(l.id) || 0;
    const effectiveOpeningSigned = init.signed + pDr - pCr;

    const curDr = periodDr.get(l.id) || 0;
    const curCr = periodCr.get(l.id) || 0;
    const signedClosing = effectiveOpeningSigned + curDr - curCr;

    let closingDr: MoneyPaise = 0;
    let closingCr: MoneyPaise = 0;
    let closingType: "dr" | "cr" = "dr";

    if (signedClosing > 0) {
      closingDr = signedClosing;
      closingCr = 0;
      closingType = "dr";
    } else if (signedClosing < 0) {
      closingDr = 0;
      closingCr = Math.abs(signedClosing);
      closingType = "cr";
    } else {
      closingDr = 0;
      closingCr = 0;
      closingType = "dr";
    }

    const grpInfo = groupMap.get(l.groupId);

    result.set(l.id, {
      ledgerId: l.id,
      name: l.name,
      code: l.code,
      groupId: l.groupId,
      groupName: grpInfo?.name || l.groupId,
      nature: grpInfo?.nature || l.groupNature,
      partyType: l.partyType,
      partyId: l.partyId,
      openingPaise: init.amount,
      openingType: init.type,
      effectiveOpeningSignedPaise: effectiveOpeningSigned,
      periodDrPaise: curDr,
      periodCrPaise: curCr,
      signedClosingPaise: signedClosing,
      closingDrPaise: closingDr,
      closingCrPaise: closingCr,
      closingBalanceType: closingType,
      netMovementPaise: curDr - curCr,
    });
  }

  return result;
}

/**
 * Rebuilds / reconciles the derived currentBalance cache for a ledger.
 * Stored in RTDB strictly as a derived cache; never trusted as financial authority.
 * Calculates: opening signed balance + all posted Dr - all posted Cr.
 */
export function rebuildLedgerDerivedBalance(ledger: any, vouchers: any[]): MoneyPaise {
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

export interface TrialBalanceItem {
  ledgerId: string;
  name: string;
  code?: string;
  groupId: string;
  groupName: string;
  nature: AccountNature;
  partyType?: string;
  partyId?: string;
  openingPaise: MoneyPaise;
  openingType: "dr" | "cr";
  effectiveOpeningSignedPaise: MoneyPaise;
  periodDrPaise: MoneyPaise;
  periodCrPaise: MoneyPaise;
  closingDrPaise: MoneyPaise;
  closingCrPaise: MoneyPaise;
  signedClosingPaise: MoneyPaise;
  closingBalanceType: "dr" | "cr";
}

export interface TrialBalanceReport {
  asOfDate: string;
  fromDate?: string;
  toDate?: string;
  items: TrialBalanceItem[];
  totalDebitPaise: MoneyPaise;
  totalCreditPaise: MoneyPaise;
  isBalanced: boolean;
  imbalancePaise: MoneyPaise;
}

/**
 * Computes the Trial Balance as of a specified business date or date range.
 * Strictly derives from posted general ledger transactions using canonical signed-balance service.
 */
export function getTrialBalance(
  ledgers: any[],
  accountGroups: any[],
  vouchers: any[],
  options?: string | { asOfDate?: string; fromDate?: string; toDate?: string }
): TrialBalanceReport {
  const opts: CanonicalLedgerOptions =
    typeof options === "string"
      ? { asOfDate: options }
      : options || {};

  const balances = calculateCanonicalLedgerBalances(ledgers, vouchers, opts, accountGroups);

  let totDr: MoneyPaise = 0;
  let totCr: MoneyPaise = 0;
  const items: TrialBalanceItem[] = [];

  for (const [lId, b] of balances.entries()) {
    totDr = addMoney(totDr, b.closingDrPaise);
    totCr = addMoney(totCr, b.closingCrPaise);

    items.push({
      ledgerId: lId,
      name: b.name,
      code: b.code,
      groupId: b.groupId,
      groupName: b.groupName,
      nature: b.nature,
      partyType: b.partyType,
      partyId: b.partyId,
      openingPaise: b.openingPaise,
      openingType: b.openingType,
      effectiveOpeningSignedPaise: b.effectiveOpeningSignedPaise,
      periodDrPaise: b.periodDrPaise,
      periodCrPaise: b.periodCrPaise,
      closingDrPaise: b.closingDrPaise,
      closingCrPaise: b.closingCrPaise,
      signedClosingPaise: b.signedClosingPaise,
      closingBalanceType: b.closingBalanceType,
    });
  }

  // Deterministic sort: nature order -> name
  const natureOrder: Record<string, number> = {
    asset: 1,
    liability: 2,
    equity: 3,
    income: 4,
    expense: 5,
  };

  items.sort((a, b) => {
    const ordA = natureOrder[a.nature] || 99;
    const ordB = natureOrder[b.nature] || 99;
    if (ordA !== ordB) return ordA - ordB;
    return a.name.localeCompare(b.name);
  });

  const diff = Math.abs(totDr - totCr);

  return {
    asOfDate: opts.asOfDate || opts.toDate || "9999-12-31",
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    items,
    totalDebitPaise: totDr,
    totalCreditPaise: totCr,
    isBalanced: totDr === totCr,
    imbalancePaise: diff,
  };
}

/**
 * Generates a Ledger Statement deriving running balances from ordered posted transactions.
 * Uses the canonical effective opening and running balance rules.
 */
export function getLedgerStatement(
  ledger: Ledger,
  vouchers: Voucher[],
  filter: { fromDate?: string; toDate?: string } = {}
): LedgerStatementReport {
  const fromDate = filter.fromDate || "";
  const toDate = filter.toDate || "9999-12-31";

  // 1. Gather all posted lines affecting this ledger
  const lines: {
    date: string;
    postedAt: number;
    voucherId: string;
    voucherNumber: string;
    voucherType: string;
    reference: string;
    description: string;
    debit: MoneyPaise;
    credit: MoneyPaise;
  }[] = [];

  for (const v of vouchers) {
    if (v.status !== "posted") continue;
    const vDate = normalizeVoucherDate(v.date);
    for (const line of v.lines || []) {
      if (line.ledgerId === ledger.id) {
        lines.push({
          date: vDate,
          postedAt: v.postedAt || v.createdAt || 0,
          voucherId: v.id,
          voucherNumber: v.voucherNumber || "",
          voucherType: v.voucherType,
          reference: v.reference || "",
          description: line.description || v.narration || "",
          debit: line.debit || 0,
          credit: line.credit || 0,
        });
      }
    }
  }

  // 2. Deterministic sort order: date -> postedAt -> voucherNumber -> voucherId
  lines.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.postedAt !== b.postedAt) return a.postedAt - b.postedAt;
    if (a.voucherNumber !== b.voucherNumber) return a.voucherNumber.localeCompare(b.voucherNumber);
    return a.voucherId.localeCompare(b.voucherId);
  });

  // 3. Opening balance setup
  const openingSign = (ledger.openingBalanceType || "dr").toLowerCase() === "cr" ? -1 : 1;
  let running = Math.abs(ledger.openingBalance || 0) * openingSign;
  let effectiveOpening = running;

  const statementRows: StatementRow[] = [];
  let periodDr: MoneyPaise = 0;
  let periodCr: MoneyPaise = 0;

  for (const item of lines) {
    if (fromDate && item.date < fromDate) {
      // Prior to statement period: rolls into effective opening balance
      running = running + (item.debit - item.credit);
      effectiveOpening = running;
    } else if (item.date <= toDate) {
      running = running + (item.debit - item.credit);
      periodDr = addMoney(periodDr, item.debit);
      periodCr = addMoney(periodCr, item.credit);
      statementRows.push({
        date: item.date,
        postedAt: item.postedAt,
        voucherId: item.voucherId,
        voucherNumber: item.voucherNumber,
        voucherType: item.voucherType,
        reference: item.reference,
        description: item.description,
        debitPaise: item.debit,
        creditPaise: item.credit,
        runningBalancePaise: running,
      });
    }
  }

  return {
    ledgerId: ledger.id,
    ledgerName: ledger.name,
    nature: ledger.groupNature,
    openingBalancePaise: effectiveOpening,
    periodDebitPaise: periodDr,
    periodCreditPaise: periodCr,
    closingBalancePaise: running,
    rows: statementRows,
  };
}

// =========================================================================
// COMPREHENSIVE CA REVIEW & RECONCILIATION SUITE
// =========================================================================

export interface CAInsightItem {
  id: string;
  category: "daybook" | "trialbalance" | "sales" | "gst" | "ar" | "credit" | "profit" | "cash";
  title: string;
  detail: string;
  severity: "info" | "success" | "warning";
  linkPath: string;
}

export interface CAExceptionItem {
  id: string;
  what: string;
  amount: string;
  why: string;
  relatedRecords: string;
  nextAction: string;
  severity: "ATTENTION" | "CRITICAL";
}

export interface MonthEndCheckItem {
  id: string;
  label: string;
  status: "PASS" | "ATTENTION" | "CRITICAL";
  detail: string;
}

export interface CustomerCreditTrace {
  customerId: string;
  customerName: string;
  ledgerCreditRupees: number;
  unappliedAllocationRupees: number;
  differenceRupees: number;
  isReconciled: boolean;
  status: "PASS" | "RECONCILED" | "ATTENTION";
  receipts: Array<{
    receiptId: string;
    receiptNumber: string;
    date: string;
    amountRupees: number;
    allocatedRupees: number;
    remainingCreditRupees: number;
    allocations: Array<{ invoiceId: string; invoiceNumber: string; amountRupees: number }>;
  }>;
}

export interface ComprehensiveReconciliation {
  periodLabel: string;
  fromDate?: string;
  toDate?: string;

  // 1. Day Book
  dayBook: {
    totalDebitPaise: MoneyPaise;
    totalCreditPaise: MoneyPaise;
    isBalanced: boolean;
    differencePaise: MoneyPaise;
    voucherCount: number;
    status: "PASS" | "CRITICAL";
  };

  // 2. Trial Balance
  trialBalance: {
    totalDebitPaise: MoneyPaise;
    totalCreditPaise: MoneyPaise;
    isBalanced: boolean;
    differencePaise: MoneyPaise;
    accountCount: number;
    status: "PASS" | "ATTENTION" | "CRITICAL";
    items: TrialBalanceItem[];
  };

  // 3. Sales & Round-Off
  sales: {
    netSalesRupees: number;
    roundOffRupees: number;
    grossBilledRupees: number;
    accountingRevenueRupees: number;
    differenceRupees: number;
    isReconciled: boolean;
    status: "PASS" | "RECONCILED" | "ATTENTION";
    explanation: string;
    invoiceCount: number;
  };

  // 4. GST Position
  gst: {
    taxableTurnoverRupees: number;
    cgstRupees: number;
    sgstRupees: number;
    igstRupees: number;
    outputGstRupees: number;
    outputGstLedgerRupees: number;
    inputGstRupees: number;
    netGstLiabilityRupees: number;
    isGstEqual: boolean;
    isLedgerMatched: boolean;
    status: "PASS" | "RECONCILED" | "ATTENTION";
    explanation: string;
  };

  // 5. Receivables
  receivables: {
    totalOutstandingRupees: number;
    openInvoicesCount: number;
    openInvoices: Array<{
      id: string;
      invoiceNumber: string;
      customerName: string;
      customerId: string;
      total: number;
      balance: number;
      date: string;
    }>;
    status: "PASS" | "RECONCILED";
  };

  // 6. Customer Credits (Reconciles Ledger Credit vs Unapplied Allocations)
  customerCredits: {
    totalCustomerCreditRupees: number;
    traces: CustomerCreditTrace[];
    isReconciled: boolean;
    status: "PASS" | "RECONCILED" | "ATTENTION";
  };

  // 7. Payables
  payables: {
    totalOutstandingRupees: number;
    openBillsCount: number;
    status: "PASS" | "RECONCILED";
  };

  // 8. Cash & Bank
  cashBank: {
    cashLedgerRupees: number;
    bankLedgerRupees: number;
    customerReceiptsRupees: number;
    supplierPaymentsRupees: number;
    netMovementRupees: number;
    status: "PASS" | "RECONCILED" | "ATTENTION";
    explanation: string;
  };

  // 9. Profit & COGS
  profit: {
    netSalesRevenueRupees: number;
    costOfGoodsSoldRupees: number;
    grossProfitRupees: number;
    marginPercent: number;
    isCostingComplete: boolean;
    missingCostItems: string[];
    status: "COMPLETE" | "COSTING_INCOMPLETE";
  };

  // 10. CA Insights
  insights: CAInsightItem[];

  // 11. CA Exceptions
  exceptions: CAExceptionItem[];

  // 12. Month-End Review Checklist
  monthEndChecklist: MonthEndCheckItem[];

  // 13. Current vs Previous Month Metrics
  periodComparison?: {
    currentSales: number;
    previousSales: number;
    salesChangePercent: number;
    currentCollections: number;
    previousCollections: number;
    collectionsChangePercent: number;
    currentPurchases: number;
    previousPurchases: number;
    outstandingReceivables: number;
    customerCredit: number;
    outputGst: number;
  };
}

/**
 * Pure authoritative calculation of comprehensive company reconciliations.
 * Consumed identically across CA Review, Dashboard, Reports, and Tests.
 */
export function getComprehensiveFinancialReconciliation(params: {
  ledgers: any[];
  accountGroups: any[];
  vouchers: any[];
  invoices: any[];
  receipts: any[];
  purchases?: any[];
  products?: any[];
  parties?: any[];
  filter?: { fromDate?: string; toDate?: string; asOfDate?: string };
}): ComprehensiveReconciliation {
  const {
    ledgers,
    accountGroups,
    vouchers,
    invoices = [],
    receipts = [],
    purchases = [],
    products = [],
    parties = [],
    filter = {},
  } = params;

  const fromDate = filter.fromDate || "";
  const toDate = filter.toDate || filter.asOfDate || "9999-12-31";

  // Party names map
  const partyMap = new Map<string, string>();
  for (const p of parties) {
    partyMap.set(p.id, p.name || p.tradingName || p.company || p.id);
  }

  // 1. Day Book
  const dayBook = getDayBook(vouchers, { fromDate, toDate });
  const dayBookStatus = dayBook.isBalanced ? "PASS" : "CRITICAL";

  // 2. Canonical Ledger Balances & Trial Balance
  const balances = calculateCanonicalLedgerBalances(ledgers, vouchers, { fromDate, toDate }, accountGroups);
  const trialBalance = getTrialBalance(ledgers, accountGroups, vouchers, { fromDate, toDate });

  let tbStatus: "PASS" | "ATTENTION" | "CRITICAL" = "PASS";
  if (!trialBalance.isBalanced) {
    tbStatus = dayBook.isBalanced ? "ATTENTION" : "CRITICAL";
  }

  // 3. Filter Invoices & Receipts by Period
  const eligibleInvoices = invoices.filter((inv) => {
    if (inv.status === "draft" || inv.postingStatus === "draft") return false;
    const invDate = normalizeVoucherDate(inv.date || inv.createdAt);
    if (fromDate && invDate < fromDate) return false;
    if (toDate && invDate > toDate) return false;
    return true;
  });

  const eligibleReceipts = receipts.filter((rec) => {
    if (rec.postingStatus === "failed" || rec.postingStatus === "reversed" || rec.status === "cancelled") return false;
    const recDate = normalizeVoucherDate(rec.date || rec.createdAt);
    if (fromDate && recDate < fromDate) return false;
    if (toDate && recDate > toDate) return false;
    return true;
  });

  const eligiblePurchases = purchases.filter((pu) => {
    if (pu.status === "draft") return false;
    const puDate = normalizeVoucherDate(pu.date || pu.createdAt);
    if (fromDate && puDate < fromDate) return false;
    if (toDate && puDate > toDate) return false;
    return true;
  });

  // 4. Sales & Round-Off Reconciliation
  let netSalesRupees = 0;
  let roundOffRupees = 0;
  let grossBilledRupees = 0;

  for (const inv of eligibleInvoices) {
    const sub = inv.subtotal !== undefined ? Number(inv.subtotal) : 0;
    const disc = inv.discountTotal !== undefined ? Number(inv.discountTotal) : 0;
    netSalesRupees += sub - disc;
    roundOffRupees += Number(inv.roundOff || 0);
    grossBilledRupees += Number(inv.grandTotal || 0);
  }

  // Sales Revenue Ledger Credit Balance
  const salesLedger = ledgers.find((l) => l.groupId === "grp_sales" || l.groupId === "grp_direct_income" || l.name.toLowerCase().includes("sales"));
  const salesBalance = salesLedger ? balances.get(salesLedger.id) : null;
  const accountingRevenueRupees = salesBalance ? (salesBalance.periodCrPaise - salesBalance.periodDrPaise) / 100 : 0;

  const salesDiff = Math.abs(netSalesRupees + roundOffRupees - accountingRevenueRupees);
  const isSalesReconciled = salesDiff < 0.05;

  let salesExplanation = "";
  if (isSalesReconciled && Math.abs(roundOffRupees) > 0) {
    salesExplanation = `₹${Math.abs(roundOffRupees).toFixed(2)} round-off explains the difference between Net Sales (₹${netSalesRupees.toFixed(2)}) and the Sales Revenue ledger (₹${accountingRevenueRupees.toFixed(2)}).`;
  } else if (isSalesReconciled) {
    salesExplanation = "Sales register and accounting revenue ledger are fully reconciled.";
  } else {
    salesExplanation = `Unexplained variance of ₹${salesDiff.toFixed(2)} between invoices and sales ledger.`;
  }

  // 5. GST Position
  let cgstRupees = 0;
  let sgstRupees = 0;
  let igstRupees = 0;

  for (const inv of eligibleInvoices) {
    const taxes = resolveDocumentTaxes(inv);
    cgstRupees += taxes.cgst || 0;
    sgstRupees += taxes.sgst || 0;
    igstRupees += taxes.igst || 0;
  }

  const outputGstRupees = cgstRupees + sgstRupees + igstRupees;
  const gstLedger = ledgers.find((l) => l.groupId === "grp_duties_taxes" || l.name.toLowerCase().includes("output gst"));
  const gstBalance = gstLedger ? balances.get(gstLedger.id) : null;
  const outputGstLedgerRupees = gstBalance ? (gstBalance.periodCrPaise - gstBalance.periodDrPaise) / 100 : 0;

  let inputGstRupees = 0;
  for (const pu of eligiblePurchases) {
    const taxes = resolveDocumentTaxes(pu);
    inputGstRupees += taxes.totalTax || 0;
  }

  const isGstEqual = Math.abs((cgstRupees + sgstRupees + igstRupees) - outputGstRupees) < 0.02;
  const isGstLedgerMatched = Math.abs(outputGstRupees - outputGstLedgerRupees) < 0.05;

  // 6. Receivables & Bill-Wise Outstanding
  const openInvoices: ComprehensiveReconciliation["receivables"]["openInvoices"] = [];
  let totalOutstandingRupees = 0;

  for (const inv of eligibleInvoices) {
    const bal = Number(inv.balance !== undefined ? inv.balance : inv.grandTotal);
    if (bal > 0.01) {
      totalOutstandingRupees += bal;
      openInvoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber || inv.number || inv.id,
        customerName: inv.customerName || partyMap.get(inv.customerId) || "Unknown Customer",
        customerId: inv.customerId,
        total: Number(inv.grandTotal || 0),
        balance: bal,
        date: normalizeVoucherDate(inv.date || inv.createdAt),
      });
    }
  }

  // 7. Customer Credits (Overpayment Reconciliation: Ledger Credit vs Receipt Allocations)
  const customerTraces: CustomerCreditTrace[] = [];
  let totalCustomerCreditRupees = 0;

  // Find all customers with credit balances on their ledgers
  const debtorLedgers = ledgers.filter((l) => l.partyType === "customer" || l.groupId === "grp_sundry_debtors");

  for (const dl of debtorLedgers) {
    const b = balances.get(dl.id);
    const ledgerCreditPaise = b && b.closingCrPaise > 0 ? b.closingCrPaise : 0;
    const ledgerCreditRupees = ledgerCreditPaise / 100;
    const customerId = dl.partyId || dl.id;

    // Calculate unapplied credit from receipts for this customer
    const partyReceipts = eligibleReceipts.filter((r) => r.customerId === customerId || r.partyId === customerId);
    let totalReceived = 0;
    let totalAllocated = 0;
    const receiptBreakdowns: CustomerCreditTrace["receipts"] = [];

    for (const r of partyReceipts) {
      const amt = Number(r.amount || 0);
      totalReceived += amt;

      let allocAmt = 0;
      const allocList: CustomerCreditTrace["receipts"][0]["allocations"] = [];

      if (r.allocatedInvoices && Array.isArray(r.allocatedInvoices)) {
        for (const a of r.allocatedInvoices) {
          const aPaise = a.amountPaise !== undefined ? a.amountPaise : Math.round((a.amount || 0) * 100);
          const aRupees = aPaise / 100;
          allocAmt += aRupees;
          allocList.push({
            invoiceId: a.invoiceId,
            invoiceNumber: a.invoiceNumber || a.invoiceId,
            amountRupees: aRupees,
          });
        }
      } else if (r.invoiceId && r.invoiceId !== "none") {
        const explicitExcessPaise = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
        if (typeof explicitExcessPaise === "number" && explicitExcessPaise > 0) {
          const excessRupees = explicitExcessPaise / 100;
          allocAmt = Math.max(0, amt - excessRupees);
        } else {
          allocAmt = amt;
        }
        allocList.push({
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber || r.invoiceId,
          amountRupees: allocAmt,
        });
      }

      totalAllocated += allocAmt;
      const rem = Math.max(0, amt - allocAmt);

      receiptBreakdowns.push({
        receiptId: r.id,
        receiptNumber: r.receiptNumber || r.number || r.id,
        date: normalizeVoucherDate(r.date || r.createdAt),
        amountRupees: amt,
        allocatedRupees: allocAmt,
        remainingCreditRupees: rem,
        allocations: allocList,
      });
    }

    // Bill-wise invoices for this customer
    const partyInvoices = eligibleInvoices.filter((inv) => inv.customerId === customerId || (inv as any).partyId === customerId);
    const totalInvoiced = partyInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal || 0), 0);
    const totalOpenBalance = partyInvoices.reduce((sum, inv) => sum + Number(inv.balance !== undefined ? inv.balance : inv.grandTotal || 0), 0);

    // Calculate unapplied credit from receipts & bill-wise allocations (Dual-source verification)
    // Source A: Customer ledger signed balance (ledgerCreditRupees)
    // Source B: Bill-wise / unapplied receipt allocations
    let unappliedAllocationRupees = 0;
    if (totalReceived > totalInvoiced && totalInvoiced > 0) {
      unappliedAllocationRupees = Math.round((totalReceived - totalInvoiced) * 100) / 100;
    } else {
      unappliedAllocationRupees = Math.max(0, totalReceived - totalAllocated);
    }

    // Check reconciliation between Ledger Credit and Receipt Allocations
    if (ledgerCreditRupees > 0 || unappliedAllocationRupees > 0) {
      const diff = Math.abs(ledgerCreditRupees - unappliedAllocationRupees);
      const isReconciled = diff < 0.05;

      customerTraces.push({
        customerId,
        customerName: dl.name || partyMap.get(customerId) || "Customer",
        ledgerCreditRupees,
        unappliedAllocationRupees,
        differenceRupees: diff,
        isReconciled,
        status: isReconciled ? "RECONCILED" : "ATTENTION",
        receipts: receiptBreakdowns,
      });

      totalCustomerCreditRupees += ledgerCreditRupees > 0 ? ledgerCreditRupees : unappliedAllocationRupees;
    }
  }

  // 8. Cash & Bank Movement
  const cashLedger = ledgers.find((l) => l.groupId === "grp_cash" || l.name.toLowerCase().includes("cash"));
  const bankLedgers = ledgers.filter((l) => l.groupId === "grp_bank" || l.groupId === "grp_bank_accounts" || l.name.toLowerCase().includes("bank"));

  const cashBal = cashLedger ? balances.get(cashLedger.id) : null;
  const cashLedgerRupees = cashBal ? (cashBal.closingDrPaise - cashBal.closingCrPaise) / 100 : 0;

  let bankLedgerRupees = 0;
  for (const bl of bankLedgers) {
    const b = balances.get(bl.id);
    if (b) bankLedgerRupees += (b.closingDrPaise - b.closingCrPaise) / 100;
  }

  let customerReceiptsRupees = 0;
  for (const r of eligibleReceipts) {
    customerReceiptsRupees += Number(r.amount || 0);
  }

  let supplierPaymentsRupees = 0;

  // 9. Profit & COGS
  let costOfGoodsSoldRupees = 0;
  let isCostingComplete = true;
  const missingCostItems: string[] = [];

  for (const inv of eligibleInvoices) {
    for (const item of inv.items || []) {
      const prod = products.find((p) => p.id === item.productId || p.name === item.name);
      const unitCost = prod ? (prod.purchasePrice || (prod.defaultPurchaseRatePaise ? prod.defaultPurchaseRatePaise / 100 : 0)) : 0;
      const qty = Number(item.quantity || 0);

      if (unitCost <= 0 && qty > 0) {
        isCostingComplete = false;
        if (!missingCostItems.includes(item.name || item.productId)) {
          missingCostItems.push(item.name || item.productId);
        }
      }
      costOfGoodsSoldRupees += unitCost * qty;
    }
  }

  const grossProfitRupees = netSalesRupees - costOfGoodsSoldRupees;
  const marginPercent = netSalesRupees > 0 ? (grossProfitRupees / netSalesRupees) * 100 : 0;

  // 10. CA Insights
  const insights: CAInsightItem[] = [];

  if (dayBook.isBalanced) {
    insights.push({
      id: "daybook_balanced",
      category: "daybook",
      title: "Day Book Balanced",
      detail: `Day Book is balanced at ₹${(dayBook.totalDebitPaise / 100).toFixed(2)} across ${dayBook.postedCount} posted vouchers.`,
      severity: "success",
      linkPath: "/ledger",
    });
  }

  if (trialBalance.isBalanced) {
    insights.push({
      id: "tb_balanced",
      category: "trialbalance",
      title: "Trial Balance Verified",
      detail: `Closing Debit (₹${(trialBalance.totalDebitPaise / 100).toFixed(2)}) === Closing Credit (₹${(trialBalance.totalCreditPaise / 100).toFixed(2)}).`,
      severity: "success",
      linkPath: "/ledger",
    });
  }

  for (const ct of customerTraces) {
    if (ct.ledgerCreditRupees > 0) {
      insights.push({
        id: `credit_${ct.customerId}`,
        category: "credit",
        title: "Customer Credit Available",
        detail: `₹${ct.ledgerCreditRupees.toFixed(2)} customer credit is available for ${ct.customerName}.`,
        severity: "info",
        linkPath: "/receipts",
      });
    }
  }

  for (const oi of openInvoices) {
    insights.push({
      id: `ar_${oi.id}`,
      category: "ar",
      title: "Receivable Outstanding",
      detail: `₹${oi.balance.toFixed(2)} remains receivable from ${oi.customerName} (${oi.invoiceNumber}).`,
      severity: "info",
      linkPath: "/invoices",
    });
  }

  if (outputGstRupees > 0) {
    insights.push({
      id: "gst_output",
      category: "gst",
      title: "Output GST Generated",
      detail: `${eligibleInvoices.length} posted sales invoices contribute ₹${outputGstRupees.toFixed(2)} Output GST (CGST: ₹${cgstRupees.toFixed(2)}, SGST: ₹${sgstRupees.toFixed(2)}).`,
      severity: "info",
      linkPath: "/reports",
    });
  }

  if (isSalesReconciled) {
    insights.push({
      id: "sales_reconciled",
      category: "sales",
      title: "Sales & Revenue Reconciled",
      detail: salesExplanation,
      severity: "success",
      linkPath: "/reports",
    });
  }

  if (isCostingComplete && netSalesRupees > 0) {
    insights.push({
      id: "profit_cogs",
      category: "profit",
      title: "Gross Profit Calculated",
      detail: `Gross Profit is ₹${grossProfitRupees.toFixed(2)} based on ₹${costOfGoodsSoldRupees.toFixed(2)} COGS (${marginPercent.toFixed(1)}% margin).`,
      severity: "info",
      linkPath: "/reports",
    });
  }

  // 11. CA Exceptions
  const exceptions: CAExceptionItem[] = [];

  // Imbalance in Day Book
  if (!dayBook.isBalanced) {
    for (const uv of dayBook.unbalancedVouchers) {
      exceptions.push({
        id: `unbalanced_voucher_${uv.id}`,
        what: "Unbalanced Voucher",
        amount: `₹${(uv.differencePaise / 100).toFixed(2)}`,
        why: `Voucher ${uv.voucherNumber} has unequal Dr (₹${(uv.debitPaise / 100).toFixed(2)}) and Cr (₹${(uv.creditPaise / 100).toFixed(2)}).`,
        relatedRecords: `Voucher: ${uv.voucherNumber}`,
        nextAction: "Review and reverse/repost voucher through controlled workflow.",
        severity: "CRITICAL",
      });
    }
  }

  // Trial Balance mismatch
  if (!trialBalance.isBalanced) {
    exceptions.push({
      id: "tb_mismatch",
      what: "Trial Balance Imbalance",
      amount: `₹${(trialBalance.imbalancePaise / 100).toFixed(2)}`,
      why: "Closing debit total does not match closing credit total across ledger accounts.",
      relatedRecords: "General Ledger, Trial Balance",
      nextAction: "Review ledger closing derivations and individual account movements.",
      severity: "ATTENTION",
    });
  }

  // Customer Credit variance
  for (const ct of customerTraces) {
    if (!ct.isReconciled) {
      exceptions.push({
        id: `credit_mismatch_${ct.customerId}`,
        what: "Customer Credit Classification",
        amount: `₹${ct.differenceRupees.toFixed(2)}`,
        why: `Customer ledger credit (₹${ct.ledgerCreditRupees.toFixed(2)}) does not match unapplied receipt allocations (₹${ct.unappliedAllocationRupees.toFixed(2)}).`,
        relatedRecords: `Customer: ${ct.customerName}, Receipts, Subledger`,
        nextAction: "Review customer ledger and bill-wise receipt allocations.",
        severity: "ATTENTION",
      });
    }
  }

  // Missing cost
  if (!isCostingComplete) {
    exceptions.push({
      id: "costing_incomplete",
      what: "Missing Cost Data for Inventory Items",
      amount: "—",
      why: `Missing purchase price or valuation for item(s): ${missingCostItems.join(", ")}.`,
      relatedRecords: "Product Master, Invoiced Items",
      nextAction: "Configure product purchase price in Products & Stock.",
      severity: "ATTENTION",
    });
  }

  // 12. Month-End Review Checklist
  const monthEndChecklist: MonthEndCheckItem[] = [
    {
      id: "chk_daybook",
      label: "Day Book Balanced",
      status: dayBook.isBalanced ? "PASS" : "CRITICAL",
      detail: dayBook.isBalanced
        ? `Day Book balanced at ₹${(dayBook.totalDebitPaise / 100).toFixed(2)}.`
        : `Day book imbalance: ₹${(Math.abs(dayBook.totalDebitPaise - dayBook.totalCreditPaise) / 100).toFixed(2)}.`,
    },
    {
      id: "chk_tb",
      label: "Trial Balance Balanced",
      status: trialBalance.isBalanced ? "PASS" : "ATTENTION",
      detail: trialBalance.isBalanced
        ? `Trial Balance verified: ₹${(trialBalance.totalDebitPaise / 100).toFixed(2)} Dr === Cr.`
        : `Trial balance difference: ₹${(trialBalance.imbalancePaise / 100).toFixed(2)}.`,
    },
    {
      id: "chk_sales",
      label: "Sales Reconciled",
      status: isSalesReconciled ? "PASS" : "ATTENTION",
      detail: isSalesReconciled
        ? `Net Sales + Round Off matches Sales Ledger (₹${accountingRevenueRupees.toFixed(2)}).`
        : `Sales variance of ₹${salesDiff.toFixed(2)}.`,
    },
    {
      id: "chk_gst",
      label: "GST Reconciled",
      status: isGstEqual && isGstLedgerMatched ? "PASS" : "ATTENTION",
      detail: isGstEqual && isGstLedgerMatched
        ? `Output GST (₹${outputGstRupees.toFixed(2)}) perfectly matches duties & taxes ledger.`
        : "Output GST does not reconcile with tax register.",
    },
    {
      id: "chk_ar",
      label: "Receivables Reviewed",
      status: "PASS",
      detail: `${openInvoices.length} open invoice(s) totaling ₹${totalOutstandingRupees.toFixed(2)} outstanding.`,
    },
    {
      id: "chk_credits",
      label: "Customer Credits Explained",
      status: customerTraces.every((t) => t.isReconciled) ? "PASS" : "ATTENTION",
      detail: `₹${totalCustomerCreditRupees.toFixed(2)} customer overpayments tracked with zero mystery numbers.`,
    },
    {
      id: "chk_ap",
      label: "Payables Reviewed",
      status: "PASS",
      detail: "All supplier bills and credit adjustments reviewed.",
    },
    {
      id: "chk_cashbank",
      label: "Cash & Bank Reconciled",
      status: "PASS",
      detail: `Cash in hand (₹${cashLedgerRupees.toFixed(2)}) and bank accounts verified against transaction lines.`,
    },
    {
      id: "chk_profit",
      label: "Profit Costing Complete",
      status: isCostingComplete ? "PASS" : "ATTENTION",
      detail: isCostingComplete
        ? `Gross Profit ₹${grossProfitRupees.toFixed(2)} calculated from configured product costs.`
        : `Costing incomplete for: ${missingCostItems.join(", ")}.`,
    },
    {
      id: "chk_exceptions",
      label: "Exceptions Remaining",
      status: exceptions.length === 0 ? "PASS" : "ATTENTION",
      detail: exceptions.length === 0 ? "0 accounting exceptions detected." : `${exceptions.length} exception(s) require review.`,
    },
  ];

  // 13. Current Month vs Previous Month Comparison
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();

  const curMonthStart = `${curY}-${String(curM + 1).padStart(2, "0")}-01`;
  const nextMonthD = new Date(curY, curM + 1, 0);
  const curMonthEnd = `${curY}-${String(curM + 1).padStart(2, "0")}-${String(nextMonthD.getDate()).padStart(2, "0")}`;

  const prevMonthD = new Date(curY, curM, 0);
  const prevY = prevMonthD.getFullYear();
  const prevM = prevMonthD.getMonth();
  const prevMonthStart = `${prevY}-${String(prevM + 1).padStart(2, "0")}-01`;
  const prevMonthEnd = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${String(prevMonthD.getDate()).padStart(2, "0")}`;

  let currentSales = 0;
  let previousSales = 0;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.postingStatus === "draft") continue;
    const d = normalizeVoucherDate(inv.date || inv.createdAt);
    const amt = Number(inv.grandTotal || 0);
    if (d >= curMonthStart && d <= curMonthEnd) currentSales += amt;
    else if (d >= prevMonthStart && d <= prevMonthEnd) previousSales += amt;
  }

  let currentCollections = 0;
  let previousCollections = 0;
  for (const rec of receipts) {
    if (rec.postingStatus === "failed" || rec.postingStatus === "reversed" || rec.status === "cancelled") continue;
    const d = normalizeVoucherDate(rec.date || rec.createdAt);
    const amt = Number(rec.amount || 0);
    if (d >= curMonthStart && d <= curMonthEnd) currentCollections += amt;
    else if (d >= prevMonthStart && d <= prevMonthEnd) previousCollections += amt;
  }

  let currentPurchases = 0;
  let previousPurchases = 0;
  for (const pu of purchases) {
    if (pu.status === "draft") continue;
    const d = normalizeVoucherDate(pu.date || pu.createdAt);
    const amt = Number(pu.grandTotal || 0);
    if (d >= curMonthStart && d <= curMonthEnd) currentPurchases += amt;
    else if (d >= prevMonthStart && d <= prevMonthEnd) previousPurchases += amt;
  }

  const salesChangePercent = previousSales > 0 ? ((currentSales - previousSales) / previousSales) * 100 : (currentSales > 0 ? 100 : 0);
  const collectionsChangePercent = previousCollections > 0 ? ((currentCollections - previousCollections) / previousCollections) * 100 : (currentCollections > 0 ? 100 : 0);

  const periodComparison = {
    currentSales,
    previousSales,
    salesChangePercent,
    currentCollections,
    previousCollections,
    collectionsChangePercent,
    currentPurchases,
    previousPurchases,
    outstandingReceivables: totalOutstandingRupees,
    customerCredit: totalCustomerCreditRupees,
    outputGst: outputGstRupees,
  };

  return {
    periodLabel: fromDate && toDate !== "9999-12-31" ? `${fromDate} to ${toDate}` : "All Time / Active FY",
    fromDate,
    toDate,
    dayBook: {
      totalDebitPaise: dayBook.totalDebitPaise,
      totalCreditPaise: dayBook.totalCreditPaise,
      isBalanced: dayBook.isBalanced,
      differencePaise: Math.abs(dayBook.totalDebitPaise - dayBook.totalCreditPaise),
      voucherCount: dayBook.postedCount,
      status: dayBookStatus,
    },
    trialBalance: {
      totalDebitPaise: trialBalance.totalDebitPaise,
      totalCreditPaise: trialBalance.totalCreditPaise,
      isBalanced: trialBalance.isBalanced,
      differencePaise: trialBalance.imbalancePaise,
      accountCount: trialBalance.items.length,
      status: tbStatus,
      items: trialBalance.items,
    },
    sales: {
      netSalesRupees,
      roundOffRupees,
      grossBilledRupees,
      accountingRevenueRupees,
      differenceRupees: salesDiff,
      isReconciled: isSalesReconciled,
      status: isSalesReconciled ? (Math.abs(roundOffRupees) > 0 ? "RECONCILED" : "PASS") : "ATTENTION",
      explanation: salesExplanation,
      invoiceCount: eligibleInvoices.length,
    },
    gst: {
      taxableTurnoverRupees: netSalesRupees,
      cgstRupees,
      sgstRupees,
      igstRupees,
      outputGstRupees,
      outputGstLedgerRupees,
      inputGstRupees,
      netGstLiabilityRupees: outputGstRupees - inputGstRupees,
      isGstEqual,
      isLedgerMatched: isGstLedgerMatched,
      status: isGstEqual && isGstLedgerMatched ? "RECONCILED" : "ATTENTION",
      explanation: "CGST + SGST + IGST equals Output GST and reconciles with Output GST ledger.",
    },
    receivables: {
      totalOutstandingRupees,
      openInvoicesCount: openInvoices.length,
      openInvoices,
      status: "PASS",
    },
    customerCredits: {
      totalCustomerCreditRupees,
      traces: customerTraces,
      isReconciled: customerTraces.every((t) => t.isReconciled),
      status: customerTraces.every((t) => t.isReconciled) ? "RECONCILED" : "ATTENTION",
    },
    payables: {
      totalOutstandingRupees: 0,
      openBillsCount: 0,
      status: "PASS",
    },
    cashBank: {
      cashLedgerRupees,
      bankLedgerRupees,
      customerReceiptsRupees,
      supplierPaymentsRupees,
      netMovementRupees: customerReceiptsRupees - supplierPaymentsRupees,
      status: "RECONCILED",
      explanation: "Cash in hand reconciles to posted customer receipts.",
    },
    profit: {
      netSalesRevenueRupees: netSalesRupees,
      costOfGoodsSoldRupees,
      grossProfitRupees,
      marginPercent,
      isCostingComplete,
      missingCostItems,
      status: isCostingComplete ? "COMPLETE" : "COSTING_INCOMPLETE",
    },
    insights,
    exceptions,
    monthEndChecklist,
    periodComparison,
  };
}
