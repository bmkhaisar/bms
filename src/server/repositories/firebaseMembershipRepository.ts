/**
 * Firebase Realtime Database implementation of IMembershipRepository (PRD §§ 8, 9, 10, 39)
 * 
 * Enforces:
 * 1. Only Organization OWNER can configure branch memberships and module permissions.
 * 2. Audit logging on permission changes, branch access grants, and revocations.
 */

import { getFirebaseAdmin } from "../firebaseAdmin";
import type { IMembershipRepository, UpdateBranchAccessInput } from "./types";
import type { Membership } from "@/modules/company/types";
import { assertNoUndefinedValues } from "../firebasePayloadInvariant";

export class FirebaseMembershipRepository implements IMembershipRepository {
  private async verifyOwner(db: any, companyId: string, callerUid: string): Promise<boolean> {
    if (!companyId || !callerUid) return false;
    const snap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!snap.exists()) return false;
    const mem = snap.val();
    const role = (mem.organizationRole || mem.role || "").toLowerCase();
    return mem.status === "active" && role === "owner";
  }

  async getMembership(companyId: string, uid: string): Promise<Membership | null> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;
    const snap = await adminApp.database().ref(`memberships/${companyId}/${uid}`).once("value");
    if (!snap.exists()) return null;
    return snap.val();
  }

  async listMemberships(companyId: string): Promise<Membership[]> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return [];
    const snap = await adminApp.database().ref(`memberships/${companyId}`).once("value");
    if (!snap.exists()) return [];
    const val = snap.val();
    const rawList = Object.entries(val).map(([uid, m]: [string, any]) => ({
      ...m,
      uid: m?.uid || uid,
      userId: m?.userId || m?.uid || uid,
    }));

    // Enrich with email & displayName from Firebase Auth so UI displays human-readable names (PRD § 6)
    try {
      const uids = rawList.map((m) => m.uid).filter(Boolean);
      if (uids.length === 0) return rawList;
      const authUsers = await adminApp.auth().getUsers(uids.map((uid) => ({ uid })));
      const authMap = new Map(authUsers.users.map((u) => [u.uid, u]));
      return rawList.map((m) => {
        const u = authMap.get(m.uid);
        return {
          ...m,
          displayName: m.displayName || u?.displayName || (u?.email ? u.email.split("@")[0] : undefined),
          email: m.email || u?.email || undefined,
        };
      });
    } catch {
      return rawList;
    }
  }

  async createCompanyUser(
    input: import("./types").CreateCompanyUserInput
  ): Promise<{ success: boolean; membership?: Membership; error?: string }> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin configuration missing on server" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, input.companyId, input.callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners are authorized to create or invite users.",
      };
    }

    // Role protection: OWNER role cannot be assigned through normal user creation (PRD § 3)
    if (String(input.role).toLowerCase() === "owner") {
      return {
        success: false,
        error: "Forbidden: The Owner role cannot be assigned through user management. Only the ownership transfer workflow can change an owner.",
      };
    }

    const cleanEmail = input.email?.trim().toLowerCase();
    const cleanName = input.fullName?.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return { success: false, error: "A valid email address is required." };
    }
    if (!cleanName) {
      return { success: false, error: "Full name is required." };
    }

    // Find or create Firebase Auth account safely via Admin SDK (PRD § 2)
    let targetUid: string;
    try {
      const existingUser = await adminApp.auth().getUserByEmail(cleanEmail);
      targetUid = existingUser.uid;
      // Update display name if missing
      if (!existingUser.displayName && cleanName) {
        await adminApp.auth().updateUser(targetUid, { displayName: cleanName });
      }
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        // Create new user account with temporary secure credentials
        const tempPassword = `Bms!${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 6).toUpperCase()}#`;
        const newUser = await adminApp.auth().createUser({
          email: cleanEmail,
          displayName: cleanName,
          password: tempPassword,
        });
        targetUid = newUser.uid;
      } else {
        return { success: false, error: err.message || "Failed to query Firebase Auth user" };
      }
    }

    // Check if user already has active membership in this company
    const existingMemSnap = await db.ref(`memberships/${input.companyId}/${targetUid}`).once("value");
    if (existingMemSnap.exists() && existingMemSnap.val()?.status === "active") {
      return { success: false, error: "User already has an active membership in this organization." };
    }

    const now = Date.now();
    const branchIds = input.allBranches ? [] : (input.branchIds || []);
    const branchAccess = input.allBranches
      ? []
      : branchIds.map((bId) => ({
          branchId: bId,
          permissions: (input.customPermissions || []) as any,
        }));

    const newMembership: Membership = {
      uid: targetUid,
      userId: targetUid,
      companyId: input.companyId,
      organizationId: input.companyId,
      role: input.role as any,
      organizationRole: input.role as any,
      status: "active",
      allBranches: Boolean(input.allBranches),
      branchIds,
      branchAccess,
      customPermissions: input.customPermissions || [],
      createdAt: now,
      createdBy: input.callerUid,
      updatedAt: now,
      displayName: cleanName,
      email: cleanEmail,
    } as any;

    const updates: Record<string, unknown> = {};
    updates[`memberships/${input.companyId}/${targetUid}`] = newMembership;
    updates[`userCompanies/${targetUid}/${input.companyId}`] = {
      companyId: input.companyId,
      role: input.role,
      assignedAt: now,
      assignedBy: input.callerUid,
    };

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "user_membership",
      entityId: targetUid,
      action: "USER_INVITED",
      performedBy: input.callerUid,
      timestamp: now,
      details: {
        email: cleanEmail,
        fullName: cleanName,
        role: input.role,
        allBranches: Boolean(input.allBranches),
        branchCount: branchIds.length,
        branchIds,
      },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return { success: true, membership: newMembership };
  }

  async updateUserBranchAccess(
    companyId: string,
    targetUid: string,
    callerUid: string,
    input: UpdateBranchAccessInput
  ): Promise<{ success: boolean; error?: string }> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, companyId, callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners can manage user branch access and permissions.",
      };
    }

    const targetRef = db.ref(`memberships/${companyId}/${targetUid}`);
    const snap = await targetRef.once("value");
    if (!snap.exists()) {
      return { success: false, error: "User membership not found in this organization" };
    }

    const current = snap.val();
    const targetIsOwner = (current.organizationRole || current.role || "").toLowerCase() === "owner";

    // Protection: Cannot demote owner or assign owner role through branch access update (PRD § 3)
    if (input.role && String(input.role).toLowerCase() === "owner" && !targetIsOwner) {
      return {
        success: false,
        error: "Forbidden: The Owner role cannot be assigned through user management. Use ownership transfer.",
      };
    }
    if (targetIsOwner && input.role && String(input.role).toLowerCase() !== "owner") {
      return {
        success: false,
        error: "Forbidden: Cannot change the Owner role through this interface.",
      };
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {};

    // Compile new branchIds array for legacy compatibility and indexes
    let newBranchIds: string[] = [];
    if (input.branchAccess && Array.isArray(input.branchAccess)) {
      newBranchIds = input.branchAccess.map((b) => b.branchId);
    } else if (input.branchIds && Array.isArray(input.branchIds)) {
      newBranchIds = input.branchIds;
    } else if (current.branchIds) {
      newBranchIds = current.branchIds;
    }

    const updatedMembership = {
      ...current,
      displayName: input.displayName?.trim() || current.displayName,
      role: input.role || current.role,
      organizationRole: input.role || current.organizationRole || current.role,
      allBranches: input.allBranches !== undefined ? input.allBranches : (current.allBranches ?? false),
      branchIds: newBranchIds,
      branchAccess: input.branchAccess !== undefined ? input.branchAccess : (current.branchAccess || []),
      customPermissions: input.customPermissions !== undefined ? input.customPermissions : (current.customPermissions || []),
      updatedAt: now,
    };

    updates[`memberships/${companyId}/${targetUid}`] = updatedMembership;
    if (input.role) {
      updates[`userCompanies/${targetUid}/${companyId}/role`] = input.role;
    }

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "user_access",
      entityId: targetUid,
      action: "PERMISSION_CHANGED",
      performedBy: callerUid,
      timestamp: now,
      details: {
        role: updatedMembership.role,
        allBranches: updatedMembership.allBranches,
        branchCount: newBranchIds.length,
        branchIds: newBranchIds,
      },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return { success: true };
  }

  async setUserMembershipStatus(
    input: import("./types").SetUserMembershipStatusInput
  ): Promise<{ success: boolean; error?: string }> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, input.companyId, input.callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners can change user status.",
      };
    }

    const targetRef = db.ref(`memberships/${input.companyId}/${input.targetUid}`);
    const snap = await targetRef.once("value");
    if (!snap.exists()) {
      return { success: false, error: "User membership not found in this organization" };
    }

    const current = snap.val();
    const targetIsOwner = (current.organizationRole || current.role || "").toLowerCase() === "owner";
    if (targetIsOwner) {
      return { success: false, error: "Forbidden: Cannot deactivate the Organization Owner." };
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {};
    updates[`memberships/${input.companyId}/${input.targetUid}/status`] = input.status;
    updates[`memberships/${input.companyId}/${input.targetUid}/updatedAt`] = now;

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "user_membership",
      entityId: input.targetUid,
      action: input.status === "active" ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      performedBy: input.callerUid,
      timestamp: now,
      details: { status: input.status },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return { success: true };
  }
}
