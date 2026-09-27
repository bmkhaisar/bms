import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  BarChart2,
  LineChart as LineChartIcon,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ArrowRight,
  Table as TableIcon,
  Sparkles,
  ExternalLink,
  Info,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useNavigate } from "@tanstack/react-router";
import type { Invoice, Purchase, Receipt } from "@/lib/db";
import {
  computeMonthlyTrend,
  computeMtdLmtdComparison,
  type AnalyticsMetric,
  type ChartViewMode,
  type MonthlyChartType,
} from "@/modules/accounting/services/dashboardAnalyticsService";

export interface DashboardSalesVsPurchasesCardProps {
  invoices: Invoice[];
  purchases: Purchase[];
  receipts: Receipt[];
  isLoaded: boolean;
  activeCompanyName?: string;
  activeFinancialYearName?: string;
  financialYearStart?: number;
  financialYearEnd?: number;
  timezone?: string;
  className?: string;
}

export function DashboardSalesVsPurchasesCard({
  invoices,
  purchases,
  receipts,
  isLoaded,
  activeCompanyName,
  activeFinancialYearName,
  financialYearStart,
  financialYearEnd,
  timezone = "Asia/Kolkata",
  className = "",
}: DashboardSalesVsPurchasesCardProps) {
  const navigate = useNavigate();

  // Primary controls state
  const [viewMode, setViewMode] = useState<ChartViewMode>("monthly_trend");
  const [monthlyChartType, setMonthlyChartType] = useState<MonthlyChartType>("bar");
  const [mtdMetric, setMtdMetric] = useState<AnalyticsMetric>("sales");
  const [showTableView, setShowTableView] = useState(false);

  // 1. Canonical Monthly Trend Data (Last 6 Months)
  // Guarantees that Bar and Line views use the exact same underlying figures
  const monthlyData = useMemo(() => {
    return computeMonthlyTrend({
      invoices,
      purchases,
      timezone,
      financialYearStart,
      financialYearEnd,
    });
  }, [invoices, purchases, timezone, financialYearStart, financialYearEnd]);

  // 2. Canonical MTD vs LMTD Comparison Data
  const mtdComparison = useMemo(() => {
    return computeMtdLmtdComparison({
      metric: mtdMetric,
      invoices,
      purchases,
      receipts,
      timezone,
      financialYearStart,
      financialYearEnd,
    });
  }, [mtdMetric, invoices, purchases, receipts, timezone, financialYearStart, financialYearEnd]);

  const hasMonthlyData = useMemo(() => {
    return monthlyData.some((p) => p.sales > 0 || p.purchases > 0);
  }, [monthlyData]);

  const hasMtdData = useMemo(() => {
    return mtdComparison.mtdAmount > 0 || mtdComparison.lmtdAmount > 0;
  }, [mtdComparison]);

  // Drill-down handler for clicking monthly bars or line data points
  function handleMonthlyPointClick(dataPoint: any, metricType?: "sales" | "purchases") {
    if (!dataPoint) return;
    const from = dataPoint.startDate;
    const to = dataPoint.endDate;
    const tab = metricType === "purchases" ? "purchases" : "sales";
    navigate({
      to: "/reports",
      search: { tab, from, to } as any,
    });
  }

  // Drill-down handler for MTD comparison
  function handleMtdDrillDown() {
    const { drillDown } = mtdComparison;
    if (drillDown.tab) {
      navigate({
        to: "/reports",
        search: { tab: drillDown.tab, from: drillDown.from, to: drillDown.to } as any,
      });
    } else {
      navigate({
        to: drillDown.path as any,
        search: { from: drillDown.from, to: drillDown.to } as any,
      });
    }
  }

  return (
    <Card className={`rounded-2xl border border-border/80 bg-card shadow-soft transition-all duration-200 ${className}`}>
      {/* Card Header & Controls */}
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold tracking-tight text-foreground">
              {viewMode === "monthly_trend" ? "Sales vs Purchases Trend" : "MTD vs LMTD Analytics"}
            </CardTitle>
            {activeFinancialYearName && (
              <Badge variant="outline" className="text-[10px] font-mono py-0 px-1.5 h-4 border-muted-foreground/30 text-muted-foreground">
                {activeFinancialYearName}
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {viewMode === "monthly_trend"
              ? "Canonical monthly revenue & procurement (posted records, excluding GST)"
              : `Equivalent elapsed comparison: ${mtdComparison.mtdPeriodLabel} vs ${mtdComparison.lmtdPeriodLabel}`}
          </CardDescription>
        </div>

        {/* View Mode & Type Switchers */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Main View Mode Selector (Segmented) */}
          <div className="flex items-center rounded-lg bg-muted/70 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setViewMode("monthly_trend");
                setShowTableView(false);
              }}
              className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                viewMode === "monthly_trend"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly Trend
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("mtd_vs_lmtd");
                setShowTableView(false);
              }}
              className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                viewMode === "mtd_vs_lmtd"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              MTD vs LMTD
            </button>
          </div>

          {/* Sub-Controls: Chart Type Switcher for Monthly Trend */}
          {viewMode === "monthly_trend" && (
            <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-xs">
              <Button
                type="button"
                variant={monthlyChartType === "bar" && !showTableView ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  setMonthlyChartType("bar");
                  setShowTableView(false);
                }}
                title="Bar Chart View"
                aria-label="Bar Chart View"
              >
                <BarChart2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant={monthlyChartType === "line" && !showTableView ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  setMonthlyChartType("line");
                  setShowTableView(false);
                }}
                title="Line Chart View"
                aria-label="Line Chart View"
              >
                <LineChartIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant={showTableView ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0 ml-0.5"
                onClick={() => setShowTableView(!showTableView)}
                title="Tabular View (Accessible)"
                aria-label="Tabular View"
              >
                <TableIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Sub-Controls: Metric Pills for MTD vs LMTD */}
          {viewMode === "mtd_vs_lmtd" && (
            <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMtdMetric("sales")}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                  mtdMetric === "sales"
                    ? "bg-background text-primary shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sales
              </button>
              <button
                type="button"
                onClick={() => setMtdMetric("purchases")}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                  mtdMetric === "purchases"
                    ? "bg-background text-sky-600 dark:text-sky-400 shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Purchases
              </button>
              <button
                type="button"
                onClick={() => setMtdMetric("collections")}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                  mtdMetric === "collections"
                    ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Collections
              </button>
              <Button
                type="button"
                variant={showTableView ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0 ml-1"
                onClick={() => setShowTableView(!showTableView)}
                title="Tabular Comparison View"
                aria-label="Tabular Comparison View"
              >
                <TableIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Loading Skeleton Placeholder: prevents flashing ₹0 while real queries finish */}
        {!isLoaded ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
            <Skeleton className="h-[240px] w-full rounded-xl" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        ) : viewMode === "monthly_trend" ? (
          /* ======================================================================== */
          /* 1. MONTHLY TREND VIEW (Bar / Line / Table)                               */
          /* ======================================================================== */
          <div>
            {!hasMonthlyData ? (
              <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No monthly transaction data yet</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Create and post tax invoices or purchase bills to view the 6-month canonical trend.
                </p>
              </div>
            ) : showTableView ? (
              /* Tabular Alternative View for Accessibility & Auditing */
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-2.5">Month</th>
                      <th className="p-2.5 text-right">Net Sales Revenue</th>
                      <th className="p-2.5 text-right">Net Procurement</th>
                      <th className="p-2.5 text-right">Net Operating Margin</th>
                      <th className="p-2.5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {monthlyData.map((m) => {
                      const diff = m.sales - m.purchases;
                      return (
                        <tr key={m.key} className="hover:bg-muted/30 transition-colors">
                          <td className="p-2.5 font-medium">{m.monthName}</td>
                          <td className="p-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(m.sales)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-semibold text-sky-600 dark:text-sky-400">
                            {formatMoney(m.purchases)}
                          </td>
                          <td className="p-2.5 text-right font-mono">
                            <span className={diff >= 0 ? "text-foreground font-medium" : "text-rose-600"}>
                              {formatMoney(diff)}
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2 text-primary"
                              onClick={() => handleMonthlyPointClick(m, "sales")}
                            >
                              View Register
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Recharts Visualizations: Exact Same Figures in Bar and Line */
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {monthlyChartType === "bar" ? (
                    <BarChart
                      data={monthlyData}
                      margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
                      onClick={(e) => {
                        if (e && e.activePayload && e.activePayload.length > 0) {
                          handleMonthlyPointClick(e.activePayload[0].payload);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.12} vertical={false} />
                      <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                      />
                      <Tooltip
                        content={<CustomMonthlyTooltip />}
                        cursor={{ fill: "var(--accent)", opacity: 0.15 }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Bar
                        dataKey="sales"
                        name="Sales Revenue"
                        fill="#10B981"
                        radius={[5, 5, 0, 0]}
                        className="cursor-pointer transition-opacity hover:opacity-85"
                      />
                      <Bar
                        dataKey="purchases"
                        name="Purchases"
                        fill="#3B82F6"
                        radius={[5, 5, 0, 0]}
                        className="cursor-pointer transition-opacity hover:opacity-85"
                      />
                    </BarChart>
                  ) : (
                    <LineChart
                      data={monthlyData}
                      margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
                      onClick={(e) => {
                        if (e && e.activePayload && e.activePayload.length > 0) {
                          handleMonthlyPointClick(e.activePayload[0].payload);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.12} vertical={false} />
                      <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                      />
                      <Tooltip
                        content={<CustomMonthlyTooltip />}
                        cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Line
                        type="monotone"
                        dataKey="sales"
                        name="Sales Revenue"
                        stroke="#10B981"
                        strokeWidth={2.5}
                        dot={{ r: 3.5, fill: "#10B981" }}
                        activeDot={{ r: 6, stroke: "#10B981", strokeWidth: 2, fill: "var(--card)" }}
                        className="cursor-pointer"
                      />
                      <Line
                        type="monotone"
                        dataKey="purchases"
                        name="Purchases"
                        stroke="#3B82F6"
                        strokeWidth={2.5}
                        dot={{ r: 3.5, fill: "#3B82F6" }}
                        activeDot={{ r: 6, stroke: "#3B82F6", strokeWidth: 2, fill: "var(--card)" }}
                        className="cursor-pointer"
                      />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}

            {/* Quick Drill-down Hint */}
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/30 pt-2 px-1">
              <span>Click any bar or data point to inspect that month's register.</span>
              <button
                type="button"
                onClick={() => navigate({ to: "/reports", search: { tab: "sales" } as any })}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Full Financial Reports <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ) : (
          /* ======================================================================== */
          /* 2. MTD VS LMTD ANALYTICS VIEW                                            */
          /* ======================================================================== */
          <div className="space-y-4">
            {/* 3 Compact Comparison KPIs */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* MTD Card */}
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    MTD ({mtdComparison.mtdPeriodLabel})
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
                    Current
                  </Badge>
                </div>
                <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-foreground">
                  {formatMoney(mtdComparison.mtdAmount)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Elapsed days: 1–{mtdComparison.daysCompared}
                </div>
              </div>

              {/* LMTD Card */}
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    LMTD ({mtdComparison.lmtdPeriodLabel})
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
                    Prior Period
                  </Badge>
                </div>
                <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-muted-foreground">
                  {formatMoney(mtdComparison.lmtdAmount)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Equivalent baseline
                </div>
              </div>

              {/* Percentage Growth KPI */}
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Growth vs LMTD
                  </span>
                  {mtdComparison.trendDirection === "up" && (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-semibold gap-1">
                      <TrendingUp className="h-3 w-3" /> Up
                    </Badge>
                  )}
                  {mtdComparison.trendDirection === "down" && (
                    <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 text-[10px] font-semibold gap-1">
                      <TrendingDown className="h-3 w-3" /> Down
                    </Badge>
                  )}
                  {mtdComparison.trendDirection === "flat" && (
                    <Badge variant="secondary" className="text-[10px] font-semibold gap-1">
                      <Minus className="h-3 w-3" /> Flat
                    </Badge>
                  )}
                  {mtdComparison.trendDirection === "no_baseline" && (
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                      No baseline
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 text-lg font-bold font-mono tabular-nums">
                  {mtdComparison.percentageChange !== null ? (
                    <span
                      className={
                        mtdComparison.percentageChange > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : mtdComparison.percentageChange < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-foreground"
                      }
                    >
                      {mtdComparison.percentageChange > 0 ? "+" : ""}
                      {mtdComparison.percentageChange}%
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">
                      No comparable data
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Delta: {mtdComparison.deltaAmount >= 0 ? "+" : ""}{formatMoney(mtdComparison.deltaAmount)}
                </div>
              </div>
            </div>

            {/* Adjusted period or Cross-FY notice */}
            {(mtdComparison.isAdjustedPeriod || mtdComparison.isCrossFinancialYear) && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {mtdComparison.adjustmentNote || mtdComparison.crossFyNote}
                </span>
              </div>
            )}

            {/* Cumulative Daily Comparison Chart */}
            {!hasMtdData ? (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No MTD or LMTD transactions</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  No posted {mtdComparison.metricLabel.toLowerCase()} recorded in {mtdComparison.mtdPeriodLabel} or {mtdComparison.lmtdPeriodLabel}.
                </p>
              </div>
            ) : showTableView ? (
              /* Tabular Comparison View */
              <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-semibold sticky top-0">
                    <tr>
                      <th className="p-2">Day</th>
                      <th className="p-2">MTD Date</th>
                      <th className="p-2 text-right">MTD Cumulative</th>
                      <th className="p-2 text-right">LMTD Cumulative</th>
                      <th className="p-2 text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {mtdComparison.dailyPoints.map((pt) => (
                      <tr key={pt.day} className="hover:bg-muted/20">
                        <td className="p-2 font-medium">{pt.label}</td>
                        <td className="p-2 text-muted-foreground">{pt.dateMtd}</td>
                        <td className="p-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(pt.mtdCumulative)}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">
                          {formatMoney(pt.lmtdCumulative)}
                        </td>
                        <td className="p-2 text-right">
                          <span className={pt.deltaCumulative >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {pt.deltaCumulative >= 0 ? "+" : ""}{formatMoney(pt.deltaCumulative)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-[230px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={mtdComparison.dailyPoints}
                    margin={{ top: 10, right: 12, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.12} vertical={false} />
                    <XAxis
                      dataKey="day"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(d) => `D${d}`}
                    />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                    />
                    <Tooltip
                      content={<CustomMtdTooltip metricLabel={mtdComparison.metricLabel} />}
                      cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "6px" }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Line
                      type="monotone"
                      dataKey="mtdCumulative"
                      name={`MTD (${mtdComparison.mtdPeriodLabel})`}
                      stroke="#10B981"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, stroke: "#10B981", strokeWidth: 2, fill: "var(--card)" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="lmtdCumulative"
                      name={`LMTD (${mtdComparison.lmtdPeriodLabel})`}
                      stroke="#64748B"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={{ r: 5, stroke: "#64748B", strokeWidth: 2, fill: "var(--card)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Useful Deterministic Business Insight Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
              <div className="flex items-start gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span className="leading-relaxed">{mtdComparison.insight}</span>
              </div>
              <button
                type="button"
                onClick={handleMtdDrillDown}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline shrink-0 text-xs ml-6 sm:ml-0"
              >
                {mtdComparison.drillDown.label} <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ========================================================================
// CUSTOM HIGH-PRECISION TOOLTIPS
// ========================================================================

function CustomMonthlyTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-lg text-xs space-y-1.5 min-w-[200px]">
      <div className="font-semibold text-foreground border-b border-border/50 pb-1 flex items-center justify-between">
        <span>{data.monthName}</span>
        <span className="text-[10px] text-muted-foreground font-mono">6-Month Trend</span>
      </div>
      <div className="space-y-1 pt-0.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Sales Revenue:</span>
          </div>
          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            {formatMoney(data.sales)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-sky-500" />
            <span className="text-muted-foreground">Procurement:</span>
          </div>
          <span className="font-mono font-semibold text-sky-600 dark:text-sky-400">
            {formatMoney(data.purchases)}
          </span>
        </div>
        <div className="border-t border-border/40 pt-1 flex items-center justify-between gap-4 font-medium">
          <span className="text-muted-foreground">Operating Margin:</span>
          <span className="font-mono">
            {formatMoney(data.sales - data.purchases)}
          </span>
        </div>
      </div>
      <div className="text-[10px] text-primary/80 pt-1 border-t border-border/30 text-right">
        Click point to view register →
      </div>
    </div>
  );
}

function CustomMtdTooltip({ active, payload, metricLabel }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-lg text-xs space-y-1.5 min-w-[220px]">
      <div className="font-semibold text-foreground border-b border-border/50 pb-1 flex items-center justify-between">
        <span>Day {data.day} Comparison</span>
        <span className="text-[10px] text-muted-foreground font-mono">{metricLabel}</span>
      </div>
      <div className="space-y-1 pt-0.5 font-mono">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground font-sans">MTD ({data.dateMtd}):</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {formatMoney(data.mtdCumulative)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground font-sans">LMTD ({data.dateLmtd}):</span>
          <span className="font-semibold text-slate-500 dark:text-slate-400">
            {formatMoney(data.lmtdCumulative)}
          </span>
        </div>
        <div className="border-t border-border/40 pt-1 flex items-center justify-between gap-3">
          <span className="text-muted-foreground font-sans">Cumulative Delta:</span>
          <span className={data.deltaCumulative >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
            {data.deltaCumulative >= 0 ? "+" : ""}{formatMoney(data.deltaCumulative)}
          </span>
        </div>
        {(data.mtdDaily > 0 || data.lmtdDaily > 0) && (
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
            Day {data.day} transactions: MTD {formatMoney(data.mtdDaily)} vs LMTD {formatMoney(data.lmtdDaily)}
          </div>
        )}
      </div>
    </div>
  );
}
