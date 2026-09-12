# `src/lib`

Framework-free helpers. Nothing here renders UI.

| File | Purpose |
| --- | --- |
| `db.ts` | Dexie schema (`bms_db_v1`), all entity types, `db()` accessor, `uid()`, `DEFAULT_COMPANY`, `getCompany()`, `nextNumber()`. Throws if called during SSR. |
| `calc.ts` | `computeLine()` (gross → discount → taxable → GST → total), `computeTotals()` (CGST/SGST/IGST split, round-off), `applyStockDelta()`, `round2()`. |
| `format.ts` | `formatMoney`, `formatNumber`, `formatDate` (dd/mm/yyyy), `todayTs`, `toDateInput`, `fromDateInput`, `numberToWordsIndian` (crore/lakh/thousand + paise). |
| `session.ts` | Single-user login, `bms_session_v1` in localStorage, 24-hour TTL, `login/logout/getSession/isAuthenticated`. |
| `useLive.ts` | `useLive` / `useLiveOne` — SSR-safe, error-tolerant wrappers over Dexie's `useLiveQuery`. |
| `useInitialLoading.ts` | 120 ms skeleton flash gate so screens neither flicker nor appear blank. |
| `pdf.ts` | `downloadPDF(elementId, filename)` via html2canvas + jsPDF with A4 pagination, and `printElement(elementId)` which opens a print window with app styles. |
| `quotationExport.ts` | Vector multi-page quotation PDF (jspdf + jspdf-autotable) and DOCX (`docx`). Template-driven accent/font, logo + `Built by MMA` on every page, `Rs. ` for PDF amounts. |
| `logoData.ts` | BMS logo as data URL / bytes for embedding in PDF and DOCX. |
| `utils.ts` | `cn()` class merger (clsx + tailwind-merge). |
| `error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts` | Platform error capture and fallback error screen. Leave as-is. |
