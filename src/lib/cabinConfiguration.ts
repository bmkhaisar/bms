import type { LineItem, SizeSnapshot, GeneralInfoField } from "./db.ts";
import { extractTableRowsFromMarkdown } from "./markdownDoc.ts";

/**
 * Checks if a General Information row corresponds to "Configuration of Cabins".
 * Multi-company ERP rule: Only dynamically resolve cabin configurations for companies/rows
 * that have configured this field. (User Correction #5)
 */
export function isCabinConfigurationRow(labelOrKey?: string): boolean {
  if (!labelOrKey) return false;
  const clean = labelOrKey.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  return (
    clean === "configuration of cabins" ||
    clean === "configuration of cabin" ||
    clean === "cabin configuration" ||
    clean === "cabins configuration" ||
    clean === "cabin configurations"
  );
}

/**
 * Formats a single size dimension into professional Cabin specification:
 * e.g. "Cabin 40'L × 10'W × 8.5'H"
 */
export function formatCabinDimension(size?: SizeSnapshot | string): string {
  if (!size) return "";

  if (typeof size === "object") {
    const { length, width, height, label, dimensionString } = size as any;
    if (length !== undefined && width !== undefined && height !== undefined) {
      return `Cabin ${length}'L × ${width}'W × ${height}'H`;
    }
    if (dimensionString) {
      return formatCabinDimensionString(dimensionString);
    }
    if (label) {
      return formatCabinDimensionString(label);
    }
    return "";
  }

  return formatCabinDimensionString(size);
}

function formatCabinDimensionString(raw: string): string {
  const clean = raw.trim();
  if (!clean) return "";

  // If already formatted like "Cabin 40'L × 10'W × 8.5'H"
  if (/^cabin\b/i.test(clean) && /['"]?[LWH]/i.test(clean)) {
    return clean;
  }

  // Look for 3 dimension numbers e.g. 40'x10'x8.5' or 40 x 10 x 8.5 or 40' × 10' × 8.5'
  const match = clean.match(/(\d+(?:\.\d+)?)\s*['’]?(?:L|length)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*['’]?(?:W|width)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*['’]?(?:H|height)?/i);
  if (match) {
    const [, l, w, h] = match;
    return `Cabin ${l}'L × ${w}'W × ${h}'H`;
  }

  // Fallback: prefix with "Cabin " if not present
  if (/^cabin\b/i.test(clean)) {
    return clean;
  }
  return `Cabin ${clean}`;
}

/**
 * Derives the bulleted "Configuration of Cabins" from document item sizes.
 * Deduplicates identical configurations preserving order (PRD § 12).
 */
export function buildCabinConfigurationFromItems(items: LineItem[]): string {
  if (!items || items.length === 0) return "";

  const formattedSizes: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const sizeVal = item.sizeSnapshot || item.size;
    if (!sizeVal) continue;

    const formatted = formatCabinDimension(sizeVal);
    if (!formatted) continue;

    const norm = formatted.toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(norm)) {
      seen.add(norm);
      formattedSizes.push(formatted);
    }
  }

  if (formattedSizes.length === 0) return "";
  return formattedSizes.map((s) => `• ${s}`).join("\n");
}

export interface ResolveGeneralInfoParams {
  companyFields?: GeneralInfoField[];
  companyMarkdown?: string;
  items?: LineItem[];
  documentOverride?: GeneralInfoField[];
  cabinOverride?: string;
  isCabinConfigCustom?: boolean;
  isIssuedOrFrozen?: boolean;
  frozenSnapshot?: GeneralInfoField[];
}

/**
 * Resolves the structured General Information rows following PRD § 15 & Correction #3, #5, #8:
 * - ISSUED/FROZEN: strictly use frozenSnapshot if present.
 * - DRAFT: Company Settings structure + dynamic Configuration of Cabins (if row exists) + document-specific overrides.
 */
export function resolveGeneralInfoFields(params: ResolveGeneralInfoParams): GeneralInfoField[] {
  const {
    companyFields = [],
    companyMarkdown,
    items = [],
    documentOverride,
    cabinOverride,
    isCabinConfigCustom,
    isIssuedOrFrozen,
    frozenSnapshot,
  } = params;

  // 1. Issued/Frozen documents never re-read Company Settings
  if (isIssuedOrFrozen && frozenSnapshot && frozenSnapshot.length > 0) {
    return frozenSnapshot.map((f) => ({ ...f }));
  }

  // 2. Draft document: Start with document override fields if available, otherwise company settings
  let baseFields: GeneralInfoField[] = documentOverride && documentOverride.length > 0
    ? documentOverride
    : companyFields;

  if ((!baseFields || baseFields.length === 0) && companyMarkdown && companyMarkdown.trim()) {
    const rawRows = extractTableRowsFromMarkdown(companyMarkdown);
    if (rawRows.length > 0) {
      baseFields = rawRows.map(r => ({ label: r.label, value: r.value }));
    }
  }

  if (!baseFields || baseFields.length === 0) {
    // If company settings had no fields, check if items have sizes and if we should provide a default Configuration row
    const derivedCabins = buildCabinConfigurationFromItems(items);
    if (derivedCabins) {
      return [
        {
          key: "configuration_of_cabins",
          label: "Configuration of Cabins",
          value: isCabinConfigCustom && cabinOverride !== undefined ? cabinOverride : derivedCabins,
        },
      ];
    }
    return [];
  }

  return baseFields.map((field) => {
    if (isCabinConfigurationRow(field.label || field.key)) {
      if (isCabinConfigCustom && cabinOverride !== undefined) {
        return { ...field, value: cabinOverride };
      }
      const derivedCabins = buildCabinConfigurationFromItems(items);
      return {
        ...field,
        value: derivedCabins || field.value,
      };
    }
    return { ...field };
  });
}
