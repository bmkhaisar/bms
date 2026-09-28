import { z } from "zod";

export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().min(1, "Legal name is required"),
  tradingName: z.string().optional(),
  documentDisplayName: z.string().optional(),
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
  creditNotePrefix: z.string().optional(),
  taxRegistrationMode: z.enum(["NORMAL_GST", "COMPOSITION", "UNREGISTERED"]).optional(),
  currentFinancialYearId: z.string().optional(),
  defaultShareCcEmail: z.string().email().optional().or(z.literal("")),
  organizationType: z.enum(["NORMAL", "DEMO"]).optional(),
  isDemo: z.boolean().optional(),
  demoExpiresAt: z.number().optional(),
  demoDescription: z.string().optional(),
  internalNote: z.string().optional(),
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
  documentDisplayName?: string;
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
  const compName = company.name || company.legalName || "";
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

export const branchAccessSchema = z.object({
  branchId: z.string(),
  permissions: z.array(z.string()).default([]),
});

export type BranchAccess = z.infer<typeof branchAccessSchema>;

export const membershipSchema = z.object({
  uid: z.string(),
  userId: z.string().optional(),
  companyId: z.string(),
  organizationId: z.string().optional(),
  role: membershipRoleSchema,
  organizationRole: membershipRoleSchema.optional(),
  status: z.enum(["active", "invited", "suspended"]),
  branchIds: z.array(z.string()).optional(),
  allBranches: z.boolean().optional(),
  branchAccess: z.array(branchAccessSchema).optional(),
  customPermissions: z.array(z.string()).optional(),
  createdAt: z.number(),
  createdBy: z.string(),
  updatedAt: z.number().optional(),
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
  branchId: z.string().optional(),
  companyId: z.string(),
  organizationId: z.string().optional(),
  name: z.string().min(1, "Branch name is required"),
  code: z.string().min(1, "Branch code is required"),
  branchCode: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  active: z.boolean().default(true),
  isMainBranch: z.boolean().default(false),
  isBillingDefault: z.boolean().default(false),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  country: z.string().default("India"),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  gstin: z.string().optional(),
  gstRegistrationId: z.string().optional(),
  taxRegistrationReference: z.string().optional(),
  // Branch Document Identity (PRD §§ 13, 19)
  branchDisplayName: z.string().optional(),
  // Document and banking overrides with company default inheritance (PRD §§ 14-18)
  useCompanyContactDefault: z.boolean().default(true).optional(),
  useCompanyBankDefault: z.boolean().default(true).optional(),
  useCompanySignatoryDefault: z.boolean().default(true).optional(),
  useCompanyGeneralInfoDefault: z.boolean().default(true).optional(),
  useCompanyTechSpecsDefault: z.boolean().default(true).optional(),
  useCompanyTermsDefault: z.boolean().default(true).optional(),
  invoicePrefix: z.string().optional(),
  quotationPrefix: z.string().optional(),
  purchasePrefix: z.string().optional(),
  receiptPrefix: z.string().optional(),
  paymentPrefix: z.string().optional(),
  creditNotePrefix: z.string().optional(),
  bankName: z.string().optional(),
  accountHolderName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccountType: z.string().optional(),
  bankSwiftCode: z.string().optional(),
  upiId: z.string().optional(),
  authorizedSignatory: z.string().optional(),
  designation: z.string().optional(),
  signatureMode: z.enum(["none", "typed", "uploaded"]).optional(),
  typedSignatureStyle: z.enum(["style_1", "style_2", "style_3"]).optional(),
  signatureUrl: z.string().optional(),
  stampMode: z.enum(["none", "uploaded"]).optional(),
  stampUrl: z.string().optional(),
  quotationGeneralInfoMarkdown: z.string().optional(),
  quotationTechnicalSpecsMarkdown: z.string().optional(),
  quotationTermsMarkdown: z.string().optional(),
  invoiceTermsMarkdown: z.string().optional(),
  createdAt: z.number(),
  createdBy: z.string(),
  updatedAt: z.number().optional(),
});

export type Branch = z.infer<typeof branchSchema>;

export interface BranchSnapshot {
  branchId: string;
  branchName: string;
  branchCode: string;
  branchDisplayName?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  bankDetails?: {
    bankName?: string;
    accountHolderName?: string;
    bankAccountNo?: string;
    bankIfsc?: string;
    bankBranch?: string;
    bankAccountType?: string;
    bankSwiftCode?: string;
    upiId?: string;
  };
  signatory?: {
    authorizedSignatory?: string;
    designation?: string;
    signatureMode?: string;
    typedSignatureStyle?: string;
    signatureUrl?: string;
    stampMode?: string;
    stampUrl?: string;
  };
  snapshotAt: number;
}

/**
 * Resolves effective document and presentation attributes with 3-tier fallback (PRD §§ 14, 15, 16):
 * Document Specific Override -> Branch Override (if not using Company Default) -> Organization Default.
 */
export function resolveBranchCompanyContext(
  company: Partial<Company>,
  branch?: Partial<Branch> | null
): Partial<Company> & Record<string, any> {
  if (!branch) return company;

  // Contact resolution: Branch override if contact not defaulting to company
  const useBranchContact = branch.useCompanyContactDefault === false;
  const address = useBranchContact && branch.address?.trim() ? branch.address.trim() : (branch.address?.trim() || company.address);
  const city = useBranchContact && branch.city?.trim() ? branch.city.trim() : (branch.city?.trim() || company.city);
  const state = useBranchContact && branch.state?.trim() ? branch.state.trim() : (branch.state?.trim() || company.state);
  const pincode = useBranchContact && branch.pincode?.trim() ? branch.pincode.trim() : (branch.pincode?.trim() || company.pincode);
  const country = useBranchContact && branch.country?.trim() ? branch.country.trim() : (branch.country?.trim() || company.country || "India");
  const phone = useBranchContact && branch.phone?.trim() ? branch.phone.trim() : (branch.phone?.trim() || company.phone);
  const email = useBranchContact && branch.email?.trim() ? branch.email.trim() : (branch.email?.trim() || company.email);

  // Bank resolution: Branch override if toggle OFF
  const useBranchBank = branch.useCompanyBankDefault === false && Boolean(branch.bankName || branch.bankAccountNo || (branch as any).accountNumber);
  const bankName = useBranchBank ? branch.bankName?.trim() : (branch.bankName?.trim() || company.bankName);
  const accountHolderName = useBranchBank ? (branch.accountHolderName?.trim() || (branch as any).accountName?.trim()) : (branch.accountHolderName?.trim() || company.accountHolderName);
  const bankAccountNo = useBranchBank ? (branch.bankAccountNo?.trim() || (branch as any).accountNumber?.trim()) : (branch.bankAccountNo?.trim() || (company as any).accountNumber || company.bankAccountNo);
  const bankIfsc = useBranchBank ? (branch.bankIfsc?.trim() || (branch as any).ifsc?.trim()) : (branch.bankIfsc?.trim() || (company as any).ifsc || company.bankIfsc);
  const bankBranch = useBranchBank ? branch.bankBranch?.trim() : (branch.bankBranch?.trim() || company.bankBranch);
  const bankAccountType = useBranchBank ? branch.bankAccountType?.trim() : (branch.bankAccountType?.trim() || company.bankAccountType);
  const bankSwiftCode = useBranchBank ? branch.bankSwiftCode?.trim() : (branch.bankSwiftCode?.trim() || company.bankSwiftCode);
  const upiId = useBranchBank ? branch.upiId?.trim() : (branch.upiId?.trim() || company.upiId);

  // Signatory resolution: Branch override if toggle OFF
  const useBranchSig = branch.useCompanySignatoryDefault === false && Boolean(branch.authorizedSignatory || (branch as any).signatoryName);
  const authorizedSignatory = useBranchSig ? (branch.authorizedSignatory?.trim() || (branch as any).signatoryName?.trim()) : (branch.authorizedSignatory?.trim() || (company as any).signatoryName || company.authorizedSignatory);
  const designation = useBranchSig ? (branch.designation?.trim() || (branch as any).signatoryDesignation?.trim()) : (branch.designation?.trim() || (company as any).signatoryDesignation || company.designation);
  const signatureUrl = useBranchSig ? (branch.signatureUrl || company.signatureUrl) : company.signatureUrl;
  const stampUrl = useBranchSig ? (branch.stampUrl || company.stampUrl) : company.stampUrl;
  const signatureMode = useBranchSig ? (branch.signatureMode || company.signatureMode) : company.signatureMode;
  const typedSignatureStyle = useBranchSig ? (branch.typedSignatureStyle || company.typedSignatureStyle) : company.typedSignatureStyle;
  const stampMode = useBranchSig ? (branch.stampMode || company.stampMode) : company.stampMode;

  // General Info, Tech Specs, Terms resolution (PRD § 18)
  const useBranchGenInfo = branch.useCompanyGeneralInfoDefault === false && Boolean(branch.quotationGeneralInfoMarkdown || (branch as any).generalInformation);
  const quotationGeneralInfoMarkdown = useBranchGenInfo ? (branch.quotationGeneralInfoMarkdown || (branch as any).generalInformation) : (company.quotationGeneralInfoMarkdown || (company as any).generalInformation);

  const useBranchTechSpecs = branch.useCompanyTechSpecsDefault === false && Boolean(branch.quotationTechnicalSpecsMarkdown || (branch as any).technicalSpecifications);
  const quotationTechnicalSpecsMarkdown = useBranchTechSpecs ? (branch.quotationTechnicalSpecsMarkdown || (branch as any).technicalSpecifications) : (company.quotationTechnicalSpecsMarkdown || (company as any).technicalSpecifications);

  const useBranchTerms = branch.useCompanyTermsDefault === false && Boolean(branch.quotationTermsMarkdown || branch.invoiceTermsMarkdown || (branch as any).terms);
  const quotationTermsMarkdown = useBranchTerms && (branch.quotationTermsMarkdown || (branch as any).quotationTerms) ? (branch.quotationTermsMarkdown || (branch as any).quotationTerms) : (company.quotationTermsMarkdown || (company as any).quotationTerms);
  const invoiceTermsMarkdown = useBranchTerms && (branch.invoiceTermsMarkdown || (branch as any).terms) ? (branch.invoiceTermsMarkdown || (branch as any).terms) : (company.invoiceTermsMarkdown || (company as any).terms);

  // Display Name resolution: Branch Display Name (e.g. "KH Portable Cabins — Bangalore") preserves legal entity name
  const branchDisplayName = branch.branchDisplayName?.trim() || (branch as any).documentDisplayName?.trim();
  const displayName = branchDisplayName || company.name;

  return {
    ...company,
    name: company.name,
    tradingName: branchDisplayName || company.tradingName,
    legalName: company.legalName || company.name, // Preserves canonical legal identity
    documentDisplayName: branchDisplayName || (company as any).documentDisplayName || company.name,
    address,
    city,
    state,
    pincode,
    country,
    phone,
    email,
    gstin: branch.gstin?.trim() || branch.gstRegistrationId?.trim() || company.gstin,
    invoicePrefix: branch.invoicePrefix?.trim() || company.invoicePrefix,
    quotationPrefix: branch.quotationPrefix?.trim() || company.quotationPrefix,
    purchasePrefix: branch.purchasePrefix?.trim() || company.purchasePrefix,
    receiptPrefix: branch.receiptPrefix?.trim() || company.receiptPrefix,
    paymentPrefix: branch.paymentPrefix?.trim() || company.paymentPrefix,
    creditNotePrefix: branch.creditNotePrefix?.trim() || (company as any).creditNotePrefix,
    bankName,
    accountHolderName,
    bankAccountNo,
    accountNumber: bankAccountNo,
    bankIfsc,
    ifsc: bankIfsc,
    bankBranch,
    bankAccountType,
    bankSwiftCode,
    upiId,
    authorizedSignatory,
    signatoryName: authorizedSignatory,
    designation,
    signatoryDesignation: designation,
    signatureUrl,
    stampUrl,
    signatureMode,
    typedSignatureStyle,
    stampMode,
    quotationGeneralInfoMarkdown,
    generalInformation: quotationGeneralInfoMarkdown,
    quotationTechnicalSpecsMarkdown,
    technicalSpecifications: quotationTechnicalSpecsMarkdown,
    quotationTermsMarkdown,
    invoiceTermsMarkdown,
    terms: invoiceTermsMarkdown || quotationTermsMarkdown,
  };
}

