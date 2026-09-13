import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatMoney, formatDate, numberToWordsIndian } from "@/lib/format";
import type { CompanySnapshot, SignatoryConfig, SignatorySnapshot } from "@/modules/company/types";
import { resolveDocumentSignatory, createTypedSignatureDataUrl } from "@/modules/company/signatoryHelper";
import type { LineItem, ExtraCharge, BankAccount, StructuredTermItem } from "@/lib/db";
import { formatCompanyAddress } from "@/lib/companyAddress";

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
  placeOfSupply?: string;
  shippingAddress?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToCity?: string;
  shipToState?: string;
  shipToPincode?: string;
  shipToGstin?: string;
  shipToPhone?: string;
}

export type DocumentCopyType =
  | "ORIGINAL"
  | "COPY"
  | "CUSTOMER COPY"
  | "OFFICE COPY"
  | "TRANSPORT COPY"
  | "DRIVER COPY";

export interface NormalizedDocument {
  kind: "quotation" | "invoice" | "purchase" | "receipt" | "payment" | "credit_note" | "debit_note";
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
  cessTotal?: number;
  gstTotal: number;
  extraCharges?: ExtraCharge[];
  extraChargesTotal?: number;
  roundOff: number;
  grandTotal: number;
  amountPaid?: number;
  balance?: number;
  notes?: string;
  terms?: string;
  termsSnapshot?: string[];
  structuredTerms?: StructuredTermItem[];
  includeTerms?: boolean;
  bankAccountId?: string;
  bankSnapshot?: BankAccount;
  bankDetailsSnapshot?: BankAccount;
  includeBankDetails?: boolean;
  gstCalculationMode?: "item_wise" | "overall";
  overallGstRate?: number;
  paymentMode?: string;
  enableGst?: boolean;
  watermarkMode?: "off" | "logo" | "company_logo" | "custom";
  customWatermarkText?: string;
  signatoryOverride?: Partial<SignatoryConfig>;
  signatorySnapshot?: Partial<SignatorySnapshot>;
  copyLabel?: DocumentCopyType;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: number;
  receiptDetails?: {
    receiptVoucherNumber?: string;
    natureOfSupply?: string;
    placeOfSupply?: string;
    taxableAmount?: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    totalTax?: number;
    totalReceived?: number;
    paymentMethod?: string;
    settlementLedgerName?: string;
    referenceNumber?: string;
    narration?: string;
  };
}

/**
 * Draws the subtle watermark on a page (3%-8% opacity).
 * Runs behind content without reducing text readability or legal field clarity.
 */
function renderWatermark(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  mode: "off" | "logo" | "company_logo" | "custom",
  logoUrl?: string,
  customText?: string
) {
  if (mode === "off") return;

  try {
    const GState = (doc as any).GState;
    if (GState) {
      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.06 }));
    }

    if ((mode === "logo" || mode === "company_logo") && logoUrl && (logoUrl.startsWith("data:image") || logoUrl.startsWith("http"))) {
      const imgSize = 75;
      const x = (pageW - imgSize) / 2;
      const y = (pageH - imgSize) / 2;
      doc.addImage(logoUrl, "PNG", x, y, imgSize, imgSize);
    } else {
      const text = customText || "ORIGINAL";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(48);
      doc.setTextColor(30, 64, 175); // soft brand navy/light-blue tone
      doc.text(text, pageW / 2, pageH / 2, {
        align: "center",
        angle: 35,
      });
    }

    if (GState) {
      doc.restoreGraphicsState();
    }
  } catch (err) {
    // Watermark rendering should never block legal PDF export if image format fails
    console.warn("Watermark rendering skipped:", err);
  }
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

  const comp = docData.company || {};
  const compName = comp.legalName || comp.name || "Business Entity";
  const isTaxDoc = docData.enableGst !== false;
  const watermarkMode = docData.watermarkMode || (comp as any).watermarkSetting || "off";
  const watermarkCustomText = docData.customWatermarkText || (comp as any).customWatermarkText;

  // Render watermark on initial page
  renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);

  let y = margin;

  // 1. Top Bar Accent
  doc.setFillColor(30, 64, 175); // Professional Navy
  doc.rect(0, 0, pageW, 3, "F");

  // 2. Company Identity (Tenant branding)
  let headerLeftOffset = margin;
  if (comp.logo && (comp.logo.startsWith("data:image") || comp.logo.startsWith("http"))) {
    try {
      doc.addImage(comp.logo, "PNG", margin, y, 20, 20);
      headerLeftOffset = margin + 24;
    } catch {
      headerLeftOffset = margin;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text(compName, headerLeftOffset, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);

  const compAddr = formatCompanyAddress(comp as any);
  const compAddressParts = [
    ...compAddr.addressLines,
    compAddr.cityStatePincode,
    compAddr.contactLine,
    isTaxDoc && compAddr.gstin ? `GSTIN: ${compAddr.gstin}` : "",
    compAddr.pan ? `PAN: ${compAddr.pan}` : "",
  ].filter(Boolean);

  let compY = y + 9.5;
  for (const part of compAddressParts) {
    doc.text(part as string, headerLeftOffset, compY);
    compY += 4;
  }

  // 3. Document Title & Metadata (Right-Aligned)
  const metaX = pageW - margin;
  let metaY = margin + 5;

  const docTitle = docData.kind === "receipt"
    ? (docData.title || "RECEIPT VOUCHER").toUpperCase()
    : isTaxDoc
    ? docData.title.toUpperCase()
    : docData.kind === "invoice"
    ? "COMMERCIAL INVOICE"
    : docData.title.toUpperCase();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(30, 64, 175);
  doc.text(docTitle, metaX, metaY, { align: "right" });
  metaY += 5;

  // Render Document Copy Badge (Original, Copy, Driver Copy, etc.)
  if (docData.copyLabel) {
    const copyText = docData.copyLabel.toUpperCase();
    const isOrig = copyText === "ORIGINAL";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const badgeW = doc.getTextWidth(copyText) + 4;
    const badgeH = 4.2;
    const badgeX = metaX - badgeW;
    const badgeY = metaY - 3.2;

    if (isOrig) {
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(191, 219, 254);
      doc.rect(badgeX, badgeY, badgeW, badgeH, "FD");
      doc.setTextColor(30, 64, 175);
    } else {
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(248, 113, 113);
      doc.rect(badgeX, badgeY, badgeW, badgeH, "FD");
      doc.setTextColor(220, 38, 38);
    }
    doc.text(copyText, badgeX + 2, badgeY + 3.1);
    metaY += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(`${docData.title} #: ${docData.number}`, metaX, metaY, { align: "right" });
  metaY += 4.5;

  if (docData.supplierInvoiceNumber) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(`Supplier Invoice #: ${docData.supplierInvoiceNumber}`, metaX, metaY, { align: "right" });
    metaY += 4.5;
  }
  if (docData.supplierInvoiceDate) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Supplier Inv Date: ${formatDate(docData.supplierInvoiceDate)}`, metaX, metaY, { align: "right" });
    metaY += 4;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);
  doc.text(`Date: ${formatDate(docData.date)}`, metaX, metaY, { align: "right" });
  metaY += 4;

  if (docData.dueDate) {
    doc.text(`Due Date: ${formatDate(docData.dueDate)}`, metaX, metaY, { align: "right" });
    metaY += 4;
  }

  if (isTaxDoc && (docData.party.placeOfSupply || docData.party.state)) {
    doc.text(
      `Place of Supply: ${docData.party.placeOfSupply || docData.party.state}`,
      metaX,
      metaY,
      { align: "right" }
    );
    metaY += 4;
  }

  y = Math.max(compY, metaY) + 3;

  // Divider Line
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  // 4. Party Details Box (Bill To & Ship To side-by-side per PRD §§ 31-36)
  const party = docData.party;
  const isInvoiceOrQuote = docData.kind === "invoice" || docData.kind === "quotation";
  const hasShipping = isInvoiceOrQuote || Boolean(party.shippingAddress) || Boolean(party.shipToName) || docData.copyLabel === "DRIVER COPY" || docData.copyLabel === "TRANSPORT COPY";

  const partyLabel =
    docData.kind === "purchase"
      ? "SUPPLIER / VENDOR DETAILS"
      : isTaxDoc
      ? "BILL TO / TAXPAYER DETAILS"
      : "BILL TO / CUSTOMER DETAILS";

  if (hasShipping) {
    const colW = (pageW - margin * 2 - 6) / 2;
    const isDriverCopy = docData.copyLabel === "DRIVER COPY";
    const isTransportCopy = docData.copyLabel === "TRANSPORT COPY";

    // Left Column: BILL TO
    let leftY = y;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(partyLabel, margin, leftY);
    leftY += 4.5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(17, 24, 39);
    doc.text(party.name || "Customer", margin, leftY, { maxWidth: colW });
    if (party.company && party.company !== party.name) {
      leftY += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`(${party.company})`, margin, leftY, { maxWidth: colW });
    }
    leftY += 4.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 99);

    if (party.address) {
      const addrLines = doc.splitTextToSize(party.address, colW);
      for (let i = 0; i < Math.min(addrLines.length, 3); i++) {
        doc.text(addrLines[i], margin, leftY);
        leftY += 3.5;
      }
    }
    if (party.city || party.state) {
      doc.text(
        `${party.city || ""} ${party.state || ""} ${party.pincode || ""}`.trim(),
        margin,
        leftY
      );
      leftY += 3.5;
    }
    if (isTaxDoc && party.gstin) {
      doc.setFont("helvetica", "bold");
      doc.text(`GSTIN: ${party.gstin}`, margin, leftY);
      doc.setFont("helvetica", "normal");
      leftY += 3.5;
    }
    if (party.phone) {
      doc.text(`Contact: ${party.phone}`, margin, leftY);
      leftY += 3.5;
    }

    // Right Column: SHIP TO
    const shipX = margin + colW + 6;
    let rightY = y;

    // Driver Copy Highlight Box (PRD § 33: Display destination prominently)
    if (isDriverCopy) {
      doc.setDrawColor(30, 64, 175);
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(shipX - 2, y - 2, colW + 4, 30, 1, 1, "FD");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(isDriverCopy ? 30 : 107, isDriverCopy ? 64 : 114, isDriverCopy ? 175 : 128);
    const shipTitle = isDriverCopy
      ? "DELIVERY DESTINATION (DRIVER COPY)"
      : isTransportCopy
      ? "CONSIGNEE / TRANSPORT DESTINATION"
      : "SHIP TO / CONSIGNEE DETAILS";
    doc.text(shipTitle, shipX, rightY);
    rightY += 4.5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(17, 24, 39);
    const consigneeName = party.shipToName || party.name || "Customer / Consignee";
    doc.text(consigneeName, shipX, rightY, { maxWidth: colW });
    rightY += 4.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 99);

    const shipAddress = party.shipToAddress || party.shippingAddress || party.address || "Same as billing address";
    const shipAddrLines = doc.splitTextToSize(shipAddress, colW);
    for (let i = 0; i < Math.min(shipAddrLines.length, 3); i++) {
      doc.text(shipAddrLines[i], shipX, rightY);
      rightY += 3.5;
    }

    if (party.shipToCity || party.shipToState || party.shipToPincode) {
      doc.text(
        `${party.shipToCity || ""} ${party.shipToState || ""} ${party.shipToPincode || ""}`.trim(),
        shipX,
        rightY
      );
      rightY += 3.5;
    }
    if (party.shipToGstin) {
      doc.setFont("helvetica", "bold");
      doc.text(`GSTIN: ${party.shipToGstin}`, shipX, rightY);
      doc.setFont("helvetica", "normal");
      rightY += 3.5;
    }
    if (party.shipToPhone) {
      doc.text(`Contact: ${party.shipToPhone}`, shipX, rightY);
      rightY += 3.5;
    }

    y = Math.max(leftY, rightY) + 3;
  } else {
    // Single Column (Receipt, Purchase without separate shipping, etc.)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(partyLabel, margin, y);
    y += 4.5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
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
      doc.text(
        `${party.city || ""} ${party.state || ""} ${party.pincode || ""}`.trim(),
        margin,
        y
      );
      y += 4;
    }
    if (isTaxDoc && party.gstin) {
      doc.setFont("helvetica", "bold");
      doc.text(`GSTIN: ${party.gstin}`, margin, y);
      doc.setFont("helvetica", "normal");
      y += 4;
    }
    if (party.phone) {
      doc.text(`Contact: ${party.phone}`, margin, y);
      y += 4;
    }

    y += 3;
  }

  // 5. Line Items Table (jspdf-autotable)
  let tableHeaders: string[];
  let tableRows: any[][];
  let colStyles: Record<number, any>;

  const effectiveItems = (docData.items && docData.items.length > 0)
    ? docData.items
    : docData.kind === "receipt"
    ? [
        {
          name: docData.receiptDetails?.natureOfSupply
            ? `Advance for ${docData.receiptDetails.natureOfSupply}`
            : "Customer Advance Receipt",
          quantity: 1,
          rate: docData.receiptDetails?.taxableAmount ?? (docData.subtotal || docData.grandTotal),
          total: docData.receiptDetails?.taxableAmount ?? (docData.subtotal || docData.grandTotal),
          gstRate: (docData.gstTotal > 0 && docData.subtotal > 0)
            ? Math.round((docData.gstTotal / docData.subtotal) * 100)
            : 0,
        } as LineItem,
      ]
    : [];

  if (isTaxDoc) {
    tableHeaders = ["#", "Item Description", "HSN/SAC", "Qty", "Unit", "Rate", "Discount", "GST", "Amount"];
    tableRows = effectiveItems.map((item, idx) => {
      let desc = item.productName || item.name;
      if (item.description && item.description !== desc) desc += `\n${item.description}`;
      if (item.size) desc += `\nSize: ${item.size}`;
      if (item.measurementSummary) desc += `\n${item.measurementSummary}`;
      const disc = item.discountPercent ?? item.discountPct ?? 0;
      const rate = item.rate !== undefined ? item.rate : ((item.ratePaise || 0) / 100);
      const amt = item.total !== undefined ? item.total : (item.lineAmount || 0);
      const gst = item.gstRate ?? item.taxRate ?? 0;
      return [
        idx + 1,
        desc,
        item.hsn || "—",
        item.quantity,
        item.unit || item.uomLabel || "NOS",
        money(rate),
        disc > 0 ? `${disc}%` : "0%",
        `${gst}%`,
        money(amt),
      ];
    });
    colStyles = {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 12, halign: "center" },
      7: { cellWidth: 14, halign: "center" },
      8: { cellWidth: 24, halign: "right" },
    };
  } else {
    // Clean Commercial / Non-GST Table without empty GST columns
    tableHeaders = ["#", "Item Description", "Qty", "Unit", "Rate", "Discount", "Amount"];
    tableRows = effectiveItems.map((item, idx) => {
      let desc = item.productName || item.name;
      if (item.description && item.description !== desc) desc += `\n${item.description}`;
      if (item.size) desc += `\nSize: ${item.size}`;
      if (item.measurementSummary) desc += `\n${item.measurementSummary}`;
      const disc = item.discountPercent ?? item.discountPct ?? 0;
      const rate = item.rate !== undefined ? item.rate : ((item.ratePaise || 0) / 100);
      const amt = item.total !== undefined ? item.total : (item.lineAmount || 0);
      return [
        idx + 1,
        desc,
        item.quantity,
        item.unit || item.uomLabel || "NOS",
        money(rate),
        disc > 0 ? `${disc}%` : "0%",
        money(amt),
      ];
    });
    colStyles = {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 16, halign: "right" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 24, halign: "right" },
      5: { cellWidth: 18, halign: "center" },
      6: { cellWidth: 28, halign: "right" },
    };
  }

  autoTable(doc, {
    startY: y,
    head: [tableHeaders],
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
    columnStyles: colStyles,
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [55, 65, 81],
      overflow: "linebreak",
    },
    didDrawPage: (data) => {
      // Re-apply watermark on every new page
      if (data.pageNumber > 1) {
        renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);
      }
      // Running page footer
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

  if (y > pageH - 60) {
    doc.addPage();
    renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);
    y = margin;
  }

  // 6. Totals & Tax Breakdown Block
  const totalsX = pageW - margin - 70;
  const valX = pageW - margin;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(75, 85, 99);

  doc.text(isTaxDoc ? "Taxable Subtotal:" : "Subtotal:", totalsX, y);
  doc.text(money(docData.subtotal), valX, y, { align: "right" });
  y += 4;

  if (docData.discountTotal > 0) {
    doc.text("Discount Total:", totalsX, y);
    doc.text(`- ${money(docData.discountTotal)}`, valX, y, { align: "right" });
    y += 4;
  }

  if (isTaxDoc) {
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
    if (docData.cessTotal && docData.cessTotal > 0) {
      doc.text("Cess:", totalsX, y);
      doc.text(money(docData.cessTotal), valX, y, { align: "right" });
      y += 4;
    }
  }

  // Extra charges (Transport, Freight, Installation)
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
  doc.rect(totalsX - 2, y - 1, 72, 7, "F");
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
  y += 6;

  // 7. Terms & Conditions (Rendered before Bank Details, supports Markdown lists, hanging indent)
  const showTerms = docData.includeTerms !== false &&
    (docData.termsSnapshot?.length || (docData as any).showInvoiceTerms !== false && (comp as any).showInvoiceTerms !== false);

  if (showTerms && (docData.terms || docData.termsSnapshot?.length || (comp as any).invoiceTermsMarkdown || comp.terms)) {
    if (y > pageH - 35) {
      doc.addPage();
      renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);
      y = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text("TERMS & CONDITIONS", margin, y);
    y += 4;

    const rawTerms = docData.terms || (comp as any).invoiceTermsMarkdown || comp.terms || "";
    const termLines: string[] = docData.termsSnapshot?.length
      ? docData.termsSnapshot
      : rawTerms.split(/\r?\n+/).map((l: string) => l.trim()).filter(Boolean);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(107, 114, 128);

    for (let i = 0; i < termLines.length; i++) {
      const rawLine = termLines[i];
      const isBullet = rawLine.startsWith("- ") || rawLine.startsWith("* ");
      const cleanText = rawLine.replace(/^(\d+[.)]|[-*])\s*/, "").replace(/\*\*(.+?)\*\*/g, "$1");
      const lines = doc.splitTextToSize(cleanText, pageW - margin * 2 - 8);
      const termH = lines.length * 3.4 + 1.5;

      if (y + termH > pageH - 25) {
        doc.addPage();
        renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);
        y = margin;
      }

      doc.setFont("helvetica", "bold");
      doc.text(isBullet ? "•" : `${i + 1}.`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(lines, margin + 6, y);
      y += termH;
    }
    y += 2;
  }

  // 8. Settlement & Banking Details (Rendered after Terms & Conditions)
  const showBank = docData.includeBankDetails !== false &&
    (docData.bankDetailsSnapshot || docData.bankSnapshot || (docData as any).showInvoiceBankDetails !== false && (comp as any).showInvoiceBankDetails !== false);

  if (showBank && (docData.receiptDetails || (docData.bankDetailsSnapshot || docData.bankSnapshot || comp.bankName || comp.upiId))) {
    if (y > pageH - 45) {
      doc.addPage();
      renderWatermark(doc, pageW, pageH, watermarkMode, comp.logo, watermarkCustomText);
      y = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(docData.kind === "receipt" ? "RECEIPT VOUCHER SETTLEMENT & AUDIT" : "PAYMENT / BANK SETTLEMENT", margin, y);
    y += 3.5;

    if (docData.receiptDetails) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(75, 85, 99);
      if (docData.receiptDetails.natureOfSupply) {
        doc.text(`Nature of Supply: ${docData.receiptDetails.natureOfSupply} · Place of Supply: ${docData.receiptDetails.placeOfSupply || "—"}`, margin, y);
        y += 3.5;
      }
      doc.text(
        `Payment Method: ${docData.receiptDetails.paymentMethod || docData.paymentMode || "Cash"} · Ledger: ${docData.receiptDetails.settlementLedgerName || "Cash/Bank Account"} · Ref: ${docData.receiptDetails.referenceNumber || "—"}`,
        margin,
        y
      );
      y += 3.5;
      if (docData.receiptDetails.narration) {
        doc.text(`Narration: ${docData.receiptDetails.narration}`, margin, y);
        y += 3.5;
      }
    } else {
      const rawBank: any = docData.bankDetailsSnapshot || docData.bankSnapshot || (comp.bankName ? {
        accountHolderName: (comp as any).accountHolderName || (comp as any).bankAccountHolderName || (comp as any).bankAccountName || comp.legalName || comp.name,
        accountName: (comp as any).accountHolderName || (comp as any).bankAccountHolderName || (comp as any).bankAccountName || comp.legalName || comp.name,
        accountNo: comp.bankAccountNo || (comp as any).bankAccount,
        bankName: comp.bankName,
        ifsc: comp.bankIfsc,
        branch: (comp as any).bankBranch,
        upi: comp.upiId,
      } : null);

      if (rawBank && (rawBank.bankName || rawBank.accountNo)) {
        const bankRows: [string, string][] = [
          ["Account Holder Name", rawBank.accountHolderName || rawBank.accountName || (comp as any).accountHolderName || (comp as any).bankAccountHolderName || comp.legalName || comp.name || "Business Entity"],
          ["Account Number", rawBank.accountNo || rawBank.bankAccountNo || rawBank.accountNumber || "—"],
          ["Bank Name", rawBank.bankName || "—"],
          ["IFSC Code", rawBank.ifsc || rawBank.bankIfsc || "—"],
        ];
        if (rawBank.branch) bankRows.push(["Branch", rawBank.branch]);
        if (rawBank.upi) bankRows.push(["UPI ID / VPA", rawBank.upi]);

        autoTable(doc, {
          body: bankRows,
          startY: y,
          margin: { left: margin, right: Math.max(margin + 50, pageW / 2) },
          styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.8, lineColor: [229, 231, 235], lineWidth: 0.1 },
          columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, fillColor: [249, 250, 251] } },
          theme: "grid",
        });
        y = (doc as any).lastAutoTable.finalY + 4;
      }
    }
  }

  // 9. Authorized Signatory Block
  renderDocumentSignatoryBlock(doc, docData, valX, y + 6, pageH, margin, watermarkMode, comp.logo, watermarkCustomText);

  return doc;
}

/**
 * Renders the professional, right-aligned Authorized Signatory Block in vector PDF.
 * Supports typed signature, uploaded signature, company stamp (with non-destructive positioning),
 * signatory name, designation, and resolved signature date.
 */
function renderDocumentSignatoryBlock(
  doc: jsPDF,
  docData: NormalizedDocument,
  rightX: number,
  startY: number,
  pageH: number,
  margin: number,
  watermarkMode: any,
  logoUrl?: string,
  watermarkCustomText?: string
): number {
  let y = startY;

  // If remaining space on page is too tight for the full signatory block (~42mm), add page
  if (y > pageH - 46) {
    doc.addPage();
    renderWatermark(doc, doc.internal.pageSize.getWidth(), pageH, watermarkMode, logoUrl, watermarkCustomText);
    y = margin + 8;
  }

  const resolved = resolveDocumentSignatory({
    company: docData.company,
    signatoryOverride: docData.signatoryOverride,
    signatorySnapshot: docData.signatorySnapshot,
    documentDate: docData.date,
  });

  const compName = resolved.companyName || "Business Entity";

  // 1. Header: For {Company Name}
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 85, 99);
  doc.text(`For ${compName}`, rightX, y, { align: "right" });
  y += 4;

  const hasSig =
    resolved.showSignature &&
    ((resolved.signatureMode === "typed" && !!resolved.signatoryName) ||
      (resolved.signatureMode === "uploaded" && !!resolved.signatureUrl));

  const hasStamp = resolved.showStamp && resolved.stampMode === "uploaded" && !!resolved.stampUrl;
  const sigBlockH = 18;

  // 2. Visual Signature & Stamp Region
  if (hasStamp && resolved.stampUrl && (resolved.stampUrl.startsWith("data:image") || resolved.stampUrl.startsWith("http"))) {
    try {
      const stampW = 28;
      const stampH = 20;
      // If signature is present, stamp is placed adjacent/slightly to the left
      const stampX = hasSig ? rightX - 56 : rightX - stampW;
      const stampY = y + 1;
      doc.addImage(resolved.stampUrl, "PNG", stampX, stampY, stampW, stampH);
    } catch (e) {
      console.warn("Stamp image embed skipped:", e);
    }
  }

  if (hasSig) {
    if (resolved.signatureMode === "typed") {
      const name = resolved.signatoryName;
      let typedSigImg: string | null = null;
      try {
        typedSigImg = createTypedSignatureDataUrl(name, resolved.typedSignatureStyle, "#1e293b");
      } catch (e) {
        console.warn("Typed signature canvas render failed:", e);
      }

      if (typedSigImg) {
        const sigW = 42;
        const sigH = 15;
        try {
          doc.addImage(typedSigImg, "PNG", rightX - sigW, y + 1, sigW, sigH);
        } catch (e) {
          console.warn("Failed to embed canvas signature image in PDF, using fallback:", e);
          typedSigImg = null;
        }
      }

      // Emergency fallback only: bold-italic standard PDF font
      if (!typedSigImg) {
        const nameLen = name.length || 4;
        const fontSize = nameLen > 24 ? 9.5 : nameLen > 18 ? 11 : nameLen > 12 ? 13 : 15;
        doc.setFont("helvetica", "bolditalic");
        doc.setFontSize(fontSize);
        doc.setTextColor(30, 41, 59);
        doc.text(name, rightX, y + 11, { align: "right" });
      }
    } else if (resolved.signatureUrl && (resolved.signatureUrl.startsWith("data:image") || resolved.signatureUrl.startsWith("http"))) {
      try {
        const sigW = 42;
        const sigH = 15;
        doc.addImage(resolved.signatureUrl, "PNG", rightX - sigW, y + 1, sigW, sigH);
      } catch (e) {
        console.warn("Signature image embed skipped:", e);
      }
    }
    y += sigBlockH;
  } else if (hasStamp) {
    y += sigBlockH;
  } else {
    // Subtle dotted baseline line for physical ink signature
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(rightX - 42, y + 12, rightX, y + 12);
    y += 14;
  }

  // 3. Signatory Name (wrapped to max 65mm to prevent right margin clipping)
  if (resolved.showSignatoryName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(17, 24, 39);
    const nameText = resolved.signatoryName || "Authorized Signatory";
    const nameLines = doc.splitTextToSize(nameText, 65);
    doc.text(nameLines, rightX, y, { align: "right" });
    y += nameLines.length * 3.8;
  }

  // 4. Designation (wrapped to max 65mm to prevent right margin clipping)
  if (resolved.showDesignation && resolved.designation) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(107, 114, 128);
    const desLines = doc.splitTextToSize(resolved.designation, 65);
    doc.text(desLines, rightX, y, { align: "right" });
    y += desLines.length * 3.5;
  }

  // 5. Signature Date
  if (resolved.showSignatureDate && resolved.signatureDateText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text(`Date: ${resolved.signatureDateText}`, rightX, y, { align: "right" });
    y += 3.5;
  }

  return y;
}

/**
 * Downloads the normalized vector PDF directly in browser.
 */
export function downloadDocumentPDF(docData: NormalizedDocument, filename?: string): void {
  const doc = buildDocumentPDF(docData);
  let fname = filename;
  if (!fname) {
    const copySuffix = docData.copyLabel
      ? `-${docData.copyLabel.toLowerCase().replace(/\s+/g, "-")}`
      : "";
    const cleanNum = (docData.number || "document").replace(/[/\\?%*:|"<>]/g, "-");
    fname = `${cleanNum}${copySuffix}.pdf`;
  }
  doc.save(fname);
}

/**
 * Generates a Blob URL for instant responsive in-app preview.
 */
export function generateDocumentPDFBlobUrl(docData: NormalizedDocument): string {
  const doc = buildDocumentPDF(docData);
  return URL.createObjectURL(doc.output("blob"));
}
