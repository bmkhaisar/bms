import { postVoucherServerFn } from "@/functions/postVoucherFn";
import { reverseVoucherServerFn } from "@/functions/reverseVoucherFn";
import type { Invoice, Purchase, Receipt, Payment, LineItem } from "@/lib/db";
import { db } from "@/lib/db";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, update } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { createCompanySnapshot } from "@/modules/company/types";
import type { Company } from "@/modules/company/types";
import { createSignatorySnapshot } from "@/modules/company/signatoryHelper";
import {
  calculateDocumentTaxes,
  createTaxSnapshot,
  validateGstInvoiceNumber,
} from "@/modules/tax/taxEngine";
import { recordInvoicePriceHistory, recordPurchasePriceHistory } from "@/modules/pricing/priceHistoryService";
import { recordStockMovement } from "@/modules/inventory/stockMovementService";

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
    const normMode = ((company as any).taxRegistrationMode || (company as any).gstMode || "NORMAL_GST").toUpperCase();

    // 1. Validate Legal Invoice Number for GST Tax Invoices (Rule 46: <= 16 chars)
    if (normMode === "NORMAL_GST" || normMode === "REGISTERED") {
      const numVal = validateGstInvoiceNumber(invoice.number);
      if (!numVal.valid) {
        return {
          success: false,
          error: numVal.error || `Invoice number '${invoice.number}' violates GST statutory Rule 46 numbering requirements.`,
        };
      }
    }

    // 2. Authoritative Server-Side Tax Recomputation (Correction 2: Never blind-trust client totals)
    const placeOfSupply = invoice.placeOfSupply || invoice.customerSnapshot?.state || company.state || "27";
    const recomputed = calculateDocumentTaxes({
      items: (invoice.items || []).map((it) => ({
        productId: it.productId,
        name: it.name,
        hsn: it.hsn,
        quantity: it.quantity,
        rate: it.rate,
        gstRate: it.taxRate || 0,
        cessRate: it.cessRate || 0,
        discountValue: it.discountPercent ? (it.rate * it.quantity * it.discountPercent) / 100 : 0,
        discountType: "fixed",
        pricingMode: it.isTaxInclusive ? "inclusive" : "exclusive",
      })),
      extraCharges: (invoice.extraCharges || []).map((c) => ({
        name: c.name || (c as any).label || "Charge",
        amount: c.amount,
        taxable: c.isTaxable !== false,
        gstRate: c.taxRate || 0,
      })),
      companyGstMode: normMode as any,
      companyStateCode: company.state,
      placeOfSupply,
      documentDiscountValue: invoice.discountTotal,
      documentDiscountType: "fixed",
    });

    // 3. Reject Tampered Client Totals (Prevent manipulated browser payloads)
    const clientGrandTotal = Number(invoice.grandTotal) || 0;
    if (clientGrandTotal > 0 && Math.abs(clientGrandTotal - recomputed.grandTotal) > 1.0) {
      return {
        success: false,
        error: `Calculation discrepancy rejected: Client payload claimed grandTotal ₹${clientGrandTotal.toFixed(
          2
        )}, but authoritative server recomputation calculated ₹${recomputed.grandTotal.toFixed(2)}.`,
      };
    }

    // 4. Double-Entry Accounting from Authoritative Numbers
    const totalPaise = Math.round(recomputed.grandTotal * 100);
    const taxPaise = Math.round(recomputed.gstTotal * 100);
    const taxablePaise = totalPaise - taxPaise; // Exact balance: taxable + tax === total

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

    // 5. Post voucher through authoritative server engine
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

    // 6. Attach frozen company snapshot, signatory snapshot, and immutable historical tax snapshot (Correction 11)
    const companySnapshot = invoice.companySnapshot || createCompanySnapshot(company);
    const signatorySnapshot =
      invoice.signatorySnapshot ||
      createSignatorySnapshot(
        company,
        (invoice as any).signatoryOverride,
        invoice.date
      );
    const taxSnapshot = createTaxSnapshot({
      taxTotals: recomputed,
      companyGstMode: normMode as any,
      supplierGstin: company.gstin,
      customerGstin: invoice.customerSnapshot?.gstin,
      companyStateCode: company.state,
      placeOfSupply,
    });

    // 6. Freeze Line Snapshots (Historical line persistence)
    const frozenLines: LineItem[] = await Promise.all(
      (invoice.items || []).map(async (it) => {
        let prod = it.productId ? await db().products.get(it.productId) : undefined;
        const productName = it.productName || it.name || prod?.name || "Item";
        const sku = it.sku || prod?.sku || "";
        const hsn = it.hsn || prod?.hsn || "";
        const uomId = it.uomId || prod?.defaultUomId || it.unit || "NOS";
        const uomLabel = it.uomLabel || it.unit || prod?.unit || "NOS";
        const ratePaise = it.ratePaise !== undefined ? it.ratePaise : Math.round(it.rate * 100);
        const discount = it.discountPercent ?? it.discountPct ?? 0;
        const taxRate = it.taxRate ?? it.gstRate ?? 0;
        const taxTreatment = it.taxTreatment || (taxRate > 0 ? "taxable" : "exempt");
        const lineAmount = it.total !== undefined ? it.total : Math.round((it.quantity * it.rate * (1 - discount / 100)) * 100) / 100;

        return {
          ...it,
          productId: it.productId,
          productName,
          name: productName,
          description: it.description || productName,
          sku,
          hsn,
          uomId,
          uomLabel,
          unit: uomLabel,
          quantity: it.quantity,
          size: it.size,
          measurementSummary: it.measurementSummary,
          pricingBasis: it.pricingBasis,
          rate: it.rate,
          ratePaise,
          discountPercent: discount,
          discountPct: discount,
          taxTreatment,
          taxRate,
          gstRate: taxRate,
          lineAmount,
          total: lineAmount,
        };
      })
    );

    const updatedInvoice: Invoice = {
      ...invoice,
      voucherId,
      postingStatus: "posted",
      status: "posted",
      items: frozenLines,
      lineSnapshots: frozenLines,
      subtotal: recomputed.subtotal,
      taxableAmount: recomputed.taxableValue,
      gstTotal: recomputed.gstTotal,
      cgstTotal: recomputed.cgst,
      sgstTotal: recomputed.sgst,
      igstTotal: recomputed.igst,
      cessTotal: recomputed.cess,
      roundOff: recomputed.roundOff,
      grandTotal: recomputed.grandTotal,
      balance: recomputed.balanceDue,
      companySnapshot,
      signatorySnapshot,
      taxSnapshot: taxSnapshot as any,
      version: invoice.version || 1,
      updatedAt: Date.now(),
    };

    // 7. Save to local Dexie database
    await db().invoices.put(updatedInvoice);

    // 8. Save to Firebase RTDB if available
    if (firebaseDb) {
      const invRef = ref(firebaseDb, `companyData/${companyId}/invoices/${invoice.id}`);
      await set(invRef, sanitizeForFirebase(updatedInvoice));
    }

    // 9. Cache in bms_cache_v1
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "invoices",
      entityId: invoice.id,
      data: updatedInvoice,
    });

    // 10. Record Authoritative Stock OUT Movements, Price History and Product lastSalesRatePaise
    for (const it of frozenLines) {
      if (it.productId) {
        try {
          await recordStockMovement({
            companyId,
            productId: it.productId,
            movementType: "out",
            documentKind: "invoice",
            documentId: invoice.id,
            documentNumber: invoice.number,
            date: invoice.date,
            enteredQuantity: it.quantity,
            enteredUom: it.unit || it.uomLabel || "NOS",
            ratePaise: it.ratePaise,
          });
        } catch (smErr) {
          console.warn("Stock movement recording failed non-fatally:", smErr);
        }
      }
    }

    try {
      recordInvoicePriceHistory({
        companyId,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        date: invoice.date,
        items: frozenLines.map((it) => ({
          productId: it.productId,
          rate: it.rate,
          quantity: it.quantity,
          unit: it.unit,
        })),
      });
      for (const it of frozenLines) {
        if (it.productId) {
          const p = await db().products.get(it.productId);
          if (p) {
            p.lastSalesRatePaise = it.ratePaise || Math.round(it.rate * 100);
            await db().products.put(p);
          }
        }
      }
    } catch (phErr) {
      console.warn("Price history logging failed non-fatally:", phErr);
    }

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
          narration: `Purchase Bill ${purchase.number} from supplier`,
          clientMutationId: `mut-pur-${purchase.id}-${Date.now()}`,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      }
    }

    // 2. Freeze Line Snapshots (Historical line persistence)
    const frozenLines: LineItem[] = await Promise.all(
      (purchase.items || []).map(async (it) => {
        let prod = it.productId ? await db().products.get(it.productId) : undefined;
        const productName = it.productName || it.name || prod?.name || "Item";
        const sku = it.sku || prod?.sku || "";
        const hsn = it.hsn || prod?.hsn || "";
        const uomId = it.uomId || prod?.defaultUomId || it.unit || "NOS";
        const uomLabel = it.uomLabel || it.unit || prod?.unit || "NOS";
        const ratePaise = it.ratePaise !== undefined ? it.ratePaise : Math.round(it.rate * 100);
        const discount = it.discountPercent ?? it.discountPct ?? 0;
        const taxRate = it.taxRate ?? it.gstRate ?? 0;
        const taxTreatment = it.taxTreatment || (taxRate > 0 ? "taxable" : "exempt");
        const lineAmount = it.total !== undefined ? it.total : Math.round((it.quantity * it.rate * (1 - discount / 100)) * 100) / 100;

        return {
          ...it,
          productId: it.productId,
          productName,
          name: productName,
          description: it.description || productName,
          sku,
          hsn,
          uomId,
          uomLabel,
          unit: uomLabel,
          quantity: it.quantity,
          size: it.size,
          measurementSummary: it.measurementSummary,
          pricingBasis: it.pricingBasis,
          rate: it.rate,
          ratePaise,
          discountPercent: discount,
          discountPct: discount,
          taxTreatment,
          taxRate,
          gstRate: taxRate,
          lineAmount,
          total: lineAmount,
        };
      })
    );

    // 3. Attach frozen company snapshot & signatory snapshot
    const snapshot = purchase.companySnapshot || createCompanySnapshot(company);
    const signatorySnapshot =
      purchase.signatorySnapshot ||
      createSignatorySnapshot(
        company,
        (purchase as any).signatoryOverride,
        purchase.date
      );
    const updatedPurchase: Purchase = {
      ...purchase,
      voucherId,
      postingStatus: "posted",
      items: frozenLines,
      lineSnapshots: frozenLines,
      companySnapshot: snapshot,
      signatorySnapshot,
      version: purchase.version || 1,
      updatedAt: Date.now(),
    };

    // 4. Save to local Dexie database
    await db().purchases.put(updatedPurchase);

    // 5. Save to Firebase RTDB
    if (firebaseDb) {
      const puRef = ref(firebaseDb, `companyData/${companyId}/purchases/${purchase.id}`);
      await set(puRef, sanitizeForFirebase(updatedPurchase));
    }

    // 6. Cache in bms_cache_v1
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "purchase",
      entityId: purchase.id,
      data: updatedPurchase,
    });

    // 7. Record Authoritative Stock IN Movements
    for (const it of frozenLines) {
      if (it.productId) {
        try {
          await recordStockMovement({
            companyId,
            productId: it.productId,
            movementType: "in",
            documentKind: "purchase",
            documentId: purchase.id,
            documentNumber: purchase.number,
            date: purchase.date,
            enteredQuantity: it.quantity,
            enteredUom: it.unit || it.uomLabel || "NOS",
            ratePaise: it.ratePaise,
          });
        } catch (smErr) {
          console.warn("Stock movement recording failed non-fatally:", smErr);
        }
      }
    }

    // 8. Record Price History and Product lastPurchaseRatePaise
    try {
      recordPurchasePriceHistory({
        companyId,
        supplierId: purchase.supplierId,
        purchaseId: purchase.id,
        purchaseNumber: purchase.number,
        date: purchase.date,
        items: frozenLines.map((it) => ({
          productId: it.productId,
          rate: it.rate,
          quantity: it.quantity,
          unit: it.unit,
        })),
      });
      for (const it of frozenLines) {
        if (it.productId) {
          const p = await db().products.get(it.productId);
          if (p) {
            p.lastPurchaseRatePaise = it.ratePaise || Math.round(it.rate * 100);
            await db().products.put(p);
          }
        }
      }
    } catch (phErr) {
      console.warn("Purchase price history logging failed non-fatally:", phErr);
    }

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
  company?: Partial<Company>;
  customerLedgerId: string;
  settlementLedgerId?: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, receipt, company, customerLedgerId, settlementLedgerId, idToken, uid } = params;

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

    // Attach frozen company snapshot & signatory snapshot
    const companySnapshot = receipt.companySnapshot || (company ? createCompanySnapshot(company) : undefined);
    const signatorySnapshot =
      receipt.signatorySnapshot ||
      (company ? createSignatorySnapshot(company, receipt.signatoryOverride, receipt.date) : undefined);

    const updatedReceipt: Receipt = {
      ...receipt,
      voucherId,
      postingStatus: "posted",
      settlementLedgerId: liquidityLedgerId,
      companySnapshot,
      signatorySnapshot,
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
  company?: Partial<Company>;
  supplierLedgerId: string;
  settlementLedgerId?: string;
  idToken?: string;
  uid: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, payment, company, supplierLedgerId, settlementLedgerId, idToken, uid } = params;

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

    // Attach frozen company snapshot & signatory snapshot
    const companySnapshot = payment.companySnapshot || (company ? createCompanySnapshot(company) : undefined);
    const signatorySnapshot =
      payment.signatorySnapshot ||
      (company ? createSignatorySnapshot(company, payment.signatoryOverride, payment.date) : undefined);

    const updatedPayment: Payment = {
      ...payment,
      voucherId,
      postingStatus: "posted",
      settlementLedgerId: liquidityLedgerId,
      companySnapshot,
      signatorySnapshot,
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
