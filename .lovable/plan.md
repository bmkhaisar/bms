
# Professional Quotation Module — Build Plan

This is a large, multi-part upgrade to the existing Quotation module. I'll deliver it in one coherent build on top of the current Dexie/TanStack Start stack. All data stays local (IndexedDB); no backend.

## Scope

### 1. Data model additions (Dexie v2 migration)
New tables (kept backward compatible with existing `quotations`):
- `sizes` — reusable size presets `{ id, label, createdAt }`
- `termsTemplates` — `{ id, name, isDefault, terms: [{ id, text, enabled }] }`
- `generalInfoTemplates` — `{ id, name, fields: [{ key,label,value }] }` (configuration, transportation, foundation, roof, ventilation, wiring, insulation, power, custom…)
- `techSpecTemplates` — `{ id, name, sections: [{ title, rows:[{label,value}] }] }` (frame, panel, roof, floor, wall, doors, windows, base frame, electrical, insulation, accessories, extras)
- `bankAccounts` — `{ id, bankName, accountName, accountNo, ifsc, branch, upi, isDefault }`
- `quotationTemplates` — `{ id, name, isDefault, accent, font, showLogo, headerText, footerText, tableStyle }`

Extend `Quotation`:
- validity, preparedBy, siteLocation, contactPerson, contactPhone, contactEmail
- transportation, installation, unloading, misc charges (each `{label, amount}`)
- generalInfo, techSpec, electricalInfo (embedded snapshots so old quotes stay intact)
- termsSnapshot (array of enabled terms strings)
- bankSnapshot, templateId

Extend `Product` with `defaultSizes: string[]`, `specifications: string` (auto-fill on pick).

Extend `LineItem` with `size?: string`, `description?: string`.

### 2. New masters UI (routes under `_app.masters.*`)
- Sizes master (list + add/edit/delete)
- Terms templates (multi-template, drag-reorder, enable/disable individual terms, set default)
- General Info templates
- Technical Spec templates
- Bank accounts (multi-account, set default)
- Quotation templates (name, accent color, font family, table style, header/footer text, logo toggle, set default)

Company Settings page already exists — extend it with CIN, stamp upload, and re-use.

### 3. Quotation form rewrite (`_app.quotations.new.tsx` and `_app.quotations.$id.tsx`)
Premium layout with:
- Header card: customer picker, quote no (auto), date, validity, prepared by, site/location, contact person/phone/email, template picker
- Items editor v2:
  - Product select from Product Master (autofills name, description, size options, unit, rate, GST)
  - Size: combobox — pick saved OR type custom, with "save to master" one-click
  - Fields: description, qty, unit, rate, discount%, GST%, amount
  - Row actions: duplicate, delete, drag-reorder (dnd-kit)
- Extra charges block: transportation / installation / unloading / misc (each editable label + amount)
- Sections pickers: General Info template, Tech Spec template, Terms template, Bank account
- Live totals: subtotal, discount, GST, extra charges, grand total

### 4. Multi-page PDF & DOCX export
- PDF via `jspdf` + `jspdf-autotable` (already have jspdf) — pixel-perfect vector output, real page breaks, page numbers, logo on every page, "Built by MMA" footer watermark, A4.
- DOCX via `docx` npm package — mirrors the PDF: cover page, product table, general info, tech spec, electrical, terms, bank, signature. Headers/footers with logo and page numbers, "Built by MMA" footer.
- Pages appear only if the corresponding data exists.
- Both exports read the selected `quotationTemplate` for accent color / font.

### 5. Quotation history
- Existing list page upgraded: search, filter by status/date, sort, and per-row actions: Edit, Duplicate, Delete, Print, PDF, DOCX, Share (Web Share API with fallback to copy link).

## Technical notes
- Adds packages: `docx`, `jspdf-autotable`, `@dnd-kit/core`, `@dnd-kit/sortable`.
- Dexie migration bumps DB version to 2 with additive stores + upgrade hook (existing data preserved).
- All new pages/components remain client-only (Dexie SSR-guarded).
- Design stays inside the current soft-brutalist blue theme; no new global tokens beyond a template-driven accent CSS var.

## Out of scope
- Cloud sync / sharing links (Share falls back to copy of a local summary).
- E-invoice / IRN generation.
- Multi-currency (₹ only, as today).

Approve and I'll build it end-to-end in one pass.
