import type { AccountNature, NormalBalance } from "./account";
import type { MoneyPaise } from "./money";

export type PartyType = "customer" | "supplier" | "bank" | "cash" | "general";

export interface BankMetadata {
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  branchName?: string;
  upiId?: string;
}

/**
 * General Ledger / Subledger Entity.
 * Balances are computed in integer paise.
 */
export interface Ledger {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  groupId: string;
  groupNature: AccountNature;
  normalBalance: NormalBalance;
  openingBalance: MoneyPaise;       // Integer paise (setup cache / metadata)
  openingBalanceType: "dr" | "cr";
  currentBalance: MoneyPaise;       // Integer paise (signed: positive = Dr, negative = Cr)
  currency: string;                 // "INR"
  gstin?: string;
  pan?: string;
  partyType?: PartyType;
  partyId?: string;                 // Links to customerId or supplierId
  bankDetails?: BankMetadata;
  isSystem: boolean;                // System ledgers cannot be deleted
  active: boolean;                  // Deactivated ledgers reject new postings
  createdAt: number;
  updatedAt: number;
}
