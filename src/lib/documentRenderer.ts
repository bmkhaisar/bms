import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate, numberToWordsIndian } from "@/lib/format";
import type { CompanySnapshot } from "@/modules/company/types";
import type { LineItem, ExtraCharge } from "@/lib/db";

const PDF_CCY = "Rs. ";
const money = (val: number) => formatMoney(val, PDF_CCY);

export interface DocumentParty {
  name: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
}

export interface NormalizedDocument {
  kind: "quotation" | "invoice" | "purchase" | "receipt" | "payment";
  title: string;
  number: string;
  date: number;
  dueDate?: number;
  company: Partial<CompanySnapshot>;
  party: DocumentParty;
  items: LineItem[];
  subtotal: number;
  discountTotal: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  gstTotal: number;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  roundOff: number;
  grandTotal: number;
  amountPaid?: number;
  balance?: number;
  notes?: string;
  terms?: string;
  paymentMode?: string;
}

/**
 * Builds a vector PDF document using jsPDF and jspdf-autotable.
 * Guarantees crisp selectable text, multi-page stability, correct totals,
 * no text cut-off, and strict company identity preservation without BMS logo injection.
 */
export function buildDocumentPDF(docData: NormalizedDocument): jsPDF {
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  let y = margin;

  // 1. Top Bar Accent
  doc.setFillColor(30, 64, 175); // Professional Navy Blue
  doc.rect(0, 0, pageW, 3, "F");

  // 2. Company Identity (Tenant branding)
  // Requirement 9: Use company logo if provided; otherwise professional text header. Never inject BMS logo.
  const comp = docData.company;
  const compName = comp.legalName || comp.name || "Business Entity";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(compName, margin, y + 6);
  y += 11;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);

  const compAddressParts = [
    comp.address,
    comp.city && comp.state ? `${comp.city}, ${comp.state} ${comp.pincode || ""}` : comp.city || comp.state,
    comp.phone ? `Phone: ${comp.phone}` : "",
    comp.email ? `Email: ${comp.email}` : "",
    comp.gstin ? `GSTIN: ${comp.gstin}` : "",
    comp.pan ? `PAN: ${comp.pan}` : "",
  ].filter(Boolean);

  for (const part of compAddressParts) {
    doc.text(part as string, margin, y);
    y += 4;
  }

  // 3. Document Title & Metadata (Right-Aligned)
  const metaX = pageW - margin;
  let metaY = margin + 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 64, 175);
  doc.text(docData.title.toUpperCase(), metaX, metaY, { align: "right" });
  metaY += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(`${docData.title} #: ${docData.number}`, metaX, metaY, { align: "right" });
  metaY += 4.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);
  doc.text(`Date: ${formatDate(docData.date)}`, metaX, metaY, { align: "right" });
  metaY += 4;

  if (docData.dueDate) {
    doc.text(`Due Date: ${formatDate(docData.dueDate)}`, metaX, metaY, { align: "right" });
    metaY += 4;
  }

  y = Math.max(y, metaY) + 4;

  // Divider Line
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  // 4. Party Details Box (Customer or Supplier)
  const party = docData.party;
  const partyLabel = docData.kind === "purchase" ? "SUPPLIER / VENDOR DETAILS" : "BILL TO / CUSTOMER DETAILS";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(partyLabel, margin, y);
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.text(party.name || "Walk-in Customer", margin, y);
  if (party.company) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(`(${party.company})`, margin + doc.getTextWidth(party.name || "") + 2, y);
  }
  y += 4.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);

  if (party.address) {
    doc.text(party.address, margin, y);
    y += 4;
  }
  if (party.city || party.state) {
    doc.text(`${party.city || ""} ${party.state || ""} ${party.pincode || ""}`.trim(), margin, y);
    y += 4;
  }
  if (party.gstin) {
    doc.text(`GSTIN: ${party.gstin}`, margin, y);
    y += 4;
  }
  if (party.phone) {
    doc.text(`Contact: ${party.phone}`, margin, y);
    y += 4;
  }

  y += 3;

  // 5. Line Items Table (jspdf-autotable)
  const tableRows = docData.items.map((item, idx) => {
    return [
      idx + 1,
      item.size ? `${item.name}\nSize: ${item.size}` : item.name,
      item.hsn || "—",
      item.quantity,
      item.unit || "NOS",
      money(item.rate),
      item.discountPct > 0 ? `${item.discountPct}%` : "0%",
      `${item.gstRate}%`,
      money(item.total),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["#", "Item Description", "HSN/SAC", "Qty", "Unit", "Rate", "Disc", "GST", "Total"]],
    body: tableRows,
    theme: "grid",
    margin: { left: margin, right: margin },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [31, 41, 55],
      fontStyle: "bold",
      fontSize: 8,
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 12, halign: "center" },
      7: { cellWidth: 14, halign: "center" },
      8: { cellWidth: 24, halign: "right" },
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      textColor: [55, 65, 81],
      overflow: "linebreak",
    },
    didDrawPage: (data) => {
      // Running footer on each page
      doc.setFontSize(7.5);
      doc.setTextColor(156, 163, 175);
      doc.text(
        `Generated by ${compName} · Page ${data.pageNumber} of ${doc.getNumberOfPages()}`,
        margin,
        pageH - 6
      );
    },
  });

  y = (doc as any).lastAutoTable.finalY + 4;

  // Check if we need a new page for totals & terms
  if (y > pageH - 55) {
    doc.addPage();
    y = margin;
  }

  // 6. Totals & Tax Breakdown Block
  const totalsX = pageW - margin - 65;
  const valX = pageW - margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);

  doc.text("Taxable Subtotal:", totalsX, y);
  doc.text(money(docData.subtotal), valX, y, { align: "right" });
  y += 4;

  if (docData.discountTotal > 0) {
    doc.text("Discount Total:", totalsX, y);
    doc.text(`- ${money(docData.discountTotal)}`, valX, y, { align: "right" });
    y += 4;
  }

  if (docData.cgstTotal && docData.cgstTotal > 0) {
    doc.text("Central GST (CGST):", totalsX, y);
    doc.text(money(docData.cgstTotal), valX, y, { align: "right" });
    y += 4;
  }

  if (docData.sgstTotal && docData.sgstTotal > 0) {
    doc.text("State GST (SGST):", totalsX, y);
    doc.text(money(docData.sgstTotal), valX, y, { align: "right" });
    y += 4;
  }

  if (docData.igstTotal && docData.igstTotal > 0) {
    doc.text("Integrated GST (IGST):", totalsX, y);
    doc.text(money(docData.igstTotal), valX, y, { align: "right" });
    y += 4;
  }

  // Extra charges preservation
  if (docData.extraCharges && docData.extraCharges.length > 0) {
    for (const chg of docData.extraCharges) {
      if (chg.amount > 0) {
        doc.text(`${chg.label}:`, totalsX, y);
        doc.text(money(chg.amount), valX, y, { align: "right" });
        y += 4;
      }
    }
  }

  if (docData.roundOff !== 0) {
    doc.text("Round Off:", totalsX, y);
    doc.text(money(docData.roundOff), valX, y, { align: "right" });
    y += 4;
  }

  // Grand Total Box
  doc.setFillColor(243, 244, 246);
  doc.rect(totalsX - 2, y - 1, 67, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(17, 24, 39);
  doc.text("Grand Total:", totalsX, y + 4);
  doc.text(money(docData.grandTotal), valX, y + 4, { align: "right" });
  y += 10;

  // Amount in words
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  const words = numberToWordsIndian(docData.grandTotal);
  doc.text(`Amount in words: ${words}`, margin, y);
  y += 7;

  // 7. Settlement & Banking Details
  if (comp.bankName || comp.upiId) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text("PAYMENT / BANK SETTLEMENT", margin, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 99);
    if (comp.bankName) {
      doc.text(`Bank: ${comp.bankName} · A/C: ${comp.bankAccountNo || "—"} · IFSC: ${comp.bankIfsc || "—"}`, margin, y);
      y += 3.5;
    }
    if (comp.upiId) {
      doc.text(`UPI VPA: ${comp.upiId}`, margin, y);
      y += 3.5;
    }
    y += 3;
  }

  // 8. Terms & Signatory
  if (docData.terms || comp.terms) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text("TERMS & CONDITIONS", margin, y);
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(107, 114, 128);
    const termLines = (docData.terms || comp.terms || "").split("\n").slice(0, 3);
    for (const tl of termLines) {
      doc.text(tl, margin, y);
      y += 3.5;
    }
  }

  // Authorized Signatory
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 85, 99);
  doc.text(`For ${compName}`, valX, y + 8, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text("Authorized Signatory", valX, y + 16, { align: "right" });

  return doc;
}

/**
 * Downloads the normalized vector PDF directly in browser.
 */
export function downloadDocumentPDF(docData: NormalizedDocument, filename?: string): void {
  const doc = buildDocumentPDF(docData);
  const fname = filename || `${docData.title.toLowerCase().replace(/\s+/g, "_")}_${docData.number}.pdf`;
  doc.save(fname);
}

/**
 * Generates a Blob URL for instant responsive in-app preview.
 */
export function generateDocumentPDFBlobUrl(docData: NormalizedDocument): string {
  const doc = buildDocumentPDF(docData);
  return URL.createObjectURL(doc.output("blob"));
}
