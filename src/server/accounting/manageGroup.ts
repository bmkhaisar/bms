import { getFirebaseAdmin } from "../firebaseAdmin";
import { hasCapability } from "@/modules/auth/permissions";
import type { AccountGroup, AccountNature } from "@/modules/accounting/types";
import { SYSTEM_ACCOUNT_GROUPS } from "@/modules/accounting/defaultGroups";

export interface ManageGroupInput {
  idToken: string;
  companyId: string;
  groupId?: string;
  name: string;
  parentGroupId: string; // Required for custom groups to strictly inherit nature
}

export interface ManageGroupResult {
  success: boolean;
  group?: AccountGroup;
  error?: string;
  code?: "UNAUTHORIZED" | "FORBIDDEN" | "SERVER_CONFIG_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR";
}

/**
 * Server-Side Account Group Manager.
 * 
 * Invariants Enforced:
 * 1. Authenticated user with 'accounting.chart.manage' capability.
 * 2. System groups cannot be deleted or re-classified.
 * 3. Custom groups MUST have a valid parentGroupId and strictly inherit the parent's `nature`.
 *    This prevents users from corrupting fundamental account classifications required by financial reports.
 * 4. All writes are audited.
 */
export async function executeManageGroup(input: ManageGroupInput): Promise<ManageGroupResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials must be configured on the server.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  if (!input.idToken) {
    return {
      success: false,
      error: "Authentication token required.",
      code: "UNAUTHORIZED",
    };
  }

  if (!input.companyId || !input.name?.trim()) {
    return {
      success: false,
      error: "Company ID and group name are required.",
      code: "INVALID_INPUT",
    };
  }

  if (!input.parentGroupId?.trim()) {
    return {
      success: false,
      error: "Custom groups must specify a parentGroupId to inherit account classification.",
      code: "INVALID_INPUT",
    };
  }

  let decodedToken;
  try {
    decodedToken = await adminApp.auth().verifyIdToken(input.idToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return {
      success: false,
      error: `Invalid authentication token: ${msg}`,
      code: "UNAUTHORIZED",
    };
  }

  const callerUid = decodedToken.uid;
  const db = adminApp.database();

  // Verify membership & permissions
  const memSnap = await db.ref(`memberships/${input.companyId}/${callerUid}`).once("value");
  if (!memSnap.exists()) {
    return {
      success: false,
      error: "You are not a member of this company.",
      code: "FORBIDDEN",
    };
  }

  const membership = memSnap.val();
  if (membership.status !== "active") {
    return {
      success: false,
      error: "Your membership is inactive or suspended.",
      code: "FORBIDDEN",
    };
  }

  if (!hasCapability(membership, "accounting.chart.manage")) {
    return {
      success: false,
      error: "Forbidden: You do not have permission to manage Chart of Accounts.",
      code: "FORBIDDEN",
    };
  }

  // Find parent group to inherit nature
  const parentGroupId = input.parentGroupId.trim();
  let parentNature: AccountNature | undefined;
  let isLiquidity = false;

  // Check system groups first
  const sysParent = SYSTEM_ACCOUNT_GROUPS.find((g) => g.id === parentGroupId);
  if (sysParent) {
    parentNature = sysParent.nature;
    isLiquidity = Boolean(sysParent.isLiquidity);
  } else {
    // Check company custom groups
    const parentSnap = await db.ref(`companyData/${input.companyId}/accountGroups/${parentGroupId}`).once("value");
    if (parentSnap.exists()) {
      const p = parentSnap.val() as AccountGroup;
      parentNature = p.nature;
      isLiquidity = Boolean(p.isLiquidity);
    }
  }

  if (!parentNature) {
    return {
      success: false,
      error: `Parent account group '${parentGroupId}' does not exist.`,
      code: "INVALID_INPUT",
    };
  }

  const now = Date.now();
  const groupId = input.groupId?.trim() || `grp_${input.companyId}_${Math.random().toString(36).substring(2, 8)}`;
  const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

  // If modifying existing group, ensure it's not a system group
  if (input.groupId) {
    const existingSnap = await db.ref(`companyData/${input.companyId}/accountGroups/${input.groupId}`).once("value");
    if (existingSnap.exists()) {
      const existing = existingSnap.val() as AccountGroup;
      if (existing.isSystem) {
        return {
          success: false,
          error: "System account groups cannot be renamed or reclassified.",
          code: "FORBIDDEN",
        };
      }
    }
  }

  // Prevent cycle in group hierarchy
  const allCustomSnap = await db.ref(`companyData/${input.companyId}/accountGroups`).once("value");
  const allCustom = allCustomSnap.exists() ? Object.values(allCustomSnap.val() as Record<string, AccountGroup>) : [];
  const combinedGroups = [...SYSTEM_ACCOUNT_GROUPS, ...allCustom];

  // Check if setting parent creates a cycle
  let isCycle = false;
  let currParent: string | null | undefined = parentGroupId;
  const visited = new Set<string>();

  while (currParent) {
    if (currParent === groupId) {
      isCycle = true;
      break;
    }
    if (visited.has(currParent)) {
      isCycle = true;
      break;
    }
    visited.add(currParent);
    const found = combinedGroups.find((g) => g.id === currParent);
    currParent = found?.parentGroupId;
  }

  if (isCycle) {
    return {
      success: false,
      error: "Circular hierarchy detected: An account group cannot be a parent of its own ancestor.",
      code: "INVALID_INPUT",
    };
  }

  const group: AccountGroup = {
    id: groupId,
    companyId: input.companyId,
    name: input.name.trim(),
    parentGroupId,
    nature: parentNature,
    isSystem: false,
    isLiquidity,
    createdAt: now,
  };

  const updates: Record<string, unknown> = {};
  updates[`companyData/${input.companyId}/accountGroups/${groupId}`] = group;
  updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "accountGroup",
    entityId: groupId,
    action: input.groupId ? "update" : "create",
    performedBy: callerUid,
    timestamp: now,
    newState: group,
  };

  try {
    await db.ref().update(updates);
    return {
      success: true,
      group,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Database write failed";
    return {
      success: false,
      error: `Failed to save account group: ${msg}`,
      code: "INTERNAL_ERROR",
    };
  }
}
