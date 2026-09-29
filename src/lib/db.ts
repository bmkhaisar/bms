import Dexie, { type Table } from "dexie";

export type ID = string;

export interface CompanySettings {
  id: "singleton" | string;
  name: string;
  legalName?: string;
  logo?: string; // data URL
  logoUrl?: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  mobile: string;
  altMobile?: string;
  email: string;
  website?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  bankName?: string;
  bankAccount?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiId?: string;
  terms?: string;
  quotationGeneralInfoMarkdown?: string;
  quotationTechnicalSpecsMarkdown?: string;
  quotationTermsMarkdown?: string;
  invoiceTermsMarkdown?: string;
  invoiceGeneralInfoMarkdown?: string;
  invoiceTechnicalSpecsMarkdown?: string;
  quotationClosingMessage?: string;
  showQuotationGeneralInfo?: boolean;
  showInvoiceGeneralInfo?: boolean;
  showQuotationTechnicalSpecs?: boolean;
  showInvoiceTechnicalSpecs?: boolean;
  showQuotationTerms?: boolean;
  showInvoiceTerms?: boolean;
  showQuotationBankDetails?: boolean;
  showInvoiceBankDetails?: boolean;
  accountHolderName?: string;
  bankAccountHolderName?: string;
  bankAccountType?: string;
  bankSwiftCode?: string;
  declaration?: string;
  authorizedSignatory?: string;
  designation?: string;
  signature?: string; // data URL
  signatureUrl?: string;
  signatureMode?: any;
  typedSignatureStyle?: any;
  stamp?: string; // data URL
  stampUrl?: string;
  stampMode?: any;
  showSignature?: boolean;
  showStamp?: boolean;
  showSignatoryName?: boolean;
  showDesignation?: boolean;
  showSignatureDate?: boolean;
  signatureDateMode?: any;
  customSignatureDate?: any;
  currency: string;
  currencySymbol: string;
  invoicePrefix: string;
  quotationPrefix: string;
  receiptPrefix: string;
  purchasePrefix: string;
  creditNotePrefix?: string;
  salesReturnPrefix?: string;
  nextInvoiceNo: number;
  nextQuotationNo: number;
  nextReceiptNo: number;
  nextPurchaseNo: number;
  nextCreditNoteNo?: number;
  nextSalesReturnNo?: number;
  defaultCountry?: string;
  defaultState?: string;
  defaultPincode?: string;
  advancePartyPolicy?: "STRICT" | "WARN_AND_ALLOW" | "MANAGER_OVERRIDE";
  creditLimitPolicy?: "WARN" | "BLOCK" | "MANAGER_APPROVAL";
  sessionPolicy?: "persistent" | "idle" | "strict";
  supplierInvoiceNumberPolicy?: "OPTIONAL" | "REQUIRED";
  defaultShareCcEmail?: string;
}

export type PartyType =
  | "SUNDRY_DEBTORS"
  | "SUNDRY_CREDITORS"
  | "SUNDRY_DEBTOR"
  | "SUNDRY_CREDITOR"
  | "CUSTOMER"
  | "SUPPLIER"
  | "BOTH";

export type PaymentPolicy = "ADVANCE" | "CREDIT";

export function isSundryDebtor(partyType?: PartyType | string): boolean {
  if (!partyType) return true;
  return (
    partyType === "SUNDRY_DEBTORS" ||
    partyType === "SUNDRY_DEBTOR" ||
    partyType === "CUSTOMER" ||
    partyType === "BOTH"
  );
}

export function isSundryCreditor(partyType?: PartyType | string): boolean {
  if (!partyType) return false;
  return (
    partyType === "SUNDRY_CREDITORS" ||
    partyType === "SUNDRY_CREDITOR" ||
    partyType === "SUPPLIER" ||
    partyType === "BOTH"
  );
}

export function normalizePartyType(
  partyType?: PartyType | string
): "SUNDRY_DEBTOR" | "SUNDRY_CREDITOR" | "BOTH" {
  if (
    partyType === "SUNDRY_CREDITORS" ||
    partyType === "SUNDRY_CREDITOR" ||
    partyType === "SUPPLIER"
  ) {
    return "SUNDRY_CREDITOR";
  }
  if (partyType === "BOTH") {
    return "BOTH";
  }
  return "SUNDRY_DEBTOR";
}

export function getPartyTypeLabel(partyType?: PartyType | string): string {
  if (
    partyType === "SUNDRY_CREDITORS" ||
    partyType === "SUNDRY_CREDITOR" ||
    partyType === "SUPPLIER"
  ) {
    return "Supplier";
  }
  if (partyType === "BOTH") {
    return "Customer & Supplier";
  }
  return "Customer";
}

export interface PartyAddress {
  id: string;
  label: string; // "Billing Address" | "Shipping Address" | "Site Address" | "Branch Address" | "Other Address"
  addressLine1: string;
  addressLine2?: string;
  city: string;
  district?: string;
  state: string;
  stateCode?: string;
  country: string; // Mandatory per PRD § 5
  pincode: string; // Mandatory per PRD § 5
  contactPerson?: string;
  phone?: string;
  isDefaultBilling?: boolean;
  isDefaultShipping?: boolean;
}

export interface AddressSnapshot {
  name?: string;
  partyName?: string;
  tradingName?: string;
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
  stateCode?: string;
  country?: string;
  pincode?: string;
  contactPerson?: string;
  phone?: string;
}

export interface Party {
  id: ID;
  /** Human-readable, immutable company-scoped reference (CUS-000001 / SUP-000001). */
  partyCode?: string;
  name: string;
  tradingName?: string;
  partyType?: PartyType;
  mobile?: string;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  company?: string;
  address?: string; // primary address
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  district?: string;
  state?: string;
  stateCode?: string;
  country?: string; // PRD § 5: Country mandatory
  pincode?: string; // PRD § 5: Pincode mandatory
  contactPerson?: string;
  addresses?: PartyAddress[];
  defaultBillingAddressId?: string;
  defaultShippingAddressId?: string;
  openingBalance: number;
  ledgerId?: string;
  apLedgerId?: string;
  creditLimit?: number;
  creditDays?: number;
  paymentPolicy?: PaymentPolicy; // PRD § 10: ADVANCE | CREDIT
  advanceBalancePaise?: number; // Cached available advance in paise
  outstandingPaise?: number; // Cached AR exposure in paise
  aliases?: string[];
  notes?: string;
  taxRegistrationType?: "regular" | "composition" | "unregistered";
  createdAt: number;
  updatedAt?: number;
  active?: boolean;
}

export interface Customer extends Party {
  // Retains full backward compatibility with Customer code
}

export interface Supplier extends Party {
  // Retains full backward compatibility with Supplier code
}

export interface Category { id: ID; name: string; createdAt: number; }

export type PricingBasis = "per_unit" | "per_area" | "per_length" | "per_weight" | "fixed";
export type ProductType = "stock_item" | "service" | "non_stock_item";

export interface Product {
  id: ID; name: string; sku?: string; categoryId?: ID; unit: string; hsn?: string;
  gstRate: number; purchasePrice: number; sellingPrice: number;
  openingStock: number; currentStock: number; reorderLevel: number;
  trackInventory?: boolean; // When false, stock movements are omitted (services, digital goods)
  description?: string;
  defaultDescription?: string;
  specifications?: string;
  defaultSizes?: string[];
  createdAt: number;
  normalizedName?: string;
  aliases?: string[];
  productType?: ProductType;
  pricingBasis?: PricingBasis;
  defaultUomId?: string;
  defaultSalesRatePaise?: number;
  defaultPurchaseRatePaise?: number;
  lastSalesRatePaise?: number;
  lastPurchaseRatePaise?: number;
  taxProfileId?: string;
  active?: boolean;
}

export interface MeasurementEntry {
  width: number;
  height: number;
  pieces: number;
  unit?: string;
  totalArea?: number;
}

export interface LineItem {
  id?: string;
  productId: ID; name: string; productName?: string; description?: string; sku?: string; hsn?: string;
  quantity: number; unit: string; uomId?: string; uomLabel?: string;
  rate: number; ratePaise?: number; discountPct: number; discountPercent?: number;
  gstRate: number; taxRate?: number; cessRate?: number; taxTreatment?: string;
  taxable: number; gstAmount: number; total: number; lineAmount?: number;
  isTaxInclusive?: boolean;
  size?: string;
  /** Frozen structured dimensions used to produce `size`; historical documents never re-read product preferences. */
  sizeSnapshot?: SizeSnapshot;
  productNameSnapshot?: string;
  descriptionSnapshot?: string;
  uomSnapshot?: string;
  rateSnapshot?: number;
  taxSnapshot?: TaxSnapshot;
  pricingBasis?: PricingBasis;
  measurements?: MeasurementEntry[];
  measurementSummary?: string;
  saveToMaster?: boolean;
}

export interface TaxSnapshot {
  taxRegistrationMode?: string;
  documentType?: string;
  supplierGstin?: string;
  customerGstin?: string;
  companyStateCode?: string;
  placeOfSupply?: string;
  isInterState?: boolean;
  grossLineValue?: number;
  lineDiscount?: number;
  documentDiscount?: number;
  taxableValue?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  otherTax?: number;
  taxableCharges?: number;
  nonTaxableCharges?: number;
  taxableAmountPaise?: number;
  taxRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  cessRate?: number;
  cgstAmountPaise?: number;
  sgstAmountPaise?: number;
  igstAmountPaise?: number;
  cessAmountPaise?: number;
  taxAmountPaise?: number;
  isIgst?: boolean;
  isTaxInclusive?: boolean;
  lines?: any[];
  [key: string]: any;
}

export interface ExtraCharge {
  label?: string;
  name?: string;
  amount: number;
  isTaxable?: boolean;
  taxRate?: number;
}

export interface Quotation {
  id: ID; number: string; date: number;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  validity?: number; // ms timestamp
  preparedBy?: string;
  siteLocation?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  customerId: ID; customerSnapshot?: Partial<Customer>;
  items: LineItem[];
  lineSnapshots?: LineItem[];
  subtotal: number; discountTotal: number; gstTotal: number;
  cgstTotal?: number; sgstTotal?: number; igstTotal?: number; isIgst?: boolean;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  roundOff: number; grandTotal: number;
  notes?: string; terms?: string;
  status: "draft" | "sent" | "accepted" | "converted" | "rejected" | "cancelled" | "voided" | "deleted";
  createdAt: number;
  updatedAt?: number;
  billToPartyId?: string;
  billToSnapshot?: AddressSnapshot;
  shipToPartyId?: string;
  shipToPartySnapshot?: AddressSnapshot;
  shippingAddressId?: string;
  sameAsBilling?: boolean;
  billingAddressId?: string;
  billingAddress?: string;
  shippingAddress?: string;
  // Canonical Snapshots at time of save/finalization (PRD § 1, 15, 16)
  billingAddressSnapshot?: AddressSnapshot;
  shippingAddressSnapshot?: AddressSnapshot;
  /** Canonical General Information snapshot. generalInfoSnapshot is legacy read-alias. */
  generalInformationSnapshot?: GeneralInfoField[];
  generalInfoSnapshot?: GeneralInfoField[];
  /** Canonical Technical Specification snapshot. techSpecSnapshot is legacy read-alias. */
  technicalSpecificationSnapshot?: TechSpecSection[];
  techSpecSnapshot?: TechSpecSection[];
  electricalSnapshot?: TechSpecSection[];
  /** Canonical Terms snapshot. structuredTermsSnapshot is legacy read-alias. */
  termsSnapshot?: string[];
  structuredTermsSnapshot?: any[];
  /** Canonical Bank snapshot. bankDetailsSnapshot is legacy read-alias. */
  bankSnapshot?: BankAccount;
  bankDetailsSnapshot?: BankAccount;
  templateId?: ID;
  convertedInvoiceId?: ID;
  companySnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  // Options & Structured Features
  gstCalculationMode?: "item_wise" | "overall";
  overallGstRate?: number;
  includeGeneralInfo?: boolean;
  includeTechSpecs?: boolean;
  includeTerms?: boolean;
  includeBankDetails?: boolean;
  structuredSections?: QuotationSection[];
  structuredTerms?: StructuredTermItem[];
  visibilitySnapshot?: {
    showGeneralInfo?: boolean;
    showTechSpecs?: boolean;
    showTerms?: boolean;
    showBankDetails?: boolean;
  };
  generalInformationMarkdown?: string;
  technicalSpecsMarkdown?: string;
  termsMarkdown?: string;
  closingMessage?: string;
  // References
  generalInfoTemplateId?: ID;
  techSpecTemplateId?: ID;
  termsTemplateId?: ID;
  bankAccountId?: ID;
  cabinConfigurationOverride?: string;
  isCabinConfigCustom?: boolean;
  includeDescriptions?: boolean;
}

export interface Invoice {
  id: ID; number: string; date: number; dueDate?: number; creditDaysSnapshot?: number;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  customerId: ID; customerSnapshot?: Partial<Customer>;
  companySnapshot?: any;
  taxSnapshot?: TaxSnapshot;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  placeOfSupply?: string;
  billToPartyId?: string;
  billToSnapshot?: AddressSnapshot;
  shipToPartyId?: string;
  shipToPartySnapshot?: AddressSnapshot;
  shippingAddressId?: string;
  sameAsBilling?: boolean;
  billingAddress?: string; shippingAddress?: string;
  billingAddressId?: string;
  billingAddressSnapshot?: AddressSnapshot;
  shippingAddressSnapshot?: AddressSnapshot;
  items: LineItem[];
  lineSnapshots?: LineItem[];
  subtotal: number; discountTotal: number;
  taxableAmount?: number;
  cgstTotal: number; sgstTotal: number; igstTotal: number;
  cessTotal?: number;
  gstTotal: number; roundOff: number; grandTotal: number;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  amountPaid: number; balance: number; isIgst: boolean;
  advanceAllocatedPaise?: number;
  customerCreditAppliedPaise?: number;
  advanceAllocations?: {
    receiptId: string;
    receiptNumber: string;
    amountPaise: number;
    advanceTaxAdjustedPaise?: number;
    supplyType?: string;
    taxTreatment?: string;
  }[];
  advanceTaxPreviouslyAccounted?: number;
  advanceGstAdjustedPaise?: number;
  advanceGstAdjusted?: number;
  notes?: string; terms?: string;
  termsSnapshot?: string[];
  termsMarkdown?: string;
  structuredTerms?: StructuredTermItem[];
  structuredTermsSnapshot?: any[];
  termsTemplateId?: ID;
  generalInfoTemplateId?: ID;
  techSpecTemplateId?: ID;
  includeTerms?: boolean;
  includeBankDetails?: boolean;
  includeGeneralInfo?: boolean;
  includeTechSpecs?: boolean;
  includeDescriptions?: boolean;
  cabinConfigurationOverride?: string;
  isCabinConfigCustom?: boolean;
  /** Canonical General Information snapshot. generalInfoSnapshot is legacy read-alias. */
  generalInformationSnapshot?: GeneralInfoField[];
  generalInfoSnapshot?: GeneralInfoField[];
  /** Canonical Technical Specification snapshot. */
  technicalSpecificationSnapshot?: TechSpecSection[];
  techSpecSnapshot?: TechSpecSection[];
  structuredSections?: QuotationSection[];
  bankAccountId?: ID;
  /** Canonical Bank snapshot. bankDetailsSnapshot is legacy read-alias. */
  bankSnapshot?: BankAccount;
  bankDetailsSnapshot?: BankAccount;
  visibilitySnapshot?: {
    showTerms?: boolean;
    showBankDetails?: boolean;
    showGeneralInfo?: boolean;
    showTechSpecs?: boolean;
  };
  paymentMode?: "cash" | "bank" | "cheque" | "credit";
  deliveryNote?: string;
  supplierRef?: string;
  otherReferences?: string;
  despatchDocNo?: string;
  despatchedThrough?: string;
  destination?: string;
  billOfLadingNo?: string;
  motorVehicleNo?: string;
  eWayBillNo?: string;
  gstCalculationMode?: "item_wise" | "overall";
  overallGstRate?: number;
  status: "draft" | "unpaid" | "partial" | "paid" | "posted" | "cancelled" | "voided" | "deleted";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  /** Immutable document provenance. Direct invoices never pretend to originate from quotations. */
  sourceType?: "DIRECT" | "QUOTATION";
  sourceQuotationId?: ID;
  sourceQuotationNumber?: string;
  /** Quotation revision last explicitly applied to this draft invoice. */
  sourceQuotationUpdatedAt?: number;
  convertedFromQuotationId?: ID;
  version?: number;
  amendedFromId?: ID;
  originalDocumentId?: ID;
  correctedInvoiceId?: ID;
  supersededByInvoiceId?: ID;
  correctionReason?: string;
  reversalVoucherId?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Receipt {
  id: ID; number: string; date: number; customerId: ID; partyId?: ID; invoiceId?: ID;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  amount: number; mode: "cash" | "bank" | "upi" | "cheque" | "other";
  paymentMethod?: string;
  chequeNumber?: string;
  chequeDate?: number | string;
  settlementLedgerId?: string;
  voucherId?: string;
  receiptVoucherId?: string;
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed" | "refunded";
  companySnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  reference?: string;
  referenceNumber?: string;
  notes?: string;
  narration?: string;
  createdAt: number;
  allocationType?: "ADVANCE" | "AGAINST_REF" | "ON_ACCOUNT";
  referenceType?: "ADVANCE" | "AGAINST_REF" | "ON_ACCOUNT";
  allocatedInvoices?: {
    invoiceId: string;
    invoiceNumber: string;
    amountPaise: number;
    advanceTaxAdjustedPaise?: number;
  }[];
  advanceAvailablePaise?: number;
  customerCreditPaise?: number;
  unappliedCreditPaise?: number;

  // PRD Addendum § 5: Frozen Advance Tax & Audit Snapshot
  supplyType?: "GOODS" | "SERVICES" | "MIXED" | "UNSPECIFIED";
  taxTreatment?: "NO_ADVANCE_GST" | "ADVANCE_GST" | "PENDING_CLASSIFICATION" | "NO_GST";
  taxProfileSnapshot?: {
    gstRate: number;
    cessRate?: number;
    isTaxInclusive?: boolean;
    hsn?: string;
    taxTreatment?: string;
  };
  placeOfSupplySnapshot?: string;
  advanceAmountPaise?: number;
  taxableAmountPaise?: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  totalTaxPaise?: number;
  mixedBreakdown?: {
    goodsAmountPaise: number;
    serviceAmountPaise: number;
    serviceTaxablePaise: number;
    serviceTaxPaise: number;
  };

  // PRD Addendum § 10: Refund & Reversal Tracking
  refundVoucherId?: string;
  refundDate?: number;
  refundAmountPaise?: number;
  refundTaxReversedPaise?: number;
  refundReason?: string;
}

export interface Payment {
  id: ID; number: string; date: number; supplierId: ID; purchaseId?: ID;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  amount: number; mode: "cash" | "bank" | "upi" | "cheque" | "other";
  paymentMethod?: string;
  chequeNumber?: string;
  chequeDate?: number | string;
  settlementLedgerId?: string;
  voucherId?: string;
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  companySnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  reference?: string; notes?: string; narration?: string; createdAt: number;
  allocatedPurchases?: {
    purchaseId: string;
    purchaseNumber: string;
    amountPaise: number;
  }[];
}

export interface Purchase {
  id: ID; number: string; date: number; supplierId: ID;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: number | string;
  supplierSnapshot?: Partial<Supplier>;
  companySnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  items: LineItem[];
  lineSnapshots?: LineItem[];
  subtotal: number; discountTotal: number;
  cgstTotal?: number; sgstTotal?: number; igstTotal?: number;
  gstTotal: number;
  roundOff: number; grandTotal: number;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  amountPaid: number; balance: number;
  notes?: string; status: "draft" | "unpaid" | "partial" | "paid" | "cancelled" | "voided" | "deleted";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  version?: number;
  amendedFromId?: ID;
  originalDocumentId?: ID;
  correctedPurchaseId?: ID;
  supersededByPurchaseId?: ID;
  correctionReason?: string;
  reversalVoucherId?: string;
  createdAt: number;
  updatedAt?: number;
}

// --- Sales Returns & Credit Notes (PRD §§ 20-28) ---
export type SalesReturnReason =
  | "Defective"
  | "Damaged"
  | "Wrong Item"
  | "Customer Return"
  | "Price Adjustment"
  | "Other";

export type RestockAction =
  | "RESTOCK_SALEABLE"
  | "RESTOCK_DAMAGED"
  | "FINANCIAL_CREDIT_ONLY";

export interface SalesReturnItem {
  id: ID;
  invoiceItemId: string;
  productId: ID;
  productName: string;
  name?: string;
  description?: string;
  sku?: string;
  hsn?: string;
  uomId?: string;
  uomLabel?: string;
  unit?: string;
  invoicedQuantity: number;
  previouslyReturnedQuantity: number;
  returnQuantity: number;
  rate: number;
  ratePaise: number;
  discountPct: number;
  gstRate: number;
  isInterState: boolean;
  taxableAmount: number;
  taxablePaise: number;
  cgstAmount: number;
  cgstPaise: number;
  sgstAmount: number;
  sgstPaise: number;
  igstAmount: number;
  igstPaise: number;
  totalAmount: number;
  total?: number;
  totalPaise: number;
  reason: SalesReturnReason;
  reasonNotes?: string;
  restockAction: RestockAction;
  restockOption?: RestockAction;
}

export interface SalesReturn {
  id: ID;
  number: string; // e.g. SR/2026-27/0001
  creditNoteNumber: string; // e.g. CN/2026-27/0001
  creditNoteId?: string;
  date: number;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  customerId: ID;
  customerSnapshot?: Partial<Customer>;
  originalInvoiceId: ID;
  originalInvoiceNumber: string;
  originalInvoiceDate: number;
  returnType: "FULL" | "PARTIAL";
  reason?: string;
  placeOfSupplySnapshot?: string;
  items: SalesReturnItem[];
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  roundOff: number;
  grandTotal: number;
  notes?: string;
  status: "draft" | "posted" | "reversed" | "cancelled" | "voided" | "deleted";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  customerCreditCreated?: number;
  customerCreditGeneratedPaise?: number;
  customerCreditAllocatedPaise?: number;
  outstandingReducedPaise?: number;
  companySnapshot?: any;
  signatorySnapshot?: any;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
}

export interface CreditNote {
  id: ID;
  number: string;
  salesReturnId: ID;
  originalInvoiceId: ID;
  originalInvoiceNumber: string;
  originalInvoiceDate: number;
  date: number;
  companyId?: ID;
  branchId?: ID;
  branchSnapshot?: any;
  financialYearId?: ID;
  customerId: ID;
  customerSnapshot?: Partial<Customer>;
  items: SalesReturnItem[];
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  roundOff: number;
  grandTotal: number;
  reason: SalesReturnReason;
  notes?: string;
  voucherId?: string;
  status: "draft" | "posted" | "reversed" | "cancelled";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  companySnapshot?: any;
  signatorySnapshot?: any;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
}


// --- New masters & Structured Presentation Models (PRD §§ 4, 11, 20, 25, 31) ---
export interface SizeSnapshot {
  label: string;
  length?: number;
  width?: number;
  height?: number;
  unit?: string;
}

export interface SizePreset { id: ID; label: string; createdAt: number; }

/** Company-scoped product size memory. It is a preference only; documents freeze a LineItem snapshot. */
export interface ProductSizePreference extends SizeSnapshot {
  id: ID;
  productId: ID;
  usageCount: number;
  lastUsedAt: number;
  isFavorite?: boolean;
  isDefault?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export type ValueType = "TEXT" | "MULTILINE" | "BULLET_LIST";

export interface SectionRow {
  id: string;
  label: string;
  valueType?: ValueType;
  value: string;
  bullets?: string[];
  order?: number;
}

export interface QuotationSection {
  id: string;
  type: "GENERAL_INFO" | "SPEC_TABLE";
  title: string;
  subtitle?: string;
  order: number;
  rows: SectionRow[];
}

export type TermFormat = "NUMBERED" | "BULLET" | "PARAGRAPH";

export interface StructuredTermItem {
  id: string;
  order: number;
  text: string;
  format?: TermFormat;
  emphasis?: boolean;
}

export interface StructuredTermsSection {
  title: string;
  items: StructuredTermItem[];
}

export interface TermItem { id: string; text: string; enabled: boolean; }
export interface TermsTemplate {
  id: ID; name: string; kind?: "quotation" | "invoice"; isDefault?: boolean;
  terms: TermItem[]; structuredTerms?: StructuredTermItem[]; createdAt: number;
}

export interface GeneralInfoField { key?: string; label: string; value: string; }
export interface GeneralInfoTemplate {
  id: ID; name: string; isDefault?: boolean; fields: GeneralInfoField[]; createdAt: number;
}

export interface TechSpecRow { label: string; value: string; }
export interface TechSpecSection { title: string; subtitle?: string; rows: TechSpecRow[]; }
export interface TechSpecTemplate {
  id: ID; name: string; kind?: "technical" | "electrical"; isDefault?: boolean;
  sections: TechSpecSection[]; createdAt: number;
}

export interface BankAccount {
  id: ID;
  bankName: string;
  accountName: string;
  accountHolderName?: string;
  accountNo: string;
  ifsc: string;
  branch?: string;
  accountType?: string;
  upi?: string;
  swift?: string;
  isDefault?: boolean;
  createdAt: number;
}

export interface QuotationTemplate {
  id: ID; name: string; isDefault?: boolean;
  accent: string; // hex
  fontFamily: string; // 'Helvetica' | 'Times' | 'Courier'
  showLogo: boolean;
  headerText?: string;
  footerText?: string;
  tableStyle: "grid" | "striped" | "plain";
  createdAt: number;
}

export interface SavedReportView {
  id: string;
  uid?: string;
  companyId?: string;
  name: string;
  tab: string;
  from?: number;
  to?: number;
  preset?: string;
  createdAt: number;
}

class BizDB extends Dexie {
  companySettings!: Table<CompanySettings, string>;
  customers!: Table<Customer, ID>;
  suppliers!: Table<Supplier, ID>;
  categories!: Table<Category, ID>;
  products!: Table<Product, ID>;
  quotations!: Table<Quotation, ID>;
  invoices!: Table<Invoice, ID>;
  receipts!: Table<Receipt, ID>;
  purchases!: Table<Purchase, ID>;
  payments!: Table<Payment, ID>;
  sizes!: Table<SizePreset, ID>;
  productSizes!: Table<ProductSizePreference, ID>;
  termsTemplates!: Table<TermsTemplate, ID>;
  generalInfoTemplates!: Table<GeneralInfoTemplate, ID>;
  techSpecTemplates!: Table<TechSpecTemplate, ID>;
  bankAccounts!: Table<BankAccount, ID>;
  quotationTemplates!: Table<QuotationTemplate, ID>;
  parties!: Table<Party, ID>;
  salesReturns!: Table<SalesReturn, ID>;
  creditNotes!: Table<CreditNote, ID>;
  branches!: Table<any, ID>;

  constructor() {
    super("bms_db_v1");
    this.version(1).stores({
      companySettings: "id",
      customers: "id, name, createdAt",
      suppliers: "id, name, createdAt",
      categories: "id, name",
      products: "id, name, categoryId, createdAt",
      quotations: "id, number, date, customerId, createdAt",
      invoices: "id, number, date, customerId, status, createdAt",
      receipts: "id, number, date, customerId, invoiceId, createdAt",
      purchases: "id, number, date, supplierId, createdAt",
    });
    this.version(2).stores({
      sizes: "id, label, createdAt",
      termsTemplates: "id, name, createdAt",
      generalInfoTemplates: "id, name, createdAt",
      techSpecTemplates: "id, name, kind, createdAt",
      bankAccounts: "id, bankName, createdAt",
      quotationTemplates: "id, name, createdAt",
    });
    this.version(3).stores({
      parties: "id, name, partyType, paymentPolicy, createdAt",
    });
    this.version(4).stores({
      payments: "id, number, date, supplierId, createdAt",
    });
    this.version(5).stores({
      purchases: "id, number, date, supplierId, supplierInvoiceNumber, createdAt",
      parties: "id, name, partyType, paymentPolicy, createdAt",
    });
    this.version(6).stores({
      productSizes: "id, productId, [productId+label], lastUsedAt, usageCount, createdAt",
    });
    this.version(7).stores({
      salesReturns: "id, number, creditNoteNumber, originalInvoiceId, customerId, branchId, date, status, createdAt",
      creditNotes: "id, number, salesReturnId, originalInvoiceId, customerId, branchId, date, status, createdAt",
      branches: "id, code, name, isMainBranch, active, createdAt",
      invoices: "id, number, date, customerId, branchId, status, createdAt",
      quotations: "id, number, date, customerId, branchId, createdAt",
      receipts: "id, number, date, customerId, branchId, invoiceId, createdAt",
      purchases: "id, number, date, supplierId, branchId, supplierInvoiceNumber, createdAt",
      payments: "id, number, date, supplierId, branchId, createdAt",
    });
    // Forward-only compatibility bridge: If an existing staging browser opened earlier v8 build,
    // dynamically register version 8 with zero schema changes so Dexie opens without IndexedDB VersionError.
    // Invariant: Zero application features depend on legacy bms_db_v1.
    const forwardCompatVerno = 7 + 1;
    this.version(forwardCompatVerno).stores({});
  }
}

let _db: BizDB | null = null;
export function db(): BizDB {
  if (typeof window === "undefined") throw new Error("db() called on server");
  if (!_db) _db = new BizDB();
  return _db;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const DEFAULT_COMPANY: CompanySettings = {
  id: "singleton", name: "Your Company", address: "", mobile: "", email: "",
  currency: "INR", currencySymbol: "₹",
  invoicePrefix: "INV-", quotationPrefix: "QT-", receiptPrefix: "RCP-", purchasePrefix: "PUR-",
  nextInvoiceNo: 1, nextQuotationNo: 1, nextReceiptNo: 1, nextPurchaseNo: 1,
  defaultCountry: "India",
  defaultState: "Maharashtra",
  advancePartyPolicy: "STRICT",
  creditLimitPolicy: "WARN",
  sessionPolicy: "persistent",
  terms: "1. Goods once sold will not be taken back.\n2. Interest @18% p.a. will be charged on overdue bills.",
  declaration: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
};

export async function getCompany(companyId?: string): Promise<CompanySettings> {
  if (companyId) {
    const scoped = await db().companySettings.get(companyId);
    if (scoped) return scoped;
  }
  const existing = await db().companySettings.get("singleton");
  if (existing) return existing;
  await db().companySettings.put(DEFAULT_COMPANY);
  return DEFAULT_COMPANY;
}

export async function nextNumber(
  kind: "invoice" | "quotation" | "receipt" | "purchase" | "credit_note" | "sales_return",
): Promise<string> {
  const c = await getCompany();
  const key =
    kind === "invoice"
      ? "nextInvoiceNo"
      : kind === "quotation"
      ? "nextQuotationNo"
      : kind === "receipt"
      ? "nextReceiptNo"
      : kind === "purchase"
      ? "nextPurchaseNo"
      : kind === "credit_note"
      ? "nextCreditNoteNo"
      : "nextSalesReturnNo";

  const prefix =
    kind === "invoice"
      ? c.invoicePrefix
      : kind === "quotation"
      ? c.quotationPrefix
      : kind === "receipt"
      ? c.receiptPrefix
      : kind === "purchase"
      ? c.purchasePrefix
      : kind === "credit_note"
      ? c.creditNotePrefix || "CN-"
      : c.salesReturnPrefix || "SR-";

  const n = ((c as any)[key] as number) || 1;
  const next = { ...c, [key]: n + 1 };
  await db().companySettings.put(next);
  return `${prefix}${String(n).padStart(4, "0")}`;
}
