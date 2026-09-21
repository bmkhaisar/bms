import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  db,
  type Invoice,
  type Purchase,
  type Product,
  type Customer,
  type Supplier,
  type Quotation,
  type Receipt,
  type Payment,
} from "@/lib/db";
import { useLive, useLiveState } from "@/lib/useLive";
import { formatMoney, formatDate } from "@/lib/format";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  HandCoins,
  Landmark,
  Plus,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
  Building2,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { computeDashboardMetrics } from "@/modules/accounting/services/dashboardReportService";
import type { Ledger } from "@/modules/accounting/types";
import { useEffect, useState, useMemo } from "react";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off } from "firebase/database";
import { DashboardSkeleton } from "@/components/app/Skeletons";

// In-memory module cache so navigating back to dashboard never flashes skeletons or fake zeroes (PRD #22, #23)
const dashboardMetricsMemoryCache: Record<string, any> = {};

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Dashboard — BMS NEXT" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { activeCompany, activeFinancialYear } = useActiveCompany();

  // Local Dexie collections with bounded financial year queries for scale
  const invoicesState = useLiveState<Invoice>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().invoices
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().invoices.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const purchasesState = useLiveState<Purchase>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().purchases
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().purchases.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const productsState = useLiveState<Product>(() => db().products.toArray());
  const customersState = useLiveState<Customer>(() => db().customers.toArray());
  const suppliersState = useLiveState<Supplier>(() => db().suppliers.toArray());
  const receiptsState = useLiveState<Receipt>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().receipts
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().receipts.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const paymentsState = useLiveState<Payment>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().payments
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().payments.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const recentInvoices = useLive<Invoice>(() =>
    db().invoices.orderBy("createdAt").reverse().limit(5).toArray()
  );

  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const products = productsState.data;
  const customers = customersState.data;
  const receipts = receiptsState.data;
  const payments = paymentsState.data;

  // Cloud Realtime Ledgers for authoritative accounting calculations
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledgersLoaded, setLedgersLoaded] = useState(false);

  // Deferred chart rendering for instant header & KPI display (PRD #36)
  const [renderCharts, setRenderCharts] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRenderCharts(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) {
      setLedgers([]);
      setLedgersLoaded(true);
      return;
    }

    setLedgersLoaded(false);
    const ledgersRef = ref(firebaseDb, `companyData/${activeCompany.id}/ledgers`);
    const onData = (snap: any) => {
      if (snap.exists()) {
        const val = snap.val();
        setLedgers(Object.values(val));
      } else {
        setLedgers([]);
      }
      setLedgersLoaded(true);
    };

    onValue(ledgersRef, onData);

    return () => {
      off(ledgersRef, "value", onData);
    };
  }, [activeCompany?.id]);

  const isDataLoaded = invoicesState.isLoaded && purchasesState.isLoaded && productsState.isLoaded && receiptsState.isLoaded && paymentsState.isLoaded && customersState.isLoaded && ledgersLoaded;
  const cacheKey = `${activeCompany?.id || "default"}_${activeFinancialYear?.id || "all"}`;

  // Compute authoritative metrics using formal double-entry and transaction data
  const metrics = useMemo(() => {
    if (!isDataLoaded && dashboardMetricsMemoryCache[cacheKey]) {
      return dashboardMetricsMemoryCache[cacheKey];
    }
    const computed = computeDashboardMetrics({
      ledgers,
      invoices,
      purchases,
      products,
      receipts,
      payments,
      financialYearStart: activeFinancialYear?.startDate,
      financialYearEnd: activeFinancialYear?.endDate,
      inventoryValuationMethod: (activeCompany as any)?.inventoryValuationMethod,
    });
    if (isDataLoaded) {
      dashboardMetricsMemoryCache[cacheKey] = computed;
    }
    return computed;
  }, [isDataLoaded, ledgers, invoices, purchases, products, receipts, payments, activeFinancialYear?.startDate, activeFinancialYear?.endDate, (activeCompany as any)?.inventoryValuationMethod, cacheKey]);

  // If data is still querying and no memory cache exists yet, show skeleton rather than flashing ₹0
  if (!isDataLoaded && !dashboardMetricsMemoryCache[cacheKey]) {
    return (
      <AppShell title="Dashboard">
        <DashboardSkeleton />
      </AppShell>
    );
  }

  const kpiCards = [
    {
      label: "Total Sales",
      value: formatMoney(metrics.totalSales),
      icon: TrendingUp,
      tint: "text-mint",
      subtext: activeFinancialYear ? activeFinancialYear.name : "All Time",
      href: "/invoices",
    },
    {
      label: "Amount Received",
      value: formatMoney(metrics.totalAmountReceived),
      icon: HandCoins,
      tint: "text-mint",
      subtext: "Posted customer receipts",
      href: "/receipts",
    },
    {
      label: "Accounts Receivable",
      value: formatMoney(metrics.totalReceivables),
      icon: ArrowUpRight,
      tint: "text-amber-600 dark:text-amber-400",
      subtext: "Pending customer dues",
      href: "/invoices",
    },
    {
      label: "Total Purchases",
      value: formatMoney(metrics.totalPurchases),
      icon: ShoppingBag,
      tint: "text-sky-600 dark:text-sky-400",
      subtext: "Raw materials & COGS",
      href: "/purchases",
    },
    {
      label: "Payments Made",
      value: formatMoney(metrics.totalPaymentsMade),
      icon: ArrowUpRight,
      tint: "text-rose-600 dark:text-rose-400",
      subtext: "Disbursed to suppliers",
      href: "/receipts",
    },
    {
      label: "Accounts Payable",
      value: formatMoney(metrics.totalPayables),
      icon: ArrowDownRight,
      tint: "text-rose-600 dark:text-rose-400",
      subtext: "Vendor liabilities",
      href: "/purchases",
    },
    {
      label: "Gross Profit",
      value: formatMoney(metrics.grossProfit),
      icon: ArrowUpRight,
      tint: "text-mint",
      subtext: "Sales minus direct COGS",
      href: "/reports",
    },
    {
      label: "Net Profit",
      value: formatMoney(metrics.netProfit),
      icon: Wallet,
      tint: "text-mint",
      subtext: "After operating expenses",
      href: "/reports",
    },
    {
      label: "Cash & Bank",
      value: formatMoney(metrics.totalLiquidity),
      icon: Landmark,
      tint: "text-sky-600 dark:text-sky-400",
      subtext: `Cash: ${formatMoney(metrics.cashInHand)}`,
      href: "/ledger",
    },
    {
      label: "Inventory Value",
      value: formatMoney(metrics.stockValue),
      icon: Boxes,
      tint: "text-indigo-600 dark:text-indigo-400",
      subtext: `${metrics.lowStockCount} items at low stock`,
      href: "/products",
    },
  ];

  const hasChartData = (metrics.salesVsPurchasesTrend || []).some((m: { sales: number; purchases: number }) => m.sales > 0 || m.purchases > 0);
  const hasAgingData = (metrics.agingReceivables || []).some((a: { amount: number }) => a.amount > 0);

  return (
    <AppShell title="Dashboard">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {activeCompany?.logoUrl ? (
            <img
              src={activeCompany.logoUrl}
              alt={activeCompany.name}
              className="h-11 w-11 rounded-xl border border-border/80 bg-white object-contain p-1 shadow-soft"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-base font-bold text-primary shadow-soft">
              {activeCompany?.name ? activeCompany.name.slice(0, 2).toUpperCase() : "BH"}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground">
              {activeCompany ? activeCompany.name : "Company Overview"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeFinancialYear
                ? `Authoritative financial metrics for Financial Year ${activeFinancialYear.name}.`
                : "Live snapshot of accounting ledgers, sales, purchases, and receivables."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/invoices">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> New Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid with Interactive Drill-Down Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {kpiCards.map((k, idx) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.02 }}
          >
            <Link to={k.href} className="block transition-transform hover:-translate-y-0.5">
              <Card className="cursor-pointer rounded-2xl border border-border/80 bg-card shadow-soft transition-all hover:shadow-md hover:border-mint/40">
                <CardContent className="flex items-center justify-between p-4 sm:p-5">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {k.label}
                    </div>
                    <div className="mt-1 text-lg font-bold sm:text-2xl font-mono tabular-nums text-foreground">
                      {k.value}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{k.subtext}</div>
                  </div>
                  <div className="rounded-xl bg-secondary/50 p-2.5">
                    <k.icon className={`h-5 w-5 ${k.tint}`} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Dedicated GST & Statutory Tax Position (PRD #22, #42, #44) */}
      <div className="mt-4">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-indigo-500" />
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  GST & Tax Position
                </h3>
                <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                  Statutory Tax Amounts Only
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reconciled output tax liabilities, input tax credits (ITC), and net payable position. (Excludes gross commercial turnover).
              </p>
            </div>
            <Link to="/reports">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                View GST Register &rarr;
              </Button>
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Output GST */}
            <div className="rounded-xl border border-mint/25 bg-mint/5 p-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-mint">
                Output GST (Sales Tax Collected)
              </div>
              <div className="mt-1 text-xl font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.outputGst)}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span>CGST: {formatMoney(metrics.cgstOutput)}</span>
                <span>•</span>
                <span>SGST: {formatMoney(metrics.sgstOutput)}</span>
                {metrics.igstOutput > 0 && (
                  <>
                    <span>•</span>
                    <span>IGST: {formatMoney(metrics.igstOutput)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Input GST */}
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-sky-700 dark:text-sky-400">
                Input GST (Purchase ITC Paid)
              </div>
              <div className="mt-1 text-xl font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.inputGst)}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span>CGST: {formatMoney(metrics.cgstInput)}</span>
                <span>•</span>
                <span>SGST: {formatMoney(metrics.sgstInput)}</span>
                {metrics.igstInput > 0 && (
                  <>
                    <span>•</span>
                    <span>IGST: {formatMoney(metrics.igstInput)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Net GST Position */}
            <div
              className={`rounded-xl border p-3.5 ${
                metrics.netGst >= 0
                  ? "border-amber-500/20 bg-amber-500/5"
                  : "border-mint/25 bg-mint/5"
              }`}
            >
              <div className="text-[11px] font-medium uppercase tracking-wider text-foreground">
                {metrics.netGst >= 0 ? "Net GST Payable to Govt" : "Net ITC Credit Balance"}
              </div>
              <div className="mt-1 text-xl font-bold font-mono tabular-nums text-foreground">
                {formatMoney(Math.abs(metrics.netGst))}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {metrics.netGst >= 0 ? "Output GST exceeds Input ITC" : "Accumulated credit forward"}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Customer Receipts & Payment Mode Breakdown (PRD § 40-49) */}
      <div className="mt-4">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <HandCoins className="h-5 w-5 text-mint" />
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  Customer Collections & Payment Methods
                </h3>
                <span className="rounded-full bg-mint/10 px-2.5 py-0.5 text-[11px] font-medium text-mint">
                  Posted Receipts Only
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Actual cash and bank inflows from posted customer vouchers. Advances and invoice settlements counted strictly once.
              </p>
            </div>
            <Link to="/receipts">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                Open Receipt Register &rarr;
              </Button>
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-mint/25 bg-mint/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-mint">
                Total Received
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.totalAmountReceived)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bank / Transfer
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.receivedByPaymentMode.bank)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                UPI
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.receivedByPaymentMode.upi)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cash
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.receivedByPaymentMode.cash)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cheque
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.receivedByPaymentMode.cheque)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Card / Other
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.receivedByPaymentMode.card + metrics.receivedByPaymentMode.other)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Supplier Payments & Payment Mode Breakdown */}
      <div className="mt-4">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-rose-500" />
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  Supplier Payments & Disbursements
                </h3>
                <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  Posted Payments Only
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Actual cash and bank outflows paid to suppliers and vendors for purchase bill settlements and advances.
              </p>
            </div>
            <Link to="/receipts">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                Open Payment Register &rarr;
              </Button>
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Total Disbursed
              </div>
              <div className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.totalPaymentsMade)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bank / Transfer
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.paidByPaymentMode.bank)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                UPI
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.paidByPaymentMode.upi)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cash
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.paidByPaymentMode.cash)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cheque
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.paidByPaymentMode.cheque)}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Card / Other
              </div>
              <div className="mt-1 text-base font-bold font-mono tabular-nums text-foreground">
                {formatMoney(metrics.paidByPaymentMode.card + metrics.paidByPaymentMode.other)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Sales vs Purchases 6-Month Trend */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold">Sales vs Purchases Trend</CardTitle>
              <CardDescription className="text-xs">
                Monthly revenue and procurement comparison (Real data only)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {!renderCharts ? (
              <div className="h-[280px] w-full animate-pulse rounded-xl bg-muted/20" />
            ) : hasChartData ? (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.salesVsPurchasesTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                    />
                    <Tooltip
                      formatter={(val: any) => [formatMoney(Number(val)), ""]}
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--card)",
                        color: "var(--foreground)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                    <Bar dataKey="sales" name="Sales Revenue" fill="var(--mint, #2C7B52)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill="#3B82F6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No transaction data yet</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Create tax invoices or purchase vouchers to see monthly sales trends.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Receivables Aging */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Receivables Aging</CardTitle>
            <CardDescription className="text-xs">Outstanding customer balance aging</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {!renderCharts ? (
              <div className="h-[280px] w-full animate-pulse rounded-xl bg-muted/20" />
            ) : hasAgingData ? (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={metrics.agingReceivables}
                    layout="vertical"
                    margin={{ top: 10, right: 20, left: 20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis
                      type="number"
                      fontSize={11}
                      tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
                    />
                    <YAxis dataKey="range" type="category" fontSize={11} width={80} />
                    <Tooltip
                      formatter={(val: any) => [formatMoney(Number(val)), "Outstanding"]}
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--card)",
                        color: "var(--foreground)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      }}
                    />
                    <Bar dataKey="amount" name="Amount" fill="#D97706" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No outstanding dues</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  All customer invoices are fully settled or no pending receivables exist.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices Table */}
      <div className="mt-6">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Recent Sales Invoices</CardTitle>
              <CardDescription className="text-xs">Latest transactions created in this company</CardDescription>
            </div>
            <Link to="/invoices">
              <Button variant="ghost" size="sm" className="text-xs hover:bg-secondary">
                View all →
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentInvoices.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No invoices issued yet.
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/70 bg-secondary/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3">Invoice #</th>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Customer</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-6 py-3 font-mono font-medium tabular-nums">{inv.number}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{formatDate(inv.date)}</td>
                        <td className="px-6 py-3">
                          {inv.customerSnapshot?.name || customers.find((c) => c.id === inv.customerId)?.name || "—"}
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-semibold tabular-nums">
                          {formatMoney(inv.grandTotal)}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              inv.status === "paid"
                                ? "bg-mint/15 text-mint"
                                : inv.status === "partial"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
