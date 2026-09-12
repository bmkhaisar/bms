# BMS NEXT — Offline Synchronization & Conflict Resolution Architecture

> **Document Version:** 1.0.0  
> **Status:** Production Architecture Specification  
> **Domain:** Offline-First Data Synchronization & Integrity  

---

## 1. Overview & Core Philosophy

BMS NEXT is designed as an **offline-resilient** enterprise accounting and business management platform. The cloud source of truth is **Firebase Realtime Database**, while the client's local storage is managed by **Dexie.js (`bms_cache_v1`)**.

### Fundamental Invariants
1. **Preserve Legacy Data:** The original database (`bms_db_v1`) is never touched, altered, or overwritten. The new sync engine operates exclusively inside `bms_cache_v1`.
2. **Tenant & User Cache Scoping:** Every cached entity and outbox mutation is strictly partitioned by `[uid + companyId + financialYearId]`. A user logging out or switching companies cannot view or contaminate another user's or company's cached data.
3. **No Uncontrolled Last-Write-Wins:**
   - **Accounting & Financial Records:** Follow an **append-only, immutable posting model**. Documents and vouchers are posted or reversed, never arbitrarily overwritten.
   - **Master Data (Customers, Suppliers, Products, Settings):** Protected by optimistic concurrency control using `baseVersion` / `updatedAt` checks.
4. **Idempotency Guarantee:** Every mutation dispatched from the client maintains a persistent, unique `clientMutationId`. Retries due to network failure reuse the identical `clientMutationId` to guarantee that duplicate records are never created on the server.

---

## 2. Dexie Cache & Outbox Schema (`bms_cache_v1`)

```ts
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export interface OutboxMutation {
  id: string;                      // Local client UUID
  clientMutationId: string;        // Stable idempotency key (reused across retries)
  uid: string;                     // Authenticated user who created the mutation
  companyId: string;               // Target company
  financialYearId: string;         // Financial year context
  entityType: "company" | "customer" | "supplier" | "product" | "invoice" | "receipt" | "voucher" | "stock";
  entityId: string;                // ID of target entity
  operation: "create" | "update" | "post" | "void" | "adjust";
  payload: Record<string, unknown>; // Normalized mutation payload
  createdAt: number;               // Local creation timestamp (ms)
  attemptCount: number;            // Number of dispatch attempts
  lastAttemptAt?: number;          // Timestamp of last dispatch attempt (ms)
  status: OutboxStatus;            // Queue processing status
  lastError?: string;              // User-readable error message on failure
  baseVersion?: number;            // Version snapshot at time of client edit
}

export interface CachedEntity<T = unknown> {
  id: string;                      // Composite key: `${companyId}:${entityType}:${entityId}`
  uid: string;
  companyId: string;
  financialYearId?: string;
  entityType: string;
  entityId: string;
  version: number;
  data: T;
  updatedAt: number;
  isDeleted?: boolean;
}
```

---

## 3. The Synchronization Lifecycle

```
[ User Action in UI ]
        │
        ▼
[ Zod Runtime Validation ]
        │
   (Valid Payload)
        ▼
[ Write to Dexie Outbox (status: "pending") ]
        │
[ Apply Local Optimistic Update in bms_cache_v1 ]
        │
        ▼
[ Sync Dispatcher Check ]
        │
 ┌──────┴────────────────────────────────────────────────┐
 │                                                       │
[ Offline (navigator.onLine === false || !RTDB) ]      [ Online & Connected ]
 Display "Offline · 1 change pending"                   Mark status: "syncing"
 Wait for connection restoration                        Dispatch to Server / RTDB
                                                                 │
                   ┌─────────────────────────────────────────────┴────────────────┐
                   ▼                                                              ▼
             [ Success ]                                                    [ Error / Conflict ]
   Server commits to RTDB                                          ┌──────────────┴──────────────┐
   Firebase broadcast updates all clients                          ▼                             ▼
   Mark outbox: "synced" $\rightarrow$ Purge entry             [ Transient Network ]        [ Business / Concurrency ]
                                                               Mark: "pending"              Mark: "conflict" or "failed"
                                                               Backoff retry: 2s, 4s, 8s...  Halt auto-sync for this mutation
                                                                                            Notify user / rollback optimistic
```

---

## 4. Conflict Handling Strategies

### 4.1 Master Records (Customers, Suppliers, Products, Company Settings)
- Every master document carries an integer `version` and timestamp `updatedAt`.
- When an update mutation is prepared, the client captures the current entity's `baseVersion`.
- On sync, the server/database compares:
  - If `serverRecord.version === baseVersion`: Mutation succeeds, `version` increments to `baseVersion + 1`.
  - If `serverRecord.version > baseVersion`: A conflict is detected. The mutation transitions to `"conflict"`.
  - **Resolution:** The UI prompts the user with a diff ("Record was modified elsewhere on [Date]") allowing the user to either:
    1. Overwrite with local changes (increments against new server version).
    2. Discard local pending changes and accept the cloud version.

### 4.2 Financial Documents & Accounting Integrity (Invoices, Receipts, Vouchers)
- **No Overwrites:** Accounting documents are fundamentally append-only.
- **Idempotency Guard:** The server tracks `/companyData/{companyId}/processedMutations/{clientMutationId}`.
- If a client resends a mutation with a known `clientMutationId`, the server returns the existing committed document ID without re-executing ledger entries or stock deductions.
- **Reversals:** If a user cancels an invoice while offline, the mutation is recorded as a `void` action. Upon sync, the server issues a reversal voucher rather than deleting the original invoice.

---

## 5. Cache Scoping & User Logout Lifecycle

When a user signs out:
1. **Realtime Subscriptions:** All active Firebase Realtime Database listeners (`off()`) are immediately unsubscribed.
2. **Outbox Halted:** The background synchronization loop stops instantly.
3. **In-Memory State Purged:** `ActiveCompanyContext` and user claims are wiped from memory.
4. **Cache Partitioning:** `bms_cache_v1` retains partitioned records keyed by `uid`. If another user logs in on the same browser, queries filter strictly by `uid === auth.currentUser.uid`, preventing any cross-user data leakage.
5. **Full Device Wipe Option:** Under Settings $\rightarrow$ Data Management, an explicit "Purge Local Cache" command allows deleting all records in `bms_cache_v1` without affecting cloud data.
