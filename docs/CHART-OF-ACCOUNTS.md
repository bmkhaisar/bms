# BMS NEXT — Chart of Accounts Specification

> **Specification & Standard Reference**  
> **Status:** Active / Production Core  
> **Target Release:** Phase 2  
> **Date:** September 2026  

---

## 1. Overview & Core Philosophy

The Chart of Accounts (CoA) in BMS NEXT forms the structured foundation of all financial classification, general ledger posting, and statutory financial reporting (Trial Balance, Profit & Loss, Balance Sheet).

### The Five Fundamental Account Natures
Every account group and ledger is strictly anchored to one of the five canonical double-entry accounting natures:

| Nature | Normal Balance | Financial Statement | Normal Effect of Debit | Normal Effect of Credit |
| :--- | :--- | :--- | :--- | :--- |
| **`asset`** | Debit (Dr) | Balance Sheet | Increases balance | Decreases balance |
| **`liability`** | Credit (Cr) | Balance Sheet | Decreases balance | Increases balance |
| **`equity`** | Credit (Cr) | Balance Sheet | Decreases balance | Increases balance |
| **`income`** | Credit (Cr) | Profit & Loss | Decreases revenue | Increases revenue |
| **`expense`** | Debit (Dr) | Profit & Loss | Increases expense | Decreases expense |

---

## 2. Standard System Group Hierarchy

BMS NEXT automatically seeds every newly bootstrapped company with a standard, compliant hierarchy:

```
1. Assets (nature: asset, id: grp_assets) [System Root]
   ├── Current Assets (grp_current_assets)
   │   ├── Cash & Cash Equivalents (isLiquidity: true, grp_cash_equiv)
   │   │   ├── Cash in Hand (grp_cash)
   │   │   └── Bank Accounts (grp_bank)
   │   ├── Accounts Receivable (Sundry Debtors) (grp_sundry_debtors)
   │   ├── Stock-in-Hand (Inventory) (grp_inventory)
   │   └── Loans & Advances (grp_loans_advances)
   └── Non-Current Assets (Fixed Assets) (grp_fixed_assets)

2. Liabilities (nature: liability, id: grp_liabilities) [System Root]
   ├── Current Liabilities (grp_current_liabilities)
   │   ├── Accounts Payable (Sundry Creditors) (grp_sundry_creditors)
   │   ├── Duties & Taxes (GST: CGST, SGST, IGST) (grp_duties_taxes)
   │   └── Provisions & Accrued Expenses (grp_provisions)
   └── Non-Current Liabilities (grp_non_current_liab)
       └── Long-Term Borrowings

3. Equity & Capital (nature: equity, id: grp_equity) [System Root]
   ├── Capital Account (grp_capital)
   ├── Retained Earnings (grp_retained_earnings)
   └── Opening Balance Offset Reserve (grp_equity_offset)

4. Income (nature: income, id: grp_income) [System Root]
   ├── Sales / Direct Income (grp_direct_income)
   └── Indirect / Other Income (grp_indirect_income)

5. Expenses (nature: expense, id: grp_expenses) [System Root]
   ├── Purchases / COGS (grp_direct_expenses)
   ├── Operating & Administrative Expenses (grp_operating_expenses)
   ├── Salary & Employee Benefits (grp_salary_expenses)
   └── Other Expenses (grp_other_expenses)
```

---

## 3. Custom Group Creation & Inheritance Guarantee

### Classification Protection Invariant
Users can create custom account groups under any existing parent group. To prevent users from corrupting fundamental account classifications required by financial statements:
- Every custom group **must** specify a `parentGroupId`.
- The custom group's `nature` is **strictly inherited** from the parent group.
- The user cannot choose or change an arbitrary nature for a custom group.
- System groups cannot be deleted or re-classified.

```ts
// Enforced in manageGroup.ts
const parentNature = sysParent ? sysParent.nature : customParent.nature;
group.nature = parentNature; // Guaranteed inheritance
```

---

## 4. Ledger Master Schema & Attributes

A Ledger represents an individual financial account (General Ledger) or subledger entity.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier (`led_{companyId}_{slug/random}`) |
| `companyId` | `string` | Multi-tenant company partition |
| `name` | `string` | Account title (e.g. "Rent Expense", "HDFC Current A/c") |
| `code` | `string?` | Optional short code (e.g. "CASH", "HDFC-01") |
| `groupId` | `string` | References `AccountGroup.id` |
| `groupNature` | `AccountNature` | Inherited root nature (`asset`, `liability`, etc.) |
| `openingBalance`| `number` | Integer paise (always non-negative) |
| `openingBalanceType` | `"dr" \| "cr"` | Debit or Credit classification |
| `currentBalance` | `number` | Running balance in integer paise (signed) |
| `currency` | `string` | ISO currency code (default: `"INR"`) |
| `gstin` | `string?` | GSTIN for tax or party accounts |
| `partyType` | `PartyType` | `"customer" \| "supplier" \| "bank" \| "cash" \| "general"` |
| `partyId` | `string?` | Links to Customer or Supplier master entity |
| `bankDetails` | `BankMetadata?`| Account number, IFSC, branch, UPI ID |
| `active` | `boolean` | Deactivated accounts reject new postings |
| `createdAt` | `number` | Timestamp |
| `updatedAt` | `number` | Timestamp |

---

## 5. Opening Balance Offset Mechanism

In true double-entry bookkeeping, **no balance can exist without an equal and opposite entry**. Storing isolated numbers that never enter the general ledger corrupts the Trial Balance.

### The Double-Entry Equilibrium
When opening balances are recorded:
- If an Asset (e.g. Cash in Hand ₹50,000 Dr) is created:
  $$\text{Debit: Cash in Hand ₹50,000}$$
  $$\text{Credit: Opening Balance Offset / Suspense ₹50,000}$$
- The system automatically counterbalances opening entries in `led_{companyId}_opening_offset` (`Opening Balance Offset / Suspense` under Equity).
- When total opening debits equal total opening credits, the offset account balance is exactly zero.
- Any net discrepancy remains visible in Equity as the opening difference until reconciled, guaranteeing that **Trial Balance $\sum \text{Debit} \equiv \sum \text{Credit}$ holds true from moment zero**.
