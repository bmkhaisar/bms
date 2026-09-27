import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  resolveDocumentModel,
  resolveEffectiveCompany,
  resolveCanonicalBankDetails,
  isDocumentFinalized,
} from "../src/lib/documentModel.ts";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("1. Company Name Update — Draft document resolves latest saved company settings ('KH Portable Cabins')", () => {
  const previousSnapshot = {
    name: "KH Aluminium Cabins",
    legalName: "KH Aluminium Cabins LLP",
    address: "Old Industrial Area, Sector 5",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstin: "27AAAAA0000A1Z5",
    phone: "9123456780",
    bankName: "State Bank of India",
    bankAccountNo: "111122223333",
    bankIfsc: "SBIN0001234",
  };

  const latestCompany = {
    id: "comp_kh_1",
    name: "KH Portable Cabins",
    legalName: "KH Portable Cabins Private Limited",
    address: "New Tech Park, Phase 1",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411057",
    gstin: "27BBBBB1111B1Z9",
    phone: "9876543210",
    mobile: "9876543210",
    email: "info@khportablecabins.com",
    bankName: "HDFC Bank",
    bankAccountNo: "50200099887766",
    bankAccount: "50200099887766",
    bankIfsc: "HDFC0004321",
    bankBranch: "Hinjawadi",
    accountHolderName: "KH Portable Cabins Private Limited",
    showQuotationBankDetails: true,
    showInvoiceBankDetails: true,
  };

  // Draft quotation with stale snapshot from before edit
  const draftQuotation = {
    id: "qt_test_draft",
    kind: "quotation",
    number: "QT-2026-001",
    status: "draft",
    date: Date.now(),
    subtotal: 50000,
    discountTotal: 0,
    gstTotal: 9000,
    roundOff: 0,
    grandTotal: 59000,
    items: [],
    companySnapshot: previousSnapshot,
  };

  // Draft must resolve to the latest active company settings
  const effComp = resolveEffectiveCompany(draftQuotation, latestCompany, null);
  assert.equal(effComp.name, "KH Portable Cabins");
  assert.equal(effComp.legalName, "KH Portable Cabins Private Limited");
  assert.equal(effComp.gstin, "27BBBBB1111B1Z9");
  assert.equal(effComp.city, "Pune");
  assert.equal(effComp.bankName, "HDFC Bank");
  assert.equal(effComp.bankAccountNo, "50200099887766");

  // Document model for draft must also display latest company name
  const model = resolveDocumentModel({
    doc: draftQuotation,
    activeCompany: latestCompany,
    customer: { id: "c1", name: "Client Corp", city: "Mumbai" },
  });
  assert.equal(model.company.companyName, "KH Portable Cabins Private Limited");
  assert.equal(model.company.gstin, "27BBBBB1111B1Z9");
});

test("2. Historical Snapshot Protection — Finalized/posted documents freeze and preserve historical company snapshot", () => {
  const historicalSnapshot = {
    name: "KH Aluminium Cabins",
    legalName: "KH Aluminium Cabins LLP",
    address: "Old Industrial Area, Sector 5",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstin: "27AAAAA0000A1Z5",
    phone: "9123456780",
    bankName: "State Bank of India",
    bankAccountNo: "111122223333",
    bankIfsc: "SBIN0001234",
    accountHolderName: "KH Aluminium Cabins LLP",
  };

  const latestCompany = {
    id: "comp_kh_1",
    name: "KH Portable Cabins",
    legalName: "KH Portable Cabins Private Limited",
    address: "New Tech Park, Phase 1",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411057",
    gstin: "27BBBBB1111B1Z9",
    phone: "9876543210",
  };

  // Posted invoice with historical company snapshot
  const postedInvoice = {
    id: "inv_posted_001",
    kind: "invoice",
    number: "INV-2025-099",
    postingStatus: "posted",
    status: "paid",
    voucherId: "vch_001",
    date: Date.now() - 30 * 86400000,
    subtotal: 100000,
    discountTotal: 0,
    gstTotal: 18000,
    roundOff: 0,
    grandTotal: 118000,
    items: [],
    companySnapshot: historicalSnapshot,
  };

  assert.equal(isDocumentFinalized(postedInvoice), true);

  // Even though activeCompany is "KH Portable Cabins", historical snapshot must remain "KH Aluminium Cabins"
  const effComp = resolveEffectiveCompany(postedInvoice, latestCompany, null);
  assert.equal(effComp.name, "KH Aluminium Cabins");
  assert.equal(effComp.legalName, "KH Aluminium Cabins LLP");
  assert.equal(effComp.gstin, "27AAAAA0000A1Z5");
  assert.equal(effComp.city, "Mumbai");

  const model = resolveDocumentModel({
    doc: postedInvoice,
    activeCompany: latestCompany,
    customer: { id: "c1", name: "Client Corp" },
  });
  assert.equal(model.company.companyName, "KH Aluminium Cabins LLP");
  assert.equal(model.company.gstin, "27AAAAA0000A1Z5");
});

test("3. Document Finalization Check — Identifies all draft vs finalized statuses correctly", () => {
  // Drafts
  assert.equal(isDocumentFinalized({ status: "draft" }), false);
  assert.equal(isDocumentFinalized({ status: "pending" }), false);
  assert.equal(isDocumentFinalized({ kind: "quotation", status: "draft" }), false);
  assert.equal(isDocumentFinalized({ kind: "invoice", postingStatus: "draft" }), false);
  assert.equal(isDocumentFinalized({}), false);

  // Finalized / Posted
  assert.equal(isDocumentFinalized({ postingStatus: "posted" }), true);
  assert.equal(isDocumentFinalized({ status: "posted" }), true);
  assert.equal(isDocumentFinalized({ voucherId: "vch_123" }), true);
  assert.equal(isDocumentFinalized({ kind: "quotation", status: "sent" }), true);
  assert.equal(isDocumentFinalized({ kind: "quotation", status: "accepted" }), true);
  assert.equal(isDocumentFinalized({ kind: "quotation", status: "converted" }), true);
  assert.equal(isDocumentFinalized({ kind: "invoice", status: "paid" }), true);
  assert.equal(isDocumentFinalized({ kind: "invoice", status: "unpaid" }), true);
});

test("4. Canonical Bank Details — Correct field ordering, alias resolution, and holder hierarchy", () => {
  const companyWithBank = {
    id: "comp_1",
    name: "KH Portable Cabins",
    legalName: "KH Portable Cabins Private Limited",
    bankName: "Kotak Mahindra Bank",
    bankAccountNo: "9988776655",
    bankIfsc: "KKBK0001234",
    bankBranch: "Bandra Kurla Complex",
    bankAccountType: "Current Account",
    bankSwiftCode: "KKBKINBB",
    upiId: "khcabins@kotak",
    accountHolderName: "KH Portable Cabins Private Limited",
    showQuotationBankDetails: true,
    showInvoiceBankDetails: true,
  };

  const quotationDraft = {
    id: "qt_1",
    kind: "quotation",
    number: "QT-101",
    status: "draft",
    includeBankDetails: true,
  };

  const bank = resolveCanonicalBankDetails(quotationDraft, companyWithBank, false);
  assert.ok(bank.includeBankDetails);
  assert.ok(bank.bankDetails);

  // Check canonical field presence and values
  assert.equal(bank.bankDetails.accountHolderName, "KH Portable Cabins Private Limited");
  assert.equal(bank.bankDetails.bankName, "Kotak Mahindra Bank");
  assert.equal(bank.bankDetails.accountNumber, "9988776655");
  assert.equal(bank.bankDetails.ifsc, "KKBK0001234");
  assert.equal(bank.bankDetails.branch, "Bandra Kurla Complex");
  assert.equal(bank.bankDetails.accountType, "Current Account");
  assert.equal(bank.bankDetails.swift, "KKBKINBB");
  assert.equal(bank.bankDetails.upi, "khcabins@kotak");
});

test("5. Independent Bank Toggles — Quotation vs Invoice bank visibility", () => {
  // Case A: Quotation Bank OFF, Invoice Bank ON
  const companyQuotationOff = {
    name: "KH Portable Cabins",
    bankName: "HDFC Bank",
    bankAccount: "1234567890",
    bankIfsc: "HDFC0001",
    showQuotationBankDetails: false,
    showInvoiceBankDetails: true,
  };

  const quotation = { kind: "quotation", status: "draft" };
  const invoice = { kind: "invoice", status: "draft" };

  const bankQ_A = resolveCanonicalBankDetails(quotation, companyQuotationOff, false);
  assert.equal(bankQ_A.includeBankDetails, false);
  assert.equal(bankQ_A.bankDetails, null);

  const bankI_A = resolveCanonicalBankDetails(invoice, companyQuotationOff, false);
  assert.equal(bankI_A.includeBankDetails, true);
  assert.ok(bankI_A.bankDetails);
  assert.equal(bankI_A.bankDetails.bankName, "HDFC Bank");

  // Case B: Quotation Bank ON, Invoice Bank OFF
  const companyInvoiceOff = {
    name: "KH Portable Cabins",
    bankName: "HDFC Bank",
    bankAccount: "1234567890",
    bankIfsc: "HDFC0001",
    showQuotationBankDetails: true,
    showInvoiceBankDetails: false,
  };

  const bankQ_B = resolveCanonicalBankDetails(quotation, companyInvoiceOff, false);
  assert.equal(bankQ_B.includeBankDetails, true);
  assert.ok(bankQ_B.bankDetails);

  const bankI_B = resolveCanonicalBankDetails(invoice, companyInvoiceOff, false);
  assert.equal(bankI_B.includeBankDetails, false);
  assert.equal(bankI_B.bankDetails, null);

  // Case C: Document-level override (doc.includeBankDetails = false) suppresses bank regardless
  const quotationWithOverride = {
    kind: "quotation",
    status: "draft",
    includeBankDetails: false,
  };
  const bankQ_C = resolveCanonicalBankDetails(quotationWithOverride, companyInvoiceOff, false);
  assert.equal(bankQ_C.includeBankDetails, false);
  assert.equal(bankQ_C.bankDetails, null);
});

test("6. Complete Hiding — When bank is OFF, details are not deleted from settings and section is omitted", () => {
  const company = {
    id: "comp_1",
    name: "KH Portable Cabins",
    bankName: "Axis Bank",
    bankAccount: "98765432101234",
    bankIfsc: "UTIB0000001",
    accountHolderName: "KH Portable Cabins",
    showQuotationBankDetails: false,
  };

  const quotation = {
    id: "qt_test",
    kind: "quotation",
    number: "QT-200",
    status: "draft",
    date: Date.now(),
    subtotal: 10000,
    discountTotal: 0,
    gstTotal: 1800,
    roundOff: 0,
    grandTotal: 11800,
    items: [],
  };

  const model = resolveDocumentModel({
    doc: quotation,
    activeCompany: company,
  });

  // Section completely hidden in model
  assert.equal(model.includeBankDetails, false);
  assert.equal(model.bankDetails, null);

  // Company settings still intact
  assert.equal(company.bankName, "Axis Bank");
  assert.equal(company.bankAccount, "98765432101234");
});

test("7. Zero Hardcoded Stale Company Names in Source Code", () => {
  const filesToCheck = [
    "src/lib/documentRenderer.ts",
    "src/lib/quotationExport.ts",
    "src/lib/documentModel.ts",
    "src/components/app/QuotationQuickPreviewModal.tsx",
    "src/components/app/DocumentPrint.tsx",
  ];

  for (const file of filesToCheck) {
    const content = read(file);
    assert.doesNotMatch(
      content,
      /KH Aluminium Cabins/,
      `Found stale hardcoded company name in ${file}`
    );
  }
});

test("8. Realtime Invalidation & Synchronization Architecture", () => {
  const syncFile = read("src/modules/sync/companyRealtimeSync.ts");
  const settingsFile = read("src/routes/_app.settings.tsx");
  const modalFile = read("src/components/app/QuotationQuickPreviewModal.tsx");
  const docListFile = read("src/components/app/DocumentListPage.tsx");
  const quotesPageFile = read("src/components/app/QuotationsPage.tsx");

  // Realtime sync listens to Firebase RTDB companies path and updates Dexie + dispatches event
  assert.match(syncFile, /companies\/\$\{companyId\}/);
  assert.match(syncFile, /bms:company-settings-updated/);

  // Settings page dispatches custom event on save
  assert.match(settingsFile, /bms:company-settings-updated/);

  // Document lists and preview modals listen to the custom event for instant re-render without F5
  assert.match(modalFile, /bms:company-settings-updated/);
  assert.match(docListFile, /bms:company-settings-updated/);
  assert.match(quotesPageFile, /bms:company-settings-updated/);
});

test("9. Canonical PDF Data Source & Blob Reuse", () => {
  const docListFile = read("src/components/app/DocumentListPage.tsx");

  // Reuses exact generated Blob when downloading from preview without regenerating or layout drift
  assert.match(docListFile, /previewPdfBlob/);
  assert.match(docListFile, /downloadDocumentPDF\(normDoc,\s*`\$\{preview\.number\}\.pdf`,\s*previewPdfBlob\)/);

  // Both quotation and document renderers share resolveEffectiveCompany and resolveCanonicalBankDetails
  const rendererFile = read("src/lib/documentRenderer.ts");
  const quoteExportFile = read("src/lib/quotationExport.ts");

  assert.match(rendererFile, /resolveCanonicalBankDetails/);
  assert.match(rendererFile, /resolveEffectiveCompany/);
  assert.match(quoteExportFile, /resolveCanonicalBankDetails/);
  assert.match(quoteExportFile, /resolveEffectiveCompany/);
});

test("10. Quotation Quick Preview — Timeout, Safe Cancellation, Retry, and Blob Reuse", () => {
  const modalFile = read("src/components/app/QuotationQuickPreviewModal.tsx");
  const exportFile = read("src/lib/quotationExport.ts");

  // Failsafe timeout against infinite spinner
  assert.match(modalFile, /timeoutTimer/);
  assert.match(modalFile, /10000/);

  // Safe cancellation on close / unmount
  assert.match(modalFile, /isCancelled/);
  assert.match(modalFile, /clearTimeout\(timeoutTimer\)/);
  assert.match(modalFile, /clearTimeout\(debounceTimer\)/);

  // Retry Preview button
  assert.match(modalFile, /Retry Preview/);
  assert.match(modalFile, /setRetryCount/);

  // Existing Blob reuse in download & print
  assert.match(exportFile, /existingBlob\?: Blob \| null/);
  assert.match(modalFile, /triggerDownload\(blobToDownload,\s*`\$\{currentQuotation\.number\}\.pdf`\)/);
});

test("11. Controlled Revision / Reissue for Frozen Historical Quotations (QT/2026-27/0019 Scenario)", () => {
  const modalFile = read("src/components/app/QuotationQuickPreviewModal.tsx");

  // Explicit detection of stale frozen snapshot
  assert.match(modalFile, /isSnapshotStale/);
  assert.match(modalFile, /Historical Snapshot:/);

  // Controlled action to update profile to latest active company
  assert.match(modalFile, /handleReissueWithLatestCompany/);
  assert.match(modalFile, /createCompanySnapshot\(activeCompany\)/);
  assert.match(modalFile, /authoritativeSaveEntity/);

  // Scenario test: QT/2026-27/0019 historical snapshot
  const historicalQt = {
    id: "qt_0019",
    number: "QT/2026-27/0019",
    status: "sent",
    companySnapshot: {
      name: "KH Aluminium Cabins",
      legalName: "KH Aluminium Cabins LLP",
    },
  };
  const activeComp = {
    id: "comp_1",
    name: "KH Portable Cabins",
    legalName: "KH Portable Cabins Private Limited",
  };

  const isFinalized = isDocumentFinalized(historicalQt);
  assert.equal(isFinalized, true);

  const effHistorical = resolveEffectiveCompany(historicalQt, activeComp, null);
  assert.equal(effHistorical.name, "KH Aluminium Cabins");

  const snapName = historicalQt.companySnapshot?.name;
  const activeName = activeComp.name;
  const isStale = Boolean(isFinalized && snapName && activeName && snapName.toLowerCase() !== activeName.toLowerCase());
  assert.equal(isStale, true);
});

test("12. Safe Image URL Resolution with Timeout & AbortController", () => {
  const logoDataFile = read("src/lib/logoData.ts");
  const quoteExportFile = read("src/lib/quotationExport.ts");

  // safeResolveImageDataUrl exists with AbortController timeout
  assert.match(logoDataFile, /export async function safeResolveImageDataUrl/);
  assert.match(logoDataFile, /AbortController/);
  assert.match(logoDataFile, /timeoutMs/);

  // quotationExport uses safeResolveImageDataUrl for logo, signature, and stamp
  assert.match(quoteExportFile, /safeResolveImageDataUrl\(rawLogo,\s*2500\)/);
  assert.match(quoteExportFile, /safeResolveImageDataUrl\(resolved\.signatureUrl,\s*2500\)/);
  assert.match(quoteExportFile, /safeResolveImageDataUrl\(resolved\.stampUrl,\s*2500\)/);
});

test("13. QT/2026-27/0020 Scenario — Uppercase DRAFT status must not preserve stale historical snapshot, strictly uses active company", () => {
  const draftWithOldSnapshot = {
    id: "qt_0020",
    number: "QT/2026-27/0020",
    status: "DRAFT", // Uppercase as shown in user screenshot
    date: Date.now(),
    subtotal: 150000,
    grandTotal: 177000,
    items: [],
    companySnapshot: {
      name: "KH Aluminium Cabins",
      legalName: "KH Aluminium Cabins LLP",
      address: "Old Industrial Area",
      gstin: "27OLD00000001Z1",
    },
  };

  const activeComp = {
    id: "comp_1",
    name: "KH Portable Cabins",
    legalName: "KH Portable Cabins",
    address: "Plot 42, Modern Industrial Park",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400072",
    gstin: "27BBBBB1111B1Z9",
    phone: "9876543210",
    email: "contact@khportablecabins.com",
    bankName: "HDFC Bank",
    bankAccountNo: "50200099887766",
    bankIfsc: "HDFC0004321",
    showQuotationBankDetails: true,
  };

  // Must not be considered finalized
  assert.equal(isDocumentFinalized(draftWithOldSnapshot), false);

  // Effective company must resolve to KH Portable Cabins, completely ignoring the stale snapshot
  const effComp = resolveEffectiveCompany(draftWithOldSnapshot, activeComp, null);
  assert.equal(effComp.name, "KH Portable Cabins");
  assert.equal(effComp.legalName, "KH Portable Cabins");
  assert.equal(effComp.gstin, "27BBBBB1111B1Z9");
  assert.equal(effComp.bankName, "HDFC Bank");
  assert.equal(effComp.bankAccountNo, "50200099887766");

  // Document model must also reflect KH Portable Cabins
  const model = resolveDocumentModel({
    doc: draftWithOldSnapshot,
    activeCompany: activeComp,
    customer: { id: "c1", name: "Valued Customer" },
  });
  assert.equal(model.company.companyName, "KH Portable Cabins");
  assert.equal(model.company.gstin, "27BBBBB1111B1Z9");
  assert.equal(model.bankDetails.bankName, "HDFC Bank");
  assert.equal(model.bankDetails.accountNumber, "50200099887766");
});


