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

export interface AllocationValidationContext {
  companyId?: string;
  partyId?: string;
  customerId?: string;
  supplierId?: string;
  branchId?: string;
  financialYearId?: string;
}

/**
 * Robust matching helper for invoice allocations across UUIDs, formatted document numbers,
 * amended/corrected lineage IDs, and source quotations.
 * Validates companyId, partyId, and branchId to prevent accidental cross-document allocation.
 */
export function isAllocationForInvoice(
  targetIdOrNum: unknown,
  invoice: Invoice,
  context?: AllocationValidationContext
): boolean {
  if (!targetIdOrNum || typeof targetIdOrNum !== "string") return false;
  const target = targetIdOrNum.trim().toLowerCase();
  if (!target || target === "none") return false;

  // Context validation to prevent accidental cross-party, cross-branch, or cross-company allocations
  if (context) {
    // 1. Party / Customer Validation
    const contextPartyId = context.customerId || context.partyId;
    const invoicePartyId = invoice.customerId || (invoice as any).partyId;
    if (contextPartyId && invoicePartyId && contextPartyId !== invoicePartyId) {
      return false;
    }
    // 2. Company Validation
    if (context.companyId && invoice.companyId && context.companyId !== invoice.companyId) {
      return false;
    }
    // 3. Branch Validation (only when explicitly set and not "all")
    if (
      context.branchId &&
      context.branchId !== "all" &&
      invoice.branchId &&
      invoice.branchId !== "all" &&
      context.branchId !== invoice.branchId
    ) {
      return false;
    }
    // 4. Financial Year Validation (when explicitly set and not "all")
    if (
      context.financialYearId &&
      context.financialYearId !== "all" &&
      invoice.financialYearId &&
      invoice.financialYearId !== "all" &&
      context.financialYearId !== invoice.financialYearId
    ) {
      return false;
    }
  }

  // Generic conversion & lineage prefixes dynamically derived from persisted record metadata
  const sourceQuotationId = (invoice as any).sourceQuotationId || (invoice as any).convertedFromQuotationId;
  const conversionDerived = sourceQuotationId ? [`inv_from_${sourceQuotationId}`] : [];
  const amendedFromId = invoice.amendedFromId;
  const amendedDerived = amendedFromId ? [`inv_from_${amendedFromId}`] : [];
  const originalDocId = invoice.originalDocumentId;
  const origDerived = originalDocId ? [`inv_from_${originalDocId}`] : [];
  const conversionSourceId = (invoice as any).conversionSourceId;
  const convSrcDerived = conversionSourceId ? [`inv_from_${conversionSourceId}`] : [];
  const legacyDocId = (invoice as any).legacyDocumentId;
  const legacyDerived = legacyDocId ? [`inv_from_${legacyDocId}`] : [];

  const candidates = [
    invoice.id,
    invoice.number,
    invoice.amendedFromId,
    (invoice as any).amendedFromNumber,
    invoice.originalDocumentId,
    (invoice as any).originalDocumentNumber,
    (invoice as any).supersededByInvoiceId,
    (invoice as any).sourceQuotationId,
    (invoice as any).sourceQuotationNumber,
    (invoice as any).conversionSourceId,
    (invoice as any).legacyDocumentId,
    (invoice as any).convertedFromQuotationId,
    ...conversionDerived,
    ...amendedDerived,
    ...origDerived,
    ...convSrcDerived,
    ...legacyDerived,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());

  if (candidates.includes(target)) return true;

  // Comparison without dashes, slashes, or whitespace
  const normalizedTarget = target.replace(/[-_/\s]/g, "");
  for (const c of candidates) {
    if (c.replace(/[-_/\s]/g, "") === normalizedTarget) return true;
  }

  return false;
}

/**
 * Robust matching helper for purchase allocations across bill IDs and supplier invoice numbers.
 * Validates companyId, supplierId, and branchId to prevent accidental cross-document allocation.
 */
export function isAllocationForPurchase(
  targetIdOrNum: unknown,
  purchase: Purchase,
  context?: AllocationValidationContext
): boolean {
  if (!targetIdOrNum || typeof targetIdOrNum !== "string") return false;
  const target = targetIdOrNum.trim().toLowerCase();
  if (!target || target === "none") return false;

  if (context) {
    const contextSupplierId = context.supplierId || context.partyId;
    const purchaseSupplierId = purchase.supplierId || (purchase as any).partyId;
    if (contextSupplierId && purchaseSupplierId && contextSupplierId !== purchaseSupplierId) {
      return false;
    }
    if (context.companyId && purchase.companyId && context.companyId !== purchase.companyId) {
      return false;
    }
    if (
      context.branchId &&
      context.branchId !== "all" &&
      purchase.branchId &&
      purchase.branchId !== "all" &&
      context.branchId !== purchase.branchId
    ) {
      return false;
    }
  }

  const candidates = [
    purchase.id,
    purchase.number,
    purchase.supplierInvoiceNumber,
    purchase.amendedFromId,
    (purchase as any).amendedFromNumber,
    purchase.originalDocumentId,
    (purchase as any).originalDocumentNumber,
    (purchase as any).supersededByPurchaseId,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());

  if (candidates.includes(target)) return true;

  const normalizedTarget = target.replace(/[-_/\s]/g, "");
  for (const c of candidates) {
    if (c.replace(/[-_/\s]/g, "") === normalizedTarget) return true;
  }

  return false;
}

/**
 * Extract allocated paise from polymorphic allocation record formats.
 */
export function extractAllocationPaise(a: any): number {
  if (!a || typeof a !== "object") return 0;
  if (typeof a.amountPaise === "number" && !isNaN(a.amountPaise) && a.amountPaise > 0) {
    return a.amountPaise;
  }
  if (typeof a.allocatedPaise === "number" && !isNaN(a.allocatedPaise) && a.allocatedPaise > 0) {
    return a.allocatedPaise;
  }
  if (typeof a.amount === "number" && !isNaN(a.amount) && a.amount > 0) {
    return Math.round(a.amount * 100);
  }
  if (typeof a.amountRupees === "number" && !isNaN(a.amountRupees) && a.amountRupees > 0) {
    return Math.round(a.amountRupees * 100);
  }
  if (typeof a.allocatedRupees === "number" && !isNaN(a.allocatedRupees) && a.allocatedRupees > 0) {
    return Math.round(a.allocatedRupees * 100);
  }
  return 0;
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

    const rCtx: AllocationValidationContext = {
      companyId: r.companyId,
      customerId: r.customerId || (r as any).partyId,
      branchId: r.branchId,
      financialYearId: r.financialYearId,
    };

    let matchedInAllocations = false;
    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      for (const a of r.allocatedInvoices) {
        if (
          isAllocationForInvoice(a.invoiceId, invoice, rCtx) ||
          isAllocationForInvoice(a.invoiceNumber, invoice, rCtx) ||
          isAllocationForInvoice((a as any).billNumber, invoice, rCtx) ||
          isAllocationForInvoice((a as any).number, invoice, rCtx) ||
          isAllocationForInvoice((a as any).id, invoice, rCtx)
        ) {
          receiptAllocatedPaise += extractAllocationPaise(a);
          matchedInAllocations = true;
        }
      }
    }

    if (!matchedInAllocations) {
      const isTopLevelMatch =
        isAllocationForInvoice(r.invoiceId, invoice, rCtx) ||
        isAllocationForInvoice((r as any).invoiceNumber, invoice, rCtx) ||
        isAllocationForInvoice((r as any).billNumber, invoice, rCtx) ||
        isAllocationForInvoice((r as any).reference, invoice, rCtx) ||
        isAllocationForInvoice((r as any).referenceNumber, invoice, rCtx);

      if (isTopLevelMatch) {
        const receiptTotalPaise = Math.round((r.amount || 0) * 100);
        const explicitExcess = r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise;
        const excessPaise = typeof explicitExcess === "number" ? explicitExcess : 0;
        receiptAllocatedPaise += Math.max(0, receiptTotalPaise - excessPaise);
      }
    }
  }

  // 2. Sales Returns / Credit Notes allocated to this invoice (Posted only)
  let creditNoteAllocatedPaise = 0;
  for (const ret of salesReturns) {
    if (!isPostedSalesReturn(ret)) continue;
    const retCtx: AllocationValidationContext = {
      companyId: ret.companyId,
      customerId: ret.customerId || (ret as any).partyId,
      branchId: ret.branchId,
      financialYearId: ret.financialYearId,
    };
    if (
      isAllocationForInvoice(ret.originalInvoiceId, invoice, retCtx) ||
      isAllocationForInvoice(ret.originalInvoiceNumber, invoice, retCtx) ||
      isAllocationForInvoice((ret as any).invoiceId, invoice, retCtx) ||
      isAllocationForInvoice((ret as any).invoiceNumber, invoice, retCtx)
    ) {
      const reduction = ret.outstandingReducedPaise !== undefined
        ? ret.outstandingReducedPaise
        : Math.round((ret.grandTotal || 0) * 100);
      creditNoteAllocatedPaise += reduction;
    }
  }
  for (const cn of creditNotes) {
    if (!isPostedCreditNote(cn)) continue;
    const cnCtx: AllocationValidationContext = {
      companyId: cn.companyId,
      customerId: cn.customerId || (cn as any).partyId,
      branchId: cn.branchId,
      financialYearId: cn.financialYearId,
    };
    if (
      isAllocationForInvoice(cn.originalInvoiceId, invoice, cnCtx) ||
      isAllocationForInvoice(cn.originalInvoiceNumber, invoice, cnCtx) ||
      isAllocationForInvoice((cn as any).invoiceId, invoice, cnCtx) ||
      isAllocationForInvoice((cn as any).invoiceNumber, invoice, cnCtx)
    ) {
      const alreadyHandledInReturns = salesReturns.some((s) => s.creditNoteId === cn.id || s.id === cn.salesReturnId);
      if (!alreadyHandledInReturns) {
        creditNoteAllocatedPaise += Math.round((cn.grandTotal || 0) * 100);
      }
    }
  }

  // 3. Advance / Customer Credit explicitly applied to this invoice (Authoritative record required)
  let advanceAllocatedPaise = 0;
  if (typeof (invoice as any).customerCreditAppliedPaise === "number" && (invoice as any).customerCreditAppliedPaise > 0) {
    advanceAllocatedPaise += (invoice as any).customerCreditAppliedPaise;
  } else if (typeof (invoice as any).customerCreditApplied === "number" && (invoice as any).customerCreditApplied > 0) {
    advanceAllocatedPaise += Math.round((invoice as any).customerCreditApplied * 100);
  }

  if (typeof invoice.advanceAllocatedPaise === "number" && invoice.advanceAllocatedPaise > 0) {
    advanceAllocatedPaise += invoice.advanceAllocatedPaise;
  }
  if (invoice.advanceAllocations && Array.isArray(invoice.advanceAllocations)) {
    for (const aa of invoice.advanceAllocations) {
      if (typeof aa.amountPaise === "number" && aa.amountPaise > 0) {
        advanceAllocatedPaise += aa.amountPaise;
      } else if (typeof (aa as any).amount === "number" && (aa as any).amount > 0) {
        advanceAllocatedPaise += Math.round((aa as any).amount * 100);
      }
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

  // Authoritative proven allocations take strict precedence over stale stored balance snapshots
  const provenAllocationsPaise = receiptAllocatedPaise + creditNoteAllocatedPaise + advanceAllocatedPaise + writeOffPaise;
  const totalSettledPaise = Math.min(
    effectiveBilledPaise,
    provenAllocationsPaise > 0
      ? provenAllocationsPaise
      : Math.max(storedPaidPaise, storedPaidFromBalance)
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

    let matchedInAllocations = false;
    if (p.allocatedPurchases && p.allocatedPurchases.length > 0) {
      for (const a of p.allocatedPurchases) {
        if (
          isAllocationForPurchase(a.purchaseId, purchase) ||
          isAllocationForPurchase(a.purchaseNumber, purchase) ||
          isAllocationForPurchase((a as any).billNumber, purchase) ||
          isAllocationForPurchase((a as any).number, purchase) ||
          isAllocationForPurchase((a as any).id, purchase)
        ) {
          paymentAllocatedPaise += extractAllocationPaise(a);
          matchedInAllocations = true;
        }
      }
    }

    if (!matchedInAllocations) {
      const isTopLevelMatch =
        isAllocationForPurchase(p.purchaseId, purchase) ||
        isAllocationForPurchase((p as any).purchaseNumber, purchase) ||
        isAllocationForPurchase((p as any).billNumber, purchase) ||
        isAllocationForPurchase((p as any).reference, purchase) ||
        isAllocationForPurchase((p as any).referenceNumber, purchase);

      if (isTopLevelMatch) {
        paymentAllocatedPaise += Math.round((p.amount || 0) * 100);
      }
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
  creditCreated?: number;
  creditApplied?: number;
  creditAvailable?: number;
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
  customerCreditsCreated?: number;
  customerCreditsApplied?: number;
  customerCreditsAvailable?: number;
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
  let totalCreditsCreatedPaise = 0;
  let totalCreditsAppliedPaise = 0;

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
        allocatedPaise += extractAllocationPaise(a);
        if (!appliedInvoiceNumber && a.invoiceNumber) {
          appliedInvoiceNumber = a.invoiceNumber;
        }
        if (!matchedInvoiceId && a.invoiceId) {
          matchedInvoiceId = a.invoiceId;
        }
      }
    } else if (r.invoiceId && r.invoiceId !== "none") {
      const targetInv = invoices.find((i) => isAllocationForInvoice(r.invoiceId, i) || isAllocationForInvoice((r as any).invoiceNumber, i));
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
    const creditCreatedPaise = typeof explicitCredit === "number" && explicitCredit > 0
      ? explicitCredit
      : Math.max(0, receiptTotalPaise - allocatedPaise);

    // Trace explicit credit application against open invoices (no silent inference)
    let creditAppliedPaise = 0;
    for (const inv of invoices) {
      if (inv.advanceAllocations && Array.isArray(inv.advanceAllocations)) {
        for (const aa of inv.advanceAllocations) {
          if (aa.receiptId === r.id || aa.receiptNumber === r.number) {
            creditAppliedPaise += aa.amountPaise || 0;
          }
        }
      }
      const invPartyId = inv.customerId || (inv as any).partyId;
      const recPartyId = r.customerId || (r as any).partyId;
      const isPartyMatch = invPartyId && recPartyId && invPartyId === recPartyId;

      if (
        (inv as any).customerCreditReceiptId === r.id ||
        (inv as any).customerCreditReceiptNumber === r.number ||
        (! (inv as any).customerCreditReceiptId && ! (inv as any).customerCreditReceiptNumber && isPartyMatch)
      ) {
        const invApplied = (inv as any).customerCreditAppliedPaise || (typeof (inv as any).customerCreditApplied === "number" ? Math.round((inv as any).customerCreditApplied * 100) : 0);
        if (invApplied > 0) {
          const unconsumed = Math.min(creditCreatedPaise - creditAppliedPaise, invApplied);
          creditAppliedPaise += Math.max(0, unconsumed);
        }
      }
    }
    if (typeof (r as any).appliedCreditPaise === "number" && (r as any).appliedCreditPaise > 0) {
      creditAppliedPaise = Math.max(creditAppliedPaise, (r as any).appliedCreditPaise);
    }

    const availableCreditPaise = Math.max(0, creditCreatedPaise - creditAppliedPaise);

    if (creditCreatedPaise > 0) {
      totalCustomerCreditsPaise += availableCreditPaise;
      totalCreditsCreatedPaise += creditCreatedPaise;
      totalCreditsAppliedPaise += creditAppliedPaise;

      const createdRupees = creditCreatedPaise / 100;
      const appliedRupees = creditAppliedPaise / 100;
      const availableRupees = availableCreditPaise / 100;

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
        amountCreated: createdRupees,
        amountApplied: allocatedPaise / 100, // allocated from receipt against invoices
        amountAllocated: allocatedPaise / 100,
        creditCreated: createdRupees,
        creditApplied: appliedRupees,
        creditAvailable: availableRupees,
        remainingCredit: availableRupees,
        originalAmount: r.amount,
        remainingAmount: availableRupees,
        appliedInvoiceNumber,
        date: r.date,
        createdAt: r.date,
        status: availableCreditPaise <= 0 ? "applied" : creditAppliedPaise > 0 ? "partial" : "available",
      });
    }
  }

  // 2. Process Credit Notes / Sales Returns that generated customer credits
  for (const ret of salesReturns) {
    if (!isPostedSalesReturn(ret)) continue;
    if (branchId && branchId !== "all" && ret.branchId && ret.branchId !== branchId) continue;

    const targetInv = invoices.find(
      (i) =>
        isAllocationForInvoice(ret.originalInvoiceId, i) ||
        isAllocationForInvoice((ret as any).invoiceId, i) ||
        isAllocationForInvoice(ret.originalInvoiceNumber, i) ||
        isAllocationForInvoice((ret as any).invoiceNumber, i)
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
      totalCreditsCreatedPaise += creditGenerated;
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
      totalCreditsCreatedPaise += creditGenerated;
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
    customerCreditsCreated: totalCreditsCreatedPaise / 100,
    customerCreditsApplied: totalCreditsAppliedPaise / 100,
    customerCreditsAvailable: totalCustomerCreditsPaise / 100,
    creditItems,
  };
}
