/**
 * Pure Canonical Document Calculation Engine & Contract (PRD §§ 44-55)
 * 
 * Provides single source of truth for commercial totals, GST tax calculation,
 * extra charges, discounts, rounding, and preflight validation.
 * Used identically by Client UX and Server Post Authoritative Recomputation.
 */

import {
  calculateDocumentTaxes,
  calculateAdvanceTax,
  toPaise,
  toRupees,
  determineInterState,
  normalizeStateCode,
} from "./taxEngine.ts";
import type {
  TaxTotals,
  TaxCalculationParams,
  AdvanceSupplyType,
  AdvanceTaxTreatment,
  AdvanceTaxCalculationParams,
  AdvanceTaxResult,
} from "./types.ts";
import type { LineItem, ExtraCharge, Invoice, CompanySettings } from "@/lib/db";

export interface CanonicalLineItem {
  productId?: string;
  name?: string;
  hsn?: string;
  quantity: number;
  rate: number;
  discountPct?: number;
  discountPercent?: number;
  gstRate?: number;
  taxRate?: number;
  cessRate?: number;
  isTaxInclusive?: boolean;
  unit?: string;
}

export interface CanonicalExtraCharge {
  name: string;
  amount: number;
  isTaxable?: boolean;
  gstRate?: number;
}

export interface CanonicalCalculationInput {
  items: CanonicalLineItem[];
  extraCharges?: CanonicalExtraCharge[];
  companyGstMode?: string;
  companyStateCode?: string;
  partyStateCode?: string;
  placeOfSupply?: string;
  isInterState?: boolean;
  enableGst?: boolean;
  documentDiscountValue?: number;
  documentDiscountType?: "percentage" | "fixed";
  amountPaid?: number;
}

export interface CanonicalCalculationResult extends TaxTotals {
  taxableAmount: number;
  extraChargesTaxTotal: number;
}

/**
 * Pure calculation function executed identically by client preview and server authoritative post.
 */
export function calculateCanonicalTotals(
  input: CanonicalCalculationInput
): CanonicalCalculationResult {
  const normMode = (input.companyGstMode || "NORMAL_GST").toUpperCase();
  const isInterState = determineInterState({
    companyState: input.companyStateCode,
    partyState: input.partyStateCode,
    placeOfSupply: input.placeOfSupply,
    override: input.isInterState,
  });

  const taxParams: TaxCalculationParams = {
    items: (input.items || []).map((it) => {
      const rate = Number(it.rate) || 0;
      const quantity = Number(it.quantity) || 0;
      const discountPct =
        it.discountPct !== undefined
          ? Number(it.discountPct)
          : it.discountPercent !== undefined
          ? Number(it.discountPercent)
          : 0;
      // Resolve GST rate with complete fallback tolerance (PRD Addendum § 25)
      const gstRate =
        it.gstRate !== undefined
          ? Number(it.gstRate)
          : it.taxRate !== undefined
          ? Number(it.taxRate)
          : 0;
      const cessRate = Number(it.cessRate) || 0;

      return {
        productId: it.productId,
        name: it.name || "Item",
        hsn: it.hsn,
        quantity,
        rate,
        unit: it.unit,
        gstRate,
        cessRate,
        discountValue: discountPct,
        discountType: "percentage",
        pricingMode: it.isTaxInclusive ? "inclusive" : "exclusive",
      };
    }),
    extraCharges: (input.extraCharges || []).map((c) => ({
      name: c.name || "Charge",
      amount: Number(c.amount) || 0,
      taxable: c.isTaxable !== false,
      gstRate: Number(c.gstRate) || 0,
    })),
    companyGstMode: normMode as any,
    companyStateCode: input.companyStateCode,
    partyStateCode: input.partyStateCode,
    placeOfSupply: input.placeOfSupply,
    isInterState,
    enableGst: input.enableGst,
    documentDiscountValue: input.documentDiscountValue,
    documentDiscountType: input.documentDiscountType || "fixed",
    amountPaid: input.amountPaid || 0,
  };

  const computed: TaxTotals = calculateDocumentTaxes(taxParams);

  const extraChargesTaxTotal = (computed.charges || []).reduce(
    (sum, chg) => sum + chg.totalTax,
    0
  );

  return {
    ...computed,
    taxableAmount: computed.taxableValue,
    extraChargesTaxTotal,
  };
}

/**
 * Extracts canonical calculation input from an Invoice and Company context.
 * Normalizes all variant property names (gstRate vs taxRate, discountPct vs discountPercent).
 */
export function extractCanonicalInputFromInvoice(
  invoice: Partial<Invoice>,
  company?: Partial<CompanySettings> | any
): CanonicalCalculationInput {
  const normMode = (
    (company as any)?.taxRegistrationMode ||
    (company as any)?.gstMode ||
    "NORMAL_GST"
  ).toUpperCase();

  const companyState = company?.state || "27";
  const placeOfSupply =
    invoice.placeOfSupply ||
    invoice.customerSnapshot?.state ||
    companyState;

  const items: CanonicalLineItem[] = (invoice.items || []).map((it) => {
    // Robust property resolution preventing client/server field drift
    const gstRate =
      it.gstRate !== undefined
        ? Number(it.gstRate)
        : it.taxRate !== undefined
        ? Number(it.taxRate)
        : 0;

    const discountPct =
      it.discountPct !== undefined
        ? Number(it.discountPct)
        : it.discountPercent !== undefined
        ? Number(it.discountPercent)
        : 0;

    return {
      productId: it.productId,
      name: it.productName || it.name || "Item",
      hsn: it.hsn,
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      discountPct,
      gstRate,
      cessRate: Number(it.cessRate) || 0,
      isTaxInclusive: Boolean(it.isTaxInclusive),
      unit: it.unit || it.uomLabel,
    };
  });

  const extraCharges: CanonicalExtraCharge[] = (invoice.extraCharges || []).map((c) => {
    const gstRate =
      (c as any).gstRate !== undefined
        ? Number((c as any).gstRate)
        : c.taxRate !== undefined
        ? Number(c.taxRate)
        : 0;

    return {
      name: c.name || (c as any).label || "Charge",
      amount: Number(c.amount) || 0,
      isTaxable: c.isTaxable !== false,
      gstRate,
    };
  });

  return {
    items,
    extraCharges,
    companyGstMode: normMode,
    companyStateCode: companyState,
    partyStateCode: invoice.customerSnapshot?.state,
    placeOfSupply,
    isInterState: Boolean((invoice as any).isIgst),
    enableGst: (company as any)?.enableGst ?? true,
    documentDiscountValue: Number(invoice.discountTotal) || 0,
    documentDiscountType: "fixed",
    amountPaid: Number(invoice.amountPaid) || 0,
  };
}

/**
 * Preflight Authoritative Validation (PRD § 48-49)
 * Compares client claimed grandTotal against pure canonical computation.
 */
export function validateDocumentTotals(
  invoice: Partial<Invoice>,
  company?: Partial<CompanySettings> | any
): {
  matches: boolean;
  diff: number;
  clientGrandTotal: number;
  authoritative: CanonicalCalculationResult;
} {
  const canonicalInput = extractCanonicalInputFromInvoice(invoice, company);
  const authoritative = calculateCanonicalTotals(canonicalInput);

  const clientGrandTotal = Number(invoice.grandTotal) || 0;
  const diff = Math.round(Math.abs(clientGrandTotal - authoritative.grandTotal) * 100) / 100;
  const matches = clientGrandTotal === 0 || diff <= 1.0;

  return {
    matches,
    diff,
    clientGrandTotal,
    authoritative,
  };
}

export {
  calculateAdvanceTax,
  type AdvanceSupplyType,
  type AdvanceTaxTreatment,
  type AdvanceTaxCalculationParams,
  type AdvanceTaxResult,
};

