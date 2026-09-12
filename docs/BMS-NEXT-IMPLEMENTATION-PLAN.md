# BMS NEXT — Master Implementation Plan & System Architecture

> **Document Version:** 2.0.0  
> **Status:** Approved Architectural Blueprint  
> **Author:** Principal Software Architect & Senior Engineering Team  
> **Date:** September 2026  

---

## 1. Analysis of Existing Architecture

### 1.1 Current State
The existing Business Management System (`tanstack_start_ts`) is an offline-only, single-user client application:
- **Database:** IndexedDB via Dexie.js (`bms_db_v1`). All records exist solely on the client machine in unencrypted browser storage.
- **Authentication:** Mocked in `src/lib/session.ts` with hardcoded credentials (`admin@business.local` / `Admin@123`) stored in `localStorage` (`bms_session_v1`) with a 24-hour expiration. No true identity or multi-tenancy exists.
- **State Management & Reactivity:** Direct Dexie table reads via `useLive` (`dexie-react-hooks`). Mutating a record writes directly to IndexedDB.
- **Financial Architecture:**
  - Incomplete financial model: Invoices decrease product stock and increase customer balance; Receipts reduce invoice balance.
  - No double-entry ledger: Accounts are not represented as formal debit/credit ledgers.
  - The Dashboard calculates `netProfit = grossProfit` with an explicit code comment: `// no expenses module yet`.
  - No supplier payment vouchers: Payments can only be recorded via the `amountPaid` field directly inside purchase bills.
  - Quotation-to-Invoice conversion loses `extraCharges` because the `Invoice` schema lacks this property.
- **Inventory Model:**
  - Inventory is simply a mutable scalar `currentStock` on the `Product` entity.
  - No historical stock movement ledger (opening, purchase, sale, transfer, adjustment, damage).
- **Document Generation:**
  - Quotations have an advanced multi-page vector PDF pipeline (`jspdf` + `jspdf-autotable`) and Word export (`docx`).
  - Invoices, Purchases, and Receipts rely on rasterized `html2canvas` screenshotting to PDF, resulting in large files and fuzzy printouts.
- **Global Search:** Finds records but simply navigates to the list page (`/invoices`, `/customers`) without opening or highlighting the target entity.
- **Backup Routine:** `src/routes/_app.backup.tsx` completely omits the 6 v2 master tables (`sizes`, `termsTemplates`, `generalInfoTemplates`, `techSpecTemplates`, `bankAccounts`, `quotationTemplates`).

---

## 2. Reusable Components & Modules

The existing codebase contains robust, production-tested modules that will be preserved and refactored into the new architecture:

1. **Quotation Generation Engine (`src/lib/quotationExport.ts`):**
   - High-fidelity vector PDF generation (`jspdf` + `jspdf-autotable`).
   - Binary DOCX generation (`docx`).
   - Clean page-break algorithms, dynamic color theming, and multi-page layouts.
   - *Action:* Preserved and adapted as the primary vector document engine for Invoices, Purchase Orders, and Delivery Notes.

2. **Quotation Editor & Masters (`QuotationForm.tsx`, `_app.masters.tsx`):**
   - Drag-and-drop line item reordering (`@dnd-kit`).
   - Comprehensive preset masters (Sizes, Terms, General Information, Technical & Electrical Specs, Bank Accounts, Visual Templates).
   - Historical snapshotting architecture (ensures editing masters never alters previously generated documents).
   - *Action:* Preserved; quotation masters will be scoped to `/companyData/{companyId}/quotationMasters`.

3. **Calculation & Math Utilities (`src/lib/calc.ts`):**
   - Pure line item and document totals computation (`computeLine`, `computeTotals`).
   - Precise 2-decimal rounding (`round2`), Indian GST calculation rules (intra-state CGST+SGST vs. inter-state IGST), and round-off math.
   - *Action:* Preserved as core calculation primitives, integrated into the server-side validation layer and accounting voucher generator.

4. **Indian Localization Engine (`src/lib/format.ts`):**
   - Currency formatting (`formatMoney` with `en-IN` grouping: Crores, Lakhs, Thousands).
   - Legal Indian number-to-words transcription (`numberToWordsIndian` with Rupees and Paise).
   - Standard commercial dates (`dd/mm/yyyy`).
   - *Action:* Preserved application-wide.

5. **Design System & Primitives (`src/components/ui/*`, `styles.css`):**
   - Complete shadcn/Radix component collection (Dialogs, Selects, Tabs, Tables, Dropdowns, Cards, Buttons, Inputs).
   - Modern Tailwind CSS tokens and soft-brutalist styling.
   - Responsive sidebar and navigation shell.
   - *Action:* Preserved as the base visual system, refined with subtle gradients and glassmorphism.

---

## 3. Components to Replace or Refactor

| Component / File | Current Behavior | New Architecture Replacement |
| :--- | :--- | :--- |
| `src/lib/session.ts` | Hardcoded email/password in `localStorage` | Firebase Authentication SDK (`signInWithEmailAndPassword`, `signOut`, `onAuthStateChanged`, token management) |
| `src/routes/_app.tsx` | Simple client-only `isAuthenticated()` check | Multi-layer Auth & Company Gate: verifies Firebase Auth token, resolves company memberships, binds `ActiveCompanyContext` |
| `src/routes/login.tsx` | Mock timeout login against hardcoded strings | Real Firebase Auth login form with password reset, validation, error handling, and session persistence |
| `src/lib/db.ts` | Primary database (`bms_db_v1`) | Refactored into **Dexie Local Cache + Outbox Queue**; Firebase Realtime Database becomes cloud source of truth |
| `src/components/app/Sidebar.tsx` & `Topbar.tsx` | Static list of routes, hardcoded user | Company switcher dropdown, financial year selector, branch switcher, user profile menu, and grouped navigation |
| `DocumentListPage.tsx` | Direct Dexie read/write for Invoices & Purchases | Reactive Dexie cache reads; writes dispatched through server-side API functions with idempotency tokens |
| `_app.reports.tsx` | Naive derived calculations (`netProfit = grossProfit`) | Formal double-entry reporting: Day Book, Ledger Statement, Trial Balance, Real P&L, Balance Sheet, GST liability |
| `_app.backup.tsx` | Partial JSON export of 9 tables | Full cloud sync dashboard, JSON data export/import, and legacy `bms_db_v1` migration wizard |
| `_app.settings.tsx` | Singleton record in IndexedDB | Multi-company settings synced via Firebase Realtime Database with live multi-device propagation |
| `src/components/app/GlobalSearch.tsx` | Flat search navigating to root list pages | Deep-linking search palette navigating directly to `/companies/{companyId}/{module}/{id}` |

---

## 4. Proposed Firebase Realtime Database Schema

To prevent giant unbounded downloads and allow granular security rules, the database is normalized into discrete top-level trees.

```
/
├── users/
│   └── {uid}/
│       ├── email: string
│       ├── displayName: string
│       ├── phone?: string
│       ├── photoURL?: string
│       ├── active: boolean
│       ├── createdAt: number
│       └── updatedAt: number
│
├── companies/
│   └── {companyId}/
│       ├── name: string
│       ├── legalName: string
│       ├── tradingName?: string
│       ├── logoUrl?: string
│       ├── stampUrl?: string
│       ├── signatureUrl?: string
│       ├── gstin?: string
│       ├── pan?: string
│       ├── cin?: string
│       ├── email?: string
│       ├── phone?: string
│       ├── address: string
│       ├── city: string
│       ├── state: string
│       ├── pincode: string
│       ├── country: string
│       ├── currency: "INR"
│       ├── currencySymbol: "₹"
│       ├── stateCode: string
│       ├── bankDetails: { ... }
│       ├── upiDetails: { ... }
│       ├── docPrefixes: { invoice: "INV", quotation: "QT", receipt: "REC", purchase: "PUR", payment: "PAY", voucher: "JV" }
│       ├── currentFinancialYearId: string
│       ├── createdAt: number
│       └── createdBy: string
│
├── memberships/
│   └── {companyId}/
│       └── {uid}/
│           ├── role: "owner" | "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer"
│           ├── customPermissions?: string[]
│           ├── branchIds?: string[]
│           ├── status: "active" | "invited" | "suspended"
│           ├── joinedAt: number
│           └── invitedBy: string
│
├── userCompanies/
│   └── {uid}/
│       └── {companyId}: true
│
└── companyData/
    └── {companyId}/
        ├── financialYears/
        │   └── {fyId}/
        │       ├── name: string (e.g. "2026-2027")
        │       ├── startDate: number
        │       ├── endDate: number
        │       ├── locked: boolean
        │       └── createdAt: number
        │
        ├── branches/
        │   └── {branchId}/
        │       ├── name: string
        │       ├── code: string
        │       ├── gstin?: string
        │       ├── address?: string
        │       └── active: boolean
        │
        ├── warehouses/
        │   └── {warehouseId}/
        │       ├── name: string
        │       ├── code: string
        │       ├── branchId?: string
        │       └── active: boolean
        │
        ├── accountGroups/
        │   └── {groupId}/
        │       ├── name: string
        │       ├── parentGroupId?: string
        │       ├── nature: "asset" | "liability" | "equity" | "income" | "expense"
        │       └── isSystem: boolean
        │
        ├── ledgers/
        │   └── {ledgerId}/
        │       ├── name: string
        │       ├── groupId: string
        │       ├── openingBalance: number
        │       ├── openingBalanceType: "dr" | "cr"
        │       ├── currentBalance: number
        │       ├── gstin?: string
        │       ├── partyType?: "customer" | "supplier" | "bank" | "cash" | "general"
        │       ├── partyId?: string
        │       └── active: boolean
        │
        ├── vouchers/
        │   └── {voucherId}/
        │       ├── voucherNumber: string
        │       ├── voucherType: "journal" | "payment" | "receipt" | "contra" | "sales" | "purchase" | "debit_note" | "credit_note"
        │       ├── date: number
        │       ├── financialYearId: string
        │       ├── branchId?: string
        │       ├── reference?: string
        │       ├── narration: string
        │       ├── totalAmount: number
        │       ├── status: "posted" | "voided" | "reversed"
        │       ├── clientMutationId: string
        │       ├── createdAt: number
        │       └── createdBy: string
        │
        ├── voucherLines/
        │   └── {voucherId}/
        │       └── {lineId}/
        │           ├── ledgerId: string
        │           ├── type: "debit" | "credit"
        │           ├── amount: number
        │           └── narration?: string
        │
        ├── stockMovements/
        │   └── {movementId}/
        │       ├── productId: string
        │       ├── warehouseId: string
        │       ├── movementType: "opening" | "purchase" | "sale" | "sales_return" | "purchase_return" | "transfer_in" | "transfer_out" | "adjustment"
        │       ├── quantity: number
        │       ├── unitRate: number
        │       ├── sign: 1 | -1
        │       ├── referenceType: "invoice" | "purchase" | "adjustment" | "transfer"
        │       ├── referenceId: string
        │       ├── financialYearId: string
        │       ├── date: number
        │       └── createdAt: number
        │
        ├── customers/
        │   └── {customerId}/ { ...customer fields, ledgerId }
        │
        ├── suppliers/
        │   └── {supplierId}/ { ...supplier fields, ledgerId }
        │
        ├── products/
        │   └── {productId}/ { ...product fields, currentStock, reorderLevel }
        │
        ├── quotations/
        │   └── {quotationId}/ { ...full quotation model + snapshots }
        │
        ├── invoices/
        │   └── {invoiceId}/ { ...invoice fields, extraCharges, voucherId }
        │
        ├── purchases/
        │   └── {purchaseId}/ { ...purchase fields, voucherId }
        │
        ├── receipts/
        │   └── {receiptId}/ { ...receipt fields, voucherId, allocations }
        │
        ├── payments/
        │   └── {paymentId}/ { ...payment fields, voucherId, allocations }
        │
        ├── quotationMasters/
        │   ├── sizes/
        │   ├── termsTemplates/
        │   ├── generalInfoTemplates/
        │   ├── techSpecTemplates/
        │   ├── bankAccounts/
        │   └── quotationTemplates/
        │
        ├── docCounters/
        │   └── {financialYearId}/
        │       ├── invoice: number
        │       ├── quotation: number
        │       ├── receipt: number
        │       ├── purchase: number
        │       ├── payment: number
        │       └── voucher: number
        │
        └── auditLogs/
            └── {auditId}/
                ├── entityType: string
                ├── entityId: string
                ├── action: "create" | "update" | "delete" | "void" | "post"
                ├── performedBy: string
                ├── timestamp: number
                ├── previousState?: any
                └── newState?: any
```

---

## 5. Multi-Tenancy Strategy

1. **Strict Path-Level Isolation:**
   - Every operational data store is nested under `/companyData/{companyId}`.
   - Client applications never listen to the root `/companyData`; listeners are scoped strictly to the active `companyId`.

2. **Tenant Resolution Flow:**
   ```
   User logs in via Firebase Auth (UID)
               │
               ▼
   Fetch /userCompanies/{uid}
               │
   ┌───────────┴───────────────────────────┐
   │                                       │
   [1 Company Found]             [Multiple Companies Found]
   Auto-bind ActiveCompany        Redirect to /select-company
   Enter Workspace                User picks company -> Bind ActiveCompany
   ```

3. **Session Context:**
   - `ActiveCompanyContext` provides:
     - `currentCompany`: Company metadata & preferences.
     - `currentMembership`: User role and permissions in this company.
     - `financialYears`: Active and historical financial years.
     - `currentFinancialYearId`: Active working period.
     - `branches`: Available branches.
   - Switching companies clears active subscriptions, resets the Dexie active company cache segment, and mounts clean live listeners.

4. **Platform Administrator & Decoupled Access Flow:**
   - **Authoritative Platform Admin Identity:**
     - **Firebase UID (Authoritative):** `BOkCLXp08tVmRHICTArgpReVh5Y2`
     - **Metadata/Display Email:** `maaz@admin.com`
     - **Custom Claim:** `platformAdmin: true`
     *(Note: All access control and administrative validation is strictly executed against the Firebase Auth UID and cryptographic custom claims. The previous bootstrap identity `8Sqybhv41hhtuzcsN2JrMsnBdov2` / `khaisar@admin.com` has been completely superseded and stripped of all privileged access).*
   - **Architecture & Lifecycle:**
     1. Platform Administrator authenticates via Firebase Auth.
     2. With `platformAdmin === true` custom claim, the administrator accesses the dedicated `/system-admin` console even with 0 company memberships.
     3. The Platform Administrator creates organizations, assigns financial years and branches, and provisions initial company owners or accountants.
     4. Access writes are atomic:
        - `/memberships/{companyId}/{uid}` (`role`, `status: "active"`)
        - `/userCompanies/{uid}/{companyId}: true`
        - `/companySummaries/{companyId}`
     5. Tenant isolation: Platform Administrator does not have client-side access to tenant operational accounting data without an explicit membership.
     6. Client write blocking: `/memberships` and `/userCompanies` have `".write": false` in Firebase Security Rules, preventing client tampering or role elevation.

---

## 6. Authorization & Role-Based Permissions (RBAC)

### 6.1 Capabilities Matrix
Permissions are defined as discrete capabilities:
```ts
export type Capability =
  | "company.settings.read"
  | "company.settings.update"
  | "users.manage"
  | "accounting.voucher.read"
  | "accounting.voucher.create"
  | "accounting.voucher.void"
  | "accounting.ledger.read"
  | "accounting.ledger.manage"
  | "sales.read"
  | "sales.create"
  | "sales.update"
  | "sales.delete"
  | "purchase.read"
  | "purchase.create"
  | "purchase.update"
  | "inventory.read"
  | "inventory.adjust"
  | "reports.read"
  | "reports.financial";
```

### 6.2 Predefined System Roles
- **Owner:** Unrestricted access to all capabilities.
- **Admin:** All capabilities except company deletion and critical ownership reassignment.
- **Accountant:** Full access to Accounting, Sales, Purchase, Ledgers, Reports; read-only access to Company Settings.
- **Sales:** Read/create/update Quotations, Invoices, Customers, Receipts; read-only Products.
- **Purchase:** Read/create/update Purchase Bills, Suppliers, Payments; read-only Products.
- **Inventory Manager:** Products, Categories, Stock Adjustments, Warehouses, Transfers.
- **Viewer:** Read-only access to assigned modules.

### 6.3 Dual-Layer Enforcement
1. **Client Guard (`<Can capability="..." />` & `usePermission()`):** Hides forbidden UI actions, disables buttons, and intercepts route entrances.
2. **Server-Side Enforcement:** Every server endpoint validates the caller's Firebase ID token, verifies their active membership in `companyId`, and evaluates their capability before executing any mutation.

---

## 7. Accounting Architecture (Double-Entry Engine)

### 7.1 Core Accounting Invariant
$$\sum \text{Debits} = \sum \text{Credits}$$
Every financial transaction posts balanced debit and credit entries. An unbalanced voucher is rejected by the server and never committed.

### 7.2 Standard Chart of Accounts Foundation
On company creation or initialization, the following core groups and system ledgers are seeded:
- **Assets (Nature: Asset):**
  - Current Assets $\rightarrow$ Cash in Hand, Bank Accounts, Accounts Receivable (Customers), Inventory Asset.
- **Liabilities (Nature: Liability):**
  - Current Liabilities $\rightarrow$ Accounts Payable (Suppliers), Duties & Taxes (CGST Output, SGST Output, IGST Output, CGST Input, SGST Input, IGST Input, Round Off Account).
- **Equity (Nature: Equity):**
  - Capital Account, Retained Earnings.
- **Income (Nature: Income):**
  - Direct Income $\rightarrow$ Sales Account, Delivery/Extra Charges Income.
  - Indirect Income $\rightarrow$ Discount Received, Miscellaneous Income.
- **Expenses (Nature: Expense):**
  - Direct Expenses $\rightarrow$ Purchase Account, Freight & Transportation Inward.
  - Indirect Expenses $\rightarrow$ Rent, Salaries, Electricity, General Office Expense.

### 7.3 Automated Document-to-Voucher Mapping

#### 1. Sales Invoice (₹10,000 + 18% GST = ₹11,800)
- **Debit:** Customer Ledger (Accounts Receivable) ₹11,800
- **Credit:** Sales Account (Taxable Value) ₹10,000
- **Credit:** CGST Output (9%) ₹900
- **Credit:** SGST Output (9%) ₹900
*(Or IGST Output ₹1,800 for inter-state).*

#### 2. Customer Receipt (₹11,800 received in Bank)
- **Debit:** Bank Account Ledger ₹11,800
- **Credit:** Customer Ledger ₹11,800

#### 3. Purchase Bill (₹5,000 + 18% GST = ₹5,900)
- **Debit:** Purchase Account (Taxable Value) ₹5,000
- **Debit:** CGST Input (9%) ₹450
- **Debit:** SGST Input (9%) ₹450
- **Credit:** Supplier Ledger (Accounts Payable) ₹5,900

#### 4. Supplier Payment (₹5,900 via Bank)
- **Debit:** Supplier Ledger ₹5,900
- **Credit:** Bank Account Ledger ₹5,900

#### 5. Contra Voucher (₹2,000 cash deposited to Bank)
- **Debit:** Bank Account ₹2,000
- **Credit:** Cash in Hand ₹2,000

---

## 8. Stock Architecture (Stock Movement Ledger)

### 8.1 Transaction-Driven Movements
Stock is never modified by simply overwriting a number. Every inventory event generates a record in `/companyData/{companyId}/stockMovements`:
- **Invoice Issued:** `movementType = "sale"`, `sign = -1`
- **Invoice Cancelled / Voided:** `movementType = "sales_return"`, `sign = +1`
- **Purchase Received:** `movementType = "purchase"`, `sign = +1`
- **Purchase Return:** `movementType = "purchase_return"`, `sign = -1`
- **Warehouse Transfer:** Two movements: Warehouse A (`sign = -1`), Warehouse B (`sign = +1`).
- **Physical Stock Adjustment:** `movementType = "adjustment"`, delta recorded with audit reason.

### 8.2 Product Current Stock
The `Product.currentStock` field is maintained as a fast cached aggregate, updated transactionally when movements post. The Stock Summary report can re-calculate true stock at any historical point by summing movements up to that date.

---

## 9. Offline-First & Synchronization Architecture

### 9.1 The Role of Dexie.js
Dexie is repurposed as:
1. **Local High-Speed Cache:** Allows instant startup without waiting for network fetches.
2. **Offline Data Store:** Users can view customer lists, products, and past invoices without internet.
3. **Outbox Queue:** Queues mutations made while offline.

### 9.2 Outbox Queue Design
In Dexie:
```ts
interface OutboxMutation {
  id: string; // local UUID
  clientMutationId: string; // Idempotency key
  companyId: string;
  operation: "create_invoice" | "create_receipt" | "post_voucher" | "adjust_stock";
  payload: any;
  status: "pending" | "syncing" | "failed";
  error?: string;
  createdAt: number;
  retryCount: number;
}
```

### 9.3 Synchronization Lifecycle
```
User submits transaction
         │
         ▼
Write to Dexie Outbox (status: "pending")
Apply Optimistic UI Update in Local Cache
         │
         ▼
Are we Online? (navigator.onLine && RTDB connected)
   ├── NO  ──> Keep in outbox, display "Offline · 1 pending write"
   └── YES ──> Dispatch mutation to Server API
                    │
                    ├── Success ──> Server commits to Firebase RTDB
                    │               Firebase pushes live update to all clients
                    │               Remove mutation from Dexie outbox
                    │
                    └── Failure ──> Retry with exponential backoff
                                    If permanent error, rollback optimistic update & alert user
```

---

## 10. Server API & Execution Architecture

### 10.1 Server-Side Execution (TanStack Start / Nitro on Vercel)
Critical financial operations require server authorization and atomicity. We use TanStack Start server functions (`createServerFn`) and Nitro API routes backed by the **Firebase Admin SDK**.

### 10.2 Operations Managed Server-Side
1. **`postVoucher`:** Validates $\sum Dr = \sum Cr$, verifies active financial year, writes voucher and voucher lines.
2. **`createInvoice`:**
   - Transactionally increments document sequence counter (`docCounters/{fyId}/invoice`).
   - Generates formatted invoice number (e.g. `INV/2026-27/0001`).
   - Writes invoice record.
   - Writes balanced double-entry voucher.
   - Writes stock movements.
   - Updates customer balance.
3. **`createPurchase`:** Allocates purchase number, writes purchase bill, voucher, and stock increments.
4. **`createReceipt` & `createPayment`:** Allocates sequence number, updates invoice/bill balances, posts voucher.
5. **`voidDocument` / `reverseVoucher`:** Handles accounting reversal without hard deleting historical records.

### 10.3 Idempotency Guarantee
Every server mutation requires a `clientMutationId`. The server checks if `clientMutationId` has already been processed within the company. If so, it returns the existing document without re-executing stock or ledger writes.

---

## 11. Cloudflare R2 Binary Storage Architecture

### 11.1 Abstraction Interface
```ts
export interface FileStorageProvider {
  createPresignedUpload(params: {
    key: string;
    contentType: string;
    companyId: string;
  }): Promise<{ uploadUrl: string; publicUrl: string }>;
  
  deleteFile(key: string): Promise<boolean>;
}
```

### 11.2 Storage Separation
- **Firebase Realtime Database:** Stores only file metadata (fileId, key, publicUrl, fileName, mimeType, sizeBytes, uploadedBy, timestamp).
- **Cloudflare R2:** Stores actual binary bytes (images, logos, stamps, signatures, attachments).
- **Graceful Fallback:** If R2 credentials are not yet entered in `.env`, the system operates with standard fallback placeholders and disables binary upload UI with a helpful "Storage not configured" notice.

---

## 12. Legacy Data Migration Strategy (`bms_db_v1` $\rightarrow$ Cloud)

1. **Detection:**
   - On startup, the system inspects `indexedDB.databases()` for the legacy `bms_db_v1` database.
   - If detected and records exist, a non-intrusive alert appears in the Settings $\rightarrow$ Migration tab.

2. **Migration Wizard:**
   - **Step 1 — Entity Scan:** Summarizes local counts (Customers, Suppliers, Products, Invoices, Quotations, Receipts, Purchases, Masters).
   - **Step 2 — Company Mapping:** User selects or creates the destination Firebase company.
   - **Step 3 — Ledger & Financial Year Setup:** Automatically creates opening financial years and creates ledger accounts for each migrated customer and supplier.
   - **Step 4 — Validation & Upload:** Validates records with Zod, writes documents into the target company, and posts matching vouchers and stock movements.
   - **Step 5 — Complete:** Flags migration as completed in `localStorage` without deleting local Dexie data (preserving it as an offline archive).

---

## 13. Route Structure & Deep Linking

```
/login                                     # Firebase email/password sign-in & password reset
/select-company                            # Multi-company switcher & company creation
/invite/$token                             # Accept team member invitation

/_app                                      # Protected Application Shell (ActiveCompanyContext)
  /                                        # Executive Dashboard (Realtime KPIs, P&L, Cash Flow)
  /sales/
    /sales/quotations                      # Quotations list & filters
    /sales/quotations/$id                  # Quotation detail & vector print/share
    /sales/quotations/new                  # Multi-tab quotation creator
    /sales/invoices                        # GST Invoices list
    /sales/invoices/$id                    # Invoice detail & deep link
    /sales/invoices/new                    # Create Invoice (from scratch or quote)
    /sales/customers                       # Customer directory
    /sales/customers/$id                   # Customer statement & ledgers
  /purchase/
    /purchase/bills                        # Purchase bills list
    /purchase/bills/$id                    # Purchase bill detail
    /purchase/bills/new                    # Record purchase
    /purchase/suppliers                    # Supplier directory
    /purchase/suppliers/$id                # Supplier statement & payables
  /inventory/
    /inventory/items                       # Product catalog & stock counts
    /inventory/items/$id                   # Item ledger & movement history
    /inventory/categories                  # Categories master
    /inventory/warehouses                  # Warehouse / Godown master
    /inventory/transfers                   # Warehouse stock transfer
    /inventory/adjustments                 # Stock adjustments with audit reason
  /accounting/
    /accounting/vouchers                   # Journal, Contra, Debit/Credit Notes
    /accounting/vouchers/$id               # Voucher detail
    /accounting/receipts                   # Inbound customer payments & allocations
    /accounting/payments                   # Outbound supplier/expense payments
    /accounting/ledgers                    # Chart of Accounts & Individual Ledgers
    /accounting/ledgers/$id                # Ledger Statement (Running Balance)
    /accounting/banking                    # Bank accounts & reconciliation
  /reports/
    /reports/day-book                      # Chronological Day Book
    /reports/ledger                        # Ledger statement report
    /reports/trial-balance                 # Realtime Trial Balance (Debit = Credit)
    /reports/profit-and-loss               # Full P&L (Revenue - COGS - Expenses)
    /reports/balance-sheet                 # Balance Sheet (Assets = Liabilities + Equity)
    /reports/cash-flow                     # Cash & Bank movements
    /reports/stock-summary                 # Stock valuation & movement summary
    /reports/receivables                   # Aging Receivables (0-30, 31-60, 61-90, 90+)
    /reports/payables                      # Aging Payables
    /reports/gst                           # GSTR-1 & GSTR-3B tax summaries
  /settings/
    /settings/company                      # Company profile, GSTIN, bank, branding
    /settings/financial-years              # Financial year manager & closing periods
    /settings/branches                     # Branch management
    /settings/users                        # User memberships & permissions
    /settings/quotation-masters            # Sizes, Terms, Specs, Templates
    /settings/migration                    # Legacy Dexie bms_db_v1 importer
```

---

## 14. Target Folder Structure

```
src/
├── config/
│   ├── env.ts                        # Type-safe environment variable validation
│   └── firebase.ts                   # Client Firebase SDK initialization (Auth, RTDB)
│
├── modules/
│   ├── auth/                         # Firebase authentication domain
│   │   ├── components/               # LoginForm, PasswordResetModal, AuthGuard
│   │   ├── hooks/                    # useAuth, useSession
│   │   └── services/                 # authService.ts
│   ├── company/                      # Multi-tenancy & company context
│   │   ├── components/               # CompanySwitcher, FinancialYearPicker
│   │   ├── context/                  # ActiveCompanyContext.tsx
│   │   └── services/                 # companyService.ts
│   ├── accounting/                   # Double-entry engine
│   │   ├── engine/                   # voucherEngine.ts, doubleEntryValidator.ts
│   │   ├── components/               # VoucherForm, LedgerViewer, AccountSelector
│   │   └── services/                 # accountingService.ts, bankingService.ts
│   ├── sales/                        # Sales, Quotations, Invoices, Customers
│   │   ├── components/               # InvoiceForm, QuotationForm, CustomerModal
│   │   ├── export/                   # quotationExport.ts (vector PDF/Word engine)
│   │   └── services/                 # salesService.ts, customerService.ts
│   ├── purchase/                     # Purchases, Suppliers, Debit Notes
│   │   ├── components/               # PurchaseForm, SupplierModal, PaymentModal
│   │   └── services/                 # purchaseService.ts, supplierService.ts
│   ├── inventory/                    # Stock movement ledger, Warehouses
│   │   ├── components/               # ItemForm, WarehouseModal, StockTransferModal
│   │   └── services/                 # stockService.ts, warehouseService.ts
│   ├── reports/                      # Accounting & business reports
│   │   ├── components/               # DayBookTable, TrialBalanceTable, PnLReport
│   │   └── services/                 # reportEngine.ts
│   ├── sync/                         # Offline-first Dexie cache & outbox
│   │   ├── dexieCache.ts             # Local cache schema & tables
│   │   ├── outboxManager.ts          # Mutation queue & retry dispatcher
│   │   └── useSyncStatus.ts          # Connection status & sync indicator hook
│   ├── storage/                      # Cloudflare R2 file storage
│   │   ├── fileStorage.ts            # Provider interface & R2 implementation
│   │   └── useFileUpload.ts          # Upload hook with progress
│   └── migration/                    # Legacy Dexie bms_db_v1 importer
│       ├── legacyScanner.ts          # Reads old bms_db_v1 records
│       └── migrationWizard.tsx       # Multi-step cloud upload wizard
│
├── server/                           # Server-side API & Firebase Admin logic
│   ├── firebaseAdmin.ts              # Firebase Admin SDK initialization
│   ├── middleware/                   # authMiddleware.ts (verify ID token & membership)
│   └── functions/                    # createInvoiceFn, postVoucherFn, numberingFn
│
├── components/
│   ├── app/                          # AppShell, Topbar, Sidebar, GlobalSearch
│   └── ui/                           # Radix / shadcn UI primitives
│
├── lib/
│   ├── calc.ts                       # Core mathematical & tax calculation invariants
│   ├── format.ts                     # Indian currency, dates, and number-to-words
│   └── utils.ts                      # CSS class utilities
│
└── routes/                           # TanStack Router route tree
```

---

## 15. Implementation Phases

```
Phase 1: Foundation (Current Priority)
├── Environment setup & validation (.env, .env.example, .gitignore)
├── Firebase Client SDK & Auth initialization
├── Firebase Admin server configuration
├── Multi-company data model & ActiveCompanyContext
├── Dexie Cache + Outbox synchronization manager
├── App Shell & Grouped Navigation redesign
├── Firebase Realtime Database Security Rules
└── Cloudflare R2 Storage abstraction & fallback

Phase 2: Accounting Engine Core
├── Account groups & Chart of Accounts seed
├── Ledger master & statement generator
├── Voucher engine (Journal, Payment, Receipt, Contra)
├── Concurrency-safe atomic document numbering
└── Double-entry verification & audit logging

Phase 3: Sales, Purchases & Document Connectivity
├── Customer & Supplier masters linked to Ledgers
├── Quotation module integration & vector export preservation
├── GST Invoices with extra charges & automated ledger/stock posting
├── Purchase bills with automated payable/input GST/stock posting
└── Debit & Credit notes

Phase 4: Stock Movement Ledger & Warehouses
├── Stock movements ledger (auditable movement history)
├── Multi-warehouse support & stock transfers
├── Stock adjustments with reason tracking
└── Batch & Expiry date foundation

Phase 5: Financial Reports & Banking
├── Day Book & Ledger Statement
├── Trial Balance (Debit = Credit verification)
├── Accurate Profit & Loss (Revenue - COGS - Expenses = Net Profit)
├── Balance Sheet & Cash Flow
├── GSTR-1 & GSTR-3B tax summaries
└── Bank reconciliation workflow

Phase 6: Advanced Orders & Manufacturing
├── Sales Orders & Purchase Orders
├── Delivery Notes & Goods Receipts
└── Bill of Materials (BOM) & Production entries

Phase 7: Modular Payroll
├── Employee directory & salary structures
├── Attendance tracking
└── Automated payroll journal entry posting
```

---

## 16. Technical & Operational Risks and Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Network interruptions during write** | Potential duplicate invoices or vouchers created | Idempotency tokens (`clientMutationId`) checked on the server before processing transactions. |
| **Concurrent invoice creation** | Two users receiving the same invoice number | Server-side atomic counter increment in Firebase RTDB (`docCounters/{fyId}/...`). |
| **Unbalanced accounting entries** | Corrupted Trial Balance and broken P&L | Hard server validation: rejects any voucher where $\sum Dr \ne \sum Cr$. |
| **Excessive RTDB bandwidth consumption** | High costs and slow mobile load times | Scoped listeners only on active screens; pagination for large lists; heavy binary files routed to R2. |
| **Stale local Dexie cache** | User seeing outdated data after returning online | Versioned cache records with server timestamps; real-time listener overwrite on reconnection. |
| **Missing Cloudflare R2 credentials** | Upload failures crashing document creation | Storage abstraction returns clear "Storage not configured" notice without blocking document saves. |

---

## 17. Security Architecture

1. **Client Credential Isolation:**
   - Client `.env` exposes only `VITE_FIREBASE_*` public API keys.
   - Firebase Admin credentials (`FIREBASE_ADMIN_PRIVATE_KEY`) and R2 secrets remain strictly server-side.
2. **Server-Side Token Verification:**
   - Every API call sends `Authorization: Bearer <idToken>`.
   - Server decodes token, resolves `auth.uid`, and checks `/memberships/{companyId}/{uid}` before executing queries.
3. **Database Security Rules (`database.rules.json`):**
   - No public reads or writes (`".read": false, ".write": false` at root).
   - `/companyData/{companyId}` requires `root.child('memberships').child($companyId).child(auth.uid).exists()`.
4. **Audit Trails:**
   - Every critical mutation writes to `/companyData/{companyId}/auditLogs` with user ID, timestamp, and action details.

---

## 18. Accounting Integrity Considerations

1. **No Destructive Financial Deletions:**
   - Invoices, purchases, and vouchers cannot be physically deleted once posted.
   - Cancellation requires issuing a **reversal voucher** or marking status as `voided` with audit reason.
2. **Auditability:**
   - Modifying a document creates a revision history.
3. **Closed Financial Years:**
   - Past financial years can be flagged as `locked = true`, preventing any new vouchers or edits in that date range.
4. **Single Source of Financial Truth:**
   - Outstanding customer balances are computed directly from the ledger or updated via atomic increments, avoiding drift between customer records and accounting ledgers.

---

## 19. Exact Files to be Created or Modified

### Files Created in Phase 1
- `.env` & `.env.example` — Client & server environment configuration.
- `database.rules.json` — Firebase Realtime Database multi-tenant security rules.
- `src/config/env.ts` — Type-safe environment parser.
- `src/config/firebase.ts` — Firebase client app, auth, and database initialization.
- `src/server/firebaseAdmin.ts` — Firebase Admin SDK initialization.
- `src/server/authMiddleware.ts` — Server-side token verification and membership guard.
- `src/modules/auth/context/AuthContext.tsx` — Global Firebase auth state provider.
- `src/modules/auth/hooks/useAuth.ts` — Auth helper hook.
- `src/modules/company/context/ActiveCompanyContext.tsx` — Multi-company state provider.
- `src/modules/company/components/CompanySwitcher.tsx` — Dropdown for switching company context.
- `src/modules/sync/dexieCache.ts` — Multi-company Dexie cache schema and outbox table.
- `src/modules/sync/outboxManager.ts` — Mutation queue processor.
- `src/modules/storage/fileStorage.ts` — FileStorageProvider abstraction.
- `src/routes/select-company.tsx` — Multi-company selection page.

### Files Modified in Phase 1
- `.gitignore` — Ignore `.env` and `.env.*`, allow `!.env.example`.
- `package.json` — Add `firebase`, `firebase-admin`, `@aws-sdk/client-s3`.
- `src/routes/_app.tsx` — Integrate `AuthContext` and `ActiveCompanyContext`.
- `src/routes/login.tsx` — Real Firebase email/password sign-in.
- `src/components/app/Sidebar.tsx` — Add company switcher and restructured domain navigation.
- `src/components/app/Topbar.tsx` — Add company name, financial year selector, and user avatar.

---

## 20. Dependency Changes

### Packages to Install:
1. `firebase` (`^11.4.0` or latest) — Client SDK for Authentication and Realtime Database.
2. `firebase-admin` (`^13.1.0` or latest) — Server-side token verification, atomic transactions, and administrative tasks.
3. `@aws-sdk/client-s3` & `@aws-sdk/s3-request-presigner` (`^3.750.0`) — S3-compatible client for Cloudflare R2 presigned uploads.

### Existing Packages Retained:
- React 19, TanStack Start, TanStack Router, TanStack Query, Tailwind CSS v4, shadcn/Radix components, Dexie.js (`^4.4.4`), `dexie-react-hooks`, `jspdf`, `jspdf-autotable`, `docx`, `lucide-react`, `zod`.

---

*End of Implementation Plan. Ready for Phase 1 execution.*
