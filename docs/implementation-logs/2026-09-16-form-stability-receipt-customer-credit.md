# Implementation Log: Form Stability, Receipt Vouchers & Customer Credit Architecture

**Date:** 2026-09-16  
**Status:** COMPLETE & VERIFIED  
**PRD Reference:** BMS NEXT — Urgent Form Stability + Receipt / Customer Credit Final PRD  

---

## 1. Executive Summary & Root Cause Audit

### The Critical Bug
When creating or editing a Quotation or Invoice, selecting a Customer or changing a field (product, size, tab) caused the editor dialog to immediately auto-close, unexpectedly generating unwanted "Draft" documents in the background. Subsequent attempts created duplicate drafts.

### Exact Root Cause Analysis
A full lifecycle trace revealed **three compounding root causes**:

1. **Unconditional Deep-Link Close Trigger on Field Selection / Dexie Live Updates (`useDocumentDeepLink.ts`)**:
   - The shared hook `useDocumentDeepLink` maintained a reactive `useEffect` monitoring `[requestedId, options.documents]`.
   - When a user opened a new Quotation/Invoice manually (where URL did not contain `?id=...`, so `requestedId === null`), any selection of a Customer or Product updated the Dexie database or component state.
   - When `options.documents` changed, the hook re-evaluated `if (!requestedId) { onCloseRef.current(); }`.
   - Because `onCloseRef.current` was wired directly to closing the modal in the caller, **every Dexie row emission closed the newly opened or manually edited document editor**.

2. **Codex Contribution — Debounced Autosave & Unmount Flush (`QuotationForm.tsx` & `DocumentListPage.tsx`)**:
   - The previous Codex commit introduced an aggressive 750ms debounced autosave (`onDraftSave`) inside `QuotationForm.tsx` along with an unmount cleanup flush:
     ```typescript
     useEffect(() => () => {
       const pending = draftFlushRef.current;
       if (pending && draftSaveCallbackRef.current && pending.status === "draft") {
         void Promise.resolve(draftSaveCallbackRef.current(pending));
       }
     }, []);
     ```
   - Selecting a customer triggered an immediate form state update, firing the debounced save.
   - As soon as the document draft was created in Dexie/Firebase, `options.documents` re-emitted, which compounded with Root Cause #1 to forcefully terminate the modal.
   - Upon being closed, the unmount effect triggered a **second** final flush, generating duplicate draft entries.

3. **Stale Close Handlers Coupled with Document Previews**:
   - In `DocumentListPage.tsx`, `useDocumentDeepLink`'s `onClose` callback called `setEditing(null)` and `setOpen(false)` instead of strictly resetting URL preview state (`setPreview(null)`).

---

## 2. Shared Form Lifecycle Architecture

### Pure Lifecycle State Machine (`src/lib/useDocumentDeepLink.ts`)
To permanently isolate modal editing from URL query parameter synchronizations and Dexie live updates, we designed and implemented a formal state machine:
- Modes: `"idle" | "url_opened" | "manually_opened" | "new_document"`.
- Invariant: `requestedId === null` **must NEVER close** a manually opened editor or a new document editor.
- Closing from URL state occurs **only** when the *same active deep-linked document* had previously been opened from that URL and the user navigated away (e.g. Browser Back / URL clear).
- Added `markManualOpen()`: Disassociates URL query parameters when the user clicks "New", "Edit", "Duplicate", or starts a "Correction".

### Unsaved-Change Protection (No Unwanted Drafts)
Per PRD Requirement § 4:
- Automatic autosave on field selection has been completely removed from `QuotationForm.tsx`.
- Form now tracks dirty state against initial snapshots (`isDirty`).
- If the user clicks Cancel or Close while dirty, an explicit confirmation modal prompts:
  > *"You have unsaved changes. Discard them?"*
- Initial persistence is strictly gated on the user's explicit action: **Save / Create**.

---

## 3. Receipt Allocation & Customer Credit Model

### Authoritative Model (No Duplicate GL Entries)
Reused and extended the bill-wise allocation and party advance architecture (`partyAdvanceService.ts` & `documentPostingService.ts`):
- **Receipt Entry**:
  - Full Amount is received:
    - $\text{Dr Cash / Bank } [\text{Full Amount}]$
    - $\text{Cr Customer Ledger } [\text{Full Amount}]$
  - Bill-wise allocations determine:
    - `AGAINST_REF`: Settle existing Invoice outstanding (up to balance).
    - `CUSTOMER_CREDIT` / `ON_ACCOUNT`: Excess amount kept as unapplied credit associated with the party's immutable `partyId`.
  - **Zero Duplicate GL Entries**: Customer credit is derived authoritatively from open bill-wise allocations. Summary fields serve purely as derived caches.

### Real-Time Balance & Overpayment Warning (`_app.receipts.tsx`)
- Dynamically computes:
  - Selected Invoice Total
  - Previously Received
  - Current Outstanding
- As the user enters an amount, projected allocation and excess are computed instantly with zero latency.
- If Receipt Amount exceeds Outstanding:
  - Invoice allocation is capped at current outstanding.
  - Prominently displays an Overpayment Warning banner with explicit explanation:
    > *"₹933 exceeds the selected invoice balance. The extra amount will be kept as Customer Credit and can be applied to a future invoice."*
  - Provides a quick action button: `Cap to Invoice Balance (₹29,067)` or continue and keep as Credit.

### Future Invoice Credit Application (`DocumentListPage.tsx`)
- When creating or editing an Invoice for a customer:
  - Detects available customer credit by immutable `partyId`.
  - Prominently displays: `Available Customer Credit: ₹933`.
  - Provides an explicit `Apply Credit` button.
  - When applied:
    - Grand Total, Taxable Value, and GST remain completely unchanged.
    - Only `amountPaid` and `balance` are updated.
    - Explicit allocation linking credit source to invoice is recorded.

---

## 4. Receipt PDF Redesign (True Receipt Voucher)

### Format Overhaul (`src/lib/documentRenderer.ts` & `src/components/app/DocumentPrint.tsx`)
For normal Against-Invoice receipts:
- **Title**: Formatted as `RECEIPT VOUCHER` (never "Advance for GOODS").
- **Allocation Table**:
  - Columns: `SL No.`, `Payment Against` (e.g. `INV/2026-27/0004`), `Invoice Date`, `Invoice Amount`, `Balance Before`, `Allocated`, `Balance After`.
  - Summary row: `Customer Credit Created: ₹...` when excess exists.
- **Payment Details**: Method, Settlement Ledger Name, Reference Number.
- **Exclusions**:
  - Quotation Terms & Conditions strictly suppressed (`showTerms = docData.kind !== "receipt"`).
  - Unnecessary product tables (HSN, Size, Qty, Rate, Discount, GST) omitted for ordinary payment receipts.
  - Separate tax-aware rendering path preserved for genuine GST taxable advances.

---

## 5. Files Changed

| File Path | Purpose / Modifications |
|---|---|
| `src/lib/useDocumentDeepLink.ts` | Implemented pure lifecycle state machine (`handleDeepLinkTransition`), `openedIdRef` alias, and `markManualOpen`. |
| `src/components/app/QuotationForm.tsx` | Removed aggressive autosave/unmount draft flush; added unsaved changes dirty check (`You have unsaved changes. Discard them?`). |
| `src/components/app/QuotationsPage.tsx` | Integrated `markManualOpen`, explicit draft/issued creation, and dirty-safe cancellation. |
| `src/components/app/DocumentListPage.tsx` | Fixed deep-link coupling, integrated `markManualOpen`, added `Available Customer Credit` detection and `Apply Credit` action, added unsaved change protection. |
| `src/routes/_app.receipts.tsx` | Added real-time balance calculation, excess overpayment warning, against-ref allocation table, and `receiptDetails` metadata. |
| `src/modules/accounting/services/partyAdvanceService.ts` | Derived Customer Credit from open receipt allocations; fixed variable re-declaration; updated invoice allocation functions. |
| `src/modules/accounting/services/documentPostingService.ts` | Enforced strict GL invariant: Dr Cash/Bank, Cr Customer; no duplicate GL entries for customer credit. |
| `src/lib/documentRenderer.ts` | Redesigned against-invoice receipt PDF as true RECEIPT VOUCHER with allocation table; suppressed quotation terms on receipts. |
| `src/components/app/DocumentPrint.tsx` | Excluded Terms & Conditions on receipt prints (`!isReceipt`). |
| `src/components/app/InvoicePartyStatusPanel.tsx` | Prominently display Available Customer Credit for all payment policies. |
| `src/lib/db.ts` | Added `customerCreditPaise` and `customerCreditAppliedPaise` metadata fields. |
| `test/document-deep-link-lifecycle.test.mjs` | Automated unit tests for deep-link lifecycle state machine. |
| `test/document-permanence-and-bank-details.test.mjs` | Updated regression test to assert unsaved-changes protection and document permanence. |
| `test/prd-form-stability-receipt-credit.test.mjs` | Comprehensive automated test suite for all PRD § 28 acceptance criteria. |

---

## 6. Verification & Automated Test Results

1. **Targeted Deep-Link & Lifecycle Tests:**
   ```bash
   node test/document-deep-link-lifecycle.test.mjs
   # Output: 5 passed, 0 failed
   ```
2. **PRD Acceptance Test Suite:**
   ```bash
   node test/prd-form-stability-receipt-credit.test.mjs
   # Output: 9 passed, 0 failed
   ```
3. **Full Project Test Suite:**
   ```bash
   npm test
   # Output: 423 passed, 0 failed (100% pass rate across all 423 tests)
   ```
4. **TypeScript Strict Typecheck:**
   ```bash
   npx tsc --noEmit
   # Output: 0 errors
   ```
5. **Production Build:**
   ```bash
   npm run build
   # Output: Vite + Nitro build succeeded in 2.51s
   ```
