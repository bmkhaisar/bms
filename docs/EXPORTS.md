# Printing & exports

## Files

| File | Role |
| --- | --- |
| `src/components/app/DocumentPrint.tsx` | On-screen A4 print view for invoices, receipts, purchases and quotations |
| `src/lib/pdf.ts` | `downloadPDF(elementId, filename)` (html2canvas → jsPDF, paged) and `printElement(elementId)` |
| `src/lib/quotationExport.ts` | Vector multi-page **quotation** PDF (jspdf + autotable) and **DOCX** (docx) |
| `src/lib/logoData.ts` | BMS logo as a data URL / byte array for PDF and DOCX embedding |

## Document header rule

Documents print **only** the company logo, name, address and phone. If company
settings have no logo, the BMS logo is used. Nothing else from the company tab
(email, website, GSTIN, PAN, CIN, bank, signature) appears in the header — this
keeps every document clean and consistent.

## Quotation PDF

- A4 portrait, consistent margins, real page breaks (no image slicing).
- Accent bar, logo and header on **every** page; page numbers in the footer.
- Subtle `Built by MMA` footer watermark on every page.
- Sections render only when data exists: cover/details, item table (autotable
  with the template's grid/striped/plain style), extra charges, totals and
  amount in words, general info, technical spec, electrical spec, terms, bank
  details, signature block.
- Accent colour, font family, logo visibility and header/footer text come from
  the selected `QuotationTemplate`.
- **Currency:** jsPDF's built-in Helvetica has no `₹` glyph (it rendered as a
  superscript `1`), so PDF amounts are printed as `Rs. `. HTML and DOCX use `₹`.

## Quotation DOCX

Mirrors the PDF using the `docx` package: cover block, item table, general info,
tech spec, electrical, terms, bank and signature, with a header carrying the
logo and a footer with page numbers plus `Built by MMA`. Generated in-browser
and downloaded as a `.docx` file.

## Generic PDF / print

Other documents use `DocumentPrint` rendered off-screen at A4 width;
`downloadPDF` rasterises it with html2canvas and pages it into jsPDF, while
`printElement` opens a print window with the app stylesheets and
`@page { size: A4; margin: 12mm }`.

## Layout guarantees

Never overflow, never clip a table cell, keep margins equal on every page, keep
long tables paginated with repeated headers, and always render the logo and the
footer mark.
