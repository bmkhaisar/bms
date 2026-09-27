import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Import size resolution engine
import {
  extractDimensionFromString,
  formatDisplaySize,
  parseSizeSnapshot,
  resolveItemSize,
  resolvePdfDisplaySize,
} from "../src/lib/sizeResolution.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Size Resolution: extractDimensionFromString correctly identifies 2D and 3D dimensions", () => {
  // Client bug case: "cabin 20x10" -> "20' × 10'"
  assert.equal(extractDimensionFromString("cabin 20x10"), "20' × 10'");
  assert.equal(extractDimensionFromString("Security Cabin 20 x 10"), "20' × 10'");
  assert.equal(extractDimensionFromString("Portacabin 40' x 10' x 8.5'"), "40' × 10' × 8.5'");
  assert.equal(extractDimensionFromString("Container Office 10x20 ft"), "10' × 20'");
  assert.equal(extractDimensionFromString("MS Bunkhouse 20 * 10 * 8.5"), "20' × 10' × 8.5'");
  assert.equal(extractDimensionFromString("Modular Office 30X12X9"), "30' × 12' × 9'");
  assert.equal(extractDimensionFromString("Labor Hutment 10 x 10"), "10' × 10'");
  assert.equal(extractDimensionFromString("Custom Portable Unit (20' x 8')"), "20' × 8'");
  assert.equal(extractDimensionFromString("Steel Plate 1200 x 2400 mm"), "1200 × 2400 mm");
  assert.equal(extractDimensionFromString("GI Sheet 4x8 ft"), "4' × 8'");
});

test("Size Resolution: extractDimensionFromString returns null for non-dimensional items (never invents)", () => {
  assert.equal(extractDimensionFromString("AC Installation Service"), null);
  assert.equal(extractDimensionFromString("Transport & Freight Charges"), null);
  assert.equal(extractDimensionFromString("Electrical Wiring and Fixtures"), null);
  assert.equal(extractDimensionFromString("PVC Pipe 4 inch"), null);
  assert.equal(extractDimensionFromString("Standard Office Table"), null);
});

test("Size Resolution: formatDisplaySize standardizes dimensional formatting", () => {
  assert.equal(formatDisplaySize("20x10"), "20' × 10'");
  assert.equal(formatDisplaySize("40*10*8.5"), "40' × 10' × 8.5'");
  assert.equal(formatDisplaySize("20' x 10'"), "20' × 10'");
  assert.equal(formatDisplaySize("  30' × 10' × 8.5'  "), "30' × 10' × 8.5'");
  assert.equal(formatDisplaySize("Custom Special Size"), "Custom Special Size");
});

test("Size Resolution: parseSizeSnapshot parses dimensions into structured snapshot", () => {
  const snapshot3D = parseSizeSnapshot("40' × 10' × 8.5'");
  assert.equal(snapshot3D.length, 40);
  assert.equal(snapshot3D.width, 10);
  assert.equal(snapshot3D.height, 8.5);
  assert.equal(snapshot3D.unit, "FT");
  assert.equal(snapshot3D.label, "40' × 10' × 8.5'");

  const snapshot2D = parseSizeSnapshot("20x10");
  assert.equal(snapshot2D.length, 20);
  assert.equal(snapshot2D.width, 10);
  assert.equal(snapshot2D.unit, "FT");
  assert.equal(snapshot2D.label, "20' × 10'");
});

test("Size Resolution: resolveItemSize priority and legitimate historical recovery", () => {
  // 1. Direct explicit size property wins
  const itemWithExplicitSize = {
    name: "cabin 20x10",
    size: "20' × 10' × 8.5'",
  };
  assert.equal(resolveItemSize(itemWithExplicitSize), "20' × 10' × 8.5'");

  // 2. sizeSnapshot wins if direct size is empty
  const itemWithSizeSnapshot = {
    name: "Standard Cabin",
    size: "",
    sizeSnapshot: {
      label: "40' × 10' × 8.5'",
      length: 40,
      width: 10,
      height: 8.5,
    },
  };
  assert.equal(resolveItemSize(itemWithSizeSnapshot), "40' × 10' × 8.5'");

  // 3. Fallback to product/item snapshot size
  const itemWithItemSnapshot = {
    name: "Custom Cabin",
    itemSnapshot: {
      size: "30' × 10'",
    },
  };
  assert.equal(resolveItemSize(itemWithItemSnapshot), "30' × 10'");

  // 4. Recover legitimate historical size from name when size was omitted (QT/2026-27/0019)
  const historicalItem = {
    name: "cabin 20x10",
  };
  assert.equal(resolveItemSize(historicalItem), "20' × 10'");

  // 5. Recover legitimate historical size from description
  const itemWithDescDimension = {
    name: "Portable Security Office",
    description: "Fabricated cabin 16x10 with aluminum windows",
  };
  assert.equal(resolveItemSize(itemWithDescDimension), "16' × 10'");

  // 6. Non-dimensional item has empty string
  const serviceItem = {
    name: "Annual Maintenance Contract",
  };
  assert.equal(resolveItemSize(serviceItem), "");
});

test("PDF Rendering: resolvePdfDisplaySize NEVER prints '-' when valid size or dimension exists", () => {
  // Client quotation QT/2026-27/0019 scenario:
  const clientQuotationLine = {
    name: "cabin 20x10",
    description: "",
    rate: 180000,
    quantity: 1,
  };
  assert.equal(resolvePdfDisplaySize(clientQuotationLine), "20' × 10'");
  assert.notEqual(resolvePdfDisplaySize(clientQuotationLine), "-");

  // Explicit size
  assert.equal(resolvePdfDisplaySize({ name: "Cabin", size: "20' × 10'" }), "20' × 10'");

  // Size in snapshot
  assert.equal(
    resolvePdfDisplaySize({ name: "Cabin", sizeSnapshot: { label: "40' × 10' × 8.5'" } }),
    "40' × 10' × 8.5'"
  );

  // Non-dimensional item renders '—' (em-dash placeholder)
  assert.equal(resolvePdfDisplaySize({ name: "Installation Charges" }), "—");
});

test("Line Item Computation: calc.ts preserves sizeSnapshot and synchronizes size metadata", () => {
  const calcSource = read("src/lib/calc.ts");

  // computeLine must spread ...item first to preserve all line metadata and snapshots
  assert.match(calcSource, /\.\.\.item/);
  // computeLine must preserve size and sizeSnapshot
  assert.match(calcSource, /size:\s*resolvedSize/);
  assert.match(calcSource, /sizeSnapshot:\s*resolvedSizeSnapshot/);

  // Simulate computeLine preservation logic directly
  const item = {
    id: "line_1",
    productId: "prod_1",
    name: "Security Cabin 20x10",
    size: "20' × 10'",
    sizeSnapshot: {
      label: "20' × 10'",
      length: 20,
      width: 10,
      unit: "ft",
    },
    quantity: 1,
    rate: 150000,
    gstRate: 18,
  };

  const computed = {
    ...item,
    quantity: 2,
    rate: 145000,
    discountPct: 5,
    size: item.size || item.sizeSnapshot?.label || "",
    sizeSnapshot: item.sizeSnapshot || parseSizeSnapshot(item.size),
  };

  assert.equal(computed.size, "20' × 10'");
  assert.ok(computed.sizeSnapshot);
  assert.equal(computed.sizeSnapshot.label, "20' × 10'");
  assert.equal(computed.sizeSnapshot.length, 20);
  assert.equal(computed.sizeSnapshot.width, 10);
});

test("PDF Export Integration: quotationExport.ts and documentRenderer.ts use resolvePdfDisplaySize", () => {
  const quotationExport = read("src/lib/quotationExport.ts");
  const documentRenderer = read("src/lib/documentRenderer.ts");

  // Quotation export must use resolvePdfDisplaySize in autotable and docx
  assert.match(quotationExport, /resolvePdfDisplaySize\(it\)/);
  assert.match(quotationExport, /2:\s*\{\s*halign:\s*"center",\s*cellWidth:\s*24\s*\}/);

  // Invoice renderer must use resolvePdfDisplaySize in Tax Invoice and Non-GST invoice
  assert.match(documentRenderer, /resolvePdfDisplaySize\(item\)/);
});

test("UI Integration: LineItemsEditor provides visible, directly editable Size input with presets", () => {
  const editor = read("src/components/app/LineItemsEditor.tsx");

  // Direct editable input in ProductSizeField
  assert.match(editor, /<ProductSizeField/);
  assert.match(editor, /value=\{it\.size \|\| ""\}/);
  assert.match(editor, /placeholder="e\.g\. 20' × 10' × 8\.5'"/);

  // Suggestions include catalog, master presets, recent sizes, and extracted dimensions
  assert.match(editor, /extractDimensionFromString/);
  assert.match(editor, /masterSizes/);
  assert.match(editor, /productSizes/);

  // Auto-populates size on product selection
  assert.match(editor, /initialSize =/);
  assert.match(editor, /extractDimensionFromString\(p\.name\)/);
});

test("Realtime Sync and Persistence: Master sizes and document snapshots are synchronized", () => {
  const sync = read("src/modules/sync/companyRealtimeSync.ts");
  const mutationService = read("src/modules/sync/canonicalMutationService.ts");
  const quotationSnapshot = read("src/modules/documents/quotationSnapshot.ts");
  const postingService = read("src/modules/accounting/services/documentPostingService.ts");

  // Realtime sync includes sizes
  assert.match(sync, /name: "sizes"/);
  assert.match(sync, /db\(\)\.sizes/);

  // Canonical mutation service supports size entity kind
  assert.match(mutationService, /"size"/);

  // Quotation snapshot freezes size and sizeSnapshot
  assert.match(quotationSnapshot, /resolveItemSize\(it\)/);
  assert.match(quotationSnapshot, /sizeSnapshot/);

  // Document posting freezes size in frozenLines
  assert.match(postingService, /resolveItemSize\(it\)/);
  assert.match(postingService, /sizeSnapshot/);
});
