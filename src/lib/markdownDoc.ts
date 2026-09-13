
export type MarkdownBlockType =
  | "HEADING"
  | "PARAGRAPH"
  | "NUMBERED_LIST"
  | "BULLET_LIST"
  | "TABLE";

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  isImportant?: boolean;
}

export interface HeadingBlock {
  type: "HEADING";
  level: 1 | 2 | 3;
  text: string;
  spans: InlineSpan[];
}

export interface ParagraphBlock {
  type: "PARAGRAPH";
  text: string;
  spans: InlineSpan[];
}

export interface NumberedListItem {
  index: number;
  text: string;
  spans: InlineSpan[];
}

export interface NumberedListBlock {
  type: "NUMBERED_LIST";
  items: NumberedListItem[];
}

export interface BulletListItem {
  text: string;
  spans: InlineSpan[];
}

export interface BulletListBlock {
  type: "BULLET_LIST";
  items: BulletListItem[];
}

export interface TableBlock {
  type: "TABLE";
  headers: string[];
  headerSpans: InlineSpan[][];
  rows: string[][];
  rowSpans: InlineSpan[][][];
}

export type MarkdownBlock =
  | HeadingBlock
  | ParagraphBlock
  | NumberedListBlock
  | BulletListBlock
  | TableBlock;

/**
 * Sanitize Markdown by removing unsafe HTML tags and executable scripts.
 */
export function sanitizeMarkdown(raw: string): string {
  if (!raw) return "";
  let clean = raw.replace(/\r\n/g, "\n");
  // Remove script, style, iframe, object, embed tags and their contents
  clean = clean.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "");
  // Remove arbitrary HTML tags while preserving raw text inside
  clean = clean.replace(/<[^>]+>/g, "");
  return clean;
}

export const sanitizeMarkdownText = sanitizeMarkdown;

/**
 * Parse inline text into formatting spans: bold (**text**), italic (*text*),
 * and subtle semantic emphasis for key business values (percentages, currencies, dates).
 */
export function parseInlineSpans(text: string): InlineSpan[] {
  if (!text) return [];

  const spans: InlineSpan[] = [];
  // Regex to match **bold**, *italic*, or plain text
  const pattern = /(\*\*(.+?)\*\*)|(\*([^*]+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainText = text.substring(lastIndex, match.index);
      if (plainText) {
        spans.push({ text: plainText });
      }
    }

    if (match[1]) {
      spans.push({ text: match[2], bold: true });
    } else if (match[3]) {
      spans.push({ text: match[4], italic: true });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    if (remaining) {
      spans.push({ text: remaining });
    }
  }

  return spans;
}

/**
 * Strip Markdown syntax (*, #, |, -, numbers) to get plain clean text.
 */
export function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*([^*]+?)\*/g, "$1")
    .replace(/^#+\s*/g, "")
    .replace(/^[-*]\s+/g, "")
    .replace(/^\d+\.\s+/g, "")
    .trim();
}

/**
 * Parse Markdown string into safe structured AST blocks.
 */
export function parseMarkdownToBlocks(raw: string): MarkdownBlock[] {
  const sanitized = sanitizeMarkdown(raw);
  const lines = sanitized.split("\n");
  const blocks: MarkdownBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Heading (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      const headingText = headingMatch[2].trim();
      blocks.push({
        type: "HEADING",
        level,
        text: headingText,
        spans: parseInlineSpans(headingText),
      });
      i++;
      continue;
    }

    // 2. Table (| Header | Header |)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        // Line 0: Header
        // Line 1: Separator (|---|---|)
        // Line 2+: Rows
        const rawHeaders = tableLines[0]
          .split("|")
          .slice(1, -1)
          .map((h) => h.trim());

        const hasSeparator = /^\|?[\s\-:|]+\|?$/.test(tableLines[1]);
        const startRowIdx = hasSeparator ? 2 : 1;

        const rows: string[][] = [];
        const rowSpans: InlineSpan[][][] = [];

        for (let r = startRowIdx; r < tableLines.length; r++) {
          const cells = tableLines[r]
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
          rows.push(cells);
          rowSpans.push(cells.map((c) => parseInlineSpans(c)));
        }

        blocks.push({
          type: "TABLE",
          headers: rawHeaders,
          headerSpans: rawHeaders.map((h) => parseInlineSpans(h)),
          rows,
          rowSpans,
        });
        continue;
      }
    }

    // 3. Numbered List (1. Item)
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      const items: NumberedListItem[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const m = cur.match(/^(\d+)\.\s+(.*)$/);
        if (m) {
          const itemText = m[2].trim();
          items.push({
            index: parseInt(m[1], 10),
            text: itemText,
            spans: parseInlineSpans(itemText),
          });
          i++;
        } else if (cur.startsWith("   ") || cur.startsWith("\t")) {
          // Continued line for previous item
          if (items.length > 0) {
            const last = items[items.length - 1];
            last.text += " " + cur.trim();
            last.spans = parseInlineSpans(last.text);
          }
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        type: "NUMBERED_LIST",
        items,
      });
      continue;
    }

    // 4. Bullet List (- Item or * Item)
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      const items: BulletListItem[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const m = cur.match(/^[-*]\s+(.*)$/);
        if (m) {
          const itemText = m[1].trim();
          items.push({
            text: itemText,
            spans: parseInlineSpans(itemText),
          });
          i++;
        } else if (cur.startsWith("  ") || cur.startsWith("\t")) {
          // Continued line for previous item
          if (items.length > 0) {
            const last = items[items.length - 1];
            last.text += " " + cur.trim();
            last.spans = parseInlineSpans(last.text);
          }
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        type: "BULLET_LIST",
        items,
      });
      continue;
    }

    // 5. Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (!cur) break;
      if (
        cur.match(/^#{1,3}\s+/) ||
        cur.match(/^\d+\.\s+/) ||
        cur.match(/^[-*]\s+/) ||
        (cur.startsWith("|") && cur.endsWith("|"))
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }

    const paraText = paraLines.join(" ");
    blocks.push({
      type: "PARAGRAPH",
      text: paraText,
      spans: parseInlineSpans(paraText),
    });
  }

  return blocks;
}

/**
 * Extract structured rows from Markdown table for General Information or Specifications.
 * Returns array of { label: string, value: string }.
 */
export function extractTableRowsFromMarkdown(markdown: string): { label: string; value: string }[] {
  const blocks = parseMarkdownToBlocks(markdown);
  const rows: { label: string; value: string }[] = [];

  for (const b of blocks) {
    if (b.type === "TABLE") {
      for (const r of b.rows) {
        if (r.length >= 2) {
          rows.push({
            label: stripMarkdown(r[0]),
            value: r[1],
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Extract terms items array from Markdown (from numbered lists, bullet lists, or paragraphs).
 */
export function extractTermsFromMarkdown(markdown: string): string[] {
  const blocks = parseMarkdownToBlocks(markdown);
  const terms: string[] = [];

  for (const b of blocks) {
    if (b.type === "NUMBERED_LIST") {
      for (const item of b.items) {
        terms.push(item.text);
      }
    } else if (b.type === "BULLET_LIST") {
      for (const item of b.items) {
        terms.push(item.text);
      }
    } else if (b.type === "PARAGRAPH") {
      terms.push(b.text);
    }
  }

  return terms;
}

export const parseMarkdownDoc = parseMarkdownToBlocks;
export const extractTermsLines = extractTermsFromMarkdown;

/**
 * Extract table head and body for jspdf-autotable vector rendering.
 */
export function extractTableFromMarkdown(markdown: string): { head: string[][]; body: string[][] } | null {
  const blocks = parseMarkdownToBlocks(markdown);
  const tbl = blocks.find(b => b.type === "TABLE");
  if (!tbl) return null;
  return {
    head: [tbl.headers],
    body: tbl.rows,
  };
}


