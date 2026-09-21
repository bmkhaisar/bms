import test from "node:test";
import assert from "node:assert/strict";

import {
  wrapMarkdownTokens,
  renderPaginatedKeyValueTable,
} from "../src/lib/pdfTablePagination.ts";
import {
  parseMarkdownToStructuredTerms,
  parseMarkdownToTechSpecSections,
  parseMarkdownToGeneralInfoRows,
  hydrateQuotationFromCompany,
} from "../src/modules/documents/documentContentHydration.ts";

/**
 * Creates a lightweight mock jsPDF object to verify exact drawing coordinates,
 * text invocations, page additions, and rectangle fills.
 */
function createMockJsPdf() {
  const pages = [[]]; // pages[pageIndex] = array of operations
  let currentPage = 1;
  const drawnTexts = [];
  const drawnRects = [];

  const mockDoc = {
    internal: {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297,
      },
    },
    getNumberOfPages: () => pages.length,
    setPage: (p) => { currentPage = p; },
    addPage: () => {
      pages.push([]);
      currentPage = pages.length;
    },
    setFont: () => {},
    setFontSize: () => {},
    setTextColor: () => {},
    setDrawColor: () => {},
    setFillColor: () => {},
    setLineWidth: () => {},
    getTextWidth: (text) => {
      if (!text) return 0;
      // Approximate character width in mm for 8.5pt font: ~1.8mm per char
      return text.length * 1.8;
    },
    splitTextToSize: (text, maxW) => {
      if (!text) return [];
      const words = text.split(" ");
      const lines = [];
      let current = "";
      for (const w of words) {
        const candidate = current ? `${current} ${w}` : w;
        if (candidate.length * 1.8 > maxW && current) {
          lines.push(current);
          current = w;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      return lines;
    },
    text: (t, x, y, opts) => {
      const op = { type: "text", text: t, x, y, page: currentPage, opts };
      pages[currentPage - 1].push(op);
      drawnTexts.push(op);
    },
    rect: (x, y, w, h, style) => {
      const op = { type: "rect", x, y, w, h, style, page: currentPage };
      pages[currentPage - 1].push(op);
      drawnRects.push(op);
    },
    // Test inspection helpers
    _pages: pages,
    _drawnTexts: drawnTexts,
    _drawnRects: drawnRects,
    _getCurrentPage: () => currentPage,
  };

  return mockDoc;
}

test("ROW_NOT_SPLIT_WHEN_IT_CAN_MOVE: Moves whole row to next page when it cannot fit remaining space", async () => {
  const doc = createMockJsPdf();
  let headerDrawnCount = 0;

  // Set startY very close to the bottom (270mm on a 297mm page with bottomReserve=16mm => printableBottom = 281mm)
  // Remaining space = 11mm.
  // "Electrical Fittings" row height will be ~14mm, so it CANNOT fit in 11mm, but easily fits on fresh page (259mm).
  const startY = 270;

  const rows = [
    {
      label: "Electrical Fittings",
      value: "All electrical fittings in the portable cabin shall be suitable for **220–240V AC, 50Hz**. Wiring sizes include **4mm, 2.5mm, 1.5mm and 1mm**.",
    },
    {
      label: "Fittings Included",
      value: "Tube lights, bulkhead lights, fans, switches, sockets, AC point, MCB, and other extra fittings as required by the client.",
    },
  ];

  const finalY = renderPaginatedKeyValueTable({
    doc,
    rows,
    startY,
    pageW: 210,
    pageH: 297,
    margin: 12,
    bottomReserve: 16,
    nextPageContentY: 22,
    labelColWidth: 55,
    fontFamily: "helvetica",
    fontSize: 8.5,
    onNewPage: () => {
      doc.addPage();
      headerDrawnCount++;
      return 18; // Header finishes at Y=18mm
    },
  });

  // Verification 1: Page break occurred
  assert.equal(doc.getNumberOfPages(), 2, "Must add page 2 because row cannot fit on page 1");
  assert.equal(headerDrawnCount, 1, "onNewPage callback must be called exactly once");

  // Verification 2: Page 1 must NOT contain any half-drawn fragments of "Electrical Fittings"
  const page1Texts = doc._pages[0].map(op => op.text);
  assert.equal(page1Texts.length, 0, "Page 1 must not contain any split text for the row that moved");

  // Verification 3: Page 2 must contain the entire "Electrical Fittings" row starting at Y >= 22mm
  const page2Texts = doc._pages[1];
  assert.ok(page2Texts.length > 0, "Page 2 must contain the rendered row");

  const page2Label = page2Texts.find(op => op.text === "Electrical Fittings");
  assert.ok(page2Label, "Page 2 must contain 'Electrical Fittings' in Column 0");
  assert.equal(page2Label.page, 2);
  assert.ok(page2Label.y >= 22, `Page 2 content must start immediately below header (y=${page2Label.y} >= 22)`);
  assert.ok(page2Label.y < 35, `Page 2 content must NOT have an excessive top gap (y=${page2Label.y} < 35)`);
});

test("NO_DUPLICATED_TEXT: Specification sentences appear exactly once in generated document", () => {
  const doc = createMockJsPdf();
  const startY = 270;

  const rows = [
    {
      label: "Electrical Fittings",
      value: "All electrical fittings in the portable cabin shall be suitable for **220–240V AC, 50Hz**. Wiring sizes include **4mm, 2.5mm, 1.5mm and 1mm**.",
    },
  ];

  renderPaginatedKeyValueTable({
    doc,
    rows,
    startY,
    pageW: 210,
    pageH: 297,
    margin: 12,
    bottomReserve: 16,
    nextPageContentY: 22,
    labelColWidth: 55,
    fontFamily: "helvetica",
    fontSize: 8.5,
    onNewPage: () => {
      doc.addPage();
      return 18;
    },
  });

  const allTextOps = doc._drawnTexts.filter(op => op.type === "text");
  const electricalOccurrences = allTextOps.filter(op => op.text === "Electrical Fittings");
  assert.equal(electricalOccurrences.length, 1, "Label 'Electrical Fittings' must appear exactly once");

  // Verify that the bold token '220–240V' appears exactly once (no duplicated sentences)
  const boldFreqOccurrences = allTextOps.filter(op => op.text.includes("220–240V"));
  assert.equal(boldFreqOccurrences.length, 1, "Bold specification token '220–240V' must appear exactly once (NO DUPLICATION)");
});

test("NO_EMPTY_CONTINUATION_CELL & NO_LARGE_TOP_GAP: Continuation resets Y properly without phantom cells", () => {
  const doc = createMockJsPdf();
  const startY = 270;

  const rows = [
    {
      label: "Main Supply Cable",
      value: "4mm thick cable.",
    },
    {
      label: "Electrical Fittings",
      value: "All electrical fittings in the portable cabin shall be suitable for **220–240V AC, 50Hz**.",
    },
  ];

  renderPaginatedKeyValueTable({
    doc,
    rows,
    startY,
    pageW: 210,
    pageH: 297,
    margin: 12,
    bottomReserve: 16,
    nextPageContentY: 22,
    labelColWidth: 55,
    fontFamily: "helvetica",
    fontSize: 8.5,
    onNewPage: () => {
      doc.addPage();
      return 18;
    },
  });

  // Page 2 must not start with an empty column
  const page2TextOps = doc._pages[1].filter(op => op.type === "text");
  assert.ok(page2TextOps.length > 0, "Page 2 must contain text operations");

  // First text drawn on page 2 must be the label in column 0
  const firstText = page2TextOps[0];
  assert.ok(firstText.text.length > 0, "Column 0 on continued page must NOT be empty");
  assert.equal(firstText.text, "Electrical Fittings", "Column 0 must contain 'Electrical Fittings'");
  assert.equal(firstText.x, 12 + 2.5, "Column 0 must be positioned at margin + padding");
  assert.ok(firstText.y <= 28, `Next-page Y position (${firstText.y}) must be right below header (<= 28mm), eliminating large gap`);
});

test("MULTIPAGE_TABLE_CONTINUATION: Multi-row tables spanning 3 pages maintain integrity and order", () => {
  const doc = createMockJsPdf();
  let newPagesCreated = 0;

  // Create 25 rows
  const rows = Array.from({ length: 25 }, (_, i) => ({
    label: `Specification ${i + 1}`,
    value: `Detailed engineering parameters for item ${i + 1} with **Grade A** steel specification and anti-rust primer.`,
  }));

  const finalY = renderPaginatedKeyValueTable({
    doc,
    rows,
    startY: 200,
    pageW: 210,
    pageH: 297,
    margin: 12,
    bottomReserve: 16,
    nextPageContentY: 22,
    labelColWidth: 55,
    fontFamily: "helvetica",
    fontSize: 8.5,
    onNewPage: () => {
      doc.addPage();
      newPagesCreated++;
      return 18;
    },
  });

  assert.ok(doc.getNumberOfPages() >= 2, "Must create multiple pages for 25 specification rows");
  assert.ok(newPagesCreated >= 1, "Must invoke onNewPage callback for each new page");
  assert.ok(finalY > 22 && finalY < 297, "Final Y must be within valid page bounds");
});

test("COMPANY_CONTENT_HYDRATION: Quotation hydrator pulls markdown defaults into document editor", () => {
  const company = {
    quotationTermsMarkdown: "1. 50% advance along with confirmed PO.\n2. Delivery within 3 weeks.\n3. Taxes extra as applicable.",
    quotationTechnicalSpecsMarkdown: "# Electrical Specs\n| Parameter | Value |\n| Main Supply Cable | **4mm** thick cable. |\n| Electrical Fittings | All fittings suitable for **220–240V AC**. |",
    quotationGeneralInfoMarkdown: "| Parameter | Description |\n| Configuration of Cabins | 40' × 10' × 8.5' (Qty: 2) |\n| Insulation | Glass wool 50mm |",
    showQuotationTerms: true,
    showQuotationTechnicalSpecs: true,
    showQuotationGeneralInfo: true,
  };

  const emptyDraftQuotation = {
    id: "q_draft_1",
    number: "QT-2026-0001",
    items: [],
    customerId: "cust_1",
  };

  const hydrated = hydrateQuotationFromCompany(emptyDraftQuotation, company);

  assert.equal(hydrated.includeTerms, true);
  assert.equal(hydrated.includeTechSpecs, true);
  assert.equal(hydrated.includeGeneralInfo, true);

  // Structured terms
  assert.equal(hydrated.structuredTerms.length, 3);
  assert.match(hydrated.structuredTerms[0].text, /50% advance/);
  assert.match(hydrated.structuredTerms[1].text, /Delivery within 3 weeks/);

  // Tech specs
  assert.equal(hydrated.structuredSections.length, 1);
  assert.equal(hydrated.structuredSections[0].title, "Electrical Specs");
  assert.equal(hydrated.structuredSections[0].rows.length, 2);
  assert.equal(hydrated.structuredSections[0].rows[0].label, "Main Supply Cable");

  // General info
  assert.equal(hydrated.generalInfoRows.length, 2);
  assert.equal(hydrated.generalInfoRows[0].label, "Configuration of Cabins");
  assert.equal(hydrated.generalInfoRows[1].label, "Insulation");
});
