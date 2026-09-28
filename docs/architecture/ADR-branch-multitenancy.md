# Architecture Decision Record (ADR): Multi-Branch Tenancy, Granular Access Control & Sales Returns

- **Status:** Approved & Implemented
- **Date:** 2026-09-28
- **Context:** BMS NEXT Multi-Tenant Scaling Phase

---

## 1. Context and Problem Statement

BMS NEXT previously supported a two-tier tenancy model:
$$\text{Platform} \longrightarrow \text{Organization} \longrightarrow \text{Users}$$

Growing mid-market enterprises require multi-location operations (e.g. Head Office in Hoskote, manufacturing facility, regional sales hubs in Bangalore and Mysore). These organizations require:
1. Operational branch autonomy (branch-specific quotations, invoices, receipts, stock).
2. Centralized administrative control (single product catalog, shared customer directory).
3. Strict data isolation between branches for field staff.
4. Consolidated financial visibility across all locations for the business owner.
5. Authoritative handling of customer returns and credit notes without altering posted invoices.

---

## 2. Decision Outcomes

### Decision 1: Branch Positioned Strictly Below Organization
- **Choice:** `Platform → Organization → Branches → Users / Permissions → Transactions / Reports`.
- **Rationale:** A commercial company is the legal entity with the PAN and base business registration. Branches are operating locations of that single company. Treating branches as separate organizations would fragment the customer base and product catalog, making consolidated balance sheets and owner oversight cumbersome.

### Decision 2: Branch Creation Exclusively Restricted to Organization Owner
- **Choice:** Only users with `role == 'owner'` can create, deactivate, or modify branches.
- **Rationale:** Creating a new commercial branch carries legal, tax, and commercial liabilities. It should never be an assignable privilege delegated to branch managers or sales admins. The capability `BRANCH_CREATE` is intentionally excluded from the assignable `CANONICAL_PERMISSIONS` list.

### Decision 3: Organization-Wide Masters vs. Branch-Scoped Transactions
- **Choice:**
  - **Organization Masters:** Products, Customers, Suppliers, Category Master, UOM, Accounting Group structure.
  - **Branch Transactions:** Invoices, Quotes, Receipts, Purchases, Returns, Vouchers, Stock movements.
- **Rationale:** Prevents duplicate entry of products and parties. A customer who purchases from Branch A can settle or receive delivery from Branch B without re-creating their profile.

### Decision 4: Single Authoritative Main Branch per Organization
- **Choice:** Every organization designates exactly one active Main Branch (Head Office).
- **Rationale:** Provides unambiguous fallback for billing location, contact information, and default document context when branch-specific overrides are omitted.

### Decision 5: Immutability of Posted Documents
- **Choice:** Posted invoices are strictly immutable. Customer returns must be executed via separate Sales Return / Credit Note records.
- **Rationale:** In Indian GST law and canonical accounting principles, altering or deleting a finalized tax invoice violates statutory audit standards. Credit Notes preserve the audit trail and provide authoritative reference to the original tax invoice.

### Decision 6: Double-Entry Balancing of Sales Returns
- **Choice:** Every Sales Return posts a balanced journal voucher:
  - Debit: Sales Return / Revenue Reversal (Paise)
  - Debit: Output GST Reversal (Paise)
  - Credit: Customer Accounts Receivable (Paise)
  - Balance condition: $\sum \text{Dr} \equiv \sum \text{Cr}$.
- **Rationale:** Eliminates unbalanced ledgers and fake balancing entries. When an invoice was already settled, the credit reduces customer outstanding or produces available Customer Credit.

### Decision 7: Authoritative Stock Movement for Physical Returns
- **Choice:** Returns can restock goods as `RESTOCK_SALEABLE`, `RESTOCK_DAMAGED`, or `FINANCIAL_CREDIT_ONLY`.
- **Rationale:** Returns do not automatically inflate saleable stock without inspection. Damaged goods are isolated from saleable inventory, and financial adjustments do not corrupt physical counts.

### Decision 8: Firebase Remains Active Production Database; Portability via Repositories
- **Choice:** Maintain Firebase Realtime Database and Firebase Auth as the active production persistence system. Do not prematurely rewrite the data layer with an all-encompassing ORM. Define clean repository interfaces (`IBranchRepository`, `IMembershipRepository`, `ISalesReturnRepository`) to decouple UI components from direct database SDK calls.
- **Rationale:** Avoids high-risk premature migration while creating clean architectural boundaries for future Supabase/Postgres or MongoDB migration when required.

---

## 3. Consequences

### Positive
- Strict branch isolation prevents regional staff from seeing operational transactions of other locations.
- Owner gets consolidated, instantaneous visibility across all branch operations with branch comparison analytics.
- Zero layout or tax drift between invoices and credit notes via the unified `NormalizedDocument` engine.
- Complete offline capability via Dexie compound indexes `[companyId+branchId]`.

### Negative / Trade-offs
- Client components must never issue raw database writes; all state changes must pass through repository services or canonical server mutations.
- Multi-branch document counters require atomic sequence allocation per branch prefix.
