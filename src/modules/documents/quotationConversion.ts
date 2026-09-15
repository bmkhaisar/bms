import { db, uid, nextNumber, type Quotation, type Invoice, type LineItem, type ExtraCharge, type CompanySettings, type Customer } from "@/lib/db";
import { toast } from "sonner";
import { applyStockDelta } from "@/lib/calc";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { postInvoiceTransaction } from "@/modules/accounting/services/documentPostingService";
import { ensureCustomerLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import type { Company } from "@/modules/company/types";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, get, update, runTransaction } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { applyQuotationToLinkedDraft, isInvoiceImmutable } from "./linkedDraftInvoice";
export { applyQuotationToLinkedDraft, isInvoiceImmutable } from "./linkedDraftInvoice";

export interface ConvertQuotationOptions {
  activeCompany?: Partial<Company> | null;
  financialYearId?: string;
  fyName?: string;
  user?: { uid: string; getIdToken?: () => Promise<string> } | null;
  idToken?: string;
  companySettings?: CompanySettings | null;
}

export interface QuotationConversionResult {
  success: boolean;
  invoice?: Invoice;
  isExisting?: boolean;
  error?: string;
}

export async function updateLinkedDraftInvoiceFromQuotation(
  quotation: Quotation,
  invoice: Invoice,
  options?: ConvertQuotationOptions,
): Promise<Invoice> {
  const now = Date.now();
  let updated = applyQuotationToLinkedDraft(quotation, invoice, now);

  if (options?.activeCompany?.id && firebaseDb) {
    let rejection = "Linked invoice no longer exists.";
    const transaction = await runTransaction(
      ref(firebaseDb, `companyData/${options.activeCompany.id}/invoices/${invoice.id}`),
      (current) => {
        if (!current) return;
        try {
          return sanitizeForFirebase(applyQuotationToLinkedDraft(quotation, current as Invoice, now));
        } catch (error) {
          rejection = error instanceof Error ? error.message : rejection;
          return;
        }
      },
      { applyLocally: false },
    );
    if (!transaction.committed || !transaction.snapshot.exists()) throw new Error(rejection);
    updated = transaction.snapshot.val() as Invoice;
  }

  await db().invoices.put(updated);
  if (options?.activeCompany?.id) {
    await cacheEntity({
      uid: options.user?.uid || "",
      companyId: options.activeCompany.id,
      entityType: "invoice",
      entityId: updated.id,
      data: updated,
      financialYearId: updated.financialYearId,
      name: updated.number,
    });
  }
  return updated;
}

/**
 * Converts a Quotation to an independent Sales Invoice with full fidelity.
 * Idempotent: If quotation is already converted, returns the existing invoice without creating duplicates.
 * Preserves items, descriptions, specifications, sizes, HSN, tax rates, customer snapshot, and extraCharges.
 * Authoritatively posts double-entry transaction when active company & user context are supplied.
 */
export async function convertQuotationToInvoice(
  quotation: Quotation,
  options?: ConvertQuotationOptions
): Promise<QuotationConversionResult> {
  try {
    // 1. Idempotency Check: Firebase is authoritative; Dexie is only a cache.
    if (quotation.convertedInvoiceId) {
      const existing = await db().invoices.get(quotation.convertedInvoiceId);
      if (existing) {
        toast.info(`Quotation was already converted to Invoice ${existing.number}`);
        return { success: true, invoice: existing, isExisting: true };
      }
    }

    if (options?.activeCompany?.id && firebaseDb) {
      const cloudQuotation = await get(ref(firebaseDb, `companyData/${options.activeCompany.id}/quotations/${quotation.id}`));
      const convertedInvoiceId = cloudQuotation.val()?.convertedInvoiceId as string | undefined;
      if (convertedInvoiceId) {
        const cloudInvoice = await get(ref(firebaseDb, `companyData/${options.activeCompany.id}/invoices/${convertedInvoiceId}`));
        if (cloudInvoice.exists()) {
          const existing = cloudInvoice.val() as Invoice;
          await db().invoices.put(existing);
          await db().quotations.update(quotation.id, { status: "converted", convertedInvoiceId });
          toast.info(`Quotation was already converted to Invoice ${existing.number}`);
          return { success: true, invoice: existing, isExisting: true };
        }
      }
    }

    // 2. Concurrency-Safe Legal Invoice Numbering
    let idToken = options?.idToken;
    if (!idToken && options?.user?.getIdToken) {
      try {
        idToken = await options.user.getIdToken();
      } catch {}
    }

    const number = await getNextDocumentNumber({
      kind: "invoice",
      companyId: options?.activeCompany?.id,
      financialYearId: options?.financialYearId,
      fyName: options?.fyName,
      idToken,
      customPrefix: options?.activeCompany?.invoicePrefix,
    });
    const now = Date.now();

    // 3. Compute extra charges total accurately & preserve list
    const extraCharges: ExtraCharge[] = quotation.extraCharges ? [...quotation.extraCharges] : [];
    const extraChargesTotal = extraCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0);

    // 4. Copy line items with full fidelity (description, size, HSN, specs, taxes)
    const items: LineItem[] = quotation.items.map((it) => ({
      ...it,
    }));

    // Resolve customer snapshot
    let customerSnapshot = quotation.customerSnapshot ? { ...quotation.customerSnapshot } : undefined;
    let customer: Customer | undefined;
    if (quotation.customerId) {
      customer = await db().customers.get(quotation.customerId);
      if (!customerSnapshot && customer) {
        customerSnapshot = {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          gstin: customer.gstin,
          address: customer.billingAddress || customer.address,
          state: customer.state,
          pan: customer.pan,
        };
      }
    }

    // 5. Construct independent DRAFT invoice (PRD § 35: Preserve party, address snapshot, signatory, items)
    // Stable ID closes the duplicate window if two devices convert the same quotation concurrently.
    const invoiceId = quotation.convertedInvoiceId || `inv_from_${quotation.id}`;
    const invoice: Invoice = {
      id: invoiceId,
      number,
      date: now,
      financialYearId: options?.financialYearId || quotation.financialYearId,
      customerId: quotation.customerId,
      customerSnapshot,
      billToPartyId: quotation.billToPartyId || quotation.customerId,
      billToSnapshot: quotation.billToSnapshot || (quotation as any).billingAddressSnapshot,
      billingAddressId: quotation.billingAddressId,
      billingAddressSnapshot: quotation.billingAddressSnapshot || quotation.billToSnapshot,
      billingAddress: quotation.billingAddress || (quotation as any).billingAddressSnapshot?.addressLine1 || customer?.billingAddress || customer?.address,
      sameAsBilling: quotation.sameAsBilling !== false,
      shipToPartyId: quotation.shipToPartyId || quotation.customerId,
      shipToPartySnapshot: quotation.shipToPartySnapshot || quotation.shippingAddressSnapshot,
      shippingAddressId: quotation.shippingAddressId,
      shippingAddressSnapshot: quotation.shippingAddressSnapshot || quotation.shipToPartySnapshot,
      shippingAddress: quotation.shippingAddress || (quotation as any).shippingAddressSnapshot?.addressLine1,
      dueDate: typeof customer?.creditDays === "number" ? now + customer.creditDays * 24 * 60 * 60 * 1000 : undefined,
      items,
      subtotal: quotation.subtotal,
      discountTotal: quotation.discountTotal,
      gstTotal: quotation.gstTotal,
      cgstTotal: (quotation.isIgst || (quotation.igstTotal && quotation.igstTotal > 0)) ? 0 : (quotation.cgstTotal ?? quotation.gstTotal / 2),
      sgstTotal: (quotation.isIgst || (quotation.igstTotal && quotation.igstTotal > 0)) ? 0 : (quotation.sgstTotal ?? quotation.gstTotal / 2),
      igstTotal: (quotation.isIgst || (quotation.igstTotal && quotation.igstTotal > 0)) ? (quotation.igstTotal || quotation.gstTotal) : 0,
      isIgst: Boolean(quotation.isIgst || (quotation.igstTotal && quotation.igstTotal > 0)),
      extraCharges,
      extraChargesTotal,
      roundOff: quotation.roundOff,
      grandTotal: quotation.grandTotal,
      amountPaid: 0,
      balance: quotation.grandTotal,
      status: "draft", // Correction 4: Draft invoice awaiting employee review
      notes: quotation.notes,
      terms: quotation.terms,
      termsSnapshot: quotation.termsSnapshot,
      structuredTermsSnapshot: quotation.structuredTermsSnapshot,
      includeTerms: quotation.includeTerms !== false,
      bankAccountId: quotation.bankAccountId,
      bankSnapshot: quotation.bankSnapshot,
      bankDetailsSnapshot: quotation.bankDetailsSnapshot || quotation.bankSnapshot,
      includeBankDetails: quotation.includeBankDetails !== false,
      gstCalculationMode: quotation.gstCalculationMode || "item_wise",
      overallGstRate: quotation.overallGstRate,
      companySnapshot: quotation.companySnapshot,
      signatorySnapshot: quotation.signatorySnapshot,
      signatoryOverride: quotation.signatoryOverride,
      sourceType: "QUOTATION",
      sourceQuotationId: quotation.id,
      sourceQuotationNumber: quotation.number,
      sourceQuotationUpdatedAt: quotation.updatedAt || quotation.createdAt,
      convertedFromQuotationId: quotation.id,
      createdAt: now,
      version: 1,
    };

    // Note: By default, General Information and Technical / Fabrication Specifications
    // are Quotation-only commercial content and MUST NOT leak into Sales Invoices (PRD § 28, 29, Correction #12)

    // 6. Commit both sides of the link in one authoritative RTDB multi-path update.
    if (options?.activeCompany?.id && firebaseDb) {
      const rootUpdates: Record<string, unknown> = {
        [`companyData/${options.activeCompany.id}/invoices/${invoice.id}`]: sanitizeForFirebase({
          ...invoice,
          companyId: options.activeCompany.id,
          financialYearId: options.financialYearId,
          updatedAt: now,
        }),
        [`companyData/${options.activeCompany.id}/quotations/${quotation.id}/status`]: "converted",
        [`companyData/${options.activeCompany.id}/quotations/${quotation.id}/convertedInvoiceId`]: invoiceId,
        [`companyData/${options.activeCompany.id}/quotations/${quotation.id}/updatedAt`]: now,
      };
      await update(ref(firebaseDb), rootUpdates);
    }

    // Only reconcile local caches after cloud acknowledgement.
    await db().invoices.put(invoice);
    await db().quotations.update(quotation.id, { status: "converted", convertedInvoiceId: invoiceId });

    if (options?.activeCompany?.id) await cacheEntity({
      uid: options.user?.uid || "",
      companyId: options.activeCompany.id,
      entityType: "invoice",
      entityId: invoice.id,
      data: invoice,
      financialYearId: options.financialYearId,
      name: invoice.number,
    });

    // Also update Dexie bms_cache_v1 if company scoped
    if (options?.activeCompany?.id) {
      await cacheEntity({
        uid: options.user?.uid || "",
        companyId: options.activeCompany.id,
        entityType: "quotation",
        entityId: quotation.id,
        data: {
          ...quotation,
          status: "converted",
          convertedInvoiceId: invoiceId,
        },
        name: quotation.number,
      });
    }

    toast.success(`Converted to draft invoice ${number}`);
    return { success: true, invoice, isExisting: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to convert quotation to invoice:", err);
    toast.error(`Conversion failed: ${msg}`);
    return { success: false, error: msg };
  }
}
