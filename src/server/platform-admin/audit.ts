import type admin from "firebase-admin";

export type PlatformAuditAction =
  | "platform.admin.bootstrap"
  | "platform.user.created"
  | "company.created"
  | "company.access.granted"
  | "company.access.updated"
  | "company.access.suspended"
  | "company.access.reactivated"
  | "company.access.revoked"
  | "company.owner.promoted"
  | "company.owner.demoted";

export interface PlatformAuditEntry {
  id?: string;
  actorUid: string;
  action: PlatformAuditAction;
  targetUid?: string;
  companyId?: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  timestamp?: number;
  metadata?: Record<string, any>;
}

/**
 * Persists an immutable platform audit record.
 * Never stores passwords, secrets, or authentication tokens.
 */
export async function recordPlatformAuditLog(
  db: admin.database.Database,
  entry: PlatformAuditEntry
): Promise<string> {
  const timestamp = entry.timestamp || Date.now();
  const auditId =
    entry.id || `paudit_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;

  // Sanitize before/after to guarantee no passwords or tokens are stored
  const sanitize = (obj?: Record<string, any> | null) => {
    if (!obj) return null;
    const sanitized = { ...obj };
    delete sanitized.password;
    delete sanitized.idToken;
    delete sanitized.token;
    delete sanitized.privateKey;
    delete sanitized.secret;
    return sanitized;
  };

  const record = {
    id: auditId,
    actorUid: entry.actorUid,
    action: entry.action,
    targetUid: entry.targetUid || null,
    companyId: entry.companyId || null,
    before: sanitize(entry.before),
    after: sanitize(entry.after),
    timestamp,
    metadata: entry.metadata || null,
  };

  await db.ref(`platformAuditLogs/${auditId}`).set(record);
  return auditId;
}
