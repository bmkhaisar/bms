/**
 * Centralized Money Utility for BMS NEXT Accounting Engine.
 * 
 * All internal financial calculations, balances, debits, credits, and totals
 * must strictly operate in integer paise (1 INR = 100 paise) to prevent floating-point drift.
 */

export type MoneyPaise = number;

export const PAISE_PER_RUPEE = 100;
export const MAX_SAFE_MONEY_PAISE = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991 paise (~90 trillion INR)

/**
 * Validates that a value is a safe integer monetary quantity.
 */
export function isSafeMoney(value: unknown): value is MoneyPaise {
  return typeof value === "number" && Number.isSafeInteger(value) && !isNaN(value) && isFinite(value);
}

/**
 * Converts a rupee number or string safely to integer paise.
 * Throws an error if resulting value is not a safe integer.
 */
export function toPaise(rupees: number | string | null | undefined): MoneyPaise {
  if (rupees === null || rupees === undefined || rupees === "") return 0;
  const num = typeof rupees === "string" ? parseFloat(rupees) : rupees;
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid monetary amount: '${rupees}'. Must be a valid finite number.`);
  }
  const paise = Math.round(num * PAISE_PER_RUPEE);
  if (!isSafeMoney(paise)) {
    throw new Error(`Monetary overflow: '${rupees}' exceeds safe integer monetary range.`);
  }
  return paise;
}

/**
 * Converts integer paise back to fractional rupees for display/export.
 */
export function fromPaise(paise: MoneyPaise): number {
  if (!isSafeMoney(paise)) return 0;
  return paise / PAISE_PER_RUPEE;
}

/**
 * Formats integer paise into standard Indian currency representation (e.g. "₹1,250.50").
 */
export function formatPaise(paise: MoneyPaise | null | undefined): string {
  if (paise === null || paise === undefined || !isSafeMoney(paise)) {
    return "₹0.00";
  }
  const rupees = fromPaise(paise);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Integer paise addition with overflow protection.
 */
export function addMoney(a: MoneyPaise, b: MoneyPaise): MoneyPaise {
  const sum = a + b;
  if (!isSafeMoney(sum)) {
    throw new Error(`Monetary overflow during addition: ${a} + ${b}`);
  }
  return sum;
}

/**
 * Integer paise subtraction with overflow protection.
 */
export function subtractMoney(a: MoneyPaise, b: MoneyPaise): MoneyPaise {
  const diff = a - b;
  if (!isSafeMoney(diff)) {
    throw new Error(`Monetary overflow during subtraction: ${a} - ${b}`);
  }
  return diff;
}
