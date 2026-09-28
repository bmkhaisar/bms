/**
 * Server-Side Authoritative Permission Guard (Hardening Task 2)
 * 
 * Enforces server-side permissions for existing and new modules:
 * - INVOICE_CREATE / EDIT / POST
 * - QUOTATION_CREATE / EDIT
 * - RECEIPT_CREATE
 * - PURCHASE_CREATE / POST
 * - INVENTORY_MANAGE
 * - REPORTS_VIEW
 * - GST_VIEW
 * - CA_REVIEW_VIEW
 * 
 * Invariants:
 * 1. Hidden UI buttons are never trusted.
 * 2. Manipulated direct requests lacking server-side permission are rejected.
 * 3. Branch boundaries are strictly enforced: assigned to Branch A cannot mutate Branch B.
 * 4. Company owners retain authoritative unrestricted access.
 */

import type { Database } from "firebase-admin/database";
import { hasBranchPermission, type CanonicalPermission } from "../../modules/auth/permissions.ts";
import type { Membership } from "../../modules/company/types.ts";

export interface PermissionCheckResult {
  authorized: boolean;
  membership?: Membership;
  error?: string;
  code?: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT";
}

export async function verifyServerPermission(params: {
  db: Database;
  companyId: string;
  callerUid: string;
  permission: CanonicalPermission | string;
  branchId?: string | null;
}): Promise<PermissionCheckResult> {
  const { db, companyId, callerUid, permission, branchId } = params;

  if (!companyId || !callerUid) {
    return {
      authorized: false,
      error: "Missing companyId or callerUid.",
      code: "INVALID_INPUT",
    };
  }

  const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
  if (!memSnap.exists()) {
    return {
      authorized: false,
      error: "You are not a member of this company.",
      code: "FORBIDDEN",
    };
  }

  const membership: Membership = memSnap.val();
  if (membership.status !== "active") {
    return {
      authorized: false,
      error: "Your membership in this company is inactive or suspended.",
      code: "FORBIDDEN",
    };
  }

  // Hardening Item 5: 'All Branches' / consolidated mode is strictly an Organization Owner privilege
  if (branchId === "all") {
    const role = (membership.organizationRole || membership.role || "").toLowerCase();
    if (role !== "owner") {
      return {
        authorized: false,
        error: "Forbidden: Consolidated 'All Branches' mode is strictly an Organization Owner privilege.",
        code: "FORBIDDEN",
      };
    }
  }

  const allowed = hasBranchPermission(membership, branchId, permission);
  if (!allowed) {
    const branchDesc = branchId && branchId !== "all" ? ` for branch '${branchId}'` : "";
    return {
      authorized: false,
      error: `Forbidden: You do not have the required permission '${permission}'${branchDesc}.`,
      code: "FORBIDDEN",
    };
  }

  return {
    authorized: true,
    membership,
  };
}
