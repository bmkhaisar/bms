import test from "node:test";
import assert from "node:assert/strict";

// Import compiled or source module helpers
import { CANONICAL_PERMISSIONS, hasBranchAccess, hasBranchPermission, canUserCreateBranch } from "../src/modules/auth/permissions.ts";
import { resolveBranchCompanyContext } from "../src/modules/company/types.ts";

test("Multi-Branch Security: BRANCH_CREATE is not an assignable permission", () => {
  assert.equal(
    CANONICAL_PERMISSIONS.includes("BRANCH_CREATE"),
    false,
    "BRANCH_CREATE must NOT exist as an assignable permission (PRD § 9)"
  );
  assert.ok(
    CANONICAL_PERMISSIONS.includes("BRANCH_VIEW"),
    "BRANCH_VIEW should be an assignable permission"
  );
});

test("Multi-Branch Security: Only role == 'owner' can create branches", () => {
  const ownerMembership = {
    userId: "user_owner_a",
    companyId: "org_a",
    organizationRole: "owner",
    role: "owner",
    status: "active",
  };
  const adminMembership = {
    userId: "user_admin_a",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "active",
    customPermissions: ["INVOICE_CREATE", "QUOTATION_CREATE"],
  };
  const managerMembership = {
    userId: "user_mgr_a",
    companyId: "org_a",
    organizationRole: "manager",
    role: "manager",
    status: "active",
  };
  const salesMembership = {
    userId: "user_sales_a",
    companyId: "org_a",
    organizationRole: "sales",
    role: "sales",
    status: "active",
  };

  assert.equal(canUserCreateBranch(ownerMembership), true, "Owner MUST be allowed to create branch");
  assert.equal(canUserCreateBranch(adminMembership), false, "Admin must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(managerMembership), false, "Manager must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(salesMembership), false, "Sales must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(null), false, "Null membership must NOT be allowed to create branch");
});

test("Multi-Branch Security: User branch access isolation within Organization A", () => {
  // USER_A1 assigned only to Branch A1
  const userA1 = {
    userId: "user_a1",
    companyId: "org_a",
    organizationRole: "sales",
    role: "sales",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_a1", permissions: ["INVOICE_VIEW", "INVOICE_CREATE"] },
    ],
  };

  // USER_A2 assigned to both Branch A1 and A2
  const userA2 = {
    userId: "user_a2",
    companyId: "org_a",
    organizationRole: "manager",
    role: "manager",
    status: "active",
    allBranches: false,
    branchAccess: [
      { branchId: "branch_a1", permissions: ["INVOICE_VIEW"] },
      { branchId: "branch_a2", permissions: ["INVOICE_VIEW", "INVOICE_CREATE"] },
    ],
  };

  // OWNER_A has all branches
  const ownerA = {
    userId: "owner_a",
    companyId: "org_a",
    organizationRole: "owner",
    role: "owner",
    status: "active",
    allBranches: true,
  };

  // USER_A1 access assertions
  assert.equal(hasBranchAccess(userA1, "branch_a1"), true, "USER_A1 has access to branch_a1");
  assert.equal(hasBranchAccess(userA1, "branch_a2"), false, "USER_A1 CANNOT access branch_a2");
  assert.equal(hasBranchAccess(userA1, "branch_b1"), false, "USER_A1 CANNOT access branch_b1 in ORG_B");

  // USER_A2 access assertions
  assert.equal(hasBranchAccess(userA2, "branch_a1"), true, "USER_A2 has access to branch_a1");
  assert.equal(hasBranchAccess(userA2, "branch_a2"), true, "USER_A2 has access to branch_a2");
  assert.equal(hasBranchAccess(userA2, "branch_b1"), false, "USER_A2 CANNOT access branch_b1 in ORG_B");

  // OWNER_A access assertions
  assert.equal(hasBranchAccess(ownerA, "branch_a1"), true, "OWNER_A has access to branch_a1");
  assert.equal(hasBranchAccess(ownerA, "branch_a2"), true, "OWNER_A has access to branch_a2");
  assert.equal(hasBranchAccess(ownerA, "any_new_branch"), true, "OWNER_A has access to all company branches");
});

test("Multi-Branch Security: Granular permissions per branch prevent forged mutations", () => {
  const branchUser = {
    userId: "user_a1",
    companyId: "org_a",
    organizationRole: "sales",
    role: "sales",
    status: "active",
    allBranches: false,
    branchAccess: [
      {
        branchId: "branch_a1",
        permissions: ["INVOICE_VIEW", "INVOICE_CREATE"],
      },
      {
        branchId: "branch_a2",
        permissions: ["INVOICE_VIEW"], // View only on branch_a2
      },
    ],
  };

  // Authorized on branch_a1
  assert.equal(
    hasBranchPermission(branchUser, "branch_a1", "INVOICE_CREATE"),
    true,
    "User can create invoices on branch_a1"
  );
  assert.equal(
    hasBranchPermission(branchUser, "branch_a1", "INVOICE_VIEW"),
    true,
    "User can view invoices on branch_a1"
  );

  // Unauthorized on branch_a2 (attempted forged branchId)
  assert.equal(
    hasBranchPermission(branchUser, "branch_a2", "INVOICE_CREATE"),
    false,
    "User CANNOT create invoices on branch_a2 (forged branchId rejection)"
  );
  assert.equal(
    hasBranchPermission(branchUser, "branch_a2", "INVOICE_VIEW"),
    true,
    "User can view invoices on branch_a2"
  );

  // Unassigned branch_a3
  assert.equal(
    hasBranchPermission(branchUser, "branch_a3", "INVOICE_VIEW"),
    false,
    "User CANNOT view unassigned branch_a3"
  );
  assert.equal(
    hasBranchPermission(branchUser, "branch_a3", "INVOICE_CREATE"),
    false,
    "User CANNOT create on unassigned branch_a3"
  );
});

test("Multi-Branch Security: Suspended user membership rejects all branch access", () => {
  const suspendedUser = {
    userId: "user_suspended",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "suspended",
    allBranches: true,
  };

  assert.equal(hasBranchAccess(suspendedUser, "branch_a1"), false, "Suspended user cannot access any branch");
  assert.equal(hasBranchPermission(suspendedUser, "branch_a1", "INVOICE_VIEW"), false, "Suspended user cannot view");
});

test("Multi-Branch Context Resolution: Branch Overrides fallback to Organization Defaults", () => {
  const company = {
    id: "org_a",
    name: "Acme Industrial Pvt Ltd",
    legalName: "Acme Industrial Private Limited",
    address: "100 MG Road",
    city: "Bangalore",
    state: "Karnataka",
    pincode: "560001",
    country: "India",
    gstin: "29AAAAA0000A1Z5",
    phone: "080-12345678",
    email: "info@acme.com",
    bankName: "State Bank of India",
    bankAccountNo: "1234567890",
    bankIfsc: "SBIN0001234",
  };

  const branchWithOverrides = {
    id: "branch_hoskote",
    companyId: "org_a",
    code: "HOS",
    name: "Hoskote Plant",
    status: "active",
    isMainBranch: false,
    address: "Plot 42, Hoskote Industrial Area",
    city: "Hoskote",
    state: "Karnataka",
    pincode: "562114",
    phone: "080-99998888",
    gstRegistrationId: "29BBBBB0000B1Z6", // Branch GST override
    invoicePrefix: "INV/HOS",
  };

  const resolved = resolveBranchCompanyContext(company, branchWithOverrides);

  // Overrides applied
  assert.equal(resolved.address, "Plot 42, Hoskote Industrial Area", "Branch address override applied");
  assert.equal(resolved.city, "Hoskote", "Branch city override applied");
  assert.equal(resolved.pincode, "562114", "Branch pincode override applied");
  assert.equal(resolved.phone, "080-99998888", "Branch phone override applied");
  assert.equal(resolved.gstin, "29BBBBB0000B1Z6", "Branch GSTIN override applied");
  assert.equal(resolved.invoicePrefix, "INV/HOS", "Branch invoice prefix applied");

  // Fallbacks to organization default
  assert.equal(resolved.name, "Acme Industrial Pvt Ltd", "Company name preserved");
  assert.equal(resolved.legalName, "Acme Industrial Private Limited", "Company legal name preserved");
  assert.equal(resolved.bankName, "State Bank of India", "Bank details fallback to company master");
  assert.equal(resolved.bankAccountNo, "1234567890", "Bank account fallback to company master");
});
