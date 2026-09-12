import { db, type Customer, type Invoice, type Receipt } from "@/lib/db";
import { toPaise, toRupees } from "@/modules/tax/taxEngine";

export interface PartyFinancialInsight {
  partyId: string;
  paymentPolicy: "ADVANCE" | "CREDIT";
  creditLimitPaise: number;
  creditDays: number;
  // Advance tracking (Credit balance in customer's favor)
  totalAdvanceReceivedPaise: number;
  totalAdvanceAllocatedPaise: number;
  availableAdvancePaise: number;
  availableAdvanceRupees: number;
  // Outstanding tracking (Debit balance owed by customer)
  totalInvoicedPaise: number;
  totalPaidPaise: number;
  outstandingReceivablePaise: number;
  outstandingReceivableRupees: number;
  // Status flags
  hasSufficientAdvance: (invoiceTotalPaise: number) => boolean;
  projectedCreditExposurePaise: (invoiceTotalPaise: number) => number;
  isCreditLimitExceeded: (invoiceTotalPaise: number) => boolean;
  creditExcessPaise: (invoiceTotalPaise: number) => number;
}

/**
 * Derives real-time financial position, unapplied advances, and credit exposure for a party.
 * Purely derived from posted receipts, invoices, and allocations (PRD §§ 15, 63, 65, 66).
 */
export async function getPartyFinancialInsight(
  partyId: string,
  _companyId?: string
): Promise<PartyFinancialInsight> {
  if (typeof window === "undefined") {
    return {
      partyId,
      paymentPolicy: "CREDIT",
      creditLimitPaise: 0,
      creditDays: 30,
      totalAdvanceReceivedPaise: 0,
      totalAdvanceAllocatedPaise: 0,
      availableAdvancePaise: 0,
      availableAdvanceRupees: 0,
      totalInvoicedPaise: 0,
      totalPaidPaise: 0,
      outstandingReceivablePaise: 0,
      outstandingReceivableRupees: 0,
      hasSufficientAdvance: () => true,
      projectedCreditExposurePaise: () => 0,
      isCreditLimitExceeded: () => false,
      creditExcessPaise: () => 0,
    };
  }

  // 1. Fetch party profile from Dexie
  const party = (await db().parties.get(partyId)) || (await db().customers.get(partyId));
  const paymentPolicy = party?.paymentPolicy || "CREDIT";
  const creditLimitPaise = Math.round((party?.creditLimit || 0) * 100);
  const creditDays = party?.creditDays ?? 30;

  // 2. Fetch receipts for this customer
  const receipts: Receipt[] = await db().receipts
    .where("customerId")
    .equals(partyId)
    .toArray();

  let totalAdvanceReceivedPaise = 0;
  for (const r of receipts) {
    if (r.postingStatus !== "failed" && r.postingStatus !== "reversed") {
      const isAdvance = r.allocationType === "ADVANCE" || !r.invoiceId;
      if (isAdvance) {
        totalAdvanceReceivedPaise += toPaise(r.amount);
      }
    }
  }

  // 3. Fetch invoices for this customer
  const invoices: Invoice[] = await db().invoices
    .where("customerId")
    .equals(partyId)
    .toArray();

  let totalInvoicedPaise = 0;
  let totalPaidPaise = 0;
  let totalAdvanceAllocatedPaise = 0;
  let outstandingReceivablePaise = 0;

  for (const inv of invoices) {
    if (inv.status !== "cancelled") {
      const invTotalPaise = toPaise(inv.grandTotal);
      const paidPaise = toPaise(inv.amountPaid);
      totalInvoicedPaise += invTotalPaise;
      totalPaidPaise += paidPaise;

      // Unpaid balance
      const balancePaise = Math.max(0, invTotalPaise - paidPaise);
      outstandingReceivablePaise += balancePaise;

      // Track advance applied
      if (inv.advanceAllocatedPaise) {
        totalAdvanceAllocatedPaise += inv.advanceAllocatedPaise;
      }
    }
  }

  // Available Advance: total advance receipts minus allocations
  const availableAdvancePaise = Math.max(0, totalAdvanceReceivedPaise - totalAdvanceAllocatedPaise);

  return {
    partyId,
    paymentPolicy,
    creditLimitPaise,
    creditDays,
    totalAdvanceReceivedPaise,
    totalAdvanceAllocatedPaise,
    availableAdvancePaise,
    availableAdvanceRupees: toRupees(availableAdvancePaise),
    totalInvoicedPaise,
    totalPaidPaise,
    outstandingReceivablePaise,
    outstandingReceivableRupees: toRupees(outstandingReceivablePaise),
    hasSufficientAdvance: (invoiceTotalPaise: number) => {
      if (paymentPolicy !== "ADVANCE") return true;
      return availableAdvancePaise >= invoiceTotalPaise;
    },
    projectedCreditExposurePaise: (invoiceTotalPaise: number) => {
      return outstandingReceivablePaise + invoiceTotalPaise;
    },
    isCreditLimitExceeded: (invoiceTotalPaise: number) => {
      if (paymentPolicy !== "CREDIT" || creditLimitPaise <= 0) return false;
      return (outstandingReceivablePaise + invoiceTotalPaise) > creditLimitPaise;
    },
    creditExcessPaise: (invoiceTotalPaise: number) => {
      if (paymentPolicy !== "CREDIT" || creditLimitPaise <= 0) return 0;
      const projected = outstandingReceivablePaise + invoiceTotalPaise;
      return Math.max(0, projected - creditLimitPaise);
    },
  };
}

/**
 * Allocates available customer advance against an Invoice (PRD §§ 13, 17, 64).
 * Returns updated invoice fields and remaining unapplied advance.
 */
export async function allocateAdvanceAgainstInvoice(params: {
  invoice: Invoice;
  customerId: string;
}): Promise<{
  updatedInvoice: Invoice;
  advanceAllocatedRupees: number;
  remainingAdvanceRupees: number;
}> {
  const { invoice, customerId } = params;
  const invoiceTotalPaise = toPaise(invoice.grandTotal);

  const insight = await getPartyFinancialInsight(customerId);
  const toAllocatePaise = Math.min(insight.availableAdvancePaise, invoiceTotalPaise);
  const advanceAllocatedRupees = toRupees(toAllocatePaise);

  const newAmountPaid = invoice.amountPaid + advanceAllocatedRupees;
  const newBalance = Math.max(0, invoice.grandTotal - newAmountPaid);

  const updatedInvoice: Invoice = {
    ...invoice,
    amountPaid: newAmountPaid,
    balance: newBalance,
    advanceAllocatedPaise: (invoice.advanceAllocatedPaise || 0) + toAllocatePaise,
    status: newBalance <= 0.01 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid",
  };

  const remainingAdvanceRupees = toRupees(Math.max(0, insight.availableAdvancePaise - toAllocatePaise));

  return {
    updatedInvoice,
    advanceAllocatedRupees,
    remainingAdvanceRupees,
  };
}
