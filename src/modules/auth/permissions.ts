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
 * Centralized authorization evaluator.
 * Evaluates whether a user membership has permission for a specific capability.
 * 
 * Rules:
 * 1. Must have an active membership.
 * 2. Owner has unrestricted access.
 * 3. Custom permissions override role defaults.
 * 4. Fallback to role capability matrix.
 */
export function hasCapability(
  membership: Membership | null | undefined,
  capability: Capability | string
): boolean {
  if (!membership || membership.status !== "active") {
    return false;
  }

  // System Role: Owner has unrestricted access to all capabilities
  if (membership.role === "owner") {
    return true;
  }

  // Custom permissions attached to this specific membership (Phase 2+ extensible)
  if (membership.customPermissions && membership.customPermissions.includes(capability)) {
    return true;
  }

  // Check role default capabilities
  const roleCaps = ROLE_CAPABILITIES[membership.role];
  if (roleCaps && roleCaps.includes(capability as Capability)) {
    return true;
  }

  return false;
}
