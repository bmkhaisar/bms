import { z } from "zod";

/**
 * Fundamental classification of accounts according to double-entry accounting.
 */
export type AccountNature = "asset" | "liability" | "equity" | "income" | "expense";

export const accountNatureSchema = z.enum([
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

/**
 * Account Group in the Chart of Accounts hierarchy.
 */
export interface AccountGroup {
  id: string;
  companyId: string;
  name: string;
  parentGroupId?: string | null;
  nature: AccountNature;
  isSystem: boolean;
  isLiquidity?: boolean; // True for Cash & Bank groups (eligible for Contra)
  sortOrder?: number;
  createdAt?: number;
}

export type PartyType = "customer" | "supplier" | "bank" | "cash" | "general";

export interface BankMetadata {
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  branchName?: string;
  upiId?: string;
}

/**
 * Ledger Account (General Ledger or Subledger).
 * Note: Balances are stored in integer minor units (paise) internally.
 */
export interface Ledger {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  groupId: string;
  groupNature: AccountNature;
  openingBalance: number;       // In integer paise
  openingBalanceType: "dr" | "cr";
  currentBalance: number;       // In integer paise (positive = Debit balance, negative = Credit balance)
  currency: string;             // "INR"
  gstin?: string;
  pan?: string;
  partyType?: PartyType;
  partyId?: string;             // Links to customerId or supplierId
  bankDetails?: BankMetadata;
  isSystem?: boolean;
  normalBalance?: "debit" | "credit";
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export type VoucherType = "journal" | "payment" | "receipt" | "contra";

export const voucherTypeSchema = z.enum(["journal", "payment", "receipt", "contra"]);

export type VoucherStatus = "draft" | "posted" | "reversed" | "cancelled";

export const voucherStatusSchema = z.enum(["draft", "posted", "reversed", "cancelled"]);

/**
 * Individual accounting line within a double-entry voucher.
 * Amounts are represented in integer paise.
 * Exactly one of debit or credit must be positive (> 0); the other must be 0.
 */
export interface VoucherLine {
  id: string;
  ledgerId: string;
  ledgerName?: string;
  debit: number;                // In integer paise (0 if credit)
  credit: number;               // In integer paise (0 if debit)
  description?: string;
  partyType?: PartyType;
  partyId?: string;
  costCentreId?: string;
}

/**
 * Double-entry Voucher Header & Lines.
 * Invariant: totalDebit === totalCredit at all times when posted.
 */
export interface Voucher {
  id: string;
  companyId: string;
  financialYearId: string;
  branchId: string;
  voucherType: VoucherType;
  voucherNumber: string;        // e.g. "JV/2026-27/000001"
  date: number;                 // Epoch timestamp in milliseconds
  reference?: string;           // External bill, invoice, or cheque reference
  narration: string;
  status: VoucherStatus;
  lines: VoucherLine[];
  totalDebit: number;           // In integer paise
  totalCredit: number;          // In integer paise
  sourceType?: string;
  sourceId?: string;
  sourceNumber?: string;
  clientMutationId: string;     // Idempotency token (UUID)
  createdBy: string;
  createdAt: number;
  postedBy?: string;
  postedAt?: number;
  reversedVoucherId?: string;   // If this voucher was created to reverse an earlier voucher
  reversalVoucherId?: string;   // If this voucher has been reversed by a later voucher
}

/**
 * Input DTO for posting a new voucher through the server engine.
 */
export interface PostVoucherInput {
  idToken: string;
  companyId: string;
  financialYearId: string;
  branchId?: string;
  voucherType: VoucherType;
  date: number | string;
  reference?: string;
  narration: string;
  sourceType?: string;
  sourceId?: string;
  sourceNumber?: string;
  lines: {
    ledgerId: string;
    debit: number;              // In integer paise or rupees (server validates)
    credit: number;             // In integer paise or rupees
    description?: string;
    partyType?: PartyType;
    partyId?: string;
  }[];
  clientMutationId: string;
  amountsInRupees?: boolean;    // If true, numbers are multiplied by 100 to convert to paise
}

export interface PostVoucherResult {
  success: boolean;
  voucher?: Voucher;
  voucherId?: string;
  voucherNumber?: string;
  alreadyPosted?: boolean;
  error?: string;
  code?:
    | "UNAUTHORIZED"
    | "SESSION_EXPIRED"
    | "FORBIDDEN"
    | "SERVER_CONFIG_REQUIRED"
    | "INVALID_INPUT"
    | "UNBALANCED_VOUCHER"
    | "ALREADY_POSTED"
    | "PERIOD_LOCKED"
    | "INTERNAL_ERROR";
}

/**
 * Input DTO for reversing an existing posted voucher.
 */
export interface ReverseVoucherInput {
  idToken: string;
  companyId: string;
  voucherId: string;
  reversalReason: string;
  reversalDate?: number;
  clientMutationId: string;
}

export interface ReverseVoucherResult {
  success: boolean;
  originalVoucherId?: string;
  reversalVoucherId?: string;
  reversalVoucherNumber?: string;
  alreadyReversed?: boolean;
  error?: string;
  code?:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "SERVER_CONFIG_REQUIRED"
    | "NOT_FOUND"
    | "ALREADY_REVERSED"
    | "INVALID_STATE"
    | "INTERNAL_ERROR";
}

/**
 * Input DTO for creating/updating a ledger.
 */
export interface ManageLedgerInput {
  idToken: string;
  companyId: string;
  ledgerId?: string;
  name: string;
  code?: string;
  groupId: string;
  openingBalance?: number;      // in paise (or rupees if amountsInRupees = true)
  openingBalanceType?: "dr" | "cr";
  gstin?: string;
  pan?: string;
  partyType?: PartyType;
  partyId?: string;
  bankDetails?: BankMetadata;
  active?: boolean;
  amountsInRupees?: boolean;
}

export interface ManageLedgerResult {
  success: boolean;
  ledger?: Ledger;
  ledgerId?: string;
  error?: string;
  code?: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "INTERNAL_ERROR";
}
