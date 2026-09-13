export function formatMoney(n: number, symbol = "₹"): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = Math.abs(v).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "-" : ""}${symbol}${s}`;
}

export function formatNumber(n: number, digits = 2): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(ts: number | string | undefined): string {
  if (!ts) return "-";
  const d = typeof ts === "string" ? new Date(ts.includes("T") ? ts : ts + "T00:00:00") : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

export function todayTs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function toDateInput(ts: number | string | undefined): string {
  if (!ts) return "";
  const d = typeof ts === "string" ? new Date(ts.includes("T") ? ts : ts + "T00:00:00") : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function fromDateInput(v: string): number {
  return new Date(v + "T00:00:00").getTime();
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? " " + ONES[u] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (r) parts.push(twoDigits(r));
  return parts.join(" ");
}

export function numberToWordsIndian(num: number): string {
  if (!Number.isFinite(num)) return "";
  const negative = num < 0;
  num = Math.abs(num);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  let words = parts.join(" ").trim() + " Rupees";
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  return (negative ? "Minus " : "") + words + " Only";
}
