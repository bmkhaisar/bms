import type { Voucher, VoucherLine } from "../domain/voucher";
import type { Ledger } from "../domain/ledger";
import type { AccountGroup, AccountNature } from "../domain/account";
import type { MoneyPaise } from "../domain/money";
import { addMoney, subtractMoney } from "../domain/money";

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
}

/**
 * Generates the Day Book from posted vouchers.
 * Sorted deterministically: date -> postedAt -> voucherNumber -> id.
 */
export function getDayBook(vouchers: Voucher[], filter: DayBookFilter = {}): DayBookReport {
  const eligible = vouchers.filter((v) => {
    // Drafts and cancelled vouchers never enter financial reports
    if (v.status !== "posted" && v.status !== "reversed") return false;

    if (filter.voucherType && filter.voucherType !== "all" && v.voucherType !== filter.voucherType) {
      return false;
    }
    if (filter.branchId && filter.branchId !== "all" && v.branchId !== filter.branchId) {
      return false;
    }
    if (filter.fromDate && v.date < filter.fromDate) return false;
    if (filter.toDate && v.date > filter.toDate) return false;

    if (filter.searchQuery?.trim()) {
      const q = filter.searchQuery.toLowerCase();
      const matchNum = v.voucherNumber.toLowerCase().includes(q);
      const matchNarr = v.narration.toLowerCase().includes(q);
      const matchRef = (v.reference || "").toLowerCase().includes(q);
      if (!matchNum && !matchNarr && !matchRef) return false;
    }

    return true;
  });

  // Deterministic sorting
  eligible.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const postA = a.postedAt || a.createdAt;
    const postB = b.postedAt || b.createdAt;
    if (postA !== postB) return postA - postB;
    if (a.voucherNumber !== b.voucherNumber) return a.voucherNumber.localeCompare(b.voucherNumber);
    return a.id.localeCompare(b.id);
  });

  let totDr: MoneyPaise = 0;
  let totCr: MoneyPaise = 0;
  let postedCount = 0;

  for (const v of eligible) {
    totDr = addMoney(totDr, v.totalDebit);
    totCr = addMoney(totCr, v.totalCredit);
    if (v.status === "posted") postedCount++;
  }

  return {
    vouchers: eligible,
    totalDebitPaise: totDr,
    totalCreditPaise: totCr,
    postedCount,
    isBalanced: totDr === totCr,
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
 * Generates a Ledger Statement deriving running balances from ordered posted transactions.
 * Never relies on mutable currentBalance as the authoritative financial truth.
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
    for (const line of v.lines) {
      if (line.ledgerId === ledger.id) {
        lines.push({
          date: v.date,
          postedAt: v.postedAt || v.createdAt,
          voucherId: v.id,
          voucherNumber: v.voucherNumber,
          voucherType: v.voucherType,
          reference: v.reference || "",
          description: line.description || v.narration,
          debit: line.debit,
          credit: line.credit,
        });
      }
    }
  }

  // 2. Deterministic sort order
  lines.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.postedAt !== b.postedAt) return a.postedAt - b.postedAt;
    if (a.voucherNumber !== b.voucherNumber) return a.voucherNumber.localeCompare(b.voucherNumber);
    return a.voucherId.localeCompare(b.voucherId);
  });

  // 3. Opening balance setup (if opening voucher exists, it appears in lines; otherwise initial opening metadata)
  const openingSign = ledger.openingBalanceType === "dr" ? 1 : -1;
  let running = (ledger.openingBalance || 0) * openingSign;
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

export interface TrialBalanceItem {
  ledgerId: string;
  name: string;
  groupId: string;
  groupName: string;
  nature: AccountNature;
  debitClosingPaise: MoneyPaise;
  creditClosingPaise: MoneyPaise;
}

export interface TrialBalanceReport {
  asOfDate: string;
  items: TrialBalanceItem[];
  totalDebitPaise: MoneyPaise;
  totalCreditPaise: MoneyPaise;
  isBalanced: boolean;
  imbalancePaise: MoneyPaise;
}

/**
 * Computes the Trial Balance as of a specified business date.
 * Strictly derives from posted general ledger transactions.
 */
export function getTrialBalance(
  ledgers: Ledger[],
  accountGroups: AccountGroup[],
  vouchers: Voucher[],
  asOfDate?: string
): TrialBalanceReport {
  const targetDate = asOfDate || "9999-12-31";
  const groupMap = new Map<string, string>();
  for (const g of accountGroups) groupMap.set(g.id, g.name);

  // Accumulate debits and credits up to asOfDate
  const netBalances = new Map<string, MoneyPaise>();

  // Initial opening balances
  for (const l of ledgers) {
    const openingSign = l.openingBalanceType === "dr" ? 1 : -1;
    netBalances.set(l.id, (l.openingBalance || 0) * openingSign);
  }

  // Apply posted vouchers up to asOfDate
  for (const v of vouchers) {
    if (v.status !== "posted") continue;
    if (v.date > targetDate) continue;

    for (const line of v.lines) {
      const cur = netBalances.get(line.ledgerId) || 0;
      netBalances.set(line.ledgerId, cur + (line.debit - line.credit));
    }
  }

  let totDr: MoneyPaise = 0;
  let totCr: MoneyPaise = 0;
  const items: TrialBalanceItem[] = [];

  for (const l of ledgers) {
    const net = netBalances.get(l.id) || 0;
    let dr: MoneyPaise = 0;
    let cr: MoneyPaise = 0;

    if (net > 0) {
      dr = net;
      totDr = addMoney(totDr, dr);
    } else if (net < 0) {
      cr = Math.abs(net);
      totCr = addMoney(totCr, cr);
    }

    items.push({
      ledgerId: l.id,
      name: l.name,
      groupId: l.groupId,
      groupName: groupMap.get(l.groupId) || l.groupId,
      nature: l.groupNature,
      debitClosingPaise: dr,
      creditClosingPaise: cr,
    });
  }

  const diff = Math.abs(totDr - totCr);

  return {
    asOfDate: targetDate,
    items,
    totalDebitPaise: totDr,
    totalCreditPaise: totCr,
    isBalanced: totDr === totCr,
    imbalancePaise: diff,
  };
}
