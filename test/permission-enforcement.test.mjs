import test from "node:test";
import assert from "node:assert/strict";
import { verifyServerPermission } from "../src/server/auth/permissionGuard.ts";
import { hasBranchPermission, CANONICAL_PERMISSIONS } from "../src/modules/auth/permissions.ts";

/**
 * Mock Database for permission tests
 */
class MockPermDatabase {
  constructor(memberships = {}) {
    this.memberships = memberships;
  }

  ref(path = "") {
    const parts = path.split("/");
    if (parts[0] === "memberships") {
      const companyId = parts[1];
      const uid = parts[2];
      const mem = this.memberships[`${companyId}/${uid}`];
      return {
        once: async () => ({
          exists: () => mem !== undefined && mem !== null,
          val: () => mem || null,
        }),
      };
    }
    return {
      once: async () => ({
        exists: () => false,
        val: () => null,
      }),
    };
  }
}

test("Server-Side Permission Enforcement: Manipulated direct requests rejected without required permission", async () => {
  const companyId = "comp_security_test";
  const userNoPerms = "user_viewer_restricted";
  const userFullSales = "user_sales_agent";
  const userBranch1Only = "user_branch1_only";

  const db = new MockPermDatabase({
    // User with Viewer role only (no create/edit/post, no manage)
    [`${companyId}/${userNoPerms}`]: {
      companyId,
      userId: userNoPerms,
      role: "viewer",
      organizationRole: "viewer",
      status: "active",
      allBranches: true,
      permissions: ["DASHBOARD_VIEW", "INVOICE_VIEW", "QUOTATION_VIEW"],
    },
    // User with Sales role on Branch 1 only
    [`${companyId}/${userBranch1Only}`]: {
      companyId,
      userId: userBranch1Only,
      role: "sales",
      organizationRole: "sales",
      status: "active",
      allBranches: false,
      branchIds: ["br_branch_1"],
      branchAccess: [
        {
          branchId: "br_branch_1",
          role: "sales",
          permissions: [
            "INVOICE_CREATE",
            "INVOICE_EDIT",
            "INVOICE_POST",
            "QUOTATION_CREATE",
            "QUOTATION_EDIT",
            "RECEIPT_CREATE",
          ],
        },
      ],
    },
    // User with Accountant role (has REPORTS_VIEW, GST_VIEW, CA_REVIEW_VIEW)
    [`${companyId}/user_accountant`]: {
      companyId,
      userId: "user_accountant",
      role: "accountant",
      organizationRole: "accountant",
      status: "active",
      allBranches: true,
      permissions: [
        "REPORTS_VIEW",
        "GST_VIEW",
        "CA_REVIEW_VIEW",
        "INVOICE_POST",
        "PURCHASE_POST",
      ],
    },
  });

  const criticalActions = [
    "INVOICE_CREATE",
    "INVOICE_EDIT",
    "INVOICE_POST",
    "QUOTATION_CREATE",
    "QUOTATION_EDIT",
    "RECEIPT_CREATE",
    "PURCHASE_CREATE",
    "PURCHASE_POST",
    "INVENTORY_MANAGE",
    "REPORTS_VIEW",
    "GST_VIEW",
    "CA_REVIEW_VIEW",
  ];

  // 1. Prove that userNoPerms is strictly REJECTED for all prohibited actions
  for (const action of [
    "INVOICE_CREATE",
    "INVOICE_EDIT",
    "INVOICE_POST",
    "QUOTATION_CREATE",
    "QUOTATION_EDIT",
    "RECEIPT_CREATE",
    "PURCHASE_CREATE",
    "PURCHASE_POST",
    "INVENTORY_MANAGE",
    "CA_REVIEW_VIEW",
  ]) {
    const res = await verifyServerPermission({
      db,
      companyId,
      callerUid: userNoPerms,
      permission: action,
    });

    assert.equal(
      res.authorized,
      false,
      `Manipulated direct request for '${action}' by unprivileged user must be REJECTED on server`
    );
    assert.equal(res.code, "FORBIDDEN");
  }

  // 2. Prove that branch-scoped user CANNOT mutate a branch they are not assigned to
  const crossBranchAction = await verifyServerPermission({
    db,
    companyId,
    callerUid: userBranch1Only,
    permission: "INVOICE_CREATE",
    branchId: "br_branch_2", // Not assigned to Branch 2
  });

  assert.equal(
    crossBranchAction.authorized,
    false,
    "Manipulated direct request for Branch 2 by user assigned only to Branch 1 must be REJECTED"
  );
  assert.equal(crossBranchAction.code, "FORBIDDEN");

  // 3. Prove that branch-scoped user CAN mutate Branch 1 where they have permission
  const validBranchAction = await verifyServerPermission({
    db,
    companyId,
    callerUid: userBranch1Only,
    permission: "INVOICE_CREATE",
    branchId: "br_branch_1",
  });

  assert.equal(validBranchAction.authorized, true, "Valid request for assigned branch must be authorized");

  // 4. Prove that Accountant has access to Compliance Views (GST_VIEW, CA_REVIEW_VIEW, REPORTS_VIEW)
  for (const view of ["REPORTS_VIEW", "GST_VIEW", "CA_REVIEW_VIEW"]) {
    const res = await verifyServerPermission({
      db,
      companyId,
      callerUid: "user_accountant",
      permission: view,
    });
    assert.equal(res.authorized, true, `Accountant must have access to ${view}`);
  }

  // 5. Prove that Viewer is denied CA_REVIEW_VIEW and GST_VIEW
  const viewerCa = await verifyServerPermission({
    db,
    companyId,
    callerUid: userNoPerms,
    permission: "CA_REVIEW_VIEW",
  });
  assert.equal(viewerCa.authorized, false, "Viewer cannot access CA_REVIEW_VIEW");

  const viewerGst = await verifyServerPermission({
    db,
    companyId,
    callerUid: userNoPerms,
    permission: "GST_VIEW",
  });
  assert.equal(viewerGst.authorized, false, "Viewer cannot access GST_VIEW");
});
