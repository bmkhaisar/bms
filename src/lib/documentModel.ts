/**
 * Resolved Document Model (PRD §§ 10, 11, 19, 24, 30, 60, 73, 74)
 * Single unified document presentation model shared by:
 * - Vector PDF Generation (jsPDF + autoTable)
 * - Multi-Page Preview (QuotationQuickPreviewModal)
 * - Print Engine (DocumentPrint)
 * - Invoice & Quotation renderers
 * 
 * Guarantees that Preview === Downloaded PDF with zero layout/content drift.
 */

import { formatCompanyAddress, type FormattedCompanyAddress } from "./companyAddress.ts";
import { formatMoney, formatDate, numberToWordsIndian } from "./format.ts";
import type {
  Quotation,
  Invoice,
  CompanySettings,
  Customer,
  Supplier,
  BankAccount,
  StructuredTermItem,
  QuotationSection,
  SectionRow,
} from "./db.ts";
import type { CompanySnapshot, SignatorySnapshot } from "../modules/company/types.ts";
import { resolveDocumentSignatory } from "../modules/company/signatoryHelper.ts";
import { resolveTechSpecSections } from "./techSpecResolution.ts";
import { resolveGeneralInfoFields } from "./cabinConfiguration.ts";

export interface ResolvedPartyAddress {
  name: string;
  tradingName?: string;
  company?: string;
  addressLines: string[];
  cityStatePincode?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  isSameAsBilling?: boolean;
}

export interface ResolvedGeneralInfoRow {
  label: string;
  value: string;
  bullets?: string[];
}

export interface ResolvedTechSpecSection {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value: string }>;
}

export interface ResolvedBankDetails {
  accountHolderName: string;
  accountNumber: string;
  bankName: string;
  ifsc: string;
  branch?: string;
  accountType?: string;
  upi?: string;
  swift?: string;
}

export interface ResolvedDocumentModel {
  kind: "quotation" | "invoice" | "purchase" | "receipt";
  title: string;
  number: string;
  date: number;
  dateFormatted: string;
  validityFormatted?: string;
  dueDateFormatted?: string;
  preparedBy?: string;
  siteLocation?: string;
  contactPerson?: string;
  contactPhone?: string;

  // Company identity & complete address
  company: FormattedCompanyAddress;
  companyLogo?: string | null;

  // Parties
  billTo: ResolvedPartyAddress;
  shipTo: ResolvedPartyAddress;

  // Commercial Line Items
  items: Array<{
    index: number;
    name: string;
    description?: string;
    size?: string;
    measurementSummary?: string;
    hsn?: string;
    quantity: number;
    unit: string;
    rate: number;
    rateFormatted: string;
    discountPct: number;
    gstRate: number;
    taxableAmount: number;
    taxableFormatted: string;
    taxAmount: number;
    taxFormatted: string;
    totalAmount: number;
    totalFormatted: string;
  }>;

  // Tax & Totals Breakdown
  enableGst: boolean;
  gstCalculationMode: "item_wise" | "overall";
  overallGstRate?: number;
  subtotal: number;
  subtotalFormatted: string;
  discountTotal: number;
  discountFormatted: string;
  taxableAmount: number;
  taxableAmountFormatted: string;
  cgstTotal: number;
  cgstFormatted: string;
  sgstTotal: number;
  sgstFormatted: string;
  igstTotal: number;
  igstFormatted: string;
  gstTotal: number;
  gstFormatted: string;
  isInterState: boolean;
  extraCharges: Array<{ label: string; amount: number; formatted: string }>;
  extraChargesTotal: number;
  roundOff: number;
  roundOffFormatted: string;
  grandTotal: number;
  grandTotalFormatted: string;
  amountInWords: string;

  // Supplementary Sections (Quotation only for specs/general info)
  includeGeneralInfo: boolean;
  generalInfoRows: ResolvedGeneralInfoRow[];

  includeTechSpecs: boolean;
  techSpecSections: ResolvedTechSpecSection[];

  includeTerms: boolean;
  terms: StructuredTermItem[];

  includeBankDetails: boolean;
  bankDetails: ResolvedBankDetails | null;

  notes?: string;
  closingMessage?: string;
  signatory: ReturnType<typeof resolveDocumentSignatory>;
}

/**
 * Legacy Fallback Parser for Terms
 * Converts plain-text strings or legacy arrays into structured numbered/bullet terms.
 */
export function parseLegacyTermsToStructured(
  terms?: string | string[] | StructuredTermItem[]
): StructuredTermItem[] {
  if (!terms) return [];
  if (Array.isArray(terms)) {
    if (terms.length === 0) return [];
    // If already structured
    if (typeof terms[0] === "object" && "text" in terms[0]) {
      return terms as StructuredTermItem[];
    }
    // String array
    return (terms as string[])
      .map((t, idx) => {
        const clean = String(t || "").trim();
        if (!clean) return null;
        const textWithoutLeadingNumber = clean.replace(/^\d+[.)]\s*/, "");
        return {
          id: `term-${idx + 1}`,
          order: idx + 1,
          text: textWithoutLeadingNumber,
          format: "NUMBERED" as const,
        };
      })
      .filter(Boolean) as StructuredTermItem[];
  }

  // Multiline string
  const lines = terms
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((l, idx) => {
    const isBullet = /^[•\-\*]\s*/.test(l);
    const cleanText = l.replace(/^([•\-\*]|\d+[.)])\s*/, "").trim();
    return {
      id: `term-${idx + 1}`,
      order: idx + 1,
      text: cleanText,
      format: isBullet ? ("BULLET" as const) : ("NUMBERED" as const),
    };
  });
}

/**
 * Parses Party Address into formatted lines and city/state/pincode.
 */
function resolvePartyAddress(rawParty: any, rawAddressSnapshot: any, isSame = false): ResolvedPartyAddress {
  const p = rawParty || {};
  const snap = rawAddressSnapshot || {};
  const name = snap.partyName || p.name || p.partyName || "Valued Customer";
  const tradingName = snap.tradingName || p.tradingName || p.company;

  const rawAddr = snap.address || snap.addressLine1 || p.address || p.billingAddress || "";
  const addressLines: string[] = [];
  if (rawAddr) {
    addressLines.push(...rawAddr.split(/\r?\n+/).map((l: string) => l.trim()).filter(Boolean));
  }
  if (snap.addressLine2 && snap.addressLine2.trim()) {
    addressLines.push(snap.addressLine2.trim());
  }

  const city = (snap.city || p.city || "").trim();
  const state = (snap.state || p.state || "").trim();
  const pincode = (snap.pincode || p.pincode || "").trim();
  const country = (snap.country || p.country || "").trim();

  let cityStatePincode = "";
  if (city && state && pincode) {
    cityStatePincode = `${city}, ${state} - ${pincode}`;
  } else if (city && state) {
    cityStatePincode = `${city}, ${state}`;
  } else if (city && pincode) {
    cityStatePincode = `${city} - ${pincode}`;
  } else if (state && pincode) {
    cityStatePincode = `${state} - ${pincode}`;
  } else if (city || state || pincode) {
    cityStatePincode = [city, state, pincode].filter(Boolean).join(", ");
  }

  if (country && country.toLowerCase() !== "india" && cityStatePincode) {
    cityStatePincode = `${cityStatePincode}, ${country}`;
  }

  return {
    name,
    tradingName: tradingName && tradingName !== name ? tradingName : undefined,
    company: p.company && p.company !== name ? p.company : undefined,
    addressLines,
    cityStatePincode: cityStatePincode || undefined,
    gstin: (snap.gstin || p.gstin || "").trim().toUpperCase() || undefined,
    pan: (snap.pan || p.pan || "").trim().toUpperCase() || undefined,
    phone: (snap.phone || p.phone || p.mobile || "").trim() || undefined,
    email: (snap.email || p.email || "").trim() || undefined,
    contactPerson: (snap.contactPerson || p.contactPerson || "").trim() || undefined,
    isSameAsBilling: isSame,
  };
}

/**
 * Checks whether a document is legally issued, posted, or finalized.
 */
export function isDocumentFinalized(doc: any): boolean {
  if (!doc) return false;
  const status = String(doc.status || "").toLowerCase().trim();
  const postingStatus = String(doc.postingStatus || "").toLowerCase().trim();

  // If explicitly posted or has voucher, it is finalized
  if (postingStatus === "posted" || status === "posted" || Boolean(doc.voucherId)) {
    return true;
  }

  // If status or postingStatus is draft, pending, editing, new, it is NEVER finalized
  if (status === "draft" || status === "pending" || status === "editing" || status === "new") {
    return false;
  }
  if (postingStatus === "draft" || postingStatus === "pending") {
    return false;
  }

  // If status is empty, it is not finalized
  if (!status) {
    return false;
  }

  const finalizedStatuses = new Set([
    "sent", "issued", "approved", "accepted", "confirmed", "converted", "completed", "paid", "unpaid", "partially_paid", "overdue"
  ]);
  return finalizedStatuses.has(status);
}

/**
 * Resolves the effective CompanySettings for a document.
 * - Legally issued/posted documents preserve their immutable historical companySnapshot.
 * - New documents and drafts strictly use the latest saved Company Settings (activeCompany).
 * - An outdated companySnapshot on a draft is ignored unless there is an explicit per-document override.
 */
export function resolveEffectiveCompany(
  doc: any,
  activeCompany?: Partial<CompanySettings | CompanySnapshot | any> | null,
  fallbackCompany?: Partial<CompanySettings | CompanySnapshot | any> | null
): CompanySettings {
  const finalized = isDocumentFinalized(doc);
  const snap = doc?.companySnapshot;

  // 1. FINALIZED / POSTED documents preserve their frozen historical snapshot
  if (finalized && snap && (snap.name || snap.legalName)) {
    return {
      ...(fallbackCompany || {}),
      ...(activeCompany || {}),
      ...snap,
      name: snap.name || snap.legalName || (activeCompany as any)?.name || (fallbackCompany as any)?.name || "Your Company",
      legalName: snap.legalName || snap.name || (activeCompany as any)?.legalName || (fallbackCompany as any)?.legalName || "Your Company",
    } as CompanySettings;
  }

  // 2. DRAFTS & NEW DOCUMENTS: Strictly use the latest authoritative Company Settings!
  // An outdated companySnapshot on a draft MUST NOT override the active company settings!
  const explicitOverride = doc?.companyOverride;
  const current = activeCompany || {};
  const base = fallbackCompany || {};

  const authoritativeName =
    explicitOverride?.name ||
    current.name ||
    current.legalName ||
    base.name ||
    base.legalName ||
    "Your Company";

  const authoritativeLegalName =
    explicitOverride?.legalName ||
    current.legalName ||
    current.name ||
    base.legalName ||
    base.name ||
    authoritativeName;

  return {
    ...base,
    ...current,
    ...(explicitOverride || {}),
    name: authoritativeName,
    legalName: authoritativeLegalName,
    address: explicitOverride?.address !== undefined ? explicitOverride.address : (current.address !== undefined ? current.address : (base.address ?? "")),
    city: explicitOverride?.city !== undefined ? explicitOverride.city : (current.city !== undefined ? current.city : (base.city ?? "")),
    state: explicitOverride?.state !== undefined ? explicitOverride.state : (current.state !== undefined ? current.state : (base.state ?? "")),
    pincode: explicitOverride?.pincode !== undefined ? explicitOverride.pincode : (current.pincode !== undefined ? current.pincode : (base.pincode ?? "")),
    gstin: explicitOverride?.gstin !== undefined ? explicitOverride.gstin : (current.gstin !== undefined ? current.gstin : (base.gstin ?? "")),
    pan: explicitOverride?.pan !== undefined ? explicitOverride.pan : (current.pan !== undefined ? current.pan : (base.pan ?? "")),
    phone: explicitOverride?.phone ?? (current.phone || current.mobile || base.phone || base.mobile || ""),
    email: explicitOverride?.email !== undefined ? explicitOverride.email : (current.email !== undefined ? current.email : (base.email ?? "")),
    logo: explicitOverride?.logo ?? (current.logo || current.logoUrl || base.logo || base.logoUrl || undefined),
    logoUrl: explicitOverride?.logoUrl ?? (current.logoUrl || current.logo || base.logoUrl || base.logo || undefined),
    bankName: explicitOverride?.bankName !== undefined ? explicitOverride.bankName : (current.bankName !== undefined ? current.bankName : (base.bankName ?? "")),
    bankAccountNo: explicitOverride?.bankAccountNo ?? (current.bankAccountNo || current.bankAccount || base.bankAccountNo || base.bankAccount || ""),
    bankAccount: explicitOverride?.bankAccount ?? (current.bankAccount || current.bankAccountNo || base.bankAccount || base.bankAccountNo || ""),
    bankIfsc: explicitOverride?.bankIfsc !== undefined ? explicitOverride.bankIfsc : (current.bankIfsc !== undefined ? current.bankIfsc : (base.bankIfsc ?? "")),
    bankBranch: explicitOverride?.bankBranch !== undefined ? explicitOverride.bankBranch : (current.bankBranch !== undefined ? current.bankBranch : (base.bankBranch ?? "")),
    accountHolderName: explicitOverride?.accountHolderName ?? (current.accountHolderName || current.bankAccountHolderName || current.name || base.accountHolderName || base.name || authoritativeName),
    bankAccountHolderName: explicitOverride?.bankAccountHolderName ?? (current.accountHolderName || current.bankAccountHolderName || current.name || base.accountHolderName || base.name || authoritativeName),
    bankAccountType: explicitOverride?.bankAccountType !== undefined ? explicitOverride.bankAccountType : (current.bankAccountType !== undefined ? current.bankAccountType : (base.bankAccountType ?? "")),
    bankSwiftCode: explicitOverride?.bankSwiftCode !== undefined ? explicitOverride.bankSwiftCode : (current.bankSwiftCode !== undefined ? current.bankSwiftCode : (base.bankSwiftCode ?? "")),
    upiId: explicitOverride?.upiId !== undefined ? explicitOverride.upiId : (current.upiId !== undefined ? current.upiId : (base.upiId ?? "")),
    showQuotationBankDetails: current.showQuotationBankDetails !== undefined ? current.showQuotationBankDetails : (base.showQuotationBankDetails ?? true),
    showInvoiceBankDetails: current.showInvoiceBankDetails !== undefined ? current.showInvoiceBankDetails : (base.showInvoiceBankDetails ?? true),
  } as CompanySettings;
}

/**
 * Resolves canonical bank details respecting independent Quotation and Invoice visibility toggles.
 * Hides completely when toggle is OFF or bank details are missing.
 */
export function resolveCanonicalBankDetails(
  doc: any,
  comp: Partial<CompanySettings | CompanySnapshot | any> | null,
  isFinalized = false
): { includeBankDetails: boolean; bankDetails: ResolvedBankDetails | null } {
  const isQuotation = doc?.kind === "quotation"
    ? true
    : (doc?.kind === "invoice" || doc?.kind === "purchase" || doc?.kind === "receipt" || doc?.kind === "payment")
    ? false
    : Boolean("validity" in (doc || {}) || ("quotationNumber" in (doc || {})));

  let isVisible = true;
  if (isFinalized) {
    if (doc?.visibilitySnapshot?.showBankDetails !== undefined) {
      isVisible = Boolean(doc.visibilitySnapshot.showBankDetails);
    } else if (doc?.includeBankDetails !== undefined) {
      isVisible = Boolean(doc.includeBankDetails);
    } else {
      isVisible = isQuotation
        ? comp?.showQuotationBankDetails !== false
        : comp?.showInvoiceBankDetails !== false;
    }
  } else {
    if (doc?.includeBankDetails !== undefined && doc.includeBankDetails === false) {
      isVisible = false;
    } else if (doc?.visibilitySnapshot?.showBankDetails !== undefined && doc.visibilitySnapshot.showBankDetails === false && doc.includeBankDetails === false) {
      isVisible = false;
    } else {
      isVisible = isQuotation
        ? comp?.showQuotationBankDetails !== false
        : comp?.showInvoiceBankDetails !== false;
    }
  }

  if (!isVisible) {
    return { includeBankDetails: false, bankDetails: null };
  }

  const rawBank = isFinalized
    ? (doc?.bankDetailsSnapshot || doc?.bankSnapshot || comp)
    : (doc?.bankOverride || ((comp?.bankName || comp?.bankAccountNo) ? comp : (doc?.bankDetailsSnapshot || doc?.bankSnapshot || comp)));

  if (!rawBank) {
    return { includeBankDetails: false, bankDetails: null };
  }

  const accountNumber = (
    rawBank.accountNo ||
    rawBank.bankAccountNo ||
    rawBank.accountNumber ||
    rawBank.bankAccount ||
    rawBank.bankAccountNumber ||
    comp?.bankAccountNo ||
    comp?.bankAccount ||
    ""
  ).toString().trim();

  const bankName = (rawBank.bankName || comp?.bankName || "").trim();
  const ifsc = (rawBank.ifsc || rawBank.bankIfsc || rawBank.ifscCode || comp?.bankIfsc || "").trim().toUpperCase();

  const hasValidDetails = Boolean(
    (accountNumber && accountNumber !== "—" && accountNumber !== "-") ||
    (bankName && bankName !== "—" && bankName !== "-") ||
    (ifsc && ifsc !== "—" && ifsc !== "-")
  );

  if (!hasValidDetails) {
    return { includeBankDetails: false, bankDetails: null };
  }

  const accountHolderName = (
    rawBank.accountHolderName ||
    rawBank.accountName ||
    rawBank.bankAccountHolderName ||
    comp?.accountHolderName ||
    comp?.bankAccountHolderName ||
    comp?.name ||
    comp?.legalName ||
    "Business Entity"
  ).trim();

  const branch = (rawBank.branch || rawBank.bankBranch || comp?.bankBranch || "").trim() || undefined;
  const accountType = (rawBank.accountType || rawBank.bankAccountType || comp?.bankAccountType || "").trim() || undefined;
  const swift = (rawBank.swift || rawBank.bankSwiftCode || comp?.bankSwiftCode || "").trim() || undefined;
  const upi = (rawBank.upi || rawBank.upiId || comp?.upiId || "").trim() || undefined;

  return {
    includeBankDetails: true,
    bankDetails: {
      accountHolderName,
      bankName: bankName || "—",
      accountNumber: accountNumber || "—",
      ifsc: ifsc || "—",
      branch,
      accountType,
      swift,
      upi,
    },
  };
}

/**
 * Resolves a full, canonical document model from Quotation or Invoice data.
 */
export function resolveDocumentModel(
  docOrOptions: Quotation | Invoice | any,
  activeCompanyArg?: Partial<CompanySettings | CompanySnapshot | any> | null,
  customerArg?: Customer | null
): ResolvedDocumentModel {
  let doc: any = docOrOptions;
  let activeCompany = activeCompanyArg;
  let customer = customerArg;

  if (docOrOptions && typeof docOrOptions === "object" && "doc" in docOrOptions && !("number" in docOrOptions) && !("subtotal" in docOrOptions)) {
    doc = docOrOptions.doc;
    activeCompany = docOrOptions.activeCompany ?? activeCompanyArg;
    customer = docOrOptions.customer ?? customerArg;
  }

  const isQuotation = doc?.kind === "quotation"
    ? true
    : (doc?.kind === "invoice" || doc?.kind === "purchase" || doc?.kind === "receipt" || doc?.kind === "payment")
    ? false
    : Boolean("validity" in (doc || {}) || ("quotationNumber" in (doc || {})));
  const kind = (doc as any).kind || (isQuotation ? "quotation" : "invoice");
  const title = isQuotation ? "QUOTATION" : "TAX INVOICE";

  // 1. Resolve Company Header using authoritative resolution rule
  const comp = resolveEffectiveCompany(doc, activeCompany, null);
  const formattedCompany = formatCompanyAddress(comp);
  const companyLogo = comp.logo || comp.logoUrl || null;

  // 2. Resolve Parties
  const billTo = resolvePartyAddress(
    customer || doc.customerSnapshot,
    doc.billToSnapshot || doc.billingAddressSnapshot
  );

  const isSameAsBilling = doc.sameAsBilling !== false;
  const shipTo = isSameAsBilling
    ? { ...billTo, isSameAsBilling: true }
    : resolvePartyAddress(
        doc.shipToPartySnapshot || customer || doc.customerSnapshot,
        doc.shippingAddressSnapshot || doc.shipToPartySnapshot
      );

  // 3. Resolve Items
  const rawItems = doc.items || [];
  const items = rawItems.map((it: any, idx: number) => {
    const rate = Number(it.rate) || 0;
    const qty = Number(it.quantity) || 0;
    const disc = Number(it.discountPct ?? it.discountPercent) || 0;
    const gstRate = Number(it.gstRate ?? it.taxRate) || 0;
    const taxable = Number(it.taxable ?? it.lineAmount ?? it.total) || rate * qty;
    const taxAmt = Number(it.gstAmount) || (taxable * gstRate) / 100;
    const total = Number(it.total) || taxable + taxAmt;

    return {
      index: idx + 1,
      name: it.name || it.productName || "Item",
      description: it.description,
      size: it.size,
      measurementSummary: it.measurementSummary,
      hsn: it.hsn,
      quantity: qty,
      unit: it.unit || "NOS",
      rate,
      rateFormatted: formatMoney(rate),
      discountPct: disc,
      gstRate,
      taxableAmount: taxable,
      taxableFormatted: formatMoney(taxable),
      taxAmount: taxAmt,
      taxFormatted: formatMoney(taxAmt),
      totalAmount: total,
      totalFormatted: formatMoney(total),
    };
  });

  // 4. Resolve Totals & GST
  const subtotal = Number(doc.subtotal) || 0;
  const discountTotal = Number(doc.discountTotal) || 0;
  const taxableAmount = Number(doc.taxableAmount ?? (subtotal - discountTotal)) || 0;
  const cgstTotal = Number(doc.cgstTotal) || 0;
  const sgstTotal = Number(doc.sgstTotal) || 0;
  const igstTotal = Number(doc.igstTotal) || 0;
  const gstTotal = Number(doc.gstTotal) || (cgstTotal + sgstTotal + igstTotal);
  const roundOff = Number(doc.roundOff) || 0;
  const grandTotal = Number(doc.grandTotal) || (taxableAmount + gstTotal + roundOff);

  const extraCharges = (doc.extraCharges || []).map((c: any) => ({
    label: c.label || c.name || "Extra Charge",
    amount: Number(c.amount) || 0,
    formatted: formatMoney(Number(c.amount) || 0),
  }));
  const extraChargesTotal = extraCharges.reduce((s: number, c: any) => s + c.amount, 0);

  const gstCalculationMode = doc.gstCalculationMode || "item_wise";
  const overallGstRate = doc.overallGstRate;

  const isInvoice = doc.kind === "invoice" || !isQuotation;
  const isPosted = isDocumentFinalized(doc);

  // 5. Supplementary Sections: General Information
  const includeGeneralInfo = (isQuotation || isInvoice) && (
    doc.visibilitySnapshot?.showGeneralInfo !== undefined
      ? doc.visibilitySnapshot.showGeneralInfo
      : doc.includeGeneralInfo !== undefined
        ? doc.includeGeneralInfo
        : isInvoice
          ? Boolean(comp?.showInvoiceGeneralInfo)
          : doc.includeGeneralInfo !== false
  );
  let generalInfoRows: ResolvedGeneralInfoRow[] = [];
  if (includeGeneralInfo) {
    const resolved = resolveGeneralInfoFields({
      companyFields: (comp as any).generalInfoFields || (comp as any).generalInformationFields,
      companyMarkdown: isInvoice
        ? ((comp as any).invoiceGeneralInfoMarkdown || (comp as any).quotationGeneralInfoMarkdown)
        : (comp as any).quotationGeneralInfoMarkdown,
      items: doc.items || [],
      documentOverride: (doc.generalInformationSnapshot && doc.generalInformationSnapshot.length > 0)
        ? doc.generalInformationSnapshot
        : (doc.generalInfoSnapshot && doc.generalInfoSnapshot.length > 0)
          ? doc.generalInfoSnapshot
          : undefined,
      cabinOverride: doc.cabinConfigurationOverride,
      isCabinConfigCustom: doc.isCabinConfigCustom,
      isIssuedOrFrozen: Boolean(isPosted),
      frozenSnapshot: doc.generalInformationSnapshot || doc.generalInfoSnapshot,
    });
    if (resolved && resolved.length > 0) {
      generalInfoRows = resolved.map((r) => ({
        label: r.label,
        value: r.value,
        bullets: r.value && r.value.includes("•")
          ? r.value.split("•").map((b: string) => b.trim()).filter(Boolean)
          : undefined,
      }));
    } else if (doc.generalInformationSnapshot && doc.generalInformationSnapshot.length > 0) {
      const sec: any = doc.generalInformationSnapshot.find((s: any) => s.type === "GENERAL_INFO") || { rows: doc.generalInformationSnapshot };
      if (sec && sec.rows) {
        generalInfoRows = sec.rows.map((r: any) => ({
          label: r.label,
          value: r.value,
          bullets: r.bullets || (r.valueType === "BULLET_LIST" ? r.value.split(/\r?\n+/).map((b: string) => b.trim()).filter(Boolean) : undefined),
        }));
      }
    } else if (doc.structuredSections) {
      const genSec = doc.structuredSections.find((s: QuotationSection) => s.type === "GENERAL_INFO");
      if (genSec && genSec.rows) {
        generalInfoRows = genSec.rows.map((r: SectionRow) => ({
          label: r.label,
          value: r.value,
          bullets: r.bullets || (r.valueType === "BULLET_LIST" ? r.value.split(/\r?\n+/).map(b => b.trim()).filter(Boolean) : undefined),
        }));
      }
    } else if (doc.generalInfoSnapshot && doc.generalInfoSnapshot.length > 0) {
      generalInfoRows = doc.generalInfoSnapshot.map((f: any) => ({
        label: f.label,
        value: f.value,
        bullets: f.value && f.value.includes("•") ? f.value.split("•").map((b: string) => b.trim()).filter(Boolean) : undefined,
      }));
    }
  }

  const includeTechSpecs = (isQuotation || isInvoice) && (
    doc.visibilitySnapshot?.showTechSpecs !== undefined
      ? doc.visibilitySnapshot.showTechSpecs
      : doc.includeTechSpecs !== undefined
        ? doc.includeTechSpecs
        : isInvoice
          ? Boolean(comp?.showInvoiceTechnicalSpecs)
          : doc.includeTechSpecs !== false
  );
  let techSpecSections: ResolvedTechSpecSection[] = [];
  if (includeTechSpecs) {
    const resolved = resolveTechSpecSections({
      companyMarkdown: isInvoice
        ? (comp?.invoiceTechnicalSpecsMarkdown || comp?.quotationTechnicalSpecsMarkdown)
        : comp?.quotationTechnicalSpecsMarkdown,
      documentOverride: (doc.structuredSections && doc.structuredSections.length > 0)
        ? doc.structuredSections
        : (doc.technicalSpecificationSnapshot && doc.technicalSpecificationSnapshot.length > 0)
          ? doc.technicalSpecificationSnapshot
          : (doc.techSpecSnapshot || (doc as any).technicalSpecsMarkdown),
      isIssuedOrFrozen: Boolean(isPosted),
      frozenSnapshot: doc.technicalSpecificationSnapshot || doc.techSpecSnapshot,
    });
    techSpecSections = resolved.map((s) => ({
      title: s.title,
      subtitle: s.subtitle,
      rows: s.rows.map((r) => ({ label: r.label, value: r.value })),
    }));
  }

  // 6. Structured Terms & Conditions
  const includeTerms = doc.visibilitySnapshot?.showTerms !== undefined
    ? doc.visibilitySnapshot.showTerms
    : doc.includeTerms !== false;
  let terms: StructuredTermItem[] = [];
  if (includeTerms) {
    terms = parseLegacyTermsToStructured(
      doc.structuredTermsSnapshot || doc.structuredTerms || doc.termsSnapshot || doc.terms || comp.terms
    );
  }

  // 7. Bank Details
  const bankResult = resolveCanonicalBankDetails(doc, comp, Boolean(isPosted));
  const includeBankDetails = bankResult.includeBankDetails;
  const bankDetails = bankResult.bankDetails;

  // 8. Signatory
  const signatory = resolveDocumentSignatory({
    company: comp,
    signatoryOverride: doc.signatoryOverride,
    signatorySnapshot: doc.signatorySnapshot,
    documentDate: doc.date,
  });

  return {
    kind,
    title,
    number: doc.number || "DRAFT",
    date: doc.date || Date.now(),
    dateFormatted: formatDate(doc.date || Date.now()),
    validityFormatted: doc.validity ? formatDate(doc.validity) : undefined,
    dueDateFormatted: doc.dueDate ? formatDate(doc.dueDate) : undefined,
    preparedBy: doc.preparedBy,
    siteLocation: doc.siteLocation,
    contactPerson: doc.contactPerson,
    contactPhone: doc.contactPhone,
    company: formattedCompany,
    companyLogo,
    billTo,
    shipTo,
    items,
    enableGst: doc.enableGst !== false,
    gstCalculationMode,
    overallGstRate,
    subtotal,
    subtotalFormatted: formatMoney(subtotal),
    discountTotal,
    discountFormatted: formatMoney(discountTotal),
    taxableAmount,
    taxableAmountFormatted: formatMoney(taxableAmount),
    cgstTotal,
    cgstFormatted: formatMoney(cgstTotal),
    sgstTotal,
    sgstFormatted: formatMoney(sgstTotal),
    igstTotal,
    igstFormatted: formatMoney(igstTotal),
    gstTotal,
    gstFormatted: formatMoney(gstTotal),
    isInterState: Boolean(doc.isIgst || igstTotal > 0),
    extraCharges,
    extraChargesTotal,
    roundOff,
    roundOffFormatted: formatMoney(roundOff),
    grandTotal,
    grandTotalFormatted: formatMoney(grandTotal),
    amountInWords: numberToWordsIndian(grandTotal),
    includeGeneralInfo,
    generalInfoRows,
    includeTechSpecs,
    techSpecSections,
    includeTerms,
    terms,
    includeBankDetails,
    bankDetails,
    notes: doc.notes,
    closingMessage: doc.closingMessage || "Thank you for your business. We look forward to working with you.",
    signatory,
  };
}
