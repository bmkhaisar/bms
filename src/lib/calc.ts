import { db, type LineItem } from "./db";
import {
  calculateDocumentTaxes,
  computeTaxLine,
  computeTaxCharge,
  toPaise,
  toRupees,
  determineInterState,
  normalizeStateCode,
} from "@/modules/tax/taxEngine";
import type { TaxTotals, TaxCalculationParams, ComputedTaxLine } from "@/modules/tax/types";

export {
  calculateDocumentTaxes,
  computeTaxLine,
  computeTaxCharge,
  toPaise,
  toRupees,
  determineInterState,
  normalizeStateCode,
};
export type { TaxTotals, TaxCalculationParams, ComputedTaxLine };

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLine(item: Partial<LineItem>): LineItem {
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  const discountPct = Number(item.discountPct) || 0;
  const gstRate = Number(item.gstRate) || 0;

  // Use paise precision
  const grossPaise = Math.round(quantity * Math.round(rate * 100));
  const discountPaise = Math.round((grossPaise * discountPct) / 100);
  const taxablePaise = Math.max(0, grossPaise - discountPaise);
  const gstPaise = gstRate > 0 ? Math.round((taxablePaise * gstRate) / 100) : 0;
  const totalPaise = taxablePaise + gstPaise;

  return {
    productId: item.productId || "",
    name: item.name || "",
    hsn: item.hsn,
    size: item.size,
    description: item.description,
    quantity,
    unit: item.unit || "pcs",
    rate,
    discountPct,
    gstRate,
    taxable: round2(taxablePaise / 100),
    gstAmount: round2(gstPaise / 100),
    total: round2(totalPaise / 100),
  };
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  gstTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
}

export function computeTotals(
  items: LineItem[],
  isIgst = false,
  options?: {
    enableGst?: boolean;
    extraCharges?: Array<{ name: string; amount: number; taxable?: boolean; gstRate?: number }>;
  }
): Totals {
  const calculated = calculateDocumentTaxes({
    items: items.map((it) => ({
      productId: it.productId,
      name: it.name,
      hsn: it.hsn,
      quantity: it.quantity,
      unit: it.unit,
      rate: it.rate,
      discountValue: it.discountPct,
      discountType: "percentage",
      gstRate: it.gstRate,
    })),
    extraCharges: options?.extraCharges?.map((c) => ({
      name: c.name,
      amount: c.amount,
      taxable: c.taxable,
      gstRate: c.gstRate,
    })),
    isInterState: isIgst,
    enableGst: options?.enableGst ?? true,
  });

  return {
    subtotal: calculated.subtotal,
    discountTotal: calculated.totalDiscount,
    gstTotal: calculated.gstTotal,
    cgstTotal: calculated.cgstTotal,
    sgstTotal: calculated.sgstTotal,
    igstTotal: calculated.igstTotal,
    roundOff: calculated.roundOff,
    grandTotal: calculated.grandTotal,
  };
}

export async function applyStockDelta(items: LineItem[], sign: 1 | -1): Promise<void> {
  await db().transaction("rw", db().products, async () => {
    for (const it of items) {
      if (!it.productId) continue;
      const p = await db().products.get(it.productId);
      if (!p) continue;
      // Invariant: Stock OUT/IN must only occur for inventory-tracked products.
      // Omit services, non-stock charges, freight-only lines.
      if (p.trackInventory === false) continue;
      p.currentStock = round2(p.currentStock + sign * it.quantity);
      await db().products.put(p);
    }
  });
}
