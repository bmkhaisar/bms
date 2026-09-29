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
import {
  hasBranchPermission,
  hasBranchAccess,
  type CanonicalPermission,
} from "../../modules/auth/permissions.ts";
import type { Membership } from "../../modules/company/types.ts";

export interface PermissionCheckResult {
  authorized: boolean;
  membership?: Membership;
  error?: string;
  code?: "FORBIDDEN" | "CROSS_BRANCH_FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT";
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

  // Hardening Item 2: Strict server-side cross-branch validation
  if (branchId && branchId !== "all") {
    const role = (membership.organizationRole || membership.role || "").toLowerCase();
    if (role !== "owner" && !hasBranchAccess(membership, branchId)) {
      return {
        authorized: false,
        error: `Cross-Branch Forbidden: You do not have authorization for branch '${branchId}'.`,
        code: "CROSS_BRANCH_FORBIDDEN",
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

/**
 * Server-Authoritative Read Permission Guard (Pre-Merge Blocker 2)
 * Ensures a Branch-A-only user cannot read Branch-B operational records through
 * server loaders, reports, search, or realtime queries.
 */
export async function verifyServerReadPermission(params: {
  db?: Database | any;
  companyId: string;
  callerUid: string;
  permission?: CanonicalPermission | string;
  branchId?: string | null;
  membership?: Membership;
}): Promise<PermissionCheckResult> {
  const { db, companyId, callerUid, permission, branchId } = params;

  if (!companyId || !callerUid) {
    return { authorized: false, error: "Missing companyId or callerUid.", code: "INVALID_INPUT" };
  }

  let membership = params.membership;
  if (!membership && db) {
    const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!memSnap.exists()) {
      return { authorized: false, error: "You are not a member of this company.", code: "FORBIDDEN" };
    }
    membership = memSnap.val();
  }

  if (!membership) {
    return { authorized: false, error: "Membership not found.", code: "FORBIDDEN" };
  }

  if (membership.status !== "active") {
    return { authorized: false, error: "Your membership is inactive or suspended.", code: "FORBIDDEN" };
  }

  const role = (membership.organizationRole || membership.role || "").toLowerCase();
  const isOwner = role === "owner";

  // Consolidated "All Branches" mode is strictly an Organization Owner privilege
  if (branchId === "all" && !isOwner) {
    return {
      authorized: false,
      error: "Forbidden: Consolidated 'All Branches' reading is strictly restricted to Organization Owners.",
      code: "CROSS_BRANCH_FORBIDDEN",
    };
  }

  // Strict branch isolation: non-owners cannot read operational records for branches they are not assigned to
  if (branchId && branchId !== "all" && !isOwner) {
    if (!hasBranchAccess(membership, branchId)) {
      return {
        authorized: false,
        error: `Cross-Branch Forbidden: You do not have read access for branch '${branchId}'.`,
        code: "CROSS_BRANCH_FORBIDDEN",
      };
    }
  }

  // Permission check if a specific permission is requested (e.g. REPORTS_VIEW, GST_VIEW, CA_REVIEW_VIEW)
  if (permission && !isOwner) {
    const allowed = hasBranchPermission(membership, branchId || undefined, permission);
    if (!allowed) {
      return {
        authorized: false,
        error: `Forbidden: You do not have the required permission '${permission}'.`,
        code: "FORBIDDEN",
      };
    }
  }

  return {
    authorized: true,
    membership,
  };
}

/**
 * Server-Authoritative Document Read Guard (Pre-Merge Blocker 2)
 * Ensures document fetch, search result, or PDF generation cannot expose Branch-B documents
 * to a Branch-A-only user.
 */
export async function verifyDocumentReadPermission(params: {
  db?: Database | any;
  companyId: string;
  callerUid: string;
  document: { branchId?: string; id?: string; companyId?: string };
  branchId?: string | null;
  permission?: CanonicalPermission | string;
  membership?: Membership;
}): Promise<PermissionCheckResult> {
  const branchId = params.branchId ?? params.document?.branchId;
  return verifyServerReadPermission({
    ...params,
    branchId,
  });
}

