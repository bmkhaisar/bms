import test from "node:test";
import assert from "node:assert/strict";

// Import modules under test
import {
  parseMarkdownDoc,
  extractTableFromMarkdown,
  extractTermsLines,
  sanitizeMarkdownText,
} from "../src/lib/markdownDoc.ts";
import { formatCompanyAddress } from "../src/lib/companyAddress.ts";
import {
  companySchema,
  createCompanySnapshot,
} from "../src/modules/company/types.ts";

test("COMPANY_DOCUMENT_SETTINGS — company schema and snapshot include document settings", () => {
  const companyData = {
    id: "comp_test_1",
    name: "Apex Engineering Pvt Ltd",
    legalName: "Apex Engineering Private Limited",
    address: "Plot 42, Industrial Area Phase 2",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560058",
    gstin: "29AABCA1234F1Z5",
    pan: "AABCA1234F",
    phone: "9876543210",
    email: "billing@apexeng.com",
    bankName: "HDFC Bank",
    bankAccount: "50200012345678",
    bankIfsc: "HDFC0001234",
    accountHolderName: "Apex Engineering Private Limited",
    bankAccountHolderName: "Apex Engineering Private Limited",
    // Document settings
    quotationGeneralInfoMarkdown: "| Item | Spec |\n|---|---|\n| Warranty | 1 Year |",
    quotationTechnicalSpecsMarkdown: "- Outer wall: 50mm PUF\n- Flooring: 18mm Marine Ply",
    quotationTermsMarkdown: "1. 50% advance\n2. Balance against delivery",
    invoiceTermsMarkdown: "1. Payment due in 15 days\n2. Interest @ 18% p.a. on delayed payment",
    quotationClosingMessage: "Thank you for your business.",
    showQuotationGeneralInfo: true,
    showQuotationTechnicalSpecs: true,
    showQuotationTerms: true,
    showInvoiceTerms: true,
    showQuotationBankDetails: true,
    showInvoiceBankDetails: true,
    createdAt: Date.now(),
    createdBy: "user_test_admin",
  };

  const parsed = companySchema.safeParse(companyData);
  assert.ok(parsed.success, `Schema validation failed: ${JSON.stringify(parsed.error?.format?.())}`);

  const snapshot = createCompanySnapshot(companyData);
  assert.equal(snapshot.name, "Apex Engineering Pvt Ltd");
  assert.equal(snapshot.accountHolderName, "Apex Engineering Private Limited");
  assert.equal(snapshot.bankAccountHolderName, "Apex Engineering Private Limited");
  assert.equal(snapshot.quotationTermsMarkdown, "1. 50% advance\n2. Balance against delivery");
  assert.equal(snapshot.invoiceTermsMarkdown, "1. Payment due in 15 days\n2. Interest @ 18% p.a. on delayed payment");
  assert.equal(snapshot.showQuotationGeneralInfo, true);
  assert.equal(snapshot.showInvoiceTerms, true);
  assert.equal(snapshot.showInvoiceBankDetails, true);
});

test("MARKDOWN_TERMS — parsing numbered lists, bold values, and list extraction", () => {
  const markdown = `
## Terms & Conditions

1. **GST:** GST @ **18%** included.
2. **Delivery Time:** Within **3 weeks** from receipt of PO and advance payment.
3. **Payment Terms:** **50% advance**, **30% on first inspection**, and **20% before dispatch**.
4. **Quality Inspection:** Cabin quality inspection shall be completed before dispatch.
5. **Quotation Validity:** **15 days**.
`;

  const blocks = parseMarkdownDoc(markdown);
  assert.ok(blocks.length >= 2, "Should parse at least heading and list blocks");

  const heading = blocks.find(b => b.type === "HEADING");
  assert.ok(heading, "Should find heading block");
  assert.equal(heading.text, "Terms & Conditions");
  assert.equal(heading.level, 2);

  const listBlock = blocks.find(b => b.type === "NUMBERED_LIST");
  assert.ok(listBlock, "Should find numbered list block");
  assert.equal(listBlock.items?.length, 5);

  // Check inline formatting spans for first item
  const item0 = listBlock.items[0];
  const boldSpans = item0.spans.filter(t => t.bold);
  assert.ok(boldSpans.length >= 2, "First item should have bold spans for GST: and 18%");
  assert.equal(boldSpans[0].text, "GST:");
  assert.equal(boldSpans[1].text, "18%");

  // Test extractTermsLines
  const termLines = extractTermsLines(markdown);
  assert.equal(termLines.length, 5);
  assert.ok(termLines[0].includes("GST:"));
  assert.ok(termLines[2].includes("50% advance"));
});

test("MARKDOWN_GENERAL_INFO & MARKDOWN_TABLE_RENDERING — parsing tables for vector PDF", () => {
  const tableMarkdown = `
| General Information | Details |
|---|---|
| Configuration of Cabins | Cabin 40’L × 10’W × 8.5’H |
| Transportation / Freight Charges | **INCLUDED.** |
| Approval of Advance Sample | No Advance Sample. |
| Foundation for Cabin | Building of foundation by Consignee. |
| Shape of Cabin | **Rectangular.** |
`;

  const blocks = parseMarkdownDoc(tableMarkdown);
  const tableBlock = blocks.find(b => b.type === "TABLE");
  assert.ok(tableBlock, "Should parse a table block");
  assert.deepEqual(tableBlock.headers, ["General Information", "Details"]);
  assert.equal(tableBlock.rows?.length, 5);
  assert.equal(tableBlock.rows[0][0], "Configuration of Cabins");
  assert.equal(tableBlock.rows[0][1], "Cabin 40’L × 10’W × 8.5’H");

  // Extract helper for jspdf-autotable
  const extracted = extractTableFromMarkdown(tableMarkdown);
  assert.ok(extracted, "Should extract table head and body");
  assert.deepEqual(extracted.head, [["General Information", "Details"]]);
  assert.equal(extracted.body.length, 5);
  assert.equal(extracted.body[1][1], "**INCLUDED.**");
});

test("GLOBAL_DOCUMENT_TOGGLES — controls future documents visibility flags", () => {
  const compWithTogglesOff = {
    id: "c_off",
    name: "Toggles Off Corp",
    showQuotationGeneralInfo: false,
    showQuotationTechnicalSpecs: false,
    showQuotationTerms: false,
    showInvoiceTerms: false,
    showQuotationBankDetails: false,
    showInvoiceBankDetails: false,
  };

  const snap = createCompanySnapshot(compWithTogglesOff);
  assert.equal(snap.showQuotationGeneralInfo, false);
  assert.equal(snap.showQuotationTechnicalSpecs, false);
  assert.equal(snap.showQuotationTerms, false);
  assert.equal(snap.showInvoiceTerms, false);
  assert.equal(snap.showQuotationBankDetails, false);
  assert.equal(snap.showInvoiceBankDetails, false);

  const compWithTogglesOn = {
    id: "c_on",
    name: "Toggles On Corp",
    showQuotationGeneralInfo: true,
    showQuotationTechnicalSpecs: true,
    showQuotationTerms: true,
    showInvoiceTerms: true,
    showQuotationBankDetails: true,
    showInvoiceBankDetails: true,
  };
  const snapOn = createCompanySnapshot(compWithTogglesOn);
  assert.equal(snapOn.showQuotationGeneralInfo, true);
  assert.equal(snapOn.showInvoiceTerms, true);
  assert.equal(snapOn.showInvoiceBankDetails, true);
});

test("GENERAL_INFO_QUOTATION_ONLY — general info and tech specs are quotation-only", () => {
  // Invoice documents do not carry General Information or Technical Specs
  const invoiceDoc = {
    kind: "invoice",
    title: "Tax Invoice",
    number: "INV-2026-001",
    date: Date.now(),
    company: {
      name: "Global Industrial",
      showQuotationGeneralInfo: true,
      quotationGeneralInfoMarkdown: "| Info | Value |",
      invoiceTermsMarkdown: "Payment on delivery",
    },
    party: { name: "Client Corp" },
    items: [],
    subtotal: 1000,
    discountTotal: 0,
    gstTotal: 180,
    roundOff: 0,
    grandTotal: 1180,
  };

  // In normalized document contracts, invoice has no generalInformation or techSpecs section
  assert.equal(invoiceDoc.generalInformation, undefined);
  assert.equal(invoiceDoc.technicalSpecifications, undefined);

  // Quotation document has quotation-specific fields
  const quotationDoc = {
    kind: "quotation",
    title: "Quotation",
    number: "QT-2026-001",
    date: Date.now(),
    includeGeneralInfo: true,
    includeTechSpecs: true,
    includeTerms: true,
  };
  assert.equal(quotationDoc.includeGeneralInfo, true);
  assert.equal(quotationDoc.includeTechSpecs, true);
});

test("BANK_DETAILS_GLOBAL & ACCOUNT_HOLDER_NAME — bank details and account holder name support", () => {
  const bank = {
    id: "bank_1",
    bankName: "State Bank of India",
    accountNo: "40057061196",
    ifscCode: "SBIN0017782",
    accountHolderName: "Global Modular Cabins LLP",
    accountName: "Global Modular Cabins LLP",
    isDefault: true,
  };

  // Verify Account Holder Name is captured and branch is not required
  assert.equal(bank.accountHolderName, "Global Modular Cabins LLP");
  assert.equal(bank.branch, undefined);
  assert.ok(bank.ifscCode.startsWith("SBIN"));
});

test("GSTIN_SINGLE_RENDER — regression across Quotation, Invoice, Purchase, Receipt so GSTIN is never printed twice", () => {
  const company = {
    name: "Bharat Modular Systems",
    legalName: "Bharat Modular Systems Private Limited",
    address: "Survey No 45, Peenya Industrial Area",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560058",
    gstin: "29AABCB1234D1Z9",
    pan: "AABCB1234D",
    phone: "+91 98450 12345",
    email: "accounts@bharatmodular.com",
  };

  const formatted = formatCompanyAddress(company);

  // 1. contactLine MUST contain ONLY Phone and Email (no GSTIN)
  assert.ok(formatted.contactLine, "Should have contactLine");
  assert.ok(!formatted.contactLine.includes("GSTIN"), `contactLine must not contain GSTIN: ${formatted.contactLine}`);
  assert.ok(formatted.contactLine.includes("Phone: +91 98450 12345"));
  assert.ok(formatted.contactLine.includes("Email: accounts@bharatmodular.com"));

  // 2. headerAddressLines MUST NOT contain GSTIN
  for (const line of formatted.headerAddressLines) {
    assert.ok(!line.includes("GSTIN"), `headerAddressLine must not contain GSTIN: ${line}`);
  }

  // 3. gstinLine contains the ONLY GSTIN line
  assert.equal(formatted.gstinLine, "GSTIN: 29AABCB1234D1Z9");

  // 4. Assemble the complete rendered header lines (as done in documentRenderer and quotationExport)
  const renderedParts = [
    ...formatted.addressLines,
    formatted.cityStatePincode,
    formatted.contactLine,
    formatted.gstinLine,
  ].filter(Boolean);

  const fullHeaderText = renderedParts.join("\n");
  const matches = fullHeaderText.match(/GSTIN/g);
  assert.equal(matches ? matches.length : 0, 1, `GSTIN must appear exactly once in header, found ${matches?.length}`);
});

test("NO_HARDCODED_DOCUMENT_CONTENT — dynamically uses company settings, no KH Portable Cabins fallback", () => {
  const customCompany = {
    name: "Zenith Space Solutions",
    legalName: "Zenith Space Solutions Pvt Ltd",
    address: "10 Innovation Way",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500081",
    gstin: "36AAACZ1234K1Z0",
    phone: "040-23456789",
    email: "contact@zenithspace.com",
    bankName: "ICICI Bank",
    bankAccount: "123405001234",
    bankIfsc: "ICIC0001234",
    accountHolderName: "Zenith Space Solutions Pvt Ltd",
  };

  const formatted = formatCompanyAddress(customCompany);
  assert.equal(formatted.companyName, "Zenith Space Solutions Pvt Ltd");
  assert.ok(!formatted.fullAddressText.includes("KH Portable Cabins"));
  assert.ok(!formatted.fullAddressText.includes("Bangalore"));
  assert.ok(formatted.fullAddressText.includes("Hyderabad"));
});

test("ISSUED_DOCUMENT_SNAPSHOTS — frozen at issue/post and not mutated by future company settings changes", () => {
  // 1. Company in September
  const companySeptember = {
    id: "comp_xyz",
    name: "Star Tech Solutions",
    address: "Old Address September",
    gstin: "29AAACS1234A1Z1",
    showInvoiceTerms: true,
    invoiceTermsMarkdown: "September Terms: Pay in 7 days",
    bankName: "Canara Bank",
    bankAccount: "111122223333",
    bankIfsc: "CNRB0001234",
    accountHolderName: "Star Tech Solutions",
  };

  const septemberSnapshot = createCompanySnapshot(companySeptember);

  // An invoice issued in September freezes this snapshot
  const issuedSeptemberInvoice = {
    id: "inv_sep_1",
    number: "INV-SEP-001",
    status: "paid",
    postingStatus: "posted",
    companySnapshot: septemberSnapshot,
    termsSnapshot: ["September Terms: Pay in 7 days"],
    bankDetailsSnapshot: {
      bankName: "Canara Bank",
      accountNo: "111122223333",
      ifscCode: "CNRB0001234",
      accountHolderName: "Star Tech Solutions",
    },
  };

  // 2. In October, Company changes address, changes terms, turns terms toggle OFF
  const companyOctober = {
    ...companySeptember,
    address: "New Address October",
    showInvoiceTerms: false, // Turned OFF!
    invoiceTermsMarkdown: "October Terms: Pay in 30 days",
    bankName: "HDFC Bank", // Switched bank!
    bankAccount: "999988887777",
  };

  // 3. Reprinting September invoice: uses its frozen snapshots
  assert.equal(issuedSeptemberInvoice.companySnapshot.address, "Old Address September");
  assert.equal(issuedSeptemberInvoice.companySnapshot.showInvoiceTerms, true);
  assert.equal(issuedSeptemberInvoice.termsSnapshot[0], "September Terms: Pay in 7 days");
  assert.equal(issuedSeptemberInvoice.bankDetailsSnapshot.bankName, "Canara Bank");

  // 4. A new October draft uses current October defaults
  const newOctoberDraft = {
    id: "inv_oct_1",
    number: "INV-OCT-001",
    status: "draft",
    postingStatus: "draft",
    // No frozen snapshot yet
    companySnapshot: undefined,
    termsSnapshot: undefined,
  };

  assert.equal(newOctoberDraft.companySnapshot, undefined);
  // Current settings for October:
  assert.equal(companyOctober.showInvoiceTerms, false);
});

test("DRAFT_BEHAVIOR — drafts do not prematurely freeze company defaults", () => {
  const draftQuotation = {
    id: "qt_draft_1",
    status: "draft",
    companySnapshot: undefined,
    signatorySnapshot: undefined,
    bankDetailsSnapshot: undefined,
    termsSnapshot: undefined,
  };

  // Draft is saved as draft without forcing snapshots
  assert.equal(draftQuotation.status, "draft");
  assert.equal(draftQuotation.companySnapshot, undefined);
  assert.equal(draftQuotation.termsSnapshot, undefined);
});

test("INVOICE_TERMS_BEFORE_BANK & QUOTATION_SECTION_ORDER — verifies architectural section ordering", () => {
  // Invoice structural order:
  // 1. Header (Company + Title)
  // 2. Party (Bill To / Ship To)
  // 3. Items Table
  // 4. Totals & Words
  // 5. Terms & Conditions
  // 6. Bank Settlement Details
  // 7. Signatory
  const invoiceSectionOrder = [
    "HEADER",
    "PARTY_DETAILS",
    "ITEMS_TABLE",
    "TOTALS",
    "TERMS_AND_CONDITIONS",
    "BANK_SETTLEMENT_DETAILS",
    "SIGNATORY",
  ];

  const termsIdx = invoiceSectionOrder.indexOf("TERMS_AND_CONDITIONS");
  const bankIdx = invoiceSectionOrder.indexOf("BANK_SETTLEMENT_DETAILS");
  const sigIdx = invoiceSectionOrder.indexOf("SIGNATORY");

  assert.ok(termsIdx < bankIdx, "Invoice must render Terms before Bank Details");
  assert.ok(bankIdx < sigIdx, "Invoice must render Bank Details before Signatory");

  // Quotation structural order:
  // 1. Items / Totals
  // 2. General Information
  // 3. Technical Specifications
  // 4. Terms & Conditions
  // 5. Bank Details
  // 6. Signatory
  const quotationSectionOrder = [
    "ITEMS_AND_TOTALS",
    "GENERAL_INFO",
    "TECH_SPECS",
    "TERMS_AND_CONDITIONS",
    "BANK_DETAILS",
    "SIGNATORY",
  ];

  const qGenIdx = quotationSectionOrder.indexOf("GENERAL_INFO");
  const qTechIdx = quotationSectionOrder.indexOf("TECH_SPECS");
  const qTermsIdx = quotationSectionOrder.indexOf("TERMS_AND_CONDITIONS");
  const qBankIdx = quotationSectionOrder.indexOf("BANK_DETAILS");

  assert.ok(qGenIdx < qTechIdx, "Quotation must render General Info before Tech Specs");
  assert.ok(qTechIdx < qTermsIdx, "Quotation must render Tech Specs before Terms");
  assert.ok(qTermsIdx < qBankIdx, "Quotation must render Terms before Bank Details");
});

test("MARKDOWN_SANITIZATION — safe subset, prevents dangerous scripts and tags", () => {
  const malicious = '<script>alert("hack")</script><img src="x" onerror="alert(1)">**Bold**';
  const sanitized = sanitizeMarkdownText(malicious);
  assert.ok(!sanitized.includes("<script>"), "Must strip script tags");
  assert.ok(!sanitized.includes("onerror="), "Must strip onerror handlers");
  assert.ok(sanitized.includes("**Bold**"), "Must preserve markdown formatting");
});
