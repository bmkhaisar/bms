import type jsPDF from "jspdf";
import { parseInlineSpans, stripMarkdown, type InlineSpan } from "./markdownDoc.ts";
export { parseInlineSpans, stripMarkdown, cleanMarkdownForPdf as stripMarkdownTokens };

/**
 * Strips raw markdown syntax safely for text length/wrapping calculations,
 * ensuring no raw asterisks or markdown symbols leak.
 */
export function cleanMarkdownForPdf(raw: string): string {
  if (!raw) return "";
  return stripMarkdown(raw);
}

/**
 * Draws text containing markdown formatting (**bold**, *italic*) into a jsPDF document
 * at (startX, startY) with word wrapping up to maxWidth.
 * Returns the final Y position after rendering.
 */
export function drawMarkdownText(
  doc: jsPDF,
  text: string,
  startX: number,
  startY: number,
  maxWidth: number,
  lineHeightMm: number,
  fontFamily: string = "helvetica",
  defaultFontSize: number = 8.5,
  defaultColor: [number, number, number] = [30, 30, 30]
): number {
  if (!text) return startY;

  const lines = text.split(/\r?\n/);
  let y = startY;

  for (const line of lines) {
    if (!line.trim()) {
      y += lineHeightMm * 0.7;
      continue;
    }

    const spans = parseInlineSpans(line);
    // Break spans into words with their formatting
    const tokens: Array<{ text: string; bold?: boolean; italic?: boolean }> = [];
    for (const span of spans) {
      const parts = span.text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        tokens.push({
          text: part,
          bold: span.bold,
          italic: span.italic,
        });
      }
    }

    let x = startX;
    let currentLineTokens: typeof tokens = [];
    let currentLineWidth = 0;

    for (const token of tokens) {
      doc.setFont(fontFamily, token.bold ? "bold" : token.italic ? "italic" : "normal");
      doc.setFontSize(defaultFontSize);
      const tokenW = doc.getTextWidth(token.text);

      if (x + tokenW > startX + maxWidth && currentLineTokens.length > 0 && token.text.trim()) {
        // Draw current line
        drawTokensLine(doc, currentLineTokens, startX, y, fontFamily, defaultFontSize, defaultColor);
        y += lineHeightMm;
        x = startX;
        currentLineTokens = [];
        currentLineWidth = 0;
      }

      currentLineTokens.push(token);
      x += tokenW;
      currentLineWidth += tokenW;
    }

    if (currentLineTokens.length > 0) {
      drawTokensLine(doc, currentLineTokens, startX, y, fontFamily, defaultFontSize, defaultColor);
      y += lineHeightMm;
    }
  }

  return y;
}

function drawTokensLine(
  doc: jsPDF,
  tokens: Array<{ text: string; bold?: boolean; italic?: boolean }>,
  startX: number,
  y: number,
  fontFamily: string,
  fontSize: number,
  defaultColor: [number, number, number]
) {
  let x = startX;
  for (const token of tokens) {
    doc.setFont(fontFamily, token.bold ? "bold" : token.italic ? "italic" : "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(token.bold ? 15 : defaultColor[0], token.bold ? 15 : defaultColor[1], token.bold ? 15 : defaultColor[2]);
    doc.text(token.text, x, y);
    x += doc.getTextWidth(token.text);
  }
}

/**
 * AutoTable hook helper for cells that contain inline markdown.
 * In didParseCell: Strips markdown symbols so autoTable computes exact cell height and wrapping.
 * In didDrawCell: If the cell had markdown asterisks, redraws the formatted text with bold styling.
 */
export function handleAutoTableMarkdownCell(
  hook: "didParseCell" | "didDrawCell",
  data: any,
  fontFamily: string = "helvetica",
  defaultFontSize: number = 8,
  textColor: [number, number, number] = [30, 30, 30]
) {
  if (!data || !data.cell) return;

  const raw = data.cell.raw;
  if (typeof raw !== "string" || !raw.includes("**")) return;

  if (hook === "didParseCell") {
    // Strip markdown formatting symbols so autoTable wraps the exact plain text
    data.cell.text = data.cell.text.map((line: string) => cleanMarkdownForPdf(line));
  } else if (hook === "didDrawCell") {
    // Overdraw cell text with proper font styles
    const cell = data.cell;
    const padding = cell.padding("top") || 2;
    const paddingLeft = cell.padding("left") || 2;
    const startX = cell.x + paddingLeft;
    const startY = cell.y + padding + (defaultFontSize * 0.35);
    const maxW = cell.width - (paddingLeft * 2);
    const lineHeightMm = (cell.styles.lineHeight || 1.15) * defaultFontSize * 0.3527;

    // Fill cell background to cover plain text drawn by autotable default
    const doc = data.doc;
    const fillColor = cell.styles.fillColor;
    if (fillColor) {
      if (Array.isArray(fillColor)) {
        doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
      } else {
        doc.setFillColor(fillColor);
      }
      doc.rect(cell.x + 0.1, cell.y + 0.1, cell.width - 0.2, cell.height - 0.2, "F");
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(cell.x + 0.1, cell.y + 0.1, cell.width - 0.2, cell.height - 0.2, "F");
    }

    drawMarkdownText(doc, raw, startX, startY, maxW, lineHeightMm, fontFamily, defaultFontSize, textColor);
  }
}
