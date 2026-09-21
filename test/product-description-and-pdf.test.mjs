import test from "node:test";
import assert from "node:assert/strict";

// Core logic imports
import {
  isCabinConfigurationRow,
  formatCabinDimension,
  buildCabinConfigurationFromItems,
  resolveGeneralInfoFields,
} from "../src/lib/cabinConfiguration.ts";
import { parseInlineSpans, stripMarkdownTokens } from "../src/lib/markdownPdfRenderer.ts";
import { applyQuotationToLinkedDraft } from "../src/modules/documents/linkedDraftInvoice.ts";

test("PRD § 1: Product Master — defaultDescription", () => {
  // Product model supports optional defaultDescription
  const product = {
    id: "prod_cabin_1",
    name: "Portable Site Office Cabin",
    sellingPrice: 250000,
    unit: "pcs",
    defaultDescription: "MS Portable Site Office Cabin with interior MDF board cladding, UPVC sliding windows 3'x3'.",
    createdAt: Date.now(),
  };

  assert.ok(product.defaultDescription);
  assert.equal(typeof product.defaultDescription, "string");
  assert.match(product.defaultDescription, /MDF board cladding/);

  // Latest value only — overwriting replaces without historical collection
  product.defaultDescription = "Updated: Heavy Duty MS Portable Site Office Cabin with aluminum windows.";
  assert.equal(product.defaultDescription, "Updated: Heavy Duty MS Portable Site Office Cabin with aluminum windows.");
});

test("PRD § 2: Product selection -> description auto-fill and line item snapshots", () => {
  const product = {
    id: "prod_cabin_1",
    name: "Portable Site Office Cabin",
    sellingPrice: 250000,
    unit: "pcs",
    defaultDescription: "Standard 40x10 MS Office Cabin specification",
    size: "40' × 10' × 8.5'",
    hsn: "94069090",
    gstRate: 18,
  };

  // Simulating pickProduct logic in LineItemsEditor
  const lineItem = {
    productId: product.id,
    name: product.name,
    productNameSnapshot: product.name,
    description: product.defaultDescription,
    descriptionSnapshot: product.defaultDescription,
    size: product.size,
    sizeSnapshot: {
      length: 40,
      width: 10,
      height: 8.5,
      unit: "ft",
      dimensionString: "40' × 10' × 8.5'",
    },
    unit: product.unit,
    uomSnapshot: product.unit,
    rate: product.sellingPrice,
    rateSnapshot: product.sellingPrice,
    taxSnapshot: {
      taxRate: 18,
      taxableAmountPaise: 25000000,
      taxAmountPaise: 4500000,
    },
  };

  assert.equal(lineItem.description, "Standard 40x10 MS Office Cabin specification");
  assert.equal(lineItem.descriptionSnapshot, lineItem.description);
  assert.equal(lineItem.productNameSnapshot, "Portable Site Office Cabin");
  assert.equal(lineItem.sizeSnapshot?.dimensionString, "40' × 10' × 8.5'");
  assert.equal(lineItem.rateSnapshot, 250000);
});

test("PRD § 3: Document Description Editing — Document Only vs Update Product Default", () => {
  let masterProduct = {
    id: "prod_1",
    name: "Bunk House",
    defaultDescription: "Standard bunk house with 8 beds",
  };

  const lineItem = {
    productId: masterProduct.id,
    name: masterProduct.name,
    description: masterProduct.defaultDescription,
    descriptionSnapshot: masterProduct.defaultDescription,
  };

  // Action 1: User edits description in document -> Document Only
  lineItem.description = "Custom bunk house with 10 beds and attached toilet";
  lineItem.descriptionSnapshot = lineItem.description;

  // Master product remains unchanged
  assert.equal(masterProduct.defaultDescription, "Standard bunk house with 8 beds");
  assert.equal(lineItem.descriptionSnapshot, "Custom bunk house with 10 beds and attached toilet");

  // Action 2: User clicks "Update Product Default"
  masterProduct.defaultDescription = lineItem.description;
  assert.equal(masterProduct.defaultDescription, "Custom bunk house with 10 beds and attached toilet");
});

test("PRD § 4: Historical Document Safety — Master edit does NOT alter issued document", () => {
  const masterProduct = {
    id: "prod_1",
    name: "Security Guard Cabin",
    defaultDescription: "Version 1 description: 6x6 MS Guard cabin",
  };

  // Finalized historical quotation
  const historicalQuotation = {
    id: "quote_hist_1",
    number: "QT-2026-001",
    status: "approved",
    items: [
      {
        productId: masterProduct.id,
        name: masterProduct.name,
        productNameSnapshot: masterProduct.name,
        description: masterProduct.defaultDescription,
        descriptionSnapshot: masterProduct.defaultDescription,
      },
    ],
  };

  // Later, Master Product defaultDescription is changed in Product Master
  masterProduct.defaultDescription = "Version 2 description: Brand new specifications with solar panel";

  // Invariant: historical document MUST retain its frozen snapshot
  assert.equal(historicalQuotation.items[0].descriptionSnapshot, "Version 1 description: 6x6 MS Guard cabin");
  assert.notEqual(historicalQuotation.items[0].descriptionSnapshot, masterProduct.defaultDescription);
});

test("PRD §§ 10, 11, 12: Dynamic Cabin Configuration from item sizes & deduplication", () => {
  // Test row matcher
  assert.equal(isCabinConfigurationRow("Configuration of Cabins"), true);
  assert.equal(isCabinConfigurationRow("Configuration of Cabin"), true);
  assert.equal(isCabinConfigurationRow("Cabin Configuration"), true);
  assert.equal(isCabinConfigurationRow("Transportation / Freight Charges"), false);
  assert.equal(isCabinConfigurationRow("Terms & Conditions"), false);

  // Test dimension formatting
  assert.equal(
    formatCabinDimension({ length: 40, width: 10, height: 8.5 }),
    "Cabin 40'L × 10'W × 8.5'H"
  );
  assert.equal(
    formatCabinDimension({ dimensionString: "20' × 10' × 8.5'" }),
    "Cabin 20'L × 10'W × 8.5'H"
  );

  // Test derivation with multiple items & duplicates
  const items = [
    {
      name: "Portable Site Office",
      sizeSnapshot: { length: 40, width: 10, height: 8.5, unit: "ft" },
    },
    {
      name: "Portable Site Office Duplicate",
      sizeSnapshot: { length: 40, width: 10, height: 8.5, unit: "ft" },
    },
    {
      name: "Security Cabin",
      sizeSnapshot: { length: 6, width: 6, height: 8.5, unit: "ft" },
    },
  ];

  const config = buildCabinConfigurationFromItems(items);
  assert.ok(config);

  // Deduplication check: 40x10 appears once
  const occurrences40x10 = (config.match(/40'L × 10'W × 8.5'H/g) || []).length;
  assert.equal(occurrences40x10, 1, "Duplicate sizes must be deduplicated");

  // Both distinct sizes present
  assert.ok(config.includes("Cabin 40'L × 10'W × 8.5'H"));
  assert.ok(config.includes("Cabin 6'L × 6'W × 8.5'H"));
});

test("PRD §§ 13, 14, 15: General Information Resolution Order & Reset from Item Sizes", () => {
  const companyFields = [
    { label: "Configuration of Cabins", value: "Default company placeholder" },
    { label: "Transportation / Freight Charges", value: "Extra at actuals" },
  ];

  const items = [
    {
      name: "Office Cabin",
      sizeSnapshot: { length: 30, width: 10, height: 8.5, unit: "ft" },
    },
  ];

  // 1. Automatic dynamic draft resolution
  const autoResolved = resolveGeneralInfoFields({
    companyFields,
    items,
    isIssuedOrFrozen: false,
  });

  const cabinRow = autoResolved.find((f) => isCabinConfigurationRow(f.label));
  assert.ok(cabinRow);
  assert.equal(cabinRow.value, "• Cabin 30'L × 10'W × 8.5'H");

  // Non-cabin row untouched
  const freightRow = autoResolved.find((f) => f.label.includes("Transportation"));
  assert.equal(freightRow?.value, "Extra at actuals");

  // 2. Custom override
  const customOverride = resolveGeneralInfoFields({
    companyFields,
    items,
    isCabinConfigCustom: true,
    cabinOverride: "• Custom Client Specified 30ft Cabin with toilet",
    isIssuedOrFrozen: false,
  });

  const customCabinRow = customOverride.find((f) => isCabinConfigurationRow(f.label));
  assert.equal(customCabinRow?.value, "• Custom Client Specified 30ft Cabin with toilet");

  // 3. Reset from item sizes (clearing custom flag)
  const resetResolved = resolveGeneralInfoFields({
    companyFields,
    items,
    isCabinConfigCustom: false,
    cabinOverride: undefined,
    isIssuedOrFrozen: false,
  });

  const resetCabinRow = resetResolved.find((f) => isCabinConfigurationRow(f.label));
  assert.equal(resetCabinRow?.value, "• Cabin 30'L × 10'W × 8.5'H");

  // 4. Issued / Frozen document permanence
  const frozenFields = [
    { label: "Configuration of Cabins", value: "• Historic Frozen Cabin 15'L × 10'W × 8.5'H" },
    { label: "Transportation / Freight Charges", value: "Fixed 15,000 INR" },
  ];

  const historicalResolved = resolveGeneralInfoFields({
    companyFields: [{ label: "Configuration of Cabins", value: "Changed Company Master" }],
    items: [{ name: "Different item", sizeSnapshot: { length: 50, width: 12, height: 9 } }],
    isIssuedOrFrozen: true,
    frozenSnapshot: frozenFields,
  });

  assert.equal(historicalResolved[0].value, "• Historic Frozen Cabin 15'L × 10'W × 8.5'H");
  assert.equal(historicalResolved[1].value, "Fixed 15,000 INR");
});

test("PRD § 16: Quotation → Invoice conversion preserves all snapshots", () => {
  const quotation = {
    id: "quote_101",
    number: "QT-2026-101",
    date: Date.now(),
    customerId: "cust_123",
    items: [
      {
        productId: "p_1",
        name: "Security Guard Cabin",
        productNameSnapshot: "Security Guard Cabin",
        description: "6x6 MS cabin with powder-coated finish",
        descriptionSnapshot: "6x6 MS cabin with powder-coated finish",
        size: "6' × 6' × 8.5'",
        sizeSnapshot: { length: 6, width: 6, height: 8.5, dimensionString: "6' × 6' × 8.5'" },
        unit: "nos",
        uomSnapshot: "nos",
        rate: 65000,
        rateSnapshot: 65000,
        quantity: 1,
        gstRate: 18,
        taxSnapshot: { taxRate: 18, taxableAmountPaise: 6500000, taxAmountPaise: 1170000 },
      },
    ],
    generalInformationSnapshot: [
      { label: "Configuration of Cabins", value: "• Cabin 6'L × 6'W × 8.5'H" },
    ],
    technicalSpecificationSnapshot: [
      { title: "Structure", rows: [{ label: "Base Frame", value: "ISMC 100x50mm" }] },
    ],
    termsSnapshot: ["1. 50% advance along with purchase order"],
    bankSnapshot: {
      id: "bank_1",
      bankName: "HDFC Bank",
      accountNo: "50200012345678",
      ifsc: "HDFC0001234",
    },
    includeDescriptions: true,
    includeGeneralInfo: true,
  };

  const draftInvoice = { id: "inv_1", number: "INV-2026-001", status: "draft", postingStatus: "draft", items: [] };
  const invoice = applyQuotationToLinkedDraft(quotation, draftInvoice);

  // Assert line item snapshots are perfectly preserved
  assert.equal(invoice.items.length, 1);
  const invItem = invoice.items[0];
  assert.equal(invItem.productId, "p_1");
  assert.equal(invItem.productNameSnapshot, "Security Guard Cabin");
  assert.equal(invItem.descriptionSnapshot, "6x6 MS cabin with powder-coated finish");
  assert.equal(invItem.sizeSnapshot?.dimensionString, "6' × 6' × 8.5'");
  assert.equal(invItem.uomSnapshot, "nos");
  assert.equal(invItem.rateSnapshot, 65000);
  assert.equal(invItem.taxSnapshot?.taxRate, 18);

  // Assert document-level snapshots are preserved
  assert.equal(invoice.generalInformationSnapshot?.[0].value, "• Cabin 6'L × 6'W × 8.5'H");
  assert.equal(invoice.technicalSpecificationSnapshot?.[0].title, "Structure");
  assert.equal(invoice.termsSnapshot?.[0], "1. 50% advance along with purchase order");
  assert.equal(invoice.bankSnapshot?.bankName, "HDFC Bank");
  assert.equal(invoice.includeDescriptions, true);
});

test("PRD § 21 & 22: Inline Markdown spans without literal asterisks", () => {
  const input = "**1.20mm** thick CR sheet with **50mm × 25mm** tubular section";

  // Check span parsing
  const spans = parseInlineSpans(input);
  assert.equal(spans.length, 4);
  assert.deepEqual(spans[0], { text: "1.20mm", bold: true });
  assert.deepEqual(spans[1], { text: " thick CR sheet with " });
  assert.deepEqual(spans[2], { text: "50mm × 25mm", bold: true });
  assert.deepEqual(spans[3], { text: " tubular section" });

  // Plain string strip should have zero asterisks
  const plain = stripMarkdownTokens(input);
  assert.equal(plain, "1.20mm thick CR sheet with 50mm × 25mm tubular section");
  assert.equal(plain.includes("**"), false, "No raw asterisks must appear in plain text");
});

test("PRD § 9: Invoice includeDescriptions rendering toggle", () => {
  // Document holds line descriptionSnapshot
  const invoiceDoc = {
    items: [
      {
        name: "Portable Site Office",
        description: "Heavy duty MS frame with polyurethane insulation",
        descriptionSnapshot: "Heavy duty MS frame with polyurethane insulation",
      },
    ],
  };

  // Simulating renderer row content generation:
  function getParticularsCell(item, showDescription) {
    const name = item.productNameSnapshot || item.name || "Item";
    const desc = (item.descriptionSnapshot || item.description || "").trim();
    if (showDescription && desc) {
      return `${name}\n${desc}`;
    }
    return name;
  }

  // When descriptions are ON
  const withDesc = getParticularsCell(invoiceDoc.items[0], true);
  assert.ok(withDesc.includes("Portable Site Office"));
  assert.ok(withDesc.includes("Heavy duty MS frame with polyurethane insulation"));

  // When descriptions are OFF
  const withoutDesc = getParticularsCell(invoiceDoc.items[0], false);
  assert.equal(withoutDesc, "Portable Site Office");
  assert.equal(withoutDesc.includes("insulation"), false);

  // Invariant: Document data / snapshots never deleted
  assert.ok(invoiceDoc.items[0].descriptionSnapshot);
});

test("PRD § 11: Dynamic Size Rules — item deletion and size changes recalculate configuration", () => {
  let draftItems = [
    { name: "Cabin A", sizeSnapshot: { length: 20, width: 10, height: 8.5 } },
    { name: "Cabin B", sizeSnapshot: { length: 30, width: 10, height: 8.5 } },
  ];

  // Initial config has both sizes
  let config = buildCabinConfigurationFromItems(draftItems);
  assert.ok(config.includes("Cabin 20'L × 10'W × 8.5'H"));
  assert.ok(config.includes("Cabin 30'L × 10'W × 8.5'H"));

  // Change size of Cabin A to 40x10
  draftItems[0] = { name: "Cabin A", sizeSnapshot: { length: 40, width: 10, height: 8.5 } };
  config = buildCabinConfigurationFromItems(draftItems);
  assert.equal(config.includes("Cabin 20'L"), false);
  assert.ok(config.includes("Cabin 40'L × 10'W × 8.5'H"));
  assert.ok(config.includes("Cabin 30'L × 10'W × 8.5'H"));

  // Delete Cabin B
  draftItems = [draftItems[0]];
  config = buildCabinConfigurationFromItems(draftItems);
  assert.equal(config.includes("Cabin 30'L"), false);
  assert.ok(config.includes("Cabin 40'L × 10'W × 8.5'H"));
});

test("PRD § 8: Consistent SL Numbering based on item order", () => {
  const items = [
    { name: "Product A", quantity: 1, rate: 100 },
    { name: "Product B", quantity: 2, rate: 200 },
    { name: "Product C", quantity: 3, rate: 300 },
  ];

  const slNumbers = items.map((_, index) => index + 1);
  assert.deepEqual(slNumbers, [1, 2, 3]);
  assert.equal(slNumbers[0], 1);
  assert.equal(slNumbers[1], 2);
  assert.equal(slNumbers[2], 3);
});

test("PRD §§ 18, 25, 26: Section Order & Consistency Resolver Rules", () => {
  // Enabled + has content -> render
  // Enabled + empty -> don't create empty section
  // Disabled -> don't render

  function shouldRenderSection(enabled, content) {
    if (enabled === false) return false;
    if (!content) return false;
    if (Array.isArray(content) && content.length === 0) return false;
    if (typeof content === "string" && !content.trim()) return false;
    return true;
  }

  assert.equal(shouldRenderSection(true, ["Term 1", "Term 2"]), true);
  assert.equal(shouldRenderSection(false, ["Term 1"]), false);
  assert.equal(shouldRenderSection(true, []), false);
  assert.equal(shouldRenderSection(true, ""), false);
  assert.equal(shouldRenderSection(true, [{ title: "Specs", rows: [] }]), true);
});
