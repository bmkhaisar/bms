/**
 * Centralized GST and Commercial Tax Engine Types
 * Follows statutory Indian GST guidelines and commercial accounting standards.
 */

export type TaxTreatment =
  | "taxable"       // Normal GST applied
  | "exempt"        // GST exempt (0% non-taxable)
  | "nil_rated"     // Nil rated goods/services
  | "non_gst"       // Non-GST commercial goods/services
  | "zero_rated";   // SEZ / export supplies

export type GstRegistrationMode =
  | "NORMAL_GST"    // Regular GST registered taxpayer (files GSTR-1, GSTR-3B)
  | "COMPOSITION"   // Composition levy dealer (Bill of Supply, no GST collected)
  | "UNREGISTERED"  // Non-GST unregistered entity (Commercial Invoice)
  | "registered"    // Legacy alias for NORMAL_GST
  | "unregistered"  // Legacy alias for UNREGISTERED
  | "composition"   // Legacy alias for COMPOSITION
  | "overseas";     // International entity

export type TaxType = "GST" | "CESS" | "OTHER_TAX" | "NONE";

export type ItcStatus = "pending_review" | "eligible" | "ineligible" | "reversed";

export type TaxPricingMode = "exclusive" | "inclusive";

export type DiscountType = "percentage" | "fixed";

export interface TaxLineInput {
  productId?: string;
  name: string;
  hsn?: string;
  quantity: number;
  unit?: string;
  rate: number; // in rupees, e.g. 100.00
  discountValue?: number;
  discountType?: DiscountType;
  gstRate: number; // 0, 5, 12, 18, 28, etc.
  cessRate?: number; // optional cess percentage
  taxType?: TaxType;
  itcStatus?: ItcStatus;
  pricingMode?: TaxPricingMode; // "exclusive" (default) or "inclusive"
  taxTreatment?: TaxTreatment;
  size?: string;
  description?: string;
}

export interface TaxChargeInput {
  name: string;
  chargeType?: string; // Freight, Transportation, Packaging, Installation, Insurance, Handling
  description?: string;
  amount: number;
  calculationType?: "fixed" | "percentage";
  taxable?: boolean;
  taxTreatment?: TaxTreatment;
  taxType?: TaxType;
  gstRate?: number;
  cessRate?: number;
  ledgerId?: string;
}

export interface TaxCalculationParams {
  items: TaxLineInput[];
  extraCharges?: TaxChargeInput[];
  companyGstMode?: GstRegistrationMode;
  companyStateCode?: string; // 2-digit GST state code e.g. "29" or "KA"
  partyGstMode?: GstRegistrationMode;
  partyStateCode?: string; // 2-digit GST state code or state name
  placeOfSupply?: string;
  isInterState?: boolean; // explicit override if provided
  documentDiscountValue?: number;
  documentDiscountType?: DiscountType;
  enableGst?: boolean; // false for pure commercial Non-GST invoice
  amountPaid?: number;
}

export interface ComputedTaxLine {
  productId: string;
  name: string;
  hsn: string;
  quantity: number;
  unit: string;
  rate: number;
  grossAmount: number; // qty * rate
  discountAmount: number;
  taxableValue: number;
  gstRate: number;
  cessRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalTax: number;
  lineTotal: number;
  pricingMode: TaxPricingMode;
  taxTreatment: TaxTreatment;
  size?: string;
  description?: string;
}

export interface ComputedTaxCharge {
  name: string;
  description?: string;
  baseAmount: number;
  taxableValue: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  totalAmount: number;
  ledgerId?: string;
}

export type LegalDocumentType = "TAX INVOICE" | "BILL OF SUPPLY" | "COMMERCIAL INVOICE";

export interface TaxTotals {
  // Legacy / convenience fields
  subtotal: number; // sum of gross line items
  lineDiscountsTotal: number;
  documentDiscountTotal: number;
  totalDiscount: number;
  taxableAmount: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  cessTotal: number;
  gstTotal: number;
  extraChargesSubtotal: number;
  extraChargesTax: number;
  extraChargesTotal: number;

  // PRD Correction 16: Authoritative Explicit Totals Breakdown
  grossLineValue: number;
  lineDiscount: number;
  documentDiscount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  otherTax: number;
  taxableCharges: number;
  nonTaxableCharges: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;

  // Context & Metadata
  documentType: LegalDocumentType;
  isInterState: boolean;
  gstEnabled: boolean;
  lines: ComputedTaxLine[];
  charges: ComputedTaxCharge[];
  taxBreakdown: Array<{
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    totalTax: number;
  }>;
}

export interface TaxSnapshot {
  taxRegistrationMode: GstRegistrationMode;
  documentType: LegalDocumentType;
  supplierGstin?: string;
  customerGstin?: string;
  companyStateCode?: string;
  placeOfSupply: string;
  isInterState: boolean;
  grossLineValue: number;
  lineDiscount: number;
  documentDiscount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  otherTax: number;
  taxableCharges: number;
  nonTaxableCharges: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  lines: Array<{
    name: string;
    hsn: string;
    quantity: number;
    unit: string;
    rate: number;
    taxableValue: number;
    taxRate: number;
    taxTreatment: TaxTreatment;
    taxType: TaxType;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    cessAmount: number;
    lineTotal: number;
  }>;
  charges: Array<{
    name: string;
    chargeType?: string;
    amount: number;
    taxable: boolean;
    taxRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
    ledgerId?: string;
  }>;
  snapshotTimestamp: number;
}
