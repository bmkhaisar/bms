# BMS NEXT — Phase 2: Accounting Engine Core Plan (Revised)

> **Document Version:** 3.0.0  
> **Status:** Implementation Approved with 34 Architectural Additions  
> **Domain:** Core Double-Entry Ledger, Financial Vouchers, Reporting Engine & Invariants  
> **Target Release:** Phase 2  
> **Date:** September 2026  

---

## 1. Executive Summary & Core Accounting Invariants

Phase 2 establishes the uncompromised double-entry general ledger core of BMS NEXT. It serves as the single financial backbone for all future operational modules (Sales Invoices, Purchases, Inventory Movements, Banking, and Payroll).

### Fundamental Invariant
$$\sum \text{Debit} \equiv \sum \text{Credit}$$

**Never allow an unbalanced voucher to post.**

---

## 2. The 34 Mandatory Architectural Corrections & Rules

### 1. Opening Balances Must Enter Double-Entry Accounting
- Opening balances are not merely stored on `ledger.openingBalance` to be manually injected into reports.
- Opening balances are posted through an auditable system **Opening Balance Voucher / Opening Journal** (`voucherType: "journal"`, `sourceType: "opening_balance"`).
- Debits and credits must balance ($\sum Dr \equiv \sum Cr$). Any net equity difference is offset against `Capital / Opening Balance Equity` (`led_{companyId}_opening_offset`).
- `ledger.openingBalance` is retained strictly as metadata/cache; all reports (Trial Balance, Ledger Statement, Balance Sheet) derive from accounting vouchers.

### 2. Account Nature Separate from Normal Balance
Each group and ledger explicitly tracks:
- `nature`: `"asset"` | `"liability"` | `"equity"` | `"income"` | `"expense"`
- `normalBalance`: `"debit"` | `"credit"`
  - Asset $\rightarrow$ debit
  - Expense $\rightarrow$ debit
  - Liability $\rightarrow$ credit
  - Equity $\rightarrow$ credit
  - Income $\rightarrow$ credit
- Accounting behavior is driven by structural metadata, never inferred from names like "Cash" or "Sales".

### 3. System Groups Protection & Cycle Prevention
- Root groups (`grp_assets`, `grp_liabilities`, `grp_equity`, `grp_income`, `grp_expenses`) cannot be deleted or have their nature modified.
- Subgroups must inherit a valid root nature.
- Hierarchy validation strictly prevents cycles ($A \rightarrow B \rightarrow A$) and prevents a group from becoming its own ancestor or descendant.

### 4. System Ledgers Protection
- Required system ledgers (`Cash in Hand`, `Opening Balance Equity / Offset`) are flagged `isSystem: true`.
- Cannot be deleted or have accounting semantics corrupted.

### 5. Ledger Deactivation, Not Deletion
- A ledger with posted transactions is **never physically deleted**.
- Status is set to `active: false`. It remains historically resolvable.
- Only unused ledgers with zero transactions may optionally be purged.

### 6. Explicit Voucher State Lifecycle
- `draft`: Editable, excluded from financial reports.
- `posted`: Immutable financial entry, included in reports.
- `reversed`: Original remains visible; neutralized by separate reversal counter-voucher.
- `cancelled`: Only permitted for pre-posting drafts. A posted voucher cannot be deleted or simply "cancelled".

### 7. Reversal Must Use a New Voucher
- Original voucher lines are **never mutated**.
- Reversal generates an equal opposite counter-entry: swaps Debit and Credit.
- Linked via `original.reversalVoucherId` and `reversal.reversedVoucherId`.
- Both vouchers are logged in the audit trail.

### 8. Explicit Reversal Date Rules
- Reversals do not assume the original voucher date.
- Explicit business date (`YYYY-MM-DD`) is provided.
- Validates financial year boundaries and period locks. If original FY is locked, reversal into that locked period is rejected.

### 9. Server-Side Financial Year Locking
- When `financialYear.locked === true`, the server posting engine strictly rejects:
  - New voucher postings
  - Draft edits
  - Reversals targeting the locked period
  - Opening balance modifications

### 10. Branch Scoping in Every Voucher
- Every voucher header includes `branchId` (defaults to `br_main`).
- Server validates that the branch belongs to the company and is active.

### 11. Cost Centre Foundation
- Voucher lines support optional `costCentreId?: string`.
- Validated if supplied.

### 12. Source Document Linking
- Vouchers include:
  - `sourceType?: string` (e.g. `"sales_invoice"`, `"purchase_bill"`, `"opening_balance"`)
  - `sourceId?: string`
  - `sourceNumber?: string`
- Facilitates future seamless linkage: Invoice $\rightarrow$ Voucher $\rightarrow$ Ledger.

### 13. External Reference vs Internal Technical ID
- `id` / `voucherId`: Immutable technical ID (`vouch_{timestamp}_{random}`). Used as Firebase RTDB key.
- `voucherNumber`: Human accounting sequence number (e.g. `JV/2026-27/000001`).
- `reference`: User/external reference (cheque #, supplier bill #).
- `voucherNumber` is **never** used as a primary key.

### 14. Document Numbering Scoping
- Atomic counters scoped by: `companyId` / `financialYearId` / `voucherType`.
- Allocated via atomic RTDB server transaction.
- **Never reuse an allocated accounting document number.** Gaps are acceptable and auditable.

### 15. Persistent Idempotency Storage & Payload Conflict Detection
- Dedicated mutation index: `companyData/{companyId}/mutationIds/{clientMutationId}` storing `{ voucherId, payloadHash, timestamp }`.
- Same `clientMutationId` with altered payload is rejected as an idempotency conflict (`IDEMPOTENCY_CONFLICT`), not silently returned.

### 16. Centralized Money Type (`MoneyPaise`)
- Shared module `src/modules/accounting/domain/money.ts`.
- `type MoneyPaise = number` (integer paise).
- `toPaise()`, `fromPaise()`, `formatPaise()`, `addMoney()`, `subtractMoney()`, `isSafeMoney()`.
- Validates `Number.isSafeInteger(val)` and non-negative line rules.
- Posting engine never operates on floating-point rupees.

### 17. Canonical Date Representation (`YYYY-MM-DD`)
- Accounting date is stored canonically as `YYYY-MM-DD` string (e.g. `"2026-04-15"`).
- Separate ms epoch timestamps for `createdAt`, `postedAt`, `updatedAt`.
- Prevents timezone offset shifts.

### 18. Flexible Payment / Receipt Semantic Rules
- **Payment:** At least one credited line must be an eligible Cash/Bank ledger. Debited lines can be Expenses, Suppliers, Loans, etc.
- **Receipt:** At least one debited line must be an eligible Cash/Bank ledger. Credited lines can be Customers, Income, etc.
- **Contra:** All effective lines must be Cash/Bank liquidity ledgers.
- **Journal:** Multi-line double entry without liquidity restrictions.

### 19. Multi-Line Payment & Receipt Support
- Payments and receipts can contain arbitrary numbers of lines ($\ge 2$) for split payments, multi-expense vouchers, or batch disbursements.

### 20. Reports Derive Exclusively from Posted Entries
- Day Book, Ledger Statement, and Trial Balance calculate solely from `posted` and `reversed` vouchers.
- Drafts, unposted invoices, and cached totals are excluded.

### 21. Running Balance Derived, Not Authoritative Truth
- Ledger running balances are derived from ordered posted transactions.
- `ledger.currentBalance` is an operational summary cache, fully reproducible from the ledger stream.

### 22. Deterministic Report Ordering
- Report lines are sorted deterministically:
  `accountingDate` $\rightarrow$ `postedAt` $\rightarrow$ `voucherNumber` $\rightarrow$ `voucherId`.

### 23. Trial Balance "As of Date" Model
- Supports "As of Date" calculation: balances calculated up to the requested business date.

### 24. P&L and Balance Sheet Preparedness
- Balance Sheet classification: Assets, Liabilities, Equity.
- Profit & Loss classification: Income, Expenses.
- Driven by account `nature` and `normalBalance`.

### 25. Year-End Closing & Retained Earnings Foundation
- Net income ($\text{Income} - \text{Expenses}$) transfers to Retained Earnings at year-end closing via double entry without mutating past vouchers.

### 26. Granular Audit Logging with Before/After Diffs
- Master changes log: `entityType`, `entityId`, `action`, `actorUid`, `timestamp`, `before`, `after`.
- No sensitive credentials or tokens.

### 27. Granular Capability Checks
- Centralized capabilities:
  - `accounting.groups.read`, `accounting.groups.manage`
  - `accounting.ledgers.read`, `accounting.ledgers.create`, `accounting.ledgers.update`
  - `accounting.vouchers.read`, `accounting.vouchers.create`, `accounting.vouchers.post`, `accounting.vouchers.reverse`
  - `accounting.reports.read`

### 28. Shared Accounting Domain Model
- Centralized domain definitions in `src/modules/accounting/domain/`:
  - `money.ts`
  - `account.ts`
  - `ledger.ts`
  - `voucher.ts`
  - `schemas.ts`

### 29. Decoupled Report Engine
- `src/modules/accounting/services/reportEngine.ts`:
  - `getDayBook()`
  - `getLedgerStatement()`
  - `getTrialBalance()`
- UI renders report results; business calculations remain pure.

### 30. Modular UI Route Architecture
- Thin route component in `src/routes/_app.ledger.tsx`.
- Focused components in `src/modules/accounting/components/`.

### 31. Idempotent `ensureChartOfAccounts`
- Server-side idempotent function. Initializes missing system groups/ledgers without duplicating or overwriting existing user data.

### 32. Zero Demo Accounting Data
- No fake journals, fake invoices, or fake bank records. System groups and system ledgers only.

### 33. Expanded Invariant Test Suite
- Comprehensive automated tests covering all 34 requirements.

### 34. Phase 2 Completion Criteria
- Proven end-to-end integration across all modules with 100% test pass rate.
- Production posting marked `BLOCKED_BY_CREDENTIALS` until live admin credentials provided.

---
