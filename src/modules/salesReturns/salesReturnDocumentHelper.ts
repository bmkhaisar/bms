import type { NormalizedDocument } from "@/lib/documentRenderer";
import type { SalesReturn, CreditNote, Customer } from "@/lib/db";
import type { CompanySettings } from "@/lib/db";
import type { CompanySnapshot } from "@/modules/company/types";
import { formatMoney } from "@/lib/format";

export function getSalesReturnNormalizedDoc(
  salesReturn: SalesReturn,
  company?: Partial<CompanySettings | CompanySnapshot | any> | null,
  customer?: Customer | null
): NormalizedDocument {
  const comp = (company || salesReturn.companySnapshot || {}) as Partial<CompanySnapshot>;
  const custSnap = salesReturn.customerSnapshot || customer;

  const party = {
    name: custSnap?.name || "Customer",
    company: custSnap?.company || custSnap?.tradingName,
    address: custSnap?.address || (custSnap as any)?.billingAddress,
    city: custSnap?.city,
    state: custSnap?.state,
    pincode: custSnap?.pincode,
    gstin: custSnap?.gstin,
    pan: custSnap?.pan,
    phone: custSnap?.phone,
    email: custSnap?.email,
    placeOfSupply: salesReturn.placeOfSupplySnapshot || custSnap?.stateCode || custSnap?.state,
  };

  const items = (salesReturn.items || []).map((it, idx) => ({
    id: it.invoiceItemId || `item_${idx + 1}`,
    productId: it.productId || `prod_${idx + 1}`,
    name: it.name || it.productName || "Returned Item",
    description: it.description || ((it.restockOption || it.restockAction) ? `Restock: ${(it.restockOption || it.restockAction).replace(/_/g, " ")}` : undefined),
    hsn: it.hsn,
    quantity: it.returnQuantity,
    unit: it.unit || it.uomLabel || "NOS",
    rate: it.rate,
    discountPct: it.discountPct || 0,
    gstRate: it.gstRate || 0,
    total: it.total ?? it.totalAmount,
    taxable: it.taxableAmount,
    gstAmount: (it.cgstAmount || 0) + (it.sgstAmount || 0) + (it.igstAmount || 0),
  }));

  return {
    kind: "credit_note",
    title: salesReturn.creditNoteNumber ? "CREDIT NOTE" : "SALES RETURN",
    number: salesReturn.creditNoteNumber || salesReturn.number,
    date: salesReturn.date,
    originalInvoiceNumber: salesReturn.originalInvoiceNumber,
    originalInvoiceDate: salesReturn.originalInvoiceDate,
    salesReturnReason: salesReturn.reason || (salesReturn as any).reasonNotes,
    company: comp,
    party,
    items,
    subtotal: salesReturn.subtotal,
    discountTotal: salesReturn.discountTotal || 0,
    cgstTotal: salesReturn.cgstTotal,
    sgstTotal: salesReturn.sgstTotal,
    igstTotal: salesReturn.igstTotal,
    gstTotal: salesReturn.gstTotal,
    roundOff: salesReturn.roundOff || 0,
    grandTotal: salesReturn.grandTotal,
    enableGst: true,
    notes: salesReturn.notes,
  };
}
