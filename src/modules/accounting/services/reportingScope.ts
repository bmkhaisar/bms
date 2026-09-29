/**
 * BMS NEXT — Canonical Reporting Scope Architecture
 * 
 * Invariants:
 * 1. ONE canonical reporting scope object for EVERY dashboard metric and operational report.
 * 2. Scope dimensions:
 *    - Company
 *    - Branch ("all" / consolidated or specific authorized branch)
 *    - Financial Year
 *    - Date Range (with quick selections and MTD/LMTD comparisons)
 * 3. Scope Mode rules:
 *    - CONSOLIDATED ("All Branches" or activeBranchId === "all"):
 *      Consolidated company-wide figures.
 *    - BRANCH (specific branch selected or branch-restricted user):
 *      Strict branch data. Zero organization-wide AR/AP/Cash leakage.
 * 4. List Page Parity:
 *    Document list pages, reports, and dashboard MUST use identical scope rules.
 */

export type ScopeMode = "BRANCH" | "CONSOLIDATED";

export type DatePreset =
  | "all_time"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_fy"
  | "mtd"
  | "custom";

export type ComparisonMode =
  | "none"
  | "lmtd"
  | "prev_month"
  | "prev_fy";

export interface DateRange {
  preset: DatePreset;
  fromDate: string;       // "YYYY-MM-DD"
  toDate: string;         // "YYYY-MM-DD"
  fromTimestamp: number;  // 00:00:00.000 epoch ms
  toTimestamp: number;    // 23:59:59.999 epoch ms
  label: string;
}

export interface BusinessScope {
  companyId: string;
  branchIds: string[];    // authorized branch IDs matching active scope
  activeBranchId: string; // "all" or specific branch ID
  scopeMode: ScopeMode;
  financialYearId?: string;
  financialYear?: {
    id: string;
    name: string;
    startDate: number;
    endDate: number;
  };
  dateRange: DateRange;
  comparisonMode?: ComparisonMode;
  gstRegistrationId?: string;
}

/**
 * Backward compatibility interface for existing callsites.
 */
export interface CanonicalReportingScope {
  companyId: string;
  financialYearId?: string;
  activeBranchId: string;
  scopeMode: ScopeMode;
  gstRegistrationId?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Formats a Date into standard readable string e.g. "29 Sep 2026".
 */
export function formatDisplayDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Resolves DateRange according to the given DatePreset.
 * Respects Indian Financial Year boundaries and current/reference date.
 */
export function resolveDatePreset(
  preset: DatePreset,
  options?:
    | {
        referenceDate?: Date | number;
        fyStart?: number;
        fyEnd?: number;
        customFrom?: string;
        customTo?: string;
      }
    | Date
    | number
): DateRange {
  let rawRefDate: Date | number | undefined;
  let fyStart: number | undefined;
  let fyEnd: number | undefined;
  let customFrom: string | undefined;
  let customTo: string | undefined;

  if (options instanceof Date || typeof options === "number") {
    rawRefDate = options;
  } else if (options && typeof options === "object") {
    rawRefDate = options.referenceDate;
    fyStart = options.fyStart;
    fyEnd = options.fyEnd;
    customFrom = options.customFrom;
    customTo = options.customTo;
  }

  const now = rawRefDate
    ? (typeof rawRefDate === "number" ? new Date(rawRefDate) : rawRefDate)
    : new Date();

  const refYear = now.getFullYear();
  const refMonth = now.getMonth(); // 0-indexed
  const refDate = now.getDate();

  switch (preset) {
    case "today": {
      const start = new Date(refYear, refMonth, refDate, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth, refDate, 23, 59, 59, 999);
      const ymd = formatYMD(start);
      return {
        preset: "today",
        fromDate: ymd,
        toDate: ymd,
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "Today",
      };
    }

    case "yesterday": {
      const start = new Date(refYear, refMonth, refDate - 1, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth, refDate - 1, 23, 59, 59, 999);
      const ymd = formatYMD(start);
      return {
        preset: "yesterday",
        fromDate: ymd,
        toDate: ymd,
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "Yesterday",
      };
    }

    case "this_week": {
      // Start on Monday (ISO standard / Indian standard business week)
      const day = now.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const start = new Date(refYear, refMonth, refDate + diffToMonday, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth, refDate + diffToMonday + 6, 23, 59, 59, 999);
      return {
        preset: "this_week",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "This Week",
      };
    }

    case "this_month": {
      const start = new Date(refYear, refMonth, 1, 0, 0, 0, 0);
      // Last day of month is day 0 of next month
      const end = new Date(refYear, refMonth + 1, 0, 23, 59, 59, 999);
      return {
        preset: "this_month",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "This Month",
      };
    }

    case "last_month": {
      const start = new Date(refYear, refMonth - 1, 1, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth, 0, 23, 59, 59, 999);
      return {
        preset: "last_month",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "Last Month",
      };
    }

    case "mtd": {
      // Month-to-date: 1st of current month to selected/current date
      const start = new Date(refYear, refMonth, 1, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth, refDate, 23, 59, 59, 999);
      return {
        preset: "mtd",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: `MTD (1–${refDate} ${now.toLocaleString("en-US", { month: "short" })})`,
      };
    }

    case "this_quarter": {
      // Indian Financial Quarters:
      // Q1: Apr-Jun (months 3-5)
      // Q2: Jul-Sep (months 6-8)
      // Q3: Oct-Dec (months 9-11)
      // Q4: Jan-Mar (months 0-2)
      let qStartMonth: number;
      if (refMonth >= 3 && refMonth <= 5) qStartMonth = 3;
      else if (refMonth >= 6 && refMonth <= 8) qStartMonth = 6;
      else if (refMonth >= 9 && refMonth <= 11) qStartMonth = 9;
      else qStartMonth = 0;

      const qYear = refYear;
      const start = new Date(qYear, qStartMonth, 1, 0, 0, 0, 0);
      const end = new Date(qYear, qStartMonth + 3, 0, 23, 59, 59, 999);
      return {
        preset: "this_quarter",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "This Quarter",
      };
    }

    case "this_fy": {
      if (fyStart && fyEnd) {
        const start = new Date(fyStart);
        const end = new Date(fyEnd);
        return {
          preset: "this_fy",
          fromDate: formatYMD(start),
          toDate: formatYMD(end),
          fromTimestamp: fyStart,
          toTimestamp: fyEnd,
          label: "This Financial Year",
        };
      }
      // Default Indian FY (Apr 1 - Mar 31)
      const fyStartYear = refMonth >= 3 ? refYear : refYear - 1;
      const start = new Date(fyStartYear, 3, 1, 0, 0, 0, 0);
      const end = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);
      return {
        preset: "this_fy",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "This Financial Year",
      };
    }

    case "custom": {
      if (customFrom && customTo) {
        const start = new Date(`${customFrom}T00:00:00.000`);
        const end = new Date(`${customTo}T23:59:59.999`);
        return {
          preset: "custom",
          fromDate: customFrom,
          toDate: customTo,
          fromTimestamp: start.getTime(),
          toTimestamp: end.getTime(),
          label: `${customFrom} to ${customTo}`,
        };
      }
      // Fallback to this month
      const start = new Date(refYear, refMonth, 1, 0, 0, 0, 0);
      const end = new Date(refYear, refMonth + 1, 0, 23, 59, 59, 999);
      return {
        preset: "custom",
        fromDate: formatYMD(start),
        toDate: formatYMD(end),
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
        label: "Custom",
      };
    }

    case "all_time":
    default: {
      return {
        preset: "all_time",
        fromDate: "1970-01-01",
        toDate: "2099-12-31",
        fromTimestamp: 0,
        toTimestamp: 4102444799000,
        label: "All Time",
      };
    }
  }
}

/**
 * Resolves comparison date range (Section 3).
 * Guarantees:
 * - LMTD: start of previous month -> equivalent day number in previous month.
 *   Example: 1 Sep-29 Sep vs 1 Aug-29 Aug. Never full August against partial September!
 * - prev_month: Full previous calendar month.
 * - prev_fy: Same period shifted by exactly 1 Financial Year.
 */
export function resolveComparisonRange(
  currentRange: DateRange,
  mode: ComparisonMode,
  options?: { fyStart?: number; fyEnd?: number }
): DateRange | null {
  if (mode === "none") return null;

  const currentStartDate = new Date(currentRange.fromTimestamp);
  const currentEndDate = new Date(currentRange.toTimestamp);

  switch (mode) {
    case "lmtd": {
      // 1. If currently MTD or partial month, calculate elapsed days
      const startDay = currentStartDate.getDate(); // usually 1
      const endDay = currentEndDate.getDate();

      // Target previous month
      let prevMonth = currentStartDate.getMonth() - 1;
      let prevYear = currentStartDate.getFullYear();
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear -= 1;
      }

      // Determine days in previous month
      const maxDaysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
      const clampedEndDay = Math.min(endDay, maxDaysInPrevMonth);

      const compStart = new Date(prevYear, prevMonth, startDay, 0, 0, 0, 0);
      const compEnd = new Date(prevYear, prevMonth, clampedEndDay, 23, 59, 59, 999);

      const monthName = compStart.toLocaleString("en-US", { month: "short" });
      return {
        preset: "custom",
        fromDate: formatYMD(compStart),
        toDate: formatYMD(compEnd),
        fromTimestamp: compStart.getTime(),
        toTimestamp: compEnd.getTime(),
        label: `LMTD (${startDay}–${clampedEndDay} ${monthName})`,
      };
    }

    case "prev_month": {
      let prevMonth = currentStartDate.getMonth() - 1;
      let prevYear = currentStartDate.getFullYear();
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear -= 1;
      }
      const compStart = new Date(prevYear, prevMonth, 1, 0, 0, 0, 0);
      const compEnd = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59, 999);
      const monthName = compStart.toLocaleString("en-US", { month: "short" });
      return {
        preset: "custom",
        fromDate: formatYMD(compStart),
        toDate: formatYMD(compEnd),
        fromTimestamp: compStart.getTime(),
        toTimestamp: compEnd.getTime(),
        label: `Prev Month (${monthName} ${prevYear})`,
      };
    }

    case "prev_fy": {
      const compStart = new Date(currentStartDate);
      compStart.setFullYear(compStart.getFullYear() - 1);
      const compEnd = new Date(currentEndDate);
      compEnd.setFullYear(compEnd.getFullYear() - 1);
      return {
        preset: "custom",
        fromDate: formatYMD(compStart),
        toDate: formatYMD(compEnd),
        fromTimestamp: compStart.getTime(),
        toTimestamp: compEnd.getTime(),
        label: "Previous FY",
      };
    }

    default:
      return null;
  }
}

/**
 * Builds the canonical BusinessScope object.
 */
export function buildBusinessScope(params: {
  companyId: string;
  activeBranchId?: string | null;
  authorizedBranchIds?: string[];
  financialYearId?: string;
  financialYear?: {
    id: string;
    name: string;
    startDate: number;
    endDate: number;
  };
  datePreset?: DatePreset;
  customFrom?: string;
  customTo?: string;
  comparisonMode?: ComparisonMode;
  gstRegistrationId?: string;
}): BusinessScope {
  const branchId = params.activeBranchId && params.activeBranchId.trim() ? params.activeBranchId : "all";
  const isBranch = branchId !== "all";

  // If specific branch, branchIds is strictly [branchId].
  // If "all", branchIds is all authorized branch IDs.
  let branchIds: string[];
  if (isBranch) {
    branchIds = [branchId];
  } else if (params.authorizedBranchIds && params.authorizedBranchIds.length > 0) {
    branchIds = [...params.authorizedBranchIds];
  } else {
    branchIds = [];
  }

  const dateRange = resolveDatePreset(params.datePreset || "this_fy", {
    fyStart: params.financialYear?.startDate,
    fyEnd: params.financialYear?.endDate,
    customFrom: params.customFrom,
    customTo: params.customTo,
  });

  return {
    companyId: params.companyId,
    branchIds,
    activeBranchId: branchId,
    scopeMode: isBranch ? "BRANCH" : "CONSOLIDATED",
    financialYearId: params.financialYearId || params.financialYear?.id,
    financialYear: params.financialYear,
    dateRange,
    comparisonMode: params.comparisonMode || "none",
    gstRegistrationId: params.gstRegistrationId,
  };
}

/**
 * Canonical helper for backwards compatibility.
 */
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
 * Filter an array of operational records according to canonical BusinessScope.
 * Evaluates branch boundaries and date boundaries consistently.
 */
export function filterRecordsByBusinessScope<
  T extends { branchId?: string; companyId?: string; date?: number | string; createdAt?: number }
>(records: T[], scope: BusinessScope): T[] {
  return records.filter((r) => {
    // 1. Branch filter
    if (scope.scopeMode === "BRANCH") {
      if (r.branchId !== scope.activeBranchId) {
        return false;
      }
    } else if (scope.scopeMode === "CONSOLIDATED" || scope.activeBranchId === "all") {
      // In consolidated mode, restrict to the user's authorized branchIds
      if (r.branchId && scope.branchIds && scope.branchIds.length > 0) {
        if (!scope.branchIds.includes(r.branchId)) {
          return false;
        }
      }
    }

    // 2. Date filter (if not "all_time")
    if (scope.dateRange.preset !== "all_time") {
      const rawDate = r.date ?? r.createdAt;
      if (rawDate !== undefined && rawDate !== null) {
        const time = typeof rawDate === "number"
          ? rawDate
          : (typeof rawDate === "string" && rawDate.length === 10
              ? new Date(`${rawDate}T00:00:00.000`).getTime()
              : new Date(rawDate).getTime());

        if (!isNaN(time)) {
          if (time < scope.dateRange.fromTimestamp || time > scope.dateRange.toTimestamp) {
            return false;
          }
        }
      }
    }

    return true;
  });
}

/**
 * Backwards compatibility helper for existing calls.
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
