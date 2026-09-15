# Final Polish & Customer Credit Integrity Implementation Log

**Date:** 2026-09-16  
**Author:** Senior Engineering Manager / Accounting Systems Architect  
**Status:** Completed & Validated  

---

## 1. Customer Credit Mathematical & Accounting Audit

### Discrepancy Observed
- **Invoice Editor Display:** ₹35,164.98 Available Customer Credit
- **Party Master / Customer Insight:** ₹0 Customer Credit
- **Receipt Voucher REC/...0005 Overpayment:** ₹2,932.98 Customer Credit
- **Mathematical Variance:** ₹35,164.98 - ₹2,932.98 = ₹32,232.00

### Root Cause Traced
1. **Offending Record:** Receipt `REC/2026-27/0003` (Amount: ₹32,232.00) was recorded against Invoice `INV/2026-27/0004` (`r.invoiceId`), but its `allocatedInvoices` array was empty/unpopulated.
2. **The Naive Calculation in `DocumentListPage.tsx`:**
   ```ts
   const netPaise = Math.round(Number(r.amount || 0) * 100) - (r.refundAmountPaise || 0);
   const allocatedPaise = (r.allocatedInvoices || []).reduce((acc, a) => acc + (a.amountPaise || 0), 0);
   const unappliedPaise = Math.max(0, netPaise - allocatedPaise);
   ```
   Because `allocatedInvoices` was empty, `allocatedPaise` evaluated to 0. Consequently, the entire historical payment of ₹32,232.00 was counted as unapplied customer credit!
3. Together with `REC/2026-27/0005`'s overpayment credit (₹2,932.98), the invoice editor showed:
   $$\text{Available Credit} = ₹32,232.00 + ₹2,932.98 = ₹35,164.98$$
4. Meanwhile, `getPartyDualFinancialPosition` in `partyAdvanceService.ts` only looked for `r.allocationType === "ADVANCE" || !r.invoiceId`. Because both receipts were posted against an invoice, it filtered both out and returned **₹0**.

### Authoritative Canonical Engine
Implemented pure engine `calculateCustomerCreditFromReceipts(partyId, receipts)` in `src/modules/accounting/services/partyAdvanceService.ts`:
- **Formula:**
  $$\text{AVAILABLE CUSTOMER CREDIT} = \sum \text{Posted Unapplied Allocations} - \text{Applied to Invoices} - \text{Refunds/Reversals}$$
- **Handling Against-Invoice Receipts:**
  - If `r.allocatedInvoices` is present, uses the explicit allocation array.
  - If `r.invoiceId` is present without `allocatedInvoices`: checks for explicit excess credit (`r.customerCreditPaise ?? r.advanceAvailablePaise ?? r.unappliedCreditPaise`). If excess exists, excess is credit, remainder is allocated. If no excess exists, 100% was allocated to the invoice (remaining credit: ₹0).
  - Draft, cancelled, reversed, and refunded receipts are strictly excluded.
- **Trace Breakdown:**
  - `REC/2026-27/0003`: Received ₹32,232.00, Against Invoice: ₹32,232.00, Remaining Credit: **₹0.00**
  - `REC/2026-27/0005`: Received ₹31,999.98, Against Invoice: ₹29,067.00, Remaining Credit: **₹2,932.98**
  - **Reconciled Authoritative Customer Credit:** **₹2,932.98** across all screens (Party Master, Customer Insight, Invoice Editor, Receipt Editor, Reports).

---

## 2. Receipt & Large Modal Viewport Scroll Architecture

### Root Cause
Receipt Modal and Treasury dialogs used unbounded dialog containers that exceeded standard 100vh displays on laptops, tablets, and small viewports, causing the footer and "Post Receipt Voucher" button to clip off-screen.

### Architecture Implemented
All treasury and document modals now follow the viewport-safe layout contract:
```
DialogContent (max-w-xl max-h-[90dvh] flex flex-col p-0 overflow-hidden sm:rounded-2xl)
├── DialogHeader (border-b shrink-0 p-6 pb-3 bg-background/95 backdrop-blur)
├── Scrollable Body (flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-4 scrollbar-thin)
└── DialogFooter (p-4 border-t shrink-0 bg-background/95 backdrop-blur flex justify-end gap-2)
```
- Responsive across desktop, laptop, tablet, and mobile.
- Body scrolls with mouse wheel, trackpad, touch, and keyboard.
- Sticky footer ensures the primary action button ("Post Receipt Voucher", "Post Invoice", etc.) is permanently reachable.

---

## 3. GST Dashboard & Report Reconciliation

### Discrepancy Observed
- Sales & Revenue / GST Report showed Output GST: **₹19,080.72** (mathematically verified: Net Sales ₹1,06,004.00, Gross ₹1,25,085.00).
- Dashboard Output GST showed **₹9,730.08**.

### Root Cause
`src/modules/accounting/services/dashboardReportService.ts` checked:
```ts
const outputGst = gstOutputPaise > 0 ? gstOutputPaise / 100 : fyInvoices.reduce(...);
```
An "Output GST" ledger had a stale partial balance of 973,008 paise (₹9,730.08) from partial manual entries, overriding the true calculation from posted invoices.

### Reconciliation
Dashboard metrics now use the canonical calculation function `resolveDocumentTaxes(i).totalTax` directly matching the Sales & Revenue report across posted FY invoices:
- `Dashboard Output GST == GST Report Output GST == ₹19,080.72`

---

## 4. Elimination of Browser-Native Dialogs

All occurrences of `window.alert`, `window.confirm`, `confirm()`, and `prompt()` were identified and replaced with the BMS branded `<ConfirmDialog>` component:
1. `src/components/app/DocumentListPage.tsx`: Discard unsaved changes modal.
2. `src/components/app/QuotationForm.tsx`: Discard unsaved changes modal.
3. `src/modules/platform-admin/components/CompanyAccessView.tsx`: Suspend user access confirmation modal.
4. `src/modules/platform-admin/components/CompanyAccessView.tsx`: Revoke user access confirmation modal.

---

## 5. React Keys, Controlled Selects, & Route Code-Splitting

1. **Unique Key Warning:**
   - In `src/routes/_app.reports.tsx`, `rows.map((i) => (<>...` used an un-keyed React `<>` fragment as the immediate child of `<TableBody>`, triggering `Each child in a list should have a unique "key" prop. SalesReport → tbody`. Replaced with `<Fragment key={i.id}>`.
   - In `itemCostBreakdown`, `key={idx}` replaced with stable unique key `key={`${item.name}-${idx}`}`.
2. **Controlled Select Inputs:**
   - Quotation loader Select in `DocumentListPage.tsx` made controlled with `value=""`.
   - Settlement ledger and payment method selects protected with fallback `value={field || ""}` preventing `undefined -> string` transition warnings.
3. **TanStack Route Exports:**
   - Removed redundant `export` keywords from page functions in 12 route files (`about.tsx`, `contact.tsx`, `login.tsx`, `no-company-access.tsx`, `platform-admin-setup-required.tsx`, `system-admin.tsx`, `_app.backup.tsx`, `_app.categories.tsx`, `_app.index.tsx`, `_app.parties.tsx`, `_app.settings.tsx`, `_app.suppliers.tsx`), allowing clean route code-splitting without TanStack warnings.

---

## 6. Product Search Dropdown & Selling Price Warning

1. **Bounded Product Search Dropdown:**
   - In `src/components/app/LineItemsEditor.tsx`, product combobox results container bounded to `max-h-[160px]` with `scrollbar-thin`, displaying approximately 3 visible rows at a time with smooth scrolling.
   - Filter query matches sliced to maximum 25 items, preventing DOM overhead with large catalogs.
2. **Product Selling Price Warning:**
   - In `src/routes/_app.products.tsx`, attempting to save a product with missing or ₹0 selling price triggers the branded warning:
     > "Selling price is not set. Future invoices will require the rate to be entered manually."
     > Actions: `[Go Back]` and `[Save Without Price]`.
   - Explicit confirmation saves the product without price; user can go back to provide a rate.
   - Transaction document manual rates in Quotations and Invoices update only transaction lines and `lastSalesRatePaise`; Product Master `sellingPrice` is preserved untouched.

---

## 7. Verification Summary

- **Automated Tests:** `435/435` passed (`npm test` including new `test/final-polish-credit-integrity.test.mjs`).
- **TypeScript Check:** `npx tsc --noEmit` passed with 0 errors.
- **Production Build:** `npm run build` passed with exit code 0.
