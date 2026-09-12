import type {
  TaxCalculationParams,
  TaxTotals,
  ComputedTaxLine,
  ComputedTaxCharge,
  TaxLineInput,
  TaxChargeInput,
  TaxSnapshot,
  GstRegistrationMode,
  AdvanceSupplyType,
  AdvanceTaxTreatment,
  AdvanceTaxCalculationParams,
  AdvanceTaxResult,
} from "./types";

/**
 * Standard Indian State code to GST 2-digit prefix dictionary.
 */
export const GST_STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01",
  "himachal pradesh": "02",
  "punjab": "03",
  "chandigarh": "04",
  "uttarakhand": "05",
  "haryana": "06",
  "delhi": "07",
  "rajasthan": "08",
  "uttar pradesh": "09",
  "bihar": "10",
  "sikkim": "11",
  "arunachal pradesh": "12",
  "nagaland": "13",
  "manipur": "14",
  "mizoram": "15",
  "tripura": "16",
  "meghalaya": "17",
  "assam": "18",
  "west bengal": "19",
  "jharkhand": "20",
  "odisha": "21",
  "chhattisgarh": "22",
  "madhya pradesh": "23",
  "gujarat": "24",
  "daman and diu": "25",
  "dadra and nagar haveli": "26",
  "maharashtra": "27",
  "andhra pradesh": "28",
  "karnataka": "29",
  "goa": "30",
  "lakshadweep": "31",
  "kerala": "32",
  "tamil nadu": "33",
  "puducherry": "34",
  "andaman and nicobar": "35",
  "telangana": "36",
  "andhra pradesh (new)": "37",
  "ladakh": "38",
};

/**
 * Converts a rupee float to integer paise to eliminate JS IEEE-754 precision drift.
 */
export function toPaise(rupees: number): number {
  return Math.round((Number(rupees) || 0) * 100);
}

/**
 * Converts integer paise back to 2-decimal rupee number.
 */
export function toRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

/**
 * Normalizes state name or code to a 2-digit GST prefix if possible.
 */
export function normalizeStateCode(input?: string): string {
  if (!input) return "";
  const clean = input.trim().toLowerCase();
  if (/^\d{2}$/.test(clean)) return clean;
  if (GST_STATE_CODES[clean]) return GST_STATE_CODES[clean];
  for (const [name, code] of Object.entries(GST_STATE_CODES)) {
    if (clean.includes(name) || name.includes(clean)) return code;
  }
  return clean;
}

/**
 * Determines whether a transaction is Inter-State (IGST) or Intra-State (CGST + SGST).
 */
export function determineInterState(params: {
  companyState?: string;
  partyState?: string;
  placeOfSupply?: string;
  override?: boolean;
}): boolean {
  if (params.override !== undefined) return params.override;
  const origin = normalizeStateCode(params.companyState);
  const dest = normalizeStateCode(params.placeOfSupply || params.partyState);
  if (!origin || !dest) return false; // default to intra-state if missing
  return origin !== dest;
}

/**
 * Computes a single line item with strict paise math, tax inclusive back-calculation,
 * line discounts, and intra/inter-state tax splitting.
 */
export function computeTaxLine(
  item: TaxLineInput,
  options: { isInterState: boolean; enableGst: boolean }
): ComputedTaxLine {
  const qty = Number(item.quantity) || 0;
  const rate = Number(item.rate) || 0;
  const grossPaise = Math.round(qty * toPaise(rate));
  const pricingMode = item.pricingMode || "exclusive";
  const taxTreatment = item.taxTreatment || "taxable";
  const gstRate = options.enableGst && taxTreatment === "taxable" ? Number(item.gstRate) || 0 : 0;
  const cessRate = options.enableGst && taxTreatment === "taxable" ? Number(item.cessRate) || 0 : 0;

  // Calculate line discount
  let discountPaise = 0;
  if (item.discountValue && item.discountValue > 0) {
    if (item.discountType === "fixed") {
      discountPaise = Math.min(grossPaise, toPaise(item.discountValue));
    } else {
      discountPaise = Math.round((grossPaise * Number(item.discountValue)) / 100);
    }
  }

  let taxablePaise = 0;
  let gstPaise = 0;
  let cessPaise = 0;
  let lineTotalPaise = 0;

  if (pricingMode === "inclusive" && gstRate > 0) {
    // Tax-Inclusive Back-Calculation Formula:
    // Net after discount includes GST: netInclusive = grossPaise - discountPaise
    // Taxable = round((netInclusive * 100) / (100 + gstRate + cessRate))
    // GST = netInclusive - Taxable
    const netInclusivePaise = Math.max(0, grossPaise - discountPaise);
    const totalRate = gstRate + cessRate;
    taxablePaise = Math.round((netInclusivePaise * 100) / (100 + totalRate));
    const totalTaxPaise = netInclusivePaise - taxablePaise;

    if (cessRate > 0) {
      cessPaise = Math.round((taxablePaise * cessRate) / 100);
      gstPaise = Math.max(0, totalTaxPaise - cessPaise);
    } else {
      gstPaise = totalTaxPaise;
      cessPaise = 0;
    }
    lineTotalPaise = netInclusivePaise;
  } else {
    // Tax-Exclusive Calculation:
    // Taxable = grossPaise - discountPaise
    // GST = round((taxable * gstRate) / 100)
    taxablePaise = Math.max(0, grossPaise - discountPaise);
    gstPaise = gstRate > 0 ? Math.round((taxablePaise * gstRate) / 100) : 0;
    cessPaise = cessRate > 0 ? Math.round((taxablePaise * cessRate) / 100) : 0;
    lineTotalPaise = taxablePaise + gstPaise + cessPaise;
  }

  // Tax splitting between CGST/SGST and IGST
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (options.isInterState) {
    igstPaise = gstPaise;
  } else {
    cgstPaise = Math.round(gstPaise / 2);
    sgstPaise = gstPaise - cgstPaise; // guarantee cgst + sgst === gstPaise exactly
  }

  return {
    productId: item.productId || "",
    name: item.name || "",
    hsn: item.hsn || "",
    quantity: qty,
    unit: item.unit || "pcs",
    rate: rate,
    grossAmount: toRupees(grossPaise),
    discountAmount: toRupees(discountPaise),
    taxableValue: toRupees(taxablePaise),
    gstRate: gstRate,
    cessRate: cessRate,
    cgstRate: options.isInterState ? 0 : gstRate / 2,
    sgstRate: options.isInterState ? 0 : gstRate / 2,
    igstRate: options.isInterState ? gstRate : 0,
    cgstAmount: toRupees(cgstPaise),
    sgstAmount: toRupees(sgstPaise),
    igstAmount: toRupees(igstPaise),
    cessAmount: toRupees(cessPaise),
    totalTax: toRupees(gstPaise + cessPaise),
    lineTotal: toRupees(lineTotalPaise),
    pricingMode,
    taxTreatment,
    size: item.size,
    description: item.description,
  };
}

/**
 * Computes an additional charge (freight, labour, packaging, transport).
 */
export function computeTaxCharge(
  charge: TaxChargeInput,
  options: { isInterState: boolean; enableGst: boolean }
): ComputedTaxCharge {
  const basePaise = toPaise(charge.amount || 0);
  const isTaxable = options.enableGst && (charge.taxable ?? true);
  const gstRate = isTaxable ? Number(charge.gstRate) || 0 : 0;
  const gstPaise = gstRate > 0 ? Math.round((basePaise * gstRate) / 100) : 0;

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (options.isInterState) {
    igstPaise = gstPaise;
  } else {
    cgstPaise = Math.round(gstPaise / 2);
    sgstPaise = gstPaise - cgstPaise;
  }

  return {
    name: charge.name || "Additional Charge",
    description: charge.description,
    baseAmount: toRupees(basePaise),
    taxableValue: toRupees(basePaise),
    gstRate,
    cgstAmount: toRupees(cgstPaise),
    sgstAmount: toRupees(sgstPaise),
    igstAmount: toRupees(igstPaise),
    totalTax: toRupees(gstPaise),
    totalAmount: toRupees(basePaise + gstPaise),
    ledgerId: charge.ledgerId,
  };
}

/**
 * Determines statutory document title/type based on company tax registration mode and transaction.
 * - NORMAL_GST -> TAX INVOICE (or BILL OF SUPPLY if all items are exempt/non-gst)
 * - COMPOSITION -> BILL OF SUPPLY (statutory composition levy, no GST collected)
 * - UNREGISTERED -> COMMERCIAL INVOICE (or INVOICE)
 */
export function determineDocumentType(params: {
  companyGstMode?: string;
  hasTaxableItems?: boolean;
}): "TAX INVOICE" | "BILL OF SUPPLY" | "COMMERCIAL INVOICE" {
  const mode = (params.companyGstMode || "NORMAL_GST").toUpperCase();
  if (mode === "COMPOSITION") {
    return "BILL OF SUPPLY";
  }
  if (mode === "UNREGISTERED") {
    return "COMMERCIAL INVOICE";
  }
  // NORMAL_GST
  if (params.hasTaxableItems === false) {
    return "BILL OF SUPPLY";
  }
  return "TAX INVOICE";
}

/**
 * Validates legal invoice numbering according to Rule 46 of CGST Rules 2017.
 * Requirements:
 * 1. Maximum 16 characters in length.
 * 2. Permitted characters: alphanumeric (A-Z, a-z, 0-9), hyphens (-), slashes (/).
 * 3. Required for statutory Tax Invoices.
 */
export function validateGstInvoiceNumber(invoiceNumber?: string): {
  valid: boolean;
  error?: string;
} {
  if (!invoiceNumber || typeof invoiceNumber !== "string") {
    return { valid: false, error: "Invoice number is required." };
  }
  const trimmed = invoiceNumber.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "Invoice number cannot be blank." };
  }
  if (trimmed.length > 16) {
    return {
      valid: false,
      error: `GST Tax Invoice number '${trimmed}' exceeds statutory maximum limit of 16 characters (length: ${trimmed.length}).`,
    };
  }
  // Rule 46: alphanumeric and special characters hyphen and slash symbol
  const pattern = /^[A-Za-z0-9\-\/]+$/;
  if (!pattern.test(trimmed)) {
    return {
      valid: false,
      error: `Invoice number '${trimmed}' contains invalid characters. Rule 46 allows only alphanumeric characters, hyphens (-), and slashes (/).`,
    };
  }
  return { valid: true };
}

/**
 * Authoritative Document-Level Tax and Commercial Calculation Engine.
 * Supports:
 * - Full GST invoices (NORMAL_GST)
 * - Composition Levy (COMPOSITION - Bill of Supply, no GST collected from buyer)
 * - Non-GST commercial invoices (UNREGISTERED - Commercial Invoice)
 * - Intra-state vs Inter-state determination
 * - Line & Document discounts
 * - Mixed GST rate lines (0%, 5%, 12%, 18%, 28%)
 * - Taxable & Non-taxable extra charges
 * - Integer paise round-off
 * - Explicit breakdown fields (Correction 16)
 */
export function calculateDocumentTaxes(params: TaxCalculationParams): TaxTotals {
  const normGstMode = (params.companyGstMode || "NORMAL_GST").toUpperCase();
  const isComposition = normGstMode === "COMPOSITION";
  const isUnregistered = normGstMode === "UNREGISTERED";

  // COMPOSITION & UNREGISTERED sellers do not charge/collect GST on customer invoices!
  const enableGst =
    params.enableGst !== undefined
      ? params.enableGst
      : isComposition || isUnregistered
      ? false
      : true;

  const isInterState = determineInterState({
    companyState: params.companyStateCode,
    partyState: params.partyStateCode,
    placeOfSupply: params.placeOfSupply,
    override: params.isInterState,
  });

  const computedLines = (params.items || []).map((it) =>
    computeTaxLine(it, { isInterState, enableGst })
  );

  const computedCharges = (params.extraCharges || []).map((chg) =>
    computeTaxCharge(chg, { isInterState, enableGst })
  );

  // Sum line totals in integer paise
  let subtotalPaise = 0;
  let lineDiscountsPaise = 0;
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let cessPaise = 0;
  let hasTaxableLines = false;

  for (const l of computedLines) {
    subtotalPaise += toPaise(l.grossAmount);
    lineDiscountsPaise += toPaise(l.discountAmount);
    taxablePaise += toPaise(l.taxableValue);
    cgstPaise += toPaise(l.cgstAmount);
    sgstPaise += toPaise(l.sgstAmount);
    igstPaise += toPaise(l.igstAmount);
    cessPaise += toPaise(l.cessAmount);
    if (l.gstRate > 0) hasTaxableLines = true;
  }

  // Document-level discount (applied to net taxable)
  let docDiscountPaise = 0;
  if (params.documentDiscountValue && params.documentDiscountValue > 0) {
    if (params.documentDiscountType === "fixed") {
      docDiscountPaise = Math.min(taxablePaise, toPaise(params.documentDiscountValue));
    } else {
      docDiscountPaise = Math.round((taxablePaise * Number(params.documentDiscountValue)) / 100);
    }
  }

  // Sum extra charges
  let extraChargesBasePaise = 0;
  let extraChargesTaxablePaise = 0;
  let extraChargesNonTaxablePaise = 0;
  let extraChargesTaxPaise = 0;

  for (const c of computedCharges) {
    extraChargesBasePaise += toPaise(c.baseAmount);
    if (c.totalTax > 0) {
      extraChargesTaxablePaise += toPaise(c.baseAmount);
      hasTaxableLines = true;
    } else {
      extraChargesNonTaxablePaise += toPaise(c.baseAmount);
    }
    extraChargesTaxPaise += toPaise(c.totalTax);
    cgstPaise += toPaise(c.cgstAmount);
    sgstPaise += toPaise(c.sgstAmount);
    igstPaise += toPaise(c.igstAmount);
  }

  const totalGstPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const netTaxablePaise = Math.max(0, taxablePaise - docDiscountPaise);
  const netBeforeRoundPaise =
    netTaxablePaise + totalGstPaise + extraChargesBasePaise;

  // Commercial round-off to nearest rupee
  const grandTotalPaise = Math.round(netBeforeRoundPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - netBeforeRoundPaise;

  // Amount paid & balance due
  const paidPaise = toPaise(params.amountPaid || 0);
  const balancePaise = grandTotalPaise - paidPaise;

  // Document type determination
  const documentType = determineDocumentType({
    companyGstMode: normGstMode,
    hasTaxableItems: hasTaxableLines,
  });

  // Multi-rate tax breakdown for formal Tax Invoice summary
  const rateMap = new Map<
    number,
    { taxable: number; cgst: number; sgst: number; igst: number; cess: number }
  >();

  for (const l of computedLines) {
    const r = l.gstRate;
    const curr = rateMap.get(r) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
    curr.taxable += toPaise(l.taxableValue);
    curr.cgst += toPaise(l.cgstAmount);
    curr.sgst += toPaise(l.sgstAmount);
    curr.igst += toPaise(l.igstAmount);
    curr.cess += toPaise(l.cessAmount);
    rateMap.set(r, curr);
  }

  for (const c of computedCharges) {
    const r = c.gstRate;
    if (r > 0) {
      const curr = rateMap.get(r) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
      curr.taxable += toPaise(c.taxableValue);
      curr.cgst += toPaise(c.cgstAmount);
      curr.sgst += toPaise(c.sgstAmount);
      curr.igst += toPaise(c.igstAmount);
      rateMap.set(r, curr);
    }
  }

  const taxBreakdown = Array.from(rateMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, vals]) => ({
      rate,
      taxable: toRupees(vals.taxable),
      cgst: toRupees(vals.cgst),
      sgst: toRupees(vals.sgst),
      igst: toRupees(vals.igst),
      cess: toRupees(vals.cess),
      totalTax: toRupees(vals.cgst + vals.sgst + vals.igst + vals.cess),
    }));

  return {
    // Legacy / convenience fields
    subtotal: toRupees(subtotalPaise),
    lineDiscountsTotal: toRupees(lineDiscountsPaise),
    documentDiscountTotal: toRupees(docDiscountPaise),
    totalDiscount: toRupees(lineDiscountsPaise + docDiscountPaise),
    taxableAmount: toRupees(netTaxablePaise),
    cgstTotal: toRupees(cgstPaise),
    sgstTotal: toRupees(sgstPaise),
    igstTotal: toRupees(igstPaise),
    cessTotal: toRupees(cessPaise),
    gstTotal: toRupees(totalGstPaise),
    extraChargesSubtotal: toRupees(extraChargesBasePaise),
    extraChargesTax: toRupees(extraChargesTaxPaise),
    extraChargesTotal: toRupees(extraChargesBasePaise + extraChargesTaxPaise),

    // PRD Correction 16: Authoritative Explicit Totals Breakdown
    grossLineValue: toRupees(subtotalPaise),
    lineDiscount: toRupees(lineDiscountsPaise),
    documentDiscount: toRupees(docDiscountPaise),
    taxableValue: toRupees(netTaxablePaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(sgstPaise),
    igst: toRupees(igstPaise),
    cess: toRupees(cessPaise),
    otherTax: 0,
    taxableCharges: toRupees(extraChargesTaxablePaise),
    nonTaxableCharges: toRupees(extraChargesNonTaxablePaise),
    roundOff: toRupees(roundOffPaise),
    grandTotal: toRupees(grandTotalPaise),
    amountPaid: toRupees(paidPaise),
    balanceDue: toRupees(balancePaise),

    documentType,
    isInterState,
    gstEnabled: enableGst,
    lines: computedLines,
    charges: computedCharges,
    taxBreakdown,
  };
}

/**
 * Creates an immutable historical tax snapshot to attach to issued financial documents.
 * Guarantees that future Tax Master or rate changes never alter historical invoices.
 */
export function createTaxSnapshot(params: {
  taxTotals: TaxTotals;
  companyGstMode?: GstRegistrationMode;
  supplierGstin?: string;
  customerGstin?: string;
  companyStateCode?: string;
  placeOfSupply?: string;
}): TaxSnapshot {
  const { taxTotals, companyGstMode, supplierGstin, customerGstin, companyStateCode, placeOfSupply } = params;
  return {
    taxRegistrationMode: companyGstMode || "NORMAL_GST",
    documentType: taxTotals.documentType,
    supplierGstin,
    customerGstin,
    companyStateCode,
    placeOfSupply: placeOfSupply || companyStateCode || "27",
    isInterState: taxTotals.isInterState,
    grossLineValue: taxTotals.grossLineValue,
    lineDiscount: taxTotals.lineDiscount,
    documentDiscount: taxTotals.documentDiscount,
    taxableValue: taxTotals.taxableValue,
    cgst: taxTotals.cgst,
    sgst: taxTotals.sgst,
    igst: taxTotals.igst,
    cess: taxTotals.cess,
    otherTax: taxTotals.otherTax,
    taxableCharges: taxTotals.taxableCharges,
    nonTaxableCharges: taxTotals.nonTaxableCharges,
    roundOff: taxTotals.roundOff,
    grandTotal: taxTotals.grandTotal,
    amountPaid: taxTotals.amountPaid,
    balanceDue: taxTotals.balanceDue,
    lines: (taxTotals.lines || []).map((l) => ({
      name: l.name,
      hsn: l.hsn,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      taxableValue: l.taxableValue,
      taxRate: l.gstRate,
      taxTreatment: l.taxTreatment,
      taxType: "GST" as const,
      cgstAmount: l.cgstAmount,
      sgstAmount: l.sgstAmount,
      igstAmount: l.igstAmount,
      cessAmount: l.cessAmount,
      lineTotal: l.lineTotal,
    })),
    charges: (taxTotals.charges || []).map((c) => ({
      name: c.name,
      amount: c.baseAmount,
      taxable: c.totalTax > 0,
      taxRate: c.gstRate,
      cgstAmount: c.cgstAmount,
      sgstAmount: c.sgstAmount,
      igstAmount: c.igstAmount,
      totalAmount: c.totalAmount,
      ledgerId: c.ledgerId,
    })),
    snapshotTimestamp: Date.now(),
  };
}

/**
 * Authoritative Server-Side Advance Receipt Tax Engine (PRD Addendum §§ 1-4, 7, 8, 11)
 * 
 * Computes GST liability on customer advance receipts deterministically:
 * - NORMAL_GST + GOODS -> NO_ADVANCE_GST, ₹0 tax (Notification 66/2017-CT)
 * - NORMAL_GST + SERVICES -> ADVANCE_GST, back-calculates taxable & CGST/SGST or IGST in integer paise
 * - NORMAL_GST + MIXED -> isolates goods (no tax) from services (taxable)
 * - NORMAL_GST + UNSPECIFIED -> PENDING_CLASSIFICATION, ₹0 tax, explicit review banner
 * - COMPOSITION / UNREGISTERED -> NO_GST, ₹0 tax
 */
export function calculateAdvanceTax(params: AdvanceTaxCalculationParams): AdvanceTaxResult {
  const normMode = (params.companyGstMode || "NORMAL_GST").toUpperCase();
  const supplyType: AdvanceSupplyType = params.supplyType || "GOODS";
  const advanceAmount = Number(params.advanceAmount) || 0;
  const advanceAmountPaise = toPaise(advanceAmount);

  // Default empty result structure
  const baseResult = {
    advanceAmount,
    advanceAmountPaise,
    taxableAdvance: advanceAmount,
    taxableAmountPaise: advanceAmountPaise,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    totalTax: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    cessPaise: 0,
    totalTaxPaise: 0,
    isInterState: false,
    supplyType,
  };

  // 1. UNREGISTERED Mode: No statutory GST registration, no output tax collected or accounted
  if (normMode === "UNREGISTERED") {
    return {
      ...baseResult,
      taxTreatment: "NO_GST",
    };
  }

  // 2. COMPOSITION Mode: Composition levy dealers cannot collect GST from buyers on receipts or invoices
  if (normMode === "COMPOSITION") {
    return {
      ...baseResult,
      taxTreatment: "NO_GST",
    };
  }

  // 3. NORMAL_GST Mode: Check Supply Type
  if (supplyType === "GOODS") {
    // Under Notification 66/2017 - Central Tax, advances on supply of GOODS do NOT attract GST at receipt time.
    // The eventual Tax Invoice creates the sales and tax transaction.
    return {
      ...baseResult,
      taxTreatment: "NO_ADVANCE_GST",
    };
  }

  if (supplyType === "UNSPECIFIED") {
    // Business received money before exact products/services are known.
    // Must NOT guess GST or silently invent a tax rate.
    return {
      ...baseResult,
      taxTreatment: "PENDING_CLASSIFICATION",
      reviewMessage: "Tax treatment requires review when the advance is allocated.",
    };
  }

  const isInterState = determineInterState({
    companyState: params.companyStateCode,
    partyState: params.partyStateCode,
    placeOfSupply: params.placeOfSupply,
    override: params.isInterState,
  });

  if (supplyType === "SERVICES") {
    const isTaxable = params.taxTreatment !== "exempt" &&
      params.taxTreatment !== "nil_rated" &&
      params.taxTreatment !== "non_gst" &&
      (params.gstRate === undefined || params.gstRate > 0);

    if (!isTaxable) {
      return {
        ...baseResult,
        isInterState,
        taxTreatment: "NO_ADVANCE_GST",
      };
    }

    const gstRate = params.gstRate !== undefined ? Number(params.gstRate) : 18;
    const cessRate = Number(params.cessRate) || 0;
    const totalRate = gstRate + cessRate;
    const isInclusive = params.taxInclusive !== false; // default true for received amounts

    let taxablePaise = 0;
    let totalTaxPaise = 0;
    let cessPaise = 0;
    let gstPaise = 0;

    if (isInclusive && totalRate > 0) {
      // Tax-Inclusive Back-Calculation Formula:
      // Taxable = round((GrossPaise * 100) / (100 + TotalRate))
      // TotalTax = GrossPaise - Taxable
      taxablePaise = Math.round((advanceAmountPaise * 100) / (100 + totalRate));
      totalTaxPaise = advanceAmountPaise - taxablePaise;
      cessPaise = cessRate > 0 ? Math.round((taxablePaise * cessRate) / 100) : 0;
      gstPaise = Math.max(0, totalTaxPaise - cessPaise);
    } else {
      // Tax-Exclusive Formula:
      taxablePaise = advanceAmountPaise;
      gstPaise = Math.round((taxablePaise * gstRate) / 100);
      cessPaise = cessRate > 0 ? Math.round((taxablePaise * cessRate) / 100) : 0;
      totalTaxPaise = gstPaise + cessPaise;
    }

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;

    if (isInterState) {
      igstPaise = gstPaise;
    } else {
      cgstPaise = Math.round(gstPaise / 2);
      sgstPaise = gstPaise - cgstPaise; // guarantee exact penny balance
    }

    return {
      advanceAmount: isInclusive ? advanceAmount : toRupees(taxablePaise + totalTaxPaise),
      taxableAdvance: toRupees(taxablePaise),
      cgst: toRupees(cgstPaise),
      sgst: toRupees(sgstPaise),
      igst: toRupees(igstPaise),
      cess: toRupees(cessPaise),
      totalTax: toRupees(totalTaxPaise),
      taxTreatment: "ADVANCE_GST",
      advanceAmountPaise: isInclusive ? advanceAmountPaise : taxablePaise + totalTaxPaise,
      taxableAmountPaise: taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      cessPaise,
      totalTaxPaise,
      isInterState,
      supplyType: "SERVICES",
    };
  }

  // 4. MIXED GOODS + SERVICES (PRD § 8)
  // Split advance into goods and service components; apply different tax treatments
  const goodsAmount = params.mixedBreakdown ? Number(params.mixedBreakdown.goodsAmount) || 0 : 0;
  const serviceAmount = params.mixedBreakdown
    ? Number(params.mixedBreakdown.serviceAmount) || 0
    : Math.max(0, advanceAmount - goodsAmount);

  const goodsPaise = toPaise(goodsAmount);
  const servicePaise = toPaise(serviceAmount);
  const totalMixedPaise = goodsPaise + servicePaise > 0 ? goodsPaise + servicePaise : advanceAmountPaise;

  const serviceGstRate = params.mixedBreakdown?.serviceGstRate ?? params.gstRate ?? 18;
  const serviceCessRate = params.mixedBreakdown?.serviceCessRate ?? params.cessRate ?? 0;
  const serviceTotalRate = serviceGstRate + serviceCessRate;
  const serviceInclusive = params.mixedBreakdown?.serviceIsTaxInclusive ?? params.taxInclusive ?? true;

  let serviceTaxablePaise = 0;
  let serviceTotalTaxPaise = 0;
  let serviceCessPaise = 0;
  let serviceGstPaise = 0;

  if (serviceInclusive && serviceTotalRate > 0) {
    serviceTaxablePaise = Math.round((servicePaise * 100) / (100 + serviceTotalRate));
    serviceTotalTaxPaise = servicePaise - serviceTaxablePaise;
    serviceCessPaise = serviceCessRate > 0 ? Math.round((serviceTaxablePaise * serviceCessRate) / 100) : 0;
    serviceGstPaise = Math.max(0, serviceTotalTaxPaise - serviceCessPaise);
  } else {
    serviceTaxablePaise = servicePaise;
    serviceGstPaise = Math.round((serviceTaxablePaise * serviceGstRate) / 100);
    serviceCessPaise = serviceCessRate > 0 ? Math.round((serviceTaxablePaise * serviceCessRate) / 100) : 0;
    serviceTotalTaxPaise = serviceGstPaise + serviceCessPaise;
  }

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (isInterState) {
    igstPaise = serviceGstPaise;
  } else {
    cgstPaise = Math.round(serviceGstPaise / 2);
    sgstPaise = serviceGstPaise - cgstPaise;
  }

  const combinedTaxablePaise = goodsPaise + serviceTaxablePaise;

  return {
    advanceAmount: toRupees(totalMixedPaise),
    taxableAdvance: toRupees(combinedTaxablePaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(sgstPaise),
    igst: toRupees(igstPaise),
    cess: toRupees(serviceCessPaise),
    totalTax: toRupees(serviceTotalTaxPaise),
    taxTreatment: serviceTotalTaxPaise > 0 ? "ADVANCE_GST" : "NO_ADVANCE_GST",
    advanceAmountPaise: totalMixedPaise,
    taxableAmountPaise: combinedTaxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise: serviceCessPaise,
    totalTaxPaise: serviceTotalTaxPaise,
    isInterState,
    supplyType: "MIXED",
    mixedSummary: {
      goodsAmountPaise: goodsPaise,
      serviceAmountPaise: servicePaise,
      serviceTaxablePaise,
      serviceTaxPaise: serviceTotalTaxPaise,
    },
  };
}

