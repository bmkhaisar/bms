import { uid, type GeneralInfoField, type Quotation, type QuotationSection, type SectionRow, type StructuredTermItem, type Invoice, type TechSpecSection } from "../../lib/db.ts";
import { parseMarkdownToBlocks, extractTableRowsFromMarkdown, stripMarkdown } from "../../lib/markdownDoc.ts";
import { buildCabinConfigurationFromItems, isCabinConfigurationRow } from "../../lib/cabinConfiguration.ts";

/**
 * Parses markdown table content into structured SectionRow[] for General Information.
 * Dynamically resolves Cabin Configuration row if line items are supplied and not manually custom.
 */
export function parseMarkdownToGeneralInfoRows(
  markdown?: string,
  items?: any[],
  cabinOverride?: string,
  isCabinConfigCustom?: boolean,
  legacyFields?: GeneralInfoField[],
): SectionRow[] {
  let rawList: Array<{ label: string; value: string }> = [];

  if (markdown && markdown.trim()) {
    rawList = extractTableRowsFromMarkdown(markdown);
  }

  if (rawList.length === 0 && legacyFields && legacyFields.length > 0) {
    rawList = legacyFields.map(f => ({ label: f.label, value: f.value }));
  }

  if (rawList.length === 0) {
    return [];
  }

  const derivedCabin = items && items.length > 0 ? buildCabinConfigurationFromItems(items) : "";

  return rawList.map((r, i) => {
    let val = r.value;
    if (isCabinConfigurationRow(r.label)) {
      if (isCabinConfigCustom && cabinOverride) {
        val = cabinOverride;
      } else if (derivedCabin) {
        val = derivedCabin;
      }
    }

    return {
      id: `gi-${i}-${uid().slice(0, 4)}`,
      label: r.label,
      value: val,
      valueType: "TEXT",
      order: i + 1,
    };
  });
}

/**
 * Parses markdown headings, tables, and lists into structured QuotationSection[] for Tech Specs.
 */
export function parseMarkdownToTechSpecSections(markdown?: string): QuotationSection[] {
  if (!markdown || !markdown.trim()) return [];

  const blocks = parseMarkdownToBlocks(markdown);
  const sections: QuotationSection[] = [];
  let currentSection: QuotationSection = {
    id: uid(),
    type: "SPEC_TABLE",
    title: "Technical Specifications",
    order: 1,
    rows: [],
  };

  for (const b of blocks) {
    if (b.type === "HEADING") {
      if ((currentSection.rows || []).length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        id: uid(),
        type: "SPEC_TABLE",
        title: b.text,
        order: sections.length + 1,
        rows: [],
      };
    } else if (b.type === "TABLE") {
      for (const r of b.rows) {
        if (r.length >= 2) {
          const rowId = uid();
          currentSection.rows = currentSection.rows || [];
          currentSection.rows.push({
            id: rowId,
            label: stripMarkdown(r[0]),
            value: r[1],
            order: currentSection.rows.length + 1,
          });
        }
      }
    } else if (b.type === "BULLET_LIST" || b.type === "NUMBERED_LIST") {
      for (const item of (b as any).items || []) {
        currentSection.rows = currentSection.rows || [];
        currentSection.rows.push({
          id: uid(),
          label: "Specification",
          value: item.text,
          order: currentSection.rows.length + 1,
        });
      }
    } else if (b.type === "PARAGRAPH") {
      currentSection.rows = currentSection.rows || [];
      currentSection.rows.push({
        id: uid(),
        label: "Note",
        value: b.text,
        order: currentSection.rows.length + 1,
      });
    }
  }

  if ((currentSection.rows || []).length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Parses markdown list or numbered items into structured StructuredTermItem[].
 */
export function parseMarkdownToStructuredTerms(markdown?: string): StructuredTermItem[] {
  if (!markdown || !markdown.trim()) return [];

  const blocks = parseMarkdownToBlocks(markdown);
  const terms: StructuredTermItem[] = [];

  for (const b of blocks) {
    if (b.type === "NUMBERED_LIST") {
      for (const item of b.items) {
        terms.push({
          id: uid(),
          order: terms.length + 1,
          text: item.text,
          format: "NUMBERED",
        });
      }
    } else if (b.type === "BULLET_LIST") {
      for (const item of b.items) {
        terms.push({
          id: uid(),
          order: terms.length + 1,
          text: item.text,
          format: "BULLET",
        });
      }
    } else if (b.type === "PARAGRAPH") {
      if (b.text.trim()) {
        terms.push({
          id: uid(),
          order: terms.length + 1,
          text: b.text,
          format: "PARAGRAPH",
        });
      }
    }
  }

  // Fallback: If no blocks parsed (e.g. simple multi-line plain text with numbers)
  if (terms.length === 0) {
    const lines = markdown.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line) => {
      const isBullet = line.startsWith("- ") || line.startsWith("* ");
      const clean = line.replace(/^(\d+[.)]|[-*])\s*/, "");
      terms.push({
        id: uid(),
        order: terms.length + 1,
        text: clean,
        format: isBullet ? "BULLET" : "NUMBERED",
      });
    });
  }

  return terms;
}

/**
 * Resolves initial/hydrated content for a Quotation from Company Settings.
 * - Does NOT overwrite existing document-specific content if the document already has rows/terms.
 * - Does NOT write back to Company Settings (Document-only copy).
 */
export function hydrateQuotationFromCompany(
  quotation: Quotation,
  company: any,
): {
  includeGeneralInfo: boolean;
  generalInfoRows: SectionRow[];
  includeTechSpecs: boolean;
  structuredSections: QuotationSection[];
  includeTerms: boolean;
  structuredTerms: StructuredTermItem[];
} {
  // 1. General Information
  const hasExistingGenInfo = Boolean(
    quotation.generalInformationSnapshot && quotation.generalInformationSnapshot.length > 0
  ) || Boolean(
    quotation.generalInfoSnapshot && quotation.generalInfoSnapshot.length > 0
  );

  let generalInfoRows: SectionRow[] = [];
  if (hasExistingGenInfo) {
    const raw = quotation.generalInformationSnapshot || quotation.generalInfoSnapshot || [];
    const derivedCabin = buildCabinConfigurationFromItems(quotation.items || []);
    generalInfoRows = raw.map((f, i) => {
      let val = f.value;
      if (isCabinConfigurationRow(f.label) && !quotation.isCabinConfigCustom && derivedCabin) {
        val = derivedCabin;
      }
      return {
        id: `gi-${i}-${uid().slice(0, 4)}`,
        label: f.label,
        value: val,
        valueType: "TEXT",
        order: i + 1,
      };
    });
  } else {
    generalInfoRows = parseMarkdownToGeneralInfoRows(
      company?.quotationGeneralInfoMarkdown,
      quotation.items,
      quotation.cabinConfigurationOverride,
      quotation.isCabinConfigCustom,
      company?.generalInfoFields,
    );
  }

  const includeGeneralInfo = quotation.includeGeneralInfo !== undefined
    ? quotation.includeGeneralInfo
    : (company?.showQuotationGeneralInfo !== false);

  // 2. Technical Specifications
  const hasExistingTechSpecs = Boolean(
    quotation.structuredSections && quotation.structuredSections.length > 0
  ) || Boolean(
    quotation.technicalSpecificationSnapshot && quotation.technicalSpecificationSnapshot.length > 0
  );

  let structuredSections: QuotationSection[] = [];
  if (hasExistingTechSpecs) {
    if (quotation.structuredSections && quotation.structuredSections.length > 0) {
      structuredSections = quotation.structuredSections;
    } else if (quotation.technicalSpecificationSnapshot && quotation.technicalSpecificationSnapshot.length > 0) {
      structuredSections = quotation.technicalSpecificationSnapshot.map((ts, idx) => ({
        id: uid(),
        type: "SPEC_TABLE" as const,
        title: ts.title,
        order: idx + 1,
        rows: (ts.rows || []).map((r: any, rIdx: number) => ({
          id: uid(),
          label: r.label,
          value: r.value,
          order: rIdx + 1,
        })),
      }));
    }
  } else {
    structuredSections = parseMarkdownToTechSpecSections(company?.quotationTechnicalSpecsMarkdown);
  }

  const includeTechSpecs = quotation.includeTechSpecs !== undefined
    ? quotation.includeTechSpecs
    : (company?.showQuotationTechnicalSpecs !== false);

  // 3. Terms & Conditions
  const hasExistingTerms = Boolean(
    quotation.structuredTerms && quotation.structuredTerms.length > 0
  ) || Boolean(
    quotation.termsSnapshot && quotation.termsSnapshot.length > 0
  );

  let structuredTerms: StructuredTermItem[] = [];
  if (hasExistingTerms) {
    if (quotation.structuredTerms && quotation.structuredTerms.length > 0) {
      structuredTerms = quotation.structuredTerms;
    } else if (quotation.termsSnapshot && quotation.termsSnapshot.length > 0) {
      structuredTerms = quotation.termsSnapshot.map((text, idx) => ({
        id: uid(),
        order: idx + 1,
        text,
        format: "NUMBERED" as const,
      }));
    }
  } else {
    const rawTermsMd = company?.quotationTermsMarkdown || company?.terms;
    structuredTerms = parseMarkdownToStructuredTerms(rawTermsMd);
  }

  const includeTerms = quotation.includeTerms !== undefined
    ? quotation.includeTerms
    : (company?.showQuotationTerms !== false);

  return {
    includeGeneralInfo,
    generalInfoRows,
    includeTechSpecs,
    structuredSections,
    includeTerms,
    structuredTerms,
  };
}

/**
 * Resolves initial/hydrated terms, tech specs & general info for an Invoice from Company Settings.
 * Preserves existing document-specific snapshots if present (e.g. converted from quotation or edited).
 */
export function hydrateInvoiceFromCompany(
  invoice: Invoice,
  company: any,
): {
  includeGeneralInfo: boolean;
  generalInfoRows: SectionRow[];
  generalInformationSnapshot: GeneralInfoField[];
  includeTechSpecs: boolean;
  structuredSections: QuotationSection[];
  technicalSpecificationSnapshot: TechSpecSection[];
  includeTerms: boolean;
  structuredTerms: StructuredTermItem[];
  termsSnapshot: string[];
  terms: string;
} {
  // 1. General Information
  const hasExistingGenInfo = Boolean(
    invoice.generalInformationSnapshot && invoice.generalInformationSnapshot.length > 0
  ) || Boolean(
    invoice.generalInfoSnapshot && invoice.generalInfoSnapshot.length > 0
  );

  let generalInfoRows: SectionRow[] = [];
  if (hasExistingGenInfo) {
    const rawFields = invoice.generalInformationSnapshot || invoice.generalInfoSnapshot || [];
    generalInfoRows = rawFields.map((f, idx) => ({
      id: uid(),
      label: f.label,
      value: f.value,
      order: idx + 1,
    }));
  } else {
    generalInfoRows = parseMarkdownToGeneralInfoRows(
      company?.invoiceGeneralInfoMarkdown || company?.quotationGeneralInfoMarkdown,
      invoice.items,
      invoice.cabinConfigurationOverride,
      invoice.isCabinConfigCustom,
      company?.generalInfoFields,
    );
  }

  const generalInformationSnapshot: GeneralInfoField[] = generalInfoRows.map(r => ({
    label: r.label,
    value: r.value,
  }));

  const includeGeneralInfo = invoice.includeGeneralInfo !== undefined
    ? invoice.includeGeneralInfo
    : (company?.showInvoiceGeneralInfo !== undefined
        ? company.showInvoiceGeneralInfo === true
        : generalInfoRows.length > 0);

  // 2. Technical Specifications
  const hasExistingTechSpecs = Boolean(
    invoice.structuredSections && invoice.structuredSections.length > 0
  ) || Boolean(
    invoice.technicalSpecificationSnapshot && invoice.technicalSpecificationSnapshot.length > 0
  ) || Boolean(
    invoice.techSpecSnapshot && invoice.techSpecSnapshot.length > 0
  );

  let structuredSections: QuotationSection[] = [];
  if (hasExistingTechSpecs) {
    if (invoice.structuredSections && invoice.structuredSections.length > 0) {
      structuredSections = invoice.structuredSections;
    } else {
      const existingSpecs = (invoice.technicalSpecificationSnapshot && invoice.technicalSpecificationSnapshot.length > 0)
        ? invoice.technicalSpecificationSnapshot
        : (invoice.techSpecSnapshot || []);
      structuredSections = existingSpecs.map((ts, idx) => ({
        id: uid(),
        type: "SPEC_TABLE" as const,
        title: ts.title,
        order: idx + 1,
        rows: (ts.rows || []).map((r: any, rIdx: number) => ({
          id: uid(),
          label: r.label,
          value: r.value,
          order: rIdx + 1,
        })),
      }));
    }
  } else {
    structuredSections = parseMarkdownToTechSpecSections(
      company?.invoiceTechnicalSpecsMarkdown || company?.quotationTechnicalSpecsMarkdown
    );
  }

  const technicalSpecificationSnapshot: TechSpecSection[] = structuredSections.map(s => ({
    title: s.title,
    rows: (s.rows || []).map(r => ({ label: r.label, value: r.value })),
  }));

  const includeTechSpecs = invoice.includeTechSpecs !== undefined
    ? invoice.includeTechSpecs
    : (company?.showInvoiceTechnicalSpecs !== undefined
        ? company.showInvoiceTechnicalSpecs === true
        : structuredSections.length > 0);

  // 3. Terms & Conditions
  const hasExistingTerms = Boolean(
    invoice.structuredTerms && invoice.structuredTerms.length > 0
  ) || Boolean(
    invoice.termsSnapshot && invoice.termsSnapshot.length > 0
  ) || Boolean(
    invoice.terms && invoice.terms.trim()
  );

  let structuredTerms: StructuredTermItem[] = [];
  if (hasExistingTerms) {
    if (invoice.structuredTerms && invoice.structuredTerms.length > 0) {
      structuredTerms = invoice.structuredTerms;
    } else if (invoice.termsSnapshot && invoice.termsSnapshot.length > 0) {
      structuredTerms = invoice.termsSnapshot.map((text, idx) => ({
        id: uid(),
        order: idx + 1,
        text,
        format: "NUMBERED" as const,
      }));
    } else if (invoice.terms && invoice.terms.trim()) {
      structuredTerms = parseMarkdownToStructuredTerms(invoice.terms);
    }
  } else {
    const rawTermsMd = company?.invoiceTermsMarkdown || company?.terms;
    structuredTerms = parseMarkdownToStructuredTerms(rawTermsMd);
  }

  const termsSnapshot = structuredTerms.map(t => t.text);
  const terms = structuredTerms.map((t, idx) => `${idx + 1}. ${t.text}`).join("\n");

  const includeTerms = invoice.includeTerms !== undefined
    ? invoice.includeTerms
    : (company?.showInvoiceTerms !== false);

  return {
    includeGeneralInfo,
    generalInfoRows,
    generalInformationSnapshot,
    includeTechSpecs,
    structuredSections,
    technicalSpecificationSnapshot,
    includeTerms,
    structuredTerms,
    termsSnapshot,
    terms,
  };
}
