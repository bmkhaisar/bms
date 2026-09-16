# Implementation Log: BMS Document Sharing, Manual Reminders & Payment Insight

- **Date**: 2026-09-16
- **Author**: Senior Product & Engineering Architecture Team
- **Scope**: Reusable BMS Share Center, Native Web Share API, 2-Step Gmail Compose Workflow, WhatsApp Click-to-Chat, Canonical Party Master Contact Resolution, Credit Terms Freezing & Payment Due Insight Engine, and Manual Payment Reminders.

---

## 1. Architecture Overview

A unified document sharing and payment insight pipeline was architected to give BMS NEXT native, platform-agnostic document distribution and receivables intelligence across Desktop, Tablet, Mobile, and Installed PWA.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BMS SHARE CENTER                               │
│                         (BmsShareDialog Component)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Party Resolution:                                                          │
│  partyId ──► db().parties (Canonical Authority)                             │
│             └──► db().customers (Read-Only Legacy Fallback)                 │
│                                                                             │
│  Share Action Providers:                                                    │
│  ├── Native PDF Share    [navigator.share({ files: [pdfFile] })]            │
│  │   └─ Pre-generated PDF File on open (preserves browser gesture context) │
│  ├── 2-Step Email Share  [Download PDF ──► Open Gmail Web / Mailto]         │
│  │   └─ Prefills To, CC (defaultShareCcEmail), Subject, Body                │
│  │   └─ Never falsely claims "Please find the attached PDF"                 │
│  ├── WhatsApp Share      [https://wa.me/<normalized>?text=<encoded>]        │
│  │   └─ Country-aware phone normalization (no blind +91 prefixing)          │
│  │   └─ Confirmation guard for ambiguous international numbers              │
│  └── Direct Download PDF [Standard canonical browser file trigger]          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAYMENT DUE INSIGHT ENGINE                          │
│                        (paymentInsightService.ts)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Credit Days Priority Resolution:                                        │
│     Party.creditDays ──► Company.defaultCreditDays ──► 30-Day Fallback      │
│  2. Frozen Due Date Invariance:                                             │
│     - New Invoice: Persists creditDaysSnapshot & dueDate on creation        │
│     - Existing/Posted Invoice: ALWAYS respects frozen dueDate               │
│     - Partial Receipts: Invariant (never restarts/recalculates dueDate)     │
│  3. Status Classification & Days Math:                                      │
│     - Paid (balance <= 0)                                                   │
│     - Due Soon (remainingDays <= 3)                                         │
│     - Overdue (daysOverdue >= 1)                                            │
│     - Neutral / Due Later (remainingDays > 3)                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files Changed & Added

### Newly Created Files
- `src/modules/documents/sharing/bmsShareTypes.ts`: Domain models (`ShareDocumentData`, `SharePartyInfo`, `ShareCompanyInfo`, `PaymentDueInsight`, `ShareSessionState`).
- `src/modules/documents/sharing/bmsShareMessageService.ts`: Professional prefilled message generation, country-aware phone normalization, and Gmail/Mailto/WhatsApp URL composition.
- `src/modules/documents/sharing/paymentInsightService.ts`: Invariant credit days priority resolver, invoice due date calculator, receipt allocation matcher, and payment insight engine.
- `src/modules/documents/sharing/partyContactResolver.ts`: Canonical party contact resolver querying `db().parties` by `partyId` with read-only fallback.
- `src/components/app/share/BmsShareDialog.tsx`: Dialog UI with Native Share, 2-Step Email workflow, WhatsApp Click-to-Chat, session-scoped temporary contacts, and honest success notifications.
- `src/components/app/share/InvoicePaymentStatusPanel.tsx`: Compact badge and full card for invoice receivables status, receipts history, remaining/overdue days, and Send Reminder button.
- `src/components/app/share/index.ts`: Barrel exports for the sharing module.
- `test/bms-sharing-and-reminders.test.mjs`: Unit and invariant test suite (31 assertions covering phone normalization, email copy invariants, URL composition, frozen due dates, and state gating).

### Modified Core Files
- `src/lib/db.ts`: Added `defaultShareCcEmail?: string` to `CompanySettings` and `creditDaysSnapshot?: number` to `Invoice`.
- `src/modules/company/types.ts`: Added `defaultShareCcEmail` to `companySchema` as an operational setting.
- `src/routes/_app.settings.tsx`: Added company settings UI field for "Default Share CC Email (Optional)".
- `src/components/app/DocumentListPage.tsx`: Integrated `BmsShareDialog`, `InvoicePaymentStatusPanel`, table row actions (Preview, Download, Share, Print, Send Reminder, Record Receipt), Document Preview modal share actions, and frozen credit terms.
- `src/components/app/QuotationQuickPreviewModal.tsx`: Added `onShare` prop and Share action button.
- `src/components/app/QuotationsPage.tsx`: Integrated `BmsShareDialog` and table row share action.
- `src/routes/_app.receipts.tsx`: Integrated `BmsShareDialog`, extracted `getReceiptNormalizedDoc`, and added Share action button in receipt table.
- `src/modules/documents/quotationConversion.ts`: Freezes `creditDaysSnapshot` and calculates `dueDate` on converted invoices.

---

## 3. Share Flows & Platform Limitations

### Native Web Share (`navigator.share`)
- **Limitation**: The Web Share API requires synchronous invocation inside an active user gesture (such as `onClick`). Long async operations between the click and `navigator.share()` cause browsers to revoke the transient user activation permission.
- **Solution**: When `BmsShareDialog` opens, it immediately pre-generates the canonical PDF Blob and constructs a `File([blob], filename, { type: "application/pdf" })`. While preparing, the button displays a subtle "Preparing PDF..." state. Once ready, clicking "Share PDF" executes `navigator.share({ files: [pdfFile] })` directly inside the click event.
- **Fallback**: If `navigator.share` or `navigator.canShare({ files })` is unsupported (e.g. desktop browsers without file share support), the modal cleanly offers the 2-step Email, WhatsApp Click-to-Chat, and Download PDF options without error.

### Email Share (Gmail Web & Mailto)
- **Limitation**: Web browsers cannot attach local binary files to external `https://mail.google.com/mail/?view=cm...` or `mailto:...` compose URLs.
- **Solution**: Implemented an explicit 2-step user experience:
  1. **Step 1 — Download PDF**: User clicks [Download PDF].
  2. **Step 2 — Open Gmail**: Once downloaded, [Open Gmail] is enabled with the guidance message: *"Please attach the downloaded PDF before sending. BMS has prepared the recipient, subject and message for you."*
- **Copy Invariant**: In accordance with User Correction #6, email templates strictly avoid wording like *"Please find the attached PDF"*. Instead, they use truthful phrasing such as: *"Please find Invoice INV/... from <Company Name> for your reference."*
- **Operational CC**: Uses `defaultShareCcEmail` from `CompanySettings` as an operational prefill without contaminating historical transaction snapshots.

### WhatsApp Click-to-Chat (`wa.me`)
- **Limitation**: Text-based `wa.me` URLs cannot include file attachments.
- **Solution**: Provides the same 2-step guidance (Download PDF + Open WhatsApp) so users can paste/attach the PDF in their WhatsApp conversation.
- **Phone Normalization**: Respects canonical Party country data. Indian local 10-digit mobile numbers are formatted with country code `91`. Valid international numbers starting with `+` are preserved as-is. Unknown/ambiguous numbers trigger an explicit confirmation warning before opening WhatsApp.

---

## 4. Payment Due Insight & Credit Term Freezing

### Credit Terms Priority Resolution
For new invoices, credit terms are resolved in strict priority:
1. Party-specific Credit Days (`Party.creditDays`)
2. Company Default Credit Days (`CompanySettings.defaultCreditDays`)
3. 30-day Fallback

### Frozen Due Date Invariance
- When an invoice is created, `creditDaysSnapshot` and `dueDate` are saved and permanently frozen onto the `Invoice` document.
- Existing and posted invoices ALWAYS use their frozen `dueDate`. They are never recalculated when Party Master or Company Settings change.
- Partial receipts recorded against an invoice never alter or reset the `dueDate`.

---

## 5. Verification & Test Results

1. **Automated Unit & Invariant Tests (`npm test`)**:
   - Total test files: 45
   - Total test cases: 466
   - Result: **466 PASS, 0 FAIL** (duration: 5.98s)
   - New suite `test/bms-sharing-and-reminders.test.mjs`: **31 PASS, 0 FAIL**
2. **TypeScript Verification (`npx tsc --noEmit`)**:
   - Result: **0 errors, clean exit**
3. **Production Build (`npm run build`)**:
   - Result: **Vite build successful, nitro bundle created**
4. **Localhost Isolation**:
   - Localhost only; strictly NO git push or deployment executed.
