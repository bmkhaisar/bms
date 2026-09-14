import type { Database } from "firebase-admin/database";
import type { VoucherType } from "@/modules/accounting/types";
import { VOUCHER_PREFIXES } from "@/modules/accounting/constants";

export interface AllocateVoucherNumberResult {
  voucherNumber: string;
  sequenceNumber: number;
}

/**
 * Formats a full financial year string (e.g. "2026-2027" or "2026-27") into standard short representation (e.g. "2026-27").
 */
export function formatFyCode(fyName: string): string {
  if (!fyName) return "FY";
  const clean = fyName.trim();
  const match = clean.match(/^(\d{4})-(\d{2,4})$/);
  if (match) {
    const startYear = match[1];
    const endYear = match[2];
    const shortEnd = endYear.length === 4 ? endYear.slice(2) : endYear;
    return `${startYear}-${shortEnd}`;
  }
  return clean.replace(/\s+/g, "-");
}

/**
 * Concurrency-safe atomic voucher number allocator.
 * Allocates a sequential number using an atomic Firebase Realtime Database transaction.
 * 
 * Path: /companyData/{companyId}/docCounters/{financialYearId}/vouchers/{voucherType}
 * Format: {PREFIX}/{FY_CODE}/{000001}
 */
export async function allocateVoucherNumber(
  db: Database,
  companyId: string,
  financialYearId: string,
  fyName: string,
  voucherType: VoucherType
): Promise<AllocateVoucherNumberResult> {
  const counterRef = db.ref(
    `companyData/${companyId}/docCounters/${financialYearId}/vouchers/${voucherType}`
  );

  const txResult = await counterRef.transaction((currentValue) => {
    return (currentValue || 0) + 1;
  });

  if (!txResult.committed) {
    throw new Error(
      `Failed to allocate sequence number for voucher type '${voucherType}'. Concurrency contention.`
    );
  }

  const sequenceNumber = txResult.snapshot.val() as number;
  const prefix = VOUCHER_PREFIXES[voucherType] || "VCH";
  const fyCode = formatFyCode(fyName);
  const paddedNumber = String(sequenceNumber).padStart(6, "0");
  const voucherNumber = `${prefix}/${fyCode}/${paddedNumber}`;

  return {
    voucherNumber,
    sequenceNumber,
  };
}

export interface AllocateLegalDocNumberInput {
  companyId: string;
  financialYearId: string;
  docType: "invoice" | "quotation" | "receipt" | "purchase";
  fyName?: string;
  customPrefix?: string;
}

export async function allocatePartyBusinessCode(
  db: Database,
  params: { companyId: string; partyId: string; kind: "customer" | "supplier" }
): Promise<string> {
  const { companyId, partyId, kind } = params;
  const numberingRef = db.ref(`companyData/${companyId}/partyNumbering`);
  const txResult = await numberingRef.transaction((current: any) => {
    const state = current || {};
    if (state.assignments?.[partyId]) return state;
    const counterKey = kind === "customer" ? "customerCounter" : "supplierCounter";
    const prefix = kind === "customer" ? "CUS" : "SUP";
    const next = Number(state[counterKey] || 0) + 1;
    return {
      ...state,
      [counterKey]: next,
      assignments: {
        ...(state.assignments || {}),
        [partyId]: `${prefix}-${String(next).padStart(6, "0")}`,
      },
      updatedAt: Date.now(),
    };
  });
  if (!txResult.committed) throw new Error("Failed to allocate party business ID");
  const code = txResult.snapshot.val()?.assignments?.[partyId];
  if (!code) throw new Error("Party business ID allocation returned no code");
  return code;
}

export interface AllocateLegalDocNumberResult {
  documentNumber: string;
  sequenceNumber: number;
}

/**
 * Concurrency-safe atomic document number allocator for legal financial documents:
 * Invoices, Quotations, Receipts, Purchases.
 * Path: /companyData/{companyId}/docCounters/{financialYearId}/documents/{docType}
 */
export async function allocateLegalDocumentNumber(
  db: Database,
  params: AllocateLegalDocNumberInput
): Promise<AllocateLegalDocNumberResult> {
  const { companyId, financialYearId, docType, fyName = "FY", customPrefix } = params;
  const counterRef = db.ref(
    `companyData/${companyId}/docCounters/${financialYearId}/documents/${docType}`
  );

  const txResult = await counterRef.transaction((currentValue) => {
    return (currentValue || 0) + 1;
  });

  if (!txResult.committed) {
    throw new Error(
      `Failed to allocate sequence number for document type '${docType}'. Concurrency contention.`
    );
  }

  const sequenceNumber = txResult.snapshot.val() as number;
  const fyCode = formatFyCode(fyName);
  const defaultPrefixes: Record<string, string> = {
    invoice: "INV",
    quotation: "QT",
    receipt: "REC",
    purchase: "PO",
  };
  const prefix = (customPrefix && customPrefix.trim()) || defaultPrefixes[docType] || docType.toUpperCase();
  const paddedNumber = String(sequenceNumber).padStart(4, "0");
  const documentNumber = `${prefix}/${fyCode}/${paddedNumber}`;

  return {
    documentNumber,
    sequenceNumber,
  };
}
