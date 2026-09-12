# BMS NEXT — Double-Entry Voucher Posting Engine

> **Specification & Technical Standard**  
> **Status:** Active / Production Core  
> **Target Release:** Phase 2  
> **Date:** September 2026  

---

## 1. Overview & Architectural Pipeline

The Voucher Posting Engine executes all double-entry financial transactions within BMS NEXT. It operates strictly on the server, enforcing immutable accounting rules before committing atomic multi-path updates to the Firebase Realtime Database.

```
[ Client UI (Voucher Entry Modal) ]
             │
             ▼
[ postVoucherServerFn / reverseVoucherServerFn ]  (TanStack Start RPC)
             │
             ├─► 1. Verify Firebase Auth Token (callerUid)
             ├─► 2. Verify Membership & Capability ('accounting.voucher.create' / 'void')
             ├─► 3. Idempotency Check: `voucherMutations/{clientMutationId}`
             ├─► 4. Validate Financial Year exists and is unlocked
             ├─► 5. Validate Voucher Date is within Financial Year bounds
             ├─► 6. Line Invariant Checks: >= 2 lines, single side per line, no zeros/negatives
             ├─► 7. Fundamental Rule: Total Debit === Total Credit (in integer paise)
             ├─► 8. Tenant Isolation: Verify all ledgers belong to active company & are active
             ├─► 9. Type Semantic Checks:
             │      • Contra: Both debit & credit must be Cash or Bank accounts
             │      • Payment: Must credit at least one Cash or Bank liquidity account
             │      • Receipt: Must debit at least one Cash or Bank liquidity account
             │      • Journal: Multi-line double-entry entry
             ├─► 10. Allocate Concurrency-Safe Sequence Number (numberingEngine)
             ├─► 11. Prepare Atomic Multi-Path RTDB Updates
             ▼
[ Firebase Realtime Database Multi-Path Commit ]
```

---

## 2. Step-by-Step Validation Sequence

### Step 1: Authentication & Identity
- Verifies Firebase Auth ID token using Firebase Admin SDK.
- Extracts authoritative caller UID.
- If Firebase Admin credentials are unconfigured on server, returns `SERVER_CONFIG_REQUIRED` / `BLOCKED_BY_CREDENTIALS`.

### Step 2: Tenant Membership & Permissions
- Verifies caller has an active record in `memberships/{companyId}/{callerUid}`.
- Checks capability:
  - For posting: `accounting.voucher.create` (or `owner` / `accountant` role).
  - For reversing: `accounting.voucher.void` (or `owner` / `accountant` role).

### Step 3: Idempotency Protection
- Queries `companyData/{companyId}/voucherMutations/{clientMutationId}`.
- If mutation already exists, returns the previously posted voucher with code `ALREADY_POSTED`.
- Prevents double-submissions caused by duplicate clicks or network retry storms.

### Step 4: Financial Year & Date Bounds
- Verifies `companyData/{companyId}/financialYears/{financialYearId}` exists and is not locked (`locked === false`).
- Verifies `voucherDate >= fy.startDate && voucherDate <= fy.endDate`.
- Rejects entries backdated or postdated outside the financial period.

### Step 5: Line Validation
- Requires at least 2 lines.
- For each line:
  - Validates `ledgerId` is provided.
  - Converts amounts to integer paise (or rounds if paise provided).
  - Disallows negative debits or credits (`debit < 0 || credit < 0`).
  - Disallows zero lines (`debit === 0 && credit === 0`).
  - Disallows dual-sided lines (`debit > 0 && credit > 0`).

### Step 6: Mathematical Double-Entry Invariant
$$\sum \text{Debit (paise)} \equiv \sum \text{Credit (paise)}$$
- If `totalDebit !== totalCredit`, posting is rejected with `UNBALANCED_VOUCHER`.

### Step 7: Tenant Isolation on Ledgers
- Loads all referenced ledgers from `companyData/{companyId}/ledgers/{ledgerId}`.
- If any ledger is missing or has a different `companyId`, rejects with `FORBIDDEN` (Tenant violation).
- Verifies all ledgers are active (`active !== false`).

### Step 8: Voucher Type Semantic Constraints
- **Contra (`contra`):** All lines must reference Cash or Bank liquidity ledgers (`partyType in ['cash', 'bank']` or group in Cash/Bank).
- **Payment (`payment`):** Must credit at least one Cash or Bank liquidity account (source of outgoing funds).
- **Receipt (`receipt`):** Must debit at least one Cash or Bank liquidity account (destination of incoming funds).
- **Journal (`journal`):** General multi-line adjustments, provisions, and transfers.

### Step 9: Concurrency-Safe Sequence Allocation
- Executes an atomic transaction on:
  `/companyData/{companyId}/docCounters/{financialYearId}/vouchers/{voucherType}`
- Returns monotonic sequence number formatted: `{PREFIX}/{FY_CODE}/{000001}`.

### Step 10: Atomic Multi-Path Commit
Atomically writes to RTDB in a single operation:
1. `companyData/{companyId}/vouchers/{voucherId}` (Header)
2. `companyData/{companyId}/voucherLines/{voucherId}/{lineId}` (Lines)
3. `companyData/{companyId}/ledgers/{ledgerId}/currentBalance` (Updated balances: $Current + Debit - Credit$)
4. `companyData/{companyId}/ledgers/{ledgerId}/updatedAt`
5. `companyData/{companyId}/voucherMutations/{clientMutationId}` (Idempotency token)
6. `companyData/{companyId}/auditLogs/{auditId}` (Audit log)

---

## 3. Voucher Reversal Workflow

Posted financial vouchers are **never deleted**. When a correction is required:
1. Client calls `reverseVoucherServerFn({ voucherId, reversalReason, clientMutationId })`.
2. Engine verifies original voucher exists and is in `posted` status.
3. Engine generates exact opposite counter-entries (swapping debit and credit for each line).
4. Allocates a new sequence number for the reversal voucher.
5. Performs an atomic multi-path update:
   - Original voucher `status` becomes `"reversed"`, linked via `reversalVoucherId`.
   - New reversal counter-voucher is inserted with `reversedVoucherId`.
   - Ledger balances are restored to their pre-voucher values.
   - Audit trail records the reversal reason and caller UID.

---

## 4. Error Code Reference

| Code | HTTP / Meaning | Description |
| :--- | :--- | :--- |
| `UNAUTHORIZED` | 401 | Missing or invalid Firebase Auth token |
| `FORBIDDEN` | 403 | Non-member, inactive member, or cross-company tenant violation |
| `SERVER_CONFIG_REQUIRED` | 503 / BLOCKED | Firebase Admin credentials not configured on server |
| `INVALID_INPUT` | 400 | Missing required fields, zero/negative line, or bad dates |
| `UNBALANCED_VOUCHER` | 422 | Total Debit does not equal Total Credit |
| `PERIOD_LOCKED` | 423 | Financial year is locked for changes |
| `ALREADY_POSTED` | 200 (Idempotent) | Duplicate `clientMutationId` returns existing voucher |
| `NOT_FOUND` | 404 | Referenced voucher or ledger does not exist |
| `INVALID_STATE` | 409 | Voucher is not in a valid state for reversal (e.g. already reversed) |
| `INTERNAL_ERROR` | 500 | Database transaction or write failure |
