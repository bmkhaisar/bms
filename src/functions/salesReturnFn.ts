import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { FirebaseSalesReturnRepository } from "@/server/repositories/firebaseSalesReturnRepository";
import type { PostSalesReturnInput, SalesReturnResult } from "@/server/repositories/types";
import { verifyServerReadPermission } from "@/server/auth/permissionGuard";

const salesReturnRepo = new FirebaseSalesReturnRepository();

export const postSalesReturnServerFn = createServerFn({ method: "POST" })
  .validator((data: Omit<PostSalesReturnInput, "callerUid">) => data)
  .handler(async ({ data }): Promise<SalesReturnResult> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await salesReturnRepo.postSalesReturn({
        ...data,
        callerUid: decoded.uid,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const listSalesReturnsServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; branchId?: string; idToken: string }) => data)
  .handler(async ({ data }): Promise<{ success: boolean; salesReturns?: any[]; error?: string; code?: string }> => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      const readCheck = await verifyServerReadPermission({
        db: admin.database(),
        companyId: data.companyId,
        callerUid: decoded.uid,
        branchId: data.branchId,
        permission: "SALES_RETURN_VIEW",
      });
      if (!readCheck.authorized) {
        return { success: false, error: readCheck.error, code: readCheck.code || "FORBIDDEN" };
      }
      const salesReturns = await salesReturnRepo.listSalesReturns(data.companyId, data.branchId, decoded.uid);
      return { success: true, salesReturns };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

export const reverseSalesReturnServerFn = createServerFn({ method: "POST" })
  .validator((data: { companyId: string; salesReturnId: string; idToken: string; reason?: string }) => data)
  .handler(async ({ data }) => {
    const admin = getFirebaseAdmin();
    if (!admin) return { success: false, error: "Firebase Admin configuration missing on server", code: "SERVER_CONFIG_REQUIRED" };

    try {
      const decoded = await admin.auth().verifyIdToken(data.idToken);
      return await salesReturnRepo.reverseSalesReturn({
        companyId: data.companyId,
        salesReturnId: data.salesReturnId,
        callerUid: decoded.uid,
        idToken: data.idToken,
        reason: data.reason,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      return { success: false, error: msg, code: "UNAUTHORIZED" };
    }
  });

import { getAuth } from "firebase/auth";

export async function postSalesReturn(
  input: Omit<PostSalesReturnInput, "callerUid" | "idToken">
): Promise<SalesReturnResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await postSalesReturnServerFn({ data: { ...input, idToken: token } });
}

export async function listSalesReturns(
  companyId: string,
  branchId?: string
): Promise<{ success: boolean; salesReturns?: any[]; error?: string }> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated" };
  return await listSalesReturnsServerFn({ data: { companyId, branchId, idToken: token } });
}

export async function reverseSalesReturn(
  companyId: string,
  salesReturnId: string,
  reason?: string
) {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  return await reverseSalesReturnServerFn({ data: { companyId, salesReturnId, idToken: token, reason } });
}

