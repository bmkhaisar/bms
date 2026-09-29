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
  totalSettled: number;
  remainingBalance: number;
  isPaid: boolean;
  allocations: {
    receiptAllocations: number;
    creditNoteAllocations: number;
    advanceAllocations: number;
  };
}

/**
 * Authoritatively calculates the outstanding balance for an Invoice.
 * Resolves bill-wise across posted receipts, credit notes, and customer advances.
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
      totalSettled: 0,
      remainingBalance: 0, // Drafts have ZERO accounting receivable
      isPaid: false,
      allocations: {
        receiptAllocations: 0,
        creditNoteAllocations: 0,
        advanceAllocations: 0,
      },
    };
  }

  const grandTotalPaise = Math.round((invoice.grandTotal || 0) * 100);

  // 1. Receipts allocated specifically to this invoice
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

  // 2. Sales Returns / Credit Notes allocated to this invoice
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

  // 4. Stored invoice.amountPaid / invoice.balance fallback
  const storedPaidPaise = Math.round((invoice.amountPaid || 0) * 100);
  const storedBalancePaise = invoice.balance !== undefined ? Math.round(invoice.balance * 100) : undefined;
  const storedPaidFromBalance = storedBalancePaise !== undefined ? Math.max(0, grandTotalPaise - storedBalancePaise) : 0;

  // Maximum proven paid amount
  const totalSettledPaise = Math.min(
    grandTotalPaise,
    Math.max(
      receiptAllocatedPaise + creditNoteAllocatedPaise + advanceAllocatedPaise,
      storedPaidPaise,
      storedPaidFromBalance
    )
  );

  const remainingBalancePaise = Math.max(0, grandTotalPaise - totalSettledPaise);
  const remainingBalance = remainingBalancePaise / 100;
  const isPaid = remainingBalance <= 0.01;

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    grandTotal: invoice.grandTotal || 0,
    totalSettled: totalSettledPaise / 100,
    remainingBalance: isPaid ? 0 : remainingBalance,
    isPaid,
    allocations: {
      receiptAllocations: receiptAllocatedPaise / 100,
      creditNoteAllocations: creditNoteAllocatedPaise / 100,
      advanceAllocations: advanceAllocatedPaise / 100,
    },
  };
}

export interface PurchaseSettlementDetail {
  purchaseId: string;
  purchaseNumber: string;
  grandTotal: number;
  totalSettled: number;
  remainingBalance: number;
  isPaid: boolean;
}

/**
 * Authoritatively calculates the outstanding balance for a Purchase.
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
      totalSettled: 0,
      remainingBalance: 0, // Draft purchases have ZERO AP
      isPaid: false,
    };
  }

  const grandTotalPaise = Math.round((purchase.grandTotal || 0) * 100);

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

  const storedPaidPaise = Math.round((purchase.amountPaid || 0) * 100);
  const storedBalancePaise = purchase.balance !== undefined ? Math.round(purchase.balance * 100) : undefined;
  const storedPaidFromBalance = storedBalancePaise !== undefined ? Math.max(0, grandTotalPaise - storedBalancePaise) : 0;

  const totalSettledPaise = Math.min(
    grandTotalPaise,
    Math.max(paymentAllocatedPaise, storedPaidPaise, storedPaidFromBalance)
  );

  const remainingBalancePaise = Math.max(0, grandTotalPaise - totalSettledPaise);
  const remainingBalance = remainingBalancePaise / 100;
  const isPaid = remainingBalance <= 0.01;

  return {
    purchaseId: purchase.id,
    purchaseNumber: purchase.number,
    grandTotal: purchase.grandTotal || 0,
    totalSettled: totalSettledPaise / 100,
    remainingBalance: isPaid ? 0 : remainingBalance,
    isPaid,
  };
}

export interface CustomerCreditItem {
  originatingType: "RECEIPT" | "CREDIT_NOTE";
  originatingId: string;
  originatingNumber: string;
  customerId: string;
  originalAmount: number;
  amountAllocated: number;
  remainingCredit: number;
  appliedInvoiceNumber?: string;
  date: number;
  branchId?: string;
  status: "available" | "applied" | "partial";
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

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      for (const a of r.allocatedInvoices) {
        allocatedPaise += a.amountPaise !== undefined ? a.amountPaise : Math.round(((a as any).amount || 0) * 100);
        if (!appliedInvoiceNumber && a.invoiceNumber) {
          appliedInvoiceNumber = a.invoiceNumber;
        }
      }
    } else if (r.invoiceId && r.invoiceId !== "none") {
      const targetInv = invoices.find((i) => i.id === r.invoiceId || i.number === (r as any).invoiceNumber);
      if (targetInv) {
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
      creditItems.push({
        originatingType: "RECEIPT",
        originatingId: r.id,
        originatingNumber: r.number,
        customerId: r.customerId,
        originalAmount: r.amount,
        amountAllocated: allocatedPaise / 100,
        remainingCredit: remainingPaise / 100,
        appliedInvoiceNumber,
        date: r.date,
        branchId: r.branchId,
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
      creditItems.push({
        originatingType: "CREDIT_NOTE",
        originatingId: ret.creditNoteId || ret.id,
        originatingNumber: ret.creditNoteNumber || ret.number,
        customerId: ret.customerId,
        originalAmount: ret.grandTotal,
        amountAllocated: amountAllocatedPaise / 100,
        remainingCredit: creditGenerated / 100,
        appliedInvoiceNumber: ret.originalInvoiceNumber || targetInv?.number,
        date: ret.date,
        branchId: ret.branchId,
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
      creditItems.push({
        originatingType: "CREDIT_NOTE",
        originatingId: cn.id,
        originatingNumber: (cn as any).creditNoteNumber || cn.number,
        customerId: cn.customerId,
        originalAmount: cn.grandTotal,
        amountAllocated: amountAllocatedPaise / 100,
        remainingCredit: creditGenerated / 100,
        appliedInvoiceNumber: cn.originalInvoiceNumber || targetInv?.number,
        date: cn.date,
        branchId: cn.branchId,
        status: "available",
      });
    }
  }

  return {
    totalCustomerCredits: totalCustomerCreditsPaise / 100,
    creditItems,
  };
}
