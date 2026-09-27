import type { Invoice, Purchase, Receipt } from "../../../lib/db.ts";
import { formatMoney } from "../../../lib/format.ts";

export type AnalyticsMetric = "sales" | "purchases" | "collections";
export type ChartViewMode = "monthly_trend" | "mtd_vs_lmtd";
export type MonthlyChartType = "bar" | "line";

export interface MonthlyTrendPoint {
  key: string; // e.g. "2026-09"
  label: string; // e.g. "Sep"
  monthName: string; // e.g. "September 2026"
  sales: number; // Canonical net sales revenue (excluding output GST)
  purchases: number; // Canonical net purchase value (excluding recoverable input GST)
  year: number;
  month: number; // 1-12
  startDate: number;
  endDate: number;
}

export interface DailyComparisonPoint {
  day: number; // 1..D
  label: string; // "Day 1"
  dateMtd: string; // "Sep 1"
  dateLmtd: string; // "Aug 1"
  mtdCumulative: number;
  lmtdCumulative: number;
  mtdDaily: number;
  lmtdDaily: number;
  deltaCumulative: number;
}

export interface MtdLmtdComparisonResult {
  metric: AnalyticsMetric;
  metricLabel: string;
  mtdAmount: number;
  lmtdAmount: number;
  deltaAmount: number;
  percentageChange: number | null;
  hasValidBaseline: boolean;
  trendDirection: "up" | "down" | "flat" | "no_baseline";
  daysCompared: number;
  isAdjustedPeriod: boolean;
  adjustmentNote?: string;
  isCrossFinancialYear: boolean;
  crossFyNote?: string;
  mtdPeriodLabel: string;
  lmtdPeriodLabel: string;
  dailyPoints: DailyComparisonPoint[];
  insight: string;
  drillDown: {
    path: string;
    label: string;
    tab?: string;
    from: number;
    to: number;
  };
}

// ========================================================================
// 1. CANONICAL STATUS AND VALUE EXTRACTORS
// ========================================================================

/**
 * Validates that an invoice is posted and not draft, cancelled, voided, or reversed.
 * Follows the canonical Sales Report definition.
 */
export function isPostedInvoice(inv: Invoice | null | undefined): boolean {
  if (!inv) return false;
  const status = (inv.status || "").toLowerCase();
  const posting = (inv.postingStatus || "").toLowerCase();
  if (status === "cancelled" || status === "voided" || status === "deleted" || status === "draft") return false;
  if (posting === "reversed" || posting === "failed" || posting === "draft") return false;
  return true;
}

/**
 * Returns canonical net sales revenue, excluding output GST.
 * Matches Sales Report: taxable revenue (subtotal - discountTotal).
 */
export function getInvoiceNetRevenue(inv: Invoice): number {
  if (!isPostedInvoice(inv)) return 0;
  const subtotal = Number(inv.subtotal) || 0;
  const discount = Number(inv.discountTotal) || 0;
  return Math.max(0, subtotal - discount);
}

/**
 * Validates that a purchase is posted and not draft, cancelled, voided, or reversed.
 * Follows the canonical Purchase Report definition.
 */
export function isPostedPurchase(pu: Purchase | null | undefined): boolean {
  if (!pu) return false;
  const status = (pu.status || "").toLowerCase();
  const posting = (pu.postingStatus || "").toLowerCase();
  if (status === "cancelled" || status === "voided" || status === "deleted" || status === "draft") return false;
  if (posting === "reversed" || posting === "failed" || posting === "draft") return false;
  return true;
}

/**
 * Returns canonical net purchase value, excluding recoverable input GST.
 * Matches Purchase Report: taxable purchase value (subtotal - discountTotal).
 */
export function getPurchaseNetValue(pu: Purchase): number {
  if (!isPostedPurchase(pu)) return 0;
  const subtotal = Number(pu.subtotal) || 0;
  const discount = Number(pu.discountTotal) || 0;
  return Math.max(0, subtotal - discount);
}

/**
 * Validates that a customer receipt is posted and valid (including on-account receipts).
 * Strictly excludes drafts, refunds, cancellations, and reversals.
 */
export function isPostedReceipt(rec: Receipt | null | undefined): boolean {
  if (!rec) return false;
  const status = ((rec as any).status || "").toLowerCase();
  const posting = ((rec as any).postingStatus || "").toLowerCase();
  if (status === "cancelled" || status === "draft") return false;
  if (posting === "draft" || posting === "failed" || posting === "reversed" || posting === "refunded") return false;
  return true;
}

/**
 * Returns actual posted customer receipt amount. Counted once.
 */
export function getReceiptAmount(rec: Receipt): number {
  if (!isPostedReceipt(rec)) return 0;
  return Math.max(0, Number(rec.amount) || 0);
}

// ========================================================================
// 2. TIMEZONE-AWARE CALENDAR HELPERS
// ========================================================================

/**
 * Returns calendar date parts in the target timezone (default Asia/Kolkata).
 */
export function getDatePartsInTimezone(date: Date | number, timeZone = "Asia/Kolkata") {
  const d = typeof date === "number" ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = parseInt(p.value, 10);
    }
  }
  return {
    year: map.year,
    month: map.month, // 1-12
    day: map.day, // 1-31
    hour: map.hour || 0,
    minute: map.minute || 0,
    second: map.second || 0,
  };
}

/**
 * Gets timezone offset in milliseconds relative to UTC for a given target timezone.
 */
export function getTimezoneOffsetMs(date: Date, timeZone = "Asia/Kolkata"): number {
  try {
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
    return tzDate.getTime() - utcDate.getTime();
  } catch {
    // Default fallback to IST offset (+05:30)
    return 5.5 * 3600 * 1000;
  }
}

/**
 * Returns start of day timestamp (00:00:00.000) in the target business timezone.
 */
export function getStartOfDayTimestamp(year: number, month: number, day: number, timeZone = "Asia/Kolkata"): number {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${year}-${pad(month)}-${pad(day)}T00:00:00`;
  const temp = new Date(`${iso}Z`);
  const offset = getTimezoneOffsetMs(temp, timeZone);
  return temp.getTime() - offset;
}

/**
 * Returns end of day timestamp (23:59:59.999) in the target business timezone.
 */
export function getEndOfDayTimestamp(year: number, month: number, day: number, timeZone = "Asia/Kolkata"): number {
  return getStartOfDayTimestamp(year, month, day, timeZone) + 86400000 - 1;
}

/**
 * Returns the number of days in a given month (accounting for leap years).
 */
export function getDaysInMonth(year: number, month: number): number {
  // month is 1-indexed, day 0 of month+1 gives last day of month
  return new Date(year, month, 0).getDate();
}

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ========================================================================
// 3. MONTHLY TREND CALCULATION (LAST 6 MONTHS)
// ========================================================================

export interface ComputeMonthlyTrendParams {
  invoices: Invoice[];
  purchases: Purchase[];
  referenceDate?: Date | number;
  timezone?: string;
  financialYearStart?: number;
  financialYearEnd?: number;
}

/**
 * Computes canonical 6-month trend series for Sales Revenue vs Procurement.
 * Guarantees identical data points whether rendered as Bar or Line chart.
 */
export function computeMonthlyTrend(params: ComputeMonthlyTrendParams): MonthlyTrendPoint[] {
  const {
    invoices,
    purchases,
    referenceDate = new Date(),
    timezone = "Asia/Kolkata",
    financialYearStart,
    financialYearEnd,
  } = params;

  const currentParts = getDatePartsInTimezone(referenceDate, timezone);
  const points: MonthlyTrendPoint[] = [];

  for (let i = 5; i >= 0; i--) {
    let year = currentParts.year;
    let month = currentParts.month - i;
    while (month <= 0) {
      month += 12;
      year -= 1;
    }

    const daysInM = getDaysInMonth(year, month);
    const startMs = getStartOfDayTimestamp(year, month, 1, timezone);
    const endMs = getEndOfDayTimestamp(year, month, daysInM, timezone);

    // Filter posted documents falling strictly within this month
    const mInvoices = invoices.filter((inv) => {
      if (!isPostedInvoice(inv)) return false;
      if (financialYearStart && inv.date < financialYearStart) return false;
      if (financialYearEnd && inv.date > financialYearEnd) return false;
      return inv.date >= startMs && inv.date <= endMs;
    });

    const mPurchases = purchases.filter((pu) => {
      if (!isPostedPurchase(pu)) return false;
      if (financialYearStart && pu.date < financialYearStart) return false;
      if (financialYearEnd && pu.date > financialYearEnd) return false;
      return pu.date >= startMs && pu.date <= endMs;
    });

    const salesRevenue = mInvoices.reduce((sum, inv) => sum + getInvoiceNetRevenue(inv), 0);
    const purchaseValue = mPurchases.reduce((sum, pu) => sum + getPurchaseNetValue(pu), 0);

    const monthShort = MONTH_NAMES_SHORT[month - 1];
    const monthFull = MONTH_NAMES_FULL[month - 1];

    points.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: monthShort,
      monthName: `${monthFull} ${year}`,
      sales: Math.round(salesRevenue * 100) / 100,
      purchases: Math.round(purchaseValue * 100) / 100,
      year,
      month,
      startDate: startMs,
      endDate: endMs,
    });
  }

  return points;
}

// ========================================================================
// 4. MTD VS LMTD COMPARISON ENGINE
// ========================================================================

export interface ComputeMtdLmtdParams {
  metric: AnalyticsMetric;
  invoices: Invoice[];
  purchases: Purchase[];
  receipts: Receipt[];
  referenceDate?: Date | number;
  timezone?: string;
  financialYearStart?: number;
  financialYearEnd?: number;
}

/**
 * Computes Month to Date (MTD) versus Last Month to Date (LMTD).
 * Compares equivalent elapsed periods rather than a partial month against a whole month.
 * Handles short months, leap years, cross-financial year transitions, and zero baseline cleanly.
 */
export function computeMtdLmtdComparison(params: ComputeMtdLmtdParams): MtdLmtdComparisonResult {
  const {
    metric,
    invoices,
    purchases,
    receipts,
    referenceDate = new Date(),
    timezone = "Asia/Kolkata",
    financialYearStart,
    financialYearEnd,
  } = params;

  // 1. Current Month and Elapsed Day
  const currentParts = getDatePartsInTimezone(referenceDate, timezone);
  const currYear = currentParts.year;
  const currMonth = currentParts.month;
  const currentDay = currentParts.day;
  const daysInCurrentMonth = getDaysInMonth(currYear, currMonth);

  // 2. Previous Month
  let prevYear = currYear;
  let prevMonth = currMonth - 1;
  if (prevMonth <= 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

  // 3. Equivalent Elapsed Period Calculation
  // Cap at daysInPrevMonth if current day exceeds previous month's length (e.g. March 31 vs Feb 28)
  const daysCompared = Math.min(currentDay, daysInPrevMonth);
  const isAdjustedPeriod = currentDay > daysInPrevMonth;
  const adjustmentNote = isAdjustedPeriod
    ? `Adjusted for ${daysInPrevMonth}-day previous month (${MONTH_NAMES_SHORT[prevMonth - 1]} 1–${daysCompared} compared with ${MONTH_NAMES_SHORT[currMonth - 1]} 1–${daysCompared})`
    : undefined;

  // Check if previous month falls outside active Financial Year
  const startOfPrevMonthMs = getStartOfDayTimestamp(prevYear, prevMonth, 1, timezone);
  const isCrossFinancialYear = Boolean(financialYearStart && startOfPrevMonthMs < financialYearStart);
  const crossFyNote = isCrossFinancialYear
    ? `LMTD falls in the previous financial year (${MONTH_NAMES_SHORT[prevMonth - 1]} ${prevYear})`
    : undefined;

  // Timestamps for MTD & LMTD
  const startOfMtdMs = getStartOfDayTimestamp(currYear, currMonth, 1, timezone);
  const endOfMtdMs = getEndOfDayTimestamp(currYear, currMonth, daysCompared, timezone);

  const startOfLmtdMs = getStartOfDayTimestamp(prevYear, prevMonth, 1, timezone);
  const endOfLmtdMs = getEndOfDayTimestamp(prevYear, prevMonth, daysCompared, timezone);

  // 4. Extract Metric Values by Day
  const mtdDailySums = new Array<number>(daysCompared + 1).fill(0);
  const lmtdDailySums = new Array<number>(daysCompared + 1).fill(0);

  if (metric === "sales") {
    for (const inv of invoices) {
      if (!isPostedInvoice(inv)) continue;
      // Current month check
      if (inv.date >= startOfMtdMs && inv.date <= endOfMtdMs) {
        const parts = getDatePartsInTimezone(inv.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          mtdDailySums[parts.day] += getInvoiceNetRevenue(inv);
        }
      }
      // Previous month check
      if (inv.date >= startOfLmtdMs && inv.date <= endOfLmtdMs) {
        const parts = getDatePartsInTimezone(inv.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          lmtdDailySums[parts.day] += getInvoiceNetRevenue(inv);
        }
      }
    }
  } else if (metric === "purchases") {
    for (const pu of purchases) {
      if (!isPostedPurchase(pu)) continue;
      // Current month check
      if (pu.date >= startOfMtdMs && pu.date <= endOfMtdMs) {
        const parts = getDatePartsInTimezone(pu.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          mtdDailySums[parts.day] += getPurchaseNetValue(pu);
        }
      }
      // Previous month check
      if (pu.date >= startOfLmtdMs && pu.date <= endOfLmtdMs) {
        const parts = getDatePartsInTimezone(pu.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          lmtdDailySums[parts.day] += getPurchaseNetValue(pu);
        }
      }
    }
  } else if (metric === "collections") {
    for (const rec of receipts) {
      if (!isPostedReceipt(rec)) continue;
      // Current month check
      if (rec.date >= startOfMtdMs && rec.date <= endOfMtdMs) {
        const parts = getDatePartsInTimezone(rec.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          mtdDailySums[parts.day] += getReceiptAmount(rec);
        }
      }
      // Previous month check
      if (rec.date >= startOfLmtdMs && rec.date <= endOfLmtdMs) {
        const parts = getDatePartsInTimezone(rec.date, timezone);
        if (parts.day >= 1 && parts.day <= daysCompared) {
          lmtdDailySums[parts.day] += getReceiptAmount(rec);
        }
      }
    }
  }

  // 5. Build Cumulative Daily Comparison Series
  const dailyPoints: DailyComparisonPoint[] = [];
  let mtdRun = 0;
  let lmtdRun = 0;

  const currMonthShort = MONTH_NAMES_SHORT[currMonth - 1];
  const prevMonthShort = MONTH_NAMES_SHORT[prevMonth - 1];

  for (let d = 1; d <= daysCompared; d++) {
    const mtdDayVal = Math.round(mtdDailySums[d] * 100) / 100;
    const lmtdDayVal = Math.round(lmtdDailySums[d] * 100) / 100;
    mtdRun += mtdDayVal;
    lmtdRun += lmtdDayVal;

    const mtdCum = Math.round(mtdRun * 100) / 100;
    const lmtdCum = Math.round(lmtdRun * 100) / 100;

    dailyPoints.push({
      day: d,
      label: `Day ${d}`,
      dateMtd: `${currMonthShort} ${d}`,
      dateLmtd: `${prevMonthShort} ${d}`,
      mtdCumulative: mtdCum,
      lmtdCumulative: lmtdCum,
      mtdDaily: mtdDayVal,
      lmtdDaily: lmtdDayVal,
      deltaCumulative: Math.round((mtdCum - lmtdCum) * 100) / 100,
    });
  }

  const mtdAmount = Math.round(mtdRun * 100) / 100;
  const lmtdAmount = Math.round(lmtdRun * 100) / 100;
  const deltaAmount = Math.round((mtdAmount - lmtdAmount) * 100) / 100;

  // 6. Growth & Baseline Calculations
  let percentageChange: number | null = null;
  let hasValidBaseline = true;
  let trendDirection: "up" | "down" | "flat" | "no_baseline" = "flat";

  if (lmtdAmount <= 0) {
    if (mtdAmount > 0) {
      hasValidBaseline = false;
      percentageChange = null;
      trendDirection = "no_baseline";
    } else {
      hasValidBaseline = true;
      percentageChange = 0;
      trendDirection = "flat";
    }
  } else {
    hasValidBaseline = true;
    percentageChange = Math.round(((mtdAmount - lmtdAmount) / lmtdAmount) * 1000) / 10;
    if (percentageChange > 0.05) trendDirection = "up";
    else if (percentageChange < -0.05) trendDirection = "down";
    else trendDirection = "flat";
  }

  const metricLabel =
    metric === "sales"
      ? "Sales revenue"
      : metric === "purchases"
      ? "Procurement / Purchases"
      : "Customer collections";

  const mtdPeriodLabel = `${currMonthShort} 1–${daysCompared}`;
  const lmtdPeriodLabel = `${prevMonthShort} 1–${daysCompared}`;

  // 7. Deterministic Narrative Insight
  let insight = "";
  if (!hasValidBaseline) {
    insight = `${metricLabel} reached ${formatMoney(mtdAmount)} MTD. No comparable transactions recorded in the equivalent period last month (${lmtdPeriodLabel}) to establish a percentage baseline.`;
  } else if (trendDirection === "up") {
    insight = `${metricLabel} increased by ${percentageChange}% (+${formatMoney(deltaAmount)}) compared with the equivalent period last month (${lmtdPeriodLabel}).`;
  } else if (trendDirection === "down") {
    insight = `${metricLabel} decreased by ${Math.abs(percentageChange!)}% (-${formatMoney(Math.abs(deltaAmount))}) compared with the equivalent period last month (${lmtdPeriodLabel}).`;
  } else {
    insight = `${metricLabel} remained steady (${percentageChange || 0}% change) compared with the equivalent period last month (${lmtdPeriodLabel}).`;
  }

  if (isAdjustedPeriod && adjustmentNote) {
    insight += ` ${adjustmentNote}.`;
  }

  // 8. Drill-Down Links
  let drillDown: MtdLmtdComparisonResult["drillDown"];
  if (metric === "sales") {
    drillDown = {
      path: "/reports",
      tab: "sales",
      label: "Open Sales Register",
      from: startOfMtdMs,
      to: endOfMtdMs,
    };
  } else if (metric === "purchases") {
    drillDown = {
      path: "/reports",
      tab: "purchases",
      label: "Open Purchase Register",
      from: startOfMtdMs,
      to: endOfMtdMs,
    };
  } else {
    drillDown = {
      path: "/receipts",
      label: "Open Customer Receipts",
      from: startOfMtdMs,
      to: endOfMtdMs,
    };
  }

  return {
    metric,
    metricLabel,
    mtdAmount,
    lmtdAmount,
    deltaAmount,
    percentageChange,
    hasValidBaseline,
    trendDirection,
    daysCompared,
    isAdjustedPeriod,
    adjustmentNote,
    isCrossFinancialYear,
    crossFyNote,
    mtdPeriodLabel,
    lmtdPeriodLabel,
    dailyPoints,
    insight,
    drillDown,
  };
}
