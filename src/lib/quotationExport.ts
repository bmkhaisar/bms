import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  ImageRun, Header, Footer, PageNumber, PageOrientation,
} from "docx";
import type {
  Quotation, CompanySettings, Customer, QuotationTemplate,
  GeneralInfoField, TechSpecSection, BankAccount, LineItem,
} from "./db";
import { formatDate, formatMoney, numberToWordsIndian } from "./format";
import { getLogoDataUrl, getLogoBytes } from "./logoData";

const FOOTER_MARK = "Built by MMA";
// jsPDF's built-in Helvetica lacks the ₹ glyph (renders as superscript 1).
// Use "Rs." for all PDF amounts. DOCX/HTML can safely use ₹.
const PDF_CCY = "Rs. ";
const money = (n: number) => formatMoney(n, PDF_CCY);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function defaultTemplate(): QuotationTemplate {
  return {
    id: "default", name: "Default", accent: "#1e40af",
    fontFamily: "helvetica", showLogo: true, tableStyle: "grid", createdAt: Date.now(),
  };
}

// ========================================================================
// PDF EXPORT
// ========================================================================

interface PdfContext {
  doc: jsPDF;
  company: CompanySettings;
  quotation: Quotation;
  customer?: Customer;
  template: QuotationTemplate;
  accent: [number, number, number];
  logoData: string | null;
  companyLogoData: string | null;
  pageW: number;
  pageH: number;
  margin: number;
}

async function pdfHeader(ctx: PdfContext, isCover = false): Promise<number> {
  const { doc, company, template, accent, logoData, companyLogoData, pageW, margin } = ctx;
  const headerH = isCover ? 32 : 22;

  // Accent bar
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, pageW, isCover ? 3 : 2, "F");

  // PRD § 30: Display current tenant Company Logo when configured. Do NOT use BMS logo fallback.
  const logo = companyLogoData || (company as any)?.logoUrl || (company as any)?.logo || null;
  if (template.showLogo && logo) {
    try {
      const size = isCover ? 22 : 14;
      doc.addImage(logo, "PNG", margin, isCover ? 8 : 5, size, size);
    } catch { /* ignore */ }
  }

  const textX = template.showLogo && logo ? margin + (isCover ? 26 : 18) : margin;

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(isCover ? 16 : 12);
  doc.setTextColor(20, 20, 20);
  doc.text(company.name || "Company", textX, isCover ? 15 : 10);

  doc.setFont(template.fontFamily, "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  // Only name, address, and phone in the top header (per user preference).
  const lines: string[] = [];
  if (company.address) lines.push(company.address.replace(/\n/g, ", "));
  if (company.mobile) lines.push(`Mob: ${company.mobile}`);

  let y = isCover ? 20 : 14;
  for (const t of lines) {
    doc.text(t, textX, y, { maxWidth: pageW - textX - margin - 40 });
    y += 4;
  }

  // Right block: QUOTATION title (cover only)
  if (isCover) {
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.4);
    doc.rect(pageW - margin - 55, 8, 55, 12);
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(11);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("QUOTATION", pageW - margin - 27.5, 15, { align: "center" });
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(`No: ${ctx.quotation.number}`, pageW - margin - 27.5, 24, { align: "center" });
  }

  return headerH;
}

function pdfFooter(ctx: PdfContext, pageNum: number, totalPages: number) {
  const { doc, template, accent, pageW, pageH, margin } = ctx;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - 12, pageW - margin, pageH - 12);

  doc.setFont(template.fontFamily, "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(template.footerText || FOOTER_MARK, margin, pageH - 7);
  doc.text(`Page ${pageNum} of ${totalPages}`, pageW - margin, pageH - 7, { align: "right" });

  // Subtle watermark bottom center
  doc.setFontSize(6);
  doc.setTextColor(180, 180, 180);
  doc.text(FOOTER_MARK, pageW / 2, pageH - 3, { align: "center" });
}

async function drawCover(ctx: PdfContext): Promise<number> {
  const { doc, quotation, customer, template, accent, pageW, margin } = ctx;
  let y = (await pdfHeader(ctx, true)) + 8;

  // Customer + meta split
  doc.setDrawColor(230);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, y, pageW - margin * 2, 34, "FD");

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(9);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text("BILL TO", margin + 4, y + 6);
  doc.text("QUOTATION DETAILS", pageW / 2 + 4, y + 6);

  doc.setFont(template.fontFamily, "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  let ly = y + 11;
  if (customer) {
    doc.setFont(template.fontFamily, "bold");
    doc.text(customer.name, margin + 4, ly); ly += 4;
    doc.setFont(template.fontFamily, "normal");
    if (customer.company) { doc.text(customer.company, margin + 4, ly); ly += 4; }
    if (customer.address) {
      const lines = doc.splitTextToSize(customer.address, pageW / 2 - 10);
      doc.text(lines, margin + 4, ly); ly += 4 * lines.length;
    }
    if (customer.mobile) { doc.text(`Mob: ${customer.mobile}`, margin + 4, ly); ly += 4; }
    if (customer.gstin) { doc.text(`GSTIN: ${customer.gstin}`, margin + 4, ly); ly += 4; }
  }

  const rx = pageW / 2 + 4;
  let ry = y + 11;
  const meta: [string, string][] = [
    ["Number", quotation.number],
    ["Date", formatDate(quotation.date)],
    ...(quotation.validity ? [["Valid Until", formatDate(quotation.validity)] as [string, string]] : []),
    ...(quotation.preparedBy ? [["Prepared By", quotation.preparedBy] as [string, string]] : []),
    ...(quotation.siteLocation ? [["Site/Location", quotation.siteLocation] as [string, string]] : []),
    ...(quotation.contactPerson ? [["Contact", `${quotation.contactPerson}${quotation.contactPhone ? ` · ${quotation.contactPhone}` : ""}`] as [string, string]] : []),
  ];
  for (const [k, v] of meta) {
    doc.setFont(template.fontFamily, "bold");
    doc.text(`${k}:`, rx, ry);
    doc.setFont(template.fontFamily, "normal");
    doc.text(v, rx + 28, ry, { maxWidth: pageW / 2 - 32 });
    ry += 4;
  }

  y += 40;

  // Items table
  const head = [["#", "Item / Description", "Size", "Qty", "Unit", "Rate", "Disc%", "GST%", "Amount"]];
  const body = quotation.items.map((it, i) => [
    String(i + 1),
    it.name + (it.description ? `\n${it.description}` : ""),
    it.size || "-",
    String(it.quantity),
    it.unit,
    formatMoney(it.rate, ""),
    `${it.discountPct}%`,
    `${it.gstRate}%`,
    formatMoney(it.total, ""),
  ]);

  autoTable(doc, {
    head, body, startY: y,
    margin: { left: margin, right: margin },
    styles: { font: template.fontFamily, fontSize: 8, cellPadding: 2, lineColor: [220, 220, 220], lineWidth: 0.1 },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold", halign: "center" },
    bodyStyles: { textColor: 30 },
    alternateRowStyles: template.tableStyle === "striped" ? { fillColor: [248, 250, 252] } : undefined,
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      3: { halign: "right" }, 5: { halign: "right" },
      6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right", fontStyle: "bold" },
    },
    theme: template.tableStyle === "plain" ? "plain" : "grid",
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // Totals + extras
  const rightX = pageW - margin - 70;
  const rows: [string, string][] = [
    ["Subtotal", money(quotation.subtotal)],
    ["Discount", `- ${money(quotation.discountTotal)}`],
    ["GST", money(quotation.gstTotal)],
  ];
  for (const c of quotation.extraCharges || []) {
    if (c.amount) rows.push([c.label || "Charge", money(c.amount)]);
  }
  rows.push(["Round Off", money(quotation.roundOff)]);

  autoTable(doc, {
    body: rows, startY: y,
    margin: { left: rightX, right: margin },
    styles: { font: template.fontFamily, fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 30 }, 1: { halign: "right" } },
    theme: "plain",
  });
  y = (doc as any).lastAutoTable.finalY + 1;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.5);
  doc.line(rightX, y, pageW - margin, y);
  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(11);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  y += 5;
  doc.text("Grand Total", rightX, y);
  doc.text(money(quotation.grandTotal), pageW - margin, y, { align: "right" });

  y += 5;
  doc.setFont(template.fontFamily, "italic");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  const words = numberToWordsIndian(quotation.grandTotal);
  const wl = doc.splitTextToSize(`Amount in words: ${words}`, pageW - margin * 2);
  doc.text(wl, margin, y);
  return y + wl.length * 4;
}

async function drawSectionsPage(ctx: PdfContext, title: string, sections: Array<{ heading: string; rows: [string, string][] }>) {
  const { doc, template, accent, pageW, margin } = ctx;
  doc.addPage();
  let y = (await pdfHeader(ctx, false)) + 6;

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(13);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(title, margin, y);
  y += 3;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  for (const s of sections) {
    if (s.rows.length === 0) continue;
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(s.heading, margin, y + 4);
    autoTable(doc, {
      body: s.rows, startY: y + 6,
      margin: { left: margin, right: margin },
      styles: { font: template.fontFamily, fontSize: 8.5, cellPadding: 2, lineColor: [220, 220, 220], lineWidth: 0.1 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 55, fillColor: [248, 250, 252] }, 1: {} },
      theme: "grid",
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }
}

async function drawTermsPage(ctx: PdfContext) {
  const { doc, template, accent, quotation, company, pageW, pageH, margin } = ctx;
  doc.addPage();
  let y = (await pdfHeader(ctx, false)) + 6;

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(13);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text("Terms, Conditions & Payment", margin, y);
  y += 3;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  const terms = quotation.termsSnapshot?.length ? quotation.termsSnapshot : (quotation.terms ? quotation.terms.split(/\n+/) : company.terms ? company.terms.split(/\n+/) : []);
  if (terms.length) {
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text("Terms & Conditions", margin, y);
    y += 4;
    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i].trim();
      if (!t) continue;
      const lines = doc.splitTextToSize(`${i + 1}. ${t.replace(/^\d+[.)]\s*/, "")}`, pageW - margin * 2 - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4.5 + 1;
      if (y > pageH - 40) { doc.addPage(); y = (await pdfHeader(ctx, false)) + 6; }
    }
    y += 4;
  }

  const bank = quotation.bankSnapshot;
  if (bank) {
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(10);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("Bank Details", margin, y);
    y += 4;
    autoTable(doc, {
      body: [
        ["Bank", bank.bankName],
        ["A/C Name", bank.accountName],
        ["A/C No.", bank.accountNo],
        ["IFSC", bank.ifsc],
        ...(bank.branch ? [["Branch", bank.branch]] : []),
        ...(bank.upi ? [["UPI", bank.upi]] : []),
      ],
      startY: y,
      margin: { left: margin, right: pageW / 2 },
      styles: { font: template.fontFamily, fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 30, fillColor: [248, 250, 252] } },
      theme: "grid",
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // Signature block
  if (y > pageH - 60) { doc.addPage(); y = (await pdfHeader(ctx, false)) + 6; }
  y = Math.max(y, pageH - 60);
  doc.setFont(template.fontFamily, "italic");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text("Thank you for your business.", margin, y);

  const sigX = pageW - margin - 60;
  doc.setFont(template.fontFamily, "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(`For ${company.name}`, sigX, y);
  if (company.signature) {
    try { doc.addImage(company.signature, "PNG", sigX, y + 3, 40, 14); } catch { /* ignore */ }
  }
  if (company.stamp) {
    try { doc.addImage(company.stamp, "PNG", sigX + 42, y + 3, 18, 18); } catch { /* ignore */ }
  }
  doc.setDrawColor(150);
  doc.line(sigX, y + 22, sigX + 60, y + 22);
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(company.authorizedSignatory || "Authorized Signatory", sigX, y + 26);
}

export async function exportQuotationPDF(
  quotation: Quotation,
  company: CompanySettings,
  customer?: Customer,
  template?: QuotationTemplate,
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const tpl = template || defaultTemplate();
  const logoData = await getLogoDataUrl();
  const companyLogoData = company.logo || null;
  const ctx: PdfContext = {
    doc, company, quotation, customer, template: tpl,
    accent: hexToRgb(tpl.accent),
    logoData, companyLogoData,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    margin: 12,
  };

  await drawCover(ctx);

  if (quotation.generalInfoSnapshot?.length) {
    await drawSectionsPage(ctx, "General Information", [
      { heading: "Configuration & Site", rows: quotation.generalInfoSnapshot.map(f => [f.label, f.value] as [string, string]) },
    ]);
  }

  if (quotation.techSpecSnapshot?.length) {
    await drawSectionsPage(ctx, "Fabrication / Technical Specifications",
      quotation.techSpecSnapshot.map(sec => ({
        heading: sec.title,
        rows: sec.rows.map(r => [r.label, r.value] as [string, string]),
      })));
  }

  if (quotation.electricalSnapshot?.length) {
    await drawSectionsPage(ctx, "Electrical / Additional Specifications",
      quotation.electricalSnapshot.map(sec => ({
        heading: sec.title,
        rows: sec.rows.map(r => [r.label, r.value] as [string, string]),
      })));
  }

  await drawTermsPage(ctx);

  // Page numbers + footer on all pages
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    pdfFooter(ctx, i, total);
  }

  return doc.output("blob");
}

export async function downloadQuotationPDF(
  quotation: Quotation, company: CompanySettings, customer?: Customer, template?: QuotationTemplate,
) {
  const blob = await exportQuotationPDF(quotation, company, customer, template);
  triggerDownload(blob, `${quotation.number}.pdf`);
}

export async function printQuotationPDF(
  quotation: Quotation, company: CompanySettings, customer?: Customer, template?: QuotationTemplate,
) {
  const blob = await exportQuotationPDF(quotation, company, customer, template);
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 60000);
  };
}

// ========================================================================
// DOCX EXPORT
// ========================================================================

const ACCENT_HEX = "1E40AF";

function P(text: string, opts: { bold?: boolean; size?: number; color?: string; align?: any } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, color: opts.color, font: "Calibri" })],
  });
}

function cell(text: string, opts: { bold?: boolean; shade?: string; width?: number; align?: any; color?: string } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts.align,
      children: [new TextRun({ text: text ?? "", bold: opts.bold, size: 18, color: opts.color, font: "Calibri" })],
    })],
  });
}

function kvTable(rows: [string, string][], accent = ACCENT_HEX): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3200, 6160],
    rows: rows.map(([k, v]) => new TableRow({
      children: [cell(k, { bold: true, shade: "F1F5F9", width: 3200 }), cell(v, { width: 6160 })],
    })),
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT_HEX, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 26, color: ACCENT_HEX, font: "Calibri" })],
  });
}

export async function exportQuotationDOCX(
  quotation: Quotation,
  company: CompanySettings,
  customer?: Customer,
): Promise<Blob> {
  const logoBytes = (company.logo?.startsWith("data:")
    ? Uint8Array.from(atob(company.logo.split(",")[1]), c => c.charCodeAt(0))
    : await getLogoBytes());

  const headerChildren: Paragraph[] = [];
  if (logoBytes) {
    headerChildren.push(new Paragraph({
      children: [new ImageRun({
        type: "png", data: logoBytes,
        transformation: { width: 50, height: 50 },
        altText: { title: "Logo", description: "Company logo", name: "logo" },
      })],
    }));
  }

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: company.name || "Company", bold: true, size: 22, color: ACCENT_HEX, font: "Calibri" }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_HEX, space: 4 } },
        children: [
          new TextRun({ text: FOOTER_MARK, size: 16, color: "888888", font: "Calibri" }),
          new TextRun({ text: "\tPage ", size: 16, color: "888888", font: "Calibri" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888", font: "Calibri" }),
          new TextRun({ text: " of ", size: 16, color: "888888", font: "Calibri" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "888888", font: "Calibri" }),
        ],
      }),
    ],
  });

  // Cover header block
  const cover: (Paragraph | Table)[] = [];

  // Company name + QUOTATION title row
  const titleTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [5600, 3760],
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 5600, type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [
              P(company.name || "Company", { bold: true, size: 32, color: ACCENT_HEX }),
              ...(company.address ? [P(company.address, { size: 16, color: "555555" })] : []),
              ...(company.mobile ? [P(`Mob: ${company.mobile}`, { size: 16, color: "555555" })] : []),
            ],
          }),
          new TableCell({
            width: { size: 3760, type: WidthType.DXA },
            shading: { fill: ACCENT_HEX, type: ShadingType.CLEAR, color: "auto" },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            children: [
              P("QUOTATION", { bold: true, size: 28, color: "FFFFFF", align: AlignmentType.CENTER }),
              P(quotation.number, { size: 20, color: "FFFFFF", align: AlignmentType.CENTER }),
              P(formatDate(quotation.date), { size: 16, color: "E2E8F0", align: AlignmentType.CENTER }),
            ],
          }),
        ],
      }),
    ],
  });
  cover.push(titleTable);
  cover.push(P(""));

  // Bill-to + details
  const billToLines: Paragraph[] = [P("BILL TO", { bold: true, size: 18, color: ACCENT_HEX })];
  if (customer) {
    billToLines.push(P(customer.name, { bold: true, size: 22 }));
    if (customer.company) billToLines.push(P(customer.company));
    if (customer.address) billToLines.push(P(customer.address));
    if (customer.mobile) billToLines.push(P(`Mob: ${customer.mobile}`));
    if (customer.gstin) billToLines.push(P(`GSTIN: ${customer.gstin}`));
  }

  const metaRows: [string, string][] = [
    ["Quote No.", quotation.number],
    ["Date", formatDate(quotation.date)],
    ...(quotation.validity ? [["Valid Until", formatDate(quotation.validity)] as [string, string]] : []),
    ...(quotation.preparedBy ? [["Prepared By", quotation.preparedBy] as [string, string]] : []),
    ...(quotation.siteLocation ? [["Site/Location", quotation.siteLocation] as [string, string]] : []),
    ...(quotation.contactPerson ? [["Contact", `${quotation.contactPerson}${quotation.contactPhone ? ` · ${quotation.contactPhone}` : ""}`] as [string, string]] : []),
  ];

  const billToTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "F8FAFC", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: billToLines,
        }),
        new TableCell({
          width: { size: 4680, type: WidthType.DXA },
          shading: { fill: "F8FAFC", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [
            P("QUOTATION DETAILS", { bold: true, size: 18, color: ACCENT_HEX }),
            ...metaRows.map(([k, v]) => new Paragraph({
              children: [
                new TextRun({ text: `${k}: `, bold: true, size: 18, font: "Calibri" }),
                new TextRun({ text: v, size: 18, font: "Calibri" }),
              ],
            })),
          ],
        }),
      ],
    })],
  });
  cover.push(billToTable);
  cover.push(P(""));

  // Items table
  const itemHead = new TableRow({
    tableHeader: true,
    children: ["#", "Item / Description", "Size", "Qty", "Unit", "Rate", "Disc%", "GST%", "Amount"].map(h =>
      cell(h, { bold: true, shade: ACCENT_HEX, color: "FFFFFF", align: AlignmentType.CENTER })),
  });
  const itemRows = quotation.items.map((it, i) => new TableRow({
    children: [
      cell(String(i + 1), { align: AlignmentType.CENTER }),
      new TableCell({
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [
          P(it.name, { bold: true }),
          ...(it.description ? [P(it.description, { size: 16, color: "555555" })] : []),
        ],
      }),
      cell(it.size || "-"),
      cell(String(it.quantity), { align: AlignmentType.RIGHT }),
      cell(it.unit),
      cell(formatMoney(it.rate, ""), { align: AlignmentType.RIGHT }),
      cell(`${it.discountPct}%`, { align: AlignmentType.RIGHT }),
      cell(`${it.gstRate}%`, { align: AlignmentType.RIGHT }),
      cell(formatMoney(it.total, ""), { bold: true, align: AlignmentType.RIGHT }),
    ],
  }));
  const itemsTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [400, 2800, 900, 700, 700, 1100, 700, 700, 1360],
    rows: [itemHead, ...itemRows],
  });
  cover.push(itemsTable);
  cover.push(P(""));

  // Totals
  const totalsRows: [string, string][] = [
    ["Subtotal", formatMoney(quotation.subtotal)],
    ["Discount", `- ${formatMoney(quotation.discountTotal)}`],
    ["GST", formatMoney(quotation.gstTotal)],
  ];
  for (const c of quotation.extraCharges || []) if (c.amount) totalsRows.push([c.label || "Charge", formatMoney(c.amount)]);
  totalsRows.push(["Round Off", formatMoney(quotation.roundOff)]);
  totalsRows.push(["GRAND TOTAL", formatMoney(quotation.grandTotal)]);

  const totalsTable = new Table({
    width: { size: 4680, type: WidthType.DXA },
    alignment: AlignmentType.RIGHT,
    columnWidths: [2340, 2340],
    rows: totalsRows.map(([k, v], idx) => {
      const isGrand = idx === totalsRows.length - 1;
      return new TableRow({
        children: [
          cell(k, { bold: true, shade: isGrand ? ACCENT_HEX : "F1F5F9", color: isGrand ? "FFFFFF" : undefined, width: 2340 }),
          cell(v, { bold: isGrand, shade: isGrand ? ACCENT_HEX : undefined, color: isGrand ? "FFFFFF" : undefined, align: AlignmentType.RIGHT, width: 2340 }),
        ],
      });
    }),
  });
  cover.push(totalsTable);
  cover.push(P(""));
  cover.push(P(`Amount in words: ${numberToWordsIndian(quotation.grandTotal)}`, { size: 18, color: "555555" }));

  // Additional pages
  const extras: (Paragraph | Table)[] = [];

  if (quotation.generalInfoSnapshot?.length) {
    extras.push(new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true }));
    extras.push(sectionHeading("General Information"));
    extras.push(kvTable(quotation.generalInfoSnapshot.map(f => [f.label, f.value])));
  }

  if (quotation.techSpecSnapshot?.length) {
    extras.push(new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true }));
    extras.push(sectionHeading("Fabrication / Technical Specifications"));
    for (const sec of quotation.techSpecSnapshot) {
      extras.push(P(sec.title, { bold: true, size: 22, color: "1E40AF" }));
      extras.push(kvTable(sec.rows.map(r => [r.label, r.value])));
      extras.push(P(""));
    }
  }

  if (quotation.electricalSnapshot?.length) {
    extras.push(new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true }));
    extras.push(sectionHeading("Electrical / Additional Specifications"));
    for (const sec of quotation.electricalSnapshot) {
      extras.push(P(sec.title, { bold: true, size: 22, color: "1E40AF" }));
      extras.push(kvTable(sec.rows.map(r => [r.label, r.value])));
      extras.push(P(""));
    }
  }

  // Terms/bank/signature
  extras.push(new Paragraph({ children: [new TextRun({ break: 1 })], pageBreakBefore: true }));
  extras.push(sectionHeading("Terms, Conditions & Payment"));
  const terms = quotation.termsSnapshot?.length ? quotation.termsSnapshot : (company.terms ? company.terms.split(/\n+/) : []);
  if (terms.length) {
    extras.push(P("Terms & Conditions", { bold: true, size: 22 }));
    terms.forEach((t, i) => {
      if (!t.trim()) return;
      extras.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 18, font: "Calibri" }),
          new TextRun({ text: t.replace(/^\d+[.)]\s*/, ""), size: 18, font: "Calibri" }),
        ],
      }));
    });
    extras.push(P(""));
  }

  if (quotation.bankSnapshot) {
    const b = quotation.bankSnapshot;
    extras.push(P("Bank Details", { bold: true, size: 22, color: ACCENT_HEX }));
    extras.push(kvTable([
      ["Bank", b.bankName],
      ["A/C Name", b.accountName],
      ["A/C No.", b.accountNo],
      ["IFSC", b.ifsc],
      ...(b.branch ? [["Branch", b.branch] as [string, string]] : []),
      ...(b.upi ? [["UPI", b.upi] as [string, string]] : []),
    ]));
    extras.push(P(""));
  }

  extras.push(P("Thank you for your business.", { size: 18, color: "555555" }));
  extras.push(P(""));
  extras.push(P(`For ${company.name}`, { bold: true, size: 20 }));
  extras.push(P(""));
  extras.push(P(""));
  extras.push(P(company.authorizedSignatory || "Authorized Signatory", { size: 18, color: "555555" }));

  const docx = new Document({
    creator: "BMS",
    title: `Quotation ${quotation.number}`,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
          margin: { top: 900, right: 900, bottom: 900, left: 900, header: 400, footer: 400 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: [...cover, ...extras],
    }],
  });

  const blob = await Packer.toBlob(docx);
  return blob;
}

export async function downloadQuotationDOCX(
  quotation: Quotation, company: CompanySettings, customer?: Customer,
) {
  const blob = await exportQuotationDOCX(quotation, company, customer);
  triggerDownload(blob, `${quotation.number}.docx`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Helper to compute an items ordering-friendly clone
export function reorderItems<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export type { LineItem };
