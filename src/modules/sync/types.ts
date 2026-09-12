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

export type NetworkStatus = "online" | "offline" | "syncing" | "error";
