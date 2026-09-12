import { db, uid, nextNumber, type Quotation, type Invoice, type LineItem, type ExtraCharge } from "@/lib/db";
import { toast } from "sonner";
import { applyStockDelta } from "@/lib/calc";

export interface QuotationConversionResult {
  success: boolean;
  invoice?: Invoice;
  isExisting?: boolean;
  error?: string;
}

/**
 * Converts a Quotation to an independent Sales Invoice with full fidelity.
 * Idempotent: If quotation is already converted, returns the existing invoice without creating duplicates.
 * Preserves items, specifications, tax, customer snapshot, and extraCharges.
 */
export async function convertQuotationToInvoice(
  quotation: Quotation
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

    // 2. Generate monotonic legal invoice number
    const number = await nextNumber("invoice");
    const now = Date.now();

    // 3. Compute extra charges total accurately
    const extraCharges: ExtraCharge[] = quotation.extraCharges ? [...quotation.extraCharges] : [];
    const extraChargesTotal = extraCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0);

    // 4. Copy line items with full fidelity (description, size, HSN, specs)
    const items: LineItem[] = quotation.items.map((it) => ({
      ...it,
    }));

    // 5. Construct independent invoice
    const invoiceId = uid();
    const invoice: Invoice = {
      id: invoiceId,
      number,
      date: now,
      customerId: quotation.customerId,
      customerSnapshot: quotation.customerSnapshot ? { ...quotation.customerSnapshot } : undefined,
      items,
      subtotal: quotation.subtotal,
      discountTotal: quotation.discountTotal,
      gstTotal: quotation.gstTotal,
      cgstTotal: quotation.gstTotal / 2,
      sgstTotal: quotation.gstTotal / 2,
      igstTotal: 0,
      isIgst: false,
      extraCharges,
      extraChargesTotal,
      roundOff: quotation.roundOff,
      grandTotal: quotation.grandTotal,
      amountPaid: 0,
      balance: quotation.grandTotal,
      status: "unpaid",
      notes: quotation.notes,
      terms: quotation.terms,
      convertedFromQuotationId: quotation.id,
      createdAt: now,
      version: 1,
    };

    // 6. Apply stock deduction for stock-tracked items
    await applyStockDelta(invoice.items, -1);

    // 7. Save to local Dexie database
    await db().invoices.put(invoice);

    // 8. Update quotation status and link convertedInvoiceId idempotently
    await db().quotations.update(quotation.id, {
      status: "converted",
      convertedInvoiceId: invoiceId,
    });

    toast.success(`Converted to invoice ${number}`);
    return { success: true, invoice, isExisting: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to convert quotation to invoice:", err);
    toast.error(`Conversion failed: ${msg}`);
    return { success: false, error: msg };
  }
}
