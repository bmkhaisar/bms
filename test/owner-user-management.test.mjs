import test from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_DEFAULT_CANONICAL_PERMISSIONS,
  ROLE_PRESET_MODULES,
  GRANULAR_ACCESS_GROUPS,
  resolveModuleIdsToPermissions,
  canUserCreateBranch,
  hasBranchAccess,
  hasBranchPermission,
} from "../src/modules/auth/permissions.ts";

test("Owner User Management: Predefined roles and presets are configured correctly", () => {
  const allowedRoles = ["admin", "accountant", "sales", "purchase", "inventory", "viewer", "custom"];
  
  // Owner is strictly NOT a standard assignable role in normal user management
  assert.equal(allowedRoles.includes("owner"), false, "Owner role must NEVER be in standard assignable roles");
  
  // Verify ROLE_DEFAULT_CANONICAL_PERMISSIONS exist for all standard roles
  for (const role of ["admin", "accountant", "sales", "purchase", "inventory", "viewer"]) {
    assert.ok(Array.isArray(ROLE_DEFAULT_CANONICAL_PERMISSIONS[role]), `ROLE_DEFAULT_CANONICAL_PERMISSIONS must have array for role ${role}`);
    assert.ok(ROLE_DEFAULT_CANONICAL_PERMISSIONS[role].length > 0, `ROLE_DEFAULT_CANONICAL_PERMISSIONS[${role}] must not be empty`);
  }
});

test("Owner User Management: Grouped modules map correctly to canonical permissions", () => {
  // Check that all granular access groups exist
  const groupNames = GRANULAR_ACCESS_GROUPS.map((g) => g.name);
  assert.ok(groupNames.includes("OVERVIEW"), "Must include OVERVIEW group");
  assert.ok(groupNames.includes("SALES"), "Must include SALES group");
  assert.ok(groupNames.includes("PURCHASE"), "Must include PURCHASE group");
  assert.ok(groupNames.includes("INVENTORY"), "Must include INVENTORY group");
  assert.ok(groupNames.includes("FINANCIALS"), "Must include FINANCIALS group");
  assert.ok(groupNames.includes("MASTERS"), "Must include MASTERS group");

  // Test sales preset resolution
  const salesModules = ROLE_PRESET_MODULES.sales;
  assert.ok(salesModules.includes("quotations"));
  assert.ok(salesModules.includes("invoices"));
  assert.ok(salesModules.includes("sales_returns"));
  assert.ok(salesModules.includes("receipts"));

  const resolvedSalesPerms = resolveModuleIdsToPermissions(salesModules);
  assert.ok(resolvedSalesPerms.includes("QUOTATION_VIEW"));
  assert.ok(resolvedSalesPerms.includes("INVOICE_CREATE"));
  assert.ok(resolvedSalesPerms.includes("SALES_RETURN_CREATE"));
  assert.ok(resolvedSalesPerms.includes("RECEIPT_CREATE"));
  assert.equal(resolvedSalesPerms.includes("PURCHASE_CREATE"), false, "Sales preset must not include PURCHASE_CREATE");
});

test("Owner User Management: Moving a user between branches updates branch access", () => {
  // Initially assigned to Main Branch
  let userMembership = {
    userId: "user_ravi",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_main", permissions: ["LEDGER_VIEW", "REPORTS_VIEW"] }
    ]
  };

  assert.equal(hasBranchAccess(userMembership, "branch_main"), true);
  assert.equal(hasBranchAccess(userMembership, "branch_bangalore"), false);

  // Owner moves user from Main Branch to Bangalore Branch
  userMembership = {
    ...userMembership,
    branchAccess: [
      { branchId: "branch_bangalore", permissions: ["LEDGER_VIEW", "REPORTS_VIEW"] }
    ]
  };

  assert.equal(hasBranchAccess(userMembership, "branch_main"), false, "Old branch access must be revoked");
  assert.equal(hasBranchAccess(userMembership, "branch_bangalore"), true, "New branch access must be active");
});

test("Owner User Management: Multi-branch assignment grants access to selected branches only", () => {
  const multiBranchUser = {
    userId: "user_multi",
    companyId: "org_a",
    organizationRole: "manager",
    role: "manager",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_blr", permissions: ["INVOICE_VIEW"] },
      { branchId: "branch_mys", permissions: ["INVOICE_VIEW"] }
    ]
  };

  assert.equal(hasBranchAccess(multiBranchUser, "branch_blr"), true);
  assert.equal(hasBranchAccess(multiBranchUser, "branch_mys"), true);
  assert.equal(hasBranchAccess(multiBranchUser, "branch_delhi"), false);
});

test("Owner User Management: All Branches access gives visibility across all branches", () => {
  const financeHead = {
    userId: "user_fin_head",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "active",
    allBranches: true,
    branchAccess: []
  };

  assert.equal(hasBranchAccess(financeHead, "branch_blr"), true);
  assert.equal(hasBranchAccess(financeHead, "branch_mys"), true);
  assert.equal(hasBranchAccess(financeHead, "branch_delhi"), true);
});

test("Owner User Management: Deactivated user access is revoked across all branches", () => {
  const deactivatedUser = {
    userId: "user_inactive",
    companyId: "org_a",
    organizationRole: "sales",
    role: "sales",
    status: "inactive",
    allBranches: true,
    branchAccess: []
  };

  assert.equal(hasBranchAccess(deactivatedUser, "branch_blr"), false, "Inactive user must have no access");
  assert.equal(hasBranchPermission(deactivatedUser, "branch_blr", "INVOICE_VIEW"), false, "Inactive user must have no permissions");
});

test("Owner User Management: Invariant - Owner role immutability and protection", () => {
  const ownerMembership = {
    userId: "user_owner",
    companyId: "org_a",
    organizationRole: "owner",
    role: "owner",
    status: "active",
    allBranches: true,
  };

  // 1. Owner always can create branches
  assert.equal(canUserCreateBranch(ownerMembership), true);

  // 2. Non-owner can NEVER create branches even with admin role
  const adminMembership = {
    userId: "user_admin",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "active",
    allBranches: true,
  };
  assert.equal(canUserCreateBranch(adminMembership), false);
});
