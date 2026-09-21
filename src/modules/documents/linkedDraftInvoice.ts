import type { Invoice, Quotation } from "../../lib/db";

export function isInvoiceImmutable(invoice: Invoice): boolean {
  return Boolean(invoice.voucherId) || invoice.postingStatus === "posted" || invoice.status !== "draft";
}

export function applyQuotationToLinkedDraft(quotation: Quotation, invoice: Invoice, now = Date.now()): Invoice {
  if (isInvoiceImmutable(invoice)) {
    throw new Error(`Invoice ${invoice.number} is already posted and cannot be overwritten from its quotation.`);
  }
  const extraCharges = (quotation.extraCharges || []).map((charge) => ({ ...charge }));
  return {
    ...invoice,
    customerId: quotation.customerId,
    customerSnapshot: quotation.customerSnapshot,
    billToPartyId: quotation.billToPartyId || quotation.customerId,
    billToSnapshot: quotation.billToSnapshot || quotation.billingAddressSnapshot,
    billingAddressId: quotation.billingAddressId,
    billingAddressSnapshot: quotation.billingAddressSnapshot || quotation.billToSnapshot,
    billingAddress: quotation.billingAddress,
    sameAsBilling: quotation.sameAsBilling !== false,
    shipToPartyId: quotation.shipToPartyId || quotation.customerId,
    shipToPartySnapshot: quotation.shipToPartySnapshot || quotation.shippingAddressSnapshot,
    shippingAddressId: quotation.shippingAddressId,
    shippingAddressSnapshot: quotation.shippingAddressSnapshot || quotation.shipToPartySnapshot,
    shippingAddress: quotation.shippingAddress,
    items: (quotation.items || []).map((item) => ({ ...item })),
    lineSnapshots: [],
    subtotal: quotation.subtotal,
    discountTotal: quotation.discountTotal,
    gstTotal: quotation.gstTotal,
    cgstTotal: quotation.isIgst ? 0 : (quotation.cgstTotal ?? quotation.gstTotal / 2),
    sgstTotal: quotation.isIgst ? 0 : (quotation.sgstTotal ?? quotation.gstTotal / 2),
    igstTotal: quotation.isIgst ? (quotation.igstTotal || quotation.gstTotal) : 0,
    isIgst: Boolean(quotation.isIgst),
    extraCharges,
    extraChargesTotal: extraCharges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0),
    roundOff: quotation.roundOff,
    grandTotal: quotation.grandTotal,
    amountPaid: 0,
    balance: quotation.grandTotal,
    notes: quotation.notes,
    terms: quotation.terms,
    termsSnapshot: quotation.termsSnapshot,
    structuredTermsSnapshot: quotation.structuredTermsSnapshot,
    generalInformationSnapshot: quotation.generalInformationSnapshot,
    generalInfoSnapshot: quotation.generalInformationSnapshot,
    technicalSpecificationSnapshot: quotation.technicalSpecificationSnapshot,
    techSpecSnapshot: quotation.technicalSpecificationSnapshot,
    cabinConfigurationOverride: quotation.cabinConfigurationOverride,
    isCabinConfigCustom: quotation.isCabinConfigCustom,
    includeGeneralInfo: quotation.includeGeneralInfo,
    includeDescriptions: quotation.includeDescriptions,
    bankSnapshot: quotation.bankSnapshot,
    bankDetailsSnapshot: quotation.bankDetailsSnapshot,
    gstCalculationMode: quotation.gstCalculationMode,
    overallGstRate: quotation.overallGstRate,
    status: "draft",
    postingStatus: "draft",
    sourceType: "QUOTATION",
    sourceQuotationId: quotation.id,
    sourceQuotationNumber: quotation.number,
    convertedFromQuotationId: quotation.id,
    sourceQuotationUpdatedAt: quotation.updatedAt || quotation.createdAt,
    updatedAt: now,
  };
}
