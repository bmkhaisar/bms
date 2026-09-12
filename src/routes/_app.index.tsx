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
} from "@/lib/db";
import { useLive } from "@/lib/useLive";
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
  AreaChart,
  Area,
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
import { useEffect, useState } from "react";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off } from "firebase/database";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Dashboard — BMS NEXT" }] }),
  component: Dashboard,
});

export function Dashboard() {
  const { activeCompany, activeFinancialYear } = useActiveCompany();

  // Local Dexie collections with bounded financial year queries for scale
  const invoices = useLive<Invoice>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().invoices
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().invoices.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const purchases = useLive<Purchase>(() => {
    if (activeFinancialYear?.startDate && activeFinancialYear?.endDate) {
      return db().purchases
        .where("date")
        .between(activeFinancialYear.startDate, activeFinancialYear.endDate, true, true)
        .limit(300)
        .toArray();
    }
    return db().purchases.orderBy("createdAt").reverse().limit(300).toArray();
  }, [activeFinancialYear?.startDate, activeFinancialYear?.endDate]);

  const products = useLive<Product>(() => db().products.toArray());
  const customers = useLive<Customer>(() => db().customers.toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.toArray());
  const recentInvoices = useLive<Invoice>(() =>
    db().invoices.orderBy("createdAt").reverse().limit(5).toArray()
  );

  // Cloud Realtime Ledgers for authoritative accounting calculations
  const [ledgers, setLedgers] = useState<Ledger[]>([]);

  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) {
      setLedgers([]);
      return;
    }

    const ledgersRef = ref(firebaseDb, `companyData/${activeCompany.id}/ledgers`);
    const onData = (snap: any) => {
      if (snap.exists()) {
        const val = snap.val();
        setLedgers(Object.values(val));
      } else {
        setLedgers([]);
      }
    };

    onValue(ledgersRef, onData);

    return () => {
      off(ledgersRef, "value", onData);
    };
  }, [activeCompany?.id]);

  // Compute authoritative metrics using formal double-entry and transaction data
  const metrics = computeDashboardMetrics({
    ledgers,
    invoices,
    purchases,
    products,
    financialYearStart: activeFinancialYear?.startDate,
    financialYearEnd: activeFinancialYear?.endDate,
  });

  const kpiCards = [
    {
      label: "Total Sales",
      value: formatMoney(metrics.totalSales),
      icon: TrendingUp,
      tint: "text-emerald-600 dark:text-emerald-400",
      subtext: activeFinancialYear ? activeFinancialYear.name : "All Time",
    },
    {
      label: "Total Purchases",
      value: formatMoney(metrics.totalPurchases),
      icon: ShoppingBag,
      tint: "text-sky-600 dark:text-sky-400",
      subtext: "Raw materials & COGS",
    },
    {
      label: "Gross Profit",
      value: formatMoney(metrics.grossProfit),
      icon: ArrowUpRight,
      tint: "text-emerald-600 dark:text-emerald-400",
      subtext: "Sales minus direct COGS",
    },
    {
      label: "Net Profit",
      value: formatMoney(metrics.netProfit),
      icon: Wallet,
      tint: "text-emerald-600 dark:text-emerald-400",
      subtext: "After operating expenses",
    },
    {
      label: "Accounts Receivable",
      value: formatMoney(metrics.totalReceivables),
      icon: ArrowUpRight,
      tint: "text-amber-600 dark:text-amber-400",
      subtext: "Pending customer dues",
    },
    {
      label: "Accounts Payable",
      value: formatMoney(metrics.totalPayables),
      icon: ArrowDownRight,
      tint: "text-rose-600 dark:text-rose-400",
      subtext: "Vendor liabilities",
    },
    {
      label: "Cash & Bank",
      value: formatMoney(metrics.totalLiquidity),
      icon: Landmark,
      tint: "text-sky-600 dark:text-sky-400",
      subtext: `Cash: ${formatMoney(metrics.cashInHand)}`,
    },
    {
      label: "Inventory Value",
      value: formatMoney(metrics.stockValue),
      icon: Boxes,
      tint: "text-indigo-600 dark:text-indigo-400",
      subtext: `${metrics.lowStockCount} items at low stock`,
    },
  ];

  const hasChartData = metrics.salesVsPurchasesTrend.some((m) => m.sales > 0 || m.purchases > 0);
  const hasAgingData = metrics.agingReceivables.some((a) => a.amount > 0);

  return (
    <AppShell title="Dashboard">
      <PageHeader
        title={activeCompany ? activeCompany.name : "Company Overview"}
        description={
          activeFinancialYear
            ? `Authoritative financial metrics for Financial Year ${activeFinancialYear.name}.`
            : "Live snapshot of accounting ledgers, sales, purchases, and receivables."
        }
        actions={
          <div className="flex items-center gap-2">
            <Link to="/invoices">
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> New Invoice
              </Button>
            </Link>
          </div>
        }
      />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((k, idx) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.02 }}
          >
            <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm transition-all hover:shadow-md">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </div>
                  <div className="mt-1 text-lg font-bold sm:text-xl font-mono text-foreground">
                    {k.value}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{k.subtext}</div>
                </div>
                <div className="rounded-xl bg-muted/30 p-2">
                  <k.icon className={`h-5 w-5 ${k.tint}`} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Sales vs Purchases 6-Month Trend */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold">Sales vs Purchases Trend</CardTitle>
              <CardDescription className="text-xs">
                Monthly revenue and procurement comparison (Real data only)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {hasChartData ? (
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
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--background)",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                    <Bar dataKey="sales" name="Sales Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill="#0284c7" radius={[4, 4, 0, 0]} />
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
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Receivables Aging</CardTitle>
            <CardDescription className="text-xs">Outstanding customer balance aging</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {hasAgingData ? (
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
                        borderRadius: "8px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--background)",
                      }}
                    />
                    <Bar dataKey="amount" name="Amount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
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
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Recent Sales Invoices</CardTitle>
              <CardDescription className="text-xs">Latest transactions created in this company</CardDescription>
            </div>
            <Link to="/invoices">
              <Button variant="ghost" size="sm" className="text-xs">
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
                  <thead className="border-b border-border/60 bg-muted/20 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-3">Invoice #</th>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Customer</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-6 py-3 font-mono font-medium">{inv.number}</td>
                        <td className="px-6 py-3 text-xs text-muted-foreground">{formatDate(inv.date)}</td>
                        <td className="px-6 py-3">
                          {inv.customerSnapshot?.name || customers.find((c) => c.id === inv.customerId)?.name || "—"}
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-semibold">
                          {formatMoney(inv.grandTotal)}
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              inv.status === "paid"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : inv.status === "partial"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
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
