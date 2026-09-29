import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ExportColumnDefinition, ExportOptions, ExportFormat } from "./exportTypes";

/**
 * Formats a primitive or object value for clean CSV presentation.
 * Escapes quotes and commas according to RFC 4180.
 */
function escapeCSVValue(val: any): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") {
    if (val instanceof Date) {
      return val.toISOString().slice(0, 10);
    }
    // Prevent [object Object]
    return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
  }
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC-4180 compliant CSV string with UTF-8 BOM.
 */
export function generateCsvContent<T>(
  data: T[],
  columns: ExportColumnDefinition<T>[],
  options?: { includeTotals?: boolean }
): string {
  const activeCols = columns.filter((c) => !c.hidden);
  const lines: string[] = [];

  // Header row
  lines.push(activeCols.map((c) => escapeCSVValue(c.header)).join(","));

  // Data rows
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowValues = activeCols.map((col) => {
      const rawVal = col.getter ? col.getter(row, i) : (row as any)[col.key];
      if (col.formatForDisplay) {
        return escapeCSVValue(col.formatForDisplay(rawVal, row));
      }
      if (col.type === "currency" || col.type === "number") {
        return typeof rawVal === "number" && !isNaN(rawVal) ? String(rawVal) : "0";
      }
      return escapeCSVValue(rawVal);
    });
    lines.push(rowValues.join(","));
  }

  // Summary Totals row if requested
  if (options?.includeTotals && data.length > 0) {
    const totalsRow = activeCols.map((col, idx) => {
      if (idx === 0) return escapeCSVValue("Total");
      if (col.type === "currency" || col.type === "number") {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const val = col.getter ? col.getter(data[i], i) : (data[i] as any)[col.key];
          if (typeof val === "number" && !isNaN(val)) sum += val;
        }
        return String(Math.round(sum * 100) / 100);
      }
      return "";
    });
    lines.push(totalsRow.join(","));
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens multilingual/Indian text cleanly
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Generates an RFC-4180 compliant CSV Blob with UTF-8 BOM.
 */
export function generateCSV<T>(options: ExportOptions<T>): Blob {
  const activeCols = getActiveColumns(options);
  const csvContent = generateCsvContent(options.data, activeCols, {
    includeTotals: options.includeTotals,
  });
  return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
}

/**
 * Generates an Excel (.xlsx) workbook conforming to Section 9:
 * - Numeric currency/amount cells remain actual numbers (not text)
 * - Standard Indian currency / decimal formatting (#,##,##0.00)
 * - Frozen header row
 * - Column auto-filters
 * - Calculated column widths
 * - Optional totals summary row
 */
export function generateExcelWorkbook<T>(
  data: T[],
  columns: ExportColumnDefinition<T>[],
  options?: {
    sheetName?: string;
    companyName?: string;
    subtitle?: string;
    includeTotals?: boolean;
  }
): XLSX.WorkBook {
  const activeCols = columns.filter((c) => !c.hidden);

  // 1. Prepare raw matrix
  const matrix: any[][] = [];

  const hasBanner = Boolean(options?.companyName);
  if (hasBanner) {
    matrix.push([options?.companyName || ""]);
    matrix.push([options?.subtitle || ""]);
  }

  const headerRowIdx = matrix.length; // 2 if banner, 0 if not

  // Header row
  matrix.push(activeCols.map((c) => c.header));

  const dataStartRowIdx = matrix.length; // 3 if banner, 1 if not

  // Data rows
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowValues = activeCols.map((col) => {
      const rawVal = col.getter ? col.getter(row, i) : (row as any)[col.key];
      if (col.type === "currency" || col.type === "number") {
        const num = Number(rawVal);
        return isNaN(num) ? 0 : Math.round(num * 100) / 100;
      }
      if (col.type === "boolean") {
        return rawVal ? "Yes" : "No";
      }
      if (col.formatForDisplay) {
        return col.formatForDisplay(rawVal, row);
      }
      return rawVal ?? "";
    });
    matrix.push(rowValues);
  }

  // Totals row
  if (options?.includeTotals && data.length > 0) {
    const totalsRow = activeCols.map((col, idx) => {
      if (idx === 0) return "Total";
      if (col.type === "currency" || col.type === "number") {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const val = col.getter ? col.getter(data[i], i) : (data[i] as any)[col.key];
          const num = Number(val);
          if (!isNaN(num)) sum += num;
        }
        return Math.round(sum * 100) / 100;
      }
      return "";
    });
    matrix.push(totalsRow);
  }

  // 2. Convert to SheetJS Worksheet
  const ws = XLSX.utils.aoa_to_sheet(matrix);

  // 3. Format numeric cells & assign Indian number format (#,##,##0.00)
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let R = dataStartRowIdx; R <= range.e.r; ++R) {
    for (let C = 0; C <= range.e.c; ++C) {
      const colDef = activeCols[C];
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellRef];
      if (!cell) continue;

      if (colDef && (colDef.type === "currency" || colDef.type === "number")) {
        cell.t = "n"; // numeric type
        cell.z = colDef.type === "currency" ? "#,##,##0.00" : "#,##0.##";
      }
    }
  }

  // 4. Auto-calculate reasonable column widths
  const colWidths = activeCols.map((col, colIdx) => {
    let maxLen = col.header.length;
    for (let rowIdx = headerRowIdx; rowIdx < matrix.length; rowIdx++) {
      const val = matrix[rowIdx]?.[colIdx];
      const strLen = val ? String(val).length : 0;
      if (strLen > maxLen) maxLen = strLen;
    }
    // Min width 10, max width 40, default with 3 char padding
    return { wch: Math.min(Math.max(maxLen + 3, col.width || 12), 45) };
  });
  ws["!cols"] = colWidths;

  // 5. Enable Auto-filter on the header row
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRowIdx, c: 0 },
      e: { r: headerRowIdx, c: activeCols.length - 1 },
    }),
  };

  // 6. Freeze header row (Row stays fixed when scrolling)
  (ws as any)["!views"] = [{ state: "frozen", ySplit: headerRowIdx + 1 }];

  // 7. Create workbook and package
  const wb = XLSX.utils.book_new();
  const sheetName = (options?.sheetName || "Sheet1").slice(0, 31); // Excel sheet name limit 31 chars
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  return wb;
}

/**
 * Generates an Excel (.xlsx) Blob.
 */
export function generateExcel<T>(options: ExportOptions<T>): Blob {
  const activeCols = getActiveColumns(options);
  const wb = generateExcelWorkbook(options.data, activeCols, options);

  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Generates a clean tabular PDF export.
 */
export function generatePDF<T>(options: ExportOptions<T>): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const activeCols = getActiveColumns(options);

  const title = options.title || options.filename.replace(/_/g, " ");
  const subtitle = options.subtitle || "";
  const scopeSummary = options.scopeSummary || "";

  // Title & Metadata
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(title, 40, 40);

  if (subtitle || scopeSummary) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    const metaText = [subtitle, scopeSummary].filter(Boolean).join("  •  ");
    doc.text(metaText, 40, 56);
  }

  // Headers and Rows
  const headers = activeCols.map((c) => c.header);
  const rows = options.data.map((row, i) =>
    activeCols.map((col) => {
      const rawVal = col.getter ? col.getter(row, i) : (row as any)[col.key];
      if (col.formatForDisplay) {
        return col.formatForDisplay(rawVal, row);
      }
      if (col.type === "currency") {
        const num = Number(rawVal);
        return isNaN(num)
          ? "0.00"
          : num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      if (col.type === "boolean") {
        return rawVal ? "Yes" : "No";
      }
      return rawVal !== undefined && rawVal !== null ? String(rawVal) : "";
    })
  );

  // Column styles (align right for numbers/currency)
  const columnStyles: Record<number, any> = {};
  activeCols.forEach((col, idx) => {
    if (col.type === "currency" || col.type === "number" || col.align === "right") {
      columnStyles[idx] = { halign: "right" };
    } else if (col.align === "center") {
      columnStyles[idx] = { halign: "center" };
    }
  });

  autoTable(doc, {
    startY: subtitle || scopeSummary ? 70 : 55,
    head: [headers],
    body: rows,
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: [51, 65, 85],
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles,
    margin: { left: 40, right: 40 },
  });

  const pdfArray = doc.output("arraybuffer");
  return new Blob([pdfArray], { type: "application/pdf" });
}

/**
 * Generates structured JSON export.
 */
export function generateJSON<T>(options: ExportOptions<T>): Blob {
  const activeCols = getActiveColumns(options);

  const cleanData = options.data.map((row, i) => {
    const obj: Record<string, any> = {};
    for (const col of activeCols) {
      const rawVal = col.getter ? col.getter(row, i) : (row as any)[col.key];
      obj[col.key] = rawVal;
    }
    return obj;
  });

  const jsonString = JSON.stringify(cleanData, null, 2);
  return new Blob([jsonString], { type: "application/json" });
}

/**
 * Filters columns according to user selection, defaults, and RBAC permissions.
 * Hardening Item 3: A user without permission (e.g. COST_VIEW) strictly NEVER receives
 * that column in Excel, CSV, PDF, or JSON exports.
 */
export function getActiveColumns<T>(options: ExportOptions<T>): ExportColumnDefinition<T>[] {
  const hasPerm = (requiredPerm?: string): boolean => {
    if (!requiredPerm) return true;
    if (options.isOwner) return true;
    if (options.can) return options.can(requiredPerm);
    if (options.userPermissions) {
      if (Array.isArray(options.userPermissions)) {
        return options.userPermissions.includes(requiredPerm);
      }
      if (options.userPermissions instanceof Set) {
        return options.userPermissions.has(requiredPerm);
      }
    }
    return false; // Default safe: reject if permission required but not granted
  };

  const permittedCols = options.columns.filter((c) => !c.hidden && hasPerm(c.requiredPermission));

  if (options.selectedColumnKeys && options.selectedColumnKeys.length > 0) {
    const keySet = new Set(options.selectedColumnKeys);
    return permittedCols.filter((c) => keySet.has(c.key));
  }
  return permittedCols.filter((c) => !c.hiddenByDefault);
}

export interface AuthoritativeExportResolutionParams<T> {
  data: T[];
  columns: ExportColumnDefinition<T>[];
  requestedBranchId?: string;
  allowedBranchIds?: string[];
  isOwner?: boolean;
  exportType?: "standard" | "gst" | "ca" | "inventory" | string;
  userPermissions?: string[] | Set<string>;
  can?: (perm: string) => boolean;
}

export interface AuthoritativeExportPayload<T> {
  authorizedData: T[];
  sanitizedColumns: ExportColumnDefinition<T>[];
  hasCostView: boolean;
  allowedBranchIds?: string[];
}

/**
 * Server-Authoritative Export Resolver (Pre-Merge Blocker 3)
 * Guarantees that:
 * 1. Branch-A user cannot request/export Branch-B records (CROSS_BRANCH_EXPORT_REJECTED).
 * 2. User without COST_VIEW never receives purchase cost / cost price in memory or output (COST_FIELD_SERVER_PROTECTION).
 * 3. GST export requires GST_VIEW permission (EXPORT_SERVER_RBAC).
 * 4. CA export requires CA_REVIEW_VIEW permission (EXPORT_SERVER_RBAC).
 */
export function resolveAuthoritativeExportPayload<T>(
  params: AuthoritativeExportResolutionParams<T>
): AuthoritativeExportPayload<T> {
  const {
    data,
    columns,
    requestedBranchId,
    allowedBranchIds = [],
    isOwner = false,
    exportType = "standard",
    userPermissions,
    can,
  } = params;

  const checkPerm = (perm: string): boolean => {
    if (isOwner) return true;
    if (can) return can(perm);
    if (userPermissions) {
      if (Array.isArray(userPermissions)) return userPermissions.includes(perm);
      if (userPermissions instanceof Set) return userPermissions.has(perm);
    }
    return false;
  };

  // 1. Authoritative Branch Isolation
  if (requestedBranchId === "all" && !isOwner) {
    throw new Error(
      "CROSS_BRANCH_EXPORT_REJECTED: Consolidated 'All Branches' export is strictly restricted to Organization Owners."
    );
  }

  if (requestedBranchId && requestedBranchId !== "all" && !isOwner) {
    if (!allowedBranchIds.includes(requestedBranchId)) {
      throw new Error(
        `CROSS_BRANCH_EXPORT_REJECTED: User is not authorized to export branch '${requestedBranchId}'.`
      );
    }
  }

  // 2. Authoritative RBAC Gates for Specialized Exports
  if (exportType === "gst" && !checkPerm("GST_VIEW")) {
    throw new Error("EXPORT_SERVER_RBAC: GST export strictly requires GST_VIEW permission.");
  }

  if (exportType === "ca" && !checkPerm("CA_REVIEW_VIEW")) {
    throw new Error("EXPORT_SERVER_RBAC: CA export strictly requires CA_REVIEW_VIEW permission.");
  }

  // 3. Filter rows strictly by branch boundaries
  let authorizedRows = data;
  if (!isOwner && allowedBranchIds.length > 0) {
    const allowedSet = new Set(allowedBranchIds);
    // If any row belongs to a foreign branch and was explicitly requested, reject
    const foreignRows = data.filter((r: any) => r && r.branchId && !allowedSet.has(r.branchId));
    if (foreignRows.length > 0 && requestedBranchId && !allowedSet.has(requestedBranchId)) {
      throw new Error(
        `CROSS_BRANCH_EXPORT_REJECTED: Payload contains ${foreignRows.length} records from unauthorized branch '${requestedBranchId}'.`
      );
    }
    authorizedRows = data.filter((r: any) => !r || !r.branchId || allowedSet.has(r.branchId));
  }

  // 4. Server-Authoritative COST_FIELD Protection
  const hasCostView = checkPerm("COST_VIEW");
  const costFieldNames = new Set([
    "purchasePrice",
    "costPrice",
    "buyingPrice",
    "lastCost",
    "landingCost",
    "unitCost",
    "costPaise",
  ]);

  let sanitizedRows: T[];
  if (!hasCostView) {
    sanitizedRows = authorizedRows.map((row: any) => {
      if (!row || typeof row !== "object") return row;
      const clone = { ...row };
      for (const field of costFieldNames) {
        if (field in clone) {
          delete clone[field];
        }
      }
      return clone as T;
    });
  } else {
    sanitizedRows = authorizedRows;
  }

  // 5. Sanitize columns: completely omit columns that require COST_VIEW if user lacks it
  const sanitizedColumns = columns.filter((col) => {
    if (col.requiredPermission === "COST_VIEW" && !hasCostView) {
      return false;
    }
    if (costFieldNames.has(String(col.key)) && !hasCostView) {
      return false;
    }
    return true;
  });

  return {
    authorizedData: sanitizedRows,
    sanitizedColumns,
    hasCostView,
    allowedBranchIds,
  };
}

/**
 * Filters rows to ensure strict multi-branch authorization isolation.
 * Hardening Item 3: A Branch-A user strictly CANNOT export Branch-B transactions.
 */
export function getAuthorizedData<T>(options: ExportOptions<T>): T[] {
  const resolved = resolveAuthoritativeExportPayload({
    data: options.data,
    columns: options.columns,
    requestedBranchId: options.requestedBranchId,
    allowedBranchIds: options.allowedBranchIds,
    isOwner: options.isOwner,
    exportType: options.exportType,
    userPermissions: options.userPermissions,
    can: options.can,
  });
  return resolved.authorizedData;
}

/**
 * Triggers a browser download of a given Blob.
 */
export function triggerDownload(blob: Blob, fullFilename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fullFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Canonical high-level export execution.
 */
export function executeExport<T>(options: ExportOptions<T>) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const baseName = options.filename.endsWith(`_${dateStr}`)
    ? options.filename
    : `${options.filename}_${dateStr}`;

  // Enforce authoritative server/RBAC protection on rows and columns
  const resolution = resolveAuthoritativeExportPayload({
    data: options.data,
    columns: options.columns,
    requestedBranchId: options.requestedBranchId,
    allowedBranchIds: options.allowedBranchIds,
    isOwner: options.isOwner,
    exportType: options.exportType,
    userPermissions: options.userPermissions,
    can: options.can,
  });

  const secureOptions: ExportOptions<T> = {
    ...options,
    data: resolution.authorizedData,
    columns: resolution.sanitizedColumns,
  };

  let blob: Blob;
  let extension: string;

  switch (secureOptions.format) {
    case "excel":
      blob = generateExcel(secureOptions);
      extension = ".xlsx";
      break;
    case "csv":
      blob = generateCSV(secureOptions);
      extension = ".csv";
      break;
    case "pdf":
      blob = generatePDF(secureOptions);
      extension = ".pdf";
      break;
    case "json":
      blob = generateJSON(secureOptions);
      extension = ".json";
      break;
    default:
      blob = generateCSV(secureOptions);
      extension = ".csv";
  }

  triggerDownload(blob, `${baseName}${extension}`);
}

