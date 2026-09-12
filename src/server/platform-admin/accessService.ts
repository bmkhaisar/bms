import { getFirebaseAdminApp } from "../firebaseAdmin";
import { requirePlatformAdmin } from "./auth";
import { recordPlatformAuditLog } from "./audit";

export interface GrantAccessInput {
  idToken: string;
  targetUid?: string;
  targetEmail?: string;
  companyId: string;
  roleId: string;
  branchIds?: Record<string, boolean>;
  customPermissions?: string[];
}

export interface UpdateAccessInput {
  idToken: string;
  targetUid: string;
  companyId: string;
  roleId?: string;
  status?: "active" | "suspended" | "revoked";
  branchIds?: Record<string, boolean>;
  customPermissions?: string[];
}

export interface RevokeAccessInput {
  idToken: string;
  targetUid: string;
  companyId: string;
}

export interface SuspendAccessInput {
  idToken: string;
  targetUid: string;
  companyId: string;
}

export interface ReactivateAccessInput {
  idToken: string;
  targetUid: string;
  companyId: string;
}

export interface TransferOwnershipInput {
  idToken: string;
  companyId: string;
  newOwnerUid?: string;
  newOwnerEmail?: string;
  demoteOldOwnerUid?: string;
  previousOwnerNewRoleId?: string;
}

/**
 * Helper to update lightweight company summary counters
 */
async function syncCompanySummary(db: any, companyId: string) {
  try {
    const membershipsSnap = await db.ref(`memberships/${companyId}`).once("value");
    const memberships = membershipsSnap.val() || {};

    let activeMemberCount = 0;
    let ownerCount = 0;

    for (const mem of Object.values<any>(memberships)) {
      if (mem?.status === "active") {
        activeMemberCount++;
        if (mem?.role === "owner" || mem?.roleId === "owner") {
          ownerCount++;
        }
      }
    }

    await db.ref(`companySummaries/${companyId}`).set({
      companyId,
      activeMemberCount,
      ownerCount,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn("Failed to update company summary counter:", e);
  }
}

/**
 * Grants membership access to a user in a specific company.
 * Supports passing either targetEmail or targetUid.
 * Atomically updates /memberships/{companyId}/{uid} and /userCompanies/{uid}/{companyId}.
 */
export async function grantCompanyAccess(input: GrantAccessInput) {
  const authResult = await requirePlatformAdmin(input.idToken);
  if (!authResult.success || !authResult.uid) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const callerUid = authResult.uid;
  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  if ((!input.targetUid && !input.targetEmail) || !input.companyId || !input.roleId) {
    return {
      success: false,
      error: "targetEmail or targetUid, companyId, and roleId are required.",
      code: "INVALID_INPUT",
    };
  }

  // Verify target company exists
  const compSnap = await db.ref(`companies/${input.companyId}`).once("value");
  if (!compSnap.exists()) {
    return {
      success: false,
      error: `Company '${input.companyId}' does not exist.`,
      code: "COMPANY_NOT_FOUND",
    };
  }

  // Resolve target user UID
  let resolvedUid: string;
  let resolvedEmail: string = "";
  try {
    if (input.targetEmail && input.targetEmail.trim()) {
      const userRecord = await adminApp.auth().getUserByEmail(input.targetEmail.trim().toLowerCase());
      resolvedUid = userRecord.uid;
      resolvedEmail = userRecord.email || input.targetEmail.trim();
    } else {
      const userRecord = await adminApp.auth().getUser(input.targetUid!.trim());
      resolvedUid = userRecord.uid;
      resolvedEmail = userRecord.email || "";
    }
  } catch {
    return {
      success: false,
      error: `Target user '${input.targetEmail || input.targetUid}' does not exist in Firebase Authentication.`,
      code: "USER_NOT_FOUND",
    };
  }

  const now = Date.now();
  const membershipRecord = {
    uid: resolvedUid,
    role: input.roleId,
    roleId: input.roleId,
    status: "active",
    branchIds: input.branchIds || { br_main: true },
    customPermissions: input.customPermissions || [],
    createdAt: now,
    createdBy: callerUid,
    updatedAt: now,
  };

  const updates: Record<string, any> = {};
  updates[`memberships/${input.companyId}/${resolvedUid}`] = membershipRecord;
  updates[`userCompanies/${resolvedUid}/${input.companyId}`] = true;

  try {
    await db.ref().update(updates);
    await syncCompanySummary(db, input.companyId);

    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "company.access.granted",
      companyId: input.companyId,
      targetUid: resolvedUid,
      after: {
        ...membershipRecord,
        email: resolvedEmail,
      },
    });

    return {
      success: true,
      membership: membershipRecord,
      resolvedUid,
      resolvedEmail,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to grant company access";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Updates an existing user's membership in a company (role, branchIds, status, customPermissions).
 * Enforces status transitions (active <-> suspended <-> revoked) with atomic reverse index adjustment.
 */
export async function updateCompanyAccess(input: UpdateAccessInput) {
  const authResult = await requirePlatformAdmin(input.idToken);
  if (!authResult.success || !authResult.uid) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const callerUid = authResult.uid;
  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  const memRef = db.ref(`memberships/${input.companyId}/${input.targetUid}`);
  const memSnap = await memRef.once("value");
  if (!memSnap.exists()) {
    return {
      success: false,
      error: "Membership record does not exist.",
      code: "MEMBERSHIP_NOT_FOUND",
    };
  }

  const currentMem = memSnap.val();
  const now = Date.now();

  const newStatus = input.status || currentMem.status || "active";
  const newRole = input.roleId || currentMem.roleId || currentMem.role;

  const updatedMem = {
    ...currentMem,
    role: newRole,
    roleId: newRole,
    status: newStatus,
    branchIds: input.branchIds !== undefined ? input.branchIds : currentMem.branchIds || { br_main: true },
    customPermissions: input.customPermissions !== undefined ? input.customPermissions : currentMem.customPermissions || [],
    updatedAt: now,
  };

  const updates: Record<string, any> = {};
  updates[`memberships/${input.companyId}/${input.targetUid}`] = updatedMem;

  // Reverse index handling:
  // Active => present in /userCompanies
  // Suspended or Revoked => removed from /userCompanies so client immediately loses access
  if (newStatus === "active") {
    updates[`userCompanies/${input.targetUid}/${input.companyId}`] = true;
  } else {
    updates[`userCompanies/${input.targetUid}/${input.companyId}`] = null;
  }

  // Determine audit action
  let auditAction: any = "company.access.updated";
  if (currentMem.status !== "active" && newStatus === "active") {
    auditAction = "company.access.reactivated";
  } else if (currentMem.status === "active" && newStatus === "suspended") {
    auditAction = "company.access.suspended";
  } else if (newStatus === "revoked") {
    auditAction = "company.access.revoked";
  } else if (currentMem.role !== "owner" && newRole === "owner") {
    auditAction = "company.owner.promoted";
  } else if (currentMem.role === "owner" && newRole !== "owner") {
    auditAction = "company.owner.demoted";
  }

  try {
    await db.ref().update(updates);
    await syncCompanySummary(db, input.companyId);

    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: auditAction,
      companyId: input.companyId,
      targetUid: input.targetUid,
      before: currentMem,
      after: updatedMem,
    });

    return {
      success: true,
      membership: updatedMem,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update company access";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Suspends access. Atomic removal from /userCompanies index.
 */
export async function suspendCompanyAccess(input: SuspendAccessInput) {
  return updateCompanyAccess({
    idToken: input.idToken,
    companyId: input.companyId,
    targetUid: input.targetUid,
    status: "suspended",
  });
}

/**
 * Reactivates access. Restores /userCompanies index.
 */
export async function reactivateCompanyAccess(input: ReactivateAccessInput) {
  return updateCompanyAccess({
    idToken: input.idToken,
    companyId: input.companyId,
    targetUid: input.targetUid,
    status: "active",
  });
}

/**
 * Revokes access. Sets status = 'revoked' and deletes /userCompanies entry.
 */
export async function revokeCompanyAccess(input: RevokeAccessInput) {
  return updateCompanyAccess({
    idToken: input.idToken,
    companyId: input.companyId,
    targetUid: input.targetUid,
    status: "revoked",
  });
}

/**
 * Transfers or assigns company ownership safely.
 * Allows multiple active Owners per company.
 * Promotes the target user FIRST to ensure company is never left without an active owner.
 * If demoting an existing owner, verifies that the company will still have at least 1 active owner.
 * Audits both promotion and demotion actions.
 */
export async function transferCompanyOwnership(input: TransferOwnershipInput) {
  const authResult = await requirePlatformAdmin(input.idToken);
  if (!authResult.success || !authResult.uid) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const callerUid = authResult.uid;
  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  if (!input.companyId || (!input.newOwnerUid && !input.newOwnerEmail)) {
    return {
      success: false,
      error: "companyId and either newOwnerUid or newOwnerEmail are required.",
      code: "INVALID_INPUT",
    };
  }

  // 1. Resolve and verify target new owner exists in Firebase Auth
  let targetUid: string;
  let targetEmail: string = "";
  try {
    if (input.newOwnerEmail && input.newOwnerEmail.trim()) {
      const record = await adminApp.auth().getUserByEmail(input.newOwnerEmail.trim().toLowerCase());
      targetUid = record.uid;
      targetEmail = record.email || input.newOwnerEmail.trim();
    } else {
      const record = await adminApp.auth().getUser(input.newOwnerUid!.trim());
      targetUid = record.uid;
      targetEmail = record.email || "";
    }
  } catch {
    return {
      success: false,
      error: `New owner '${input.newOwnerEmail || input.newOwnerUid}' does not exist in Firebase Authentication.`,
      code: "USER_NOT_FOUND",
    };
  }

  // 2. Read all current memberships for the company
  const membershipsSnap = await db.ref(`memberships/${input.companyId}`).once("value");
  const memberships = membershipsSnap.val() || {};

  const existingNewOwnerMem = memberships[targetUid];
  const isAlreadyActiveOwner =
    existingNewOwnerMem &&
    (existingNewOwnerMem.role === "owner" || existingNewOwnerMem.roleId === "owner") &&
    existingNewOwnerMem.status === "active";

  // Count existing active owners
  let existingActiveOwnerCount = 0;
  for (const mem of Object.values<any>(memberships)) {
    if ((mem.role === "owner" || mem.roleId === "owner") && mem.status === "active") {
      existingActiveOwnerCount++;
    }
  }

  const now = Date.now();
  const updates: Record<string, any> = {};

  // Step 1: Promote target new owner to Owner FIRST
  const newOwnerRecord = {
    ...existingNewOwnerMem,
    uid: targetUid,
    role: "owner",
    roleId: "owner",
    status: "active",
    branchIds: existingNewOwnerMem?.branchIds || { br_main: true },
    customPermissions: existingNewOwnerMem?.customPermissions || [],
    createdAt: existingNewOwnerMem?.createdAt || now,
    createdBy: existingNewOwnerMem?.createdBy || callerUid,
    updatedAt: now,
  };

  updates[`memberships/${input.companyId}/${targetUid}`] = newOwnerRecord;
  updates[`userCompanies/${targetUid}/${input.companyId}`] = true;

  // Step 2: Handle optional demotion of an old owner
  let demotedMemberBefore: any = null;
  let demotedMemberAfter: any = null;

  if (input.demoteOldOwnerUid && input.demoteOldOwnerUid !== targetUid) {
    const oldMem = memberships[input.demoteOldOwnerUid];
    if (!oldMem) {
      return {
        success: false,
        error: `Owner to demote '${input.demoteOldOwnerUid}' has no membership in this company.`,
        code: "MEMBER_NOT_FOUND",
      };
    }

    const wasActiveOwner =
      (oldMem.role === "owner" || oldMem.roleId === "owner") && oldMem.status === "active";

    // Verify company will still have >= 1 active owner
    // Since targetUid is now active owner (+1 if not already), demoting old owner (-1 if was active)
    const postActiveOwners =
      existingActiveOwnerCount + (isAlreadyActiveOwner ? 0 : 1) - (wasActiveOwner ? 1 : 0);

    if (postActiveOwners < 1) {
      return {
        success: false,
        error: "Cannot demote owner: company must retain at least one active owner.",
        code: "CANNOT_LEAVE_OWNERLESS",
      };
    }

    demotedMemberBefore = { ...oldMem };
    const demotedRole = input.previousOwnerNewRoleId || "administrator";
    demotedMemberAfter = {
      ...oldMem,
      role: demotedRole,
      roleId: demotedRole,
      updatedAt: now,
    };

    updates[`memberships/${input.companyId}/${input.demoteOldOwnerUid}`] = demotedMemberAfter;
  }

  try {
    // Atomic update
    await db.ref().update(updates);
    await syncCompanySummary(db, input.companyId);

    // Audit promotion
    if (!isAlreadyActiveOwner) {
      await recordPlatformAuditLog(db, {
        actorUid: callerUid,
        action: "company.owner.promoted",
        companyId: input.companyId,
        targetUid,
        after: {
          ...newOwnerRecord,
          email: targetEmail,
        },
      });
    }

    // Audit demotion
    if (demotedMemberBefore && demotedMemberAfter) {
      await recordPlatformAuditLog(db, {
        actorUid: callerUid,
        action: "company.owner.demoted",
        companyId: input.companyId,
        targetUid: input.demoteOldOwnerUid!,
        before: demotedMemberBefore,
        after: demotedMemberAfter,
      });
    }

    return {
      success: true,
      newOwnerUid: targetUid,
      demotedOwnerUid: input.demoteOldOwnerUid || undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to transfer company ownership";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Lists all memberships for a specific company.
 */
export async function listCompanyMemberships(idToken: string, companyId: string) {
  const authResult = await requirePlatformAdmin(idToken);
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
      memberships: [],
    };
  }

  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  try {
    const memSnap = await db.ref(`memberships/${companyId}`).once("value");
    const memVal = memSnap.val() || {};

    const list = Object.values(memVal);
    return {
      success: true,
      memberships: list,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list memberships";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
      memberships: [],
    };
  }
}
