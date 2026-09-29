/**
 * BMS NEXT — Canonical Reporting Scope Architecture
 * 
 * Invariants:
 * 1. ONE canonical reporting scope object for EVERY dashboard metric and operational report.
 * 2. Scope attributes: companyId, financialYearId, activeBranchId, scopeMode ("BRANCH" | "CONSOLIDATED"), gstRegistrationId.
 * 3. Scope Mode rules:
 *    - CONSOLIDATED ("All Branches" or activeBranchId === "all"):
 *      ALL dashboard KPIs show consolidated company-wide figures.
 *    - BRANCH (specific branch selected or branch-restricted user):
 *      ALL dashboard KPIs show ONLY that branch's data. Zero organization-wide AR/AP/Cash leakage.
 * 4. List Page Parity:
 *    Document list pages and the dashboard MUST use identical scope rules.
 */

export type ScopeMode = "BRANCH" | "CONSOLIDATED";

export interface CanonicalReportingScope {
  companyId: string;
  financialYearId?: string;
  activeBranchId: string; // Specific branch ID or "all"
  scopeMode: ScopeMode;
  gstRegistrationId?: string;
}

export function buildCanonicalReportingScope(params: {
  companyId: string;
  financialYearId?: string;
  activeBranchId?: string | null;
  gstRegistrationId?: string;
}): CanonicalReportingScope {
  const branchId = params.activeBranchId && params.activeBranchId.trim() ? params.activeBranchId : "all";
  const isBranch = branchId !== "all";

  return {
    companyId: params.companyId,
    financialYearId: params.financialYearId,
    activeBranchId: branchId,
    scopeMode: isBranch ? "BRANCH" : "CONSOLIDATED",
    gstRegistrationId: params.gstRegistrationId,
  };
}

/**
 * Filter an array of operational records (invoices, receipts, purchases, payments, returns)
 * according to the canonical reporting scope.
 */
export function filterRecordsByScope<T extends { branchId?: string; companyId?: string }>(
  records: T[],
  scope: CanonicalReportingScope
): T[] {
  if (scope.scopeMode === "CONSOLIDATED") {
    return records;
  }
  return records.filter((r) => r.branchId === scope.activeBranchId);
}
