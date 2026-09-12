# Company Membership & Multi-Tenancy — BMS NEXT

## 1. Membership Data Model

Tenant membership in BMS NEXT is modeled across two complementary paths in the Realtime Database:

### 1.1 Full Membership Record (`/memberships/{companyId}/{uid}`)
Stores the complete authorization context for a user inside an organization:
```typescript
export interface CompanyMembership {
  uid: string;
  role: string;               // e.g. "owner", "administrator", "accountant", "sales", "viewer"
  roleId: string;
  status: "active" | "suspended" | "revoked";
  branchIds: Record<string, boolean>; // e.g. { "br_main": true }
  customPermissions: string[];
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}
```

### 1.2 Minimal Reverse Index (`/userCompanies/{uid}/{companyId}`)
```json
{
  "userCompanies": {
    "user_123": {
      "comp_abc": true,
      "comp_xyz": true
    }
  }
}
```

### 1.3 Storage Optimization Principle
- Full business metadata (company name, GSTIN, financial data, transactions) is stored **only once** under `/companies/{companyId}` and `/companyData/{companyId}`.
- The reverse index contains only boolean pointers (`true`). This keeps storage overhead negligible while enabling:
  - Sub-millisecond lookup of allowed companies upon login.
  - Immediate access revocation (deleting the reverse pointer instantly closes tenant access in Firebase Security Rules).
  - Clean company switching without full database scans.

---

## 2. Multi-Company User Support

A single Firebase Authentication user can belong to multiple organizations simultaneously with different roles:
- **ABC Pvt Ltd:** Role = `Accountant` (can create vouchers, post journals, view trial balance)
- **XYZ Trading Co:** Role = `Viewer` (read-only visibility to transactions)
- **Delta Industries:** Role = `Owner` (full tenant control)

Upon login, the system resolves `/userCompanies/{uid}`:
- If assigned to exactly 1 active company, the application automatically opens that company's workspace.
- If assigned to multiple companies, the user sees the Company Selector with their respective roles highlighted.

---

## 3. Ownership Architecture & Safe Transfer

1. **Multiple Active Owners:** A company is not artificially restricted to a single owner. Multiple trusted stakeholders can hold the `owner` role simultaneously.
2. **Transfer Ownership Invariant:**
   When transferring primary ownership:
   - Target user is promoted to `owner` **first**.
   - Previous owner is then demoted to `administrator` (or custom role).
   - Updates are executed atomically via server multi-path update.
   - The engine enforces that the company will have $\ge 1$ active owner at all times.
   - Both promotion and demotion actions are recorded in the platform audit trail (`company.owner.promoted` and `company.owner.demoted`).
