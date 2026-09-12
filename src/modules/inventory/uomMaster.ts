/**
 * BMS NEXT — UOM (Unit of Measurement) Master & Dimension Engine
 * Comprehensive built-in units, custom UOM management, decimal precision, and standard conversions.
 */

export interface UomDefinition {
  id: string;
  name: string;
  code: string;
  precision: number;
  category: "count" | "area" | "length" | "weight" | "volume" | "time" | "custom";
  isBuiltIn: boolean;
}

export const BUILT_IN_UOMS: UomDefinition[] = [
  // Count
  { id: "uom_nos", name: "Numbers", code: "NOS", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_pcs", name: "Pieces", code: "PCS", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_box", name: "Box", code: "BOX", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_set", name: "Set", code: "SET", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_pair", name: "Pair", code: "PAIR", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_sheet", name: "Sheet", code: "SHEET", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_roll", name: "Roll", code: "ROLL", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_bundle", name: "Bundle", code: "BUNDLE", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_bag", name: "Bag", code: "BAG", precision: 0, category: "count", isBuiltIn: true },

  // Area
  { id: "uom_sqft", name: "Square Feet", code: "SQFT", precision: 2, category: "area", isBuiltIn: true },
  { id: "uom_sqm", name: "Square Meters", code: "SQM", precision: 2, category: "area", isBuiltIn: true },

  // Length
  { id: "uom_ft", name: "Feet", code: "FT", precision: 2, category: "length", isBuiltIn: true },
  { id: "uom_m", name: "Meters", code: "M", precision: 2, category: "length", isBuiltIn: true },
  { id: "uom_in", name: "Inches", code: "IN", precision: 2, category: "length", isBuiltIn: true },
  { id: "uom_mm", name: "Millimeters", code: "MM", precision: 0, category: "length", isBuiltIn: true },

  // Weight
  { id: "uom_kg", name: "Kilograms", code: "KG", precision: 3, category: "weight", isBuiltIn: true },
  { id: "uom_g", name: "Grams", code: "G", precision: 2, category: "weight", isBuiltIn: true },
  { id: "uom_ton", name: "Metric Tons", code: "TON", precision: 3, category: "weight", isBuiltIn: true },

  // Volume
  { id: "uom_l", name: "Litres", code: "L", precision: 2, category: "volume", isBuiltIn: true },
  { id: "uom_ml", name: "Millilitres", code: "ML", precision: 0, category: "volume", isBuiltIn: true },

  // Time / Service
  { id: "uom_hr", name: "Hours", code: "HR", precision: 1, category: "time", isBuiltIn: true },
  { id: "uom_day", name: "Days", code: "DAY", precision: 0, category: "time", isBuiltIn: true },
  { id: "uom_job", name: "Job", code: "JOB", precision: 0, category: "count", isBuiltIn: true },
  { id: "uom_service", name: "Service", code: "SERVICE", precision: 0, category: "count", isBuiltIn: true },
];

const CUSTOM_UOMS_STORAGE_KEY = "bms_custom_uoms_v1";

export function getCustomUoms(): UomDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_UOMS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomUom(uom: { name: string; code: string; precision?: number }): UomDefinition {
  const code = uom.code.trim().toUpperCase();
  const name = uom.name.trim();
  const precision = typeof uom.precision === "number" ? Math.max(0, Math.min(4, uom.precision)) : 2;

  // Check if exists in built-in
  const existingBuiltIn = BUILT_IN_UOMS.find(
    (u) => u.code.toLowerCase() === code.toLowerCase() || u.name.toLowerCase() === name.toLowerCase()
  );
  if (existingBuiltIn) return existingBuiltIn;

  const current = getCustomUoms();
  const existingCustom = current.find(
    (u) => u.code.toLowerCase() === code.toLowerCase() || u.name.toLowerCase() === name.toLowerCase()
  );
  if (existingCustom) return existingCustom;

  const newUom: UomDefinition = {
    id: `uom_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    code,
    precision,
    category: "custom",
    isBuiltIn: false,
  };

  current.push(newUom);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CUSTOM_UOMS_STORAGE_KEY, JSON.stringify(current));
    } catch {}
  }
  return newUom;
}

export function getAllUoms(): UomDefinition[] {
  return [...BUILT_IN_UOMS, ...getCustomUoms()];
}

export function findUom(codeOrName: string): UomDefinition | undefined {
  if (!codeOrName) return undefined;
  const target = codeOrName.trim().toLowerCase();
  return getAllUoms().find(
    (u) => u.code.toLowerCase() === target || u.name.toLowerCase() === target || u.id.toLowerCase() === target
  );
}

export function getUomPrecision(unitCodeOrName?: string): number {
  if (!unitCodeOrName) return 2;
  const match = findUom(unitCodeOrName);
  return match ? match.precision : 2;
}

export function formatQuantityWithUom(qty: number, unit?: string): string {
  const precision = getUomPrecision(unit);
  const formatted = precision === 0 ? Math.round(qty).toString() : qty.toFixed(precision);
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Standard Approved Conversions between compatible dimensions
 */
export function convertUnit(val: number, fromUnit: string, toUnit: string): number | null {
  const f = fromUnit.trim().toUpperCase();
  const t = toUnit.trim().toUpperCase();
  if (f === t) return val;

  // Length conversions
  if ((f === "M" || f === "METER" || f === "METERS") && (t === "FT" || t === "FEET")) {
    return val * 3.28084;
  }
  if ((f === "FT" || f === "FEET") && (t === "M" || t === "METER" || t === "METERS")) {
    return val / 3.28084;
  }

  // Area conversions
  if ((f === "SQM" || f === "SQ M") && (t === "SQFT" || t === "SQ FT")) {
    return val * 10.7639;
  }
  if ((f === "SQFT" || f === "SQ FT") && (t === "SQM" || t === "SQ M")) {
    return val / 10.7639;
  }

  // Weight conversions
  if ((f === "KG" || f === "KILOGRAMS") && (t === "G" || t === "GRAMS")) {
    return val * 1000;
  }
  if ((f === "G" || f === "GRAMS") && (t === "KG" || t === "KILOGRAMS")) {
    return val / 1000;
  }
  if ((f === "TON" || f === "TONS") && (t === "KG" || t === "KILOGRAMS")) {
    return val * 1000;
  }
  if ((f === "KG" || f === "KILOGRAMS") && (t === "TON" || t === "TONS")) {
    return val / 1000;
  }

  return null; // Non-convertible
}
