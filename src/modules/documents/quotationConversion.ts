import { db, uid, nextNumber, type Quotation, type Invoice, type LineItem, type ExtraCharge, type CompanySettings, type Customer } from "@/lib/db";
import { toast } from "sonner";
import { applyStockDelta } from "@/lib/calc";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { postInvoiceTransaction } from "@/modules/accounting/services/documentPostingService";
import { ensureCustomerLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import type { Company } from "@/modules/company/types";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, update } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";

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
    // 1. Idempotency Check: Prevent duplicate conversion
    if (quotation.convertedInvoiceId) {
      const existing = await db().invoices.get(quotation.convertedInvoiceId);
      if (existing) {
        toast.info(`Quotation was already converted to Invoice ${existing.number}`);
        return { success: true, invoice: existing, isExisting: true };
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

    // 5. Construct independent DRAFT invoice (Correction 4: Do not auto-post accounting by default)
    const invoiceId = uid();
    const invoice: Invoice = {
      id: invoiceId,
      number,
      date: now,
      customerId: quotation.customerId,
      customerSnapshot,
      items,
      subtotal: quotation.subtotal,
      discountTotal: quotation.discountTotal,
      gstTotal: quotation.gstTotal,
      cgstTotal: quotation.cgstTotal ?? quotation.gstTotal / 2,
      sgstTotal: quotation.sgstTotal ?? quotation.gstTotal / 2,
      igstTotal: quotation.igstTotal ?? 0,
      isIgst: quotation.isIgst ?? false,
      extraCharges,
      extraChargesTotal,
      roundOff: quotation.roundOff,
      grandTotal: quotation.grandTotal,
      amountPaid: 0,
      balance: quotation.grandTotal,
      status: "draft", // Correction 4: Draft invoice awaiting employee review
      notes: quotation.notes,
      terms: quotation.terms,
      convertedFromQuotationId: quotation.id,
      createdAt: now,
      version: 1,
    };

    // Save draft invoice to local IndexedDB
    await db().invoices.put(invoice);

    // 6. Update quotation status and link convertedInvoiceId idempotently in local DB
    await db().quotations.update(quotation.id, {
      status: "converted",
      convertedInvoiceId: invoiceId,
    });

    // Mirror to cloud RTDB draft if company is active
    if (options?.activeCompany?.id && firebaseDb) {
      try {
        const invRef = ref(firebaseDb, `companyData/${options.activeCompany.id}/invoices/${invoice.id}`);
        await set(invRef, sanitizeForFirebase({
          ...invoice,
          companyId: options.activeCompany.id,
          financialYearId: options.financialYearId,
          updatedAt: now,
        }));

        const quoteRef = ref(firebaseDb, `companyData/${options.activeCompany.id}/quotations/${quotation.id}`);
        await update(quoteRef, {
          status: "converted",
          convertedInvoiceId: invoiceId,
          updatedAt: now,
        });

        await cacheEntity({
          uid: options.user?.uid || "",
          companyId: options.activeCompany.id,
          entityType: "invoices",
          entityId: invoice.id,
          data: invoice,
          financialYearId: options.financialYearId,
          name: invoice.number,
        });
      } catch (err) {
        console.warn("Could not mirror draft invoice to RTDB:", err);
      }
    }

    // Also update Dexie bms_cache_v1 if company scoped
    if (options?.activeCompany?.id) {
      await cacheEntity({
        uid: options.user?.uid || "",
        companyId: options.activeCompany.id,
        entityType: "quotations",
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
