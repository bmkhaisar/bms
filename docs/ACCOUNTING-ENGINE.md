# BMS NEXT — Core Accounting Engine Architecture

> **Specification & Architectural Standard**  
> **Status:** Active / Production Core  
> **Target Release:** Phase 2  
> **Date:** September 2026  

---

## 1. Executive Summary & The Golden Accounting Invariant

The BMS NEXT Accounting Engine is the uncompromised double-entry general ledger core of the platform. It serves as the single source of financial truth for all operational modules — including Sales Invoices, Purchase Bills, Inventory Stock Valuation, Payments, Receipts, Banking, and Payroll.

### The Golden Rule of Accounting
$$\sum \text{Debit} \equiv \sum \text{Credit}$$

**No unbalanced transaction can ever post to the ledger.**

---

## 2. Fundamental Architectural Guarantees

### 1. Integer Minor Units (Paise Representation)
To eliminate IEEE-754 floating-point rounding errors that corrupt balance sheets in high-volume ERPs, **all monetary quantities are stored and computed in integer paise (1 INR = 100 paise)**:
- ₹1,250.50 is stored internally as `125050`.
- Debits, credits, ledger current balances, opening balances, and voucher totals are all strictly integers.
- Display formatting transforms paise to standard INR representation (`formatPaise(125050)` $\rightarrow$ `₹1,250.50`).

### 2. Server-Only Privileged Writes
Clients never write directly to sensitive financial paths. In `database.rules.json`:
```json
"vouchers": { ".write": false },
"voucherLines": { ".write": false },
"docCounters": { ".write": false },
"auditLogs": { ".write": false },
"stockMovements": { ".write": false }
```
Posting and reversal operations execute strictly through authenticated server functions (`postVoucherServerFn`, `reverseVoucherServerFn`).

### 3. Graceful Fallback (`SERVER_CONFIG_REQUIRED` / `BLOCKED_BY_CREDENTIALS`)
When remote server Firebase Admin credentials are unconfigured, server posting functions cleanly return:
```json
{
  "success": false,
  "code": "SERVER_CONFIG_REQUIRED",
  "error": "Server configuration required. Firebase Admin credentials must be configured on the server."
}
```
The client browser **never** falls back to insecure client-side mutations.

### 4. Idempotency via `clientMutationId`
Every client posting and reversal request includes a client-generated UUID `clientMutationId`. Retries, duplicate double-clicks, and network reconnects return the existing voucher without re-posting lines or double-incrementing balances.

### 5. Voucher Immutability & Reversal Workflow
Once a voucher is in `posted` status, its accounting lines cannot be edited. Corrections are performed by generating an auditable **reversal voucher** that swaps debits and credits, restoring balances, followed by posting the corrected voucher.

---

## 3. Voucher Lifecycle State Model

```
   [ Draft ] ──(post)──► [ Posted ] ──(reverse)──► [ Reversed ]
       │                      │
   (cancel)               (reverse + void)
       │                      │
       ▼                      ▼
  [ Cancelled ]          [ Reversed ]
```

| Status | Financial Effect | Mutable? | Description |
| :--- | :--- | :--- | :--- |
| `draft` | None | Yes | Preparation state prior to authorization |
| `posted` | Realtime General Ledger | **No** | Active double-entry transaction affecting ledger balances |
| `reversed` | Counterbalanced | **No** | Inactivated via equal-and-opposite counter voucher |
| `cancelled` | Voided | **No** | Cancelled without ledger impact |

---

## 4. Voucher & Line Data Structures

### Voucher Header (`companyData/{companyId}/vouchers/{voucherId}`)
- `id`: Unique identifier (`vouch_{timestamp}_{random}`)
- `companyId`: Multi-tenant company partition
- `financialYearId`: Active financial year ID
- `branchId`: Branch partition (e.g. `br_main`)
- `voucherType`: `"journal"` | `"payment"` | `"receipt"` | `"contra"`
- `voucherNumber`: Formatted sequence (`JV/2026-27/000001`, etc.)
- `date`: Epoch timestamp in ms (verified within FY boundaries)
- `reference`: External cheque, invoice, or bill reference
- `narration`: Transaction description
- `status`: `"draft"` | `"posted"` | `"reversed"` | `"cancelled"`
- `lines`: Array of `VoucherLine` objects
- `totalDebit`: Total debited paise
- `totalCredit`: Total credited paise ($\equiv$ `totalDebit`)
- `clientMutationId`: Idempotency token
- `createdBy`: Caller UID
- `createdAt`: Timestamp
- `postedBy`: Approver/Poster UID
- `postedAt`: Posting timestamp
- `reversedVoucherId`: Link to original voucher if this is a reversal
- `reversalVoucherId`: Link to reversal counter-voucher if this was reversed

### Voucher Line (`companyData/{companyId}/voucherLines/{voucherId}/{lineId}`)
- `id`: Line identifier (`line_{index}_{random}`)
- `ledgerId`: Referenced general ledger account
- `ledgerName`: Display title of account
- `debit`: Integer paise (> 0 if debit, 0 if credit)
- `credit`: Integer paise (> 0 if credit, 0 if debit)
- `description`: Line-level memo or particulars
- `costCentreId`: Optional cost centre
- `partyType`: `"customer"` | `"supplier"` | `"bank"` | `"cash"` | `"general"`
- `partyId`: Customer/supplier entity reference

---

## 5. Concurrency-Safe Sequence Counters

Counters are allocated atomically using Firebase Realtime Database server-side transactions at:
`/companyData/{companyId}/docCounters/{financialYearId}/vouchers/{voucherType}`

### Formats:
- Journal Voucher: `JV/{FY_CODE}/{000001}`
- Payment Voucher: `PAY/{FY_CODE}/{000001}`
- Receipt Voucher: `REC/{FY_CODE}/{000001}`
- Contra Voucher: `CON/{FY_CODE}/{000001}`

---

## 6. Financial Reports in Phase 2

1. **Day Book:** Chronological audit trail of all posted financial vouchers with date range and voucher type filtering. Proves daily Total Debit $\equiv$ Total Credit.
2. **Ledger Statement:** Single-account statement showing opening balance, dated voucher lines, and running balance ($Balance_t = Balance_{t-1} + Dr - Cr$).
3. **Trial Balance:** Hierarchical overview of all accounts across Assets, Liabilities, Equity, Income, and Expenses. Formally proves Total Debit $\equiv$ Total Credit across the company.
4. **Opening Balance Offset:** Double-entry balancing mechanism ensuring opening balances enter the Trial Balance in perfect equilibrium via `led_{companyId}_opening_offset`.
