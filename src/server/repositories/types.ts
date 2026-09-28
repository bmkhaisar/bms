/**
 * Data Access Portability Layer (PRD §§ 33, 34, 35, 36)
 * 
 * Formal repository boundaries isolating Domain, Accounting, and Reporting logic
 * from concrete database implementations.
 * Current implementation: Firebase Realtime Database.
 * Future optional targets: Supabase (PostgreSQL), MongoDB.
 */

import type { Branch, Membership, BranchAccess } from "@/modules/company/types";
import type { SalesReturn, CreditNote, SalesReturnItem } from "@/lib/db";

export interface CreateBranchInput {
  companyId: string;
  callerUid: string;
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  isMainBranch?: boolean;
  isBillingDefault?: boolean;
  invoicePrefix?: string;
  quotationPrefix?: string;
  purchasePrefix?: string;
  receiptPrefix?: string;
  paymentPrefix?: string;
  creditNotePrefix?: string;
  bankName?: string;
  accountHolderName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiId?: string;
  bankAccountType?: string;
  bankSwiftCode?: string;
  authorizedSignatory?: string;
  designation?: string;
  signatureUrl?: string;
  stampUrl?: string;
  signatureMode?: "none" | "typed" | "uploaded";
  typedSignatureStyle?: "style_1" | "style_2" | "style_3";
  stampMode?: "none" | "uploaded";
  branchDisplayName?: string;
  useCompanyContactDefault?: boolean;
  useCompanyBankDefault?: boolean;
  useCompanySignatoryDefault?: boolean;
  useCompanyGeneralInfoDefault?: boolean;
  useCompanyTechSpecsDefault?: boolean;
  useCompanyTermsDefault?: boolean;
  quotationGeneralInfoMarkdown?: string;
  quotationTechnicalSpecsMarkdown?: string;
  quotationTermsMarkdown?: string;
  invoiceTermsMarkdown?: string;
}

export interface UpdateBranchInput extends Partial<CreateBranchInput> {
  companyId: string;
  branchId: string;
  callerUid: string;
}

export interface BranchResult {
  success: boolean;
  branch?: Branch;
  branchId?: string;
  error?: string;
  code?: string;
}

export interface IBranchRepository {
  createBranch(input: CreateBranchInput): Promise<BranchResult>;
  updateBranch(input: UpdateBranchInput): Promise<BranchResult>;
  deactivateBranch(companyId: string, branchId: string, callerUid: string): Promise<BranchResult>;
  setMainBranch(companyId: string, branchId: string, callerUid: string): Promise<BranchResult>;
  getBranch(companyId: string, branchId: string): Promise<Branch | null>;
  listBranches(companyId: string, callerUid?: string): Promise<Branch[]>;
}

export interface UpdateBranchAccessInput {
  allBranches?: boolean;
  branchIds?: string[];
  branchAccess?: BranchAccess[];
  customPermissions?: string[];
  role?: string;
  displayName?: string;
}

export interface CreateCompanyUserInput {
  companyId: string;
  callerUid: string;
  fullName: string;
  email: string;
  role: "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer" | "custom";
  allBranches?: boolean;
  branchIds?: string[];
  customPermissions?: string[];
}

export interface SetUserMembershipStatusInput {
  companyId: string;
  targetUid: string;
  callerUid: string;
  status: "active" | "suspended";
}

export interface IMembershipRepository {
  getMembership(companyId: string, uid: string): Promise<Membership | null>;
  listMemberships(companyId: string): Promise<Membership[]>;
  createCompanyUser(input: CreateCompanyUserInput): Promise<{ success: boolean; membership?: Membership; error?: string }>;
  updateUserBranchAccess(
    companyId: string,
    targetUid: string,
    callerUid: string,
    input: UpdateBranchAccessInput
  ): Promise<{ success: boolean; error?: string }>;
  setUserMembershipStatus(input: SetUserMembershipStatusInput): Promise<{ success: boolean; error?: string }>;
}

export interface PostSalesReturnInput {
  companyId: string;
  branchId: string;
  callerUid: string;
  idToken: string;
  originalInvoiceId: string;
  date: number;
  returnType: "FULL" | "PARTIAL";
  items: Array<{
    invoiceItemId: string;
    returnQuantity: number;
    reason: "Defective" | "Damaged" | "Wrong Item" | "Customer Return" | "Price Adjustment" | "Other";
    reasonNotes?: string;
    restockAction: "RESTOCK_SALEABLE" | "RESTOCK_DAMAGED" | "FINANCIAL_CREDIT_ONLY";
  }>;
  notes?: string;
  clientMutationId?: string;
}

export interface SalesReturnResult {
  success: boolean;
  salesReturn?: SalesReturn;
  creditNote?: CreditNote;
  voucherId?: string;
  salesReturnId?: string;
  creditNoteNumber?: string;
  error?: string;
  code?: string;
}

export interface ReverseSalesReturnInput {
  companyId: string;
  salesReturnId: string;
  callerUid: string;
  idToken: string;
  reason?: string;
}

export interface ReverseSalesReturnResult {
  success: boolean;
  salesReturnId?: string;
  reversalVoucherId?: string;
  restoredInvoiceBalance?: number;
  error?: string;
  code?: string;
}

export interface ISalesReturnRepository {
  postSalesReturn(input: PostSalesReturnInput): Promise<SalesReturnResult>;
  reverseSalesReturn(input: ReverseSalesReturnInput): Promise<ReverseSalesReturnResult>;
  getSalesReturn(companyId: string, salesReturnId: string): Promise<SalesReturn | null>;
  listSalesReturns(companyId: string, branchId?: string): Promise<SalesReturn[]>;
  getReturnsForInvoice(companyId: string, originalInvoiceId: string): Promise<SalesReturn[]>;
}

export interface IInventoryRepository {
  recordMovement(companyId: string, movement: any): Promise<void>;
  getBranchStock(companyId: string, branchId: string, productId: string): Promise<number>;
}
