import type { Ledger } from "@/modules/accounting/types";
import type { Invoice, Purchase, Product, Customer, Supplier, Receipt, Payment, SalesReturn } from "@/lib/db";
import { computeMonthlyTrend } from "./dashboardAnalyticsService.ts";

export interface DashboardMetrics {
  totalSales: number;
  totalPurchases: number;
  totalReceivables: number;
  totalCustomerCredits?: number;
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
  totalPaymentsMade: number;
  paidByPaymentMode: {
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
  totalSalesReturns?: number;
  netBilledValue?: number;
  netSales?: number;
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
  cgstInput: number;
  sgstInput: number;
  igstInput: number;
  salesVsPurchasesTrend: Array<{ label: string; sales: number; purchases: number }>;
  agingReceivables: Array<{ range: string; amount: number }>;
  agingPayables: Array<{ range: string; amount: number }>;
  branchMetrics?: Array<{
    branchId: string;
    branchName: string;
    branchCode?: string;
    isMainBranch?: boolean;
    sales: number;
    salesReturns: number;
    purchases: number;
    collections: number;
    receivables: number;
    netProfit: number;
    invoiceCount: number;
  }>;
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
  payments?: Payment[];
  salesReturns?: SalesReturn[];
  branches?: Array<{ id: string; name: string; code?: string; isMainBranch?: boolean }>;
  branchId?: string;
  financialYearStart?: number;
  financialYearEnd?: number;
  inventoryValuationMethod?: "purchase_cost" | "standard_cost" | string;
}): DashboardMetrics {
  const {
    ledgers = [],
    invoices: allInvoices = [],
    purchases: allPurchases = [],
    products = [],
    receipts: allReceipts = [],
    payments: allPayments = [],
    salesReturns: allSalesReturns = [],
    branches = [],
    branchId,
    financialYearStart,
    financialYearEnd,
    inventoryValuationMethod,
  } = params;

  // Branch Scoping: If a specific branch is selected, scope operational documents strictly to that branch
  const isBranchScoped = Boolean(branchId && branchId !== "all");
  const invoices = isBranchScoped
    ? allInvoices.filter((inv) => inv.branchId === branchId)
    : allInvoices;
  const purchases = isBranchScoped
    ? allPurchases.filter((pu) => pu.branchId === branchId)
    : allPurchases;
  const receipts = isBranchScoped
    ? allReceipts.filter((rec) => rec.branchId === branchId)
    : allReceipts;
  const payments = isBranchScoped
    ? allPayments.filter((pay) => pay.branchId === branchId)
    : allPayments;
  const salesReturns = isBranchScoped
    ? allSalesReturns.filter((ret) => ret.branchId === branchId)
    : allSalesReturns;

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

  const fySalesReturns = salesReturns.filter((ret) => {
    if (financialYearStart && ret.date < financialYearStart) return false;
    if (financialYearEnd && ret.date > financialYearEnd) return false;
    if (ret.status === "cancelled" || ret.status === "reversed" || (ret as any).postingStatus === "reversed") return false;
    return true;
  });

  const totalSalesReturns = fySalesReturns.reduce((sum, r) => sum + (r.grandTotal || 0), 0);
  const returnsTaxable = fySalesReturns.reduce((sum, r) => sum + (r.taxableAmount || 0), 0);
  const returnsGst = fySalesReturns.reduce((sum, r) => sum + (r.gstTotal || 0), 0);

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

  // Authoritative posted supplier payments
  const fyPayments = payments.filter((pay) => {
    if (financialYearStart && pay.date < financialYearStart) return false;
    if (financialYearEnd && pay.date > financialYearEnd) return false;
    return true;
  });

  const postedPayments = fyPayments.filter((pay) => {
    if (pay.postingStatus === "draft" || pay.postingStatus === "failed" || pay.postingStatus === "reversed") return false;
    return true;
  });

  const totalPaymentsMade = postedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const paidByPaymentMode = {
    cash: 0,
    bank: 0,
    upi: 0,
    cheque: 0,
    card: 0,
    other: 0,
  };

  for (const p of postedPayments) {
    const m = (p.mode || (p.paymentMethod as string) || "other").toLowerCase();
    if (m === "cash") paidByPaymentMode.cash += p.amount;
    else if (m === "bank" || m === "transfer" || m === "neft" || m === "rtgs" || m === "imps" || m === "bank_transfer") paidByPaymentMode.bank += p.amount;
    else if (m === "upi") paidByPaymentMode.upi += p.amount;
    else if (m === "cheque" || m === "check") paidByPaymentMode.cheque += p.amount;
    else if (m === "card" || m === "debit" || m === "credit") paidByPaymentMode.card += p.amount;
    else paidByPaymentMode.other += p.amount;
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

  // Receivables & Payables & Customer Credits separation (PRD Section F)
  const receivableLedgers = ledgers.filter(
    (l) => l.partyType === "customer" || l.groupId === "grp_sundry_debtors"
  );
  const payableLedgers = ledgers.filter(
    (l) => l.partyType === "supplier" || l.groupId === "grp_sundry_creditors"
  );

  // Debits are positive (+), credits are negative (-)
  // Customer Credit is tracked separately from Accounts Receivable (never netted)
  let totalReceivables = 0;
  let totalCustomerCredits = 0;

  if (receivableLedgers.length > 0) {
    for (const l of receivableLedgers) {
      const bal = (l.currentBalance || 0) / 100;
      if (bal > 0) {
        totalReceivables += bal;
      } else if (bal < 0) {
        totalCustomerCredits += Math.abs(bal);
      }
    }
  } else {
    totalReceivables = fyInvoices.reduce((sum, inv) => sum + Math.max(0, inv.balance || 0), 0);
  }

  const totalPayables =
    payableLedgers.length > 0
      ? payableLedgers.reduce((sum, l) => sum + Math.max(0, -Math.min(0, (l.currentBalance || 0) / 100)), 0)
      : fyPurchases.reduce((sum, pu) => sum + Math.max(0, pu.balance || 0), 0);

  // 3. Canonical Revenue & Billed Metrics (Hardening Item 18)
  // Net Billed Value = Gross Billed Sales (incl. GST) - Gross Sales Returns / Credit Notes (incl. GST)
  // Allows signed negative values if returns exceed sales in a period
  const grossBilledSales = fyInvoices.reduce((sum, inv) => sum + (inv.grandTotal ?? (inv as any).total ?? 0), 0);
  const netBilledValue = grossBilledSales - totalSalesReturns;

  // Canonical Net Sales Revenue = Posted Sales Revenue excluding Output GST - Revenue portion of posted Credit Notes
  // Allows signed negative values if credit notes exceed sales in a period
  const grossTaxableRevenue = fyInvoices.reduce((sum, inv) => sum + ((inv.subtotal || 0) - (inv.discountTotal || 0)), 0);
  const netSalesRevenue = grossTaxableRevenue - returnsTaxable;
  const totalSales = grossBilledSales;
  const netSales = netSalesRevenue;
  const totalPurchases = fyPurchases.reduce((sum, pu) => sum + (pu.grandTotal ?? (pu as any).total ?? 0), 0);

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

  // 5. Authoritative GST Breakdown (Net Output GST after Credit Notes, Input GST, Net GST Position)
  const grossOutputGst = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);
  const outputGst = Math.max(0, grossOutputGst - returnsGst);
  const inputGst = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).totalTax, 0);
  const netGst = outputGst - inputGst;

  const cgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).cgst, 0);
  const sgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).sgst, 0);
  const igstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).igst, 0);

  const cgstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).cgst, 0);
  const sgstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).sgst, 0);
  const igstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).igst, 0);

  // 6. Monthly Trend Series (Last 6 Months using canonical posted net revenue and procurement)
  const now = new Date();
  const trendMonths = computeMonthlyTrend({
    invoices: fyInvoices,
    purchases: fyPurchases,
    referenceDate: now,
    financialYearStart,
    financialYearEnd,
  });

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

  // 8. Consolidated Branch Metrics Breakdown
  const branchMetrics = branches.length > 0
    ? branches.map((b) => {
        const bInvs = allInvoices.filter((inv) => inv.branchId === b.id);
        const bRets = allSalesReturns.filter(
          (ret) => ret.branchId === b.id && ret.status !== "cancelled" && ret.status !== "reversed"
        );
        const bPurs = allPurchases.filter((pu) => pu.branchId === b.id);
        const bRecs = allReceipts.filter(
          (rec) => rec.branchId === b.id && rec.postingStatus !== "failed" && rec.postingStatus !== "reversed"
        );

        const bSales = bInvs.reduce((s, i) => s + (i.grandTotal ?? (i as any).total ?? 0), 0);
        const bReturnsVal = bRets.reduce((s, r) => s + (r.grandTotal ?? (r as any).total ?? 0), 0);
        const bPurchasesVal = bPurs.reduce((s, p) => s + (p.grandTotal ?? (p as any).total ?? 0), 0);
        const bCollections = bRecs.reduce((s, r) => s + (r.amount || 0), 0);
        const bReceivables = bInvs.reduce((s, i) => s + Math.max(0, i.balance || 0), 0);

        return {
          branchId: b.id,
          branchName: b.name,
          branchCode: b.code,
          isMainBranch: b.isMainBranch,
          sales: bSales,
          salesReturns: bReturnsVal,
          purchases: bPurchasesVal,
          collections: bCollections,
          receivables: bReceivables,
          netProfit: (bSales - bReturnsVal) - bPurchasesVal,
          invoiceCount: bInvs.length,
        };
      })
    : undefined;

  const hasData =
    fyInvoices.length > 0 ||
    fyPurchases.length > 0 ||
    fySalesReturns.length > 0 ||
    products.length > 0 ||
    ledgers.some((l) => l.currentBalance !== 0);

  return {
    totalSales,
    totalSalesReturns,
    netBilledValue,
    netSales,
    totalPurchases,
    totalReceivables,
    totalCustomerCredits,
    totalPayables,
    totalAmountReceived,
    receivedByPaymentMode,
    totalPaymentsMade,
    paidByPaymentMode,
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
    cgstInput,
    sgstInput,
    igstInput,
    salesVsPurchasesTrend: trendMonths,
    agingReceivables,
    agingPayables: [],
    branchMetrics,
    hasData,
  };
}
