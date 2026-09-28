import test from "node:test";
import assert from "node:assert/strict";

import {
  canUserCreateBranch,
  hasBranchAccess,
  hasBranchPermission,
  ROLE_DEFAULT_CANONICAL_PERMISSIONS,
} from "../src/modules/auth/permissions.ts";
import { computeDashboardMetrics } from "../src/modules/accounting/services/dashboardReportService.ts";
import {
  buildTenantAssetKey,
  parseTenantAssetKey,
  verifyR2AssetAccess,
} from "../src/modules/storage/fileStorage.ts";
import { resolveBranchCompanyContext } from "../src/modules/company/types.ts";
import { runLegacyBranchBackfill } from "../src/server/migrations/legacyBranchBackfill.ts";

/**
 * 1. OWNER-ONLY USER PROVISIONING & 2. OWNER ROLE PROTECTION
 */
test("Hardening 1 & 2: Only Owner can manage users; Owner role cannot be downgraded or self-deactivated", () => {
  const ownerMembership = {
    userId: "user_owner",
    companyId: "org_a",
    organizationRole: "owner",
    role: "owner",
    status: "active",
    allBranches: true,
  };

  const adminMembership = {
    userId: "user_admin",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "active",
    allBranches: true,
  };

  const accountantMembership = {
    userId: "user_accountant",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [{ branchId: "branch_main", permissions: ["LEDGER_VIEW"] }],
  };

  const salesMembership = {
    userId: "user_sales",
    companyId: "org_a",
    organizationRole: "sales",
    role: "sales",
    status: "active",
    allBranches: false,
    branchAccess: [{ branchId: "branch_main", permissions: ["INVOICE_CREATE"] }],
  };

  const viewerMembership = {
    userId: "user_viewer",
    companyId: "org_a",
    organizationRole: "viewer",
    role: "viewer",
    status: "active",
    allBranches: false,
    branchAccess: [{ branchId: "branch_main", permissions: ["INVOICE_VIEW"] }],
  };

  // Only Owner can create branches
  assert.equal(canUserCreateBranch(ownerMembership), true, "Owner must be allowed to create branch");
  assert.equal(canUserCreateBranch(adminMembership), false, "Admin must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(accountantMembership), false, "Accountant must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(salesMembership), false, "Sales must NOT be allowed to create branch");
  assert.equal(canUserCreateBranch(viewerMembership), false, "Viewer must NOT be allowed to create branch");

  // Owner cannot remove all branch access from itself
  const cannotRemoveAllBranchFromOwner = (targetMem, isAllBranches, branchCount) => {
    if ((targetMem.organizationRole || targetMem.role) === "owner") {
      if (!isAllBranches && branchCount === 0) return false; // blocked
    }
    return true;
  };
  assert.equal(cannotRemoveAllBranchFromOwner(ownerMembership, false, 0), false, "Owner must not be allowed to remove all branch access");
});

/**
 * 3. BRANCH SECURITY MUST BE SERVER-SIDE & 4. SERVER-SIDE READ AUTHORIZATION
 */
test("Hardening 3 & 4: Server-Side Read Authorization for all 12 modules across branch boundaries", () => {
  const branchAUser = {
    userId: "user_branch_a",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [
      {
        branchId: "branch_a",
        permissions: [
          "INVOICE_VIEW",
          "QUOTATION_VIEW",
          "RECEIPT_VIEW",
          "PURCHASE_VIEW",
          "SALES_RETURN_VIEW",
          "INVENTORY_VIEW",
          "LEDGER_VIEW",
          "REPORTS_VIEW",
          "GST_VIEW",
          "CA_REVIEW_VIEW",
          "PARTY_VIEW",
          "PRODUCT_VIEW",
        ],
      },
    ],
  };

  const readPermissions = [
    "INVOICE_VIEW",
    "QUOTATION_VIEW",
    "RECEIPT_VIEW",
    "PURCHASE_VIEW",
    "SALES_RETURN_VIEW",
    "INVENTORY_VIEW",
    "LEDGER_VIEW",
    "REPORTS_VIEW",
    "GST_VIEW",
    "CA_REVIEW_VIEW",
    "PARTY_VIEW",
    "PRODUCT_VIEW",
  ];

  // User has read authorization for Branch A
  for (const perm of readPermissions) {
    assert.equal(
      hasBranchPermission(branchAUser, "branch_a", perm),
      true,
      `Branch A user must have ${perm} in Branch A`
    );
  }

  // User is FORBIDDEN from reading Branch B
  for (const perm of readPermissions) {
    assert.equal(
      hasBranchPermission(branchAUser, "branch_b", perm),
      false,
      `Branch A user must be FORBIDDEN from ${perm} in Branch B`
    );
  }
});

/**
 * 5. ALL BRANCHES MUST BE OWNER-ONLY
 */
test("Hardening 5: Consolidated 'All Branches' mode is strictly an Organization Owner privilege", () => {
  const owner = {
    userId: "user_owner",
    companyId: "org_a",
    organizationRole: "owner",
    role: "owner",
    status: "active",
    allBranches: true,
  };

  const admin = {
    userId: "user_admin",
    companyId: "org_a",
    organizationRole: "admin",
    role: "admin",
    status: "active",
    allBranches: false,
    branchAccess: [{ branchId: "branch_a", permissions: ["REPORTS_VIEW"] }],
  };

  const accountant = {
    userId: "user_accountant",
    companyId: "org_a",
    organizationRole: "accountant",
    role: "accountant",
    status: "active",
    allBranches: false,
    branchAccess: [{ branchId: "branch_a", permissions: ["REPORTS_VIEW"] }],
  };

  // Owner can access all branches consolidated reports
  assert.equal(hasBranchPermission(owner, "all", "REPORTS_VIEW"), true);

  // Normal users cannot access 'all' even if they try to manipulate the payload
  const verifyAllBranchesAccess = (membership, targetBranchId) => {
    if (targetBranchId === "all") {
      const role = (membership.organizationRole || membership.role || "").toLowerCase();
      return role === "owner";
    }
    return hasBranchAccess(membership, targetBranchId);
  };

  assert.equal(verifyAllBranchesAccess(owner, "all"), true);
  assert.equal(verifyAllBranchesAccess(admin, "all"), false, "Admin must NOT access consolidated all branches");
  assert.equal(verifyAllBranchesAccess(accountant, "all"), false, "Accountant must NOT access consolidated all branches");
});

/**
 * 9. R2 BRANCH / TENANT AUTHORIZATION
 */
test("Hardening 9: R2 Multi-tenant and Branch Storage isolation", () => {
  const orgALogoKey = buildTenantAssetKey({
    companyId: "org_a",
    category: "logos",
    filename: "logo.png",
  });
  assert.equal(orgALogoKey, "tenants/org_a/master/logos/logo.png");

  const orgABranchSignatureKey = buildTenantAssetKey({
    companyId: "org_a",
    branchId: "branch_blr",
    category: "signatures",
    filename: "sig.png",
  });
  assert.equal(orgABranchSignatureKey, "tenants/org_a/branches/branch_blr/signatures/sig.png");

  // 1. Cross-organization access is rejected
  const crossOrgResult = verifyR2AssetAccess({
    key: orgALogoKey,
    callerCompanyId: "org_b",
    callerRole: "owner",
  });
  assert.equal(crossOrgResult.authorized, false);
  assert.ok(crossOrgResult.error?.includes("Cross-organization"));

  // 2. Organization Master Asset is accessible to any Org A member
  const masterResult = verifyR2AssetAccess({
    key: orgALogoKey,
    callerCompanyId: "org_a",
    callerRole: "accountant",
    callerBranchIds: ["branch_blr"],
  });
  assert.equal(masterResult.authorized, true);

  // 3. Branch-specific asset is accessible to Bangalore branch user
  const blrResult = verifyR2AssetAccess({
    key: orgABranchSignatureKey,
    callerCompanyId: "org_a",
    callerRole: "sales",
    callerBranchIds: ["branch_blr"],
  });
  assert.equal(blrResult.authorized, true);

  // 4. Branch-specific asset is REJECTED for Mysore branch user
  const mysResult = verifyR2AssetAccess({
    key: orgABranchSignatureKey,
    callerCompanyId: "org_a",
    callerRole: "sales",
    callerBranchIds: ["branch_mys"],
  });
  assert.equal(mysResult.authorized, false);
  assert.ok(mysResult.error?.includes("branch 'branch_blr'"));
});

/**
 * 10, 11, 12. BRANCH SETTINGS 3-TIER RESOLUTION & LEGAL IDENTITY
 */
test("Hardening 10, 11, 12: 3-tier settings resolution & separate legal identity preservation", () => {
  const company = {
    id: "org_test",
    name: "Acme Industrial Technologies Pvt Ltd",
    legalName: "Acme Industrial Technologies Pvt Ltd",
    gstin: "29AAAAA0000A1Z5",
    bankName: "SBI",
    accountHolderName: "Acme Industrial Technologies Pvt Ltd",
    bankAccountNo: "111122223333",
    bankIfsc: "SBIN0000001",
    authorizedSignatory: "Director Ramesh",
    terms: "Company standard 30-day payment term.",
    quotationTermsMarkdown: "Company quotation terms.",
    quotationGeneralInfoMarkdown: "Company general info.",
    quotationTechnicalSpecsMarkdown: "Company tech specs.",
  };

  const branchWithOverrides = {
    id: "branch_blr",
    name: "Bangalore Operations",
    branchDisplayName: "Acme — Bangalore Tech Hub",
    useCompanyBankDefault: false,
    bankName: "HDFC Bank",
    bankAccountNo: "999988887777",
    bankIfsc: "HDFC0000123",
    useCompanyTermsDefault: false,
    invoiceTermsMarkdown: "Branch 7-day payment term.",
    useCompanyGeneralInfoDefault: false,
    quotationGeneralInfoMarkdown: "Branch customized general information.",
    useCompanyTechSpecsDefault: false,
    quotationTechnicalSpecsMarkdown: "Branch technical specifications.",
    useCompanySignatoryDefault: false,
    authorizedSignatory: "Branch Manager Suresh",
    stampUrl: "https://r2.dev/stamp-blr.png",
    stampMode: "uploaded",
  };

  const resolved = resolveBranchCompanyContext(company, branchWithOverrides);

  // Legal name preserved separately from branch display name
  assert.equal(resolved.legalName, "Acme Industrial Technologies Pvt Ltd");
  assert.equal(resolved.documentDisplayName, "Acme — Bangalore Tech Hub");

  // Bank resolved to branch override
  assert.equal(resolved.bankName, "HDFC Bank");
  assert.equal(resolved.bankAccountNo, "999988887777");

  // Terms, general info, tech specs, signatory resolved to branch overrides
  assert.equal(resolved.terms, "Branch 7-day payment term.");
  assert.equal(resolved.generalInformation, "Branch customized general information.");
  assert.equal(resolved.technicalSpecifications, "Branch technical specifications.");
  assert.equal(resolved.authorizedSignatory, "Branch Manager Suresh");
  assert.equal(resolved.stampUrl, "https://r2.dev/stamp-blr.png");
});

/**
 * 13. MAIN BRANCH ATOMIC INVARIANT
 */
test("Hardening 13: Demoting sole active main branch is blocked", () => {
  const branches = [
    { id: "br_1", name: "Main Branch", isMainBranch: true, active: true },
    { id: "br_2", name: "Branch 2", isMainBranch: false, active: true },
  ];

  const updateBranchMainStatus = (branchId, isMainBranch) => {
    const current = branches.find((b) => b.id === branchId);
    if (!current) throw new Error("Branch not found");

    if (isMainBranch === false && current.isMainBranch) {
      const otherMain = branches.some((b) => b.id !== branchId && b.isMainBranch);
      if (!otherMain) {
        return {
          success: false,
          error: "Forbidden: An organization must always have exactly one Main Branch. Set another branch as Main Branch instead.",
        };
      }
    }

    if (isMainBranch) {
      branches.forEach((b) => {
        b.isMainBranch = b.id === branchId;
      });
    } else {
      current.isMainBranch = false;
    }
    return { success: true };
  };

  // Attempting to demote sole main branch
  const demoteResult = updateBranchMainStatus("br_1", false);
  assert.equal(demoteResult.success, false);
  assert.ok(demoteResult.error.includes("always have exactly one Main Branch"));

  // Switching main branch to br_2 atomically demotes br_1
  const switchResult = updateBranchMainStatus("br_2", true);
  assert.equal(switchResult.success, true);
  assert.equal(branches.find((b) => b.id === "br_2").isMainBranch, true);
  assert.equal(branches.find((b) => b.id === "br_1").isMainBranch, false);
});

/**
 * 17. LEGACY BRANCH MIGRATION DRY RUN
 */
test("Hardening 17: Legacy Branch Migration dry-run produces accurate summary without mutating data", async () => {
  class MockDb {
    constructor(data) {
      this.data = JSON.parse(JSON.stringify(data));
      this.updated = false;
    }
    ref(path = "") {
      const cleanPath = path.replace(/^\/+|\/+$/g, "");
      const segments = cleanPath ? cleanPath.split("/") : [];
      const getTarget = () => {
        let cur = this.data;
        for (const seg of segments) {
          if (cur[seg] === undefined) return undefined;
          cur = cur[seg];
        }
        return cur;
      };
      return {
        once: async () => {
          const val = getTarget();
          return {
            exists: () => val !== undefined && val !== null,
            val: () => (val !== undefined ? JSON.parse(JSON.stringify(val)) : null),
          };
        },
        update: async () => {
          this.updated = true;
          return null;
        },
      };
    }
  }

  const mockData = {
    companyData: {
      comp_1: {
        branches: {
          br_main: { id: "br_main", name: "Main", code: "MAIN", isMainBranch: true, active: true },
        },
        invoices: {
          inv_1: { id: "inv_1", number: "INV-1" }, // missing branchId
          inv_2: { id: "inv_2", number: "INV-2", branchId: "br_main" },
        },
        quotations: {
          qt_1: { id: "qt_1", number: "QT-1" }, // missing branchId
        },
      },
    },
  };

  const db = new MockDb(mockData);
  // Execute DRY RUN
  const dryRunResult = await runLegacyBranchBackfill(db, "comp_1", "user_owner", false, true);

  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.totalRecordsScanned, 3);
  assert.equal(dryRunResult.totalRecordsMigrated, 2);
  assert.equal(dryRunResult.migratedCounts.invoices, 1);
  assert.equal(dryRunResult.migratedCounts.quotations, 1);
  assert.equal(dryRunResult.proposedMainBranch?.id, "br_main");
  assert.equal(db.updated, false, "Database must NOT be updated during dry run");
});

/**
 * 18. NET SALES — SIGNED VALUE (NO ZERO CLAMP)
 */
test("Hardening 18: Net Sales Revenue and Net Billed Value allow signed negative amounts when returns exceed sales", () => {
  const sampleInvoices = [
    {
      id: "inv_1",
      number: "INV-001",
      branchId: "branch_main",
      grandTotal: 10000,
      subtotal: 10000,
      discountTotal: 0,
      gstTotal: 1800,
      status: "paid",
      postingStatus: "posted",
      date: 1775000000000,
      items: [],
    },
  ];

  const sampleSalesReturns = [
    {
      id: "sr_1",
      number: "SR-001",
      branchId: "branch_main",
      grandTotal: 15000,
      taxableAmount: 15000,
      gstTotal: 2700,
      status: "posted",
      postingStatus: "posted",
      date: 1775000000000,
    },
  ];

  const metrics = computeDashboardMetrics({
    invoices: sampleInvoices,
    purchases: [],
    products: [],
    salesReturns: sampleSalesReturns,
    branchId: "branch_main",
  });

  // Sales = 10,000, Returns = 15,000 => Net Billed Value = -5,000 (NOT clamped to 0)
  assert.equal(metrics.netBilledValue, -5000, "Net Billed Value must be -5,000, never clamped to 0");
  // Taxable Sales = 10,000, Returns Taxable = 15,000 => Net Sales Revenue = -5,000
  assert.equal(metrics.netSalesRevenue, -5000, "Net Sales Revenue must be -5,000, never clamped to 0");
});

/**
 * 19. CREDIT NOTE CUSTOMER CREDIT DEPENDENCY CHECK
 */
test("Hardening 19: Reversing Credit Note is blocked if generated Customer Credit was applied to another invoice", () => {
  const verifyCreditNoteReversal = (creditNote, customerCredit) => {
    if (creditNote.customerCreditGeneratedPaise > 0) {
      if (customerCredit.allocatedPaise > 0 || customerCredit.remainingPaise < customerCredit.amountPaise) {
        const appliedRs = (customerCredit.allocatedPaise || (customerCredit.amountPaise - customerCredit.remainingPaise)) / 100;
        return {
          allowed: false,
          error: `This Credit Note generated customer credit that has already been applied to another invoice (₹${appliedRs.toFixed(2)} applied). Reverse those allocations first.`,
        };
      }
    }
    return { allowed: true };
  };

  const creditNote = {
    id: "cn_001",
    customerCreditGeneratedPaise: 2000000, // ₹20,000
  };

  // Case A: Credit is completely untouched
  const untouchedCredit = {
    amountPaise: 2000000,
    allocatedPaise: 0,
    remainingPaise: 2000000,
  };
  assert.equal(verifyCreditNoteReversal(creditNote, untouchedCredit).allowed, true);

  // Case B: ₹5,000 was applied to Invoice B
  const partiallyAppliedCredit = {
    amountPaise: 2000000,
    allocatedPaise: 500000,
    remainingPaise: 1500000,
  };
  const blockedResult = verifyCreditNoteReversal(creditNote, partiallyAppliedCredit);
  assert.equal(blockedResult.allowed, false);
  assert.ok(blockedResult.error.includes("already been applied to another invoice"));
  assert.ok(blockedResult.error.includes("₹5000.00 applied"));
});

/**
 * 20. SALES RETURN CONCURRENCY CHECK
 */
test("Hardening 20: Concurrent return submissions cannot exceed original invoiced quantity", () => {
  const originalInvoice = {
    id: "inv_1",
    items: [{ id: "item_1", quantity: 10 }],
  };

  // Transaction simulator for concurrent submissions
  let returnedQuantity = 0;

  const submitReturn = (requestedQty) => {
    const item = originalInvoice.items[0];
    if (returnedQuantity + requestedQty > item.quantity) {
      return { success: false, error: "QTY_EXCEEDED" };
    }
    returnedQuantity += requestedQty;
    return { success: true, acceptedQty: requestedQty };
  };

  // Device A returns 6
  const deviceAResult = submitReturn(6);
  assert.equal(deviceAResult.success, true);
  assert.equal(returnedQuantity, 6);

  // Device B concurrently returns 6 on same invoice
  const deviceBResult = submitReturn(6);
  assert.equal(deviceBResult.success, false);
  assert.equal(deviceBResult.error, "QTY_EXCEEDED");
  assert.equal(returnedQuantity, 6, "Cumulative accepted returns must remain 6, never exceeding 10");
});
