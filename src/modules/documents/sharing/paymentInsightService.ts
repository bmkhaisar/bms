import type { Invoice, Party, CompanySettings, Receipt } from "../../../lib/db.ts";
import type { PaymentDueInsight } from "./bmsShareTypes";

export const DEFAULT_CREDIT_DAYS = 30;

/**
 * Resolves credit days based on canonical priority for NEW invoices:
 * 1. Party-specific Credit Days
 * 2. Company Default Credit Days
 * 3. 30 days fallback
 */
export function resolveCreditDays(
  party?: Partial<Party> | null,
  company?: { defaultCreditDays?: number; creditDays?: number; [key: string]: any } | null
): number {
  if (party?.creditDays && typeof party.creditDays === "number" && party.creditDays > 0) {
    return party.creditDays;
  }
  const compCredit = (company as any)?.defaultCreditDays ?? (company as any)?.creditDays;
  if (compCredit && typeof compCredit === "number" && compCredit > 0) {
    return compCredit;
  }
  return DEFAULT_CREDIT_DAYS;
}

/**
 * Computes canonical invoice due date from base date and terms.
 * Used when establishing an invoice. Once saved, dueDate is frozen.
 */
export function computeInvoiceDueDate(
  invoice: { date: number; dueDate?: number },
  creditDays: number
): number {
  if (invoice.dueDate && typeof invoice.dueDate === "number" && invoice.dueDate > 0) {
    return invoice.dueDate;
  }
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return invoice.date + creditDays * ONE_DAY_MS;
}

/**
 * Extracts receipts allocated to a specific invoice.
 */
export function findAllocatedReceiptsForInvoice(
  invoiceId: string,
  receipts: Receipt[] = []
): { matchingReceipts: Receipt[]; totalAllocatedPaise: number } {
  const matching: Receipt[] = [];
  let totalAllocatedPaise = 0;

  for (const r of receipts) {
    const status = ((r as any).status || "").toLowerCase();
    const posting = (r.postingStatus || "").toLowerCase();
    if (status === "cancelled" || status === "voided" || posting === "reversed") {
      continue;
    }

    if (r.allocatedInvoices && r.allocatedInvoices.length > 0) {
      const match = r.allocatedInvoices.find((a) => a.invoiceId === invoiceId);
      if (match) {
        matching.push(r);
        totalAllocatedPaise += match.amountPaise || 0;
        continue;
      }
    } else if (r.invoiceId === invoiceId) {
      matching.push(r);
      totalAllocatedPaise += Math.round((r.amount || 0) * 100);
      continue;
    }
  }

  return { matchingReceipts: matching, totalAllocatedPaise };
}

/**
 * Computes authoritative Payment Due Insight for an Invoice per PRD §§ 21-23.
 * Preserves the frozen dueDate on existing/posted invoices and honors canonical credit terms.
 * Partial payments never restart or extend the credit period.
 */
export function computeInvoicePaymentInsight(params: {
  invoice: Invoice;
  party?: Partial<Party> | null;
  company?: { defaultCreditDays?: number; creditDays?: number; [key: string]: any } | null;
  receipts?: Receipt[];
  asOfDate?: number; // Defaults to Date.now()
}): PaymentDueInsight {
  const { invoice, party, company, receipts = [] } = params;
  const asOf = params.asOfDate ?? Date.now();

  // Correction 1: For existing/posted invoice, ALWAYS use frozen dueDate!
  let dueDate: number;
  let creditDays: number;

  if (invoice.dueDate && typeof invoice.dueDate === "number" && invoice.dueDate > 0) {
    dueDate = invoice.dueDate;
    creditDays =
      invoice.creditDaysSnapshot ??
      (invoice.date > 0
        ? Math.max(0, Math.round((invoice.dueDate - invoice.date) / (24 * 60 * 60 * 1000)))
        : resolveCreditDays(party, company));
  } else {
    creditDays = invoice.creditDaysSnapshot ?? resolveCreditDays(party, company);
    dueDate = computeInvoiceDueDate(invoice, creditDays);
  }

  const { matchingReceipts, totalAllocatedPaise } = findAllocatedReceiptsForInvoice(
    invoice.id,
    receipts
  );

  // Authoritative financial totals
  const invoiceTotal = invoice.grandTotal ?? 0;
  const balance =
    invoice.balance !== undefined
      ? invoice.balance
      : Math.max(0, invoiceTotal - totalAllocatedPaise / 100);
  const totalReceived = Math.max(0, invoiceTotal - balance);

  const isPaid = balance <= 0 || (invoice.status || "").toLowerCase() === "paid";

  // Sort receipts by date descending to find latest receipt
  const sortedReceipts = [...matchingReceipts].sort(
    (a, b) => Number(b.date || b.createdAt) - Number(a.date || a.createdAt)
  );
  const latestReceipt = sortedReceipts[0];

  const latestReceiptNumber = latestReceipt?.number;
  const latestReceiptDate = latestReceipt?.date;
  const paidOnDate = isPaid && latestReceipt ? latestReceipt.date : undefined;

  // Day differences (start of day comparisons)
  const asOfDateObj = new Date(asOf);
  asOfDateObj.setHours(0, 0, 0, 0);

  const dueDateObj = new Date(dueDate);
  dueDateObj.setHours(0, 0, 0, 0);

  const diffMs = dueDateObj.getTime() - asOfDateObj.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const isOverdue = !isPaid && diffDays < 0;
  const daysOverdue = isOverdue ? Math.abs(diffDays) : 0;
  const daysRemaining = !isPaid && diffDays >= 0 ? diffDays : 0;

  let statusVariant: "paid" | "neutral" | "due_soon" | "overdue";
  if (isPaid) {
    statusVariant = "paid";
  } else if (isOverdue) {
    statusVariant = "overdue";
  } else if (daysRemaining <= 3) {
    statusVariant = "due_soon";
  } else {
    statusVariant = "neutral";
  }

  return {
    invoiceTotal,
    totalReceived,
    balance,
    latestReceiptNumber,
    latestReceiptDate,
    dueDate,
    creditDays,
    isPaid,
    isOverdue,
    daysRemaining,
    daysOverdue,
    paidOnDate,
    statusVariant,
  };
}
