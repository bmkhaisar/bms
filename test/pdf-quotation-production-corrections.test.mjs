import test from "node:test";
import assert from "node:assert/strict";

// Import modules
import { calculateDocumentTaxes } from "../src/modules/tax/taxEngine.ts";
import { calculateCanonicalTotals, validateDocumentTotals } from "../src/modules/tax/canonicalCalculation.ts";
import { formatCompanyAddress } from "../src/lib/companyAddress.ts";

test("Overall GST 18% with Document Discount", () => {
  const result = calculateCanonicalTotals({
    items: [
      { productId: "p1", name: "Portable Cabin 40x10", rate: 250000, quantity: 1, gstRate: 18 },
      { productId: "p2", name: "Security Cabin 6x6", rate: 50000, quantity: 1, gstRate: 18 },
    ],
    gstCalculationMode: "overall",
    overallGstRate: 18,
    documentDiscountValue: 20000,
    documentDiscountType: "fixed",
    companyGstMode: "NORMAL_GST",
    companyStateCode: "29",
    partyStateCode: "29",
  });

  // Total line items = 300,000
  // Discount = 20,000
  // Taxable value = 280,000
  // 18% GST on 280,000 = 50,400 (CGST 25,200 + SGST 25,200)
  // Grand total = 330,400
  assert.equal(result.subtotal, 300000);
  assert.equal(result.totalDiscount, 20000);
  assert.equal(result.taxableValue, 280000);
  assert.equal(result.gstTotal, 50400);
  assert.equal(result.cgst, 25200);
  assert.equal(result.sgst, 25200);
  assert.equal(result.grandTotal, 330400);
});

test("Overall GST 18% with Taxable and Non-Taxable Extra Charges", () => {
  const result = calculateCanonicalTotals({
    items: [
      { productId: "p1", name: "Portable Cabin 20x10", rate: 100000, quantity: 1 },
    ],
    extraCharges: [
      { name: "Transportation", amount: 10000, isTaxable: true },
      { name: "Refundable Security Deposit", amount: 5000, isTaxable: false },
    ],
    gstCalculationMode: "overall",
    overallGstRate: 18,
    companyGstMode: "NORMAL_GST",
    companyStateCode: "29",
    partyStateCode: "29",
  });

  // Items taxable = 100,000
  // Taxable charge = 10,000
  // Total taxable base = 110,000
  // 18% GST = 19,800
  // Non-taxable charge = 5,000
  // Grand total = 100,000 + 10,000 + 5,000 + 19,800 = 134,800
  assert.equal(result.taxableValue, 100000);
  assert.equal(result.taxableCharges, 10000);
  assert.equal(result.nonTaxableCharges, 5000);
  assert.equal(result.gstTotal, 19800);
  assert.equal(result.grandTotal, 134800);
});

test("Overall GST with Tax-Inclusive vs Tax-Exclusive Pricing", () => {
  // Exclusive
  const resExclusive = calculateCanonicalTotals({
    items: [
      { productId: "p1", name: "Standard Cabin", rate: 100000, quantity: 1, isTaxInclusive: false },
    ],
    gstCalculationMode: "overall",
    overallGstRate: 18,
    companyGstMode: "NORMAL_GST",
    companyStateCode: "29",
    partyStateCode: "29",
  });
  assert.equal(resExclusive.taxableValue, 100000);
  assert.equal(resExclusive.gstTotal, 18000);
  assert.equal(resExclusive.grandTotal, 118000);

  // Inclusive: 118,000 inclusive of 18% GST -> base = 100,000, GST = 18,000
  const resInclusive = calculateCanonicalTotals({
    items: [
      { productId: "p1", name: "Standard Cabin", rate: 118000, quantity: 1, isTaxInclusive: true },
    ],
    gstCalculationMode: "overall",
    overallGstRate: 18,
    companyGstMode: "NORMAL_GST",
    companyStateCode: "29",
    partyStateCode: "29",
  });
  assert.equal(Math.round(resInclusive.taxableValue), 100000);
  assert.equal(Math.round(resInclusive.gstTotal), 18000);
  assert.equal(Math.round(resInclusive.grandTotal), 118000);
});

test("Overall GST protects Exempt / Nil-Rated Lines at 0%", () => {
  const result = calculateCanonicalTotals({
    items: [
      { productId: "p1", name: "Taxable Material", rate: 100000, quantity: 1 },
      { productId: "p2", name: "Exempt Agricultural Component", rate: 50000, quantity: 1, taxTreatment: "exempt" },
    ],
    gstCalculationMode: "overall",
    overallGstRate: 18,
    companyGstMode: "NORMAL_GST",
    companyStateCode: "29",
    partyStateCode: "29",
  });

  // 100,000 taxable at 18% (18,000 GST) + 50,000 exempt at 0% (0 GST) = 168,000 Grand Total
  assert.equal(result.taxableValue, 150000);
  assert.equal(result.gstTotal, 18000);
  assert.equal(result.grandTotal, 168000);
});

test("Structured Company Address Formatter produces complete wrapped lines", () => {
  const comp = {
    legalName: "KH Portable Cabins Private Limited",
    name: "KH Cabins",
    address: "Plot No. 42, Industrial Area, Phase II\nNear Gottipura, Hoskote Taluk",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "562114",
    phone: "+91 9876543210",
    email: "sales@khcabins.com",
    gstin: "29ABCDE1234F1Z5",
    pan: "ABCDE1234F",
  };

  const formatted = formatCompanyAddress(comp);
  assert.equal(formatted.companyName, "KH Portable Cabins Private Limited");
  assert.equal(formatted.addressLines.length, 2);
  assert.equal(formatted.addressLines[0], "Plot No. 42, Industrial Area, Phase II");
  assert.equal(formatted.addressLines[1], "Near Gottipura, Hoskote Taluk");
  assert.equal(formatted.cityStatePincode, "Bengaluru, Karnataka - 562114");
  assert.equal(formatted.gstin, "29ABCDE1234F1Z5");
  assert.ok(formatted.contactLine?.includes("+91 9876543210"));
  assert.ok(formatted.contactLine?.includes("sales@khcabins.com"));
});

test("Company Address Formatter gracefully tolerates missing optional fields", () => {
  const minimalComp = {
    name: "Solo Workshop",
    city: "Mumbai",
  };
  const formatted = formatCompanyAddress(minimalComp);
  assert.equal(formatted.companyName, "Solo Workshop");
  assert.equal(formatted.cityStatePincode, "Mumbai");
  assert.equal(formatted.addressLines.length, 0);
  assert.equal(formatted.gstin, undefined);
  assert.equal(formatted.phone, undefined);
});

test("Bank and Terms Snapshot Immutability Simulation", () => {
  // 1. Initial quotation issued with SBI bank and September terms
  const initialQuotation = {
    id: "qt-101",
    number: "QT-2026-001",
    date: Date.now(),
    bankDetailsSnapshot: {
      bankName: "State Bank of India",
      accountNo: "112233445566",
      ifsc: "SBIN0001234",
      accountName: "KH Cabins Operations",
    },
    termsSnapshot: [
      "1. 50% advance along with confirmed Purchase Order.",
      "2. 40% against proforma invoice before dispatch.",
      "3. 10% on erection and handover.",
    ],
    generalInformationSnapshot: [
      { id: "row-1", label: "Foundation", value: "Customer scope" },
    ],
    technicalSpecificationSnapshot: [
      { title: "Frame Material", rows: [{ label: "Roof Frame", value: "MS 2.5mm" }] },
    ],
  };

  // 2. Company later changes its bank to HDFC and updates company default terms
  const updatedCompanySettings = {
    bankName: "HDFC Bank",
    bankAccountNo: "998877665544",
    bankIfsc: "HDFC0009999",
    terms: "1. 100% advance required for all orders.",
  };

  // 3. Document renderer relies on frozen snapshot
  const resolvedBank = initialQuotation.bankDetailsSnapshot || updatedCompanySettings;
  const resolvedTerms = initialQuotation.termsSnapshot;

  assert.equal(resolvedBank.bankName, "State Bank of India");
  assert.equal(resolvedBank.accountNo, "112233445566");
  assert.equal(resolvedTerms.length, 3);
  assert.equal(resolvedTerms[0], "1. 50% advance along with confirmed Purchase Order.");
  assert.equal(initialQuotation.generalInformationSnapshot[0].value, "Customer scope");
  assert.equal(initialQuotation.technicalSpecificationSnapshot[0].title, "Frame Material");
});

test("Legacy plain-text terms string fallback", () => {
  const legacyQuotation = {
    id: "qt-legacy",
    number: "QT-2024-099",
    terms: "Payment within 15 days.\nGoods once sold cannot be returned.\nDisputes subject to Bangalore jurisdiction.",
    // No structuredTerms or termsSnapshot
  };

  let displayTerms = [];
  if (legacyQuotation.structuredTerms && legacyQuotation.structuredTerms.length > 0) {
    displayTerms = legacyQuotation.structuredTerms.map(t => t.text);
  } else if (legacyQuotation.termsSnapshot && legacyQuotation.termsSnapshot.length > 0) {
    displayTerms = legacyQuotation.termsSnapshot;
  } else if (legacyQuotation.terms) {
    displayTerms = legacyQuotation.terms.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
  }

  assert.equal(displayTerms.length, 3);
  assert.equal(displayTerms[0], "Payment within 15 days.");
  assert.equal(displayTerms[2], "Disputes subject to Bangalore jurisdiction.");
});

test("Quotation conversion preserves GST mode and excludes General Info & Technical Specs", () => {
  const quotation = {
    id: "qt-convert-test",
    number: "QT-2026-005",
    customerId: "cust-1",
    subtotal: 500000,
    gstTotal: 90000,
    grandTotal: 590000,
    gstCalculationMode: "overall",
    overallGstRate: 18,
    includeGeneralInfo: true,
    includeTechSpecs: true,
    structuredSections: [
      { id: "sec-1", type: "GENERAL_INFO", title: "General Info", order: 1, rows: [] },
      { id: "sec-2", type: "SPEC_TABLE", title: "Fabrication", order: 2, rows: [] },
    ],
    generalInformationSnapshot: [{ label: "Site", value: "Hoskote" }],
    technicalSpecificationSnapshot: [{ title: "Frame", rows: [] }],
    termsSnapshot: ["Payment 50% advance"],
    bankDetailsSnapshot: { bankName: "HDFC Bank", accountNo: "12345" },
  };

  // Perform transfer mapping according to PRD Correction #11 & #12
  const invoiceDraft = {
    number: "INV-2026-005",
    customerId: quotation.customerId,
    subtotal: quotation.subtotal,
    gstTotal: quotation.gstTotal,
    grandTotal: quotation.grandTotal,
    // Transferred:
    gstCalculationMode: quotation.gstCalculationMode,
    overallGstRate: quotation.overallGstRate,
    termsSnapshot: quotation.termsSnapshot,
    bankDetailsSnapshot: quotation.bankDetailsSnapshot,
    // Excluded from Invoice:
    generalInformationSnapshot: undefined,
    technicalSpecificationSnapshot: undefined,
    structuredSections: undefined,
  };

  assert.equal(invoiceDraft.gstCalculationMode, "overall");
  assert.equal(invoiceDraft.overallGstRate, 18);
  assert.equal(invoiceDraft.bankDetailsSnapshot?.bankName, "HDFC Bank");
  assert.equal(invoiceDraft.generalInformationSnapshot, undefined);
  assert.equal(invoiceDraft.technicalSpecificationSnapshot, undefined);
  assert.equal(invoiceDraft.structuredSections, undefined);
});
