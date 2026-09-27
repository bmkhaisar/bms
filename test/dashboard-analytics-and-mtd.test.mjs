import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Import analytics engine
import {
  isPostedInvoice,
  getInvoiceNetRevenue,
  isPostedPurchase,
  getPurchaseNetValue,
  isPostedReceipt,
  getReceiptAmount,
  getDatePartsInTimezone,
  getStartOfDayTimestamp,
  getEndOfDayTimestamp,
  getDaysInMonth,
  computeMonthlyTrend,
  computeMtdLmtdComparison,
} from "../src/modules/accounting/services/dashboardAnalyticsService.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Analytics Engine: isPostedInvoice strictly adheres to canonical Sales Report definition", () => {
  // Valid posted invoice
  const validInvoice = {
    id: "inv_1",
    status: "issued",
    postingStatus: "posted",
    subtotal: 100000,
    discountTotal: 5000,
    grandTotal: 112100,
  };
  assert.equal(isPostedInvoice(validInvoice), true);
  assert.equal(getInvoiceNetRevenue(validInvoice), 95000); // 100000 - 5000 (taxable revenue, excludes GST)

  // Drafts must be excluded
  assert.equal(isPostedInvoice({ ...validInvoice, status: "draft" }), false);
  assert.equal(isPostedInvoice({ ...validInvoice, postingStatus: "draft" }), false);
  assert.equal(getInvoiceNetRevenue({ ...validInvoice, status: "draft" }), 0);

  // Cancelled, voided, or reversed must be excluded
  assert.equal(isPostedInvoice({ ...validInvoice, status: "cancelled" }), false);
  assert.equal(isPostedInvoice({ ...validInvoice, status: "voided" }), false);
  assert.equal(isPostedInvoice({ ...validInvoice, status: "deleted" }), false);
  assert.equal(isPostedInvoice({ ...validInvoice, postingStatus: "reversed" }), false);
  assert.equal(isPostedInvoice({ ...validInvoice, postingStatus: "failed" }), false);
});

test("Analytics Engine: isPostedPurchase strictly adheres to canonical Purchase Report definition", () => {
  const validPurchase = {
    id: "pu_1",
    status: "recorded",
    postingStatus: "posted",
    subtotal: 50000,
    discountTotal: 2000,
    grandTotal: 56640,
  };
  assert.equal(isPostedPurchase(validPurchase), true);
  assert.equal(getPurchaseNetValue(validPurchase), 48000); // taxable purchase value, excludes recoverable input GST

  // Drafts, reversals, cancellations must be excluded
  assert.equal(isPostedPurchase({ ...validPurchase, status: "draft" }), false);
  assert.equal(isPostedPurchase({ ...validPurchase, postingStatus: "reversed" }), false);
  assert.equal(isPostedPurchase({ ...validPurchase, status: "cancelled" }), false);
});

test("Analytics Engine: isPostedReceipt counts only posted customer receipts (including on-account)", () => {
  const validReceipt = {
    id: "rec_1",
    status: "posted",
    postingStatus: "posted",
    amount: 75000,
  };
  assert.equal(isPostedReceipt(validReceipt), true);
  assert.equal(getReceiptAmount(validReceipt), 75000);

  // Exclude drafts, refunds, cancellations, reversals
  assert.equal(isPostedReceipt({ ...validReceipt, status: "draft" }), false);
  assert.equal(isPostedReceipt({ ...validReceipt, status: "cancelled" }), false);
  assert.equal(isPostedReceipt({ ...validReceipt, postingStatus: "refunded" }), false);
  assert.equal(isPostedReceipt({ ...validReceipt, postingStatus: "reversed" }), false);
  assert.equal(isPostedReceipt({ ...validReceipt, postingStatus: "draft" }), false);
});

test("Analytics Engine: Bar and Line views use the exact same underlying monthly data", () => {
  // Test reference date: 2026-09-27
  const refDate = new Date("2026-09-27T12:00:00+05:30");
  const timezone = "Asia/Kolkata";

  const septTimestamp = new Date("2026-09-15T10:00:00+05:30").getTime();
  const augTimestamp = new Date("2026-08-10T10:00:00+05:30").getTime();

  const invoices = [
    {
      id: "inv_sep",
      date: septTimestamp,
      status: "posted",
      postingStatus: "posted",
      subtotal: 200000,
      discountTotal: 10000,
      grandTotal: 224200,
    },
    {
      id: "inv_aug",
      date: augTimestamp,
      status: "posted",
      postingStatus: "posted",
      subtotal: 150000,
      discountTotal: 5000,
      grandTotal: 171100,
    },
    {
      id: "inv_draft",
      date: septTimestamp,
      status: "draft",
      postingStatus: "draft",
      subtotal: 500000,
      discountTotal: 0,
      grandTotal: 590000,
    },
  ];

  const purchases = [
    {
      id: "pu_sep",
      date: septTimestamp,
      status: "posted",
      postingStatus: "posted",
      subtotal: 120000,
      discountTotal: 0,
      grandTotal: 141600,
    },
  ];

  const monthlyPoints = computeMonthlyTrend({
    invoices,
    purchases,
    referenceDate: refDate,
    timezone,
  });

  // Must produce 6 consecutive months ending in September 2026
  assert.equal(monthlyPoints.length, 6);
  const sepPoint = monthlyPoints[5];
  const augPoint = monthlyPoints[4];

  assert.equal(sepPoint.label, "Sep");
  assert.equal(sepPoint.monthName, "September 2026");
  assert.equal(sepPoint.sales, 190000); // 200000 - 10000, draft strictly excluded
  assert.equal(sepPoint.purchases, 120000);

  assert.equal(augPoint.label, "Aug");
  assert.equal(augPoint.monthName, "August 2026");
  assert.equal(augPoint.sales, 145000); // 150000 - 5000
  assert.equal(augPoint.purchases, 0);

  // Both Bar and Line views consume monthlyPoints directly: exactly identical totals
  const barSalesSum = monthlyPoints.reduce((s, p) => s + p.sales, 0);
  const lineSalesSum = monthlyPoints.reduce((s, p) => s + p.sales, 0);
  assert.equal(barSalesSum, lineSalesSum);
});

test("MTD vs LMTD: Compares equivalent elapsed periods (e.g. Sept 1–27 vs Aug 1–27)", () => {
  const refDate = new Date("2026-09-27T12:00:00+05:30");
  const timezone = "Asia/Kolkata";

  // Sept 5 and Sept 20 invoices (inside MTD Sep 1–27)
  const sep5 = new Date("2026-09-05T10:00:00+05:30").getTime();
  const sep20 = new Date("2026-09-20T10:00:00+05:30").getTime();
  const sep28 = new Date("2026-09-28T10:00:00+05:30").getTime(); // Outside MTD window (after day 27)

  // Aug 10 and Aug 25 invoices (inside LMTD Aug 1–27)
  const aug10 = new Date("2026-08-10T10:00:00+05:30").getTime();
  const aug25 = new Date("2026-08-25T10:00:00+05:30").getTime();
  const aug30 = new Date("2026-08-30T10:00:00+05:30").getTime(); // Outside LMTD window (after day 27)

  const invoices = [
    { id: "s1", date: sep5, status: "posted", postingStatus: "posted", subtotal: 100000, discountTotal: 0, grandTotal: 118000 },
    { id: "s2", date: sep20, status: "posted", postingStatus: "posted", subtotal: 150000, discountTotal: 0, grandTotal: 177000 },
    { id: "s3_future", date: sep28, status: "posted", postingStatus: "posted", subtotal: 90000, discountTotal: 0, grandTotal: 106200 },
    { id: "a1", date: aug10, status: "posted", postingStatus: "posted", subtotal: 80000, discountTotal: 0, grandTotal: 94400 },
    { id: "a2", date: aug25, status: "posted", postingStatus: "posted", subtotal: 120000, discountTotal: 0, grandTotal: 141600 },
    { id: "a3_late", date: aug30, status: "posted", postingStatus: "posted", subtotal: 70000, discountTotal: 0, grandTotal: 82600 },
  ];

  const result = computeMtdLmtdComparison({
    metric: "sales",
    invoices,
    purchases: [],
    receipts: [],
    referenceDate: refDate,
    timezone,
  });

  assert.equal(result.daysCompared, 27);
  assert.equal(result.mtdPeriodLabel, "Sep 1–27");
  assert.equal(result.lmtdPeriodLabel, "Aug 1–27");

  // MTD = 100,000 + 150,000 = 250,000 (sep28 ignored)
  assert.equal(result.mtdAmount, 250000);
  // LMTD = 80,000 + 120,000 = 200,000 (aug30 ignored!)
  assert.equal(result.lmtdAmount, 200000);
  assert.equal(result.deltaAmount, 50000);

  // Growth: (250,000 - 200,000) / 200,000 = +25.0%
  assert.equal(result.percentageChange, 25);
  assert.equal(result.trendDirection, "up");
  assert.match(result.insight, /Sales revenue increased by 25%/);
  assert.match(result.insight, /Aug 1–27/);

  // Daily series length must equal daysCompared (27)
  assert.equal(result.dailyPoints.length, 27);
  assert.equal(result.dailyPoints[26].mtdCumulative, 250000);
  assert.equal(result.dailyPoints[26].lmtdCumulative, 200000);
});

test("MTD vs LMTD: Handles shorter previous month with overlapping days adjustment (March 31 vs Feb 28)", () => {
  // Test reference date: March 31 in a non-leap year (2025)
  const refDate = new Date("2025-03-31T12:00:00+05:30");
  const timezone = "Asia/Kolkata";

  const mar15 = new Date("2025-03-15T10:00:00+05:30").getTime();
  const feb15 = new Date("2025-02-15T10:00:00+05:30").getTime();

  const invoices = [
    { id: "m1", date: mar15, status: "posted", postingStatus: "posted", subtotal: 300000, discountTotal: 0, grandTotal: 354000 },
    { id: "f1", date: feb15, status: "posted", postingStatus: "posted", subtotal: 200000, discountTotal: 0, grandTotal: 236000 },
  ];

  const result = computeMtdLmtdComparison({
    metric: "sales",
    invoices,
    purchases: [],
    receipts: [],
    referenceDate: refDate,
    timezone,
  });

  // Feb 2025 has 28 days. Current day is 31.
  // Overlapping comparable days must cap at 28!
  assert.equal(result.daysCompared, 28);
  assert.equal(result.isAdjustedPeriod, true);
  assert.match(result.adjustmentNote, /28-day previous month/);
  assert.equal(result.mtdPeriodLabel, "Mar 1–28");
  assert.equal(result.lmtdPeriodLabel, "Feb 1–28");

  assert.equal(result.mtdAmount, 300000);
  assert.equal(result.lmtdAmount, 200000);
  assert.equal(result.percentageChange, 50);
});

test("MTD vs LMTD: Handles leap years accurately (Feb in 2028 has 29 days)", () => {
  assert.equal(getDaysInMonth(2028, 2), 29);
  assert.equal(getDaysInMonth(2024, 2), 29);
  assert.equal(getDaysInMonth(2026, 2), 28);

  const refDate = new Date("2028-03-31T12:00:00+05:30");
  const result = computeMtdLmtdComparison({
    metric: "sales",
    invoices: [],
    purchases: [],
    receipts: [],
    referenceDate: refDate,
    timezone: "Asia/Kolkata",
  });
  assert.equal(result.daysCompared, 29);
  assert.equal(result.mtdPeriodLabel, "Mar 1–29");
  assert.equal(result.lmtdPeriodLabel, "Feb 1–29");
});

test("MTD vs LMTD: Zero baseline returns 'No comparable data' rather than Infinity or NaN", () => {
  const refDate = new Date("2026-09-15T12:00:00+05:30");
  const sep10 = new Date("2026-09-10T10:00:00+05:30").getTime();

  const invoices = [
    { id: "s1", date: sep10, status: "posted", postingStatus: "posted", subtotal: 100000, discountTotal: 0, grandTotal: 118000 },
  ];

  // No August invoices recorded (LMTD = 0)
  const result = computeMtdLmtdComparison({
    metric: "sales",
    invoices,
    purchases: [],
    receipts: [],
    referenceDate: refDate,
    timezone: "Asia/Kolkata",
  });

  assert.equal(result.mtdAmount, 100000);
  assert.equal(result.lmtdAmount, 0);
  assert.equal(result.hasValidBaseline, false);
  assert.equal(result.percentageChange, null);
  assert.equal(result.trendDirection, "no_baseline");
  assert.match(result.insight, /No comparable transactions recorded/);
});

test("MTD vs LMTD: Collections metric computes actual posted customer receipts", () => {
  const refDate = new Date("2026-09-20T12:00:00+05:30");
  const sep8 = new Date("2026-09-08T10:00:00+05:30").getTime();
  const aug12 = new Date("2026-08-12T10:00:00+05:30").getTime();

  const receipts = [
    { id: "r1", date: sep8, status: "posted", postingStatus: "posted", amount: 60000 },
    { id: "r2_draft", date: sep8, status: "draft", postingStatus: "draft", amount: 99999 },
    { id: "r3", date: aug12, status: "posted", postingStatus: "posted", amount: 80000 },
    { id: "r4_reversed", date: aug12, status: "posted", postingStatus: "reversed", amount: 50000 },
  ];

  const result = computeMtdLmtdComparison({
    metric: "collections",
    invoices: [],
    purchases: [],
    receipts,
    referenceDate: refDate,
    timezone: "Asia/Kolkata",
  });

  assert.equal(result.metricLabel, "Customer collections");
  assert.equal(result.mtdAmount, 60000); // draft r2 ignored
  assert.equal(result.lmtdAmount, 80000); // reversed r4 ignored
  assert.equal(result.deltaAmount, -20000);
  assert.equal(result.percentageChange, -25);
  assert.equal(result.trendDirection, "down");
  assert.match(result.insight, /Customer collections decreased by 25%/);
  assert.equal(result.drillDown.path, "/receipts");
});

test("MTD vs LMTD: Cross-financial-year boundary notification in Month 1 (April)", () => {
  // Test reference date: April 15, 2026 (FY 2026-27 starts April 1, 2026)
  const refDate = new Date("2026-04-15T12:00:00+05:30");
  const fyStart = new Date("2026-04-01T00:00:00+05:30").getTime();

  const result = computeMtdLmtdComparison({
    metric: "sales",
    invoices: [],
    purchases: [],
    receipts: [],
    referenceDate: refDate,
    timezone: "Asia/Kolkata",
    financialYearStart: fyStart,
  });

  assert.equal(result.isCrossFinancialYear, true);
  assert.match(result.crossFyNote, /previous financial year \(Mar 2026\)/);
});

test("UI & Integration: Dashboard card integrates both modes without separate calculation divergence", () => {
  const cardSource = read("src/components/app/DashboardSalesVsPurchasesCard.tsx");
  const dashboardSource = read("src/routes/_app.index.tsx");

  // Dashboard must embed DashboardSalesVsPurchasesCard
  assert.match(dashboardSource, /<DashboardSalesVsPurchasesCard/);
  assert.match(dashboardSource, /invoices=\{invoices\}/);
  assert.match(dashboardSource, /purchases=\{purchases\}/);
  assert.match(dashboardSource, /receipts=\{receipts\}/);
  assert.match(dashboardSource, /lg:col-span-2/);

  // Receivables Aging must remain separate
  assert.match(dashboardSource, /Receivables Aging/);

  // Card must support Bar and Line views with exact same dataset
  assert.match(cardSource, /monthlyChartType === "bar"/);
  assert.match(cardSource, /<BarChart/);
  assert.match(cardSource, /<LineChart/);
  assert.match(cardSource, /data=\{monthlyData\}/);

  // Card must support MTD vs LMTD
  assert.match(cardSource, /viewMode === "monthly_trend"/);
  assert.match(cardSource, /viewMode === "mtd_vs_lmtd"/);
  assert.match(cardSource, /setMtdMetric\("sales"\)/);
  assert.match(cardSource, /setMtdMetric\("purchases"\)/);
  assert.match(cardSource, /setMtdMetric\("collections"\)/);

  // Card must render 3 compact KPIs
  assert.match(cardSource, /mtdComparison\.mtdAmount/);
  assert.match(cardSource, /mtdComparison\.lmtdAmount/);
  assert.match(cardSource, /Growth vs LMTD/);

  // Card must display deterministic insight banner with drill-down link
  assert.match(cardSource, /mtdComparison\.insight/);
  assert.match(cardSource, /mtdComparison\.drillDown\.label/);

  // Card must render skeleton when not loaded
  assert.match(cardSource, /!isLoaded/);
  assert.match(cardSource, /Skeleton/);

  // Accessible tabular alternative
  assert.match(cardSource, /showTableView/);
});
