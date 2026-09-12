# Quotation module

Files: `src/components/app/QuotationsPage.tsx` (list + dialog),
`src/components/app/QuotationForm.tsx` (the form),
`src/lib/quotationExport.ts` (PDF + DOCX), `src/routes/_app.masters.tsx`
(reusable masters).

## List page

Search by number/customer, filter by status and date, sort, and per-row actions:
**Edit, Duplicate, Delete, Print, PDF, DOCX, Share** (Web Share API with a
copy-to-clipboard fallback). Status is one of draft / sent / accepted /
converted / rejected.

## The form (tabbed)

The dialog is full-height with a sticky header, a horizontally scrollable sticky
tab bar and an independently scrolling body, so nothing is ever cut off.

1. **Details** — customer picker, auto quotation number, date, validity,
   prepared by, site/location, contact person/phone/email, GST mode, remarks,
   and the quotation template to print with.
2. **Items** — unlimited rows, drag-reorder (dnd-kit), duplicate and delete.
   Each row: product (auto-fills name, description, unit, rate, GST%, size
   options), description, **size**, quantity, unit, rate, discount %, GST %,
   amount.
   - The size field is a combobox: choose a saved preset or pick `+ Custom…`
     and type a value. Custom mode stays open while typing and the value can be
     saved to the Sizes master in one click.
   - Text inputs keep focus per row (stable keys, local draft state) so mobile
     keyboards no longer close after a single character.
3. **Charges** — transportation / installation / unloading / misc, each with an
   editable label and amount, added after tax into the grand total.
4. **General Info** — pick a General Info template; fields are editable per
   quote before saving.
5. **Technical** and **Electrical** — pick spec templates; sections and rows are
   editable per quote.
6. **Terms & Bank** — pick a terms template, enable/disable individual terms,
   reorder them, and choose the bank account to print.

Live totals (subtotal, discount, GST, extra charges, round-off, grand total,
amount in words) update as you type.

## Snapshots

On save the quotation stores a **snapshot** of the general info, tech spec,
electrical spec, enabled terms and bank account it used, alongside the template
ID. Editing a master later never changes an already-issued quotation.

## Masters page (`/masters`)

Tabs for **Sizes**, **Terms Templates**, **General Info**, **Technical Specs**,
**Electrical Specs**, **Bank Accounts** and **Quotation Templates**. Each
supports create / edit / delete, and templates can be marked default so new
quotations start pre-filled. Quotation templates control accent colour, font,
table style, logo visibility and header/footer text used by the exports.

## Converting to an invoice

From the invoice screen, **Load from quotation** copies a saved quote's
customer, items, sizes, descriptions, charges and totals into a new GST
invoice; the quotation can then be marked `converted`.
