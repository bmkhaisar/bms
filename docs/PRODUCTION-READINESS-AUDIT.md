# BMS NEXT — PRODUCTION-WIDE REALITY AUDIT

**Date:** September 12, 2026  
**Auditor Roles:** Principal ERP Architect, Senior Finance Manager, Senior Accountant, Indian GST Specialist, Senior Billing & Invoicing Engineer, Senior Firebase / Realtime Systems Engineer, Senior Offline-First Engineer, Senior Product Designer, Senior UX Engineer, Senior QA Engineer, Senior Production Reliability Engineer  
**Scope:** Complete Codebase, Services, Data Flow, Security Rules, Realtime Sync, Accounting Engine, Local Dexie Cache, Tax Calculations, Document Printing/PDF, and Storage.

---

## Executive Summary

BMS NEXT is deployed to Vercel and connected to GitHub. It has an established double-entry accounting engine (`documentPostingService.ts`), strict 2-hour session security, atomic server document numbering (`{PREFIX}/{FY}/{SEQ}`), multi-tenant RTDB security rules (`database.rules.json`), and 149 passing unit tests.

However, a reality audit of actual files, services, and execution paths reveals critical gaps that prevent 10 concurrent employees from operating the ERP seamlessly:
1. **Disconnected Master Data Creation:** Product and Category screens only write to legacy `bms_db_v1` and do not sync to Firebase RTDB or `bms_cache_v1`.
2. **Missing Quick-Create UX:** Invoices and Quotations cannot create customers inline; Purchases cannot create suppliers inline; line items cannot create products inline. Users are forced to abandon drafts to create entities.
3. **Tax Engine Inconsistencies:** No unified centralized tax engine. Invoices force GST calculation and columns even for Non-GST/Unregistered businesses; no tax-inclusive price back-calculation; transport/additional charges are not tax-categorized.
4. **GST Disconnection:** GST reports only calculate Output GST from sales invoices; Input GST from purchases is neglected; Net GST Position is absent; no drill-down from GST entries to invoices.
5. **PDF Engine Limitations:** Company uploaded logo is not rendered on generated PDFs; no company-configurable subtle logo watermark; Non-GST documents print empty 0% GST tables; no automated multi-page stress tests.
6. **Local Index & Performance:** `bms_cache_v1` does not maintain normalized index fields (`nameLower`, `sku`, `gstin`, `numberLower`); global search does expensive array filtering.
7. **Navigation & UI Cleanup:** Authenticated company sidebar retains marketing "About" link; lacks logical workflow groupings (Overview, Sales, Purchase, Inventory, Accounting, Settings); Liquid-Glass design tokens and skeletons are inconsistent.
8. **Cloud Storage Verification:** Cloudflare R2 bucket `bms-next-assets` requires presigned upload implementation and verification script (`npm run verify:r2`).

---

## Module-by-Module Classification & Reality Trace

| Module | Classification | UI State | Service / Validation | Cloud RTDB Sync | Accounting Connection | Local Cache (`bms_cache_v1`) | PDF / Export |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dashboard** | `PARTIAL` | Rendered with Recharts | `computeDashboardMetrics` | Reads `ledgers` realtime | Formal COA | Mixed (`db()` + RTDB) | N/A |
| **Customers** | `WORKING` | Complete CRUD | Form validation + clean error handling | Synced `companyData/.../customers` | Links Receivable Ledger | Cached in `bms_cache_v1` | N/A |
| **Suppliers** | `WORKING` | Complete CRUD | Form validation | Synced `companyData/.../suppliers` | Links Payable Ledger | Cached in `bms_cache_v1` | N/A |
| **Products** | `NOT_CONNECTED` | Rendered CRUD | Local only | **NOT SYNCED** to Firebase | Stock delta only in local `bms_db_v1` | **NOT CACHED** in `bms_cache_v1` | N/A |
| **Categories** | `NOT_CONNECTED` | Rendered CRUD | Local only | **NOT SYNCED** to Firebase | N/A | **NOT CACHED** in `bms_cache_v1` | N/A |
| **Quotations** | `PARTIAL` | Rich Form & Templates | Client calc | **NOT SYNCED** to Firebase | Quotation does not post (correct) | Legacy `bms_db_v1` only | Vector PDF / DOCX |
| **Quote Masters** | `PARTIAL` | Preset management | Local only | Rule exists, sync hook missing | N/A | Legacy `bms_db_v1` | N/A |
| **GST Invoices** | `PARTIAL` | DocumentListPage | Server posting service | Synced `invoices/` | Posts balanced double-entry voucher | Cached on post | Vector PDF (No logo, no watermark) |
| **Receipts** | `PARTIAL` | Tabs with Payments | Server posting service | Synced `receipts/` | Posts Cash/Bank Dr, Customer Cr | Cached on post | Print element |
| **Payments** | `PARTIAL` | Inside Receipts page | Server posting service | Synced `payments/` | Posts Supplier Dr, Cash/Bank Cr | Cached on post | Print element |
| **Purchases** | `PARTIAL` | DocumentListPage | Server posting service | Synced `purchases/` | Posts Purchase Dr, Input Tax Dr, Supp Cr | Cached on post | Vector PDF |
| **Ledgers** | `WORKING` | Tree + Statements | Server posting / query | Synced `ledgers/` | Authoritative COA | Realtime cloud | Print statement |
| **Accounting** | `WORKING` | Formal double-entry | Integer paise balance check | Synced `vouchers/` | Enforces Dr = Cr | Cloud authoritative | N/A |
| **Reports** | `PARTIAL` | Tabs (Sales, Pur, GST) | Local filter | Reads local Dexie | Disconnected from posted vouchers | Reads legacy `bms_db_v1` | JSON export only |
| **Company Settings** | `PARTIAL` | Multi-tab settings | Form validation | Synced `companies/` | Sets numbering & prefixes | Cached | N/A |
| **Backup & Sync** | `PARTIAL` | Export & Clear cache | Client JSON generator | None | Preserves ledger safety | Clears `bms_cache_v1` | JSON file |
| **System Admin** | `WORKING` | Dedicated Route | Server-only actions | Synced `memberships/`, `users/` | Isolated from tenant operational data | N/A | N/A |
| **Global Search** | `PARTIAL` | Cmd+K Modal | Full-array filtering | None | Finds entities across tabs | Reads legacy `bms_db_v1` | N/A |
| **Auth & Session** | `WORKING` | Login / Multi-Company | Session < 7200s enforced | Synced `users/`, `userCompanies/` | User-scoped | Session state cached | N/A |
| **Realtime Sync** | `PARTIAL` | Network pill in sidebar | Outbox manager | Incremental query partial | Handles offline queue | `bms_cache_v1` outbox | N/A |
| **Dexie Cache** | `PARTIAL` | `bms_cache_v1` exists | Version 2 schema | N/A | N/A | Lacks compound field indexes | N/A |
| **PDF Engine** | `PARTIAL` | jsPDF + autotable | `buildDocumentPDF` | N/A | N/A | N/A | Selectable vector, but lacks logo/watermark |
| **R2 Storage** | `BLOCKED_BY_CONFIG`| Fallback provider | `UnconfiguredStorageProvider`| No presigned endpoint | N/A | N/A | N/A |
| **PWA / UX** | `PARTIAL` | Dark/light theme | Inconsistent glass tokens | N/A | N/A | N/A | N/A |

---

## Detailed Findings By Architecture Domain

### 1. Data Flow & Connectivity Disconnects
- **Products & Categories Isolated:** Adding a product in `/products` writes solely to IndexedDB table `db().products`. When another employee logs in on Device B, they see an empty product directory. Products must write to `companyData/${companyId}/products` in Firebase RTDB and update `bms_cache_v1`.
- **Quotation to Invoice Disconnect:** `convertQuotationToInvoice` allocates a client-side document number, defaults GST split to 50% without validating company tax registration or interstate supply, and does not post the invoice through `postInvoiceTransaction`.
- **Master Creation Dropdowns:** An employee billing a walk-in customer cannot create the customer from the invoice screen. They must leave the page, losing their draft line items.

### 2. Tax & GST Engine Reality
- **Rigid GST Hardcoding:** Calculation assumes every invoice is taxable with CGST/SGST or IGST. Non-GST companies or zero-rated items cannot produce compliant commercial invoices without zero tax columns.
- **Tax-Inclusive Pricing Missing:** No integer paise back-calculation formula for retail/MRP billing (e.g. ₹1,180 with 18% GST -> Taxable ₹1,000 + GST ₹180).
- **Transport & Additional Charges Tax Treatment:** Additional charges (freight, installation) do not support taxable vs exempt classification.
- **GST Section Disconnection:** The Dashboard and Reports treat gross invoice totals as GST or only sum sales invoices. Input GST from purchases is not tracked; Net GST liability is not computed.

### 3. Dexie Local Indexing & Performance
- `bms_cache_v1` uses a generic `cachedEntities` store without dedicated index fields (`nameLower`, `sku`, `gstin`, `numberLower`, `customerId`, `status`, `date`).
- Large-dataset searches run expensive in-memory JavaScript string filters over loaded arrays, which will choke on 10,000+ items.
- Adding Version 3 with dedicated schema indexes will guarantee sub-millisecond lookups.

### 4. Professional Document Printing & PDF
- `documentRenderer.ts` generates clean vector A4 PDFs, but omits the company's uploaded logo even when present in `companySnapshot`.
- No subtle background watermark feature (3%–8% opacity) as requested by users.
- Non-GST invoices print empty CGST/SGST/IGST columns instead of a clean commercial format.

### 5. UI/UX & Navigation Polish
- Authenticated company sidebar retains public `/about` route.
- Sidebar links are flat; they should be grouped into:
  - **OVERVIEW:** Dashboard
  - **SALES:** Customers, Quotations, Invoices, Receipts
  - **PURCHASE:** Suppliers, Purchases, Payments
  - **INVENTORY:** Products, Categories, Stock
  - **ACCOUNTING:** Ledgers, Reports, GST
  - **SETTINGS:** Company, Backup & Sync
- Loading experiences vary; several routes lack layout-matching skeletons.

---

## Action Plan For Production Hardening

1. **Tax Engine Domain:** Centralize all tax, discount, additional charge, tax-inclusive/exclusive, and intra/interstate logic into `src/modules/tax/` using integer paise math.
2. **One Connected ERP Masters:**
   - Wire Products and Categories to Firebase RTDB + `bms_cache_v1`.
   - Create unified Quick-Create dialogs for Customers (from Invoice/Quote), Suppliers (from Purchase), Products (from LineItems), Categories (from Product), and Bank/Cash Ledgers (from Receipts/Payments).
3. **Dexie High-Speed Indexing (`bms_cache_v1` v3):** Add compound indexes, normalized search fields, and hydrate-first loading across all lists.
4. **GST Dashboard & Report Enhancement:**
   - Dashboard card with Output GST, Input GST, and Net GST.
   - Comprehensive GST Register with drill-down to invoices and purchases.
5. **PDF Engine Upgrade:**
   - Render genuine company logo (never fallback to BMS logo on tenant documents).
   - Add company-configurable subtle logo watermark (3%–8% opacity).
   - Clean Non-GST invoice vector layout without empty GST columns.
6. **Navigation & Liquid-Glass UX:** Group sidebar logically, remove About from app shell, unify Liquid Glass design tokens, add layout skeletons, and ensure responsive table cards on mobile.
7. **R2 Verification & Firebase Admin Tooling:** Create `scripts/verify-r2.mjs` and wire `npm run verify:r2`.
8. **Automated Production Test Suite:** Add unit tests validating every requirement while preserving all 149 existing passing tests.
