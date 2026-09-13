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
 * Resolves a full, canonical document model from Quotation or Invoice data.
 */
export function resolveDocumentModel(
  doc: Quotation | Invoice | any,
  activeCompany?: Partial<CompanySettings | CompanySnapshot | any> | null,
  customer?: Customer | null
): ResolvedDocumentModel {
  const isQuotation = "validity" in doc || !("dueDate" in doc) || (doc as any).kind === "quotation";
  const kind = (doc as any).kind || (isQuotation ? "quotation" : "invoice");
  const title = isQuotation ? "QUOTATION" : "TAX INVOICE";

  // 1. Resolve Company Header
  const comp = doc.companySnapshot || activeCompany || {};
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

  // 5. Supplementary Sections (Quotation Only)
  const includeGeneralInfo = isQuotation && doc.includeGeneralInfo !== false;
  let generalInfoRows: ResolvedGeneralInfoRow[] = [];
  if (includeGeneralInfo) {
    if (doc.structuredSections) {
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

  const includeTechSpecs = isQuotation && doc.includeTechSpecs !== false;
  let techSpecSections: ResolvedTechSpecSection[] = [];
  if (includeTechSpecs) {
    if (doc.structuredSections) {
      const specSecs = doc.structuredSections.filter((s: QuotationSection) => s.type === "SPEC_TABLE");
      techSpecSections = specSecs.map((s: QuotationSection) => ({
        title: s.title,
        subtitle: s.subtitle,
        rows: s.rows.map((r: SectionRow) => ({ label: r.label, value: r.value })),
      }));
    } else {
      if (doc.techSpecSnapshot && doc.techSpecSnapshot.length > 0) {
        techSpecSections.push(
          ...doc.techSpecSnapshot.map((sec: any) => ({
            title: sec.title || "Technical Specifications",
            rows: (sec.rows || []).map((r: any) => ({ label: r.label, value: r.value })),
          }))
        );
      }
      if (doc.electricalSnapshot && doc.electricalSnapshot.length > 0) {
        techSpecSections.push(
          ...doc.electricalSnapshot.map((sec: any) => ({
            title: sec.title || "Electrical Specifications",
            rows: (sec.rows || []).map((r: any) => ({ label: r.label, value: r.value })),
          }))
        );
      }
    }
  }

  // 6. Structured Terms & Conditions
  const includeTerms = doc.includeTerms !== false;
  let terms: StructuredTermItem[] = [];
  if (includeTerms) {
    terms = parseLegacyTermsToStructured(
      doc.structuredTerms || doc.termsSnapshot || doc.terms || comp.terms
    );
  }

  // 7. Bank Details
  const includeBankDetails = doc.includeBankDetails !== false;
  let bankDetails: ResolvedBankDetails | null = null;
  if (includeBankDetails) {
    const rawBank = doc.bankDetailsSnapshot || doc.bankSnapshot || (comp.bankName ? comp : null);
    if (rawBank && (rawBank.bankName || rawBank.accountNo || rawBank.bankAccountNo)) {
      bankDetails = {
        accountHolderName: rawBank.accountName || rawBank.accountHolderName || comp.legalName || comp.name || "Business Entity",
        accountNumber: rawBank.accountNo || rawBank.bankAccountNo || rawBank.accountNumber || "—",
        bankName: rawBank.bankName || "Bank",
        ifsc: rawBank.ifsc || rawBank.bankIfsc || "—",
        branch: rawBank.branch || rawBank.bankBranch,
        accountType: rawBank.accountType || "Current Account",
        upi: rawBank.upi || rawBank.upiId || comp.upiId,
        swift: rawBank.swift,
      };
    }
  }

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
