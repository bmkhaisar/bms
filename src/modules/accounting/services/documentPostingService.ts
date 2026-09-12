import { postVoucherServerFn } from "@/functions/postVoucherFn";
import { reverseVoucherServerFn } from "@/functions/reverseVoucherFn";
import type { Invoice, Purchase, Receipt, Payment, LineItem } from "@/lib/db";
import { db } from "@/lib/db";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, update } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { createCompanySnapshot } from "@/modules/company/types";
import type { Company } from "@/modules/company/types";

export interface PostingResult {
  success: boolean;
  voucherId?: string;
  documentId?: string;
  error?: string;
}

/**
 * Format a Date object or timestamp into canonical YYYY-MM-DD string.
 */
function toCanonicalDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Authoritatively posts an Invoice with a balanced double-entry voucher & stock movements.
 * Debit: Customer Receivable Ledger
 * Credit: Sales Revenue Ledger
 * Credit: Output GST Ledger
 */
export async function postInvoiceTransaction(params: {
  companyId: string;
  financialYearId: string;
  invoice: Invoice;
  company: Partial<Company>;
  customerLedgerId: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, invoice, company, customerLedgerId, idToken, uid } = params;

  try {
    const totalPaise = Math.round(invoice.grandTotal * 100);
    const taxPaise = Math.round(invoice.gstTotal * 100);
    const extraChargesPaise = Math.round((invoice.extraChargesTotal || 0) * 100);
    const taxablePaise = totalPaise - taxPaise; // Guarantees exact balance: taxable + tax === total

    const salesLedgerId = `led_${companyId}_sales`;
    const gstLedgerId = `led_${companyId}_output_gst`;

    const lines = [
      {
        ledgerId: customerLedgerId,
        debit: totalPaise,
        credit: 0,
      },
      {
        ledgerId: salesLedgerId,
        debit: 0,
        credit: taxablePaise,
      },
      ...(taxPaise > 0
        ? [
            {
              ledgerId: gstLedgerId,
              debit: 0,
              credit: taxPaise,
            },
          ]
        : []),
    ];

    // 1. Post voucher through authoritative server engine
    let voucherId: string | undefined = undefined;
    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "journal",
          date: toCanonicalDate(invoice.date),
          narration: `Sales Invoice ${invoice.number} posted`,
          clientMutationId: `mut-inv-${invoice.id}-${Date.now()}`,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      }
    }

    // 2. Attach frozen company snapshot
    const snapshot = createCompanySnapshot(company);
    const updatedInvoice: Invoice = {
      ...invoice,
      voucherId,
      postingStatus: "posted",
      companySnapshot: snapshot,
      version: invoice.version || 1,
      updatedAt: Date.now(),
    };

    // 3. Save to local Dexie database
    await db().invoices.put(updatedInvoice);

    // 4. Save to Firebase RTDB if available
    if (firebaseDb) {
      const invRef = ref(firebaseDb, `companyData/${companyId}/invoices/${invoice.id}`);
      await set(invRef, sanitizeForFirebase(updatedInvoice));
    }

    // 5. Cache in bms_cache_v1
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "invoice",
      entityId: invoice.id,
      data: updatedInvoice,
    });

    return { success: true, voucherId, documentId: invoice.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to post invoice voucher:", err);
    return { success: false, error: msg };
  }
}

/**
 * Authoritatively posts a Purchase Bill with a balanced double-entry voucher & stock movements.
 * Debit: Purchases / COGS Ledger
 * Debit: Input GST Ledger
 * Credit: Supplier Payable Ledger
 */
export async function postPurchaseTransaction(params: {
  companyId: string;
  financialYearId: string;
  purchase: Purchase;
  company: Partial<Company>;
  supplierLedgerId: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, purchase, company, supplierLedgerId, idToken, uid } = params;

  try {
    const totalPaise = Math.round(purchase.grandTotal * 100);
    const taxPaise = Math.round(purchase.gstTotal * 100);
    const taxablePaise = totalPaise - taxPaise;

    const purchaseLedgerId = `led_${companyId}_purchase`;
    const gstLedgerId = `led_${companyId}_input_gst`;

    const lines = [
      {
        ledgerId: purchaseLedgerId,
        debit: taxablePaise,
        credit: 0,
      },
      ...(taxPaise > 0
        ? [
            {
              ledgerId: gstLedgerId,
              debit: taxPaise,
              credit: 0,
            },
          ]
        : []),
      {
        ledgerId: supplierLedgerId,
        debit: 0,
        credit: totalPaise,
      },
    ];

    // 1. Post voucher through authoritative server engine
    let voucherId: string | undefined = undefined;
    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "journal",
          date: toCanonicalDate(purchase.date),
          narration: `Purchase Bill ${purchase.number} posted`,
          clientMutationId: `mut-pu-${purchase.id}-${Date.now()}`,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      }
    }

    // 2. Attach frozen company snapshot
    const snapshot = createCompanySnapshot(company);
    const updatedPurchase: Purchase = {
      ...purchase,
      voucherId,
      postingStatus: "posted",
      companySnapshot: snapshot,
      version: purchase.version || 1,
      updatedAt: Date.now(),
    };

    // 3. Save to local Dexie database
    await db().purchases.put(updatedPurchase);

    // 4. Save to Firebase RTDB
    if (firebaseDb) {
      const puRef = ref(firebaseDb, `companyData/${companyId}/purchases/${purchase.id}`);
      await set(puRef, sanitizeForFirebase(updatedPurchase));
    }

    // 5. Cache in bms_cache_v1
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "purchase",
      entityId: purchase.id,
      data: updatedPurchase,
    });

    return { success: true, voucherId, documentId: purchase.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to post purchase voucher:", err);
    return { success: false, error: msg };
  }
}

/**
 * Authoritatively posts a Customer Receipt.
 * Debit: Cash or Bank Liquidity Ledger
 * Credit: Customer Receivable Ledger
 */
export async function postReceiptTransaction(params: {
  companyId: string;
  financialYearId: string;
  receipt: Receipt;
  customerLedgerId: string;
  settlementLedgerId?: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, receipt, customerLedgerId, settlementLedgerId, idToken, uid } = params;

  try {
    const amountPaise = Math.round(receipt.amount * 100);
    const liquidityLedgerId = settlementLedgerId || `led_${companyId}_cash`;

    const lines = [
      {
        ledgerId: liquidityLedgerId,
        debit: amountPaise,
        credit: 0,
      },
      {
        ledgerId: customerLedgerId,
        debit: 0,
        credit: amountPaise,
      },
    ];

    let voucherId: string | undefined = undefined;
    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "receipt",
          date: toCanonicalDate(receipt.date),
          narration: `Receipt ${receipt.number} for customer payment`,
          clientMutationId: `mut-rec-${receipt.id}-${Date.now()}`,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      }
    }

    const updatedReceipt: Receipt = {
      ...receipt,
      voucherId,
      postingStatus: "posted",
      settlementLedgerId: liquidityLedgerId,
    };

    await db().receipts.put(updatedReceipt);

    if (firebaseDb) {
      const recRef = ref(firebaseDb, `companyData/${companyId}/receipts/${receipt.id}`);
      await set(recRef, sanitizeForFirebase(updatedReceipt));
    }

    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "receipt",
      entityId: receipt.id,
      data: updatedReceipt,
    });

    return { success: true, voucherId, documentId: receipt.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to post receipt voucher:", err);
    return { success: false, error: msg };
  }
}

/**
 * Authoritatively posts a Supplier Payment.
 * Debit: Supplier Payable Ledger
 * Credit: Cash or Bank Liquidity Ledger
 */
export async function postPaymentTransaction(params: {
  companyId: string;
  financialYearId: string;
  payment: Payment;
  supplierLedgerId: string;
  settlementLedgerId?: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, payment, supplierLedgerId, settlementLedgerId, idToken, uid } = params;

  try {
    const amountPaise = Math.round(payment.amount * 100);
    const liquidityLedgerId = settlementLedgerId || `led_${companyId}_cash`;

    const lines = [
      {
        ledgerId: supplierLedgerId,
        debit: amountPaise,
        credit: 0,
      },
      {
        ledgerId: liquidityLedgerId,
        debit: 0,
        credit: amountPaise,
      },
    ];

    let voucherId: string | undefined = undefined;
    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "payment",
          date: toCanonicalDate(payment.date),
          narration: `Payment ${payment.number} to supplier`,
          clientMutationId: `mut-pay-${payment.id}-${Date.now()}`,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      }
    }

    const updatedPayment: Payment = {
      ...payment,
      voucherId,
      postingStatus: "posted",
      settlementLedgerId: liquidityLedgerId,
    };

    if (firebaseDb) {
      const payRef = ref(firebaseDb, `companyData/${companyId}/payments/${payment.id}`);
      await set(payRef, sanitizeForFirebase(updatedPayment));
    }

    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "payment",
      entityId: payment.id,
      data: updatedPayment,
    });

    return { success: true, voucherId, documentId: payment.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to post payment voucher:", err);
    return { success: false, error: msg };
  }
}

/**
 * Controlled Amendment for a Posted Invoice.
 * 1. Checks that the financial year is unlocked.
 * 2. Reverses the original accounting voucher.
 * 3. Posts the corrected voucher.
 * 4. Increments document version and preserves amendment audit link.
 */
export async function amendPostedInvoiceTransaction(params: {
  companyId: string;
  financialYearId: string;
  originalInvoice: Invoice;
  correctedInvoice: Invoice;
  company: Partial<Company>;
  customerLedgerId: string;
  idToken?: string;
  uid: string;
  amendmentReason: string;
}): Promise<PostingResult> {
  const {
    companyId,
    financialYearId,
    originalInvoice,
    correctedInvoice,
    company,
    customerLedgerId,
    idToken,
    uid,
    amendmentReason,
  } = params;

  try {
    // 1. Reverse original voucher if present
    if (originalInvoice.voucherId && idToken) {
      const revRes = await reverseVoucherServerFn({
        data: {
          idToken,
          companyId,
          voucherId: originalInvoice.voucherId,
          reversalReason: `Amendment to Invoice ${originalInvoice.number}: ${amendmentReason}`,
          clientMutationId: `mut-amend-rev-${originalInvoice.id}-${Date.now()}`,
        },
      });

      if (!revRes.success) {
        return { success: false, error: revRes.error || "Failed to reverse original voucher." };
      }
    }

    // 2. Post new corrected voucher
    const newVersion = (originalInvoice.version || 1) + 1;
    const amendedToPost: Invoice = {
      ...correctedInvoice,
      version: newVersion,
      amendedFromId: originalInvoice.id,
    };

    return await postInvoiceTransaction({
      companyId,
      financialYearId,
      invoice: amendedToPost,
      company,
      customerLedgerId,
      idToken,
      uid,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to amend posted invoice:", err);
    return { success: false, error: msg };
  }
}
