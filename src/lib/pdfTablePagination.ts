import type jsPDF from "jspdf";
import { parseInlineSpans, stripMarkdown, type InlineSpan } from "./markdownDoc.ts";
import { cleanMarkdownForPdf } from "./markdownPdfRenderer.ts";

export interface KeyValueTableRow {
  label: string;
  value: string;
  bullets?: string[];
}

export interface WrappedToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface WrappedLine {
  tokens: WrappedToken[];
  width: number;
}

/**
 * Parses markdown text into wrapped lines of styled tokens matching a target width.
 */
export function wrapMarkdownTokens(
  doc: jsPDF,
  text: string,
  maxWidth: number,
  fontFamily: string = "helvetica",
  fontSize: number = 8.5,
): WrappedLine[] {
  if (!text) return [];

  const rawParagraphs = text.split(/\r?\n/);
  const resultLines: WrappedLine[] = [];

  for (const para of rawParagraphs) {
    if (!para.trim()) {
      resultLines.push({ tokens: [{ text: "" }], width: 0 });
      continue;
    }

    const spans: InlineSpan[] = parseInlineSpans(para);
    const words: WrappedToken[] = [];

    for (const span of spans) {
      // Split by whitespace preserving tokens
      const parts = span.text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        words.push({
          text: part,
          bold: span.bold,
          italic: span.italic,
        });
      }
    }

    let currentLineTokens: WrappedToken[] = [];
    let currentLineWidth = 0;

    for (const word of words) {
      doc.setFont(fontFamily, word.bold ? "bold" : word.italic ? "italic" : "normal");
      doc.setFontSize(fontSize);
      const wordW = doc.getTextWidth(word.text);

      if (currentLineWidth + wordW > maxWidth && currentLineTokens.length > 0 && word.text.trim()) {
        resultLines.push({ tokens: currentLineTokens, width: currentLineWidth });
        currentLineTokens = [];
        currentLineWidth = 0;
      }

      currentLineTokens.push(word);
      currentLineWidth += wordW;
    }

    if (currentLineTokens.length > 0) {
      resultLines.push({ tokens: currentLineTokens, width: currentLineWidth });
    }
  }

  return resultLines;
}

/**
 * Draws a line of styled tokens at (startX, y) using jsPDF.
 */
export function drawTokensLine(
  doc: jsPDF,
  tokens: WrappedToken[],
  startX: number,
  y: number,
  fontFamily: string,
  fontSize: number,
  defaultColor: [number, number, number] = [30, 30, 30],
): void {
  let x = startX;
  for (const token of tokens) {
    if (!token.text) continue;
    doc.setFont(fontFamily, token.bold ? "bold" : token.italic ? "italic" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(
      token.bold ? 15 : defaultColor[0],
      token.bold ? 15 : defaultColor[1],
      token.bold ? 15 : defaultColor[2],
    );
    doc.text(token.text, x, y);
    x += doc.getTextWidth(token.text);
  }
}

export interface PaginatedKeyValueTableParams {
  doc: jsPDF;
  rows: KeyValueTableRow[];
  startY: number;
  pageW: number;
  pageH: number;
  margin: number;
  bottomReserve?: number; // Reserve space for page footer (default 16mm)
  nextPageContentY?: number; // Content start Y immediately below continuation header (default 22mm)
  labelColWidth?: number; // Width of label column (default 55mm)
  fontFamily?: string;
  fontSize?: number;
  accentColor?: [number, number, number];
  sectionHeading?: string;
  sectionSubtitle?: string;
  onNewPage: () => number; // Callback to add a new page and draw header, returns bottom of header
}

/**
 * Canonical Paginated Key-Value Table Renderer.
 *
 * Guarantees:
 * 1. ROW_NOT_SPLIT_WHEN_IT_CAN_MOVE:
 *    Calculates complete row height beforehand; if row does not fit current page
 *    but fits on a fresh page, moves the whole row to the next page.
 * 2. NO_DUPLICATED_TEXT:
 *    No cell re-rendering or split repetitions. Every word appears exactly once.
 * 3. NO_EMPTY_CONTINUATION_CELL:
 *    If a gigantic single row exceeds an entire page, continuation displays "(continued)" label.
 * 4. NO_LARGE_TOP_GAP:
 *    On new page, Y position resets to standard content start immediately below page header.
 * 5. MULTIPAGE_TABLE_CONTINUATION:
 *    Seamlessly continues across 2, 3 or more pages with running page headers.
 */
export function renderPaginatedKeyValueTable(
  params: PaginatedKeyValueTableParams,
): number {
  const {
    doc,
    rows,
    startY,
    pageW,
    pageH,
    margin,
    bottomReserve = 16,
    nextPageContentY = 22,
    labelColWidth = 55,
    fontFamily = "helvetica",
    fontSize = 8.5,
    accentColor = [30, 64, 175],
    sectionHeading,
    sectionSubtitle,
    onNewPage,
  } = params;

  if (!rows || rows.length === 0) return startY;

  const printableBottomY = pageH - bottomReserve;
  const freshPageAvailableH = printableBottomY - nextPageContentY;
  const paddingX = 2.5;
  const paddingTop = 2.5;
  const paddingBottom = 2.5;
  const lineHeightMm = fontSize * 0.3527 * 1.25; // standard typography line height in mm
  const minRowHeight = 6.8;

  const totalTableW = pageW - margin * 2;
  const valueColWidth = totalTableW - labelColWidth;
  const labelTextMaxW = labelColWidth - paddingX * 2;
  const valueTextMaxW = valueColWidth - paddingX * 2;

  let currentY = startY;

  // 1. Draw Section Heading with Orphan Prevention
  if (sectionHeading) {
    const headingBlockH = sectionSubtitle ? 14 : 10;
    // Ensure space for heading + at least 1 typical row (~18mm)
    if (currentY + headingBlockH + 10 > printableBottomY) {
      const headerBottom = onNewPage();
      currentY = (headerBottom ? headerBottom + 4 : nextPageContentY);
    }

    doc.setFont(fontFamily, "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(sectionHeading, margin, currentY + 4);

    if (sectionSubtitle) {
      doc.setFont(fontFamily, "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(sectionSubtitle, margin, currentY + 8.5);
      currentY += headingBlockH;
    } else {
      currentY += headingBlockH;
    }
  }

  // 2. Render Rows with Strict Page-Break Rules
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const r = rows[rowIndex];

    // Prepare label text
    const cleanLabel = cleanMarkdownForPdf(r.label || "");
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(fontSize);
    const labelLines = doc.splitTextToSize(cleanLabel, labelTextMaxW);
    const labelContentH = Math.max(labelLines.length * lineHeightMm, minRowHeight - paddingTop - paddingBottom);

    // Prepare value text & markdown wrapped lines
    let valText = r.value || "";
    if (r.bullets && r.bullets.length > 0) {
      valText = r.bullets.map(b => `• ${b}`).join("\n");
    }

    const valueWrappedLines = wrapMarkdownTokens(doc, valText, valueTextMaxW, fontFamily, fontSize);
    const valueContentH = Math.max(valueWrappedLines.length * lineHeightMm, minRowHeight - paddingTop - paddingBottom);

    const fullRowH = Math.max(labelContentH, valueContentH) + paddingTop + paddingBottom;

    // RULE 1 & 2: Check if row fits on current page
    const remainingYOnCurrentPage = printableBottomY - currentY;

    if (fullRowH <= remainingYOnCurrentPage) {
      // Row fits completely on current page
      drawSingleRow(
        doc,
        cleanLabel,
        labelLines,
        valueWrappedLines,
        margin,
        currentY,
        labelColWidth,
        valueColWidth,
        fullRowH,
        paddingX,
        paddingTop,
        lineHeightMm,
        fontFamily,
        fontSize,
      );
      currentY += fullRowH;
    } else if (fullRowH <= freshPageAvailableH) {
      // Row does NOT fit on current page, but CAN fit on a fresh page -> Move WHOLE row to next page!
      const headerBottom = onNewPage();
      currentY = (headerBottom ? headerBottom + 4 : nextPageContentY);

      drawSingleRow(
        doc,
        cleanLabel,
        labelLines,
        valueWrappedLines,
        margin,
        currentY,
        labelColWidth,
        valueColWidth,
        fullRowH,
        paddingX,
        paddingTop,
        lineHeightMm,
        fontFamily,
        fontSize,
      );
      currentY += fullRowH;
    } else {
      // RULE 2: Genuinely gigantic row taller than an entire page -> Controlled multi-page continuation
      let lineOffset = 0;
      let isFirstChunk = true;

      while (lineOffset < valueWrappedLines.length) {
        const availH = printableBottomY - currentY;
        const maxLinesCanFit = Math.max(1, Math.floor((availH - paddingTop - paddingBottom) / lineHeightMm));
        const chunkLines = valueWrappedLines.slice(lineOffset, lineOffset + maxLinesCanFit);
        const chunkH = Math.max(minRowHeight, chunkLines.length * lineHeightMm + paddingTop + paddingBottom);

        const currentLabel = isFirstChunk ? cleanLabel : `${cleanLabel} (continued)`;
        const curLabelLines = isFirstChunk ? labelLines : doc.splitTextToSize(currentLabel, labelTextMaxW);

        drawSingleRow(
          doc,
          currentLabel,
          curLabelLines,
          chunkLines,
          margin,
          currentY,
          labelColWidth,
          valueColWidth,
          chunkH,
          paddingX,
          paddingTop,
          lineHeightMm,
          fontFamily,
          fontSize,
        );

        lineOffset += chunkLines.length;
        currentY += chunkH;
        isFirstChunk = false;

        if (lineOffset < valueWrappedLines.length) {
          const headerBottom = onNewPage();
          currentY = (headerBottom ? headerBottom + 4 : nextPageContentY);
        }
      }
    }
  }

  return currentY;
}

function drawSingleRow(
  doc: jsPDF,
  label: string,
  labelLines: string[],
  valueLines: WrappedLine[],
  x: number,
  y: number,
  labelW: number,
  valW: number,
  rowH: number,
  paddingX: number,
  paddingTop: number,
  lineHeightMm: number,
  fontFamily: string,
  fontSize: number,
) {
  // 1. Column 0: Label Box (shaded background)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(220, 225, 230);
  doc.setLineWidth(0.1);
  doc.rect(x, y, labelW, rowH, "FD");

  // 2. Column 1: Value Box (clean white background)
  doc.setFillColor(255, 255, 255);
  doc.rect(x + labelW, y, valW, rowH, "FD");

  // 3. Draw Label Text (Bold, Dark Grey)
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(40, 40, 40);
  const baselineOffset = fontSize * 0.35;
  let textY = y + paddingTop + baselineOffset;

  for (const line of labelLines) {
    doc.text(line, x + paddingX, textY);
    textY += lineHeightMm;
  }

  // 4. Draw Value Markdown Text Line-by-Line with Inline Styling
  let valTextY = y + paddingTop + baselineOffset;
  const valStartX = x + labelW + paddingX;

  for (const vLine of valueLines) {
    drawTokensLine(doc, vLine.tokens, valStartX, valTextY, fontFamily, fontSize, [30, 30, 30]);
    valTextY += lineHeightMm;
  }
}
