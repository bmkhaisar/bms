import type { AccountGroup, Ledger } from "./types";

export interface SystemGroupDefinition {
  id: string;
  name: string;
  parentGroupId: string | null;
  nature: "asset" | "liability" | "equity" | "income" | "expense";
  isSystem: boolean;
  isLiquidity?: boolean;
}

export const SYSTEM_ACCOUNT_GROUPS: SystemGroupDefinition[] = [
  // 1. Top Level Primary Groups
  { id: "grp_assets", name: "Assets", parentGroupId: null, nature: "asset", isSystem: true },
  { id: "grp_liabilities", name: "Liabilities", parentGroupId: null, nature: "liability", isSystem: true },
  { id: "grp_equity", name: "Equity & Capital", parentGroupId: null, nature: "equity", isSystem: true },
  { id: "grp_income", name: "Income", parentGroupId: null, nature: "income", isSystem: true },
  { id: "grp_expenses", name: "Expenses", parentGroupId: null, nature: "expense", isSystem: true },

  // 2. Asset Sub-Groups
  { id: "grp_current_assets", name: "Current Assets", parentGroupId: "grp_assets", nature: "asset", isSystem: true },
  { id: "grp_fixed_assets", name: "Fixed Assets", parentGroupId: "grp_assets", nature: "asset", isSystem: true },
  { id: "grp_cash_equiv", name: "Cash & Cash Equivalents", parentGroupId: "grp_current_assets", nature: "asset", isSystem: true, isLiquidity: true },
  { id: "grp_cash", name: "Cash in Hand", parentGroupId: "grp_cash_equiv", nature: "asset", isSystem: true, isLiquidity: true },
  { id: "grp_bank", name: "Bank Accounts", parentGroupId: "grp_cash_equiv", nature: "asset", isSystem: true, isLiquidity: true },
  { id: "grp_sundry_debtors", name: "Accounts Receivable (Sundry Debtors)", parentGroupId: "grp_current_assets", nature: "asset", isSystem: true },
  { id: "grp_inventory", name: "Stock-in-Hand (Inventory)", parentGroupId: "grp_current_assets", nature: "asset", isSystem: true },
  { id: "grp_loans_advances", name: "Loans & Advances", parentGroupId: "grp_current_assets", nature: "asset", isSystem: true },

  // 3. Liability Sub-Groups
  { id: "grp_current_liabilities", name: "Current Liabilities", parentGroupId: "grp_liabilities", nature: "liability", isSystem: true },
  { id: "grp_non_current_liab", name: "Long-Term Borrowings", parentGroupId: "grp_liabilities", nature: "liability", isSystem: true },
  { id: "grp_sundry_creditors", name: "Accounts Payable (Sundry Creditors)", parentGroupId: "grp_current_liabilities", nature: "liability", isSystem: true },
  { id: "grp_duties_taxes", name: "Duties & Taxes (GST)", parentGroupId: "grp_current_liabilities", nature: "liability", isSystem: true },
  { id: "grp_provisions", name: "Provisions & Accrued Expenses", parentGroupId: "grp_current_liabilities", nature: "liability", isSystem: true },

  // 4. Equity Sub-Groups
  { id: "grp_capital", name: "Capital Account", parentGroupId: "grp_equity", nature: "equity", isSystem: true },
  { id: "grp_retained_earnings", name: "Retained Earnings", parentGroupId: "grp_equity", nature: "equity", isSystem: true },
  { id: "grp_equity_offset", name: "Opening Balance Offset", parentGroupId: "grp_equity", nature: "equity", isSystem: true },

  // 5. Income Sub-Groups
  { id: "grp_direct_income", name: "Sales / Direct Income", parentGroupId: "grp_income", nature: "income", isSystem: true },
  { id: "grp_indirect_income", name: "Indirect / Other Income", parentGroupId: "grp_income", nature: "income", isSystem: true },

  // 6. Expense Sub-Groups
  { id: "grp_direct_expenses", name: "Purchases / COGS", parentGroupId: "grp_expenses", nature: "expense", isSystem: true },
  { id: "grp_operating_expenses", name: "Operating & Administrative Expenses", parentGroupId: "grp_expenses", nature: "expense", isSystem: true },
  { id: "grp_salary_expenses", name: "Salary & Employee Benefits", parentGroupId: "grp_expenses", nature: "expense", isSystem: true },
  { id: "grp_other_expenses", name: "Other Expenses", parentGroupId: "grp_expenses", nature: "expense", isSystem: true },
];

/**
 * Default foundational system ledgers automatically initialized for every company.
 */
export function getDefaultSystemLedgers(companyId: string, now: number): Omit<Ledger, "updatedAt">[] {
  return [
    {
      id: `led_${companyId}_cash`,
      companyId,
      name: "Cash in Hand",
      code: "CASH",
      groupId: "grp_cash",
      groupNature: "asset",
      openingBalance: 0,
      openingBalanceType: "dr",
      currentBalance: 0,
      currency: "INR",
      partyType: "cash",
      active: true,
      createdAt: now,
    },
    {
      id: `led_${companyId}_opening_offset`,
      companyId,
      name: "Opening Balance Offset / Suspense",
      code: "OP-OFFSET",
      groupId: "grp_equity_offset",
      groupNature: "equity",
      openingBalance: 0,
      openingBalanceType: "cr",
      currentBalance: 0,
      currency: "INR",
      partyType: "general",
      active: true,
      createdAt: now,
    },
  ];
}
