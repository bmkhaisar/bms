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
}

export interface Customer {
  id: ID; name: string; company?: string; mobile?: string; phone?: string; email?: string;
  gstin?: string; pan?: string; address?: string; billingAddress?: string; city?: string; state?: string; pincode?: string;
  openingBalance: number; ledgerId?: string; createdAt: number;
}

export interface Supplier {
  id: ID; name: string; company?: string; mobile?: string; phone?: string; email?: string;
  gstin?: string; pan?: string; address?: string; billingAddress?: string; openingBalance: number; ledgerId?: string; createdAt: number;
}

export interface Category { id: ID; name: string; createdAt: number; }

export interface Product {
  id: ID; name: string; sku?: string; categoryId?: ID; unit: string; hsn?: string;
  gstRate: number; purchasePrice: number; sellingPrice: number;
  openingStock: number; currentStock: number; reorderLevel: number;
  trackInventory?: boolean; // When false, stock movements are omitted (services, digital goods)
  description?: string;
  specifications?: string;
  defaultSizes?: string[];
  createdAt: number;
}

export interface LineItem {
  productId: ID; name: string; hsn?: string; quantity: number; unit: string;
  rate: number; discountPct: number; discountPercent?: number; gstRate: number; taxRate?: number; cessRate?: number;
  taxable: number; gstAmount: number; total: number;
  isTaxInclusive?: boolean;
  size?: string;
  description?: string;
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
  subtotal: number; discountTotal: number; gstTotal: number;
  cgstTotal?: number; sgstTotal?: number; igstTotal?: number; isIgst?: boolean;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  roundOff: number; grandTotal: number;
  notes?: string; terms?: string;
  status: "draft" | "sent" | "accepted" | "converted" | "rejected";
  createdAt: number;
  // Snapshots at time of save
  generalInfoSnapshot?: GeneralInfoField[];
  techSpecSnapshot?: TechSpecSection[];
  electricalSnapshot?: TechSpecSection[];
  termsSnapshot?: string[];
  bankSnapshot?: BankAccount;
  templateId?: ID;
  convertedInvoiceId?: ID;
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
  items: LineItem[];
  subtotal: number; discountTotal: number;
  taxableAmount?: number;
  cgstTotal: number; sgstTotal: number; igstTotal: number;
  cessTotal?: number;
  gstTotal: number; roundOff: number; grandTotal: number;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  amountPaid: number; balance: number; isIgst: boolean;
  notes?: string; terms?: string;
  status: "draft" | "unpaid" | "partial" | "paid" | "posted";
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  voucherId?: string;
  convertedFromQuotationId?: ID;
  version?: number;
  amendedFromId?: ID;
  createdAt: number;
  updatedAt?: number;
}

export interface Receipt {
  id: ID; number: string; date: number; customerId: ID; invoiceId?: ID;
  amount: number; mode: "cash" | "bank" | "upi" | "cheque" | "other";
  paymentMethod?: string;
  chequeNumber?: string;
  chequeDate?: number | string;
  settlementLedgerId?: string;
  voucherId?: string;
  postingStatus?: "draft" | "posting" | "posted" | "failed" | "reversed";
  signatoryOverride?: any;
  signatorySnapshot?: any;
  reference?: string; notes?: string; createdAt: number;
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
  sizes!: Table<SizePreset, ID>;
  termsTemplates!: Table<TermsTemplate, ID>;
  generalInfoTemplates!: Table<GeneralInfoTemplate, ID>;
  techSpecTemplates!: Table<TechSpecTemplate, ID>;
  bankAccounts!: Table<BankAccount, ID>;
  quotationTemplates!: Table<QuotationTemplate, ID>;

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
