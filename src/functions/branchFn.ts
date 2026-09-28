import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { FirebaseBranchRepository } from "@/server/repositories/firebaseBranchRepository";
import type { CreateBranchInput, UpdateBranchInput, BranchResult } from "@/server/repositories/types";

const branchRepo = new FirebaseBranchRepository();

export interface BranchRpcAuth {
  idToken: string;
}

export const createBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: CreateBranchInput & BranchRpcAuth) => data)
  .handler(async ({ data }): Promise<BranchResult> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await branchRepo.createBranch({
        ...data,
        callerUid: decoded.uid,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const updateBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: UpdateBranchInput & BranchRpcAuth) => data)
  .handler(async ({ data }): Promise<BranchResult> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await branchRepo.updateBranch({
        ...data,
        callerUid: decoded.uid,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const setMainBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; branchId: string; idToken: string }) => data)
  .handler(async ({ data }): Promise<BranchResult> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await branchRepo.setMainBranch(data.companyId, data.branchId, decoded.uid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const deactivateBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; branchId: string; idToken: string }) => data)
  .handler(async ({ data }): Promise<BranchResult> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await branchRepo.deactivateBranch(data.companyId, data.branchId, decoded.uid);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const listBranchesServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; idToken: string }) => data)
  .handler(async ({ data }): Promise<{ success: boolean; branches?: any[]; error?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      const branches = await branchRepo.listBranches(data.companyId, decoded.uid);
      return { success: true, branches };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg };
    }
  });

import { getAuth } from "firebase/auth";

export async function createBranch(input: CreateBranchInput): Promise<BranchResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await createBranchServerFn({ data: { ...input, idToken: token } });
}

export async function updateBranch(input: UpdateBranchInput): Promise<BranchResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await updateBranchServerFn({ data: { ...input, idToken: token } });
}

export async function setMainBranch(companyId: string, branchId: string, _callerUid?: string): Promise<BranchResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await setMainBranchServerFn({ data: { companyId, branchId, idToken: token } });
}

export async function deactivateBranch(companyId: string, branchId: string, _callerUid?: string): Promise<BranchResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await deactivateBranchServerFn({ data: { companyId, branchId, idToken: token } });
}

export async function listCompanyBranches(companyId: string): Promise<{ success: boolean; branches?: any[]; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await listBranchesServerFn({ data: { companyId, idToken: token } });
}

