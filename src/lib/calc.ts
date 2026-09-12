import { db, type LineItem } from "./db";

export function computeLine(item: Partial<LineItem>): LineItem {
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  const discountPct = Number(item.discountPct) || 0;
  const gstRate = Number(item.gstRate) || 0;
  const gross = quantity * rate;
  const discount = (gross * discountPct) / 100;
  const taxable = gross - discount;
  const gstAmount = (taxable * gstRate) / 100;
  const total = taxable + gstAmount;
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
    taxable: round2(taxable),
    gstAmount: round2(gstAmount),
    total: round2(total),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

export function computeTotals(items: LineItem[], isIgst = false): Totals {
  let subtotal = 0;
  let discountTotal = 0;
  let gstTotal = 0;
  for (const it of items) {
    const gross = it.quantity * it.rate;
    subtotal += gross;
    discountTotal += (gross * it.discountPct) / 100;
    gstTotal += it.gstAmount;
  }
  const beforeRound = subtotal - discountTotal + gstTotal;
  const grand = Math.round(beforeRound);
  const roundOff = round2(grand - beforeRound);
  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    gstTotal: round2(gstTotal),
    cgstTotal: isIgst ? 0 : round2(gstTotal / 2),
    sgstTotal: isIgst ? 0 : round2(gstTotal / 2),
    igstTotal: isIgst ? round2(gstTotal) : 0,
    roundOff,
    grandTotal: grand,
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
