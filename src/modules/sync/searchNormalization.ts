/**
 * BMS NEXT — Semantic Field-Specific Search Normalization & Tenant-Scoped Duplicate Intelligence
 * 
 * Strict Semantic Normalizers:
 * - Name (Party/Product): lowercase, trim, collapse multiple spaces, normalize punctuation dots/commas
 * - GSTIN: uppercase, trim, alphanumeric canonical 15-char format
 * - Phone: digits only, strips country code prefix (+91 / 0) for uniform 10-digit comparison
 * - SKU: uppercase, trim, collapses spaces, PRESERVES meaningful '-' and '/' characters (e.g. A-10 !== A10)
 * - HSN/SAC: digits only (2 to 8 digits canonical)
 * - Email: lowercase, trim
 * 
 * Tenant Isolation: All duplicate detection is strictly scoped to the active companyId.
 */

import type { Customer, Product, Supplier } from "@/lib/db";

/**
 * Normalizes party or product names:
 * Lowercases, trims, collapses spaces, normalizes punctuation.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[._,()\[\]{}:;'"+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes GSTIN to canonical 15-character uppercase format.
 */
export function normalizeGstin(gstin: string | null | undefined): string {
  if (!gstin) return "";
  return String(gstin).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Normalizes phone numbers: digits only, removes leading 0 or 91 country code for Indian numbers.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Normalizes SKU:
 * Case-insensitive & trimmed, collapses spaces, but PRESERVES '-' and '/' characters.
 * Guarantees A-10 does not collide with A10 or A/10.
 */
export function normalizeSku(sku: string | null | undefined): string {
  if (!sku) return "";
  return String(sku)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes HSN/SAC codes to canonical numeric string.
 */
export function normalizeHsn(hsn: string | null | undefined): string {
  if (!hsn) return "";
  return String(hsn).trim().replace(/\D/g, "");
}

/**
 * Normalizes email: lowercases and trims.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return "";
  return String(email).trim().toLowerCase();
}

/**
 * Generic search token normalizer for general query text.
 */
export function normalizeSearchToken(text: string | null | undefined): string {
  return normalizeName(text);
}

/**
 * Case-insensitive, punctuation-resilient search matcher.
 */
export function matchesQuery(fieldValue: string | null | undefined, query: string): boolean {
  if (!fieldValue || !query) return false;
  const normField = normalizeName(fieldValue);
  const normQuery = normalizeName(query);
  if (!normQuery) return false;

  if (normField.includes(normQuery)) return true;

  const compactField = normField.replace(/\s+/g, "");
  const compactQuery = normQuery.replace(/\s+/g, "");
  if (compactField.includes(compactQuery)) return true;

  const queryTokens = normQuery.split(" ").filter(Boolean);
  return queryTokens.every((qt) => normField.includes(qt));
}

export interface DuplicateMatch<T> {
  isDuplicate: boolean;
  matchType?: "gstin" | "phone" | "email" | "name" | "sku" | "alias";
  matchedItem?: T;
  severity: "critical" | "warning" | "info";
  message?: string;
}

/**
 * Customer Duplicate Detection (Strictly Company Scoped)
 */
export function detectCustomerDuplicates(
  candidate: Partial<Customer>,
  existingCustomers: Customer[],
  companyId?: string,
  ignoreId?: string
): DuplicateMatch<Customer> {
  const normCandName = normalizeName(candidate.name);
  const normCandGstin = normalizeGstin(candidate.gstin);
  const normCandPhone = normalizePhone(candidate.mobile || candidate.phone);
  const normCandEmail = normalizeEmail(candidate.email);

  for (const existing of existingCustomers) {
    if (ignoreId && existing.id === ignoreId) continue;
    // Strict company scoping if customer records have companyId
    if (companyId && (existing as any).companyId && (existing as any).companyId !== companyId) {
      continue;
    }

    // 1. Exact GSTIN match within company (Critical)
    if (normCandGstin && existing.gstin && normalizeGstin(existing.gstin) === normCandGstin) {
      return {
        isDuplicate: true,
        matchType: "gstin",
        matchedItem: existing,
        severity: "critical",
        message: `Customer "${existing.name}" already registered with exact GSTIN: ${existing.gstin}.`,
      };
    }

    // 2. Exact Phone match (Warning)
    const existPhone = normalizePhone(existing.mobile || existing.phone);
    if (normCandPhone && normCandPhone.length >= 10 && existPhone === normCandPhone) {
      return {
        isDuplicate: true,
        matchType: "phone",
        matchedItem: existing,
        severity: "warning",
        message: `Customer "${existing.name}" has the same phone number (${existing.mobile || existing.phone}).`,
      };
    }

    // 3. Exact Email match (Warning)
    if (normCandEmail && existing.email && normalizeEmail(existing.email) === normCandEmail) {
      return {
        isDuplicate: true,
        matchType: "email",
        matchedItem: existing,
        severity: "warning",
        message: `Customer "${existing.name}" has the same email address (${existing.email}).`,
      };
    }

    // 4. Normalized Name match (Info)
    const existName = normalizeName(existing.name);
    if (normCandName && (existName === normCandName || (normCandName.length > 4 && existName.includes(normCandName)))) {
      return {
        isDuplicate: true,
        matchType: "name",
        matchedItem: existing,
        severity: "info",
        message: `Similar customer name already exists in this company: "${existing.name}".`,
      };
    }
  }

  return { isDuplicate: false, severity: "info" };
}

/**
 * Product Duplicate Detection (Strictly Company Scoped)
 */
export function detectProductDuplicates(
  candidate: Partial<Product>,
  existingProducts: Product[],
  companyId?: string,
  ignoreId?: string
): DuplicateMatch<Product> {
  const normCandName = normalizeName(candidate.name);
  const normCandSku = normalizeSku(candidate.sku);
  const candidateAliases = (candidate.aliases || []).map((a) => normalizeName(a));

  for (const existing of existingProducts) {
    if (ignoreId && existing.id === ignoreId) continue;
    if (companyId && (existing as any).companyId && (existing as any).companyId !== companyId) {
      continue;
    }

    // 1. Exact SKU match (Critical)
    if (normCandSku && existing.sku && normalizeSku(existing.sku) === normCandSku) {
      return {
        isDuplicate: true,
        matchType: "sku",
        matchedItem: existing,
        severity: "critical",
        message: `Product "${existing.name}" already uses SKU: ${existing.sku}.`,
      };
    }

    // 2. Normalized Name match (Warning)
    const existName = normalizeName(existing.name);
    if (normCandName && existName === normCandName) {
      return {
        isDuplicate: true,
        matchType: "name",
        matchedItem: existing,
        severity: "warning",
        message: `A product named "${existing.name}" already exists in this company.`,
      };
    }

    // 3. Alias matches candidate name or candidate alias matches existing name
    const existingAliases = (existing.aliases || []).map((a) => normalizeName(a));
    if (existingAliases.includes(normCandName)) {
      return {
        isDuplicate: true,
        matchType: "alias",
        matchedItem: existing,
        severity: "info",
        message: `"${candidate.name}" is an alias for product "${existing.name}".`,
      };
    }

    for (const candAlias of candidateAliases) {
      if (candAlias && (candAlias === existName || existingAliases.includes(candAlias))) {
        return {
          isDuplicate: true,
          matchType: "alias",
          matchedItem: existing,
          severity: "info",
          message: `Alias "${candAlias}" overlaps with product "${existing.name}".`,
        };
      }
    }
  }

  return { isDuplicate: false, severity: "info" };
}
