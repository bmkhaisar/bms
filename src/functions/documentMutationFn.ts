import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { verifyServerPermission } from "@/server/auth/permissionGuard";
import type { CanonicalPermission } from "@/modules/auth/permissions";

export interface ValidateMutationInput {
  idToken: string;
  companyId: string;
  branchId?: string | null;
  action:
    | "INVOICE_CREATE"
    | "INVOICE_EDIT"
    | "INVOICE_POST"
    | "QUOTATION_CREATE"
    | "QUOTATION_EDIT"
    | "RECEIPT_CREATE"
    | "PURCHASE_CREATE"
    | "PURCHASE_POST"
    | "INVENTORY_MANAGE";
  payload?: any;
}

export interface ValidateViewInput {
  idToken: string;
  companyId: string;
  branchId?: string | null;
  view:
    | "INVOICE_VIEW"
    | "QUOTATION_VIEW"
    | "RECEIPT_VIEW"
    | "PURCHASE_VIEW"
    | "SALES_RETURN_VIEW"
    | "INVENTORY_VIEW"
    | "LEDGER_VIEW"
    | "REPORTS_VIEW"
    | "GST_VIEW"
    | "CA_REVIEW_VIEW"
    | "PARTY_VIEW"
    | "PRODUCT_VIEW";
}

export interface ServerAuthResult {
  success: boolean;
  authorized: boolean;
  error?: string;
  code?: string;
  callerUid?: string;
}

/**
 * Server function RPC to authoritatively validate direct operational mutations (Hardening Task 2).
 * Verifies authentication, session validity, tenant membership, and granular branch permissions.
 */
export const validateMutationServerFn = createServerFn({ method: "POST" })
  .validator((data: ValidateMutationInput) => data)
  .handler(async ({ data }): Promise<ServerAuthResult> => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return {
        success: false,
        authorized: false,
        error: "Server configuration required. Firebase Admin credentials missing.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }

    try {
      const decoded = await adminApp.auth().verifyIdToken(data.idToken);
      const sessionCheck = checkSessionAge(decoded);
      if (!sessionCheck.valid) {
        return {
          success: false,
          authorized: false,
          error: sessionCheck.error,
          code: sessionCheck.code,
        };
      }

      const db = adminApp.database();
      const check = await verifyServerPermission({
        db,
        companyId: data.companyId,
        callerUid: decoded.uid,
        permission: data.action as CanonicalPermission,
        branchId: data.branchId,
      });

      if (!check.authorized) {
        return {
          success: false,
          authorized: false,
          error: check.error || `Forbidden: Missing permission ${data.action}`,
          code: check.code || "FORBIDDEN",
        };
      }

      return {
        success: true,
        authorized: true,
        callerUid: decoded.uid,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authorized: false,
        error: msg,
        code: "INTERNAL_ERROR",
      };
    }
  });

/**
 * Server function RPC to authoritatively validate reports & compliance views (Hardening Task 2).
 */
export const validateViewServerFn = createServerFn({ method: "POST" })
  .validator((data: ValidateViewInput) => data)
  .handler(async ({ data }): Promise<ServerAuthResult> => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return {
        success: false,
        authorized: false,
        error: "Server configuration required. Firebase Admin credentials missing.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }

    try {
      const decoded = await adminApp.auth().verifyIdToken(data.idToken);
      const sessionCheck = checkSessionAge(decoded);
      if (!sessionCheck.valid) {
        return {
          success: false,
          authorized: false,
          error: sessionCheck.error,
          code: sessionCheck.code,
        };
      }

      const db = adminApp.database();
      const check = await verifyServerPermission({
        db,
        companyId: data.companyId,
        callerUid: decoded.uid,
        permission: data.view as CanonicalPermission,
        branchId: data.branchId,
      });

      if (!check.authorized) {
        return {
          success: false,
          authorized: false,
          error: check.error || `Forbidden: Missing view permission ${data.view}`,
          code: check.code || "FORBIDDEN",
        };
      }

      return {
        success: true,
        authorized: true,
        callerUid: decoded.uid,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authorized: false,
        error: msg,
        code: "INTERNAL_ERROR",
      };
    }
  });
