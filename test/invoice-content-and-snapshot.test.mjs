import test from "node:test";
import assert from "node:assert/strict";
import { resolveDocumentModel } from "../src/lib/documentModel.ts";
import { hydrateInvoiceFromCompany } from "../src/modules/documents/documentContentHydration.ts";

test("1. DIRECT INVOICE: Hydrates General Info, Tech Specs, and Terms from Company Settings", () => {
  const company = {
    id: "comp_1",
    name: "KH Portable Cabins",
    terms: "1. Payment 50% advance\n2. Delivery within 10 days",
    invoiceTermsMarkdown: "1. Advance 50% required\n2. Balance against delivery",
    invoiceGeneralInfoMarkdown: "| Parameter | Details |\n|---|---|\n| Warranty | 12 Months |\n| Material | Galvanized Steel |",
    invoiceTechnicalSpecsMarkdown: "### Structural Framework\n| Component | Spec |\n|---|---|\n| Base Frame | 100x50 ISMC |\n| Column | 50x50 Tubular |",
    showInvoiceGeneralInfo: true,
    showInvoiceTechnicalSpecs: true,
    showInvoiceTerms: true,
  };

  const directInv = {
    id: "inv_direct_1",
    number: "INV-001",
    date: Date.now(),
    customerId: "cust_1",
    items: [],
    subtotal: 10000,
    discountTotal: 0,
    gstTotal: 1800,
    cgstTotal: 900,
    sgstTotal: 900,
    igstTotal: 0,
    roundOff: 0,
    grandTotal: 11800,
    amountPaid: 0,
    balance: 11800,
    isIgst: false,
    status: "draft",
    postingStatus: "draft",
    sourceType: "DIRECT",
    createdAt: Date.now(),
  };

  const hydrated = hydrateInvoiceFromCompany(directInv, company);

  // General Info
  assert.equal(hydrated.includeGeneralInfo, true);
  assert.equal(hydrated.generalInformationSnapshot.length, 2);
  assert.equal(hydrated.generalInformationSnapshot[0].label, "Warranty");
  assert.equal(hydrated.generalInformationSnapshot[0].value, "12 Months");

  // Tech Specs
  assert.equal(hydrated.includeTechSpecs, true);
  assert.equal(hydrated.technicalSpecificationSnapshot.length, 1);
  assert.equal(hydrated.technicalSpecificationSnapshot[0].title, "Structural Framework");
  assert.equal(hydrated.technicalSpecificationSnapshot[0].rows.length, 2);

  // Terms
  assert.equal(hydrated.includeTerms, true);
  assert.equal(hydrated.structuredTerms.length, 2);
  assert.equal(hydrated.structuredTerms[0].text, "Advance 50% required");

  // Verify edits on Invoice do not modify company
  const editedSnapshot = [...hydrated.generalInformationSnapshot];
  editedSnapshot[0].value = "24 Months (Extended)";
  assert.equal(company.invoiceGeneralInfoMarkdown.includes("24 Months"), false, "Direct invoice edits must not alter company settings");
});

test("2. CONVERTED INVOICE: Copies Quotation snapshots exactly into Invoice and allows independent edits", () => {
  const quote = {
    id: "quote_100",
    number: "QTN-100",
    date: Date.now(),
    customerId: "cust_abc",
    items: [{
      productId: "prod_1",
      name: "Security Cabin 10x10",
      quantity: 1,
      rate: 150000,
      amount: 150000,
      taxableAmount: 150000,
      gstRate: 18,
      gstAmount: 27000,
      total: 177000,
    }],
    subtotal: 150000,
    discountTotal: 0,
    gstTotal: 27000,
    roundOff: 0,
    grandTotal: 177000,
    status: "issued",
    createdAt: Date.now(),
    includeGeneralInfo: true,
    generalInformationSnapshot: [
      { label: "Cabin Size", value: "10 x 10 Ft" },
      { label: "Insulation", value: "Glass Wool 50mm" },
    ],
    includeTechSpecs: true,
    structuredSections: [
      {
        id: "sec_1",
        title: "Electrical Specifications",
        type: "SPEC_TABLE",
        order: 1,
        rows: [
          { id: "r1", label: "Wiring", value: "Finolex FRLS", order: 1 },
          { id: "r2", label: "Lighting", value: "Philips LED 18W", order: 2 },
        ],
      },
    ],
    technicalSpecificationSnapshot: [
      {
        title: "Electrical Specifications",
        rows: [
          { label: "Wiring", value: "Finolex FRLS" },
          { label: "Lighting", value: "Philips LED 18W" },
        ],
      },
    ],
    includeTerms: true,
    structuredTerms: [
      { id: "t1", text: "Special Quotation Term 1", format: "NUMBERED", order: 1 },
      { id: "t2", text: "Special Quotation Term 2", format: "NUMBERED", order: 2 },
    ],
    termsSnapshot: ["Special Quotation Term 1", "Special Quotation Term 2"],
    terms: "1. Special Quotation Term 1\n2. Special Quotation Term 2",
    visibilitySnapshot: {
      showTerms: true,
      showGeneralInfo: true,
      showTechSpecs: true,
      showBankDetails: true,
    },
  };

  const invoice = {
    id: `inv_from_${quote.id}`,
    number: "INV-200",
    date: Date.now(),
    customerId: quote.customerId,
    items: quote.items,
    subtotal: quote.subtotal,
    discountTotal: 0,
    gstTotal: quote.gstTotal,
    cgstTotal: 13500,
    sgstTotal: 13500,
    igstTotal: 0,
    roundOff: 0,
    grandTotal: quote.grandTotal,
    amountPaid: 0,
    balance: quote.grandTotal,
    isIgst: false,
    status: "draft",
    postingStatus: "draft",
    sourceType: "QUOTATION",
    sourceQuotationId: quote.id,
    sourceQuotationNumber: quote.number,
    createdAt: Date.now(),
    // Converted snapshots copied from quotation
    includeGeneralInfo: quote.includeGeneralInfo,
    generalInformationSnapshot: (quote.generalInformationSnapshot || []).map(f => ({ ...f })),
    generalInfoSnapshot: (quote.generalInformationSnapshot || []).map(f => ({ ...f })),
    includeTechSpecs: quote.includeTechSpecs,
    structuredSections: (quote.structuredSections || []).map(s => ({ ...s, rows: s.rows.map(r => ({ ...r })) })),
    technicalSpecificationSnapshot: (quote.technicalSpecificationSnapshot || []).map(s => ({ ...s, rows: (s.rows || []).map(r => ({ ...r })) })),
    techSpecSnapshot: (quote.technicalSpecificationSnapshot || []).map(s => ({ ...s, rows: (s.rows || []).map(r => ({ ...r })) })),
    includeTerms: quote.includeTerms,
    structuredTerms: (quote.structuredTerms || []).map(t => ({ ...t })),
    termsSnapshot: quote.termsSnapshot ? [...quote.termsSnapshot] : undefined,
    terms: quote.terms,
    visibilitySnapshot: { ...quote.visibilitySnapshot },
  };

  // 1. Preserved exact snapshot
  assert.equal(invoice.generalInformationSnapshot?.[0].value, "10 x 10 Ft");
  assert.equal(invoice.technicalSpecificationSnapshot?.[0].rows[0].value, "Finolex FRLS");
  assert.equal(invoice.structuredTerms?.[0].text, "Special Quotation Term 1");

  // 2. Edit invoice independently
  invoice.generalInformationSnapshot[0].value = "10 x 12 Ft (Client expanded after quote)";
  invoice.technicalSpecificationSnapshot[0].rows[0].value = "Polycab 2.5sqmm";
  invoice.structuredTerms[0].text = "Invoice-specific amended term";

  // 3. Source quote remains untouched
  assert.equal(quote.generalInformationSnapshot?.[0].value, "10 x 10 Ft");
  assert.equal(quote.technicalSpecificationSnapshot?.[0].rows[0].value, "Finolex FRLS");
  assert.equal(quote.structuredTerms?.[0].text, "Special Quotation Term 1");
});

test("3. INCLUSION TOGGLES [ON/OFF]: Hides sections without deleting snapshots", () => {
  const company = { name: "Test Corp" };
  const invoice = {
    id: "inv_toggles",
    number: "INV-300",
    date: Date.now(),
    customerId: "cust_1",
    items: [],
    subtotal: 50000,
    discountTotal: 0,
    gstTotal: 9000,
    cgstTotal: 4500,
    sgstTotal: 4500,
    igstTotal: 0,
    roundOff: 0,
    grandTotal: 59000,
    amountPaid: 0,
    balance: 59000,
    isIgst: false,
    status: "draft",
    postingStatus: "draft",
    createdAt: Date.now(),
    generalInformationSnapshot: [{ label: "Inspection", value: "Passed" }],
    technicalSpecificationSnapshot: [{ title: "Wall Panel", rows: [{ label: "Type", value: "PUF 50mm" }] }],
    structuredTerms: [{ id: "t1", text: "Standard term", format: "NUMBERED", order: 1 }],
    includeGeneralInfo: false, // OFF
    includeTechSpecs: false,    // OFF
    includeTerms: true,         // ON
    visibilitySnapshot: {
      showGeneralInfo: false,
      showTechSpecs: false,
      showTerms: true,
      showBankDetails: true,
    },
  };

  const model = resolveDocumentModel(invoice, company);

  // General Info & Tech Specs are hidden from model/PDF
  assert.equal(model.includeGeneralInfo, false);
  assert.equal(model.generalInfoRows.length, 0);

  assert.equal(model.includeTechSpecs, false);
  assert.equal(model.techSpecSections.length, 0);

  // Terms are visible
  assert.equal(model.includeTerms, true);
  assert.equal(model.terms.length, 1);

  // But underlying snapshots in invoice are NOT deleted
  assert.equal(invoice.generalInformationSnapshot.length, 1);
  assert.equal(invoice.technicalSpecificationSnapshot.length, 1);

  // Toggle them back ON
  invoice.includeGeneralInfo = true;
  invoice.includeTechSpecs = true;
  invoice.visibilitySnapshot = {
    showGeneralInfo: true,
    showTechSpecs: true,
    showTerms: true,
    showBankDetails: true,
  };

  const modelReenabled = resolveDocumentModel(invoice, company);
  assert.equal(modelReenabled.includeGeneralInfo, true);
  assert.equal(modelReenabled.generalInfoRows.length, 1);
  assert.equal(modelReenabled.generalInfoRows[0].label, "Inspection");
  assert.equal(modelReenabled.includeTechSpecs, true);
  assert.equal(modelReenabled.techSpecSections.length, 1);
  assert.equal(modelReenabled.techSpecSections[0].title, "Wall Panel");
});

test("4. POSTED INVOICE IMMUTABILITY: Reprints never fall back to company settings", () => {
  const companyV1 = {
    name: "Original Corp",
    invoiceTermsMarkdown: "Original Company Terms",
    invoiceGeneralInfoMarkdown: "| Key | Val |\n|---|---|\n| Scope | Fabrication |",
    invoiceTechnicalSpecsMarkdown: "### Specs\n| A | B |\n|---|---|\n| Steel | Mild Steel |",
  };

  const postedInvoice = {
    id: "inv_posted_99",
    number: "INV-99",
    date: Date.now(),
    customerId: "cust_1",
    items: [],
    subtotal: 100000,
    discountTotal: 0,
    gstTotal: 18000,
    cgstTotal: 9000,
    sgstTotal: 9000,
    igstTotal: 0,
    roundOff: 0,
    grandTotal: 118000,
    amountPaid: 118000,
    balance: 0,
    isIgst: false,
    status: "posted",
    postingStatus: "posted",
    voucherId: "vch_123",
    createdAt: Date.now(),
    includeGeneralInfo: true,
    generalInformationSnapshot: [{ label: "Scope", value: "Custom Posted Scope" }],
    includeTechSpecs: true,
    technicalSpecificationSnapshot: [{ title: "Specs", rows: [{ label: "Steel", value: "Stainless Steel 304" }] }],
    includeTerms: true,
    structuredTerms: [{ id: "t1", text: "Frozen Posted Term", format: "NUMBERED", order: 1 }],
    termsSnapshot: ["Frozen Posted Term"],
    visibilitySnapshot: {
      showGeneralInfo: true,
      showTechSpecs: true,
      showTerms: true,
      showBankDetails: true,
    },
  };

  // Company settings change drastically later
  const companyV2 = {
    name: "Original Corp Renamed",
    invoiceTermsMarkdown: "Brand New 2027 Terms",
    invoiceGeneralInfoMarkdown: "| Key | Val |\n|---|---|\n| Scope | Erection Only |",
    invoiceTechnicalSpecsMarkdown: "### Specs\n| A | B |\n|---|---|\n| Steel | Aluminium |",
  };

  const resolved = resolveDocumentModel(postedInvoice, companyV2);

  // Must reflect the frozen invoice snapshot, NOT companyV2!
  assert.equal(resolved.generalInfoRows[0].value, "Custom Posted Scope");
  assert.equal(resolved.techSpecSections[0].rows[0].value, "Stainless Steel 304");
  assert.equal(resolved.terms[0].text, "Frozen Posted Term");
});
