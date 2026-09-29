export type ExportFormat = "excel" | "csv" | "pdf" | "json";

export type ColumnType = "text" | "number" | "currency" | "date" | "boolean";

export interface ExportColumnDefinition<T = any> {
  key: string;
  header: string;
  type?: ColumnType;
  width?: number; // suggested column width in characters
  align?: "left" | "right" | "center";
  hidden?: boolean;
  hiddenByDefault?: boolean;
  requiredPermission?: string; // e.g. "COST_VIEW", "GST_VIEW"
  excludeFromTotals?: boolean; // If true, column is omitted from totals calculation row in Excel & CSV
  getter?: (row: T, index: number) => any;
  formatForDisplay?: (value: any, row: T) => string;
}

export interface ExportOptions<T = any> {
  filename: string; // e.g. "BMS_Products" (without extension)
  sheetName?: string; // e.g. "Products"
  title?: string;
  subtitle?: string;
  scopeSummary?: string; // e.g. "Main Branch • FY 2026-27"
  columns: ExportColumnDefinition<T>[];
  data: T[];
  format: ExportFormat;
  includeTotals?: boolean;
  selectedColumnKeys?: string[];
  userPermissions?: string[] | Set<string>;
  can?: (permission: string) => boolean;
  allowedBranchIds?: string[];
  isOwner?: boolean;
  requestedBranchId?: string;
  exportType?: "standard" | "gst" | "ca" | "inventory" | string;
}

