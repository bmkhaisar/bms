import type { Ledger } from "@/modules/accounting/types";
import type { Invoice, Purchase, Product, Customer, Supplier, Receipt, Payment, SalesReturn, CreditNote } from "@/lib/db";
import { computeMonthlyTrend } from "./dashboardAnalyticsService.ts";
import { buildCanonicalReportingScope, type CanonicalReportingScope } from "./reportingScope.ts";
import { logDashboardDiagnostics } from "./dashboardDiagnostics.ts";
import {
  isPostedInvoice,
  isPostedPurchase,
  isPostedReceipt,
  isPostedPayment,
  isPostedSalesReturn,
  isPostedCreditNote,
  resolveCanonicalInvoiceOutstanding,
  resolveCanonicalPurchaseOutstanding,
  calculateAuthoritativeCustomerCredits,
} from "./canonicalOutstandingService.ts";

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

export function resolveDocumentTaxes(doc: Invoice | Purchase | SalesReturn | CreditNote) {
  const docAny = doc as any;
  if (docAny.taxSnapshot) {
    const s = docAny.taxSnapshot;
    return {
      taxable: s.taxableValue ?? ((doc.subtotal || 0) - ((doc as any).discountTotal || 0)),
      cgst: s.cgst || 0,
      sgst: s.sgst || 0,
      igst: s.igst || 0,
      cess: s.cess || 0,
      totalTax: (s.cgst || 0) + (s.sgst || 0) + (s.igst || 0) + (s.cess || 0),
      isInterState: Boolean(s.isInterState),
    };
  }

  const isInterState = Boolean(docAny.isIgst || ((doc as any).igstTotal && (doc as any).igstTotal > 0));
  const rawGstTotal = (doc as any).gstTotal || 0;

  if (isInterState) {
    const igst = (doc as any).igstTotal || rawGstTotal;
    return {
      taxable: (doc.subtotal || 0) - ((doc as any).discountTotal || 0),
      cgst: 0,
      sgst: 0,
      igst,
      cess: docAny.cessTotal || 0,
      totalTax: igst + (docAny.cessTotal || 0),
      isInterState: true,
    };
  } else {
    const cgst = (doc as any).cgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    const sgst = (doc as any).sgstTotal || (rawGstTotal ? rawGstTotal / 2 : 0);
    return {
      taxable: (doc.subtotal || 0) - ((doc as any).discountTotal || 0),
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
 * STRICT POSTED-ONLY ACCOUNTING RULE: Draft documents have zero accounting authority.
 */
export function computeDashboardMetrics(params: {
  ledgers: Ledger[];
  invoices: Invoice[];
  purchases: Purchase[];
  products: Product[];
  receipts?: Receipt[];
  payments?: Payment[];
  salesReturns?: SalesReturn[];
  creditNotes?: CreditNote[];
  branches?: Array<{ id: string; name: string; code?: string; isMainBranch?: boolean }>;
  branchId?: string;
  scope?: CanonicalReportingScope;
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
    creditNotes: allCreditNotes = [],
    branches = [],
    branchId: rawBranchId,
    scope: providedScope,
    financialYearStart,
    financialYearEnd,
    inventoryValuationMethod,
  } = params;

  // Resolve canonical reporting scope
  const effectiveScope: CanonicalReportingScope =
    providedScope ||
    buildCanonicalReportingScope({
      companyId: "default",
      activeBranchId: rawBranchId,
      financialYearId: undefined,
    });

  const isBranchScoped = effectiveScope.scopeMode === "BRANCH";
  const targetBranchId = effectiveScope.activeBranchId;

  // Operational documents strictly scoped to active branch in BRANCH mode, or consolidated in CONSOLIDATED mode
  const scopedInvoices = isBranchScoped
    ? allInvoices.filter((inv) => inv.branchId === targetBranchId)
    : allInvoices;
  const scopedPurchases = isBranchScoped
    ? allPurchases.filter((pu) => pu.branchId === targetBranchId)
    : allPurchases;
  const scopedReceipts = isBranchScoped
    ? allReceipts.filter((rec) => rec.branchId === targetBranchId)
    : allReceipts;
  const scopedPayments = isBranchScoped
    ? allPayments.filter((pay) => pay.branchId === targetBranchId)
    : allPayments;
  const scopedSalesReturns = isBranchScoped
    ? allSalesReturns.filter((ret) => ret.branchId === targetBranchId)
    : allSalesReturns;
  const scopedCreditNotes = isBranchScoped
    ? allCreditNotes.filter((cn) => cn.branchId === targetBranchId)
    : allCreditNotes;

  // 1. STRICT POSTED-ONLY FILTERING (Zero accounting authority for drafts, cancelled, voided, reversed)
  const postedInvoices = scopedInvoices.filter(isPostedInvoice);
  const postedPurchases = scopedPurchases.filter(isPostedPurchase);
  const postedReceipts = scopedReceipts.filter((rec) => {
    if (rec.postingStatus === "draft" || rec.postingStatus === "failed" || rec.postingStatus === "reversed") return false;
    return isPostedReceipt(rec);
  });
  const postedPayments = scopedPayments.filter(isPostedPayment);
  const postedSalesReturns = scopedSalesReturns.filter(isPostedSalesReturn);
  const postedCreditNotes = scopedCreditNotes.filter(isPostedCreditNote);

  // 2. Filter documents by active Financial Year window if provided
  const fyInvoices = postedInvoices.filter((inv) => {
    if (financialYearStart && inv.date < financialYearStart) return false;
    if (financialYearEnd && inv.date > financialYearEnd) return false;
    return true;
  });

  const fyPurchases = postedPurchases.filter((pu) => {
    if (financialYearStart && pu.date < financialYearStart) return false;
    if (financialYearEnd && pu.date > financialYearEnd) return false;
    return true;
  });

  const fyReceipts = postedReceipts.filter((rec) => {
    if (financialYearStart && rec.date < financialYearStart) return false;
    if (financialYearEnd && rec.date > financialYearEnd) return false;
    return true;
  });

  const fyPayments = postedPayments.filter((pay) => {
    if (financialYearStart && pay.date < financialYearStart) return false;
    if (financialYearEnd && pay.date > financialYearEnd) return false;
    return true;
  });

  const fySalesReturns = postedSalesReturns.filter((ret) => {
    if (financialYearStart && ret.date < financialYearStart) return false;
    if (financialYearEnd && ret.date > financialYearEnd) return false;
    return true;
  });

  // Receipts breakdown by payment mode
  const totalAmountReceived = fyReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const receivedByPaymentMode = {
    cash: 0,
    bank: 0,
    upi: 0,
    cheque: 0,
    card: 0,
    other: 0,
  };

  for (const r of fyReceipts) {
    const m = (r.mode || (r.paymentMethod as string) || "other").toLowerCase();
    if (m === "cash") receivedByPaymentMode.cash += r.amount;
    else if (m === "bank" || m === "transfer" || m === "neft" || m === "rtgs" || m === "imps" || m === "bank_transfer") receivedByPaymentMode.bank += r.amount;
    else if (m === "upi") receivedByPaymentMode.upi += r.amount;
    else if (m === "cheque" || m === "check") receivedByPaymentMode.cheque += r.amount;
    else if (m === "card" || m === "debit" || m === "credit") receivedByPaymentMode.card += r.amount;
    else receivedByPaymentMode.other += r.amount;
  }

  // Supplier payments breakdown by payment mode
  const totalPaymentsMade = fyPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const paidByPaymentMode = {
    cash: 0,
    bank: 0,
    upi: 0,
    cheque: 0,
    card: 0,
    other: 0,
  };

  for (const p of fyPayments) {
    const m = (p.mode || (p.paymentMethod as string) || "other").toLowerCase();
    if (m === "cash") paidByPaymentMode.cash += p.amount;
    else if (m === "bank" || m === "transfer" || m === "neft" || m === "rtgs" || m === "imps" || m === "bank_transfer") paidByPaymentMode.bank += p.amount;
    else if (m === "upi") paidByPaymentMode.upi += p.amount;
    else if (m === "cheque" || m === "check") paidByPaymentMode.cheque += p.amount;
    else if (m === "card" || m === "debit" || m === "credit") paidByPaymentMode.card += p.amount;
    else paidByPaymentMode.other += p.amount;
  }

  // 3. Canonical Revenue & Billed Metrics
  // Total Billed Sales = sum of POSTED invoice grand totals only
  const grossBilledSales = fyInvoices.reduce((sum, inv) => sum + (inv.grandTotal ?? (inv as any).total ?? 0), 0);
  const totalSalesReturns = fySalesReturns.reduce((sum, r) => sum + (r.grandTotal || 0), 0);
  const returnsTaxable = fySalesReturns.reduce((sum, r) => sum + (r.taxableAmount || 0), 0);
  const returnsGst = fySalesReturns.reduce((sum, r) => sum + (r.gstTotal || 0), 0);
  const returnsCgst = fySalesReturns.reduce((sum, r) => sum + (r.cgstTotal || 0), 0);
  const returnsSgst = fySalesReturns.reduce((sum, r) => sum + (r.sgstTotal || 0), 0);
  const returnsIgst = fySalesReturns.reduce((sum, r) => sum + (r.igstTotal || 0), 0);

  const netBilledValue = grossBilledSales - totalSalesReturns;

  // Canonical Net Sales Revenue = Posted Sales Revenue excluding Output GST - Taxable portion of posted Credit Notes
  const grossTaxableRevenue = fyInvoices.reduce((sum, inv) => sum + ((inv.subtotal || 0) - ((inv as any).discountTotal || 0)), 0);
  const netSalesRevenue = grossTaxableRevenue - returnsTaxable;
  const totalSales = grossBilledSales;
  const netSales = netSalesRevenue;
  const totalPurchases = fyPurchases.reduce((sum, pu) => sum + (pu.grandTotal ?? (pu as any).total ?? 0), 0);

  // 4. Authoritative Bill-Wise Settlements & Reconciliations
  // Compute bill-wise remaining balance for every posted invoice using posted receipts & sales returns
  const invoiceSettlements = fyInvoices.map((inv) =>
    resolveCanonicalInvoiceOutstanding(inv, fyReceipts, fySalesReturns, postedCreditNotes)
  );

  // Compute bill-wise remaining balance for every posted purchase using posted payments
  const purchaseSettlements = fyPurchases.map((pu) =>
    resolveCanonicalPurchaseOutstanding(pu, fyPayments)
  );

  // Derive authoritative Customer Credits (overpayments, unallocated receipts, credit note excesses)
  const customerCreditCalc = calculateAuthoritativeCustomerCredits({
    receipts: fyReceipts,
    salesReturns: fySalesReturns,
    creditNotes: postedCreditNotes,
    invoices: fyInvoices,
    branchId: isBranchScoped ? targetBranchId : undefined,
  });

  let totalReceivables = 0;
  let totalCustomerCredits = customerCreditCalc.totalCustomerCredits;
  let totalPayables = 0;
  let cashInHand = 0;
  let bankBalance = 0;
  let totalLiquidity = 0;

  // Liquid sums
  const totalCashReceived = receivedByPaymentMode.cash;
  const totalBankEquivReceived = totalAmountReceived - totalCashReceived;
  const totalCashPaid = paidByPaymentMode.cash;
  const totalBankEquivPaid = totalPaymentsMade - totalCashPaid;

  if (isBranchScoped) {
    // STRICT BRANCH SCOPE: Zero organization-wide AR/AP/Cash leakage
    totalReceivables = invoiceSettlements.reduce((sum, s) => sum + s.remainingBalance, 0);
    totalPayables = purchaseSettlements.reduce((sum, s) => sum + s.remainingBalance, 0);

    cashInHand = Math.max(0, totalCashReceived - totalCashPaid);
    bankBalance = Math.max(0, totalBankEquivReceived - totalBankEquivPaid);
    totalLiquidity = Math.max(0, totalAmountReceived - totalPaymentsMade);
  } else {
    // CONSOLIDATED SCOPE: Authoritative double-entry ledger balances across all branches
    const cashLedgers = ledgers.filter(
      (l) => l.groupId === "grp_cash" || l.groupId === "grp_cash_equiv" || l.name.toLowerCase().includes("cash")
    );
    const bankLedgers = ledgers.filter(
      (l) => l.groupId === "grp_bank" || l.name.toLowerCase().includes("bank")
    );
    const cashPaise = cashLedgers.reduce((sum, l) => sum + (l.currentBalance || 0), 0);
    const bankPaise = bankLedgers.reduce((sum, l) => sum + (l.currentBalance || 0), 0);

    const receivableLedgers = ledgers.filter(
      (l) => l.partyType === "customer" || l.groupId === "grp_sundry_debtors"
    );
    const payableLedgers = ledgers.filter(
      (l) => l.partyType === "supplier" || l.groupId === "grp_sundry_creditors"
    );

    if (receivableLedgers.length > 0) {
      let debtorDr = 0;
      let debtorCr = 0;
      for (const l of receivableLedgers) {
        const bal = (l.currentBalance || 0) / 100;
        if (bal > 0) debtorDr += bal;
        else if (bal < 0) debtorCr += Math.abs(bal);
      }
      totalReceivables = debtorDr;
      if (debtorCr > 0) totalCustomerCredits = debtorCr;
    } else {
      totalReceivables = invoiceSettlements.reduce((sum, s) => sum + s.remainingBalance, 0);
    }

    if (payableLedgers.length > 0) {
      totalPayables = payableLedgers.reduce((sum, l) => sum + Math.max(0, -Math.min(0, (l.currentBalance || 0) / 100)), 0);
    } else {
      totalPayables = purchaseSettlements.reduce((sum, s) => sum + s.remainingBalance, 0);
    }

    if (cashPaise !== 0 || bankPaise !== 0) {
      cashInHand = cashPaise / 100;
      bankBalance = bankPaise / 100;
      totalLiquidity = (cashPaise + bankPaise) / 100;
    } else {
      cashInHand = Math.max(0, totalCashReceived - totalCashPaid);
      bankBalance = Math.max(0, totalBankEquivReceived - totalBankEquivPaid);
      totalLiquidity = Math.max(0, totalAmountReceived - totalPaymentsMade);
    }
  }

  // 5. Authoritative Cost of Goods Sold (COGS) & Inventory Stock Valuation
  const valuationMethod = inventoryValuationMethod || "purchase_cost";
  let grossCogs = 0;
  let returnedCogs = 0;
  let restockedStockValue = 0;
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
      grossCogs += unitCost * (item.quantity || 0);
    }
  }

  // Deduct COGS for restocked returned goods (PRD § 10)
  for (const ret of fySalesReturns) {
    for (const item of ret.items || []) {
      const prod = products.find((p) => p.id === item.productId);
      const unitCost = prod
        ? valuationMethod === "standard_cost"
          ? ((prod as any).defaultPurchaseRatePaise ? (prod as any).defaultPurchaseRatePaise / 100 : 0)
          : (prod.purchasePrice || 0)
        : 0;
      const isRestocked =
        item.restockAction === "RESTOCK_SALEABLE" ||
        item.restockAction === "RESTOCK_DAMAGED" ||
        (ret as any).disposition === "RESTOCK_SALEABLE" ||
        (ret as any).disposition === "RESTOCK_DAMAGED";
      if (isRestocked) {
        const qty = item.returnQuantity !== undefined ? item.returnQuantity : (((item as any).quantity as number) || 1);
        const restockVal = unitCost * qty;
        returnedCogs += restockVal;
        restockedStockValue += restockVal;
      }
    }
  }

  const costOfGoodsSold = Math.max(0, grossCogs - returnedCogs);

  // Operating Expenses from ledgers
  const expenseLedgers = ledgers.filter(
    (l) => l.groupNature === "expense" && l.groupId !== "grp_direct_expenses"
  );
  const operatingExpensesPaise = expenseLedgers.reduce((sum, l) => sum + Math.max(0, (l.currentBalance || 0)), 0);
  const operatingExpenses = operatingExpensesPaise / 100;

  const grossProfit = netSalesRevenue - costOfGoodsSold;
  const netProfit = grossProfit - operatingExpenses;

  // 6. Inventory Stock Value and Low Stock Alerts
  let baseStockValue = 0;
  let lowStockCount = 0;
  for (const p of products) {
    if (p.trackInventory !== false) {
      const unitValuation =
        valuationMethod === "standard_cost"
          ? ((p as any).defaultPurchaseRatePaise ? (p as any).defaultPurchaseRatePaise / 100 : 0)
          : (p.purchasePrice || 0);
      baseStockValue += (p.currentStock || 0) * unitValuation;
      if ((p.currentStock || 0) <= (p.reorderLevel || 0)) {
        lowStockCount++;
      }
    }
  }
  const stockValue = baseStockValue + restockedStockValue;

  // 7. Authoritative GST Breakdown (Net Output GST after Credit Notes, Input GST, Net GST Position)
  const grossOutputGst = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).totalTax, 0);
  const outputGst = Math.max(0, grossOutputGst - returnsGst);
  const inputGst = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).totalTax, 0);
  const netGst = outputGst - inputGst;

  const grossCgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).cgst, 0);
  const grossSgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).sgst, 0);
  const grossIgstOutput = fyInvoices.reduce((s, i) => s + resolveDocumentTaxes(i).igst, 0);

  const cgstOutput = Math.max(0, grossCgstOutput - returnsCgst);
  const sgstOutput = Math.max(0, grossSgstOutput - returnsSgst);
  const igstOutput = Math.max(0, grossIgstOutput - returnsIgst);

  const cgstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).cgst, 0);
  const sgstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).sgst, 0);
  const igstInput = fyPurchases.reduce((s, p) => s + resolveDocumentTaxes(p).igst, 0);

  // 8. Monthly Trend Series (Last 6 Months using canonical posted net revenue and procurement)
  const now = new Date();
  const trendMonths = computeMonthlyTrend({
    invoices: fyInvoices,
    purchases: fyPurchases,
    referenceDate: now,
    financialYearStart,
    financialYearEnd,
  });

  // 9. Authoritative Receivables Aging Buckets (Remaining uncollected dues on posted invoices only)
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  let rec0_30 = 0;
  let rec31_60 = 0;
  let rec61_90 = 0;
  let rec90Plus = 0;

  for (const s of invoiceSettlements) {
    if (s.remainingBalance > 0) {
      const inv = fyInvoices.find((i) => i.id === s.invoiceId);
      if (inv) {
        const ageDays = Math.floor((nowMs - inv.date) / dayMs);
        if (ageDays <= 30) rec0_30 += s.remainingBalance;
        else if (ageDays <= 60) rec31_60 += s.remainingBalance;
        else if (ageDays <= 90) rec61_90 += s.remainingBalance;
        else rec90Plus += s.remainingBalance;
      }
    }
  }

  const agingReceivables = [
    { range: "0–30 Days", amount: rec0_30 },
    { range: "31–60 Days", amount: rec31_60 },
    { range: "61–90 Days", amount: rec61_90 },
    { range: "90+ Days", amount: rec90Plus },
  ];

  // 10. Authoritative Payables Aging Buckets
  let pay0_30 = 0;
  let pay31_60 = 0;
  let pay61_90 = 0;
  let pay90Plus = 0;

  for (const s of purchaseSettlements) {
    if (s.remainingBalance > 0) {
      const pu = fyPurchases.find((p) => p.id === s.purchaseId);
      if (pu) {
        const ageDays = Math.floor((nowMs - pu.date) / dayMs);
        if (ageDays <= 30) pay0_30 += s.remainingBalance;
        else if (ageDays <= 60) pay31_60 += s.remainingBalance;
        else if (ageDays <= 90) pay61_90 += s.remainingBalance;
        else pay90Plus += s.remainingBalance;
      }
    }
  }

  const agingPayables = [
    { range: "0–30 Days", amount: pay0_30 },
    { range: "31–60 Days", amount: pay31_60 },
    { range: "61–90 Days", amount: pay61_90 },
    { range: "90+ Days", amount: pay90Plus },
  ];

  // 11. Consolidated Branch Metrics Breakdown
  const branchMetrics = branches.length > 0
    ? branches.map((b) => {
        const bInvs = allInvoices.filter((inv) => inv.branchId === b.id && isPostedInvoice(inv));
        const bRets = allSalesReturns.filter(
          (ret) => ret.branchId === b.id && isPostedSalesReturn(ret)
        );
        const bPurs = allPurchases.filter((pu) => pu.branchId === b.id && isPostedPurchase(pu));
        const bRecs = allReceipts.filter(
          (rec) => rec.branchId === b.id && isPostedReceipt(rec)
        );

        const bSales = bInvs.reduce((s, i) => s + (i.grandTotal ?? (i as any).total ?? 0), 0);
        const bReturnsVal = bRets.reduce((s, r) => s + (r.grandTotal ?? (r as any).total ?? 0), 0);
        const bPurchasesVal = bPurs.reduce((s, p) => s + (p.grandTotal ?? (p as any).total ?? 0), 0);
        const bCollections = bRecs.reduce((s, r) => s + (r.amount || 0), 0);
        const bReceivables = bInvs.reduce((s, i) => s + resolveCanonicalInvoiceOutstanding(i, bRecs, bRets).remainingBalance, 0);

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

  // Invoke automated developer diagnostics (PRD Section 8 & 21)
  logDashboardDiagnostics({
    scope: effectiveScope,
    invoices: {
      totalScanned: allInvoices.length,
      scopedCount: fyInvoices.length,
      scopedSum: grossBilledSales,
      excludedDueToBranch: isBranchScoped ? allInvoices.filter((i) => i.branchId !== targetBranchId).length : 0,
      excludedDueToDate: scopedInvoices.filter(isPostedInvoice).length - fyInvoices.length,
      excludedDueToStatus: scopedInvoices.filter((i) => !isPostedInvoice(i)).length,
    },
    receipts: {
      totalScanned: allReceipts.length,
      scopedCount: fyReceipts.length,
      scopedSum: totalAmountReceived,
      excludedDueToBranch: isBranchScoped ? allReceipts.filter((r) => r.branchId !== targetBranchId).length : 0,
      excludedDueToStatus: scopedReceipts.filter((r) => !isPostedReceipt(r)).length,
    },
    purchases: {
      totalScanned: allPurchases.length,
      scopedCount: fyPurchases.length,
      scopedSum: totalPurchases,
      excludedDueToBranch: isBranchScoped ? allPurchases.filter((p) => p.branchId !== targetBranchId).length : 0,
      excludedDueToDate: scopedPurchases.filter(isPostedPurchase).length - fyPurchases.length,
      excludedDueToStatus: scopedPurchases.filter((p) => !isPostedPurchase(p)).length,
    },
    payments: {
      totalScanned: allPayments.length,
      scopedCount: fyPayments.length,
      scopedSum: totalPaymentsMade,
      excludedDueToBranch: isBranchScoped ? allPayments.filter((p) => (p as any).branchId !== targetBranchId).length : 0,
      excludedDueToStatus: scopedPayments.filter((p) => !isPostedPayment(p)).length,
    },
    salesReturns: {
      totalScanned: allSalesReturns.length,
      scopedCount: fySalesReturns.length,
      scopedSum: totalSalesReturns,
      excludedDueToBranch: isBranchScoped ? allSalesReturns.filter((r) => r.branchId !== targetBranchId).length : 0,
    },
    arReconciled: totalReceivables,
    apReconciled: totalPayables,
    cashBankReconciled: totalLiquidity,
  });

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
    cashInHand,
    bankBalance,
    totalLiquidity,
    grossProfit,
    netProfit,
    netSalesRevenue,
    costOfGoodsSold,
    isCostingIncomplete,
    stockValue,
    lowStockCount,
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
    agingPayables,
    branchMetrics,
    hasData,
  };
}
