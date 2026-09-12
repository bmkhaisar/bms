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
  bankAccountNo: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankBranch: z.string().optional(),
  upiId: z.string().optional(),
  upiQrUrl: z.string().optional(),
  terms: z.string().optional(),
  authorizedSignatory: z.string().optional(),
  invoicePrefix: z.string().optional(),
  quotationPrefix: z.string().optional(),
  purchasePrefix: z.string().optional(),
  receiptPrefix: z.string().optional(),
  paymentPrefix: z.string().optional(),
  currentFinancialYearId: z.string().optional(),
  createdAt: z.number(),
  createdBy: z.string(),
  updatedAt: z.number().optional(),
});

export type Company = z.infer<typeof companySchema>;

export interface CompanySnapshot {
  companyId: string;
  name: string;
  legalName?: string;
  tradingName?: string;
  logoUrl?: string;
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
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiId?: string;
  terms?: string;
  authorizedSignatory?: string;
  signatureUrl?: string;
  stampUrl?: string;
  currency?: string;
  currencySymbol?: string;
  snapshotAt: number;
}

export function createCompanySnapshot(company: Partial<Company>): CompanySnapshot {
  return {
    companyId: company.id || "",
    name: company.name || "",
    legalName: company.legalName || company.name || "",
    tradingName: company.tradingName,
    logoUrl: company.logoUrl,
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
    bankAccountNo: company.bankAccountNo,
    bankIfsc: company.bankIfsc,
    bankBranch: company.bankBranch,
    upiId: company.upiId,
    terms: company.terms,
    authorizedSignatory: company.authorizedSignatory,
    signatureUrl: company.signatureUrl,
    stampUrl: company.stampUrl,
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
