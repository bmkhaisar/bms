import type { Database } from "firebase-admin/database";
import type { Ledger } from "@/modules/accounting/domain/ledger";
import type { Voucher } from "@/modules/accounting/domain/voucher";

export interface ReconcileLedgerResult {
  ledgerId: string;
  name: string;
  previousBalance: number;
  reconciledBalance: number;
  repaired: boolean;
  postedDr: number;
  postedCr: number;
  openingSigned: number;
}

/**
 * Idempotently reconciles and rebuilds the derived currentBalance cache for one or all ledgers.
 * Rule: POSTED VOUCHER LINES + OPENING BALANCE = financial source of truth.
 * currentBalance is strictly a derived cache and is never trusted as financial authority.
 * 
 * Formula:
 * opening signed balance (+ for Dr, - for Cr)
 * + all posted Dr
 * - all posted Cr
 */
export async function reconcileCompanyLedgerBalances(
  db: Database,
  companyId: string,
  targetLedgerId?: string
): Promise<{
  success: boolean;
  companyId: string;
  results: ReconcileLedgerResult[];
  repairedCount: number;
}> {
  const ledgersSnap = await db.ref(`companyData/${companyId}/ledgers`).once("value");
  const ledgersObj = (ledgersSnap.val() || {}) as Record<string, Ledger>;

  const vouchersSnap = await db.ref(`companyData/${companyId}/vouchers`).once("value");
  const vouchersObj = (vouchersSnap.val() || {}) as Record<string, Voucher>;
  const voucherList = Object.values(vouchersObj);

  // Accumulate posted movements per ledger
  const postedDrMap = new Map<string, number>();
  const postedCrMap = new Map<string, number>();

  for (const v of voucherList) {
    if (v.status !== "posted") continue;
    for (const line of v.lines || []) {
      const lId = line.ledgerId;
      postedDrMap.set(lId, (postedDrMap.get(lId) || 0) + (line.debit || 0));
      postedCrMap.set(lId, (postedCrMap.get(lId) || 0) + (line.credit || 0));
    }
  }

  const updates: Record<string, unknown> = {};
  const results: ReconcileLedgerResult[] = [];
  let repairedCount = 0;
  const now = Date.now();

  const ledgerEntries = targetLedgerId
    ? ledgersObj[targetLedgerId]
      ? [[targetLedgerId, ledgersObj[targetLedgerId]] as const]
      : []
    : Object.entries(ledgersObj);

  for (const [lId, ledger] of ledgerEntries) {
    const rawOpening = Math.abs(ledger.openingBalance || 0);
    const openingType = (ledger.openingBalanceType || "dr").toLowerCase() === "cr" ? "cr" : "dr";
    const openingSigned = openingType === "dr" ? rawOpening : -rawOpening;

    const pDr = postedDrMap.get(lId) || 0;
    const pCr = postedCrMap.get(lId) || 0;
    const derivedBalance = openingSigned + pDr - pCr;

    const storedBalance = ledger.currentBalance !== undefined ? ledger.currentBalance : 0;
    const needsRepair = storedBalance !== derivedBalance;

    if (needsRepair) {
      updates[`companyData/${companyId}/ledgers/${lId}/currentBalance`] = derivedBalance;
      updates[`companyData/${companyId}/ledgers/${lId}/updatedAt`] = now;
      repairedCount++;
    }

    results.push({
      ledgerId: lId,
      name: ledger.name,
      previousBalance: storedBalance,
      reconciledBalance: derivedBalance,
      repaired: needsRepair,
      postedDr: pDr,
      postedCr: pCr,
      openingSigned,
    });
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  return {
    success: true,
    companyId,
    results,
    repairedCount,
  };
}
