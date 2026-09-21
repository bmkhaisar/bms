import type { TechSpecSection, TechSpecRow, QuotationSection } from "./db";
import { parseMarkdownToBlocks, stripMarkdown } from "./markdownDoc.ts";

export interface ResolveTechSpecParams {
  companyMarkdown?: string;
  documentOverride?: any;
  isIssuedOrFrozen?: boolean;
  frozenSnapshot?: TechSpecSection[];
}

/**
 * Normalizes any tech spec format (structuredSections, TechSpecSection[], or markdown)
 * into canonical TechSpecSection[] format.
 */
export function normalizeTechSpecSections(source: any): TechSpecSection[] {
  if (!source) return [];
  if (typeof source === "string") {
    return parseMarkdownToCanonicalTechSpecs(source);
  }
  if (!Array.isArray(source)) return [];

  const result: TechSpecSection[] = [];
  for (const item of source) {
    if (!item) continue;
    if (Array.isArray(item.rows)) {
      result.push({
        title: item.title || "Technical Specifications",
        subtitle: item.subtitle,
        rows: item.rows.map((r: any) => ({
          label: String(r?.label ?? ""),
          value: String(r?.value ?? ""),
        })),
      });
    } else if (item.label !== undefined && item.value !== undefined) {
      if (result.length === 0) {
        result.push({ title: "Technical Specifications", rows: [] });
      }
      result[0].rows.push({
        label: String(item.label ?? ""),
        value: String(item.value ?? ""),
      });
    }
  }
  return result;
}

/**
 * Parses markdown into canonical TechSpecSection[]
 */
export function parseMarkdownToCanonicalTechSpecs(markdown?: string): TechSpecSection[] {
  if (!markdown || !markdown.trim()) return [];
  const blocks = parseMarkdownToBlocks(markdown);
  const sections: TechSpecSection[] = [];
  let currentSection: TechSpecSection = {
    title: "Technical Specifications",
    rows: [],
  };

  for (const b of blocks) {
    if (b.type === "HEADING") {
      if (currentSection.rows.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        title: b.text,
        rows: [],
      };
    } else if (b.type === "TABLE") {
      for (const r of b.rows) {
        if (r.length >= 2) {
          currentSection.rows.push({
            label: stripMarkdown(r[0]),
            value: r[1],
          });
        }
      }
    } else if (b.type === "BULLET_LIST" || b.type === "NUMBERED_LIST") {
      for (const item of (b as any).items || []) {
        currentSection.rows.push({
          label: "Specification",
          value: item.text,
        });
      }
    }
  }

  if (currentSection.rows.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Resolves Technical Specifications with strict priority:
 *
 * 1. For finalized/issued/converted documents:
 *    - MUST use frozen technicalSpecificationSnapshot only.
 *    - NEVER falls back to current Company Settings for historical documents.
 *
 * 2. For draft documents:
 *    - Document-specific Tech Specs override takes first priority.
 *    - ONLY if document has no overrides does it fall back to Company Settings.
 */
export function resolveTechSpecSections(params: ResolveTechSpecParams): TechSpecSection[] {
  const {
    companyMarkdown,
    documentOverride,
    isIssuedOrFrozen,
    frozenSnapshot,
  } = params;

  // 1. Issued/Frozen documents: strictly use frozen snapshot, never re-read company settings
  if (isIssuedOrFrozen) {
    if (frozenSnapshot && frozenSnapshot.length > 0) {
      return normalizeTechSpecSections(frozenSnapshot);
    }
    if (documentOverride && documentOverride.length > 0) {
      return normalizeTechSpecSections(documentOverride);
    }
    return [];
  }

  // 2. Draft document: Document-specific override first
  if (documentOverride) {
    const normalized = normalizeTechSpecSections(documentOverride);
    if (normalized.length > 0 && normalized.some(s => s.rows.length > 0)) {
      return normalized;
    }
  }

  if (frozenSnapshot && frozenSnapshot.length > 0) {
    const normalized = normalizeTechSpecSections(frozenSnapshot);
    if (normalized.length > 0 && normalized.some(s => s.rows.length > 0)) {
      return normalized;
    }
  }

  // Otherwise fall back to Company Settings default template
  if (companyMarkdown && companyMarkdown.trim()) {
    return parseMarkdownToCanonicalTechSpecs(companyMarkdown);
  }

  return [];
}
