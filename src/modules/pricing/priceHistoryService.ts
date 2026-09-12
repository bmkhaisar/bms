/**
 * BMS NEXT — Price History & Customer-Specific Price Memory Service
 * Lightweight ledger of posted price points for pricing intelligence.
 * Includes partyType, partyId, UOM conversion support, and fallback waterfall.
 * Waterfall: Customer Last Rate (same/converted UOM) -> Last Selling Rate -> Standard Selling Rate
 */

import { db, type Product } from "@/lib/db";
import { convertUnit } from "@/modules/inventory/uomMaster";

export interface PriceHistoryEntry {
  id: string;
  companyId: string;
  productId: string;
  partyType: "customer" | "supplier" | "none";
  partyId?: string;
  customerId?: string; // Backwards compatible alias
  supplierId?: string; // Backwards compatible alias
  ratePaise: number;
  rate: number; // in rupees
  quantity: number;
  unit: string;
  uomId?: string;
  documentId: string;
  documentNumber: string;
  documentType: "invoice" | "quotation" | "purchase";
  date: number;
  createdAt: number;
}

const STORAGE_KEY = "bms_price_history_v1";

export function getPriceHistoryStore(): PriceHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function recordPriceHistoryEntry(entry: Omit<PriceHistoryEntry, "id" | "createdAt">): PriceHistoryEntry {
  const store = getPriceHistoryStore();
  const newEntry: PriceHistoryEntry = {
    ...entry,
    customerId: entry.partyType === "customer" ? entry.partyId : undefined,
    supplierId: entry.partyType === "supplier" ? entry.partyId : undefined,
    id: `ph_${entry.companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: Date.now(),
  };

  store.unshift(newEntry);
  if (store.length > 5000) {
    store.length = 5000;
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {}
  }
  return newEntry;
}

/**
 * Record posted invoice line items into price history
 */
export function recordInvoicePriceHistory(params: {
  companyId: string;
  customerId: string;
  invoiceId: string;
  invoiceNumber: string;
  date: number;
  items: Array<{ productId?: string; rate: number; quantity: number; unit: string; uomId?: string }>;
}): void {
  for (const it of params.items) {
    if (!it.productId || it.rate <= 0) continue;
    recordPriceHistoryEntry({
      companyId: params.companyId,
      productId: it.productId,
      partyType: "customer",
      partyId: params.customerId,
      customerId: params.customerId,
      ratePaise: Math.round(it.rate * 100),
      rate: it.rate,
      quantity: it.quantity,
      unit: it.unit || "NOS",
      uomId: it.uomId,
      documentId: params.invoiceId,
      documentNumber: params.invoiceNumber,
      documentType: "invoice",
      date: params.date,
    });
  }
}

/**
 * Record posted purchase bill line items into price history
 */
export function recordPurchasePriceHistory(params: {
  companyId: string;
  supplierId: string;
  purchaseId: string;
  purchaseNumber: string;
  date: number;
  items: Array<{ productId?: string; rate: number; quantity: number; unit: string; uomId?: string }>;
}): void {
  for (const it of params.items) {
    if (!it.productId || it.rate <= 0) continue;
    recordPriceHistoryEntry({
      companyId: params.companyId,
      productId: it.productId,
      partyType: "supplier",
      partyId: params.supplierId,
      supplierId: params.supplierId,
      ratePaise: Math.round(it.rate * 100),
      rate: it.rate,
      quantity: it.quantity,
      unit: it.unit || "NOS",
      uomId: it.uomId,
      documentId: params.purchaseId,
      documentNumber: params.purchaseNumber,
      documentType: "purchase",
      date: params.date,
    });
  }
}

export interface PricingIntelligence {
  standardRate: number;
  lastSoldRate: number | null;
  customerLastRate: number | null;
  recommendedRate: number;
  hasCustomerHistory: boolean;
  unit: string;
  isUomConverted?: boolean;
}

/**
 * Retrieves pricing intelligence for a Product + optional Customer + optional target UOM.
 * UOM-aware: Prefers exact UOM matches; if different UOM was used historically, converts rate.
 */
export async function getPricingIntelligence(params: {
  companyId: string;
  productId: string;
  customerId?: string;
  targetUnit?: string;
  product?: Product;
}): Promise<PricingIntelligence> {
  const { companyId, productId, customerId, targetUnit } = params;

  let product = params.product;
  if (!product && typeof window !== "undefined") {
    product = await db().products.get(productId);
  }

  const standardRate = product?.sellingPrice || (product?.defaultSalesRatePaise ? product.defaultSalesRatePaise / 100 : 0);
  const activeUnit = targetUnit || product?.unit || "NOS";

  const all = getPriceHistoryStore().filter(
    (h) => h.companyId === companyId && h.productId === productId && h.documentType === "invoice"
  );

  let lastSoldRate: number | null = null;
  if (all.length > 0) {
    // Check same unit first
    const sameUom = all.find((h) => h.unit.toLowerCase() === activeUnit.toLowerCase());
    if (sameUom) {
      lastSoldRate = sameUom.rate;
    } else {
      // Convert if compatible conversion exists
      const latest = all[0];
      const factor = convertUnit(1, latest.unit, activeUnit);
      if (factor !== null && factor > 0) {
        lastSoldRate = Math.round((latest.rate / factor) * 100) / 100;
      } else {
        lastSoldRate = latest.rate;
      }
    }
  } else if (product?.lastSalesRatePaise) {
    lastSoldRate = product.lastSalesRatePaise / 100;
  }

  let customerLastRate: number | null = null;
  let isUomConverted = false;

  if (customerId) {
    const custMatches = all.filter((h) => (h.partyId === customerId || h.customerId === customerId));
    if (custMatches.length > 0) {
      const sameUom = custMatches.find((h) => h.unit.toLowerCase() === activeUnit.toLowerCase());
      if (sameUom) {
        customerLastRate = sameUom.rate;
      } else {
        const latest = custMatches[0];
        const factor = convertUnit(1, latest.unit, activeUnit);
        if (factor !== null && factor > 0) {
          customerLastRate = Math.round((latest.rate / factor) * 100) / 100;
          isUomConverted = true;
        } else {
          customerLastRate = latest.rate;
        }
      }
    }
  }

  const recommendedRate = customerLastRate ?? lastSoldRate ?? standardRate;

  return {
    standardRate,
    lastSoldRate,
    customerLastRate,
    recommendedRate,
    hasCustomerHistory: customerLastRate !== null,
    unit: activeUnit,
    isUomConverted,
  };
}

export function getProductPriceHistory(productId: string, companyId?: string): PriceHistoryEntry[] {
  return getPriceHistoryStore().filter(
    (h) => h.productId === productId && (!companyId || h.companyId === companyId)
  );
}

export function getCustomerPriceHistory(customerId: string, companyId?: string): PriceHistoryEntry[] {
  return getPriceHistoryStore().filter(
    (h) => (h.partyId === customerId || h.customerId === customerId) && (!companyId || h.companyId === companyId)
  );
}
