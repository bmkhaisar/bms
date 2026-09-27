import type { LineItem, Product, SizeSnapshot } from "./db";

/**
 * Standardize dimension string presentation into clean, professional format.
 * E.g. "20' x 10' x 8.5'" -> "20' × 10' × 8.5'"
 * E.g. "20x10" -> "20' × 10'"
 */
export function formatDisplaySize(raw?: string | SizeSnapshot | null): string {
  if (!raw) return "";

  if (typeof raw === "object") {
    const { label, length, width, height, unit } = raw;
    if (label && label.trim()) {
      return formatDisplaySize(label);
    }
    if (length !== undefined && width !== undefined) {
      const u = unit ? ` ${unit}` : "'";
      if (height !== undefined) {
        return `${length}${u} × ${width}${u} × ${height}${u}`;
      }
      return `${length}${u} × ${width}${u}`;
    }
    return "";
  }

  const clean = raw.trim().replace(/\s+/g, " ");
  if (!clean || clean === "-" || clean === "—" || clean === "–" || clean.toLowerCase() === "n/a" || clean === "null" || clean === "undefined") {
    return "";
  }

  // 3-dimension pattern with units or quotes: 40' x 10' x 8.5' or 40 x 10 x 8.5 or 40'L x 10'W x 8.5'H
  const match3D = clean.match(/^(\d+(?:\.\d+)?)\s*['’]?(?:ft|feet|foot|m|mtr)?\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*['’]?(?:ft|feet|foot|m|mtr)?\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*['’]?(?:ft|feet|foot|m|mtr)?$/i);
  if (match3D) {
    const [, l, w, h] = match3D;
    const hasMetric = /\b(?:m|mtr|meter|metre|cm|mm)\b/i.test(clean);
    const unitMark = hasMetric ? " m" : "'";
    return `${l}${unitMark} × ${w}${unitMark} × ${h}${unitMark}`;
  }

  // 2-dimension pattern: 20' x 10' or 20x10 or 20 x 10
  const match2D = clean.match(/^(\d+(?:\.\d+)?)\s*['’]?(?:ft|feet|foot|m|mtr)?\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*['’]?(?:ft|feet|foot|m|mtr)?$/i);
  if (match2D) {
    const [, l, w] = match2D;
    const hasMetric = /\b(?:m|mtr|meter|metre|cm|mm)\b/i.test(clean);
    const unitMark = hasMetric ? " m" : "'";
    return `${l}${unitMark} × ${w}${unitMark}`;
  }

  // Replace raw 'x' or '*' between dimension numbers with proper ' × '
  return clean
    .replace(/(\d+)\s*[xX*]\s*(\d+)/g, "$1 × $2")
    .replace(/(\d+)\s*['’]\s*[xX*]\s*(\d+)/g, "$1' × $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts legitimate dimension patterns from item name, description, or specifications.
 * E.g. "cabin 20x10" -> "20' × 10'"
 * E.g. "Office Cabin 40' x 10' x 8.5' with MDF" -> "40' × 10' × 8.5'"
 * E.g. "Plywood 8x4" -> "8' × 4'"
 * E.g. "Labour Charge" -> null
 */
export function extractDimensionFromString(text?: string | null): string | null {
  if (!text || typeof text !== "string") return null;

  // Look for 3-dimension pattern e.g. 40' x 10' x 8.5' or 40x10x8.5 or 40' × 10' × 8.5' or 1200 x 2400 x 10 mm
  const match3 = text.match(/\b(\d+(?:\.\d+)?)\s*(['’]|ft|feet|foot|m|mtr|meter|cm|mm|in|inch)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(['’]|ft|feet|foot|m|mtr|meter|cm|mm|in|inch)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(['’]|ft|feet|foot|m|mtr|meter|cm|mm|in|inch)?\b/i);
  if (match3) {
    const [, l, u1, w, u2, h, u3] = match3;
    const unit = (u3 || u2 || u1 || "").toLowerCase();
    if (unit === "mm" || unit === "cm" || unit === "m" || unit === "mtr" || unit === "meter") {
      return `${l} × ${w} × ${h} ${unit}`;
    }
    return `${l}' × ${w}' × ${h}'`;
  }

  // Look for 2-dimension pattern e.g. 20' x 10' or 20x10 or 20*10 or 1200 x 2400 mm
  const match2 = text.match(/\b(\d+(?:\.\d+)?)\s*(['’]|ft|feet|foot|m|mtr|meter|cm|mm|in|inch)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(['’]|ft|feet|foot|m|mtr|meter|cm|mm|in|inch)?\b/i);
  if (match2) {
    const [, l, u1, w, u2] = match2;
    const unit = (u2 || u1 || "").toLowerCase();
    if (unit === "mm" || unit === "cm" || unit === "m" || unit === "mtr" || unit === "meter") {
      return `${l} × ${w} ${unit}`;
    }
    return `${l}' × ${w}'`;
  }

  return null;
}

/**
 * Parses a size string or snapshot into a full structured SizeSnapshot.
 */
export function parseSizeSnapshot(labelOrSnapshot: string | SizeSnapshot): SizeSnapshot {
  if (!labelOrSnapshot) {
    return { label: "" };
  }

  if (typeof labelOrSnapshot === "object") {
    const s = labelOrSnapshot;
    return {
      label: formatDisplaySize(s.label || "") || (s.length && s.width ? `${s.length}' × ${s.width}'` : ""),
      length: s.length,
      width: s.width,
      height: s.height,
      unit: s.unit || "FT",
    };
  }

  const clean = labelOrSnapshot.trim().replace(/\s+/g, " ");
  const matches = Array.from(clean.matchAll(/(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
  const unitMatch = clean.match(/\b(ft|feet|foot|in|inch|inches|m|meter|metre|cm|mm)\b/i);
  const formatted = formatDisplaySize(clean) || clean;

  return {
    label: formatted,
    length: matches[0],
    width: matches[1],
    height: matches[2],
    unit: unitMatch?.[1]?.toUpperCase() || "FT",
  };
}

/**
 * Resolves the legitimate size for a line item across all potential storage locations:
 * 1. item.size
 * 2. item.sizeSnapshot.label
 * 3. item.measurementSummary
 * 4. item.measurements dimensions
 * 5. Dimension extracted from item.name or item.description
 * 6. Fallback from linked product defaultSizes or name
 *
 * Returns "" if no legitimate size exists (never invents missing dimensions).
 */
export function resolveItemSize(
  item?: Partial<LineItem> | null,
  fallbackProduct?: Partial<Product> | null
): string {
  if (!item) return "";

  // 1. Check explicit item.size
  if (item.size) {
    const formatted = formatDisplaySize(item.size);
    if (formatted) return formatted;
  }

  // 2. Check item.sizeSnapshot
  if (item.sizeSnapshot) {
    const fromSnapshot = formatDisplaySize(item.sizeSnapshot);
    if (fromSnapshot) return fromSnapshot;
  }

  // 2b. Check embedded itemSnapshot or lineSnapshot
  const embeddedSnap = (item as any)?.itemSnapshot || (item as any)?.lineSnapshot;
  if (embeddedSnap) {
    if (embeddedSnap.size) {
      const fromSnapSize = formatDisplaySize(embeddedSnap.size);
      if (fromSnapSize) return fromSnapSize;
    }
    if (embeddedSnap.sizeSnapshot) {
      const fromSnapObj = formatDisplaySize(embeddedSnap.sizeSnapshot);
      if (fromSnapObj) return fromSnapObj;
    }
  }

  // 3. Check item.measurementSummary (e.g. "20 FT × 10 FT = 200 SQFT")
  if (item.measurementSummary && typeof item.measurementSummary === "string") {
    const dimMatch = extractDimensionFromString(item.measurementSummary);
    if (dimMatch) return dimMatch;
    const cleanSummary = formatDisplaySize(item.measurementSummary);
    if (cleanSummary) return cleanSummary;
  }

  // 4. Check item.measurements entries
  if (Array.isArray(item.measurements) && item.measurements.length > 0) {
    const m = item.measurements[0];
    if (m && m.width && m.height) {
      return formatDisplaySize(`${m.width}' × ${m.height}'`);
    }
  }

  // 5. Check item name or description for legitimate dimensions
  const fromName = extractDimensionFromString(item.name || item.productName || item.productNameSnapshot);
  if (fromName) return fromName;

  const fromDesc = extractDimensionFromString(item.description || item.descriptionSnapshot);
  if (fromDesc) return fromDesc;

  // 6. Check fallback product if provided
  if (fallbackProduct) {
    if (Array.isArray(fallbackProduct.defaultSizes) && fallbackProduct.defaultSizes.length > 0) {
      const fromProdDefault = formatDisplaySize(fallbackProduct.defaultSizes[0]);
      if (fromProdDefault) return fromProdDefault;
    }
    const fromProdName = extractDimensionFromString(fallbackProduct.name);
    if (fromProdName) return fromProdName;
    const fromProdSpecs = extractDimensionFromString(fallbackProduct.specifications || fallbackProduct.description);
    if (fromProdSpecs) return fromProdSpecs;
  }

  return "";
}

/**
 * Returns formatted size string for PDF / Print / Preview rendering.
 * Never returns "-" or empty when a legitimate size exists.
 * Returns "—" only when the item legitimately has no dimensions.
 */
export function resolvePdfDisplaySize(
  item?: Partial<LineItem> | null,
  fallbackProduct?: Partial<Product> | null
): string {
  const size = resolveItemSize(item, fallbackProduct);
  return size && size.trim() ? size.trim() : "—";
}
