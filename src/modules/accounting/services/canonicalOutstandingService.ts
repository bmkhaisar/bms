import type { Invoice, Purchase, Receipt, Payment, SalesReturn, CreditNote } from "@/lib/db";

/**
 * Validates that an invoice is authoritative and posted.
 * Strictly excludes draft, cancelled, voided, deleted, and reversed documents.
 * Draft documents have ZERO accounting authority.
 */
export function isPostedInvoice(inv: Invoice | null | undefined): boolean {
  if (!inv) return false;
  const status = (inv.status || "").toLowerCase();
  const posting = (inv.postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "voided" || status === "deleted") return false;
  if (posting === "reversed" || posting === "failed") return false;
  return true;
}

/**
 * Validates that a purchase bill is authoritative and posted.
 * Strictly excludes draft, cancelled, voided, deleted, and reversed documents.
 */
export function isPostedPurchase(pu: Purchase | null | undefined): boolean {
  if (!pu) return false;
  const status = (pu.status || "").toLowerCase();
  const posting = (pu.postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "voided" || status === "deleted") return false;
  if (posting === "reversed" || posting === "failed") return false;
  return true;
}

/**
 * Validates that a customer receipt is authoritative and posted.
 * Strictly excludes draft, cancelled, refunded, failed, and reversed receipts.
 */
export function isPostedReceipt(rec: Receipt | null | undefined): boolean {
  if (!rec) return false;
  const status = ((rec as any).status || "").toLowerCase();
  const posting = ((rec as any).postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "voided") return false;
  if (posting === "reversed" || posting === "failed" || posting === "refunded") return false;
  return true;
}

/**
 * Validates that a supplier payment voucher is authoritative and posted.
 * Strictly excludes draft, cancelled, failed, and reversed vouchers.
 */
export function isPostedPayment(pay: Payment | null | undefined): boolean {
  if (!pay) return false;
  const status = ((pay as any).status || "").toLowerCase();
  const posting = ((pay as any).postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "voided") return false;
  if (posting === "reversed" || posting === "failed") return false;
  return true;
}

/**
 * Validates that a sales return is authoritative and posted.
 * Strictly excludes draft, cancelled, reversed, or failed returns.
 */
export function isPostedSalesReturn(ret: SalesReturn | null | undefined): boolean {
  if (!ret) return false;
  const status = ((ret as any).status || "").toLowerCase();
  const posting = ((ret as any).postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "reversed" || status === "voided" || status === "deleted") return false;
  if (posting === "reversed" || posting === "failed") return false;
  return true;
}

/**
 * Validates that a credit note is authoritative and posted.
 */
export function isPostedCreditNote(cn: CreditNote | null | undefined): boolean {
  if (!cn) return false;
  const status = ((cn as any).status || "").toLowerCase();
  const posting = ((cn as any).postingStatus || "").toLowerCase();
  if (status === "draft" || posting === "draft") return false;
  if (status === "cancelled" || status === "reversed") return false;
  if (posting === "reversed" || posting === "failed") return false;
  return true;
}

export interface InvoiceSettlementDetail {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  openingAr: number;
  debitAdjustments: number;
  effectiveBilledTotal: number;
  totalSettled: number;
  remainingBalance: number;
  isPaid: boolean;
  allocations: {
    receiptAllocations: number;
    creditNoteAllocations: number;
    advanceAllocations: number;
    writeOffs: number;
  };
}

/**
 * Authoritatively calculates the outstanding balance for an Invoice.
 * Resolves bill-wise across:
 * Opening AR + Posted Invoices + Debit Adjustments - Posted Receipts - Posted Credit Notes
 * - Advance / Customer Credit Allocations - Write-offs / Refund Adjustments ± Reversals = Closing AR.
 * Draft documents contribute 0.00 to AR.
 */
export function resolveCanonicalInvoiceOutstanding(
  invoice: Invoice,
  receipts: Receipt[] = [],
  salesReturns: SalesReturn[] = [],
  creditNotes: CreditNote[] = []
): InvoiceSettlementDetail {
  if (!isPostedInvoice(invoice)) {
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      grandTotal: invoice.grandTotal || 0,
      openingAr: 0,
      debitAdjustments: 0,
      effectiveBilledTotal: 0,
      totalSettled: 0,
      remainingBalance: 0, // Drafts have ZERO accounting receivable
      isPaid: false,
      allocations: {
        receiptAllocations: 0,
        creditNoteAllocations: 0,
        advanceAllocations: 0,
        writeOffs: 0,
      },
    };
  }

  const grandTotalPaise = Math.round((invoice.grandTotal || 0) * 100);
  const openingArPaise = (invoice as any).openingArPaise !== undefined
    ? (invoice as any).openingArPaise
    : (invoice as any).isOpeningBalance
    ? Math.round(((invoice as any).openingAr || (invoice as any).openingBalance || 0) * 100)
    : 0;
  const debitAdjustmentsPaise = (invoice as any).debitAdjustmentsPaise !== undefined
    ? (invoice as any).debitAdjustmentsPaise
    : Math.round(((invoice as any).debitAdjustments || (invoice as any).debitAdjustment || 0) * 100);

  const effectiveBilledPaise = openingArPaise + grandTotalPaise + debitAdjustmentsPaise;

  // 1. Receipts allocated specifically to this invoice (Posted only, reversed excluded)
  let receiptAllocatedPaise = 0;
  for (const r of receipts) {
    if (!isPostedReceipt(r)) continue;

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      for (const a of r.allocatedInvoices) {
        if (a.invoiceId === invoice.id || (a.invoiceNumber && a.invoiceNumber === invoice.number)) {
          receiptAllocatedPaise += a.amountPaise !== undefined ? a.amountPaise : Math.round(((a as any).amount || 0) * 100);
        }
      }
    } else if (r.invoiceId === invoice.id || (r as any).invoiceNumber === invoice.number) {
      // Explicit single-invoice link
      const receiptTotalPaise = Math.round((r.amount || 0) * 100);
      const explicitExcess = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
      const excessPaise = typeof explicitExcess === "number" ? explicitExcess : 0;
      receiptAllocatedPaise += Math.max(0, receiptTotalPaise - excessPaise);
    }
  }

  // 2. Sales Returns / Credit Notes allocated to this invoice (Posted only)
  let creditNoteAllocatedPaise = 0;
  for (const ret of salesReturns) {
    if (!isPostedSalesReturn(ret)) continue;
    if (
      ret.originalInvoiceId === invoice.id ||
      ret.originalInvoiceNumber === invoice.number ||
      (ret as any).invoiceId === invoice.id ||
      (ret as any).invoiceNumber === invoice.number
    ) {
      const reduction = ret.outstandingReducedPaise !== undefined
        ? ret.outstandingReducedPaise
        : Math.round((ret.grandTotal || 0) * 100);
      creditNoteAllocatedPaise += reduction;
    }
  }
  for (const cn of creditNotes) {
    if (!isPostedCreditNote(cn)) continue;
    if (
      cn.originalInvoiceId === invoice.id ||
      cn.originalInvoiceNumber === invoice.number ||
      (cn as any).invoiceId === invoice.id ||
      (cn as any).invoiceNumber === invoice.number
    ) {
      const alreadyHandledInReturns = salesReturns.some((s) => s.creditNoteId === cn.id || s.id === cn.salesReturnId);
      if (!alreadyHandledInReturns) {
        creditNoteAllocatedPaise += Math.round((cn.grandTotal || 0) * 100);
      }
    }
  }

  // 3. Advance/credit allocations applied directly to the invoice record
  let advanceAllocatedPaise = (invoice.advanceAllocatedPaise || 0) + (invoice.customerCreditAppliedPaise || 0);
  if (invoice.advanceAllocations && Array.isArray(invoice.advanceAllocations)) {
    for (const aa of invoice.advanceAllocations) {
      if (aa.amountPaise) advanceAllocatedPaise += aa.amountPaise;
    }
  }

  // 4. Bad debt / dispute write-offs and approved refund adjustments
  const writeOffPaise = (invoice as any).writeOffPaise !== undefined
    ? (invoice as any).writeOffPaise
    : Math.round(((invoice as any).writeOffAmount || (invoice as any).writeOff || (invoice as any).discountAdjustment || 0) * 100);

  // 5. Stored invoice.amountPaid / invoice.balance fallback
  const storedPaidPaise = Math.round((invoice.amountPaid || 0) * 100);
  const storedBalancePaise = invoice.balance !== undefined ? Math.round(invoice.balance * 100) : undefined;
  const storedPaidFromBalance = storedBalancePaise !== undefined ? Math.max(0, effectiveBilledPaise - storedBalancePaise) : 0;

  // Maximum proven paid amount
  const totalSettledPaise = Math.min(
    effectiveBilledPaise,
    Math.max(
      receiptAllocatedPaise + creditNoteAllocatedPaise + advanceAllocatedPaise + writeOffPaise,
      storedPaidPaise,
      storedPaidFromBalance
    )
  );

  const remainingBalancePaise = Math.max(0, effectiveBilledPaise - totalSettledPaise);
  const remainingBalance = remainingBalancePaise / 100;
  const isPaid = remainingBalance <= 0.01;

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    grandTotal: invoice.grandTotal || 0,
    openingAr: openingArPaise / 100,
    debitAdjustments: debitAdjustmentsPaise / 100,
    effectiveBilledTotal: effectiveBilledPaise / 100,
    totalSettled: totalSettledPaise / 100,
    remainingBalance: isPaid ? 0 : remainingBalance,
    isPaid,
    allocations: {
      receiptAllocations: receiptAllocatedPaise / 100,
      creditNoteAllocations: creditNoteAllocatedPaise / 100,
      advanceAllocations: advanceAllocatedPaise / 100,
      writeOffs: writeOffPaise / 100,
    },
  };
}

export interface PurchaseSettlementDetail {
  purchaseId: string;
  purchaseNumber: string;
  grandTotal: number;
  openingAp: number;
  creditAdjustments: number;
  effectiveBilledTotal: number;
  totalSettled: number;
  remainingBalance: number;
  isPaid: boolean;
  allocations: {
    paymentAllocations: number;
    debitNoteAllocations: number;
    advanceAllocations: number;
    discounts: number;
  };
}

/**
 * Authoritatively calculates the outstanding balance for a Purchase.
 * Resolves bill-wise across:
 * Opening AP + Posted Purchases + Credit Adjustments - Posted Supplier Payments - Debit Notes
 * - Supplier Advances Applied - Discounts / Refunds ± Reversals = Closing AP.
 * Draft documents contribute 0.00 to AP.
 */
export function resolveCanonicalPurchaseOutstanding(
  purchase: Purchase,
  payments: Payment[] = []
): PurchaseSettlementDetail {
  if (!isPostedPurchase(purchase)) {
    return {
      purchaseId: purchase.id,
      purchaseNumber: purchase.number,
      grandTotal: purchase.grandTotal || 0,
      openingAp: 0,
      creditAdjustments: 0,
      effectiveBilledTotal: 0,
      totalSettled: 0,
      remainingBalance: 0, // Draft purchases have ZERO AP
      isPaid: false,
      allocations: {
        paymentAllocations: 0,
        debitNoteAllocations: 0,
        advanceAllocations: 0,
        discounts: 0,
      },
    };
  }

  const grandTotalPaise = Math.round((purchase.grandTotal || 0) * 100);
  const openingApPaise = (purchase as any).openingApPaise !== undefined
    ? (purchase as any).openingApPaise
    : (purchase as any).isOpeningBalance
    ? Math.round(((purchase as any).openingAp || (purchase as any).openingBalance || 0) * 100)
    : 0;
  const creditAdjustmentsPaise = (purchase as any).creditAdjustmentsPaise !== undefined
    ? (purchase as any).creditAdjustmentsPaise
    : Math.round(((purchase as any).creditAdjustments || (purchase as any).creditAdjustment || 0) * 100);

  const effectiveBilledPaise = openingApPaise + grandTotalPaise + creditAdjustmentsPaise;

  // 1. Supplier payments allocated to this purchase bill
  let paymentAllocatedPaise = 0;
  for (const p of payments) {
    if (!isPostedPayment(p)) continue;

    if (p.allocatedPurchases && p.allocatedPurchases.length > 0) {
      for (const a of p.allocatedPurchases) {
        if (a.purchaseId === purchase.id || a.purchaseNumber === purchase.number || ((a as any).billNumber && (a as any).billNumber === purchase.number)) {
          paymentAllocatedPaise += a.amountPaise !== undefined ? a.amountPaise : Math.round(((a as any).amount || 0) * 100);
        }
      }
    } else if (p.purchaseId === purchase.id || (p as any).purchaseNumber === purchase.number) {
      paymentAllocatedPaise += Math.round((p.amount || 0) * 100);
    }
  }

  // 2. Debit Notes / Purchase Returns allocated
  const debitNoteAllocatedPaise = (purchase as any).debitNoteAllocatedPaise !== undefined
    ? (purchase as any).debitNoteAllocatedPaise
    : Math.round(((purchase as any).debitNotesTotal || (purchase as any).debitNoteAmount || 0) * 100);

  // 3. Supplier Advances Applied
  const supplierAdvancePaise = (purchase as any).supplierAdvancesAppliedPaise !== undefined
    ? (purchase as any).supplierAdvancesAppliedPaise
    : (purchase as any).advanceAllocatedPaise || 0;

  // 4. Settlement discounts / rebates
  const discountPaise = (purchase as any).discountPaise !== undefined
    ? (purchase as any).discountPaise
    : Math.round(((purchase as any).settlementDiscount || (purchase as any).discountAdjustment || (purchase as any).discountTotal || 0) * 100);

  // 5. Stored fallbacks
  const storedPaidPaise = Math.round((purchase.amountPaid || 0) * 100);
  const storedBalancePaise = purchase.balance !== undefined ? Math.round(purchase.balance * 100) : undefined;
  const storedPaidFromBalance = storedBalancePaise !== undefined ? Math.max(0, effectiveBilledPaise - storedBalancePaise) : 0;

  const totalSettledPaise = Math.min(
    effectiveBilledPaise,
    Math.max(
      paymentAllocatedPaise + debitNoteAllocatedPaise + supplierAdvancePaise + discountPaise,
      storedPaidPaise,
      storedPaidFromBalance
    )
  );

  const remainingBalancePaise = Math.max(0, effectiveBilledPaise - totalSettledPaise);
  const remainingBalance = remainingBalancePaise / 100;
  const isPaid = remainingBalance <= 0.01;

  return {
    purchaseId: purchase.id,
    purchaseNumber: purchase.number,
    grandTotal: purchase.grandTotal || 0,
    openingAp: openingApPaise / 100,
    creditAdjustments: creditAdjustmentsPaise / 100,
    effectiveBilledTotal: effectiveBilledPaise / 100,
    totalSettled: totalSettledPaise / 100,
    remainingBalance: isPaid ? 0 : remainingBalance,
    isPaid,
    allocations: {
      paymentAllocations: paymentAllocatedPaise / 100,
      debitNoteAllocations: debitNoteAllocatedPaise / 100,
      advanceAllocations: supplierAdvancePaise / 100,
      discounts: discountPaise / 100,
    },
  };
}

export interface CustomerCreditItem {
  id?: string;
  originatingType: "RECEIPT" | "CREDIT_NOTE";
  originatingId: string;
  originatingNumber: string;
  receiptId?: string;
  receiptNumber?: string;
  customerId: string;
  invoiceId?: string;
  invoiceNumber?: string;
  branchId?: string;
  amountCreated: number;
  originalAmount: number;
  amountAllocated: number;
  amountApplied: number;
  remainingAmount: number;
  remainingCredit: number;
  appliedInvoiceNumber?: string;
  date: number;
  createdAt?: number;
  status: "available" | "applied" | "partial" | "reversed" | "cancelled";
  reversalVoucherId?: string;
}

export function calculateAuthoritativeCustomerCredits(
  paramsOrInvoices:
    | {
        receipts: Receipt[];
        salesReturns?: SalesReturn[];
        creditNotes?: CreditNote[];
        invoices: Invoice[];
        branchId?: string | null;
      }
    | Invoice[],
  receiptsArg?: Receipt[],
  salesReturnsArg?: SalesReturn[],
  creditNotesArg?: CreditNote[]
): {
  totalCustomerCredits: number;
  creditItems: CustomerCreditItem[];
} {
  let receipts: Receipt[] = [];
  let salesReturns: SalesReturn[] = [];
  let creditNotes: CreditNote[] = [];
  let invoices: Invoice[] = [];
  let branchId: string | null | undefined = undefined;

  if (Array.isArray(paramsOrInvoices)) {
    invoices = paramsOrInvoices;
    receipts = receiptsArg || [];
    salesReturns = salesReturnsArg || [];
    creditNotes = creditNotesArg || [];
  } else if (paramsOrInvoices && typeof paramsOrInvoices === "object") {
    receipts = paramsOrInvoices.receipts || [];
    salesReturns = paramsOrInvoices.salesReturns || [];
    creditNotes = paramsOrInvoices.creditNotes || [];
    invoices = paramsOrInvoices.invoices || [];
    branchId = paramsOrInvoices.branchId;
  }

  const creditItems: CustomerCreditItem[] = [];
  let totalCustomerCreditsPaise = 0;

  // 1. Process valid posted receipts for unapplied excess / advances
  for (const r of receipts) {
    if (!isPostedReceipt(r)) continue;
    if (branchId && branchId !== "all" && r.branchId && r.branchId !== branchId) continue;

    const receiptTotalPaise = Math.round((r.amount || 0) * 100);
    let allocatedPaise = 0;
    let appliedInvoiceNumber: string | undefined;
    let matchedInvoiceId: string | undefined;

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      for (const a of r.allocatedInvoices) {
        allocatedPaise += a.amountPaise !== undefined ? a.amountPaise : Math.round(((a as any).amount || 0) * 100);
        if (!appliedInvoiceNumber && a.invoiceNumber) {
          appliedInvoiceNumber = a.invoiceNumber;
        }
        if (!matchedInvoiceId && a.invoiceId) {
          matchedInvoiceId = a.invoiceId;
        }
      }
    } else if (r.invoiceId && r.invoiceId !== "none") {
      const targetInv = invoices.find((i) => i.id === r.invoiceId || i.number === (r as any).invoiceNumber);
      if (targetInv) {
        matchedInvoiceId = targetInv.id;
        appliedInvoiceNumber = targetInv.number;
        const targetGrandPaise = Math.round(targetInv.grandTotal * 100);
        allocatedPaise = Math.min(receiptTotalPaise, targetGrandPaise);
      } else {
        allocatedPaise = receiptTotalPaise;
      }
    }

    const explicitCredit = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
    const remainingPaise = typeof explicitCredit === "number" && explicitCredit > 0
      ? explicitCredit
      : Math.max(0, receiptTotalPaise - allocatedPaise);

    if (remainingPaise > 0) {
      totalCustomerCreditsPaise += remainingPaise;
      const remainingRupees = remainingPaise / 100;
      const allocatedRupees = allocatedPaise / 100;
      creditItems.push({
        id: `cc_${r.id}`,
        originatingType: "RECEIPT",
        originatingId: r.id,
        originatingNumber: r.number,
        receiptId: r.id,
        receiptNumber: r.number,
        customerId: r.customerId,
        invoiceId: matchedInvoiceId || (r.invoiceId !== "none" ? r.invoiceId : undefined),
        invoiceNumber: appliedInvoiceNumber || (r as any).invoiceNumber,
        branchId: r.branchId,
        amountCreated: remainingRupees,
        originalAmount: r.amount,
        amountAllocated: allocatedRupees,
        amountApplied: allocatedRupees,
        remainingAmount: remainingRupees,
        remainingCredit: remainingRupees,
        appliedInvoiceNumber,
        date: r.date,
        createdAt: r.date,
        status: remainingPaise === receiptTotalPaise ? "available" : "partial",
      });
    }
  }

  // 2. Process Credit Notes / Sales Returns that generated customer credits
  for (const ret of salesReturns) {
    if (!isPostedSalesReturn(ret)) continue;
    if (branchId && branchId !== "all" && ret.branchId && ret.branchId !== branchId) continue;

    const targetInv = invoices.find(
      (i) =>
        i.id === ret.originalInvoiceId ||
        i.id === (ret as any).invoiceId ||
        i.number === ret.originalInvoiceNumber ||
        i.number === (ret as any).invoiceNumber
    );

    let creditGenerated = ret.customerCreditGeneratedPaise || (ret.customerCreditCreated ? Math.round(ret.customerCreditCreated * 100) : 0);
    let amountAllocatedPaise = ret.outstandingReducedPaise || 0;

    if (!creditGenerated && targetInv) {
      const invGrandPaise = Math.round(targetInv.grandTotal * 100);
      const retGrandPaise = Math.round((ret.grandTotal || 0) * 100);
      if (retGrandPaise > invGrandPaise) {
        creditGenerated = retGrandPaise - invGrandPaise;
        amountAllocatedPaise = invGrandPaise;
      }
    }

    if (creditGenerated > 0) {
      totalCustomerCreditsPaise += creditGenerated;
      const creditRupees = creditGenerated / 100;
      const allocatedRupees = amountAllocatedPaise / 100;
      creditItems.push({
        id: `cc_${ret.id}`,
        originatingType: "CREDIT_NOTE",
        originatingId: ret.creditNoteId || ret.id,
        originatingNumber: ret.creditNoteNumber || ret.number,
        customerId: ret.customerId,
        invoiceId: targetInv?.id || ret.originalInvoiceId,
        invoiceNumber: ret.originalInvoiceNumber || targetInv?.number,
        branchId: ret.branchId,
        amountCreated: creditRupees,
        originalAmount: ret.grandTotal,
        amountAllocated: allocatedRupees,
        amountApplied: allocatedRupees,
        remainingAmount: creditRupees,
        remainingCredit: creditRupees,
        appliedInvoiceNumber: ret.originalInvoiceNumber || targetInv?.number,
        date: ret.date,
        createdAt: ret.date,
        status: "available",
      });
    }
  }

  // 3. Process standalone Credit Notes
  for (const cn of creditNotes) {
    if (!isPostedCreditNote(cn)) continue;
    if (branchId && branchId !== "all" && cn.branchId && cn.branchId !== branchId) continue;

    const alreadyInReturns = salesReturns.some((s) => s.creditNoteId === cn.id || s.id === cn.salesReturnId);
    if (alreadyInReturns) continue;

    const targetInv = invoices.find(
      (i) =>
        i.id === cn.originalInvoiceId ||
        i.id === (cn as any).invoiceId ||
        i.number === cn.originalInvoiceNumber ||
        i.number === (cn as any).invoiceNumber
    );

    let creditGenerated = (cn as any).customerCreditGeneratedPaise || ((cn as any).customerCreditCreated ? Math.round((cn as any).customerCreditCreated * 100) : 0);
    let amountAllocatedPaise = (cn as any).outstandingReducedPaise || 0;

    if (!creditGenerated && targetInv) {
      const invGrandPaise = Math.round(targetInv.grandTotal * 100);
      const cnGrandPaise = Math.round((cn.grandTotal || 0) * 100);
      if (cnGrandPaise > invGrandPaise) {
        creditGenerated = cnGrandPaise - invGrandPaise;
        amountAllocatedPaise = invGrandPaise;
      }
    }

    if (creditGenerated > 0) {
      totalCustomerCreditsPaise += creditGenerated;
      const creditRupees = creditGenerated / 100;
      const allocatedRupees = amountAllocatedPaise / 100;
      creditItems.push({
        id: `cc_${cn.id}`,
        originatingType: "CREDIT_NOTE",
        originatingId: cn.id,
        originatingNumber: (cn as any).creditNoteNumber || cn.number,
        customerId: cn.customerId,
        invoiceId: targetInv?.id || cn.originalInvoiceId,
        invoiceNumber: cn.originalInvoiceNumber || targetInv?.number,
        branchId: cn.branchId,
        amountCreated: creditRupees,
        originalAmount: cn.grandTotal,
        amountAllocated: allocatedRupees,
        amountApplied: allocatedRupees,
        remainingAmount: creditRupees,
        remainingCredit: creditRupees,
        appliedInvoiceNumber: cn.originalInvoiceNumber || targetInv?.number,
        date: cn.date,
        createdAt: cn.date,
        status: "available",
      });
    }
  }

  return {
    totalCustomerCredits: totalCustomerCreditsPaise / 100,
    creditItems,
  };
}
