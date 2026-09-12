import Dexie, { type Table } from "dexie";

export type ID = string;

export interface CompanySettings {
  id: "singleton";
  name: string;
  logo?: string; // data URL
  address: string;
  mobile: string;
  altMobile?: string;
  email: string;
  website?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  bankName?: string;
  bankAccount?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiId?: string;
  terms?: string;
  declaration?: string;
  authorizedSignatory?: string;
  signature?: string; // data URL
  stamp?: string; // data URL
  currency: string;
  currencySymbol: string;
  invoicePrefix: string;
  quotationPrefix: string;
  receiptPrefix: string;
  purchasePrefix: string;
  nextInvoiceNo: number;
  nextQuotationNo: number;
  nextReceiptNo: number;
  nextPurchaseNo: number;
  defaultCountry?: string;
  defaultState?: string;
  defaultPincode?: string;
  advancePartyPolicy?: "STRICT" | "WARN_AND_ALLOW" | "MANAGER_OVERRIDE";
  creditLimitPolicy?: "WARN" | "BLOCK" | "MANAGER_APPROVAL";
  sessionPolicy?: "persistent" | "idle" | "strict";
}

export type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";
export type PaymentPolicy = "ADVANCE" | "CREDIT";

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
  tradingName?: string;
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string;
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
  productId: ID; name: string; productName?: string; description?: string; sku?: string; hsn?: string;
  quantity: number; unit: string; uomId?: string; uomLabel?: string;
  rate: number; ratePaise?: number; discountPct: number; discountPercent?: number;
  gstRate: number; taxRate?: number; cessRate?: number; taxTreatment?: string;
  taxable: number; gstAmount: number; total: number; lineAmount?: number;
  isTaxInclusive?: boolean;
  size?: string;
  pricingBasis?: PricingBasis;
  measurements?: MeasurementEntry[];
  measurementSummary?: string;
  saveToMaster?: boolean;
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
  status: "draft" | "sent" | "accepted" | "converted" | "rejected";
  createdAt: number;
  billingAddressId?: string;
  billingAddress?: string;
  shippingAddress?: string;
  // Snapshots at time of save
  billingAddressSnapshot?: AddressSnapshot;
  shippingAddressSnapshot?: AddressSnapshot;
  generalInfoSnapshot?: GeneralInfoField[];
  techSpecSnapshot?: TechSpecSection[];
  electricalSnapshot?: TechSpecSection[];
  termsSnapshot?: string[];
  bankSnapshot?: BankAccount;
  templateId?: ID;
  convertedInvoiceId?: ID;
  companySnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  // References
  generalInfoTemplateId?: ID;
  techSpecTemplateId?: ID;
  termsTemplateId?: ID;
  bankAccountId?: ID;
}

export interface Invoice {
  id: ID; number: string; date: number; dueDate?: number;
  customerId: ID; customerSnapshot?: Partial<Customer>;
  companySnapshot?: any;
  taxSnapshot?: any;
  signatoryOverride?: any;
  signatorySnapshot?: any;
  placeOfSupply?: string;
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
  status: "draft" | "unpaid" | "partial" | "paid" | "posted" | "cancelled";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  convertedFromQuotationId?: ID;
  version?: number;
  amendedFromId?: ID;
  createdAt: number;
  updatedAt?: number;
}

export interface Receipt {
  id: ID; number: string; date: number; customerId: ID; partyId?: ID; invoiceId?: ID;
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
  reference?: string; notes?: string; createdAt: number;
}

export interface Purchase {
  id: ID; number: string; date: number; supplierId: ID;
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
  notes?: string; status: "unpaid" | "partial" | "paid";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  version?: number;
  amendedFromId?: ID;
  createdAt: number;
  updatedAt?: number;
}

// --- New masters ---
export interface SizePreset { id: ID; label: string; createdAt: number; }

export interface TermItem { id: string; text: string; enabled: boolean; }
export interface TermsTemplate {
  id: ID; name: string; isDefault?: boolean; terms: TermItem[]; createdAt: number;
}

export interface GeneralInfoField { key: string; label: string; value: string; }
export interface GeneralInfoTemplate {
  id: ID; name: string; isDefault?: boolean; fields: GeneralInfoField[]; createdAt: number;
}

export interface TechSpecRow { label: string; value: string; }
export interface TechSpecSection { title: string; rows: TechSpecRow[]; }
export interface TechSpecTemplate {
  id: ID; name: string; kind?: "technical" | "electrical"; isDefault?: boolean;
  sections: TechSpecSection[]; createdAt: number;
}

export interface BankAccount {
  id: ID; bankName: string; accountName: string; accountNo: string;
  ifsc: string; branch?: string; upi?: string; isDefault?: boolean; createdAt: number;
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

class BizDB extends Dexie {
  companySettings!: Table<CompanySettings, "singleton">;
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
  termsTemplates!: Table<TermsTemplate, ID>;
  generalInfoTemplates!: Table<GeneralInfoTemplate, ID>;
  techSpecTemplates!: Table<TechSpecTemplate, ID>;
  bankAccounts!: Table<BankAccount, ID>;
  quotationTemplates!: Table<QuotationTemplate, ID>;
  parties!: Table<Party, ID>;

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

export async function getCompany(): Promise<CompanySettings> {
  const existing = await db().companySettings.get("singleton");
  if (existing) return existing;
  await db().companySettings.put(DEFAULT_COMPANY);
  return DEFAULT_COMPANY;
}

export async function nextNumber(
  kind: "invoice" | "quotation" | "receipt" | "purchase",
): Promise<string> {
  const c = await getCompany();
  const key = kind === "invoice" ? "nextInvoiceNo" : kind === "quotation" ? "nextQuotationNo" : kind === "receipt" ? "nextReceiptNo" : "nextPurchaseNo";
  const prefix = kind === "invoice" ? c.invoicePrefix : kind === "quotation" ? c.quotationPrefix : kind === "receipt" ? c.receiptPrefix : c.purchasePrefix;
  const n = (c as any)[key] as number;
  const next = { ...c, [key]: n + 1 };
  await db().companySettings.put(next);
  return `${prefix}${String(n).padStart(4, "0")}`;
}
