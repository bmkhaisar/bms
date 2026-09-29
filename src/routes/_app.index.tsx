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
  type SalesReturn,
  type CreditNote,
} from "@/lib/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { buildCanonicalReportingScope } from "@/modules/accounting/services/reportingScope";
import type { Ledger, Voucher } from "@/modules/accounting/types";
import { useEffect, useState, useMemo } from "react";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off } from "firebase/database";
import { DashboardSkeleton } from "@/components/app/Skeletons";
import { DashboardSalesVsPurchasesCard } from "@/components/app/DashboardSalesVsPurchasesCard";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { PublicShell } from "@/components/app/PublicShell";
import { LandingPage } from "@/components/marketing/LandingPage";

// In-memory module cache so navigating back to dashboard never flashes skeletons or fake zeroes (PRD #22, #23)
const dashboardMetricsMemoryCache: Record<string, any> = {};

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "BMS NEXT — Business Management System" }] }),
  component: RootLandingOrDashboard,
});

function RootLandingOrDashboard() {
  const { isAuthenticated, user, authInitializing, claimsLoading } = useAuth();

  if (authInitializing || claimsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <PublicShell>
        <LandingPage />
      </PublicShell>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const { activeCompany, activeFinancialYear, activeBranchId, branches, isOwner } = useActiveCompany();

  // Local Dexie collections with bounded financial year queries + 45-day lookback for MTD vs LMTD cross-FY comparisons
  const invoicesState = useLiveState<Invoice>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      const queryStart = activeFinancialYear.startDate - 45 * 24 * 60 * 60 * 1000;
      return db().invoices
        .where("date")
        .between(queryStart, activeFinancialYear.endDate, true, true)
        .toArray();
    }
    return db().invoices.orderBy("date").reverse().toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const purchasesState = useLiveState<Purchase>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      const queryStart = activeFinancialYear.startDate - 45 * 24 * 60 * 60 * 1000;
      return db().purchases
        .where("date")
        .between(queryStart, activeFinancialYear.endDate, true, true)
        .toArray();
    }
    return db().purchases.orderBy("date").reverse().toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const productsState = useLiveState<Product>(() => db().products.toArray());
  const customersState = useLiveState<Customer>(() => db().customers.toArray());
  const suppliersState = useLiveState<Supplier>(() => db().suppliers.toArray());
  const receiptsState = useLiveState<Receipt>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      const queryStart = activeFinancialYear.startDate - 45 * 24 * 60 * 60 * 1000;
      return db().receipts
        .where("date")
        .between(queryStart, activeFinancialYear.endDate, true, true)
        .toArray();
    }
    return db().receipts.orderBy("date").reverse().toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const paymentsState = useLiveState<Payment>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      const queryStart = activeFinancialYear.startDate - 45 * 24 * 60 * 60 * 1000;
      return db().payments
        .where("date")
        .between(queryStart, activeFinancialYear.endDate, true, true)
        .toArray();
    }
    return db().payments.orderBy("date").reverse().toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const salesReturnsState = useLiveState<SalesReturn>(() => {
    return db().salesReturns.orderBy("date").reverse().toArray();
  }, []);

  const creditNotesState = useLiveState<CreditNote>(() => {
    return db().creditNotes.orderBy("date").reverse().toArray();
  }, []);

  const recentInvoices = useLive<Invoice>(() =>
    db().invoices.orderBy("createdAt").reverse().limit(5).toArray()
  );

  const invoices = invoicesState.data;
  const purchases = purchasesState.data;
  const products = productsState.data;
  const customers = customersState.data;
  const receipts = receiptsState.data;
  const payments = paymentsState.data;
  const salesReturns = salesReturnsState.data;
  const creditNotes = creditNotesState.data;

  // Cloud Realtime Ledgers & Vouchers for authoritative accounting calculations
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [ledgersLoaded, setLedgersLoaded] = useState(false);
  const [vouchersLoaded, setVouchersLoaded] = useState(false);

  // Deferred chart rendering for instant header & KPI display (PRD #36)
  const [renderCharts, setRenderCharts] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRenderCharts(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) {
      setLedgers([]);
      setVouchers([]);
      setLedgersLoaded(true);
      setVouchersLoaded(true);
      return;
    }

    setLedgersLoaded(false);
    setVouchersLoaded(false);
    const ledgersRef = ref(firebaseDb, `companyData/${activeCompany.id}/ledgers`);
    const vouchersRef = ref(firebaseDb, `companyData/${activeCompany.id}/vouchers`);

    const onData = (snap: any) => {
      if (snap.exists()) {
        const val = snap.val();
        setLedgers(Object.values(val));
      } else {
        setLedgers([]);
      }
      setLedgersLoaded(true);
    };

    const onVouchers = (snap: any) => {
      if (snap.exists()) {
        const val = snap.val();
        setVouchers(Object.values(val));
      } else {
        setVouchers([]);
      }
      setVouchersLoaded(true);
    };

    onValue(ledgersRef, onData);
    onValue(vouchersRef, onVouchers);

    return () => {
      off(ledgersRef, "value", onData);
      off(vouchersRef, "value", onVouchers);
    };
  }, [activeCompany?.id]);

  const isDataLoaded =
    invoicesState.isLoaded &&
    purchasesState.isLoaded &&
    productsState.isLoaded &&
    receiptsState.isLoaded &&
    paymentsState.isLoaded &&
    customersState.isLoaded &&
    salesReturnsState.isLoaded &&
    creditNotesState.isLoaded &&
    ledgersLoaded &&
    vouchersLoaded;
  const cacheKey = `${activeCompany?.id || "default"}_${activeBranchId || "all"}_${activeFinancialYear?.id || "all"}`;

  const canonicalScope = useMemo(() => {
    return buildCanonicalReportingScope({
      companyId: activeCompany?.id || "default",
      financialYearId: activeFinancialYear?.id,
      activeBranchId,
    });
  }, [activeCompany?.id, activeFinancialYear?.id, activeBranchId]);

  // Compute authoritative metrics using formal double-entry and transaction data
  const metrics = useMemo(() => {
    if (!isDataLoaded) {
      return dashboardMetricsMemoryCache[cacheKey] || null;
    }
    const computed = computeDashboardMetrics({
      ledgers,
      vouchers,
      invoices,
      purchases,
      products,
      receipts,
      payments,
      salesReturns: salesReturnsState.data,
      creditNotes: creditNotesState.data,
      branches,
      scope: canonicalScope,
      financialYearStart: activeFinancialYear?.startDate,
      financialYearEnd: activeFinancialYear?.endDate,
      inventoryValuationMethod: (activeCompany as any)?.inventoryValuationMethod,
    });
    dashboardMetricsMemoryCache[cacheKey] = computed;
    return computed;
  }, [
    isDataLoaded,
    ledgers,
    invoices,
    purchases,
    products,
    receipts,
    payments,
    salesReturnsState.data,
    creditNotesState.data,
    branches,
    canonicalScope,
    activeFinancialYear?.startDate,
    activeFinancialYear?.endDate,
    (activeCompany as any)?.inventoryValuationMethod,
    cacheKey,
  ]);

  // If data is still querying and no memory cache exists yet, show skeleton rather than flashing fake ₹0 (PRD § 9)
  if (!isDataLoaded || !metrics) {
    return (
      <AppShell title="Dashboard">
        <DashboardSkeleton />
      </AppShell>
    );
  }

  const kpiCards = [
    {
      label: metrics.totalSalesReturns && metrics.totalSalesReturns > 0 ? "Net Billed Value" : "Total Billed Sales",
      value: formatMoney(metrics.netBilledValue ?? (metrics.totalSales - (metrics.totalSalesReturns || 0))),
      icon: TrendingUp,
      tint: "text-mint",
      subtext: metrics.totalSalesReturns && metrics.totalSalesReturns > 0
        ? `Gross: ${formatMoney(metrics.totalSales)} | CN: ${formatMoney(metrics.totalSalesReturns)}`
        : (activeFinancialYear ? activeFinancialYear.name : "All Time"),
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
      subtext: metrics.totalCustomerCredits && metrics.totalCustomerCredits > 0
        ? `Pending dues (Credits: ${formatMoney(metrics.totalCustomerCredits)})`
        : "Pending customer dues",
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
      subtext: `Cash: ${formatMoney(metrics.cashInHand)} | Bank: ${formatMoney(metrics.bankBalance)}`,
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

      {/* Consolidated Branch Comparison (Owner or Consolidated View) */}
      {metrics.branchMetrics && metrics.branchMetrics.length > 1 && (activeBranchId === "all" || isOwner) && (
        <div className="mt-4">
          <Card className="rounded-2xl border border-border/80 bg-card shadow-soft p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  Branch Performance Comparison
                </h3>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  {activeBranchId === "all" ? "Consolidated All Branches" : "Multi-Branch Comparison"}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 text-[11px]">
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Gross Sales</TableHead>
                    <TableHead className="text-right">Returns</TableHead>
                    <TableHead className="text-right">Net Billed</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead className="text-right">Collections</TableHead>
                    <TableHead className="text-right">Outstanding AR</TableHead>
                    <TableHead className="text-right">Operating Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.branchMetrics.map((bm: any) => (
                    <TableRow key={bm.branchId} className="text-xs hover:bg-muted/30">
                      <TableCell className="font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{bm.branchName}</span>
                          {bm.branchCode && (
                            <span className="text-[10px] text-muted-foreground font-mono">({bm.branchCode})</span>
                          )}
                          {bm.isMainBranch && (
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[9px] py-0">
                              Main
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">{formatMoney(bm.sales)}</TableCell>
                      <TableCell className="text-right text-rose-600 dark:text-rose-400 font-medium">
                        {bm.salesReturns > 0 ? formatMoney(bm.salesReturns) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-foreground">{formatMoney(bm.sales - bm.salesReturns)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatMoney(bm.purchases)}</TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">{formatMoney(bm.collections)}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">{formatMoney(bm.receivables)}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{formatMoney(bm.netProfit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

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
        {/* Sales vs Purchases 6-Month Trend & MTD vs LMTD Analytics */}
        <DashboardSalesVsPurchasesCard
          invoices={invoices}
          purchases={purchases}
          receipts={receipts}
          salesReturns={salesReturns}
          isLoaded={isDataLoaded}
          activeCompanyName={activeCompany?.name}
          activeFinancialYearName={activeFinancialYear?.name}
          financialYearStart={activeFinancialYear?.startDate}
          financialYearEnd={activeFinancialYear?.endDate}
          timezone={(activeCompany as any)?.timezone || "Asia/Kolkata"}
          className="lg:col-span-2"
        />

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
