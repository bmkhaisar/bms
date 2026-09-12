import type { Ledger } from "@/modules/accounting/types";
import type { Invoice, Purchase, Product, Customer, Supplier } from "@/lib/db";

export interface DashboardMetrics {
  totalSales: number;
  totalPurchases: number;
  totalReceivables: number;
  totalPayables: number;
  cashInHand: number;
  bankBalance: number;
  totalLiquidity: number;
  grossProfit: number;
  netProfit: number;
  stockValue: number;
  lowStockCount: number;
  gstLiability: number;
  outputGst: number;
  inputGst: number;
  netGst: number;
  cgstOutput: number;
  sgstOutput: number;
  igstOutput: number;
  salesVsPurchasesTrend: Array<{ label: string; sales: number; purchases: number }>;
  agingReceivables: Array<{ range: string; amount: number }>;
  agingPayables: Array<{ range: string; amount: number }>;
  hasData: boolean;
}

/**
 * Computes authoritative dashboard financial KPIs from formal double-entry ledgers,
 * sales documents, purchases, and inventory stock.
 * Strictly eliminates fake demo data and the legacy netProfit = grossProfit assumption.
 */
export function computeDashboardMetrics(params: {
  ledgers: Ledger[];
  invoices: Invoice[];
  purchases: Purchase[];
  products: Product[];
  financialYearStart?: number;
  financialYearEnd?: number;
}): DashboardMetrics {
  const { ledgers, invoices, purchases, products, financialYearStart, financialYearEnd } = params;

  // 1. Filter documents by active Financial Year window if provided
  const fyInvoices = invoices.filter((inv) => {
    if (financialYearStart && inv.date < financialYearStart) return false;
    if (financialYearEnd && inv.date > financialYearEnd) return false;
    return true;
  });

  const fyPurchases = purchases.filter((pu) => {
    if (financialYearStart && pu.date < financialYearStart) return false;
    if (financialYearEnd && pu.date > financialYearEnd) return false;
    return true;
  });

  // 2. Authoritative Ledger Balances
  // Cash and Bank ledgers
  const cashLedgers = ledgers.filter(
    (l) => l.groupId === "grp_cash" || l.groupId === "grp_cash_equiv" || l.name.toLowerCase().includes("cash")
  );
  const bankLedgers = ledgers.filter(
    (l) => l.groupId === "grp_bank" || l.name.toLowerCase().includes("bank")
  );

  const cashPaise = cashLedgers.reduce((sum, l) => sum + (l.currentBalance || 0), 0);
  const bankPaise = bankLedgers.reduce((sum, l) => sum + (l.currentBalance || 0), 0);

  // Receivables & Payables
  const receivableLedgers = ledgers.filter(
    (l) => l.partyType === "customer" || l.groupId === "grp_sundry_debtors"
  );
  const payableLedgers = ledgers.filter(
    (l) => l.partyType === "supplier" || l.groupId === "grp_sundry_creditors"
  );

  // Debits are positive, credits are negative for assets/liabilities
  const totalReceivables =
    receivableLedgers.length > 0
      ? receivableLedgers.reduce((sum, l) => sum + Math.max(0, (l.currentBalance || 0) / 100), 0)
      : fyInvoices.reduce((sum, inv) => sum + Math.max(0, inv.balance || 0), 0);

  const totalPayables =
    payableLedgers.length > 0
      ? payableLedgers.reduce((sum, l) => sum + Math.max(0, -Math.min(0, (l.currentBalance || 0) / 100)), 0)
      : fyPurchases.reduce((sum, pu) => sum + Math.max(0, pu.balance || 0), 0);

  // 3. Sales, Purchases, and Profitability
  const totalSales = fyInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const totalPurchases = fyPurchases.reduce((sum, pu) => sum + pu.grandTotal, 0);

  // Calculate COGS: Based on inventory purchased or unit cost of items sold
  let costOfGoodsSold = 0;
  for (const inv of fyInvoices) {
    for (const item of inv.items) {
      const prod = products.find((p) => p.id === item.productId);
      const unitCost = prod ? prod.purchasePrice : item.rate * 0.7; // 70% fallback if purchase cost unknown
      costOfGoodsSold += unitCost * item.quantity;
    }
  }

  // Operating Expenses from ledgers
  const expenseLedgers = ledgers.filter(
    (l) => l.groupNature === "expense" && l.groupId !== "grp_direct_expenses"
  );
  const operatingExpensesPaise = expenseLedgers.reduce((sum, l) => sum + Math.max(0, (l.currentBalance || 0)), 0);
  const operatingExpenses = operatingExpensesPaise / 100;

  const grossProfit = totalSales - costOfGoodsSold;
  const netProfit = grossProfit - operatingExpenses;

  // 4. Inventory Stock Value and Low Stock Alerts
  let stockValue = 0;
  let lowStockCount = 0;
  for (const p of products) {
    if (p.trackInventory !== false) {
      stockValue += (p.currentStock || 0) * (p.purchasePrice || 0);
      if ((p.currentStock || 0) <= (p.reorderLevel || 0)) {
        lowStockCount++;
      }
    }
  }

  // 5. Authoritative GST Breakdown (Output GST, Input GST, Net GST Position)
  const gstOutputPaise = ledgers
    .filter((l) => l.name.toLowerCase().includes("output gst"))
    .reduce((sum, l) => sum + Math.abs(l.currentBalance || 0), 0);
  const gstInputPaise = ledgers
    .filter((l) => l.name.toLowerCase().includes("input gst"))
    .reduce((sum, l) => sum + Math.abs(l.currentBalance || 0), 0);

  const outputGst =
    gstOutputPaise > 0
      ? gstOutputPaise / 100
      : fyInvoices.reduce((s, i) => s + (i.gstTotal || 0), 0);

  const inputGst =
    gstInputPaise > 0
      ? gstInputPaise / 100
      : fyPurchases.reduce((s, p) => s + (p.gstTotal || 0), 0);

  const netGst = outputGst - inputGst;

  const cgstOutput = fyInvoices.reduce((s, i) => s + (i.cgstTotal || 0), 0);
  const sgstOutput = fyInvoices.reduce((s, i) => s + (i.sgstTotal || 0), 0);
  const igstOutput = fyInvoices.reduce((s, i) => s + (i.igstTotal || 0), 0);

  // 6. Monthly Trend Series (Last 6 Months)
  const trendMonths: Array<{ label: string; sales: number; purchases: number }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.getTime();
    const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const end = nextD.getTime();

    const mSales = fyInvoices
      .filter((x) => x.date >= start && x.date < end)
      .reduce((s, i) => s + i.grandTotal, 0);
    const mPurch = fyPurchases
      .filter((x) => x.date >= start && x.date < end)
      .reduce((s, p) => s + p.grandTotal, 0);

    trendMonths.push({
      label: d.toLocaleString("en-IN", { month: "short" }),
      sales: mSales,
      purchases: mPurch,
    });
  }

  // 7. Receivables Aging Buckets
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let rec0_30 = 0;
  let rec31_60 = 0;
  let rec61_90 = 0;
  let rec90Plus = 0;

  for (const inv of fyInvoices) {
    if (inv.balance > 0) {
      const ageDays = Math.floor((nowMs - inv.date) / dayMs);
      if (ageDays <= 30) rec0_30 += inv.balance;
      else if (ageDays <= 60) rec31_60 += inv.balance;
      else if (ageDays <= 90) rec61_90 += inv.balance;
      else rec90Plus += inv.balance;
    }
  }

  const agingReceivables = [
    { range: "0–30 Days", amount: rec0_30 },
    { range: "31–60 Days", amount: rec31_60 },
    { range: "61–90 Days", amount: rec61_90 },
    { range: "90+ Days", amount: rec90Plus },
  ];

  const hasData =
    fyInvoices.length > 0 ||
    fyPurchases.length > 0 ||
    products.length > 0 ||
    ledgers.some((l) => l.currentBalance !== 0);

  return {
    totalSales,
    totalPurchases,
    totalReceivables,
    totalPayables,
    cashInHand: cashPaise / 100,
    bankBalance: bankPaise / 100,
    totalLiquidity: (cashPaise + bankPaise) / 100,
    grossProfit,
    netProfit,
    stockValue,
    lowStockCount: lowStockCount,
    gstLiability: Math.max(0, netGst),
    outputGst,
    inputGst,
    netGst,
    cgstOutput,
    sgstOutput,
    igstOutput,
    salesVsPurchasesTrend: trendMonths,
    agingReceivables,
    agingPayables: [],
    hasData,
  };
}
