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
  calculateAdvanceTax,
  createTaxSnapshot,
  validateGstInvoiceNumber,
  validateTaxHeadExclusivity,
} from "@/modules/tax/taxEngine";
import {
  calculateCanonicalTotals,
  extractCanonicalInputFromInvoice,
  validateDocumentTotals,
} from "@/modules/tax/canonicalCalculation";
import { recordInvoicePriceHistory, recordPurchasePriceHistory } from "@/modules/pricing/priceHistoryService";
import { recordStockMovement } from "@/modules/inventory/stockMovementService";

export interface PostingResult {
  success: boolean;
  voucherId?: string;
  documentId?: string;
  invoice?: Invoice;
  purchase?: Purchase;
  receipt?: Receipt;
  payment?: Payment;
  error?: string;
  recomputedGrandTotal?: number;
  discrepancy?: boolean;
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
  clientMutationId?: string;
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

    // 2. Authoritative Server-Side Tax Recomputation via Canonical Contract (PRD §§ 44-55)
    const placeOfSupply = invoice.placeOfSupply || invoice.customerSnapshot?.state || company.state || "27";
    const validation = validateDocumentTotals(invoice, company);
    const recomputed = validation.authoritative;
    const clientGrandTotal = Number(invoice.grandTotal) || 0;

    // 3. Reject Tampered Client Totals (Prevent manipulated browser payloads - PRD §§ 48-50)
    if (!validation.matches) {
      console.warn("[Calculation Drift Diagnostic]", {
        clientClaimed: clientGrandTotal,
        authoritative: recomputed.grandTotal,
        diff: validation.diff,
      });
      return {
        success: false,
        error: `Invoice totals changed during validation (Authoritative: ₹${recomputed.grandTotal.toFixed(
          2
        )}, Submitted: ₹${clientGrandTotal.toFixed(2)}). Please review the updated total before posting.`,
        recomputedGrandTotal: recomputed.grandTotal,
        discrepancy: true,
      };
    }

    // 3b. Statutory Tax Head Exclusivity Assertion (PRD §§ 1, 2, 6)
    const taxHeadCheck = validateTaxHeadExclusivity({
      cgst: recomputed.cgst,
      sgst: recomputed.sgst,
      igst: recomputed.igst,
      cess: recomputed.cess,
      totalTax: recomputed.gstTotal,
    });
    if (!taxHeadCheck.valid) {
      return {
        success: false,
        error: `Server posting tax validation rejected: ${taxHeadCheck.error}`,
      };
    }

    // 4. Double-Entry Accounting from Authoritative Numbers
    const totalPaise = Math.round(recomputed.grandTotal * 100);
    const taxPaise = Math.round(recomputed.gstTotal * 100);
    const taxablePaise = totalPaise - taxPaise; // Exact balance: taxable + tax === total

    const salesLedgerId = `led_${companyId}_sales`;
    const gstLedgerId = `led_${companyId}_output_gst`;

    // Check for prior advance tax already accounted for (PRD Addendum § 9: Avoid double GST)
    const advanceTaxAdjustedPaise = invoice.advanceGstAdjustedPaise || Math.round((invoice.advanceTaxPreviouslyAccounted || 0) * 100);
    const netTaxPaise = Math.max(0, taxPaise - advanceTaxAdjustedPaise);
    const advanceAdjLedgerId = `led_${companyId}_advance_gst_adjustment`;

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
      ...(netTaxPaise > 0
        ? [
            {
              ledgerId: gstLedgerId,
              debit: 0,
              credit: netTaxPaise,
            },
          ]
        : []),
      ...(advanceTaxAdjustedPaise > 0
        ? [
            {
              ledgerId: advanceAdjLedgerId,
              debit: 0,
              credit: advanceTaxAdjustedPaise,
            },
          ]
        : []),
    ];

    // 5. Post voucher through authoritative server engine with stable clientMutationId (idempotent)
    let voucherId: string | undefined = undefined;
    const clientMutationId =
      params.clientMutationId?.trim() ||
      (invoice as any).clientMutationId?.trim() ||
      `mut-inv-${invoice.id}`;

    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "journal",
          date: toCanonicalDate(invoice.date),
          narration: `Sales Invoice ${invoice.number} posted`,
          clientMutationId,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      } else {
        throw new Error(voucherRes.error || "Authoritative invoice voucher posting failed");
      }
    }

    // 6. Attach frozen company snapshot, signatory snapshot, and immutable historical tax snapshot
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

    // 7. Authoritatively persist to Firebase RTDB FIRST
    if (firebaseDb) {
      const invRef = ref(firebaseDb, `companyData/${companyId}/invoices/${invoice.id}`);
      await set(invRef, sanitizeForFirebase(updatedInvoice));
    }

    // 8. Save immediately to local Dexie database
    await db().invoices.put(updatedInvoice);

    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "invoices",
      entityId: invoice.id,
      data: updatedInvoice,
    });

    // Parallel stock movements and price history updates
    try {
      await Promise.all(
        frozenLines
          .filter((it) => it.productId)
          .map((it) =>
            recordStockMovement({
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
            }).catch((smErr) => console.warn("Stock movement recording failed non-fatally:", smErr))
          )
      );

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
    } catch (bgErr) {
      console.warn("Stock/price history update warning:", bgErr);
    }

    return { success: true, voucherId, documentId: invoice.id, invoice: updatedInvoice };
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
  clientMutationId?: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, purchase, company, supplierLedgerId, idToken, uid } = params;

  try {
    const totalPaise = Math.round(purchase.grandTotal * 100);
    const taxPaise = Math.round(purchase.gstTotal * 100);
    const taxablePaise = totalPaise - taxPaise;

    // Statutory Tax Head Exclusivity Assertion (PRD §§ 1, 2, 6)
    const taxHeadCheck = validateTaxHeadExclusivity({
      cgst: purchase.cgstTotal,
      sgst: purchase.sgstTotal,
      igst: purchase.igstTotal,
      cess: (purchase as any).cessTotal,
      totalTax: purchase.gstTotal,
    });
    if (!taxHeadCheck.valid) {
      return {
        success: false,
        error: `Server posting tax validation rejected: ${taxHeadCheck.error}`,
      };
    }

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

    // 1. Post voucher through authoritative server engine with stable clientMutationId
    let voucherId: string | undefined = undefined;
    const clientMutationId =
      params.clientMutationId?.trim() ||
      (purchase as any).clientMutationId?.trim() ||
      `mut-pur-${purchase.id}`;

    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "journal",
          date: toCanonicalDate(purchase.date),
          narration: `Purchase Bill ${purchase.number} from supplier`,
          clientMutationId,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      } else {
        throw new Error(voucherRes.error || "Authoritative purchase voucher posting failed");
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

    // 4. Authoritatively persist to Firebase RTDB FIRST
    if (firebaseDb) {
      const puRef = ref(firebaseDb, `companyData/${companyId}/purchases/${purchase.id}`);
      await set(puRef, sanitizeForFirebase(updatedPurchase));
    }

    // 5. Save immediately to local Dexie database
    await db().purchases.put(updatedPurchase);

    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "purchase",
      entityId: purchase.id,
      data: updatedPurchase,
    });

    // Parallel stock movements and price history updates
    try {
      await Promise.all(
        frozenLines
          .filter((it) => it.productId)
          .map((it) =>
            recordStockMovement({
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
            }).catch((smErr) => console.warn("Stock movement recording failed non-fatally:", smErr))
          )
      );

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
    } catch (bgErr) {
      console.warn("Stock/price history update warning:", bgErr);
    }

    return { success: true, voucherId, documentId: purchase.id, purchase: updatedPurchase };
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
  clientMutationId?: string;
}): Promise<PostingResult> {
  const { companyId, financialYearId, receipt, company, customerLedgerId, settlementLedgerId, idToken, uid } = params;

  try {
    const amountPaise = Math.round(receipt.amount * 100);
    const liquidityLedgerId = settlementLedgerId || `led_${companyId}_cash`;

    const normMode = ((company as any)?.taxRegistrationMode || (company as any)?.gstMode || "NORMAL_GST").toUpperCase();
    const isAdvance = receipt.allocationType === "ADVANCE";
    const supplyType = receipt.supplyType || (isAdvance ? "GOODS" : undefined);

    let advanceTaxRes: ReturnType<typeof calculateAdvanceTax> | undefined;
    if (isAdvance) {
      advanceTaxRes = calculateAdvanceTax({
        companyGstMode: normMode,
        supplyType,
        advanceAmount: receipt.amount,
        taxInclusive: receipt.taxProfileSnapshot?.isTaxInclusive ?? true,
        taxTreatment: receipt.taxProfileSnapshot?.taxTreatment as any,
        gstRate: receipt.taxProfileSnapshot?.gstRate,
        cessRate: receipt.taxProfileSnapshot?.cessRate,
        placeOfSupply: receipt.placeOfSupplySnapshot || (receipt as any).placeOfSupply || company?.state,
        companyStateCode: company?.state,
        mixedBreakdown: receipt.mixedBreakdown ? {
          goodsAmount: receipt.mixedBreakdown.goodsAmountPaise / 100,
          serviceAmount: receipt.mixedBreakdown.serviceAmountPaise / 100,
        } : undefined,
      });
    }

    const gstLedgerId = `led_${companyId}_output_gst`;
    const lines = [
      {
        ledgerId: liquidityLedgerId,
        debit: amountPaise,
        credit: 0,
      },
      ...(advanceTaxRes && advanceTaxRes.taxTreatment === "ADVANCE_GST" && advanceTaxRes.totalTaxPaise > 0
        ? [
            {
              ledgerId: customerLedgerId,
              debit: 0,
              credit: advanceTaxRes.taxableAmountPaise,
            },
            {
              ledgerId: gstLedgerId,
              debit: 0,
              credit: advanceTaxRes.totalTaxPaise,
            },
          ]
        : [
            {
              ledgerId: customerLedgerId,
              debit: 0,
              credit: amountPaise,
            },
          ]),
    ];

    // 1. Post voucher through authoritative server engine with stable clientMutationId
    let voucherId: string | undefined = undefined;
    const clientMutationId =
      params.clientMutationId?.trim() ||
      (receipt as any).clientMutationId?.trim() ||
      `mut-rec-${receipt.id}`;

    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "receipt",
          date: toCanonicalDate(receipt.date),
          narration: receipt.allocationType === "ADVANCE"
            ? `Customer Advance Receipt ${receipt.number} [Supply: ${advanceTaxRes?.supplyType || "GOODS"}, Tax: ${advanceTaxRes?.taxTreatment || "NO_ADVANCE_GST"}] [Ref: ${receipt.reference || receipt.number}]`
            : `Receipt ${receipt.number} against receivables`,
          clientMutationId,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      } else {
        throw new Error(voucherRes.error || "Authoritative receipt voucher posting failed");
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
      receiptVoucherId: voucherId,
      postingStatus: "posted",
      settlementLedgerId: liquidityLedgerId,
      companySnapshot,
      signatorySnapshot,
      supplyType: advanceTaxRes ? advanceTaxRes.supplyType : (receipt.supplyType || (isAdvance ? "GOODS" : undefined)),
      taxTreatment: advanceTaxRes ? advanceTaxRes.taxTreatment : (receipt.taxTreatment || (isAdvance ? "NO_ADVANCE_GST" : undefined)),
      advanceAmountPaise: advanceTaxRes ? advanceTaxRes.advanceAmountPaise : amountPaise,
      taxableAmountPaise: advanceTaxRes ? advanceTaxRes.taxableAmountPaise : amountPaise,
      cgstPaise: advanceTaxRes ? advanceTaxRes.cgstPaise : 0,
      sgstPaise: advanceTaxRes ? advanceTaxRes.sgstPaise : 0,
      igstPaise: advanceTaxRes ? advanceTaxRes.igstPaise : 0,
      cessPaise: advanceTaxRes ? advanceTaxRes.cessPaise : 0,
      totalTaxPaise: advanceTaxRes ? advanceTaxRes.totalTaxPaise : 0,
      advanceAvailablePaise: isAdvance
        ? (receipt.advanceAvailablePaise !== undefined ? receipt.advanceAvailablePaise : amountPaise)
        : undefined,
    };

    const previousReceipt = await db().receipts.get(updatedReceipt.id);
    const receiptAllocations = updatedReceipt.allocatedInvoices?.length
      ? updatedReceipt.allocatedInvoices
      : updatedReceipt.invoiceId
        ? [{ invoiceId: updatedReceipt.invoiceId, invoiceNumber: "", amountPaise }]
        : [];
    const previousReceiptAllocations = previousReceipt?.allocatedInvoices?.length
      ? previousReceipt.allocatedInvoices
      : previousReceipt?.invoiceId
        ? [{ invoiceId: previousReceipt.invoiceId, invoiceNumber: "", amountPaise: Math.round(previousReceipt.amount * 100) }]
        : [];
    const invoiceDeltas = new Map<string, number>();
    for (const allocation of previousReceiptAllocations) invoiceDeltas.set(allocation.invoiceId, (invoiceDeltas.get(allocation.invoiceId) || 0) - allocation.amountPaise);
    for (const allocation of receiptAllocations) invoiceDeltas.set(allocation.invoiceId, (invoiceDeltas.get(allocation.invoiceId) || 0) + allocation.amountPaise);
    const linkedInvoices: Invoice[] = [];
    for (const [invoiceId, deltaPaise] of invoiceDeltas) {
      const invoice = await db().invoices.get(invoiceId);
      if (!invoice) continue;
      const paidDelta = deltaPaise / 100;
      const amountPaid = Math.min(invoice.grandTotal, Math.max(0, Number(invoice.amountPaid || 0) + paidDelta));
      const balance = Math.max(0, invoice.grandTotal - amountPaid);
      linkedInvoices.push({ ...invoice, amountPaid, balance, status: balance <= 0.01 ? "paid" : amountPaid > 0 ? "partial" : "unpaid", updatedAt: Date.now() });
    }

    // Authoritative multi-path persistence: receipt and receivable balances move together.
    if (firebaseDb) {
      const updates: Record<string, unknown> = {
        [`companyData/${companyId}/receipts/${receipt.id}`]: sanitizeForFirebase(updatedReceipt),
      };
      for (const invoice of linkedInvoices) updates[`companyData/${companyId}/invoices/${invoice.id}`] = sanitizeForFirebase(invoice);
      await update(ref(firebaseDb), updates);
    }

    // Save to local Dexie database & cache
    await db().receipts.put(updatedReceipt);
    if (linkedInvoices.length) await db().invoices.bulkPut(linkedInvoices);
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "receipt",
      entityId: receipt.id,
      data: updatedReceipt,
    });

    return { success: true, voucherId, documentId: receipt.id, receipt: updatedReceipt };
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
  clientMutationId?: string;
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
    const clientMutationId =
      params.clientMutationId?.trim() ||
      (payment as any).clientMutationId?.trim() ||
      `mut-pay-${payment.id}`;

    if (idToken) {
      const voucherRes = await postVoucherServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          voucherType: "payment",
          date: toCanonicalDate(payment.date),
          narration: `Payment ${payment.number} to supplier`,
          clientMutationId,
          lines,
        },
      });

      if (voucherRes.success && voucherRes.voucher) {
        voucherId = voucherRes.voucher.id;
      } else {
        throw new Error(voucherRes.error || "Authoritative payment voucher posting failed");
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

    const previousPayment = await db().payments.get(updatedPayment.id);
    const paymentAllocations = updatedPayment.allocatedPurchases?.length
      ? updatedPayment.allocatedPurchases
      : updatedPayment.purchaseId
        ? [{ purchaseId: updatedPayment.purchaseId, purchaseNumber: "", amountPaise }]
        : [];
    const previousPaymentAllocations = previousPayment?.allocatedPurchases?.length
      ? previousPayment.allocatedPurchases
      : previousPayment?.purchaseId
        ? [{ purchaseId: previousPayment.purchaseId, purchaseNumber: "", amountPaise: Math.round(previousPayment.amount * 100) }]
        : [];
    const purchaseDeltas = new Map<string, number>();
    for (const allocation of previousPaymentAllocations) purchaseDeltas.set(allocation.purchaseId, (purchaseDeltas.get(allocation.purchaseId) || 0) - allocation.amountPaise);
    for (const allocation of paymentAllocations) purchaseDeltas.set(allocation.purchaseId, (purchaseDeltas.get(allocation.purchaseId) || 0) + allocation.amountPaise);
    const linkedPurchases: Purchase[] = [];
    for (const [purchaseId, deltaPaise] of purchaseDeltas) {
      const purchase = await db().purchases.get(purchaseId);
      if (!purchase) continue;
      const paidDelta = deltaPaise / 100;
      const amountPaid = Math.min(purchase.grandTotal, Math.max(0, Number(purchase.amountPaid || 0) + paidDelta));
      const balance = Math.max(0, purchase.grandTotal - amountPaid);
      linkedPurchases.push({ ...purchase, amountPaid, balance, status: balance <= 0.01 ? "paid" : amountPaid > 0 ? "partial" : "unpaid", updatedAt: Date.now() });
    }

    // Authoritative multi-path persistence: payment and payable balances move together.
    if (firebaseDb) {
      const updates: Record<string, unknown> = {
        [`companyData/${companyId}/payments/${payment.id}`]: sanitizeForFirebase(updatedPayment),
      };
      for (const purchase of linkedPurchases) updates[`companyData/${companyId}/purchases/${purchase.id}`] = sanitizeForFirebase(purchase);
      await update(ref(firebaseDb), updates);
    }

    // Save to local Dexie database & cache
    await db().payments.put(updatedPayment);
    if (linkedPurchases.length) await db().purchases.bulkPut(linkedPurchases);
    await cacheEntity({
      uid,
      companyId,
      financialYearId,
      entityType: "payment",
      entityId: payment.id,
      data: updatedPayment,
    });

    return { success: true, voucherId, documentId: payment.id, payment: updatedPayment };
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
  clientMutationId?: string;
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
    const clientMutationId =
      params.clientMutationId?.trim() ||
      `mut-amend-${correctedInvoice.id}`;

    // 1. Reverse original voucher if present
    if (originalInvoice.voucherId && idToken) {
      const revRes = await reverseVoucherServerFn({
        data: {
          idToken,
          companyId,
          voucherId: originalInvoice.voucherId,
          reversalReason: `Amendment to Invoice ${originalInvoice.number}: ${amendmentReason}`,
          clientMutationId: `rev-${clientMutationId}`,
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
      clientMutationId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to amend posted invoice:", err);
    return { success: false, error: msg };
  }
}
