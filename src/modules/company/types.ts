import { z } from "zod";

export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().min(1, "Legal name is required"),
  tradingName: z.string().optional(),
  logoUrl: z.string().optional(),
  stampUrl: z.string().optional(),
  signatureUrl: z.string().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  cin: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
  altPhone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  pincode: z.string().min(1, "Pincode is required"),
  country: z.string().default("India"),
  stateCode: z.string().optional(),
  currency: z.string().default("INR"),
  currencySymbol: z.string().default("₹"),
  timezone: z.string().default("Asia/Kolkata"),
  bankName: z.string().optional(),
  accountHolderName: z.string().optional(),
  bankAccountHolderName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccountType: z.string().optional(),
  bankSwiftCode: z.string().optional(),
  upiId: z.string().optional(),
  upiQrUrl: z.string().optional(),
  terms: z.string().optional(),
  quotationGeneralInfoMarkdown: z.string().optional(),
  quotationTechnicalSpecsMarkdown: z.string().optional(),
  quotationTermsMarkdown: z.string().optional(),
  invoiceTermsMarkdown: z.string().optional(),
  quotationClosingMessage: z.string().optional(),
  showQuotationGeneralInfo: z.boolean().optional(),
  showQuotationTechnicalSpecs: z.boolean().optional(),
  showQuotationTerms: z.boolean().optional(),
  showInvoiceTerms: z.boolean().optional(),
  showQuotationBankDetails: z.boolean().optional(),
  showInvoiceBankDetails: z.boolean().optional(),
  authorizedSignatory: z.string().optional(),
  designation: z.string().optional(),
  signatureMode: z.enum(["none", "typed", "uploaded"]).optional(),
  typedSignatureStyle: z.enum(["style_1", "style_2", "style_3"]).optional(),
  stampMode: z.enum(["none", "uploaded"]).optional(),
  showSignature: z.boolean().optional(),
  showStamp: z.boolean().optional(),
  showSignatoryName: z.boolean().optional(),
  showDesignation: z.boolean().optional(),
  showSignatureDate: z.boolean().optional(),
  signatureDateMode: z.enum(["document_date", "today", "custom", "hidden"]).optional(),
  customSignatureDate: z.union([z.string(), z.number()]).optional(),
  invoicePrefix: z.string().optional(),
  quotationPrefix: z.string().optional(),
  purchasePrefix: z.string().optional(),
  receiptPrefix: z.string().optional(),
  paymentPrefix: z.string().optional(),
  taxRegistrationMode: z.enum(["NORMAL_GST", "COMPOSITION", "UNREGISTERED"]).optional(),
  currentFinancialYearId: z.string().optional(),
  createdAt: z.number(),
  createdBy: z.string(),
  updatedAt: z.number().optional(),
});

export type Company = z.infer<typeof companySchema>;

export type SignatureMode = "none" | "typed" | "uploaded";
export type TypedSignatureStyle = "style_1" | "style_2" | "style_3";
export type SignatureDateMode = "document_date" | "today" | "custom" | "hidden";

export interface SignatoryConfig {
  authorizedSignatory?: string;
  designation?: string;
  signatureMode?: SignatureMode;
  typedSignatureStyle?: TypedSignatureStyle;
  signatureUrl?: string;
  stampUrl?: string;
  stampMode?: "none" | "uploaded";
  showSignature?: boolean;
  showStamp?: boolean;
  showSignatoryName?: boolean;
  showDesignation?: boolean;
  showSignatureDate?: boolean;
  signatureDateMode?: SignatureDateMode;
  customSignatureDate?: string | number;
}

export interface SignatorySnapshot extends SignatoryConfig {
  companyName: string;
  resolvedDateText?: string;
  snapshotAt: number;
}

export interface CompanySnapshot {
  companyId: string;
  name: string;
  legalName?: string;
  tradingName?: string;
  logoUrl?: string;
  logo?: string;
  taxRegistrationMode?: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  stateCode?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  website?: string;
  bankName?: string;
  accountHolderName?: string;
  bankAccountHolderName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  bankAccountType?: string;
  bankSwiftCode?: string;
  upiId?: string;
  terms?: string;
  quotationGeneralInfoMarkdown?: string;
  quotationTechnicalSpecsMarkdown?: string;
  quotationTermsMarkdown?: string;
  invoiceTermsMarkdown?: string;
  quotationClosingMessage?: string;
  showQuotationGeneralInfo?: boolean;
  showQuotationTechnicalSpecs?: boolean;
  showQuotationTerms?: boolean;
  showInvoiceTerms?: boolean;
  showQuotationBankDetails?: boolean;
  showInvoiceBankDetails?: boolean;
  authorizedSignatory?: string;
  designation?: string;
  signatureMode?: SignatureMode;
  typedSignatureStyle?: TypedSignatureStyle;
  signatureUrl?: string;
  stampUrl?: string;
  stampMode?: "none" | "uploaded";
  showSignature?: boolean;
  showStamp?: boolean;
  showSignatoryName?: boolean;
  showDesignation?: boolean;
  showSignatureDate?: boolean;
  signatureDateMode?: SignatureDateMode;
  customSignatureDate?: string | number;
  signatorySnapshot?: SignatorySnapshot;
  currency?: string;
  currencySymbol?: string;
  snapshotAt: number;
}

export function createCompanySnapshot(company: Partial<Company> & { logo?: string }): CompanySnapshot {
  const compName = company.legalName || company.name || "";
  const signatorySnapshot: SignatorySnapshot = {
    companyName: compName,
    authorizedSignatory: company.authorizedSignatory,
    designation: company.designation,
    signatureMode: company.signatureMode || (company.signatureUrl ? "uploaded" : "none"),
    typedSignatureStyle: company.typedSignatureStyle || "style_1",
    signatureUrl: company.signatureUrl,
    stampUrl: company.stampUrl,
    stampMode: company.stampMode || (company.stampUrl ? "uploaded" : "none"),
    showSignature: company.showSignature ?? (!!company.signatureUrl || company.signatureMode === "typed"),
    showStamp: company.showStamp ?? !!company.stampUrl,
    showSignatoryName: company.showSignatoryName ?? true,
    showDesignation: company.showDesignation ?? true,
    showSignatureDate: company.showSignatureDate ?? true,
    signatureDateMode: company.signatureDateMode || "document_date",
    customSignatureDate: company.customSignatureDate,
    snapshotAt: Date.now(),
  };

  return {
    companyId: company.id || "",
    name: company.name || "",
    legalName: compName,
    tradingName: company.tradingName,
    logoUrl: company.logoUrl,
    logo: company.logoUrl || company.logo,
    taxRegistrationMode: company.taxRegistrationMode,
    address: company.address || "",
    city: company.city || "",
    state: company.state || "",
    pincode: company.pincode || "",
    country: company.country || "India",
    gstin: company.gstin,
    pan: company.pan,
    cin: company.cin,
    stateCode: company.stateCode,
    phone: company.phone || "",
    altPhone: company.altPhone,
    email: company.email,
    website: company.website,
    bankName: company.bankName,
    accountHolderName: company.accountHolderName || company.bankAccountHolderName || compName,
    bankAccountHolderName: company.bankAccountHolderName || company.accountHolderName || compName,
    bankAccountNo: company.bankAccountNo,
    bankIfsc: company.bankIfsc,
    bankBranch: company.bankBranch,
    bankAccountType: company.bankAccountType,
    bankSwiftCode: company.bankSwiftCode,
    upiId: company.upiId,
    terms: company.terms,
    quotationGeneralInfoMarkdown: company.quotationGeneralInfoMarkdown,
    quotationTechnicalSpecsMarkdown: company.quotationTechnicalSpecsMarkdown,
    quotationTermsMarkdown: company.quotationTermsMarkdown,
    invoiceTermsMarkdown: company.invoiceTermsMarkdown,
    quotationClosingMessage: company.quotationClosingMessage,
    showQuotationGeneralInfo: company.showQuotationGeneralInfo ?? true,
    showQuotationTechnicalSpecs: company.showQuotationTechnicalSpecs ?? true,
    showQuotationTerms: company.showQuotationTerms ?? true,
    showInvoiceTerms: company.showInvoiceTerms ?? true,
    showQuotationBankDetails: company.showQuotationBankDetails ?? true,
    showInvoiceBankDetails: company.showInvoiceBankDetails ?? true,
    authorizedSignatory: company.authorizedSignatory,
    designation: company.designation,
    signatureMode: company.signatureMode,
    typedSignatureStyle: company.typedSignatureStyle,
    signatureUrl: company.signatureUrl,
    stampUrl: company.stampUrl,
    stampMode: company.stampMode,
    showSignature: company.showSignature,
    showStamp: company.showStamp,
    showSignatoryName: company.showSignatoryName,
    showDesignation: company.showDesignation,
    showSignatureDate: company.showSignatureDate,
    signatureDateMode: company.signatureDateMode,
    customSignatureDate: company.customSignatureDate,
    signatorySnapshot,
    currency: company.currency || "INR",
    currencySymbol: company.currencySymbol || "₹",
    snapshotAt: Date.now(),
  };
}

export const membershipRoleSchema = z.enum([
  "owner",
  "admin",
  "accountant",
  "sales",
  "purchase",
  "inventory",
  "hr",
  "viewer",
]);

export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const membershipSchema = z.object({
  uid: z.string(),
  companyId: z.string(),
  role: membershipRoleSchema,
  status: z.enum(["active", "invited", "suspended"]),
  branchIds: z.array(z.string()).optional(),
  customPermissions: z.array(z.string()).optional(),
  createdAt: z.number(),
  createdBy: z.string(),
});

export type Membership = z.infer<typeof membershipSchema>;

export const financialYearSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Financial Year name is required (e.g. 2026-2027)"),
  startDate: z.number(),
  endDate: z.number(),
  locked: z.boolean().default(false),
  createdAt: z.number(),
});

export type FinancialYear = z.infer<typeof financialYearSchema>;

export const branchSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  code: z.string().min(1),
  gstin: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  active: z.boolean().default(true),
  createdAt: z.number(),
});

export type Branch = z.infer<typeof branchSchema>;
