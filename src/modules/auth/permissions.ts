import type { Membership, MembershipRole } from "@/modules/company/types";

/**
 * System-level Platform Administrator capabilities.
 * Strictly decoupled from tenant-level ROLE_CAPABILITIES to prevent
 * accidental tenant privilege escalation.
 */
export type PlatformPermission =
  | "platform.company.create"
  | "platform.company.list"
  | "platform.company.manage"
  | "platform.users.create"
  | "platform.users.list"
  | "platform.users.search"
  | "platform.access.grant"
  | "platform.access.update"
  | "platform.access.suspend"
  | "platform.access.reactivate"
  | "platform.access.revoke"
  | "platform.ownership.transfer"
  | "platform.audit.read";

/**
 * Standard granular company tenant capabilities.
 * Phase 2+ modules check these capabilities instead of scattering role strings.
 */
export type Capability =
  // Company & System
  | "company.view"
  | "company.settings.read"
  | "company.settings.update"
  | "company.delete"
  | "company.bootstrap"
  // Users & Access Control
  | "users.view"
  | "users.manage"
  | "memberships.invite"
  | "memberships.update"
  | "memberships.remove"
  // Accounting & Financials (Phase 2)
  | "accounting.voucher.read"
  | "accounting.voucher.create"
  | "accounting.voucher.void"
  | "accounting.voucher.post"
  | "accounting.ledger.read"
  | "accounting.ledger.manage"
  | "accounting.group.manage"
  | "accounting.period.lock"
  // Sales & Quotations (Phase 3)
  | "sales.read"
  | "sales.create"
  | "sales.update"
  | "sales.delete"
  | "quotations.read"
  | "quotations.create"
  | "quotations.update"
  | "quotations.delete"
  // Purchases & Payables (Phase 3)
  | "purchase.read"
  | "purchase.create"
  | "purchase.update"
  | "purchase.delete"
  // Inventory & Warehouses (Phase 4)
  | "inventory.read"
  | "inventory.adjust"
  | "inventory.transfer"
  | "inventory.warehouse.manage"
  // Reports & Auditing (Phase 5)
  | "reports.read"
  | "reports.financial"
  | "reports.gst"
  | "reports.audit";

/**
 * Default capabilities granted to each standard system role.
 */
export const ROLE_CAPABILITIES: Record<MembershipRole, readonly Capability[]> = {
  // Owner: Has wildcard access (handled directly in hasCapability)
  owner: [
    "company.view",
    "company.settings.read",
    "company.settings.update",
    "company.delete",
    "company.bootstrap",
    "users.view",
    "users.manage",
    "memberships.invite",
    "memberships.update",
    "memberships.remove",
    "accounting.voucher.read",
    "accounting.voucher.create",
    "accounting.voucher.void",
    "accounting.voucher.post",
    "accounting.ledger.read",
    "accounting.ledger.manage",
    "accounting.group.manage",
    "accounting.period.lock",
    "sales.read",
    "sales.create",
    "sales.update",
    "sales.delete",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "quotations.delete",
    "purchase.read",
    "purchase.create",
    "purchase.update",
    "purchase.delete",
    "inventory.read",
    "inventory.adjust",
    "inventory.transfer",
    "inventory.warehouse.manage",
    "reports.read",
    "reports.financial",
    "reports.gst",
    "reports.audit",
  ],

  // Admin: Everything except company deletion
  admin: [
    "company.view",
    "company.settings.read",
    "company.settings.update",
    "users.view",
    "users.manage",
    "memberships.invite",
    "memberships.update",
    "accounting.voucher.read",
    "accounting.voucher.create",
    "accounting.voucher.void",
    "accounting.voucher.post",
    "accounting.ledger.read",
    "accounting.ledger.manage",
    "accounting.group.manage",
    "sales.read",
    "sales.create",
    "sales.update",
    "sales.delete",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "quotations.delete",
    "purchase.read",
    "purchase.create",
    "purchase.update",
    "purchase.delete",
    "inventory.read",
    "inventory.adjust",
    "inventory.transfer",
    "inventory.warehouse.manage",
    "reports.read",
    "reports.financial",
    "reports.gst",
    "reports.audit",
  ],

  // Accountant: Full financial ledgers, vouchers, purchases, sales reads, reports
  accountant: [
    "company.view",
    "accounting.voucher.read",
    "accounting.voucher.create",
    "accounting.voucher.void",
    "accounting.voucher.post",
    "accounting.ledger.read",
    "accounting.ledger.manage",
    "accounting.group.manage",
    "sales.read",
    "purchase.read",
    "purchase.create",
    "purchase.update",
    "inventory.read",
    "reports.read",
    "reports.financial",
    "reports.gst",
  ],

  // Sales: Invoices, Quotations, Customers, read inventory
  sales: [
    "company.view",
    "sales.read",
    "sales.create",
    "sales.update",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "inventory.read",
    "reports.read",
  ],

  // Purchase: Purchase bills, Suppliers, read inventory
  purchase: [
    "company.view",
    "purchase.read",
    "purchase.create",
    "purchase.update",
    "inventory.read",
    "reports.read",
  ],

  // Inventory: Warehouses, stock movements, read products
  inventory: [
    "company.view",
    "inventory.read",
    "inventory.adjust",
    "inventory.transfer",
    "reports.read",
  ],

  // HR: Employee profiles and basic access
  hr: [
    "company.view",
    "reports.read",
  ],

  // Viewer: Read-only access to standard operational lists
  viewer: [
    "company.view",
    "sales.read",
    "purchase.read",
    "inventory.read",
    "reports.read",
  ],
};

/**
 * Canonical Granular Module Permissions (PRD § 9)
 * Note: BRANCH_CREATE is intentionally omitted — branch creation is exclusive to OWNER.
 */
export const CANONICAL_PERMISSIONS = [
  "DASHBOARD_VIEW",
  "PARTY_VIEW",
  "PARTY_CREATE",
  "PARTY_EDIT",
  "PRODUCT_VIEW",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "QUOTATION_VIEW",
  "QUOTATION_CREATE",
  "QUOTATION_EDIT",
  "QUOTATION_SHARE",
  "INVOICE_VIEW",
  "INVOICE_CREATE",
  "INVOICE_EDIT",
  "INVOICE_POST",
  "RECEIPT_VIEW",
  "RECEIPT_CREATE",
  "PURCHASE_VIEW",
  "PURCHASE_CREATE",
  "PURCHASE_POST",
  "SALES_RETURN_VIEW",
  "SALES_RETURN_CREATE",
  "SALES_RETURN_POST",
  "INVENTORY_VIEW",
  "INVENTORY_MANAGE",
  "LEDGER_VIEW",
  "REPORTS_VIEW",
  "GST_VIEW",
  "CA_REVIEW_VIEW",
  "USER_ACCESS_MANAGE",
  "BRANCH_VIEW",
] as const;

export type CanonicalPermission = (typeof CANONICAL_PERMISSIONS)[number];

export interface ModulePermissionGroup {
  id: string;
  label: string;
  description: string;
  permissions: Array<{
    id: CanonicalPermission;
    label: string;
    description: string;
  }>;
}

export const MODULE_PERMISSION_GROUPS: ModulePermissionGroup[] = [
  {
    id: "sales",
    label: "Sales & Invoicing",
    description: "Quotations, Tax Invoices, Receipts, and Sales Returns",
    permissions: [
      { id: "DASHBOARD_VIEW", label: "Dashboard", description: "View sales KPIs and performance metrics" },
      { id: "QUOTATION_VIEW", label: "Quotations View", description: "View client estimates and quotations" },
      { id: "QUOTATION_CREATE", label: "Quotations Create", description: "Draft new quotations" },
      { id: "QUOTATION_EDIT", label: "Quotations Edit", description: "Edit existing quotations" },
      { id: "QUOTATION_SHARE", label: "Quotations Share", description: "Export, download, and share quotations" },
      { id: "INVOICE_VIEW", label: "Invoices View", description: "View invoices" },
      { id: "INVOICE_CREATE", label: "Invoices Create", description: "Draft sales invoices" },
      { id: "INVOICE_EDIT", label: "Invoices Edit", description: "Edit draft invoices" },
      { id: "INVOICE_POST", label: "Invoices Post", description: "Authoritatively post invoices with accounting vouchers" },
      { id: "RECEIPT_VIEW", label: "Receipts View", description: "View customer payment receipts" },
      { id: "RECEIPT_CREATE", label: "Receipts Create", description: "Record and allocate customer payments" },
      { id: "SALES_RETURN_VIEW", label: "Sales Returns View", description: "View credit notes and return registers" },
      { id: "SALES_RETURN_CREATE", label: "Sales Returns Create", description: "Draft sales returns and credit notes" },
      { id: "SALES_RETURN_POST", label: "Sales Returns Post", description: "Post credit notes with double-entry vouchers" },
      { id: "PARTY_VIEW", label: "Parties View", description: "View customer & supplier directories" },
      { id: "PARTY_CREATE", label: "Parties Create", description: "Add new customers and parties" },
      { id: "PARTY_EDIT", label: "Parties Edit", description: "Edit party profiles and addresses" },
    ],
  },
  {
    id: "purchases",
    label: "Purchases & Payables",
    description: "Vendor bills, supplier tracking, and procurement",
    permissions: [
      { id: "PURCHASE_VIEW", label: "Purchases View", description: "View purchase bills and records" },
      { id: "PURCHASE_CREATE", label: "Purchases Create", description: "Draft purchase bills" },
      { id: "PURCHASE_POST", label: "Purchases Post", description: "Post purchase bills to accounts payable" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & Catalog",
    description: "Product master, stock movements, and valuation",
    permissions: [
      { id: "PRODUCT_VIEW", label: "Products View", description: "View items in the product master" },
      { id: "PRODUCT_CREATE", label: "Products Create", description: "Create new product catalog entries" },
      { id: "PRODUCT_EDIT", label: "Products Edit", description: "Edit product rates, sizes, and HSN codes" },
      { id: "INVENTORY_VIEW", label: "Inventory View", description: "View stock quantities across locations" },
      { id: "INVENTORY_MANAGE", label: "Inventory Manage", description: "Adjust and restock branch inventory" },
    ],
  },
  {
    id: "financials",
    label: "Financials & Compliance",
    description: "General ledger, Day Book, Trial Balance, GST, and CA review",
    permissions: [
      { id: "LEDGER_VIEW", label: "Ledgers", description: "View chart of accounts and transaction registers" },
      { id: "REPORTS_VIEW", label: "Financial Reports", description: "View balance sheet, P&L, and receivables" },
      { id: "GST_VIEW", label: "GST & Tax Reports", description: "View GSTR-1, output tax, and tax liabilities" },
      { id: "CA_REVIEW_VIEW", label: "CA Review", description: "Access comprehensive audit and month-end checklists" },
    ],
  },
  {
    id: "administration",
    label: "Organization Administration",
    description: "Branch overview and user access management",
    permissions: [
      { id: "BRANCH_VIEW", label: "Branch View", description: "View organization branch list and details" },
      { id: "USER_ACCESS_MANAGE", label: "Access Control", description: "Manage user roles and module permissions" },
    ],
  },
];

/**
 * Mapping between legacy capability strings and canonical granular permissions.
 */
const CAPABILITY_TO_CANONICAL: Record<string, CanonicalPermission[]> = {
  "company.view": ["DASHBOARD_VIEW", "BRANCH_VIEW"],
  "users.view": ["USER_ACCESS_MANAGE"],
  "users.manage": ["USER_ACCESS_MANAGE"],
  "memberships.invite": ["USER_ACCESS_MANAGE"],
  "memberships.update": ["USER_ACCESS_MANAGE"],
  "memberships.remove": ["USER_ACCESS_MANAGE"],
  "sales.read": ["INVOICE_VIEW", "RECEIPT_VIEW", "PARTY_VIEW"],
  "sales.create": ["INVOICE_CREATE", "RECEIPT_CREATE", "PARTY_CREATE"],
  "sales.update": ["INVOICE_EDIT", "PARTY_EDIT"],
  "sales.delete": ["INVOICE_EDIT"],
  "quotations.read": ["QUOTATION_VIEW"],
  "quotations.create": ["QUOTATION_CREATE", "QUOTATION_SHARE"],
  "quotations.update": ["QUOTATION_EDIT"],
  "quotations.delete": ["QUOTATION_EDIT"],
  "purchase.read": ["PURCHASE_VIEW"],
  "purchase.create": ["PURCHASE_CREATE"],
  "purchase.update": ["PURCHASE_CREATE"],
  "purchase.delete": ["PURCHASE_CREATE"],
  "inventory.read": ["PRODUCT_VIEW", "INVENTORY_VIEW"],
  "inventory.adjust": ["INVENTORY_MANAGE"],
  "inventory.transfer": ["INVENTORY_MANAGE"],
  "inventory.warehouse.manage": ["INVENTORY_MANAGE"],
  "accounting.voucher.read": ["LEDGER_VIEW"],
  "accounting.voucher.create": ["INVOICE_POST", "PURCHASE_POST", "SALES_RETURN_POST"],
  "accounting.voucher.post": ["INVOICE_POST", "PURCHASE_POST", "SALES_RETURN_POST"],
  "accounting.voucher.void": ["INVOICE_POST", "PURCHASE_POST", "SALES_RETURN_POST"],
  "accounting.ledger.read": ["LEDGER_VIEW"],
  "accounting.ledger.manage": ["LEDGER_VIEW"],
  "reports.read": ["REPORTS_VIEW", "DASHBOARD_VIEW"],
  "reports.financial": ["REPORTS_VIEW", "LEDGER_VIEW"],
  "reports.gst": ["GST_VIEW"],
  "reports.audit": ["CA_REVIEW_VIEW"],
};

/**
 * Fallback canonical permissions granted to each membership role.
 */
export const ROLE_DEFAULT_CANONICAL_PERMISSIONS: Record<MembershipRole, readonly CanonicalPermission[]> = {
  owner: CANONICAL_PERMISSIONS,
  admin: CANONICAL_PERMISSIONS,
  accountant: [
    "DASHBOARD_VIEW",
    "PARTY_VIEW",
    "PRODUCT_VIEW",
    "QUOTATION_VIEW",
    "INVOICE_VIEW",
    "INVOICE_POST",
    "RECEIPT_VIEW",
    "RECEIPT_CREATE",
    "PURCHASE_VIEW",
    "PURCHASE_POST",
    "SALES_RETURN_VIEW",
    "SALES_RETURN_POST",
    "INVENTORY_VIEW",
    "LEDGER_VIEW",
    "REPORTS_VIEW",
    "GST_VIEW",
    "CA_REVIEW_VIEW",
    "BRANCH_VIEW",
  ],
  sales: [
    "DASHBOARD_VIEW",
    "PARTY_VIEW",
    "PARTY_CREATE",
    "PARTY_EDIT",
    "PRODUCT_VIEW",
    "QUOTATION_VIEW",
    "QUOTATION_CREATE",
    "QUOTATION_EDIT",
    "QUOTATION_SHARE",
    "INVOICE_VIEW",
    "INVOICE_CREATE",
    "INVOICE_EDIT",
    "INVOICE_POST",
    "RECEIPT_VIEW",
    "RECEIPT_CREATE",
    "SALES_RETURN_VIEW",
    "SALES_RETURN_CREATE",
    "INVENTORY_VIEW",
    "BRANCH_VIEW",
  ],
  purchase: [
    "DASHBOARD_VIEW",
    "PARTY_VIEW",
    "PARTY_CREATE",
    "PARTY_EDIT",
    "PRODUCT_VIEW",
    "PURCHASE_VIEW",
    "PURCHASE_CREATE",
    "PURCHASE_POST",
    "INVENTORY_VIEW",
    "BRANCH_VIEW",
  ],
  inventory: [
    "DASHBOARD_VIEW",
    "PRODUCT_VIEW",
    "PRODUCT_CREATE",
    "PRODUCT_EDIT",
    "INVENTORY_VIEW",
    "INVENTORY_MANAGE",
    "BRANCH_VIEW",
  ],
  hr: [
    "DASHBOARD_VIEW",
    "BRANCH_VIEW",
  ],
  viewer: [
    "DASHBOARD_VIEW",
    "PARTY_VIEW",
    "PRODUCT_VIEW",
    "QUOTATION_VIEW",
    "INVOICE_VIEW",
    "RECEIPT_VIEW",
    "PURCHASE_VIEW",
    "SALES_RETURN_VIEW",
    "INVENTORY_VIEW",
    "REPORTS_VIEW",
    "BRANCH_VIEW",
  ],
};

/**
 * Authoritative check: Can user create branches?
 * PRD § 2: Only OWNER can create branch. No other role may create a branch.
 * BRANCH_CREATE must NOT exist as an assignable permission.
 */
export function canUserCreateBranch(membership: Membership | null | undefined): boolean {
  if (!membership || membership.status !== "active") return false;
  const role = (membership.organizationRole || membership.role || "").toLowerCase();
  return role === "owner";
}

/**
 * Checks whether user has access to a specific branch.
 * Owner has access to all branches.
 * Normal users must be assigned via allBranches, branchIds, or branchAccess.
 */
export function hasBranchAccess(
  membership: Membership | null | undefined,
  branchId: string
): boolean {
  if (!membership || membership.status !== "active") return false;
  const role = (membership.organizationRole || membership.role || "").toLowerCase();
  if (role === "owner") return true;

  if (membership.allBranches) return true;

  if (membership.branchAccess && Array.isArray(membership.branchAccess)) {
    if (membership.branchAccess.some((ba) => ba.branchId === branchId)) return true;
  }

  if (membership.branchIds && Array.isArray(membership.branchIds)) {
    if (membership.branchIds.includes(branchId)) return true;
  }

  return false;
}

/**
 * Centralized authorization evaluator with branch context (PRD §§ 8, 9, 14, 15).
 * 
 * Rules:
 * 1. Must have an active membership.
 * 2. Owner has unrestricted access across all branches.
 * 3. User must have access to the target branch.
 * 4. Checks branch-specific granular permissions -> custom membership permissions -> role defaults.
 */
export function hasBranchPermission(
  membership: Membership | null | undefined,
  branchId: string | undefined | null,
  permission: CanonicalPermission | Capability | string
): boolean {
  if (!membership || membership.status !== "active") {
    return false;
  }

  const role = (membership.organizationRole || membership.role || "").toLowerCase() as MembershipRole;
  if (role === "owner") {
    return true;
  }

  // If a specific branchId is provided, verify branch membership first
  if (branchId && branchId !== "all") {
    if (!hasBranchAccess(membership, branchId)) {
      return false;
    }

    // Check if branchAccess has explicit permissions for this branch
    const branchEntry = membership.branchAccess?.find((ba) => ba.branchId === branchId);
    if (branchEntry && branchEntry.permissions && branchEntry.permissions.length > 0) {
      if (branchEntry.permissions.includes(permission)) {
        return true;
      }
      // Check mapped legacy capability
      const mapped = CAPABILITY_TO_CANONICAL[permission];
      if (mapped && mapped.some((cp) => branchEntry.permissions.includes(cp))) {
        return true;
      }
      return false;
    }
  }

  // Check custom membership permissions
  if (membership.customPermissions && membership.customPermissions.includes(permission)) {
    return true;
  }

  // Check mapped legacy capability in custom permissions
  const mapped = CAPABILITY_TO_CANONICAL[permission];
  if (mapped && membership.customPermissions) {
    if (mapped.some((cp) => membership.customPermissions!.includes(cp))) {
      return true;
    }
  }

  // Role default canonical permissions
  const defaultCanonicals = ROLE_DEFAULT_CANONICAL_PERMISSIONS[role];
  if (defaultCanonicals && defaultCanonicals.includes(permission as CanonicalPermission)) {
    return true;
  }

  // Role default legacy capabilities
  const roleCaps = ROLE_CAPABILITIES[role];
  if (roleCaps && roleCaps.includes(permission as Capability)) {
    return true;
  }

  if (mapped && defaultCanonicals) {
    if (mapped.some((cp) => defaultCanonicals.includes(cp))) {
      return true;
    }
  }

  return false;
}

/**
 * Centralized authorization evaluator.
 * Evaluates whether a user membership has permission for a specific capability.
 */
export function hasCapability(
  membership: Membership | null | undefined,
  capability: Capability | string,
  branchId?: string | null
): boolean {
  if (branchId) {
    return hasBranchPermission(membership, branchId, capability);
  }

  if (!membership || membership.status !== "active") {
    return false;
  }

  const role = (membership.organizationRole || membership.role || "").toLowerCase() as MembershipRole;
  if (role === "owner") {
    return true;
  }

  if (membership.customPermissions && membership.customPermissions.includes(capability)) {
    return true;
  }

  const mapped = CAPABILITY_TO_CANONICAL[capability];
  if (mapped && membership.customPermissions) {
    if (mapped.some((cp) => membership.customPermissions!.includes(cp))) {
      return true;
    }
  }

  const roleCaps = ROLE_CAPABILITIES[role];
  if (roleCaps && roleCaps.includes(capability as Capability)) {
    return true;
  }

  const defaultCanonicals = ROLE_DEFAULT_CANONICAL_PERMISSIONS[role];
  if (defaultCanonicals && defaultCanonicals.includes(capability as CanonicalPermission)) {
    return true;
  }

  if (mapped && defaultCanonicals) {
    if (mapped.some((cp) => defaultCanonicals.includes(cp))) {
      return true;
    }
  }

  return false;
}

/**
 * Granular Grouped Permission UI Specification (PRD § 7).
 * Maps clean, human-readable modules to underlying canonical permissions without exposing raw strings.
 */
export interface GranularModulePermissionConfig {
  id: string;
  label: string;
  description: string;
  canonicalPermissions: CanonicalPermission[];
}

export interface GranularGroupConfig {
  id: string;
  name: string;
  description: string;
  modules: GranularModulePermissionConfig[];
}

export const GRANULAR_ACCESS_GROUPS: GranularGroupConfig[] = [
  {
    id: "overview",
    name: "OVERVIEW",
    description: "Executive dashboards and performance metrics",
    modules: [
      {
        id: "dashboard",
        label: "Dashboard",
        description: "View financial KPIs, revenue charts, and cash/bank balances",
        canonicalPermissions: ["DASHBOARD_VIEW"],
      },
    ],
  },
  {
    id: "sales",
    name: "SALES",
    description: "Outward commercial cycle and customer inflows",
    modules: [
      {
        id: "quotations",
        label: "Quotations",
        description: "Draft, edit, share, and manage customer quotes",
        canonicalPermissions: ["QUOTATION_VIEW", "QUOTATION_CREATE", "QUOTATION_EDIT", "QUOTATION_SHARE"],
      },
      {
        id: "invoices",
        label: "Invoices",
        description: "Create, edit, and post tax invoices to the accounting ledger",
        canonicalPermissions: ["INVOICE_VIEW", "INVOICE_CREATE", "INVOICE_EDIT", "INVOICE_POST"],
      },
      {
        id: "sales_returns",
        label: "Sales Returns & Credit Notes",
        description: "Record customer returns, issue credit notes, and post GST adjustments",
        canonicalPermissions: ["SALES_RETURN_VIEW", "SALES_RETURN_CREATE", "SALES_RETURN_POST"],
      },
      {
        id: "receipts",
        label: "Receipts & Inflows",
        description: "Record customer payments, bank deposits, and cash collections",
        canonicalPermissions: ["RECEIPT_VIEW", "RECEIPT_CREATE"],
      },
    ],
  },
  {
    id: "purchase",
    name: "PURCHASE",
    description: "Inward procurement and supplier settlements",
    modules: [
      {
        id: "purchases",
        label: "Purchases",
        description: "Record and post supplier vendor bills and expenses",
        canonicalPermissions: ["PURCHASE_VIEW", "PURCHASE_CREATE", "PURCHASE_POST"],
      },
      {
        id: "supplier_payments",
        label: "Supplier Payments",
        description: "Disburse and record outgoing supplier payments",
        canonicalPermissions: ["PURCHASE_VIEW", "PURCHASE_CREATE"],
      },
    ],
  },
  {
    id: "inventory",
    name: "INVENTORY",
    description: "Physical stock levels and movement tracking",
    modules: [
      {
        id: "view_stock",
        label: "View Stock",
        description: "View real-time item quantities and warehouse stock levels",
        canonicalPermissions: ["INVENTORY_VIEW"],
      },
      {
        id: "manage_stock",
        label: "Manage Stock",
        description: "Record stock adjustments, physical counts, and internal transfers",
        canonicalPermissions: ["INVENTORY_MANAGE"],
      },
    ],
  },
  {
    id: "financials",
    name: "FINANCIALS",
    description: "Double-entry books, statutory GST, and compliance",
    modules: [
      {
        id: "ledger",
        label: "Ledger & Vouchers",
        description: "Access chart of accounts, journal entries, and general ledger",
        canonicalPermissions: ["LEDGER_VIEW"],
      },
      {
        id: "reports",
        label: "Reports & Financials",
        description: "Generate Trial Balance, Profit & Loss, and Balance Sheet",
        canonicalPermissions: ["REPORTS_VIEW"],
      },
      {
        id: "gst",
        label: "GST Statutory Reports",
        description: "GSTR-1, GSTR-3B registers and tax liability schedules",
        canonicalPermissions: ["GST_VIEW"],
      },
      {
        id: "ca_review",
        label: "CA Review Portal",
        description: "Chartered accountant audit trail and reconciliation workspace",
        canonicalPermissions: ["CA_REVIEW_VIEW"],
      },
    ],
  },
  {
    id: "masters",
    name: "MASTERS",
    description: "Centrally managed catalog and directory records",
    modules: [
      {
        id: "parties",
        label: "Parties (Customers & Suppliers)",
        description: "Manage customer and supplier master records and GSTIN details",
        canonicalPermissions: ["PARTY_VIEW", "PARTY_CREATE", "PARTY_EDIT"],
      },
      {
        id: "products",
        label: "Products & Services",
        description: "Manage catalog products, SKUs, sizes, and tax rates",
        canonicalPermissions: ["PRODUCT_VIEW", "PRODUCT_CREATE", "PRODUCT_EDIT"],
      },
      {
        id: "categories",
        label: "Categories",
        description: "Organize products into classification categories",
        canonicalPermissions: ["PRODUCT_VIEW", "PRODUCT_EDIT"],
      },
    ],
  },
];

export const ROLE_PRESET_MODULES: Record<string, string[]> = {
  admin: [
    "dashboard", "quotations", "invoices", "sales_returns", "receipts",
    "purchases", "supplier_payments", "view_stock", "manage_stock",
    "ledger", "reports", "gst", "ca_review", "parties", "products", "categories"
  ],
  accountant: [
    "dashboard", "invoices", "receipts", "purchases", "supplier_payments",
    "ledger", "reports", "gst", "ca_review", "parties", "products"
  ],
  sales: [
    "dashboard", "quotations", "invoices", "sales_returns", "receipts",
    "view_stock", "parties", "products"
  ],
  purchase: [
    "dashboard", "purchases", "supplier_payments", "view_stock",
    "parties", "products"
  ],
  inventory: [
    "dashboard", "view_stock", "manage_stock", "products", "categories"
  ],
  viewer: [
    "dashboard", "reports", "parties", "products"
  ],
  custom: [],
};

/**
 * Resolves a list of module IDs to their set of canonical permissions.
 */
export function resolveModuleIdsToPermissions(moduleIds: string[]): CanonicalPermission[] {
  const permSet = new Set<CanonicalPermission>();
  for (const group of GRANULAR_ACCESS_GROUPS) {
    for (const mod of group.modules) {
      if (moduleIds.includes(mod.id)) {
        for (const p of mod.canonicalPermissions) {
          permSet.add(p);
        }
      }
    }
  }
  return Array.from(permSet);
}

