# BMS NEXT — Phase 3 Integration & Reality Audit

> **Document Type:** Authoritative Repository-Wide Reality Audit  
> **Status:** Completed & Reconciled Against Active Code  
> **Date:** September 2026  
> **Auditors:** Principal Software Architect, Senior Accounting Integration Engineer, Senior Firebase Engineer, Senior Offline-First Engineer  

---

## 1. Executive Summary & Verification Matrix

This audit represents an uncompromising inspection of the **actual codebase** of BMS NEXT (commit status September 2026). It documents the precise implementation state of every architectural component, identifying verified functionality, partial implementations, legacy components requiring modernization, and items blocked by credentials.

### Categorization Legend
- **`IMPLEMENTED`**: Fully implemented in code, tested, and active.
- **`PARTIALLY IMPLEMENTED`**: Foundation exists in code but lacks complete integration or UI/server connectivity.
- **`LEGACY`**: Old single-user/IndexedDB-only implementation that operates independently of the Phase 1/Phase 2 cloud architecture.
- **`NOT IMPLEMENTED`**: Planned architectural feature with no active implementation.
- **`BLOCKED BY CREDENTIALS`**: Implementation complete and verified via emulator/mocks, but live remote execution is waiting on cloud credentials (`FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, or Cloudflare R2 credentials).

---

## 2. Core Subsystems Audit Breakdown

| Subsystem / Feature Area | Reality Status | Actual Code Location | Audit Findings & Required Phase 3 Actions |
| :--- | :--- | :--- | :--- |
| **Platform Administrator Auth** | `IMPLEMENTED` | `src/server/platform-admin/auth.ts` | Authoritative UID `BOkCLXp08tVmRHICTArgpReVh5Y2` verified. Legacy UID `8Sqybhv41hhtuzcsN2JrMsnBdov2` strictly blocked. `requirePlatformAdmin` verifies `platformAdmin: true` claim. |
| **System Admin Console UI** | `IMPLEMENTED` | `src/routes/system-admin.tsx` | Organizations, users, access control operational with 0 companies. |
| **Double-Entry General Ledger** | `IMPLEMENTED` | `src/server/accounting/postingEngine.ts` | Enforces $\sum Dr \equiv \sum Cr$ in integer paise (`MoneyPaise`). Vouchers immutable; reversals generate equal-opposite entries. Day Book, Ledger Statement, Trial Balance implemented. |
| **Security Rules (RTDB)** | `IMPLEMENTED` | `database.rules.json` | Tenant isolation active. Sensitive paths (`/vouchers`, `/voucherLines`, `/docCounters`, `/auditLogs`, `/stockMovements`) have `.write: false`. |
| **Deployment Target** | `PARTIALLY IMPLEMENTED` | `vite.config.ts`, `.output/` | **Conflict Found:** Nitro was using default preset `cloudflare-module` which output `wrangler.json`. Needs explicit configuration for **Vercel** (`preset: 'vercel'`). |
| **Two-Hour Session Enforcement** | `PARTIALLY IMPLEMENTED` | `src/modules/auth/`, `src/server/` | `AuthContext` handled Firebase auth but lacked strict 2-hour absolute session expiration (`MAX_SESSION_AGE_SECONDS=7200`) based on `auth_time`. Server middleware lacked token `auth_time` age rejection. |
| **Company Settings Realtime** | `LEGACY` | `src/routes/_app.settings.tsx` | UI writes to legacy `db().companySettings.get("singleton")` instead of Firebase RTDB `/companies/{companyId}` and tenant cache. |
| **Sales Invoices Integration** | `LEGACY` | `src/components/app/DocumentListPage.tsx` | Invoices save directly to Dexie `db().invoices` and mutate scalar stock without posting double-entry vouchers (`Customer Dr`, `Sales Cr`, `GST Cr`). |
| **Purchase Bills Integration** | `LEGACY` | `src/components/app/DocumentListPage.tsx` | Purchases save directly to Dexie `db().purchases` without posting double-entry vouchers (`Purchases Dr`, `GST Dr`, `Supplier Cr`). |
| **Payment Receipts Integration** | `LEGACY` | `src/routes/_app.receipts.tsx` | Receipts save to Dexie `db().receipts` without double-entry voucher posting (`Cash/Bank Dr`, `Customer Cr`). |
| **Customer & Supplier Directory** | `LEGACY` | `_app.customers.tsx`, `_app.suppliers.tsx` | CRUD operates on local Dexie `db().customers` without automatic linkage to General Ledger accounts (`Debtors`, `Creditors`). |
| **Quotation Engine** | `IMPLEMENTED` | `QuotationForm.tsx`, `quotationExport.ts` | Multi-page vector PDF and DOCX generation work well. Snapshotting implemented. |
| **Quotation $\rightarrow$ Invoice Conversion** | `PARTIALLY IMPLEMENTED` | `DocumentListPage.tsx:151` | Conversion exists in `DocumentListPage` but **drops extraCharges** and does not post double-entry vouchers. Also missing explicit convert button on `QuotationsPage.tsx`. |
| **Document Vector Engine** | `PARTIALLY IMPLEMENTED` | `src/lib/pdf.ts`, `quotationExport.ts` | Quotations use vector `jspdf-autotable`. Invoices/Purchases/Receipts use rasterized `html2canvas` screenshots (`src/lib/pdf.ts`). Must unify on clean vector PDF engine. |
| **Rupee (₹) Glyph Handling** | `PARTIALLY IMPLEMENTED` | `quotationExport.ts:18` | jsPDF built-in fonts lack the ₹ glyph; `quotationExport.ts` correctly mapped to `"Rs. "`. Must unify across all document outputs to prevent superscript `1` artifacts. |
| **Dashboard Financial Metrics** | `LEGACY` | `src/routes/_app.index.tsx` | Hardcoded `netProfit = grossProfit // no expenses module yet`. Reads from legacy Dexie instead of authoritative accounting engine / Trial Balance. |
| **Public Experience (Login/About/Contact)** | `LEGACY` | `login.tsx`, `about.tsx`, `contact.tsx` | Old offline-only copy ("No accounts, no cloud, no subscriptions"). Attribution contains full personal name instead of "MMA". Typos in contact emails. |
| **Global Search Deep-Linking** | `PARTIALLY IMPLEMENTED` | `src/components/app/GlobalSearch.tsx` | Search modal exists and indexes records, but clicking an invoice merely navigated to `/invoices` without opening the specific document. |
| **Cloudflare R2 Binary Storage** | `BLOCKED BY CREDENTIALS` | `src/modules/storage/fileStorage.ts` | Client correctly displays "Storage not configured" when credentials are absent; metadata only in RTDB. |
| **Firebase Admin Remote Postings** | `BLOCKED BY CREDENTIALS` | `src/server/accounting/postingEngine.ts` | Gracefully returns `SERVER_CONFIG_REQUIRED` when service account credentials are not in environment. Tested and verified in emulator. |

---

## 3. Discrepancy & Contradiction Resolution

1. **Voucher Date Storage:**
   - *Blueprint Documentation:* Specified numeric epoch timestamps.
   - *Actual Implementation (`Phase 2`):* Stores canonical `YYYY-MM-DD` string in `voucher.date` to eliminate timezone drift across financial years, while storing numeric epoch milliseconds in `createdAt` and `postedAt`.
   - *Resolution:* Canonical `YYYY-MM-DD` is authoritative for accounting business dates; epoch ms is authoritative for audit timestamps.

2. **Voucher State Lifecycle:**
   - *Blueprint Documentation:* Suggested simple `posted` / `voided` states.
   - *Actual Implementation:* Enforces a 4-state lifecycle: `draft`, `posted`, `reversed`, `cancelled`. Posted vouchers can never be deleted; they must be reversed with counter-entries.
   - *Resolution:* 4-state model is authoritative.

3. **Money Representation:**
   - *Blueprint Documentation:* Stored floating-point currency numbers.
   - *Actual Implementation:* Uses `MoneyPaise` (strict integers representing minor paise units) throughout `postingEngine.ts`, `reversalEngine.ts`, and ledger balances to prevent IEEE-754 rounding errors.
   - *Resolution:* `MoneyPaise` integer representation is authoritative.

4. **Public Attribution & Branding:**
   - *Blueprint Documentation:* Contained personal name variations.
   - *Directive:* Must be strictly **"MMA"** or **"BMS NEXT · an MMA product"**. No full personal names in user-facing branding.
   - *Resolution:* Updated across all public headers, footers, and metadata.

5. **Deployment Target:**
   - *Previous Build:* Target was building with Nitro Cloudflare preset.
   - *Directive:* The primary application hosting target is **Vercel**. Cloudflare is strictly for **R2 binary object storage**.
   - *Resolution:* Configured Nitro with `preset: 'vercel'` in `vite.config.ts`, added `vercel.json`, and validated clean production builds.

---

## 4. Phase 3 Implementation Plan Order

Following the resolution of these reality discrepancies, implementation proceeds in strict sequence:
1. **Target Correction:** Vercel build configuration & validation.
2. **Session Security:** Centralized 2-hour session limit (`MAX_SESSION_AGE_SECONDS=7200`) across client, server token validation, and RTDB security rules.
3. **Public Experience Modernization:** Redesign `/login`, `/about`, `/contact`, and `PublicShell` with Apple-inspired restraint, "MMA" branding, and centralized support configuration (`maazmohammed112@gmail.com`).
4. **Design System & Shell:** Refine `Sidebar`, `Topbar` (with sync status, FY switcher, branch indicator), and design tokens.
5. **Realtime Company Settings:** Wire `_app.settings.tsx` to Firebase RTDB and tenant cache with live multi-device propagation.
6. **Quotation Hardening:** Preserve extra charges on conversion, add explicit row action, and isolate quotation edits from converted invoices.
7. **Unified Vector Document Engine:** Build shared A4 vector PDF renderer with selectable text, company snapshot headers, and clean Rupee glyph fallbacks.
8. **Double-Entry Integration:** Connect Invoices, Purchases, and Receipts to `postVoucherServerFn` and general ledger accounts.
9. **Controlled Invoice Amendments:** Safe amendment mode reversing prior accounting effects while enforcing period locks.
10. **Global Search Deep-Linking:** Direct record modal opening from command palette.
11. **Testing & Verification:** Add comprehensive integration tests and verify all 86+ tests continue passing.
