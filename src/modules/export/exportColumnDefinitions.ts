import type { ExportColumnDefinition } from "./exportTypes.ts";
import { formatDate } from "../../lib/format.ts";

// ========================================================================
// 1. PRODUCT MASTER EXPORT DEFINITIONS (Section 6)
// ========================================================================
export const PRODUCT_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "code", header: "Product Code", width: 14 },
  { key: "name", header: "Product Name", width: 28 },
  { key: "description", header: "Description", width: 32 },
  { key: "category", header: "Category", width: 16 },
  {
    key: "type",
    header: "Product Type",
    width: 14,
    getter: (p) => p.type || "goods",
    formatForDisplay: (v) => String(v).toUpperCase(),
  },
  { key: "hsn", header: "HSN/SAC", width: 12 },
  {
    key: "gstRate",
    header: "GST Rate (%)",
    type: "number",
    width: 12,
    getter: (p) => p.gstRate ?? p.taxRate ?? 18,
  },
  { key: "unit", header: "Base UOM", width: 10 },
  { key: "alternateUnit", header: "Alternate UOM", width: 14 },
  {
    key: "sellingPrice",
    header: "Selling Rate (₹)",
    type: "currency",
    width: 16,
    getter: (p) => p.sellingPrice ?? p.price ?? 0,
  },
  {
    key: "purchasePrice",
    header: "Purchase/Cost Rate (₹)",
    type: "currency",
    width: 18,
    getter: (p) => p.purchasePrice ?? p.costPrice ?? 0,
  },
  {
    key: "openingStock",
    header: "Opening Stock",
    type: "number",
    width: 14,
    getter: (p) => p.openingStock ?? 0,
  },
  {
    key: "currentStock",
    header: "Current Stock",
    type: "number",
    width: 14,
    getter: (p) => p.currentStock ?? p.stock ?? 0,
  },
  {
    key: "minStock",
    header: "Reorder Level",
    type: "number",
    width: 14,
    getter: (p) => p.minStock ?? p.reorderLevel ?? 0,
  },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (p) => (p.active !== false ? "Active" : "Inactive"),
  },
];

// ========================================================================
// 2. PARTY MASTER EXPORT DEFINITIONS
// ========================================================================
export const PARTY_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "partyCode", header: "Party Code", width: 14 },
  { key: "name", header: "Party Name", width: 28 },
  {
    key: "partyType",
    header: "Type",
    width: 14,
    getter: (p) => p.partyType || (p.isCustomer && p.isSupplier ? "Both" : p.isCustomer ? "Customer" : "Supplier"),
  },
  { key: "gstin", header: "GSTIN", width: 18 },
  { key: "pan", header: "PAN", width: 14 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "email", header: "Email", width: 24 },
  { key: "city", header: "City", width: 16 },
  { key: "state", header: "State", width: 16 },
  {
    key: "openingBalance",
    header: "Opening Balance (₹)",
    type: "currency",
    width: 18,
    getter: (p) => p.openingBalance ?? 0,
  },
  {
    key: "currentBalance",
    header: "Current Balance (₹)",
    type: "currency",
    width: 18,
    getter: (p) => p.currentBalance ?? 0,
  },
  {
    key: "creditPeriodDays",
    header: "Credit Days",
    type: "number",
    width: 12,
    getter: (p) => p.creditPeriodDays ?? 0,
  },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (p) => (p.active !== false ? "Active" : "Inactive"),
  },
];

// ========================================================================
// 3. INVOICE REGISTER EXPORT DEFINITIONS
// ========================================================================
export const INVOICE_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "number", header: "Invoice #", width: 16 },
  {
    key: "date",
    header: "Invoice Date",
    width: 14,
    getter: (inv) => formatDate(inv.date),
  },
  {
    key: "customerName",
    header: "Customer Name",
    width: 26,
    getter: (inv) => inv.customerName || inv.partyName || "",
  },
  {
    key: "gstin",
    header: "GSTIN",
    width: 18,
    getter: (inv) => inv.customerGstin || inv.gstin || "",
  },
  {
    key: "subtotal",
    header: "Subtotal (₹)",
    type: "currency",
    width: 14,
    getter: (inv) => inv.subtotal ?? 0,
  },
  {
    key: "discountTotal",
    header: "Discount (₹)",
    type: "currency",
    width: 14,
    getter: (inv) => inv.discountTotal ?? 0,
  },
  {
    key: "taxableValue",
    header: "Taxable Value (₹)",
    type: "currency",
    width: 16,
    getter: (inv) => Math.max(0, (inv.subtotal ?? 0) - (inv.discountTotal ?? 0)),
  },
  {
    key: "taxTotal",
    header: "GST Total (₹)",
    type: "currency",
    width: 14,
    getter: (inv) => inv.taxTotal ?? 0,
  },
  {
    key: "total",
    header: "Total Amount (₹)",
    type: "currency",
    width: 16,
    getter: (inv) => inv.total ?? 0,
  },
  {
    key: "amountReceived",
    header: "Received (₹)",
    type: "currency",
    width: 14,
    getter: (inv) => inv.amountReceived ?? 0,
  },
  {
    key: "balanceDue",
    header: "Balance Due (₹)",
    type: "currency",
    width: 16,
    getter: (inv) => Math.max(0, (inv.total ?? 0) - (inv.amountReceived ?? 0)),
  },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (inv) => inv.status || "draft",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
  {
    key: "branchName",
    header: "Branch",
    width: 16,
    getter: (inv) => inv.branchName || inv.branchId || "Main Branch",
  },
];

// ========================================================================
// 4. QUOTATION REGISTER EXPORT DEFINITIONS
// ========================================================================
export const QUOTATION_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "number", header: "Quote #", width: 16 },
  {
    key: "date",
    header: "Quote Date",
    width: 14,
    getter: (q) => formatDate(q.date),
  },
  {
    key: "customerName",
    header: "Customer Name",
    width: 26,
    getter: (q) => q.customerName || q.partyName || "",
  },
  {
    key: "subtotal",
    header: "Subtotal (₹)",
    type: "currency",
    width: 14,
    getter: (q) => q.subtotal ?? 0,
  },
  {
    key: "discountTotal",
    header: "Discount (₹)",
    type: "currency",
    width: 14,
    getter: (q) => q.discountTotal ?? 0,
  },
  {
    key: "taxTotal",
    header: "Tax (₹)",
    type: "currency",
    width: 14,
    getter: (q) => q.taxTotal ?? 0,
  },
  {
    key: "total",
    header: "Total Amount (₹)",
    type: "currency",
    width: 16,
    getter: (q) => q.total ?? 0,
  },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (q) => q.status || "draft",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
  {
    key: "validUntil",
    header: "Valid Until",
    width: 14,
    getter: (q) => (q.validUntil ? formatDate(q.validUntil) : "—"),
  },
];

// ========================================================================
// 5. PURCHASE REGISTER EXPORT DEFINITIONS
// ========================================================================
export const PURCHASE_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "number", header: "Purchase #", width: 16 },
  {
    key: "supplierInvoiceNumber",
    header: "Supplier Inv #",
    width: 18,
    getter: (p) => p.supplierInvoiceNumber || "",
  },
  {
    key: "date",
    header: "Bill Date",
    width: 14,
    getter: (p) => formatDate(p.date),
  },
  {
    key: "supplierName",
    header: "Supplier Name",
    width: 26,
    getter: (p) => p.supplierName || p.partyName || "",
  },
  {
    key: "gstin",
    header: "Supplier GSTIN",
    width: 18,
    getter: (p) => p.supplierGstin || p.gstin || "",
  },
  {
    key: "subtotal",
    header: "Taxable Value (₹)",
    type: "currency",
    width: 16,
    getter: (p) => Math.max(0, (p.subtotal ?? 0) - (p.discountTotal ?? 0)),
  },
  {
    key: "taxTotal",
    header: "Input Tax (₹)",
    type: "currency",
    width: 14,
    getter: (p) => p.taxTotal ?? 0,
  },
  {
    key: "total",
    header: "Total Billed (₹)",
    type: "currency",
    width: 16,
    getter: (p) => p.total ?? 0,
  },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (p) => p.status || "draft",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
];

// ========================================================================
// 6. RECEIPT REGISTER EXPORT DEFINITIONS
// ========================================================================
export const RECEIPT_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "receiptNumber", header: "Receipt #", width: 16, getter: (r) => r.receiptNumber || r.number || "" },
  {
    key: "date",
    header: "Receipt Date",
    width: 14,
    getter: (r) => formatDate(r.date),
  },
  {
    key: "partyName",
    header: "Customer",
    width: 26,
    getter: (r) => r.customerName || r.partyName || "",
  },
  {
    key: "mode",
    header: "Payment Mode",
    width: 14,
    getter: (r) => r.paymentMode || r.mode || "Cash",
    formatForDisplay: (m) => String(m).toUpperCase(),
  },
  {
    key: "amount",
    header: "Amount (₹)",
    type: "currency",
    width: 16,
    getter: (r) => Number(r.amount) || 0,
  },
  { key: "reference", header: "Reference / UTR", width: 18, getter: (r) => r.reference || r.referenceNumber || "" },
  { key: "notes", header: "Narration", width: 24, getter: (r) => r.notes || r.narration || "" },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (r) => r.status || "posted",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
];

// ========================================================================
// 7. PAYMENT REGISTER EXPORT DEFINITIONS
// ========================================================================
export const PAYMENT_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "voucherNumber", header: "Payment Voucher #", width: 18, getter: (p) => p.paymentNumber || p.voucherNumber || p.number || "" },
  {
    key: "date",
    header: "Payment Date",
    width: 14,
    getter: (p) => formatDate(p.date),
  },
  {
    key: "partyName",
    header: "Supplier / Payee",
    width: 26,
    getter: (p) => p.supplierName || p.partyName || "",
  },
  {
    key: "mode",
    header: "Payment Mode",
    width: 14,
    getter: (p) => p.paymentMode || p.mode || "Bank Transfer",
    formatForDisplay: (m) => String(m).toUpperCase(),
  },
  {
    key: "amount",
    header: "Amount Paid (₹)",
    type: "currency",
    width: 16,
    getter: (p) => Number(p.amount) || 0,
  },
  { key: "reference", header: "Reference / UTR", width: 18, getter: (p) => p.reference || p.referenceNumber || "" },
  { key: "notes", header: "Narration", width: 24, getter: (p) => p.notes || p.narration || "" },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (p) => p.status || "posted",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
];

// ========================================================================
// 8. SALES RETURN & CREDIT NOTE EXPORT DEFINITIONS
// ========================================================================
export const CREDIT_NOTE_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "number", header: "Credit Note #", width: 16, getter: (cn) => cn.creditNoteNumber || cn.number || "" },
  {
    key: "originalInvoiceNumber",
    header: "Original Invoice #",
    width: 18,
    getter: (cn) => cn.originalInvoiceNumber || cn.invoiceNumber || "",
  },
  {
    key: "date",
    header: "Date",
    width: 14,
    getter: (cn) => formatDate(cn.date),
  },
  {
    key: "customerName",
    header: "Customer",
    width: 26,
    getter: (cn) => cn.customerName || cn.partyName || cn.customerSnapshot?.name || "",
  },
  {
    key: "subtotal",
    header: "Taxable Value (₹)",
    type: "currency",
    width: 16,
    getter: (cn) => cn.subtotal ?? cn.taxableAmount ?? (cn.grandTotal ? cn.grandTotal - (cn.gstTotal || 0) : 0),
  },
  {
    key: "taxTotal",
    header: "GST (₹)",
    type: "currency",
    width: 14,
    getter: (cn) => cn.taxTotal ?? cn.gstTotal ?? 0,
  },
  {
    key: "total",
    header: "Credit Note Total (₹)",
    type: "currency",
    width: 18,
    getter: (cn) => cn.total ?? cn.grandTotal ?? 0,
  },
  { key: "reason", header: "Reason", width: 22, getter: (cn) => cn.reason || cn.reasonNotes || "" },
  {
    key: "status",
    header: "Status",
    width: 12,
    getter: (cn) => cn.status || "posted",
    formatForDisplay: (s) => String(s).toUpperCase(),
  },
];

// ========================================================================
// 9. DAY BOOK / VOUCHER REGISTER EXPORT DEFINITIONS
// ========================================================================
export const DAYBOOK_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "date", header: "Date", width: 14, getter: (v) => formatDate(v.date) },
  { key: "voucherNumber", header: "Voucher #", width: 16 },
  { key: "voucherType", header: "Voucher Type", width: 16, formatForDisplay: (vt) => String(vt).toUpperCase() },
  { key: "reference", header: "Reference", width: 16, getter: (v) => v.reference || "—" },
  {
    key: "debitPaise",
    header: "Debit (₹)",
    type: "currency",
    width: 16,
    getter: (v) => (v.totalDebit ?? v.debitPaise ?? 0) / (v.totalDebit !== undefined ? 1 : 100),
  },
  {
    key: "creditPaise",
    header: "Credit (₹)",
    type: "currency",
    width: 16,
    getter: (v) => (v.totalCredit ?? v.creditPaise ?? 0) / (v.totalCredit !== undefined ? 1 : 100),
  },
  { key: "narration", header: "Narration", width: 28, getter: (v) => v.narration || "" },
  { key: "status", header: "Status", width: 12, getter: (v) => v.status || "posted" },
];

// ========================================================================
// 10. TRIAL BALANCE EXPORT DEFINITIONS
// ========================================================================
export const TRIAL_BALANCE_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "code", header: "Ledger Code", width: 14, getter: (l) => l.code || "—" },
  { key: "name", header: "Ledger Name", width: 28 },
  { key: "groupName", header: "Account Group", width: 22 },
  { key: "nature", header: "Nature", width: 14, formatForDisplay: (n) => String(n).toUpperCase() },
  {
    key: "debit",
    header: "Debit (₹)",
    type: "currency",
    width: 16,
    getter: (r) => (r.closingType === "dr" ? r.closingBalance : 0),
  },
  {
    key: "credit",
    header: "Credit (₹)",
    type: "currency",
    width: 16,
    getter: (r) => (r.closingType === "cr" ? r.closingBalance : 0),
  },
];

// ========================================================================
// 11. RECEIVABLES AGING EXPORT DEFINITIONS
// ========================================================================
export const RECEIVABLES_AGING_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "partyCode", header: "Customer Code", width: 14, getter: (r) => r.partyCode || "—" },
  { key: "name", header: "Customer Name", width: 28 },
  {
    key: "outstanding",
    header: "Gross Outstanding (₹)",
    type: "currency",
    width: 18,
    getter: (r) => r.grossOutstanding ?? r.outstanding ?? 0,
  },
  {
    key: "availableCredit",
    header: "Available Credit (₹)",
    type: "currency",
    width: 16,
    getter: (r) => r.availableCredit ?? 0,
  },
  {
    key: "netReceivable",
    header: "Net Exposure (₹)",
    type: "currency",
    width: 18,
    getter: (r) => r.netExposure ?? r.netReceivable ?? 0,
  },
  {
    key: "days0to30",
    header: "0–30 Days (₹)",
    type: "currency",
    width: 14,
    getter: (r) => r.agingBuckets?.days0_30 ?? 0,
  },
  {
    key: "days31to60",
    header: "31–60 Days (₹)",
    type: "currency",
    width: 14,
    getter: (r) => r.agingBuckets?.days31_60 ?? 0,
  },
  {
    key: "days61to90",
    header: "61–90 Days (₹)",
    type: "currency",
    width: 14,
    getter: (r) => r.agingBuckets?.days61_90 ?? 0,
  },
  {
    key: "days90plus",
    header: "90+ Days (₹)",
    type: "currency",
    width: 14,
    getter: (r) => r.agingBuckets?.days90_plus ?? 0,
  },
  { key: "oldestDueDate", header: "Oldest Due", width: 14, getter: (r) => (r.oldestDueDate ? formatDate(r.oldestDueDate) : "—") },
  { key: "lastReceiptDate", header: "Last Receipt", width: 14, getter: (r) => (r.lastReceiptDate ? formatDate(r.lastReceiptDate) : "—") },
];

// ========================================================================
// 12. PAYABLES AGING EXPORT DEFINITIONS
// ========================================================================
export const PAYABLES_AGING_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "partyCode", header: "Supplier Code", width: 14, getter: (s) => s.partyCode || "—" },
  { key: "name", header: "Supplier Name", width: 28 },
  {
    key: "grossPayable",
    header: "Gross Supplier Dues (₹)",
    type: "currency",
    width: 20,
    getter: (s) => s.grossPayable ?? s.outstanding ?? 0,
  },
  {
    key: "advances",
    header: "Supplier Advances (₹)",
    type: "currency",
    width: 18,
    getter: (s) => s.advances ?? 0,
  },
  {
    key: "netPayable",
    header: "Net Accounts Payable (₹)",
    type: "currency",
    width: 20,
    getter: (s) => s.netPayable ?? Math.max(0, (s.grossPayable ?? s.outstanding ?? 0) - (s.advances ?? 0)),
  },
  {
    key: "days0to30",
    header: "0–30 Days (₹)",
    type: "currency",
    width: 14,
    getter: (s) => s.agingBuckets?.days0_30 ?? 0,
  },
  {
    key: "days31to60",
    header: "31–60 Days (₹)",
    type: "currency",
    width: 14,
    getter: (s) => s.agingBuckets?.days31_60 ?? 0,
  },
  {
    key: "days61to90",
    header: "61–90 Days (₹)",
    type: "currency",
    width: 14,
    getter: (s) => s.agingBuckets?.days61_90 ?? 0,
  },
  {
    key: "days90plus",
    header: "90+ Days (₹)",
    type: "currency",
    width: 14,
    getter: (s) => s.agingBuckets?.days90_plus ?? 0,
  },
  { key: "oldestDueDate", header: "Oldest Due", width: 14, getter: (s) => (s.oldestDueDate ? formatDate(s.oldestDueDate) : "—") },
  { key: "lastPaymentDate", header: "Last Payment", width: 14, getter: (s) => (s.lastPaymentDate ? formatDate(s.lastPaymentDate) : "—") },
];

// ========================================================================
// 13. GST STATUTORY REGISTER EXPORT DEFINITIONS
// ========================================================================
export const GST_REGISTER_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "type", header: "Supply Type", width: 16, getter: (g) => g.supplyType || g.type || "B2B" },
  { key: "docNumber", header: "Document #", width: 16, getter: (g) => g.number || g.docNumber || "" },
  { key: "date", header: "Date", width: 14, getter: (g) => formatDate(g.date) },
  { key: "partyName", header: "Party Name", width: 26, getter: (g) => g.partyName || g.customerName || g.supplierName || "" },
  { key: "gstin", header: "Party GSTIN", width: 18, getter: (g) => g.partyGstin || g.gstin || "URP" },
  { key: "pos", header: "Place of Supply", width: 16, getter: (g) => g.placeOfSupply || g.pos || "Local" },
  {
    key: "taxableValue",
    header: "Taxable Value (₹)",
    type: "currency",
    width: 16,
    getter: (g) => g.taxableValue ?? g.subtotal ?? 0,
  },
  {
    key: "cgst",
    header: "CGST (₹)",
    type: "currency",
    width: 14,
    getter: (g) => g.cgst ?? 0,
  },
  {
    key: "sgst",
    header: "SGST (₹)",
    type: "currency",
    width: 14,
    getter: (g) => g.sgst ?? 0,
  },
  {
    key: "igst",
    header: "IGST (₹)",
    type: "currency",
    width: 14,
    getter: (g) => g.igst ?? 0,
  },
  {
    key: "totalTax",
    header: "Total Tax (₹)",
    type: "currency",
    width: 14,
    getter: (g) => g.totalTax ?? ((g.cgst || 0) + (g.sgst || 0) + (g.igst || 0)),
  },
  {
    key: "grandTotal",
    header: "Invoice Value (₹)",
    type: "currency",
    width: 18,
    getter: (g) => g.grandTotal ?? g.total ?? 0,
  },
];

// ========================================================================
// 14. MONTH-END SNAPSHOT EXPORT DEFINITIONS
// ========================================================================
export const MONTH_END_SNAPSHOT_EXPORT_COLUMNS: ExportColumnDefinition<any>[] = [
  { key: "category", header: "Accounting Section", width: 22 },
  { key: "metric", header: "Key Metric / Ledger", width: 28 },
  {
    key: "amount",
    header: "Amount (₹)",
    type: "currency",
    width: 18,
    getter: (m) => m.amount ?? 0,
  },
  { key: "status", header: "Integrity Status", width: 16 },
  { key: "notes", header: "CA / Audit Notes", width: 32, getter: (m) => m.notes || "—" },
];
