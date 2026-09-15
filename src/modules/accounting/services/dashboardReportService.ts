import type { Ledger } from "@/modules/accounting/types";
import type { Invoice, Purchase, Product, Customer, Supplier, Receipt } from "@/lib/db";

export interface DashboardMetrics {
  totalSales: number;
  totalPurchases: number;
  totalReceivables: number;
  totalPayables: number;
  totalAmountReceived: number;
  receivedByPaymentMode: {
    cash: number;
    bank: number;
    upi: number;
    cheque: number;
    card: number;
    other: number;
  };
  cashInHand: number;
  bankBalance: number;
  totalLiquidity: number;
  grossProfit: number;
  netProfit: number;
  netSalesRevenue?: number;
  costOfGoodsSold?: number;
  isCostingIncomplete?: boolean;
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

export function resolveDocumentTaxes(doc: Invoice | Purchase) {
  const docAny = doc as any;
  if (docAny.taxSnapshot) {
    const s = docAny.taxSnapshot;
    return {
      taxable: s.taxableValue ?? ((doc.subtotal || 0) - (doc.discountTotal || 0)),
      cgst: s.cgst || 0,
      sgst: s.sgst || 0,
      igst: s.igst || 0,
      cess: s.cess || 0,
      totalTax: (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0) + (s.cess || 0),
      isInterState: Boolean(s.isInterState),
    };
  }

  const isInterState = Boolean(docAny.isIgst || (doc.igstTotal && doc.igstTotal > 0));
  const rawGstTotal = doc.gstTotal || 0;

  if (isInterState) {
    const igst = doc.igstTotal || rawGstTotal;
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst: 0,
      sgst: 0,
      igst,
      cess: docAny.cessTotal || 0,
      totalTax: igst + (docAny.cessTotal || 0),
      isInterState: true,
    };
  } else {
    const cgst = doc.cgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    const sgst = doc.sgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    return {
      taxable: (doc.subtotal || 0) - (doc.discountTotal || 0),
      cgst,
      sgst,
      igst: 0,
      cess: docAny.cessTotal || 0,
      totalTax: cgst + sgst + (docAny.cessTotal || 0),
      isInterState: false,
    };
  }
}

/**
 * Computes authoritative dashboard financial KPIs from formal double-entry ledgers,
 * sales documents, purchases, receipts, and inventory stock.
 * Strictly eliminates fake demo data and the legacy netProfit = grossProfit assumption.
 */
export function computeDashboardMetrics(params: {
  ledgers: Ledger[];
  invoices: Invoice[];
  purchases: Purchase[];
  products: Product[];
  receipts?: Receipt[];
  financialYearStart?: number;
  financialYearEnd?: number;
  inventoryValuationMethod?: "purchase_cost" | "standard_cost" | string;
}): DashboardMetrics {
  const { ledgers, invoices, purchases, products, receipts = [], financialYearStart, financialYearEnd, inventoryValuationMethod } = params;

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

  // Filter receipts by active Financial Year window
  const fyReceipts = receipts.filter((rec) => {
    if (financialYearStart && rec.date < financialYearStart) return false;
    if (financialYearEnd && rec.date > financialYearEnd) return false;
    return true;
  });

  // Authoritative posted customer receipts only (strictly exclude draft, failed, reversed, refunded, cancelled)
  const postedReceipts = fyReceipts.filter((rec) => {
    const status = (rec as any).status;
    if (status === "cancelled" || status === "draft") return false;
    if (rec.postingStatus === "draft" || rec.postingStatus === "failed" || rec.postingStatus === "reversed" || rec.postingStatus === "refunded") return false;
    return true;
  });

  const totalAmountReceived = postedReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);

  const receivedByPaymentMode = {
    cash: 0,
    bank: 0,
    upi: 0,
    cheque: 0,
    card: 0,
    other: 0,
  };

  for (const r of postedReceipts) {
    const m = (r.mode || (r.paymentMethod as string) || "other").toLowerCase();
    if (m === "cash") receivedByPaymentMode.cash += r.amount;
    else if (m === "bank" || m === "transfer" || m === "neft" || m === "rtgs" || m === "imps") receivedByPaymentMode.bank += r.amount;
    else if (m === "upi") receivedByPaymentMode.upi += r.amount;
    else if (m === "cheque" || m === "check") receivedByPaymentMode.cheque += r.amount;
    else if (m === "card" || m === "debit" || m === "credit") receivedByPaymentMode.card += r.amount;
    else receivedByPaymentMode.other += r.amount;
  }

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

  // 3. Sales Revenue (Strictly excludes Output GST) & Deterministic COGS
  const grossBilledSales = fyInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
  const netSalesRevenue = fyInvoices.reduce((sum, inv) => sum + (inv.subtotal - inv.discountTotal), 0);
  const totalSales = grossBilledSales;
  const totalPurchases = fyPurchases.reduce((sum, pu) => sum + pu.grandTotal, 0);

  // Authoritative Cost of Goods Sold (COGS) without guessing
  const valuationMethod = inventoryValuationMethod || "purchase_cost";
  let costOfGoodsSold = 0;
  let isCostingIncomplete = false;
  for (const inv of fyInvoices) {
    for (const item of inv.items || []) {
      const prod = products.find((p) => p.id === item.productId);
      const unitCost = prod
        ? valuationMethod === "standard_cost"
          ? ((prod as any).defaultPurchaseRatePaise ? (prod as any).defaultPurchaseRatePaise / 100 : 0)
          : (prod.purchasePrice || 0)
        : 0;
      if (unitCost <= 0 && (item.quantity || 0) > 0) {
        isCostingIncomplete = true;
      }
      costOfGoodsSold += unitCost * (item.quantity || 0);
    }
  }

  // Operating Expenses from ledgers
  const expenseLedgers = ledgers.filter(
    (l) => l.groupNature === "expense" && l.groupId !== "grp_direct_expenses"
  );
  const operatingExpensesPaise = expenseLedgers.reduce((sum, l) => sum + Math.max(0, (l.currentBalance || 0)), 0);
  const operatingExpenses = operatingExpensesPaise / 100;

  const grossProfit = netSalesRevenue - costOfGoodsSold;
  const netProfit = grossProfit - operatingExpenses;

  // 4. Inventory Stock Value and Low Stock Alerts (Deterministic configured valuationMethod)
  let stockValue = 0;
  let lowStockCount = 0;
  for (const p of products) {
    if (p.trackInventory !== false) {
      const unitValuation =
        valuationMethod === "standard_cost"
          ? ((p as any).defaultPurchaseRatePaise ? (p as any).defaultPurchaseRatePaise / 100 : 0)
          : (p.purchasePrice || 0);
      stockValue += (p.currentStock || 0) * unitValuation;
      if ((p.currentStock || 0) <= (p.reorderLevel || 0)) {
        lowStockCount++;
      }
    }
  }

  // 5. Authoritative GST Breakdown (Output GST, Input GST, Net GST Position)
  // Reconciled with GST Report calculation: Output GST comes directly from posted fyInvoices
  const outputGst = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);
  const inputGst = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).totalTax, 0);
  const netGst = outputGst - inputGst;

  const cgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).cgst, 0);
  const sgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).sgst, 0);
  const igstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).igst, 0);

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
    totalAmountReceived,
    receivedByPaymentMode,
    cashInHand: cashPaise / 100,
    bankBalance: bankPaise / 100,
    totalLiquidity: (cashPaise + bankPaise) / 100,
    grossProfit,
    netProfit,
    netSalesRevenue,
    costOfGoodsSold,
    isCostingIncomplete,
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
