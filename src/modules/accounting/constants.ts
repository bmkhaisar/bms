import type { VoucherType } from "./types";

export const PAISE_PER_RUPEE = 100;

/**
 * Converts a rupee amount (e.g. 1250.50) safely to integer paise (125050).
 */
export function rupeesToPaise(rupees: number | null | undefined): number {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/**
 * Converts integer paise back to rupees (e.g. 125050 -> 1250.50).
 */
export function paiseToRupees(paise: number | null | undefined): number {
  if (paise === null || paise === undefined || isNaN(paise)) return 0;
  return paise / PAISE_PER_RUPEE;
}

/**
 * Formats integer paise into Indian currency representation (e.g. "₹1,250.50").
 */
export function formatPaise(paise: number | null | undefined): string {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  journal: "Journal Voucher",
  payment: "Payment Voucher",
  receipt: "Receipt Voucher",
  contra: "Contra Voucher",
};

export const VOUCHER_PREFIXES: Record<VoucherType, string> = {
  journal: "JV",
  payment: "PAY",
  receipt: "REC",
  contra: "CON",
};
