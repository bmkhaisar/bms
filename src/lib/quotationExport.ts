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
  QuotationSection, SectionRow, StructuredTermItem,
} from "./db.ts";
import { formatDate, formatMoney, numberToWordsIndian } from "./format.ts";
import { getLogoDataUrl, getLogoBytes } from "./logoData.ts";
import { formatCompanyAddress } from "./companyAddress.ts";
import { resolveDocumentModel } from "./documentModel.ts";
import { extractTableRowsFromMarkdown, extractTermsFromMarkdown, parseMarkdownToBlocks } from "./markdownDoc.ts";

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

  // Top Accent bar
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, pageW, isCover ? 3.5 : 2, "F");

  const logo = companyLogoData || (company as any)?.logoUrl || (company as any)?.logo || null;
  const companyAddr = formatCompanyAddress(company);

  if (isCover) {
    let textX = margin;
    if (template.showLogo && logo) {
      try {
        doc.addImage(logo, "PNG", margin, 7, 20, 20);
        textX = margin + 24;
      } catch { /* ignore */ }
    }

    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(15);
    doc.setTextColor(20, 20, 20);
    doc.text(companyAddr.companyName, textX, 13);

    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(8);
    doc.setTextColor(70, 70, 70);

    let y = 17.5;
    // 1. Street Address Lines
    for (const line of companyAddr.addressLines) {
      doc.text(line, textX, y, { maxWidth: pageW - textX - margin - 58 });
      y += 3.6;
    }
    // 2. City, State - Pincode
    if (companyAddr.cityStatePincode) {
      doc.text(companyAddr.cityStatePincode, textX, y, { maxWidth: pageW - textX - margin - 58 });
      y += 3.6;
    }
    // 3. Contact Phone & Email
    if (companyAddr.contactLine) {
      doc.text(companyAddr.contactLine, textX, y, { maxWidth: pageW - textX - margin - 58 });
      y += 3.6;
    }
    // 4. GSTIN
    if (companyAddr.gstin) {
      doc.setFont(template.fontFamily, "bold");
      doc.setTextColor(40, 40, 40);
      doc.text(`GSTIN: ${companyAddr.gstin}`, textX, y);
      doc.setFont(template.fontFamily, "normal");
      doc.setTextColor(70, 70, 70);
      y += 3.6;
    }

    // Right block: QUOTATION title box
    const boxW = 56;
    const boxH = 14;
    const boxX = pageW - margin - boxW;
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.4);
    doc.setFillColor(250, 252, 255);
    doc.rect(boxX, 7, boxW, boxH, "FD");

    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(12);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text("QUOTATION", boxX + boxW / 2, 13.5, { align: "center" });

    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(50, 50, 50);
    doc.text(`No: ${ctx.quotation.number}`, boxX + boxW / 2, 18.5, { align: "center" });

    return Math.max(34, y + 2);
  } else {
    // Continuation page compact header
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(30, 30, 30);
    doc.text(companyAddr.companyName, margin, 8);

    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    const summaryAddr = [companyAddr.cityStatePincode, companyAddr.phone ? `Ph: ${companyAddr.phone}` : ""].filter(Boolean).join(" · ");
    if (summaryAddr) {
      doc.text(summaryAddr, margin, 12);
    }

    // Right: Document reference
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(8);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(`Quotation: ${ctx.quotation.number}`, pageW - margin, 8, { align: "right" });

    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(`Date: ${formatDate(ctx.quotation.date)}`, pageW - margin, 12, { align: "right" });

    // Subtle divider line
    doc.setDrawColor(220, 225, 230);
    doc.setLineWidth(0.3);
    doc.line(margin, 15, pageW - margin, 15);

    return 18;
  }
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
  let y = (await pdfHeader(ctx, true)) + 6;

  // Quotation Metadata Bar
  doc.setDrawColor(220, 225, 230);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, pageW - margin * 2, 8, 1, 1, "FD");

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(8);
  doc.setTextColor(accent[0], accent[1], accent[2]);

  const colW = (pageW - margin * 2) / 4;
  doc.text(`Quotation #: ${quotation.number}`, margin + 3, y + 5.5);
  doc.setFont(template.fontFamily, "normal");
  doc.setTextColor(50, 50, 50);
  doc.text(`Date: ${formatDate(quotation.date)}`, margin + colW + 3, y + 5.5);
  if (quotation.validity) {
    doc.text(`Valid Until: ${formatDate(quotation.validity)}`, margin + colW * 2 + 3, y + 5.5);
  }
  if (quotation.preparedBy) {
    doc.text(`Prepared By: ${quotation.preparedBy}`, margin + colW * 3 + 3, y + 5.5);
  }

  y += 11;

  // Split: BILL TO & SHIP TO side-by-side boxes (PRD §§ 31, 38)
  const boxW = (pageW - margin * 2 - 4) / 2;
  const boxH = 34;

  // Bill To Box
  doc.setDrawColor(220, 225, 230);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, boxW, boxH, 1, 1, "FD");

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text("BILL TO (CUSTOMER)", margin + 4, y + 5);

  const billParty = quotation.billToSnapshot || (customer ? {
    partyName: customer.name,
    tradingName: customer.company,
    address: quotation.billingAddress || customer.address,
    city: customer.city,
    state: customer.state,
    pincode: customer.pincode,
    gstin: customer.gstin,
    phone: customer.mobile || customer.phone,
    contactPerson: quotation.contactPerson || customer.contactPerson,
  } : null);

  let by = y + 10;
  if (billParty) {
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    doc.text(billParty.partyName || "Customer", margin + 4, by, { maxWidth: boxW - 8 });
    by += 4;
    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(70, 70, 70);
    if (billParty.tradingName && billParty.tradingName !== billParty.partyName) {
      doc.text(billParty.tradingName, margin + 4, by, { maxWidth: boxW - 8 });
      by += 3.5;
    }
    const billAddr = billParty.address || [billParty.city, [billParty.state, billParty.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
    if (billAddr) {
      const lines = doc.splitTextToSize(billAddr, boxW - 8);
      for (let i = 0; i < Math.min(lines.length, 2); i++) {
        doc.text(lines[i], margin + 4, by);
        by += 3.5;
      }
    }
    if (billParty.gstin) {
      doc.text(`GSTIN: ${billParty.gstin}`, margin + 4, by);
      by += 3.5;
    }
    if (billParty.phone) {
      doc.text(`Phone: ${billParty.phone}`, margin + 4, by);
    }
  }

  // Ship To Box
  const shipX = margin + boxW + 4;
  doc.setDrawColor(220, 225, 230);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(shipX, y, boxW, boxH, 1, 1, "FD");

  doc.setFont(template.fontFamily, "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text("SHIP TO (DELIVERY DESTINATION)", shipX + 4, y + 5);

  const isSame = quotation.sameAsBilling !== false;
  const shipParty = isSame
    ? billParty
    : (quotation.shipToPartySnapshot || quotation.shippingAddressSnapshot || billParty);

  let sy = y + 10;
  if (shipParty) {
    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    doc.text(shipParty.partyName || (isSame ? billParty?.partyName || "Customer" : "Site Consignee"), shipX + 4, sy, { maxWidth: boxW - 8 });
    sy += 4;
    doc.setFont(template.fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(70, 70, 70);
    
    const shipAddr = isSame
      ? (billParty?.address || quotation.billingAddress || "Same as billing address")
      : (quotation.shippingAddress || shipParty.address || [shipParty.city, [shipParty.state, shipParty.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", "));
    
    if (shipAddr) {
      const lines = doc.splitTextToSize(shipAddr, boxW - 8);
      for (let i = 0; i < Math.min(lines.length, 2); i++) {
        doc.text(lines[i], shipX + 4, sy);
        sy += 3.5;
      }
    }
    if (quotation.siteLocation) {
      doc.text(`Site: ${quotation.siteLocation}`, shipX + 4, sy, { maxWidth: boxW - 8 });
      sy += 3.5;
    }
    if (shipParty.phone && !isSame) {
      doc.text(`Phone: ${shipParty.phone}`, shipX + 4, sy);
    }
  }

  y += boxH + 6;

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
  const rightX = pageW - margin - 75;
  const rows: [string, string][] = [
    ["Subtotal", money(quotation.subtotal)],
  ];
  if (quotation.discountTotal && quotation.discountTotal > 0) {
    rows.push(["Discount", `- ${money(quotation.discountTotal)}`]);
  }

  // GST Breakdown: Support Overall GST vs Item-wise GST (PRD §§ 41-45, Correction #10, #13)
  if (quotation.gstCalculationMode === "overall" && quotation.overallGstRate !== undefined) {
    const rate = quotation.overallGstRate;
    if (quotation.isIgst) {
      rows.push([`IGST (${rate}%)`, money(quotation.igstTotal ?? quotation.gstTotal)]);
    } else {
      rows.push([`CGST (${rate / 2}%)`, money(quotation.cgstTotal ?? quotation.gstTotal / 2)]);
      rows.push([`SGST (${rate / 2}%)`, money(quotation.sgstTotal ?? quotation.gstTotal / 2)]);
    }
  } else {
    if (quotation.isIgst) {
      rows.push(["IGST", money(quotation.igstTotal ?? quotation.gstTotal)]);
    } else if (quotation.cgstTotal || quotation.sgstTotal) {
      rows.push(["CGST", money(quotation.cgstTotal ?? quotation.gstTotal / 2)]);
      rows.push(["SGST", money(quotation.sgstTotal ?? quotation.gstTotal / 2)]);
    } else {
      rows.push(["GST", money(quotation.gstTotal)]);
    }
  }

  for (const c of quotation.extraCharges || []) {
    if (c.amount) rows.push([c.label || "Charge", money(c.amount)]);
  }
  if (quotation.roundOff) {
    rows.push(["Round Off", money(quotation.roundOff)]);
  }

  autoTable(doc, {
    body: rows, startY: y,
    margin: { left: rightX, right: margin },
    styles: { font: template.fontFamily, fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 35 }, 1: { halign: "right" } },
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

async function drawSectionsPage(
  ctx: PdfContext,
  title: string,
  sections: Array<{
    heading: string;
    subtitle?: string;
    rows: Array<[string, string] | { label: string; value: string; bullets?: string[] }>;
  }>
) {
  const { doc, template, accent, pageW, pageH, margin } = ctx;
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
  y += 5;

  for (const s of sections) {
    if (!s.rows || s.rows.length === 0) continue;

    // Orphan heading prevention: ensure space for heading + at least 2 rows (~35mm)
    if (y > pageH - 45) {
      doc.addPage();
      y = (await pdfHeader(ctx, false)) + 6;
    }

    doc.setFont(template.fontFamily, "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(s.heading, margin, y + 4);
    let topOffset = 6;
    if (s.subtitle) {
      doc.setFont(template.fontFamily, "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(s.subtitle, margin, y + 8);
      topOffset = 10;
    }

    const tableBody = s.rows.map(r => {
      if (Array.isArray(r)) return [r[0], r[1]];
      let val = r.value || "";
      if (r.bullets && r.bullets.length > 0) {
        val = r.bullets.map(b => `• ${b}`).join("\n");
      }
      return [r.label, val];
    });

    autoTable(doc, {
      body: tableBody,
      startY: y + topOffset,
      margin: { left: margin, right: margin },
      styles: {
        font: template.fontFamily,
        fontSize: 8.5,
        cellPadding: 2.5,
        lineColor: [220, 225, 230],
        lineWidth: 0.1,
        overflow: "linebreak",
      },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 55, fillColor: [248, 250, 252], textColor: [40, 40, 40] },
        1: { textColor: [30, 30, 30] },
      },
      theme: "grid",
      showHead: "everyPage",
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
  doc.text("Terms, Conditions & Settlement", margin, y);
  y += 3;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // 1. Terms & Conditions Section (Hanging Indent, Auto-Pagination, Markdown & Structured Support)
  const showTerms = quotation.visibilitySnapshot?.showTerms !== undefined
    ? quotation.visibilitySnapshot.showTerms
    : quotation.includeTerms !== false &&
      ((quotation as any).showTerms !== false) &&
      ((company as any).showQuotationTerms !== false || !!quotation.structuredTermsSnapshot?.length || !!quotation.termsSnapshot?.length || !!quotation.termsMarkdown);

  if (showTerms) {
    let termItems: Array<{ text: string; format?: string; title?: string }> = [];

    if (quotation.structuredTermsSnapshot?.length) {
      for (const sec of quotation.structuredTermsSnapshot) {
        if (sec.title) termItems.push({ text: sec.title, title: sec.title });
        for (const item of sec.items || []) {
          termItems.push({ text: item.text, format: item.format || sec.format || "numbered" });
        }
      }
    } else if (quotation.termsSnapshot?.length) {
      termItems = quotation.termsSnapshot.map(t => ({ text: t, format: "numbered" }));
    } else {
      const rawMd = quotation.termsMarkdown || quotation.terms || (company as any).quotationTermsMarkdown || company.terms || "";
      if (rawMd) {
        const extracted = extractTermsFromMarkdown(rawMd);
        termItems = extracted.map(t => {
          const isBullet = t.startsWith("- ") || t.startsWith("* ");
          return {
            text: t.replace(/^(\d+[.)]|[-*])\s*/, ""),
            format: isBullet ? "bullet" : "numbered",
          };
        });
      }
    }

    if (termItems.length > 0) {
      doc.setFont(template.fontFamily, "bold");
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 30);
      doc.text("Terms & Conditions", margin, y);
      y += 4.5;

      let numIdx = 1;
      for (const t of termItems) {
        if (t.title) {
          // Section header within terms
          if (y > pageH - 35) {
            doc.addPage();
            y = (await pdfHeader(ctx, false)) + 6;
          }
          doc.setFont(template.fontFamily, "bold");
          doc.setFontSize(9);
          doc.setTextColor(accent[0], accent[1], accent[2]);
          doc.text(t.title, margin + 2, y);
          y += 4;
          continue;
        }

        const body = t.text.trim();
        if (!body) continue;

        // Hanging Indent: Number aligned at margin + 2, text lines wrapped at margin + 9
        const isNumbered = t.format !== "bullet" && t.format !== "paragraph";
        const isBullet = t.format === "bullet";
        const textIndent = isNumbered ? 9 : isBullet ? 7 : 2;
        const maxTextW = pageW - margin * 2 - textIndent - 2;

        doc.setFont(template.fontFamily, "normal");
        doc.setFontSize(8.5);
        const cleanBody = body.replace(/\*\*(.+?)\*\*/g, "$1");
        const textLines = doc.splitTextToSize(cleanBody, maxTextW);

        // Check if full term fits on current page
        const termH = textLines.length * 3.8 + 2;
        if (y + termH > pageH - 25) {
          doc.addPage();
          y = (await pdfHeader(ctx, false)) + 6;
        }

        // Draw number or bullet
        if (isNumbered) {
          doc.setFont(template.fontFamily, "bold");
          doc.setTextColor(70, 70, 70);
          doc.text(`${numIdx}.`, margin + 2, y);
          numIdx++;
        } else if (isBullet) {
          doc.setFont(template.fontFamily, "bold");
          doc.setTextColor(accent[0], accent[1], accent[2]);
          doc.text("•", margin + 2, y);
        }

        // Draw wrapped body text starting with exact hanging indent
        doc.setFont(template.fontFamily, "normal");
        doc.setTextColor(35, 35, 35);
        doc.text(textLines, margin + textIndent, y);

        y += termH;
      }
      y += 4;
    }
  }

  // 2. Bank Details Section (PRD §§ 8-9, 78, 79 — Clean bordered table)
  const showBank = quotation.visibilitySnapshot?.showBankDetails !== undefined
    ? quotation.visibilitySnapshot.showBankDetails
    : quotation.includeBankDetails !== false &&
      ((quotation as any).showBankDetails !== false) &&
      ((company as any).showQuotationBankDetails !== false || !!quotation.bankDetailsSnapshot || !!quotation.bankSnapshot);

  if (showBank) {
    const rawBank: any = quotation.bankDetailsSnapshot || quotation.bankSnapshot || (
      company.bankName ? {
        bankName: company.bankName,
        accountHolderName: (company as any).accountHolderName || (company as any).bankAccountHolderName || (company as any).legalName || company.name,
        accountName: (company as any).accountHolderName || (company as any).bankAccountHolderName || (company as any).legalName || company.name,
        accountNo: company.bankAccount || (company as any).bankAccountNo,
        ifsc: company.bankIfsc,
        branch: (company as any).bankBranch,
        accountType: (company as any).bankAccountType,
        upi: (company as any).upiId,
        swift: (company as any).bankSwiftCode,
      } : null
    );

    if (rawBank && (rawBank.bankName || rawBank.accountNo)) {
      if (y > pageH - 45) {
        doc.addPage();
        y = (await pdfHeader(ctx, false)) + 6;
      }

      doc.setFont(template.fontFamily, "bold");
      doc.setFontSize(10);
      doc.setTextColor(accent[0], accent[1], accent[2]);
      doc.text("Bank Settlement Details", margin, y);
      y += 3.5;

      const bankRows: [string, string][] = [
        ["Account Holder Name", rawBank.accountHolderName || rawBank.accountName || (company as any).accountHolderName || (company as any).bankAccountHolderName || (company as any).legalName || company.name || "Business Entity"],
        ["Account Number", rawBank.accountNo || rawBank.bankAccountNo || rawBank.accountNumber || "—"],
        ["Bank Name", rawBank.bankName || "—"],
        ["IFSC Code", rawBank.ifsc || rawBank.bankIfsc || "—"],
      ];
      if (rawBank.branch) bankRows.push(["Branch", rawBank.branch]);
      if (rawBank.accountType || (company as any).bankAccountType) bankRows.push(["Account Type", rawBank.accountType || (company as any).bankAccountType]);
      if (rawBank.upi || (company as any).upiId) bankRows.push(["UPI ID / VPA", rawBank.upi || (company as any).upiId]);
      if (rawBank.swift || (company as any).bankSwiftCode) bankRows.push(["SWIFT Code", rawBank.swift || (company as any).bankSwiftCode]);

      autoTable(doc, {
        body: bankRows,
        startY: y,
        margin: { left: margin, right: margin + 35 },
        styles: {
          font: template.fontFamily,
          fontSize: 8.5,
          cellPadding: 2,
          lineColor: [220, 225, 230],
          lineWidth: 0.1,
        },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 44, fillColor: [248, 250, 252], textColor: [40, 40, 40] },
          1: { textColor: [20, 20, 20] },
        },
        theme: "grid",
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
  }

  // 3. Closing Message & Authorized Signatory Block (PRD § 80 — Non-destructive signature & stamp)
  if (y > pageH - 52) {
    doc.addPage();
    y = (await pdfHeader(ctx, false)) + 6;
  }
  y = Math.max(y, pageH - 52);

  doc.setFont(template.fontFamily, "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(quotation.closingMessage || "Thank you for your business. We look forward to working with you.", margin, y);

  const sigX = pageW - margin - 60;
  doc.setFont(template.fontFamily, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  doc.text(`For ${company.name || "Business Entity"}`, sigX, y);

  const sig = quotation.signatorySnapshot;
  const sigName = sig?.signatoryName || company.authorizedSignatory || "Authorized Signatory";
  const sigDesignation = sig?.designation || (company as any).designation;
  const sigImg = sig?.signatureUrl || company.signature;
  const stampImg = sig?.stampUrl || company.stamp;

  if (sigImg) {
    try { doc.addImage(sigImg, "PNG", sigX, y + 3, 38, 13); } catch { /* ignore */ }
  }
  if (stampImg) {
    try { doc.addImage(stampImg, "PNG", sigX + 40, y + 2, 18, 18); } catch { /* ignore */ }
  }

  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(sigX, y + 22, sigX + 60, y + 22);

  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(sigName, sigX, y + 26);
  if (sigDesignation) {
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(sigDesignation, sigX, y + 30);
  }
}

export async function exportQuotationPDF(
  quotation: Quotation,
  company: CompanySettings,
  customer?: Customer,
  template?: QuotationTemplate,
): Promise<Blob> {
  const jsPDFConstructor: any = typeof jsPDF === "function" ? jsPDF : (jsPDF as any).jsPDF || (jsPDF as any).default || jsPDF;
  const doc = new jsPDFConstructor({ unit: "mm", format: "a4", orientation: "portrait" });
  const tpl = template || defaultTemplate();
  const effectiveCompany = quotation.companySnapshot
    ? ({ ...company, ...quotation.companySnapshot } as CompanySettings)
    : company;
  const logoData = await getLogoDataUrl();
  const companyLogoData = effectiveCompany.logo || null;
  const ctx: PdfContext = {
    doc, company: effectiveCompany, quotation, customer, template: tpl,
    accent: hexToRgb(tpl.accent),
    logoData, companyLogoData,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    margin: 12,
  };

  // 1. Compact Page 1: Header, Quotation Details, Bill To/Ship To, Line Items, Totals, Amount in Words
  await drawCover(ctx);

  // 2. Supplementary Section: General Information (PRD §§ 8, 9, 81 — Quotation only)
  const showGenInfo = quotation.visibilitySnapshot?.showGeneralInfo !== undefined
    ? quotation.visibilitySnapshot.showGeneralInfo
    : quotation.includeGeneralInfo !== false &&
      ((quotation as any).showGeneralInfo !== false) &&
      ((company as any).showQuotationGeneralInfo !== false || !!quotation.generalInformationSnapshot?.length || !!quotation.generalInfoSnapshot?.length || !!(quotation as any).generalInfoMarkdown);

  if (showGenInfo) {
    let genRows: Array<{ label: string; value: string; bullets?: string[] }> = [];

    if (quotation.generalInformationSnapshot?.length) {
      const sec: any = quotation.generalInformationSnapshot.find((s: any) => s.type === "GENERAL_INFO") || { rows: quotation.generalInformationSnapshot };
      if (sec && sec.rows) {
        genRows = sec.rows.map((r: any) => ({
          label: r.label,
          value: r.value,
          bullets: r.bullets || (r.valueType === "BULLET_LIST" ? r.value.split(/\r?\n+/).map((b: string) => b.trim()).filter(Boolean) : undefined),
        }));
      }
    } else if (quotation.generalInfoSnapshot?.length) {
      genRows = quotation.generalInfoSnapshot.map((f: any) => ({
        label: f.label,
        value: f.value,
        bullets: f.value && f.value.includes("•") ? f.value.split("•").map((b: string) => b.trim()).filter(Boolean) : undefined,
      }));
    } else {
      const genMd = (quotation as any).generalInfoMarkdown || (company as any).quotationGeneralInfoMarkdown;
      if (genMd) {
        genRows = extractTableRowsFromMarkdown(genMd);
      } else if (quotation.structuredSections) {
        const sec = quotation.structuredSections.find(s => s.type === "GENERAL_INFO");
        if (sec && sec.rows) {
          genRows = sec.rows.map(r => ({
            label: r.label,
            value: r.value,
            bullets: r.bullets || (r.valueType === "BULLET_LIST" ? r.value.split(/\r?\n+/).map(b => b.trim()).filter(Boolean) : undefined),
          }));
        }
      }
    }

    if (genRows.length > 0) {
      await drawSectionsPage(ctx, "General Information", [
        { heading: "Commercial & Site Information", rows: genRows },
      ]);
    }
  }

  // 3. Supplementary Section: Technical / Fabrication Specifications (PRD §§ 8, 9, 82 — Quotation only)
  const showTechSpecs = quotation.visibilitySnapshot?.showTechSpecs !== undefined
    ? quotation.visibilitySnapshot.showTechSpecs
    : quotation.includeTechSpecs !== false &&
      ((quotation as any).showTechSpecs !== false) &&
      ((company as any).showQuotationTechnicalSpecs !== false || !!quotation.technicalSpecificationSnapshot?.length || !!quotation.techSpecSnapshot?.length || !!quotation.technicalSpecsMarkdown);

  if (showTechSpecs) {
    let specSections: Array<{ heading: string; subtitle?: string; rows: Array<{ label: string; value: string }> }> = [];

    if (quotation.technicalSpecificationSnapshot?.length) {
      const specs = quotation.technicalSpecificationSnapshot.filter((s: any) => s.type === "SPEC_TABLE");
      specSections = specs.map((s: any) => ({
        heading: s.title,
        subtitle: s.subtitle,
        rows: (s.rows || []).map((r: any) => ({ label: r.label, value: r.value })),
      }));
    } else if (quotation.techSpecSnapshot?.length || quotation.electricalSnapshot?.length) {
      if (quotation.techSpecSnapshot?.length) {
        specSections.push(...quotation.techSpecSnapshot.map((sec: any) => ({
          heading: sec.title,
          rows: (sec.rows || []).map((r: any) => ({ label: r.label, value: r.value })),
        })));
      }
      if (quotation.electricalSnapshot?.length) {
        specSections.push(...quotation.electricalSnapshot.map(sec => ({
          heading: sec.title,
          rows: sec.rows.map(r => ({ label: r.label, value: r.value })),
        })));
      }
    } else {
      const techMd = quotation.technicalSpecsMarkdown || (company as any).quotationTechnicalSpecsMarkdown;
      if (techMd) {
        const blocks = parseMarkdownToBlocks(techMd);
        let currentSection: { heading: string; rows: Array<{ label: string; value: string }> } = {
          heading: "Technical Specifications",
          rows: [],
        };
        for (const b of blocks) {
          if (b.type === "HEADING") {
            if (currentSection.rows.length > 0) {
              specSections.push(currentSection);
            }
            currentSection = { heading: b.text, rows: [] };
          } else if (b.type === "TABLE") {
            for (const r of b.rows) {
              if (r.length >= 2) {
                currentSection.rows.push({ label: r[0], value: r[1] });
              }
            }
          } else if (b.type === "BULLET_LIST" || b.type === "NUMBERED_LIST") {
            for (const item of (b as any).items) {
              currentSection.rows.push({ label: "Specification", value: item.text });
            }
          }
        }
        if (currentSection.rows.length > 0) {
          specSections.push(currentSection);
        }
      } else if (quotation.structuredSections) {
        const specs = quotation.structuredSections.filter(s => s.type === "SPEC_TABLE");
        specSections = specs.map(s => ({
          heading: s.title,
          subtitle: s.subtitle,
          rows: s.rows.map((r: any) => ({ label: r.label, value: r.value })),
        }));
      }
    }

    if (specSections.length > 0) {
      await drawSectionsPage(ctx, "Technical / Fabrication Specifications", specSections);
    }
  }

  // 4. Terms, Bank & Signatory Page (PRD §§ 78, 79, 80)
  await drawTermsPage(ctx);

  // 5. Running page numbers & footer on all pages
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
  const effectiveCompany = quotation.companySnapshot
    ? ({ ...company, ...quotation.companySnapshot } as CompanySettings)
    : company;
  const logoBytes = (effectiveCompany.logo?.startsWith("data:")
    ? Uint8Array.from(atob(effectiveCompany.logo.split(",")[1]), c => c.charCodeAt(0))
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
          new TextRun({ text: effectiveCompany.name || "Company", bold: true, size: 22, color: ACCENT_HEX, font: "Calibri" }),
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
  const terms = quotation.termsSnapshot?.length
    ? quotation.termsSnapshot
    : quotation.structuredTermsSnapshot?.length
    ? quotation.structuredTermsSnapshot.flatMap(s => (s.items || []).map((it: any) => it.text))
    : effectiveCompany.terms
    ? effectiveCompany.terms.split(/\n+/)
    : [];
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

  const rawDocxBank = quotation.bankDetailsSnapshot || quotation.bankSnapshot;
  if (rawDocxBank) {
    const b = rawDocxBank as any;
    extras.push(P("Bank Details", { bold: true, size: 22, color: ACCENT_HEX }));
    extras.push(kvTable([
      ["Bank", b.bankName || "—"],
      ["Account Holder Name", b.accountHolderName || b.accountName || "—"],
      ["Account No.", b.accountNo || b.accountNumber || "—"],
      ["IFSC", b.ifsc || "—"],
      ...(b.branch ? [["Branch", b.branch] as [string, string]] : []),
      ...(b.upi ? [["UPI", b.upi] as [string, string]] : []),
    ]));
    extras.push(P(""));
  }

  const sig = quotation.signatorySnapshot;
  const sigName = sig?.signatoryName || effectiveCompany.authorizedSignatory || "Authorized Signatory";

  extras.push(P("Thank you for your business.", { size: 18, color: "555555" }));
  extras.push(P(""));
  extras.push(P(`For ${effectiveCompany.name || "Business Entity"}`, { bold: true, size: 20 }));
  extras.push(P(""));
  extras.push(P(""));
  extras.push(P(sigName, { size: 18, color: "555555" }));

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
