import type { MoneyPaise } from "./money";

export type VoucherPartyType = "SUNDRY_DEBTOR" | "SUNDRY_CREDITOR";

export type VoucherType = "journal" | "payment" | "receipt" | "contra";

export type VoucherStatus = "draft" | "posted" | "reversed" | "cancelled";

/**
 * Individual accounting line in a double-entry voucher.
 * Amounts are integer paise. Exactly one of debit or credit must be positive (> 0); the other must be 0.
 */
export interface VoucherLine {
  id: string;
  ledgerId: string;
  ledgerName?: string;
  debit: MoneyPaise;            // In integer paise (0 if credit)
  credit: MoneyPaise;           // In integer paise (0 if debit)
  description?: string;
  costCentreId?: string;        // Future cost-centre tracking
  partyType?: VoucherPartyType;
  partyId?: string;             // Customer or supplier ID
  relatedEntityType?: string;   // For invoice/bill/asset linkages
  relatedEntityId?: string;
}

/**
 * Double-Entry Financial Voucher.
 * Invariant: totalDebit === totalCredit at all times when posted.
 */
export interface Voucher {
  id: string;                   // Immutable technical ID (vouch_{timestamp}_{random}) -> RTDB key
  companyId: string;            // Multi-tenant partition
  financialYearId: string;      // Financial Year ID
  branchId: string;             // Branch partition (e.g. "br_main")
  voucherType: VoucherType;
  voucherNumber: string;        // Human sequence number (e.g. "JV/2026-27/000001")
  date: string;                 // Canonical business date: "YYYY-MM-DD"
  reference?: string;           // External bill, cheque, or transaction reference
  narration: string;            // Business memo
  status: VoucherStatus;
  lines: VoucherLine[];
  totalDebit: MoneyPaise;       // Integer paise
  totalCredit: MoneyPaise;      // Integer paise
  sourceType?: string;          // e.g. "sales_invoice", "purchase_bill", "opening_balance"
  sourceId?: string;
  sourceNumber?: string;
  clientMutationId: string;     // Idempotency token (UUID)
  createdBy: string;            // Caller UID
  createdAt: number;            // Timestamp in ms
  postedBy?: string;            // Posting caller UID
  postedAt?: number;            // Timestamp in ms
  reversedVoucherId?: string;   // Link to original voucher if this is a reversal
  reversalVoucherId?: string;   // Link to counter-voucher if this was reversed
}
