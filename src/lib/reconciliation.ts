import { appQueryClient } from "./queryClient";

export interface ReconcileDocumentOptions {
  entityType: "invoice" | "quotation" | "purchase" | "receipt" | "payment" | "party" | "product";
  document?: any;
  companyId?: string;
  action?: "create" | "update" | "void" | "delete";
}

/**
 * Reconciles and invalidates all summary views across BMS NEXT immediately after a document mutation.
 * Guarantees that Dashboard, Outstanding, Ledger, Stock, and GST summaries reflect changes without manual refresh.
 */
export function reconcileDocumentPostSuccess(options: ReconcileDocumentOptions): void {
  const { entityType, companyId } = options;
  if (!companyId) return;

  // 1. Invalidate specific entity queries
  appQueryClient.invalidateQueries({ queryKey: [entityType, companyId] });
  appQueryClient.invalidateQueries({ queryKey: [entityType] });
  appQueryClient.invalidateQueries({ queryKey: [`${entityType}s`, companyId] });
  appQueryClient.invalidateQueries({ queryKey: [`${entityType}s`] });

  // 2. Invalidate Dashboard summaries
  appQueryClient.invalidateQueries({ queryKey: ["dashboard", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["dashboard-metrics", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["companyDashboard", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["dashboard"] });

  // 3. Invalidate Outstanding, Receivables & Payables
  appQueryClient.invalidateQueries({ queryKey: ["outstanding", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["receivables", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["payables", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["aging", companyId] });

  // 4. Invalidate Ledger & Accounting summaries
  appQueryClient.invalidateQueries({ queryKey: ["ledgers", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["vouchers", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["trial-balance", companyId] });

  // 5. Invalidate Stock & Inventory
  if (entityType === "invoice" || entityType === "purchase" || entityType === "product") {
    appQueryClient.invalidateQueries({ queryKey: ["products", companyId] });
    appQueryClient.invalidateQueries({ queryKey: ["stock-movements", companyId] });
    appQueryClient.invalidateQueries({ queryKey: ["inventory", companyId] });
  }

  // 6. Invalidate GST Summaries & Reports
  appQueryClient.invalidateQueries({ queryKey: ["gst", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["gstr1", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["gstr3b", companyId] });
  appQueryClient.invalidateQueries({ queryKey: ["reports", companyId] });
}
