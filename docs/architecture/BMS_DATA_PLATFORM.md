# BMS NEXT — Multi-Tenant Architecture & Data Platform Specification

> **Status:** Authoritative Architecture Reference  
> **Scope:** Multi-Tenant Hierarchy, Branch Scoping, Access Control, Sales Returns / Credit Notes, Persistence & Future Portability  
> **Audience:** Core Engineers, AI Coding Agents, Security Auditors, Financial Systems Designers  

---

## 1. Executive Summary & Stack Overview

BMS NEXT is an enterprise-grade, offline-first multi-tenant ERP platform architected for distributed commercial operations, statutory GST compliance, and double-entry accounting integrity.

### Active Technology Stack (CURRENT IMPLEMENTATION)
- **Frontend Core:** React 19, TypeScript 5.8+, TanStack Router, TanStack Start
- **Design & UI System:** Tailwind CSS, Shadcn UI / Radix Primitives, Lucide Icons
- **Local Persistence & Offline Cache:** IndexedDB via Dexie.js (BizDB Version 7 + Dexie Cache Version 4)
- **Offline Synchronization:** Optimistic Outbox Queue (`outboxManager`), Last-Write-Wins with Authoritative Server Reconciliation
- **Identity & Authentication:** Firebase Auth (JWT verification, custom claims, session revocation)
- **Primary Operational Database:** Firebase Realtime Database (RTDB) with Company-Scoped Security Rules & Compound Indexes
- **Privileged Backend Authorizer:** Firebase Admin SDK running in server functions / API routes
- **Unstructured Asset Store:** Cloudflare R2 / AWS S3 SDK (PDF invoices, vouchers, credit notes, receipts)
- **Document Engine:** jsPDF with jspdf-autotable, unified `NormalizedDocument` presentation model

---

## 2. Multi-Tenant Hierarchy

BMS NEXT enforces an immutable multi-tier access and data hierarchy:

```
PLATFORM ADMIN (System Infrastructure, Company Creation, Global Audits)
    │
    ▼
ORGANIZATION / COMPANY (Legal Entity, GST Profile, Base Financial Year)
    │
    ▼
ORGANIZATION OWNER (Sole Branch Creator, Company Settings, Team Roles)
    │
    ├── ORGANIZATION-WIDE MASTERS (Shared Centrally)
    │   ├── Product Master (SKU, HSN, Base Rates, UOM)
    │   ├── Party Master (Customers, Suppliers, Shipping Addresses)
    │   ├── Category Master & Sizes
    │   ├── Document Terms & Signatory Profiles
    │   └── Master Chart of Accounts (Groups)
    │
    ▼
OPERATING BRANCHES (Isolated Operational Workspaces)
    │   ├── Main Branch / Head Office (Default Billing, Contact Fallback)
    │   └── Operating Branches (Branch Code, Local GSTIN Override, Overrides)
    │
    ▼
USERS & GRANULAR MODULE PERMISSIONS
    │   ├── Branch Assignment (All Branches OR Explicit Branch Allowlist)
    │   └── 30+ Granular Permissions (Module-Grouped: Sales, Purchase, Inventory, Financials, Admin)
    │
    ▼
BRANCH-SCOPED OPERATIONAL TRANSACTIONS & REPORTS
    ├── Quotations & Estimates
    ├── Sales Invoices & Line Snapshots
    ├── Sales Returns & Credit Notes
    ├── Customer Payment Receipts & Inflows
    ├── Purchase Bills & Vendor Payments
    ├── Branch-Specific Inventory Movements & Stock Balances
    └── Double-Entry Vouchers (Ledgers, Trial Balance, Day Book)
```

### Hierarchy Rules & Separation of Concerns
1. **Platform Admin vs. Organization Owner:**
   - **Platform Admin:** Platform management, tenant provisioning, system health. Has **no automatic operational access** to company financial ledgers or branch documents unless granted explicit, audited membership.
   - **Organization Owner (`role == 'owner'`):** Sole authority to create branches, deactivate branches, designate the Main Branch, and configure branch user memberships.
2. **Organization Isolation is Absolute:**
   - Database rules and server authorizers verify `membership.companyId === targetCompanyId`. Cross-tenant data leakage is structurally impossible.
3. **Branch Isolation within an Organization:**
   - Users assigned to Branch A cannot view, query, or mutate operational records belonging to Branch B unless their membership grants multi-branch or all-branch access.
   - Organization Owner always maintains consolidated visibility across all branches.

---

## 3. Data Architecture & Entity Ownership

### 3.1 Organization-Wide Masters (Shared Centrally)
Masters are maintained at the organization level so business owners do not need to duplicate products, parties, or categories nine times across nine branches:
- **Product Master (`companyData/$orgId/products`):** SKU, description, standard sizes, base rates, GST rates, HSN codes.
- **Party Master (`companyData/$orgId/customers`, `suppliers`):** Legal names, PAN, billing/shipping addresses, GSTINs.
- **Chart of Account Groups (`companyData/$orgId/accountGroups`):** Sundry Debtors, Sundry Creditors, Direct Expenses, Bank Accounts.

### 3.2 Branch-Scoped Operations
All operational transactions carry both `companyId` and `branchId`:
- `companyData/$orgId/invoices/$invoiceId` (`branchId: string`)
- `companyData/$orgId/salesReturns/$returnId` (`branchId: string`)
- `companyData/$orgId/creditNotes/$creditNoteId` (`branchId: string`)
- `companyData/$orgId/quotations/$quotationId` (`branchId: string`)
- `companyData/$orgId/receipts/$receiptId` (`branchId: string`)
- `companyData/$orgId/purchases/$purchaseId` (`branchId: string`)
- `companyData/$orgId/payments/$paymentId` (`branchId: string`)
- `companyData/$orgId/vouchers/$voucherId` (`branchId: string`)
- `companyData/$orgId/inventoryMovements/$movementId` (`branchId: string`)

### 3.3 Branch Settings Inheritance & 3-Tier Resolution
By default, new branches inherit company settings without duplicating records. Each section provides an explicit `useCompanyDefault` toggle:

$$\text{Final Value} = \text{Document Override} \longrightarrow \text{Branch Override (when toggle OFF)} \longrightarrow \text{Company Default}$$

Configurable inherited sections:
1. **General Information:** Markdown/structured content with `useCompanyGeneralInfoDefault`.
2. **Technical Specifications:** Markdown/structured specifications with `useCompanyTechSpecsDefault`.
3. **Quotation & Invoice Terms:** Separate quotation and invoice terms with `useCompanyTermsDefault`.
4. **Bank Details:** Account holder, account number, IFSC, bank name, account type, UPI, SWIFT with `useCompanyBankDefault`.
5. **Signatory & Stamp:** Authorized signatory name, designation, signature image/cursive style, company stamp with `useCompanySignatoryDefault`.
6. **Contact Details & Address:** Local operating address, phone, email, pincode with `useCompanyContactDefault`.
7. **Document Numbering Prefixes:** Independent FY-atomic sequences (e.g. `QT/BLR/2026-27/0001` vs `QT/HOS/2026-27/0001`).

Resolution helper: `resolveBranchCompanyContext(company, branch)` in `src/modules/company/types.ts`.

### 3.4 Branch Document Identity & Finalized Snapshot Immutability
- When generating documents within a branch, the header displays the **Branch Document Display Name** (e.g., `KH Portable Cabins — Bangalore`) and local branch address/contact details while strictly preserving the canonical organization legal entity name (`company.legalName`) and GST registration identity where required.
- **Posting Immutability Invariant:** Upon posting or finalization, documents capture and freeze the resolved `branchSnapshot`, `companySnapshot`, and `signatorySnapshot`.
- Future modifications to Company Defaults or Branch Overrides **never mutate issued historical documents**.

---

## 4. Security & Authorization Architecture

### 4.1 Authoritative Authorization Chain
Client-supplied `companyId` and `branchId` from HTTP payloads or form data are **never trusted**. Every server mutation enforces:
```
Firebase ID Token (Bearer Header)
      │
      ▼
Verify Decoded UID via Firebase Admin
      │
      ▼
Fetch Membership: /memberships/{companyId}/{uid}
      │
      ├─► Validate Status == 'active'
      ├─► Validate Role (Owner has universal bypass within organization)
      │
      ▼
Branch Access Check: hasBranchAccess(membership, targetBranchId)
      │
      ▼
Granular Permission Check: hasBranchPermission(membership, targetBranchId, requiredPermission)
      │
      ▼
Authoritative Server Mutation Executed
```

### 4.2 Branch Creation Exclusivity
- **Rule:** Exclusively `role === 'owner'` can create, delete, or deactivate branches, or designate the Main Branch.
- **Enforcement:**
  - Database Rules: `companyData/$companyId/branches` `.write` evaluates `root.child('memberships/' + $companyId + '/' + auth.uid + '/role').val() == 'owner'`.
  - Server Authorizer: `FirebaseBranchRepository.createBranch` explicitly inspects caller role and rejects non-owners with `FORBIDDEN`.
  - Non-Assignable: `BRANCH_CREATE` is strictly excluded from `CANONICAL_PERMISSIONS` and cannot be assigned to any manager or admin.

### 4.3 Organization Owner User Provisioning Flow
- **Server-Authoritative Creation:** Organization Owners create/invite team members through `createCompanyUserServerFn` powered by Firebase Admin SDK (`adminApp.auth().getUserByEmail` / `createUser`).
- **Owner Role Invariant:** The `owner` role is strictly non-assignable through user management dialogs. Normal user creation dropdowns restrict roles to `admin`, `accountant`, `sales`, `purchase`, `inventory`, `viewer`, and `custom`. Legitimate ownership changes must pass through formal ownership transfer workflows.
- **Branch Access Scopes:**
  1. *Specific Branch:* User is bound to a single immutable `branchId` (e.g. Bangalore Branch only).
  2. *Multiple Branches:* User has explicit memberships across a defined list of branch IDs (e.g. Bangalore + Mysore).
  3. *All Branches:* User has organization-wide visibility across all branches (e.g. Finance Head, Auditor).
- **Moving Users Between Branches:** When an Owner updates a user's branch membership, old branch operational access is immediately revoked, and new branch access is granted. Realtime listeners rebind seamlessly without page reload. **CRITICAL:** Moving a user never alters historical transactions; past invoices, receipts, and vouchers remain attached to the branch where they were created.
- **Granular Access Editor:** Permissions are configured via clean functional groups (`OVERVIEW`, `SALES`, `PURCHASE`, `INVENTORY`, `FINANCIALS`, `MASTERS`) with role presets (`ROLE_PRESET_MODULES`) rather than raw permission strings.
- **Status Lifecycle:** Owners can deactivate (`setUserMembershipStatusServerFn`) or reactivate members. Inactive users are instantly blocked across all branches. Demoting or deactivating an Organization Owner is structurally forbidden.

---

## 5. Sales Return & Credit Note Architecture

### 5.1 Business Workflow
When goods are returned or billed amounts are adjusted:
1. **Posted Invoices Remain Strictly Immutable:** Original invoices are never edited, deleted, or backdated.
2. **Authoritative Sales Return Record:** Created in `companyData/$orgId/salesReturns/$returnId`.
3. **Formal Credit Note Document:** Created with canonical document numbering (`CN-XXXX`) and frozen line snapshots.
4. **Cumulative Return Quantity Limit:** For any line item, $\sum \text{ReturnQty} \le \text{OriginalInvoicedQty}$. Server checks all historical non-reversed returns for that invoice.

### 5.2 Double-Entry Accounting Invariant
Every posted Sales Return generates a balanced journal voucher (`executePostVoucher`):

$$\begin{aligned}
\text{Debit:} & \quad \text{Sales Return / Revenue Reversal} & \text{(₹ Taxable Amount)} \\
\text{Debit:} & \quad \text{Output GST Reversal (CGST/SGST or IGST)} & \text{(₹ Tax Amount)} \\
\text{Credit:} & \quad \text{Customer / Accounts Receivable} & \text{(₹ Total Credit Amount)}
\end{aligned}$$

$$\sum \text{Debits (Paise)} \equiv \sum \text{Credits (Paise)}$$

### 5.3 AR Reduction vs. Customer Credit
- **Unpaid / Partially Paid Invoice:** The Credit Note reduces the customer's outstanding balance on that invoice and ledger.
- **Fully Paid Invoice:** The Credit Note creates **Customer Credit Available** (`customerCreditGeneratedPaise`), which is tracked separately and can be allocated against future invoices or refunded.

### 5.4 Authoritative Inventory Restock
When goods are returned, the user designates the restock disposition:
1. `RESTOCK_SALEABLE`: Creates an inbound stock movement (`IN`) to saleable branch stock.
2. `RESTOCK_DAMAGED`: Creates a stock movement tagged for quarantine/inspection.
3. `FINANCIAL_CREDIT_ONLY`: No stock movement created (e.g., price correction or customer retained goods).

### 5.5 GST Compliance & Frozen Snapshots
- Tax adjustment uses the **frozen tax rates, HSN codes, and place of supply** from the original invoice lines.
- Recalculating using today's changed Product Master rates is prohibited.
- Preserves Intra-State (CGST + SGST) vs. Inter-State (IGST) split.

---

## 6. Offline-First & Realtime Isolation

### 6.1 Realtime Listeners & Branch Switching
When switching branch context in `ActiveCompanyContext`:
1. Unsubscribe previous branch-specific realtime listeners.
2. Render immediate UI skeleton (preventing any visual flash of the previous branch's metrics).
3. Hydrate authorized branch data from Dexie local cache.
4. Attach targeted realtime listeners to Firebase RTDB for the new active branch.

### 6.2 Dexie (IndexedDB) Multi-Branch Storage
Dexie `BizDB` Version 7 and `bms_cache` Version 4 maintain compound indices:
- `invoices`: `id, companyId, branchId, date, [companyId+branchId]`
- `salesReturns`: `id, companyId, branchId, originalInvoiceId, date, [companyId+branchId]`
- `creditNotes`: `id, companyId, branchId, salesReturnId, date, [companyId+branchId]`
- `quotations`: `id, companyId, branchId, date, [companyId+branchId]`
- `receipts`: `id, companyId, branchId, date, [companyId+branchId]`
- `purchases`: `id, companyId, branchId, date, [companyId+branchId]`
- `payments`: `id, companyId, branchId, date, [companyId+branchId]`

Queries always scope to `[companyId, activeBranchId]`. Visual-only client filtering after loading all records is prohibited.

### 6.3 Realtime Access Revocation & Dynamic Context Rebinding
- When an Organization Owner updates user access (moving a user between branches, toggling permissions, or deactivating a membership):
  1. Changes are committed server-authoritatively via RTDB `memberships/{companyId}/{uid}` and audit trails.
  2. Authorized connected client devices receive the membership update via existing realtime listeners without requiring a manual page refresh.
  3. If access to the currently viewed branch is revoked or the user is deactivated, `ActiveCompanyContext` invalidates active branch state, purges inaccessible operational records from active memory, and rebinds queries to the user's remaining permitted branch (or displays the unauthorized notice).
  4. Cached unauthorized records from the previous branch are instantly evicted from the active views to guarantee zero security leakage.

---

## 7. Future Database Portability (CURRENT vs. FUTURE)

To allow future migration to Postgres (Supabase) or MongoDB without rewriting business logic, domain boundaries are isolated via repository interfaces:

| Domain | Interface | CURRENT IMPLEMENTATION | FUTURE OPTION |
| :--- | :--- | :--- | :--- |
| **Branch Management** | `IBranchRepository` | `FirebaseBranchRepository` | `PostgresBranchRepository` / `MongoBranchRepository` |
| **User & Access** | `IMembershipRepository` | `FirebaseMembershipRepository` | `PostgresMembershipRepository` / `MongoMembershipRepository` |
| **Sales Returns** | `ISalesReturnRepository` | `FirebaseSalesReturnRepository` | `PostgresSalesReturnRepository` / `MongoSalesReturnRepository` |
| **Accounting Engine** | `IVoucherRepository` | Firebase RTDB integer paise | Postgres double-entry ledger table |
| **Unstructured Files** | `IFileStore` | Cloudflare R2 / S3 Presigned | S3 / MinIO / Supabase Storage |

> **Crucial Rule:** Firebase remains the sole active production persistence engine today. Supabase and MongoDB adapters are **NOT** implemented in this phase. Code in UI components interacts only with repositories or server functions, never with raw database paths directly.

---

## 8. Audit Logging Reference

Audit events are logged immutably under `companyData/$orgId/auditLogs/$auditId`:
- `BRANCH_CREATED`: Logged when Owner creates a new branch.
- `BRANCH_UPDATED`: Logged when branch details/overrides change.
- `BRANCH_DEACTIVATED`: Logged when a branch is deactivated.
- `MAIN_BRANCH_CHANGED`: Logged when the organization Main Branch is promoted.
- `USER_ACCESS_GRANTED`: Logged when a user is assigned branch access.
- `PERMISSION_CHANGED`: Logged when granular module permissions are modified.
- `SALES_RETURN_POSTED`: Logged when a Sales Return and Credit Note are posted with double-entry voucher.
- `SALES_RETURN_REVERSED`: Logged if an authorized reversal occurs.
