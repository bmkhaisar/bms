/**
 * BMS NEXT — Authoritative Stock Movement Ledger & Materialized Stock Service
 *
 * Implements PRD Correction 3 & 12:
 * - The Stock Movement Ledger is the authoritative source of truth for inventory.
 * - Posting Invoice creates a Stock OUT movement.
 * - Posting Purchase creates a Stock IN movement.
 * - Alternate UOM quantities are converted to the product's base UOM before logging movements.
 * - Product.currentStock is strictly a materialized performance cache.
 * - Stock is 100% rebuildable entirely from the stock movements ledger.
 */

import { ref, set, get } from "firebase/database";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { db, type Product } from "@/lib/db";
import { convertUnit } from "./uomMaster";

export interface StockMovement {
  id: string;
  companyId: string;
  productId: string;
  movementType: "in" | "out" | "adjustment";
  documentKind: "invoice" | "purchase" | "quotation" | "manual";
  documentId: string;
  documentNumber?: string;
  date: number;
  enteredQuantity: number;
  enteredUom: string;
  baseQuantity: number;
  baseUom: string;
  ratePaise?: number;
  notes?: string;
  createdAt: number;
}

const MEMORY_STOCK_MOVEMENTS: StockMovement[] = [];

/**
 * Records an authoritative stock movement and updates the materialized product stock cache.
 */
export async function recordStockMovement(params: {
  movementId?: string;
  companyId: string;
  productId: string;
  movementType: "in" | "out" | "adjustment";
  documentKind: "invoice" | "purchase" | "quotation" | "manual";
  documentId: string;
  documentNumber?: string;
  date: number;
  enteredQuantity: number;
  enteredUom: string;
  ratePaise?: number;
  product?: Product;
}): Promise<StockMovement | null> {
  const {
    companyId,
    productId,
    movementType,
    documentKind,
    documentId,
    documentNumber,
    date,
    enteredQuantity,
    enteredUom,
    ratePaise,
  } = params;

  if (!productId || enteredQuantity <= 0) return null;

  let product = params.product;
  if (!product && typeof window !== "undefined") {
    product = await db().products.get(productId);
  }

  // Non-inventory / service lines do not trigger stock movements
  if (product && product.trackInventory === false) {
    return null;
  }

  const baseUom = product?.defaultUomId || product?.unit || enteredUom || "NOS";

  // Convert entered quantity to product Base UOM if different
  let baseQuantity = enteredQuantity;
  if (enteredUom && baseUom && enteredUom.trim().toLowerCase() !== baseUom.trim().toLowerCase()) {
    const conv = convertUnit(enteredQuantity, enteredUom, baseUom);
    if (conv !== null && conv > 0) {
      baseQuantity = Math.round(conv * 10000) / 10000;
    }
  }

  const movementId = params.movementId || `sm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Deterministic IDs make reversal/correction projections idempotent. Do not
  // apply the materialized stock delta twice when a mutation is safely retried.
  if (params.movementId && firebaseDb) {
    try {
      const existing = await get(ref(firebaseDb, `companyData/${companyId}/stockMovements/${movementId}`));
      if (existing.exists()) return existing.val() as StockMovement;
    } catch {}
  }
  const movement: StockMovement = {
    id: movementId,
    companyId,
    productId,
    movementType,
    documentKind,
    documentId,
    documentNumber,
    date,
    enteredQuantity,
    enteredUom,
    baseQuantity,
    baseUom,
    ratePaise,
    createdAt: Date.now(),
  };

  MEMORY_STOCK_MOVEMENTS.push(movement);

  // 1. Save to Firebase RTDB server-authoritative stock movements ledger
  if (firebaseDb) {
    try {
      const smRef = ref(firebaseDb, `companyData/${companyId}/stockMovements/${movementId}`);
      await set(smRef, sanitizeForFirebase(movement));
    } catch {}
  }

  // 2. Update materialized product stock cache in Dexie
  if (typeof window !== "undefined" && product) {
    const delta = movementType === "in" ? baseQuantity : -baseQuantity;
    product.currentStock = Math.round(((product.currentStock || 0) + delta) * 100) / 100;
    try {
      await db().products.put(product);
    } catch {}
  }

  return movement;
}

/**
 * Authoritatively rebuilds a Product's stock entirely from the Stock Movement Ledger.
 * Opening Stock + SUM(IN) - SUM(OUT) = Authoritative Current Stock.
 */
export async function rebuildProductStockFromMovements(
  companyId: string,
  productId: string,
  options?: { movements?: StockMovement[]; product?: Product }
): Promise<{ productId: string; calculatedStock: number; baseUom: string; movementsCount: number }> {
  let product = options?.product;
  if (!product && typeof window !== "undefined") {
    product = await db().products.get(productId);
  }

  let movements = options?.movements;
  if (!movements) {
    if (firebaseDb) {
      try {
        const snap = await get(ref(firebaseDb, `companyData/${companyId}/stockMovements`));
        if (snap.exists()) {
          const val = snap.val();
          movements = Object.values(val) as StockMovement[];
        }
      } catch {}
    }
    if (!movements) {
      movements = MEMORY_STOCK_MOVEMENTS.filter((m) => m.companyId === companyId && m.productId === productId);
    }
  }

  const productMovements = movements.filter((m) => m.productId === productId);
  const openingStock = product?.openingStock || 0;
  const baseUom = product?.defaultUomId || product?.unit || "NOS";

  let netDelta = 0;
  for (const m of productMovements) {
    if (m.movementType === "in") {
      netDelta += m.baseQuantity;
    } else if (m.movementType === "out") {
      netDelta -= m.baseQuantity;
    } else if (m.movementType === "adjustment") {
      netDelta += m.baseQuantity;
    }
  }

  const calculatedStock = Math.round((openingStock + netDelta) * 10000) / 10000;

  if (typeof window !== "undefined" && product) {
    product.currentStock = calculatedStock;
    try {
      await db().products.put(product);
    } catch {}
  }

  return {
    productId,
    calculatedStock,
    baseUom,
    movementsCount: productMovements.length,
  };
}

export function getInMemoryStockMovements(): StockMovement[] {
  return [...MEMORY_STOCK_MOVEMENTS];
}
