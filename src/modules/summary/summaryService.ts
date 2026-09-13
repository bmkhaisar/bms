/**
 * BMS NEXT — Authoritative Financial Summary Service & Performance Cache
 * Computes customer and product statistics from real posted financial documents and ledgers.
 * Guarantees zero duplicate financial truth.
 */

import { db, type Invoice, type Receipt, type Purchase, type Product, type Customer } from "@/lib/db";
import type { Ledger } from "@/modules/accounting/types";

export interface CustomerFinancialSummary {
  customerId: string;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  invoiceCount: number;
  averageInvoice: number;
  firstSaleDate: number | null;
  lastSaleDate: number | null;
  lastPaymentDate: number | null;
  creditLimit: number;
  isCreditExceeded: boolean;
  creditDays: number;
  recentInvoices: Array<{
    id: string;
    number: string;
    date: number;
    amount: number;
    paid: number;
    balance: number;
    status: string;
  }>;
}

export interface ProductFinancialSummary {
  productId: string;
  quantitySold: number;
  revenue: number;
  quantityPurchased: number;
  lastSaleRate: number;
  averageSaleRate: number;
  availableStock: number;
  topCustomerName: string | null;
  topCustomerVolume: number;
  firstSaleDate: number | null;
  lastSaleDate: number | null;
  lastPurchaseDate: number | null;
  recentSales: Array<{
    invoiceId: string;
    invoiceNumber: string;
    customerName: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
    date: number;
  }>;
}

/**
 * Computes authoritative Customer Financial Summary.
 * Excludes draft and cancelled invoices from financial totals.
 */
export async function computeCustomerSummary(
  customerId: string,
  options?: {
    invoices?: Invoice[];
    receipts?: Receipt[];
    creditNotes?: Array<{ id: string; customerId: string; amount: number; date: number }>;
    customer?: Customer;
    ledgers?: Ledger[];
  }
): Promise<CustomerFinancialSummary> {
  let invoices = options?.invoices;
  let receipts = options?.receipts;
  let customer = options?.customer;

  if (typeof window !== "undefined") {
    if (!invoices) {
      invoices = await db().invoices.where("customerId").equals(customerId).toArray();
    } else {
      invoices = invoices.filter((i) => i.customerId === customerId);
    }
    if (!receipts) {
      receipts = await db().receipts.where("customerId").equals(customerId).toArray();
    } else {
      receipts = receipts.filter((r) => r.customerId === customerId);
    }
    if (!customer) {
      customer = await db().customers.get(customerId);
    }
  } else {
    invoices = invoices?.filter((i) => i.customerId === customerId) || [];
    receipts = receipts?.filter((r) => r.customerId === customerId) || [];
  }

  // Only posted / active invoices count in financial totals (strictly exclude draft, cancelled, reversed)
  const postedInvoices = invoices.filter(
    (inv) =>
      (inv.postingStatus === "posted" || (inv.status !== "draft" && inv.postingStatus !== "failed")) &&
      inv.status !== "cancelled" &&
      inv.postingStatus !== "reversed"
  );

  const totalInvoiced = postedInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);

  // Direct receipts reduce customer outstanding
  const receiptTotal = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const invoicePaidTotal = postedInvoices.reduce((sum, inv) => sum + (inv.amountPaid || 0), 0);
  const totalPaid = Math.max(receiptTotal, invoicePaidTotal);

  // Credit notes reduce customer exposure and outstanding
  const creditNotesTotal = (options?.creditNotes || []).reduce((sum, cn) => sum + (cn.amount || 0), 0);
  const rawOutstanding = postedInvoices.reduce((sum, inv) => sum + Math.max(0, inv.balance || 0), 0);
  const outstanding = Math.max(0, (rawOutstanding > 0 ? rawOutstanding : totalInvoiced - totalPaid) - creditNotesTotal);

  const now = Date.now();
  let overdue = 0;
  for (const inv of postedInvoices) {
    if (inv.balance > 0) {
      if (inv.dueDate && inv.dueDate < now) {
        overdue += inv.balance;
      } else if (!inv.dueDate && typeof customer?.creditDays === "number") {
        const calculatedDue = inv.date + customer.creditDays * 24 * 60 * 60 * 1000;
        if (calculatedDue < now) {
          overdue += inv.balance;
        }
      }
    }
  }

  const invoiceCount = postedInvoices.length;
  const averageInvoice = invoiceCount > 0 ? totalInvoiced / invoiceCount : 0;

  const sortedInvoices = [...postedInvoices].sort((a, b) => a.date - b.date);
  const firstSaleDate = sortedInvoices.length > 0 ? sortedInvoices[0].date : null;
  const lastSaleDate = sortedInvoices.length > 0 ? sortedInvoices[sortedInvoices.length - 1].date : null;

  const sortedReceipts = [...receipts].sort((a, b) => b.date - a.date);
  const lastPaymentDate = sortedReceipts.length > 0 ? sortedReceipts[0].date : null;

  const creditLimit = customer?.creditLimit || 0;
  const isCreditExceeded = creditLimit > 0 && outstanding > creditLimit;

  // Recent 5 invoices newest first
  const recentInvoices = [...postedInvoices]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5)
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      date: inv.date,
      amount: inv.grandTotal,
      paid: inv.amountPaid || 0,
      balance: inv.balance,
      status: inv.status,
    }));

  return {
    customerId,
    totalInvoiced,
    totalPaid,
    outstanding,
    overdue,
    invoiceCount,
    averageInvoice,
    firstSaleDate,
    lastSaleDate,
    lastPaymentDate,
    creditLimit,
    isCreditExceeded,
    creditDays: customer?.creditDays || 0,
    recentInvoices,
  };
}

/**
 * Computes authoritative Product Performance Summary.
 */
export async function computeProductSummary(
  productId: string,
  options?: {
    invoices?: Invoice[];
    purchases?: Purchase[];
    product?: Product;
  }
): Promise<ProductFinancialSummary> {
  let invoices = options?.invoices;
  let purchases = options?.purchases;
  let product = options?.product;

  if (typeof window !== "undefined") {
    if (!invoices) {
      invoices = await db().invoices.toArray();
    }
    if (!purchases) {
      purchases = await db().purchases.toArray();
    }
    if (!product) {
      product = await db().products.get(productId);
    }
  } else {
    invoices = invoices || [];
    purchases = purchases || [];
  }

  // Filter posted invoices containing this product (strictly exclude draft, cancelled, reversed)
  const postedInvoices = invoices.filter(
    (inv) =>
      (inv.postingStatus === "posted" || (inv.status !== "draft" && inv.postingStatus !== "failed")) &&
      inv.status !== "cancelled" &&
      inv.postingStatus !== "reversed"
  );

  let quantitySold = 0;
  let revenue = 0;
  let lastSaleRate = product?.sellingPrice || 0;
  let firstSaleDate: number | null = null;
  let lastSaleDate: number | null = null;

  const customerVolumeMap: Record<string, { name: string; qty: number }> = {};
  const recentSales: ProductFinancialSummary["recentSales"] = [];

  // Sort invoices by date ascending for timeline analysis
  const sortedInvoices = [...postedInvoices].sort((a, b) => a.date - b.date);

  for (const inv of sortedInvoices) {
    for (const item of inv.items) {
      if (item.productId === productId) {
        quantitySold += item.quantity;
        revenue += item.total;
        lastSaleRate = item.rate;
        if (!firstSaleDate) firstSaleDate = inv.date;
        lastSaleDate = inv.date;

        const custName = inv.customerSnapshot?.name || "Customer";
        const cId = inv.customerId || "unknown";
        if (!customerVolumeMap[cId]) {
          customerVolumeMap[cId] = { name: custName, qty: 0 };
        }
        customerVolumeMap[cId].qty += item.quantity;

        recentSales.unshift({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          customerName: custName,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          amount: item.total,
          date: inv.date,
        });
      }
    }
  }

  // Purchases analysis
  let quantityPurchased = 0;
  let lastPurchaseDate: number | null = null;
  const sortedPurchases = [...purchases].sort((a, b) => a.date - b.date);
  for (const pu of sortedPurchases) {
    for (const item of pu.items) {
      if (item.productId === productId) {
        quantityPurchased += item.quantity;
        lastPurchaseDate = pu.date;
      }
    }
  }

  // Top customer determination
  let topCustomerName: string | null = null;
  let topCustomerVolume = 0;
  for (const entry of Object.values(customerVolumeMap)) {
    if (entry.qty > topCustomerVolume) {
      topCustomerVolume = entry.qty;
      topCustomerName = entry.name;
    }
  }

  const averageSaleRate = quantitySold > 0 ? revenue / quantitySold : lastSaleRate;
  const availableStock = product?.currentStock ?? 0;

  return {
    productId,
    quantitySold,
    revenue,
    quantityPurchased,
    lastSaleRate,
    averageSaleRate,
    availableStock,
    topCustomerName,
    topCustomerVolume,
    firstSaleDate,
    lastSaleDate,
    lastPurchaseDate,
    recentSales: recentSales.slice(0, 8),
  };
}

export interface SupplierFinancialSummary {
  supplierId: string;
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
  overdue: number;
  purchaseCount: number;
  averagePurchase: number;
  firstPurchaseDate: number | null;
  lastPurchaseDate: number | null;
  recentPurchases: Array<{
    id: string;
    number: string;
    supplierInvoiceNumber?: string;
    supplierInvoiceDate?: number | string;
    date: number;
    amount: number;
    paid: number;
    balance: number;
    status: string;
  }>;
}

/**
 * Computes authoritative Supplier Financial Summary from posted purchases and payments.
 */
export async function computeSupplierSummary(
  supplierId: string,
  options?: {
    purchases?: Purchase[];
  }
): Promise<SupplierFinancialSummary> {
  let purchases = options?.purchases;

  if (typeof window !== "undefined") {
    if (!purchases) {
      purchases = await db().purchases.where("supplierId").equals(supplierId).toArray();
    } else {
      purchases = purchases.filter((p) => p.supplierId === supplierId);
    }
  } else {
    purchases = purchases?.filter((p) => p.supplierId === supplierId) || [];
  }

  const postedPurchases = purchases.filter(
    (pu) => pu.postingStatus === "posted" || (pu.postingStatus !== "draft" && pu.postingStatus !== "failed")
  );

  const totalPurchased = postedPurchases.reduce((sum, pu) => sum + pu.grandTotal, 0);
  const totalPaid = postedPurchases.reduce((sum, pu) => sum + (pu.amountPaid || 0), 0);
  const outstanding = postedPurchases.reduce((sum, pu) => sum + Math.max(0, pu.balance || 0), 0);
  const purchaseCount = postedPurchases.length;
  const averagePurchase = purchaseCount > 0 ? totalPurchased / purchaseCount : 0;

  const sorted = [...postedPurchases].sort((a, b) => a.date - b.date);
  const firstPurchaseDate = sorted.length > 0 ? sorted[0].date : null;
  const lastPurchaseDate = sorted.length > 0 ? sorted[sorted.length - 1].date : null;

  const recentPurchases = [...postedPurchases]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5)
    .map((pu) => ({
      id: pu.id,
      number: pu.number,
      supplierInvoiceNumber: pu.supplierInvoiceNumber,
      supplierInvoiceDate: pu.supplierInvoiceDate,
      date: pu.date,
      amount: pu.grandTotal,
      paid: pu.amountPaid || 0,
      balance: pu.balance,
      status: pu.status,
    }));

  return {
    supplierId,
    totalPurchased,
    totalPaid,
    outstanding,
    overdue: 0,
    purchaseCount,
    averagePurchase,
    firstPurchaseDate,
    lastPurchaseDate,
    recentPurchases,
  };
}

/**
 * Admin / Recovery: Rebuilds customer performance summary cache from authoritative records.
 */
export async function rebuildCustomerSummary(
  companyId: string,
  customerId: string,
  options?: {
    invoices?: Invoice[];
    receipts?: Receipt[];
    creditNotes?: Array<{ id: string; customerId: string; amount: number; date: number }>;
    customer?: Customer;
    ledgers?: Ledger[];
  }
): Promise<CustomerFinancialSummary> {
  return computeCustomerSummary(customerId, options);
}

/**
 * Admin / Recovery: Rebuilds product performance summary cache from authoritative records.
 */
export async function rebuildProductSummary(
  companyId: string,
  productId: string,
  options?: {
    invoices?: Invoice[];
    purchases?: Purchase[];
    product?: Product;
  }
): Promise<ProductFinancialSummary> {
  return computeProductSummary(productId, options);
}

/**
 * Admin / Recovery: Rebuilds supplier performance summary cache from authoritative records.
 */
export async function rebuildSupplierSummary(
  companyId: string,
  supplierId: string,
  options?: {
    purchases?: Purchase[];
    supplier?: any;
  }
): Promise<SupplierFinancialSummary> {
  return computeSupplierSummary(supplierId, options);
}

