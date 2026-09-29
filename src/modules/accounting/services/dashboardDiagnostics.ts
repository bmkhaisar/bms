/**
 * Developer Diagnostics & Automated Reconciliation Output (PRD Section 8)
 * 
 * Invariants:
 * 1. Output diagnostic telemetry strictly to developer console (in dev mode or with bms_debug_dashboard flag).
 * 2. Never expose diagnostic/debug output to end users in UI.
 * 3. Shows scopeMode, companyId, activeBranchId, and count/sum for posted documents.
 * 4. Identifies excluded records and root reason.
 */

import type { CanonicalReportingScope } from "./reportingScope";

export interface ReconciliationDiagnosticsData {
  scope: CanonicalReportingScope;
  invoices: {
    totalScanned: number;
    scopedCount: number;
    scopedSum: number;
    excludedDueToBranch: number;
    excludedDueToDate: number;
    excludedDueToStatus: number;
  };
  receipts: {
    totalScanned: number;
    scopedCount: number;
    scopedSum: number;
    excludedDueToBranch: number;
    excludedDueToStatus: number;
  };
  purchases: {
    totalScanned: number;
    scopedCount: number;
    scopedSum: number;
    excludedDueToBranch: number;
    excludedDueToDate: number;
    excludedDueToStatus?: number;
  };
  payments: {
    totalScanned: number;
    scopedCount: number;
    scopedSum: number;
    excludedDueToBranch: number;
    excludedDueToStatus: number;
  };
  salesReturns: {
    totalScanned: number;
    scopedCount: number;
    scopedSum: number;
    excludedDueToBranch: number;
  };
  arReconciled: number;
  apReconciled: number;
  cashBankReconciled: number;
}

export function logDashboardDiagnostics(data: ReconciliationDiagnosticsData): void {
  // Only log in DEV mode or when specifically requested via localStorage debug flag
  const isDev = Boolean(import.meta.env?.DEV);
  const debugExplicit = typeof window !== "undefined" && window.localStorage?.getItem("bms_debug_dashboard") === "true";

  if (!isDev && !debugExplicit) return;

  const { scope, invoices, receipts, purchases, payments, salesReturns } = data;

  console.groupCollapsed(
    `%c[BMS Dashboard Scope Diagnostic] %c${scope.scopeMode} | Branch: ${scope.activeBranchId}`,
    "color: #8b5cf6; font-weight: bold;",
    "color: #10b981; font-weight: bold;"
  );

  console.table({
    "Reporting Scope": {
      CompanyId: scope.companyId,
      ScopeMode: scope.scopeMode,
      ActiveBranchId: scope.activeBranchId,
      FinancialYear: scope.financialYearId || "All Time",
    },
    "Invoices (Sales)": {
      Scanned: invoices.totalScanned,
      Included: invoices.scopedCount,
      "Sum (₹)": invoices.scopedSum.toFixed(2),
      "Branch Excluded": invoices.excludedDueToBranch,
      "Status/Date Excluded": invoices.excludedDueToStatus + invoices.excludedDueToDate,
    },
    "Receipts (Collections)": {
      Scanned: receipts.totalScanned,
      Included: receipts.scopedCount,
      "Sum (₹)": receipts.scopedSum.toFixed(2),
      "Branch Excluded": receipts.excludedDueToBranch,
      "Status Excluded": receipts.excludedDueToStatus,
    },
    "Purchases": {
      Scanned: purchases.totalScanned,
      Included: purchases.scopedCount,
      "Sum (₹)": purchases.scopedSum.toFixed(2),
      "Branch Excluded": purchases.excludedDueToBranch,
      "Status/Date Excluded": purchases.excludedDueToDate,
    },
    "Payments Made": {
      Scanned: payments.totalScanned,
      Included: payments.scopedCount,
      "Sum (₹)": payments.scopedSum.toFixed(2),
      "Branch Excluded": payments.excludedDueToBranch,
      "Status Excluded": payments.excludedDueToStatus,
    },
    "Sales Returns": {
      Scanned: salesReturns.totalScanned,
      Included: salesReturns.scopedCount,
      "Sum (₹)": salesReturns.scopedSum.toFixed(2),
      "Branch Excluded": salesReturns.excludedDueToBranch,
      "Status/Date Excluded": 0,
    },
    "Balances": {
      "AR (₹)": data.arReconciled.toFixed(2),
      "AP (₹)": data.apReconciled.toFixed(2),
      "Cash & Bank (₹)": data.cashBankReconciled.toFixed(2),
    },
  });

  if (invoices.excludedDueToBranch > 0 && scope.scopeMode === "BRANCH") {
    console.info(
      `[BMS Scope Diagnostic] ${invoices.excludedDueToBranch} invoices excluded because their branchId does not match '${scope.activeBranchId}'.`
    );
  }

  console.groupEnd();
}
