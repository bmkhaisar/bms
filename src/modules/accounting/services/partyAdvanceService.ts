import { db, type Customer, type Invoice, type Receipt, type Purchase, type Payment, type Party } from "@/lib/db";
import { toPaise, toRupees } from "@/modules/tax/taxEngine";
import { postVoucherServerFn } from "@/functions/postVoucherFn";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";

function toCanonicalDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

export interface PartyDualFinancialPosition {
  partyId: string;
  partyType: "CUSTOMER" | "SUPPLIER" | "BOTH";
  partyName: string;
  // SALES SIDE (AR Position) - Strictly Isolated
  salesSide: {
    totalInvoicedRupees: number;
    receiptsRupees: number;
    receivableOutstandingRupees: number;
    advanceReceivedRupees: number;
    unpaidInvoicesCount: number;
  };
  // PURCHASE SIDE (AP Position) - Strictly Isolated
  purchaseSide: {
    totalPurchasedRupees: number;
    paymentsRupees: number;
    payableOutstandingRupees: number;
    supplierAdvanceRupees: number;
    unpaidBillsCount: number;
  };
}

export interface CustomerCreditAllocation {
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: number;
  amountRupees: number;
}

export interface CustomerCreditBreakdown {
  receiptId: string;
  receiptNumber: string;
  receiptDate: number;
  totalReceivedPaise: number;
  totalReceivedRupees: number;
  allocatedAgainstInvoicesPaise: number;
  allocatedAgainstInvoicesRupees: number;
  remainingCreditPaise: number;
  remainingCreditRupees: number;
  allocations: CustomerCreditAllocation[];
}

export interface CanonicalCustomerCreditResult {
  partyId: string;
  availableCreditPaise: number;
  availableCreditRupees: number;
  totalReceivedPaise: number;
  totalAllocatedPaise: number;
  receiptsBreakdown: CustomerCreditBreakdown[];
}

/**
 * Pure authoritative calculation of customer credit from receipts.
 * AUTHORITATIVE FORMULA:
 * AVAILABLE CUSTOMER CREDIT = valid posted unapplied customer allocations - credit already applied - reversals/refunds.
 * Only real authoritative allocations count.
 */
export function calculateCustomerCreditFromReceipts(
  partyId: string,
  receipts: Receipt[]
): CanonicalCustomerCreditResult {
  const partyReceipts = (receipts || []).filter((r) => (r.customerId === partyId || (r as any).partyId === partyId));
  
  // Exclude failed, reversed, refunded, draft, cancelled
  const validReceipts = partyReceipts.filter((r) => {
    if (r.postingStatus === "failed" || r.postingStatus === "reversed" || r.postingStatus === "refunded") return false;
    if (r.postingStatus === "draft" || (r as any).status === "draft" || (r as any).status === "cancelled") return false;
    return true;
  });

  let totalReceivedPaise = 0;
  let totalAllocatedPaise = 0;
  const receiptsBreakdown: CustomerCreditBreakdown[] = [];

  for (const r of validReceipts) {
    const netReceivedPaise = Math.max(0, toPaise(r.amount) - (r.refundAmountPaise || 0));
    totalReceivedPaise += netReceivedPaise;

    let allocatedPaise = 0;
    let remainingCreditPaise = 0;
    let allocations: CustomerCreditAllocation[] = [];

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      allocatedPaise = r.allocatedInvoices.reduce((s, a) => s + (a.amountPaise || 0), 0);
      remainingCreditPaise = Math.max(0, netReceivedPaise - allocatedPaise);
      allocations = r.allocatedInvoices.map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoiceNumber || "",
        amountPaise: a.amountPaise,
        amountRupees: toRupees(a.amountPaise),
      }));
    } else if (r.invoiceId && r.invoiceId !== "none") {
      // Against Invoice: if explicit unapplied overpayment credit was recorded
      const explicitExcess = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
      if (typeof explicitExcess === "number" && explicitExcess > 0) {
        remainingCreditPaise = Math.min(netReceivedPaise, explicitExcess);
        allocatedPaise = Math.max(0, netReceivedPaise - remainingCreditPaise);
      } else {
        // Receipt was 100% against this invoice (e.g. historical REC/...0003)
        allocatedPaise = netReceivedPaise;
        remainingCreditPaise = 0;
      }
      allocations = [
        {
          invoiceId: r.invoiceId,
          invoiceNumber: "",
          amountPaise: allocatedPaise,
          amountRupees: toRupees(allocatedPaise),
        },
      ];
    } else {
      // Advance or On Account with no explicit allocatedInvoices
      const explicitExcess = r.advanceAvailablePaise ?? r.customerCreditPaise ?? r.unappliedCreditPaise;
      if (typeof explicitExcess === "number") {
        remainingCreditPaise = Math.min(netReceivedPaise, explicitExcess);
        allocatedPaise = Math.max(0, netReceivedPaise - remainingCreditPaise);
      } else {
        remainingCreditPaise = netReceivedPaise;
        allocatedPaise = 0;
      }
      allocations = [];
    }

    totalAllocatedPaise += allocatedPaise;
    receiptsBreakdown.push({
      receiptId: r.id,
      receiptNumber: r.number,
      receiptDate: r.date,
      totalReceivedPaise: netReceivedPaise,
      totalReceivedRupees: toRupees(netReceivedPaise),
      allocatedAgainstInvoicesPaise: allocatedPaise,
      allocatedAgainstInvoicesRupees: toRupees(allocatedPaise),
      remainingCreditPaise,
      remainingCreditRupees: toRupees(remainingCreditPaise),
      allocations,
    });
  }

  const availableCreditPaise = receiptsBreakdown.reduce((sum, b) => sum + b.remainingCreditPaise, 0);

  return {
    partyId,
    availableCreditPaise,
    availableCreditRupees: toRupees(availableCreditPaise),
    totalReceivedPaise,
    totalAllocatedPaise,
    receiptsBreakdown,
  };
}

/**
 * Derives canonical real-time customer credit position for a party.
 * Authoritative single source of truth across all screens (Party Master, Customer Insight, Invoice, Receipts, Reports).
 */
export async function getCanonicalCustomerCredit(
  partyId: string,
  receiptsOverride?: Receipt[]
): Promise<CanonicalCustomerCreditResult> {
  if (typeof window === "undefined" && !receiptsOverride) {
    return {
      partyId,
      availableCreditPaise: 0,
      availableCreditRupees: 0,
      totalReceivedPaise: 0,
      totalAllocatedPaise: 0,
      receiptsBreakdown: [],
    };
  }

  let receipts = receiptsOverride;
  if (!receipts && typeof window !== "undefined") {
    receipts = await db().receipts.where("customerId").equals(partyId).toArray();
  }

  return calculateCustomerCreditFromReceipts(partyId, receipts || []);
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

  // 2. Fetch canonical customer credit
  const canonicalCredit = await getCanonicalCustomerCredit(partyId);

  // 3. Fetch invoices for this customer
  const invoices: Invoice[] = await db().invoices
    .where("customerId")
    .equals(partyId)
    .toArray();

  let totalInvoicedPaise = 0;
  let totalPaidPaise = 0;
  let outstandingReceivablePaise = 0;

  for (const inv of invoices) {
    if (inv.status !== "cancelled" && inv.postingStatus !== "reversed") {
      const invTotalPaise = toPaise(inv.grandTotal);
      const paidPaise = toPaise(inv.amountPaid);
      totalInvoicedPaise += invTotalPaise;
      totalPaidPaise += paidPaise;

      // Unpaid balance
      const balancePaise = Math.max(0, invTotalPaise - paidPaise);
      outstandingReceivablePaise += balancePaise;
    }
  }

  const availableAdvancePaise = canonicalCredit.availableCreditPaise;

  return {
    partyId,
    paymentPolicy,
    creditLimitPaise,
    creditDays,
    totalAdvanceReceivedPaise: canonicalCredit.totalReceivedPaise,
    totalAdvanceAllocatedPaise: canonicalCredit.totalAllocatedPaise,
    availableAdvancePaise,
    availableAdvanceRupees: canonicalCredit.availableCreditRupees,
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
 * Derives independent Sales (AR) and Purchase (AP) financial positions for a Party.
 * Enforces strict isolation: Accounts Receivable and Accounts Payable are NEVER automatically netted (PRD §§ 16-18).
 */
export async function getPartyDualFinancialPosition(
  partyId: string,
  options?: {
    party?: Party | Customer | any;
    invoices?: Invoice[];
    purchases?: Purchase[];
    receipts?: Receipt[];
    payments?: Payment[];
  }
): Promise<PartyDualFinancialPosition> {
  let party = options?.party;
  let invoices = options?.invoices;
  let purchases = options?.purchases;
  let receipts = options?.receipts;
  let payments = options?.payments;

  if (typeof window !== "undefined") {
    if (!party) {
      party = (await db().parties.get(partyId)) || (await db().customers.get(partyId)) || (await db().suppliers.get(partyId));
    }
    if (!invoices) {
      invoices = await db().invoices.where("customerId").equals(partyId).toArray();
    } else {
      invoices = invoices.filter((i) => i.customerId === partyId);
    }
    if (!purchases) {
      purchases = await db().purchases.where("supplierId").equals(partyId).toArray();
    } else {
      purchases = purchases.filter((p) => p.supplierId === partyId);
    }
    if (!receipts) {
      receipts = await db().receipts.where("customerId").equals(partyId).toArray();
    } else {
      receipts = receipts.filter((r) => r.customerId === partyId);
    }
    if (!payments) {
      payments = await db().payments.where("supplierId").equals(partyId).toArray();
    } else {
      payments = payments.filter((p) => p.supplierId === partyId);
    }
  } else {
    invoices = (invoices || []).filter((i) => i.customerId === partyId);
    purchases = (purchases || []).filter((p) => p.supplierId === partyId);
    receipts = (receipts || []).filter((r) => r.customerId === partyId);
    payments = (payments || []).filter((p) => p.supplierId === partyId);
  }

  // --- SALES SIDE (Accounts Receivable) ---
  const postedInvoices = (invoices || []).filter(
    (i) => i.status !== "cancelled" && i.postingStatus !== "reversed"
  );
  const totalInvoicedPaise = postedInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0);
  const receivableOutstandingPaise = postedInvoices.reduce((s, i) => s + toPaise(i.balance), 0);
  const unpaidInvoicesCount = postedInvoices.filter((i) => i.balance > 0.01).length;

  const validReceipts = (receipts || []).filter(
    (r) => r.postingStatus !== "failed" && r.postingStatus !== "reversed" && r.postingStatus !== "refunded"
  );
  const totalReceiptsPaise = validReceipts.reduce((s, r) => s + toPaise(r.amount), 0);

  // Canonical customer credit position
  const canonicalCredit = calculateCustomerCreditFromReceipts(partyId, receipts || []);
  const advanceReceivedRupees = canonicalCredit.availableCreditRupees;

  // --- PURCHASE SIDE (Accounts Payable) ---
  const postedPurchases = (purchases || []).filter(
    (p) => p.postingStatus !== "draft" && p.postingStatus !== "failed" && p.postingStatus !== "reversed"
  );
  const totalPurchasedPaise = postedPurchases.reduce((s, p) => s + toPaise(p.grandTotal), 0);
  const payableOutstandingPaise = postedPurchases.reduce((s, p) => s + toPaise(p.balance), 0);
  const unpaidBillsCount = postedPurchases.filter((p) => p.balance > 0.01).length;

  const validPayments = (payments || []).filter(
    (p) => p.postingStatus !== "failed" && p.postingStatus !== "reversed"
  );
  const totalPaymentsPaise = validPayments.reduce((s, p) => s + toPaise(p.amount), 0);
  const supplierAdvancePaise = validPayments
    .filter((p) => !p.purchaseId)
    .reduce((s, p) => s + toPaise(p.amount), 0);

  return {
    partyId,
    partyType: (party?.partyType as any) || "CUSTOMER",
    partyName: party?.name || "Party",
    salesSide: {
      totalInvoicedRupees: toRupees(totalInvoicedPaise),
      receiptsRupees: toRupees(totalReceiptsPaise),
      receivableOutstandingRupees: toRupees(receivableOutstandingPaise),
      advanceReceivedRupees,
      unpaidInvoicesCount,
    },
    purchaseSide: {
      totalPurchasedRupees: toRupees(totalPurchasedPaise),
      paymentsRupees: toRupees(totalPaymentsPaise),
      payableOutstandingRupees: toRupees(payableOutstandingPaise),
      supplierAdvanceRupees: toRupees(supplierAdvancePaise),
      unpaidBillsCount,
    },
  };
}

/**
 * Allocates available customer advance against an Invoice (PRD §§ 13, 17, 64; Addendum § 9).
 * Preserves advance audit links and correctly adjusts advance tax previously accounted for.
 * Prevents duplicate GST on invoice.
 */
export async function allocateAdvanceAgainstInvoice(params: {
  invoice: Invoice;
  customerId: string;
}): Promise<{
  updatedInvoice: Invoice;
  advanceAllocatedRupees: number;
  remainingAdvanceRupees: number;
  advanceTaxAdjustedRupees: number;
}> {
  const { invoice, customerId } = params;
  const invoiceTotalPaise = toPaise(invoice.grandTotal);
  const alreadyPaidPaise = toPaise(invoice.amountPaid);
  let neededPaise = Math.max(0, invoiceTotalPaise - alreadyPaidPaise);

  let totalAllocatedPaise = 0;
  let totalTaxAdjustedPaise = 0;
  const newAllocations: NonNullable<Invoice["advanceAllocations"]> = [];

  if (typeof window !== "undefined") {
    // 1. Fetch available advance receipts for this customer (FIFO by date)
    const receipts = await db().receipts.where("customerId").equals(customerId).toArray();
    const creditResult = calculateCustomerCreditFromReceipts(customerId, receipts);
    const creditByReceiptId = new Map(creditResult.receiptsBreakdown.map((b) => [b.receiptId, b.remainingCreditPaise]));
    
    const candidateReceipts = receipts
      .filter((r) => (creditByReceiptId.get(r.id) || 0) > 0)
      .sort((a, b) => a.date - b.date);

    for (const r of candidateReceipts) {
      if (neededPaise <= 0) break;

      const availableInRec = creditByReceiptId.get(r.id) || 0;
      if (availableInRec <= 0) continue;

      const toAllocFromThisRec = Math.min(neededPaise, availableInRec);

      // Check if advance tax was recognized on this receipt
      const recTaxPaise = r.totalTaxPaise || 0;
      const recAdvancePaise = r.advanceAmountPaise || toPaise(r.amount);
      const taxAdjustedPaise =
        r.taxTreatment === "ADVANCE_GST" && recTaxPaise > 0 && recAdvancePaise > 0
          ? Math.round((toAllocFromThisRec * recTaxPaise) / recAdvancePaise)
          : 0;

      newAllocations.push({
        receiptId: r.id,
        receiptNumber: r.number,
        amountPaise: toAllocFromThisRec,
        advanceTaxAdjustedPaise: taxAdjustedPaise,
        supplyType: r.supplyType,
        taxTreatment: r.taxTreatment,
      });

      // Update receipt remaining available advance and allocated invoice link
      r.advanceAvailablePaise = Math.max(0, availableInRec - toAllocFromThisRec);
      r.customerCreditPaise = r.advanceAvailablePaise;
      r.unappliedCreditPaise = r.advanceAvailablePaise;
      r.allocatedInvoices = [
        ...(r.allocatedInvoices || []),
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          amountPaise: toAllocFromThisRec,
          advanceTaxAdjustedPaise: taxAdjustedPaise,
        },
      ];
      await db().receipts.put(r);

      totalAllocatedPaise += toAllocFromThisRec;
      totalTaxAdjustedPaise += taxAdjustedPaise;
      neededPaise -= toAllocFromThisRec;
    }
  } else {
    // Non-browser fallback for pure unit logic
    const insight = await getPartyFinancialInsight(customerId);
    totalAllocatedPaise = Math.min(insight.availableAdvancePaise, neededPaise);
  }

  const advanceAllocatedRupees = toRupees(totalAllocatedPaise);
  const advanceTaxAdjustedRupees = toRupees(totalTaxAdjustedPaise);

  const newAmountPaid = invoice.amountPaid + advanceAllocatedRupees;
  const newBalance = Math.max(0, invoice.grandTotal - newAmountPaid);

  const updatedInvoice: Invoice = {
    ...invoice,
    amountPaid: newAmountPaid,
    balance: newBalance,
    advanceAllocatedPaise: (invoice.advanceAllocatedPaise || 0) + totalAllocatedPaise,
    customerCreditAppliedPaise: (invoice.customerCreditAppliedPaise || 0) + totalAllocatedPaise,
    advanceAllocations: [...(invoice.advanceAllocations || []), ...newAllocations],
    advanceTaxPreviouslyAccounted: (invoice.advanceTaxPreviouslyAccounted || 0) + advanceTaxAdjustedRupees,
    advanceGstAdjustedPaise: (invoice.advanceGstAdjustedPaise || 0) + totalTaxAdjustedPaise,
    advanceGstAdjusted: (invoice.advanceGstAdjusted || 0) + advanceTaxAdjustedRupees,
    status: newBalance <= 0.01 ? "paid" : newAmountPaid > 0 ? "partial" : "unpaid",
  };

  const insightAfter = await getPartyFinancialInsight(customerId);
  const remainingAdvanceRupees = insightAfter.availableAdvanceRupees;

  return {
    updatedInvoice,
    advanceAllocatedRupees,
    remainingAdvanceRupees,
    advanceTaxAdjustedRupees,
  };
}

/**
 * Processes an auditable Customer Advance Refund / Reversal (PRD Addendum § 10).
 * If advance GST was recognized for a taxable service, reverses tax liability proportionally.
 * Never deletes the original Receipt Voucher.
 */
export async function processAdvanceRefund(params: {
  companyId: string;
  financialYearId: string;
  receiptId: string;
  refundAmount?: number;
  refundDate?: number;
  reason?: string;
  settlementLedgerId?: string;
  idToken?: string;
  uid?: string;
}): Promise<{
  success: boolean;
  refundVoucherId?: string;
  refundAmountRupees: number;
  refundTaxReversedRupees: number;
  updatedReceipt?: Receipt;
  error?: string;
}> {
  const { companyId, financialYearId, receiptId, refundAmount, refundDate, reason, settlementLedgerId, idToken, uid } = params;

  try {
    const receipt = await db().receipts.get(receiptId);
    if (!receipt) {
      return { success: false, refundAmountRupees: 0, refundTaxReversedRupees: 0, error: "Receipt not found." };
    }

    if (receipt.postingStatus === "reversed" || receipt.postingStatus === "refunded") {
      return { success: false, refundAmountRupees: 0, refundTaxReversedRupees: 0, error: "Receipt has already been refunded or reversed." };
    }

    const availablePaise = receipt.advanceAvailablePaise !== undefined
      ? receipt.advanceAvailablePaise
      : Math.max(0, toPaise(receipt.amount) - (receipt.refundAmountPaise || 0));

    if (availablePaise <= 0) {
      return { success: false, refundAmountRupees: 0, refundTaxReversedRupees: 0, error: "No unapplied advance available to refund on this voucher." };
    }

    const refundPaise = refundAmount ? Math.min(availablePaise, toPaise(refundAmount)) : availablePaise;
    const liquidityLedgerId = settlementLedgerId || receipt.settlementLedgerId || `led_${companyId}_cash`;
    const customerLedgerId = `led_${companyId}_cust_${receipt.customerId}`;
    const gstLedgerId = `led_${companyId}_output_gst`;

    // Tax correction logic (PRD Addendum § 10)
    let taxReversedPaise = 0;
    const recTaxPaise = receipt.totalTaxPaise || 0;
    const recAdvancePaise = receipt.advanceAmountPaise || toPaise(receipt.amount);

    if (receipt.taxTreatment === "ADVANCE_GST" && recTaxPaise > 0 && recAdvancePaise > 0) {
      taxReversedPaise = Math.round((refundPaise * recTaxPaise) / recAdvancePaise);
    }
    const taxableReversedPaise = Math.max(0, refundPaise - taxReversedPaise);

    // Build double-entry reversal lines:
    // Debit: Customer Advance Ledger (taxable portion)
    // Debit: Output GST Ledger (tax reversal portion)
    // Credit: Bank/Cash Ledger (refund payout)
    const lines = [
      {
        ledgerId: customerLedgerId,
        debit: taxableReversedPaise,
        credit: 0,
        partyId: receipt.partyId || receipt.customerId,
      },
      ...(taxReversedPaise > 0
        ? [
            {
              ledgerId: gstLedgerId,
              debit: taxReversedPaise,
              credit: 0,
            },
          ]
        : []),
      {
        ledgerId: liquidityLedgerId,
        debit: 0,
        credit: refundPaise,
      },
    ];

    let refundVoucherId: string | undefined = undefined;
    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "payment",
          date: toCanonicalDate(refundDate || Date.now()),
          narration: `Customer Advance Refund for Voucher ${receipt.number} [Ref: ${receipt.reference || receipt.number}] - Reason: ${reason || "Order cancelled"}`,
          clientMutationId: `mut-ref-${receipt.id}-${Date.now()}`,
          lines,
        },
      });
      if (voucherRes.success && voucherRes.voucher) {
        refundVoucherId = voucherRes.voucher.id;
      }
    }

    const nextAvailablePaise = Math.max(0, availablePaise - refundPaise);
    const updatedReceipt: Receipt = {
      ...receipt,
      advanceAvailablePaise: nextAvailablePaise,
      postingStatus: nextAvailablePaise === 0 ? "refunded" : "posted",
      refundVoucherId: refundVoucherId || receipt.refundVoucherId,
      refundDate: refundDate || Date.now(),
      refundAmountPaise: (receipt.refundAmountPaise || 0) + refundPaise,
      refundTaxReversedPaise: (receipt.refundTaxReversedPaise || 0) + taxReversedPaise,
      refundReason: reason || receipt.refundReason,
    };

    // Authoritatively persist refunded receipt to Firebase RTDB FIRST
    if (firebaseDb) {
      const recRef = ref(firebaseDb, `companyData/${companyId}/receipts/${receipt.id}`);
      await set(recRef, sanitizeForFirebase(updatedReceipt));
    }

    await db().receipts.put(updatedReceipt);
    await cacheEntity({
      uid: uid || "system",
      companyId,
      financialYearId,
      entityType: "receipt",
      entityId: receipt.id,
      data: updatedReceipt,
    });

    return {
      success: true,
      refundVoucherId,
      refundAmountRupees: toRupees(refundPaise),
      refundTaxReversedRupees: toRupees(taxReversedPaise),
      updatedReceipt,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to process advance refund:", err);
    return { success: false, refundAmountRupees: 0, refundTaxReversedRupees: 0, error: msg };
  }
}
