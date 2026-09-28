import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { FirebaseMembershipRepository } from "@/server/repositories/firebaseMembershipRepository";
import type { UpdateBranchAccessInput } from "@/server/repositories/types";

const memRepo = new FirebaseMembershipRepository();

export const updateBranchAccessServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      companyId: string;
      targetUid: string;
      idToken: string;
      input: UpdateBranchAccessInput;
    }) => data
  )
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await memRepo.updateUserBranchAccess(data.companyId, data.targetUid, decoded.uid, data.input);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg };
    }
  });

export const listMembershipsServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; idToken: string }) => data)
  .handler(async ({ data }): Promise<{ success: boolean; memberships?: any[]; error?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      await admin.auth().verifyIdToken(data.idToken);
      const memberships = await memRepo.listMemberships(data.companyId);
      return { success: true, memberships };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg };
    }
  });

export const createCompanyUserServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      companyId: string;
      idToken: string;
      input: {
        fullName: string;
        email: string;
        role: "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer" | "custom";
        allBranches?: boolean;
        branchIds?: string[];
        customPermissions?: string[];
      };
    }) => data
  )
  .handler(async ({ data }): Promise<{ success: boolean; membership?: any; error?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await memRepo.createCompanyUser({
        ...data.input,
        companyId: data.companyId,
        callerUid: decoded.uid,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg };
    }
  });

export const setUserMembershipStatusServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      companyId: string;
      targetUid: string;
      idToken: string;
      status: "active" | "suspended";
    }) => data
  )
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await memRepo.setUserMembershipStatus({
        companyId: data.companyId,
        targetUid: data.targetUid,
        callerUid: decoded.uid,
        status: data.status,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg };
    }
  });

import { getAuth } from "firebase/auth";

export async function updateMemberBranchAccess(
  companyId: string,
  targetUid: string,
  input: UpdateBranchAccessInput
): Promise<{ success: boolean; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await updateBranchAccessServerFn({ data: { companyId, targetUid, idToken: token, input } });
}

export async function listCompanyMemberships(
  companyId: string
): Promise<{ success: boolean; memberships?: any[]; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await listMembershipsServerFn({ data: { companyId, idToken: token } });
}

export async function createCompanyUser(
  companyId: string,
  input: {
    fullName: string;
    email: string;
    role: "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer" | "custom";
    allBranches?: boolean;
    branchIds?: string[];
    customPermissions?: string[];
  }
): Promise<{ success: boolean; membership?: any; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await createCompanyUserServerFn({ data: { companyId, idToken: token, input } });
}

export async function setUserMembershipStatus(
  companyId: string,
  targetUid: string,
  status: "active" | "suspended"
): Promise<{ success: boolean; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await setUserMembershipStatusServerFn({ data: { companyId, targetUid, idToken: token, status } });
}

