import type { Quotation } from "../../lib/db";

/** Convert Firebase arrays, including numeric-key RTDB objects, into real arrays. */
export function normalizeFirebaseArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value as Record<string, T>);
  return [];
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRows<T extends Record<string, unknown>>(value: unknown): T[] {
  return normalizeFirebaseArray<T>(value).map((section) => ({
    ...section,
    rows: normalizeFirebaseArray(section?.rows),
  }));
}

function normalizeTermSections(value: unknown): unknown[] {
  return normalizeFirebaseArray<Record<string, unknown>>(value).map((section) =>
    section && typeof section === "object" && "items" in section
      ? { ...section, items: normalizeFirebaseArray(section.items) }
      : section,
  );
}

/** Canonical defensive boundary for legacy quotation records from Firebase/Dexie. */
export function normalizeQuotationRecord(input: unknown): Quotation {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const createdAt = finiteNumber(source.createdAt, Date.now());
  const allowedStatuses = new Set<Quotation["status"]>([
    "draft", "sent", "accepted", "converted", "rejected", "cancelled", "voided", "deleted",
  ]);
  const status = allowedStatuses.has(source.status as Quotation["status"])
    ? source.status as Quotation["status"]
    : "draft";

  return {
    ...source,
    id: String(source.id || ""),
    number: String(source.number || ""),
    customerId: String(source.customerId || ""),
    date: finiteNumber(source.date, createdAt),
    createdAt,
    subtotal: finiteNumber(source.subtotal),
    discountTotal: finiteNumber(source.discountTotal),
    gstTotal: finiteNumber(source.gstTotal),
    roundOff: finiteNumber(source.roundOff),
    grandTotal: finiteNumber(source.grandTotal),
    status,
    items: normalizeFirebaseArray(source.items),
    lineSnapshots: normalizeFirebaseArray(source.lineSnapshots),
    extraCharges: normalizeFirebaseArray(source.extraCharges),
    termsSnapshot: normalizeFirebaseArray(source.termsSnapshot),
    structuredTerms: normalizeFirebaseArray(source.structuredTerms),
    structuredTermsSnapshot: normalizeTermSections(source.structuredTermsSnapshot),
    generalInfoSnapshot: normalizeFirebaseArray(source.generalInfoSnapshot),
    generalInformationSnapshot: normalizeFirebaseArray(source.generalInformationSnapshot),
    techSpecSnapshot: normalizeRows(source.techSpecSnapshot),
    electricalSnapshot: normalizeRows(source.electricalSnapshot),
    technicalSpecificationSnapshot: normalizeRows(source.technicalSpecificationSnapshot),
    structuredSections: normalizeRows(source.structuredSections),
  } as unknown as Quotation;
}
