# Platform Administrator Architecture — BMS NEXT

## 1. Overview

BMS NEXT establishes a two-layer access architecture:
1. **Platform Level (`platformAdmin: true`):** Responsible for global administration of organizations, users, access provisioning, and system auditing.
2. **Tenant / Company Level (`/memberships/{companyId}/{uid}`):** Controls operational ERP permissions inside each company workspace (Accounting, Inventory, Sales, Purchases, Settings).

A Platform Administrator does **not** automatically bypass tenant security rules from the client browser. To interact with operational company transactions (e.g. Day Book, Vouchers, Invoices), the administrator must possess an explicit membership in that company.

---

## 2. Authoritative Platform Identity

- **Configured Initial Platform Admin UID:** `BOkCLXp08tVmRHICTArgpReVh5Y2`
- **Metadata/Display Email:** `maaz@admin.com`
- **Environment Configuration:**
  - `.env`: `INITIAL_PLATFORM_ADMIN_UID=BOkCLXp08tVmRHICTArgpReVh5Y2`
  - `.env.example`: `INITIAL_PLATFORM_ADMIN_UID=` (blank placeholder)
  - `INITIAL_PLATFORM_ADMIN_EMAIL=maaz@admin.com`
  - *Strict Rule: Never prefix these variables with `VITE_` or expose them in client bundles.*

> [!NOTE]
> The previous bootstrap identity (`8Sqybhv41hhtuzcsN2JrMsnBdov2` / `khaisar@admin.com`) was superseded. All privileged administrative capabilities have been transferred to `BOkCLXp08tVmRHICTArgpReVh5Y2`.

---

## 3. Setup Mode vs Verified Platform Admin (PRD Section 13)

To ensure zero security bypass while providing clear feedback during initial platform provisioning, the system cleanly differentiates two states:

| State | Indicator Badge | Privileges | Allowed Actions |
| :--- | :--- | :--- | :--- |
| **Setup Mode** (Pre-claim) | `Platform Setup` (Amber outline) | Caller UID matches `INITIAL_PLATFORM_ADMIN_UID`, but `platformAdmin: true` custom claim is not yet minted. | View setup diagnostics, sign out, refresh status, trigger one-time bootstrap RPC when server credentials are ready. |
| **Platform Admin** (Post-claim) | `Platform Admin` (Emerald shield) | Verified cryptographic claim `decodedToken.platformAdmin === true`. | Full access to create companies, provision platform users, and grant memberships. |

> [!CAUTION]
> Client code never derives administrator privileges from `user.uid === configuredUid`. Client authorization strictly requires `isPlatformAdmin` (verified from token custom claims).

---

## 4. Authoritative Server Environment Module (`serverEnv.ts`)

The server environment module (`src/server/config/serverEnv.ts`) is strictly server-only:
- **Automatic Development Loading:** Auto-loads `.env` synchronously in local Node/Vite environments so non-`VITE_` variables are available without framework leakage.
- **Private Key Normalization:** Strips wrapping quotes, replaces escaped `\\n` with real `\n`, and validates standard PEM headers (`-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`).
- **Project Match Evaluation:** Compares `FIREBASE_ADMIN_PROJECT_ID` with client `VITE_FIREBASE_PROJECT_ID`.
- **Structured Status Codes:** Returns `FIREBASE_ADMIN_READY`, `FIREBASE_ADMIN_NOT_CONFIGURED`, `FIREBASE_ADMIN_INVALID_PRIVATE_KEY`, `FIREBASE_ADMIN_INVALID_CLIENT_EMAIL`, `FIREBASE_DATABASE_URL_MISSING`, `FIREBASE_ADMIN_PROJECT_MISMATCH`, or `FIREBASE_ADMIN_INITIALIZATION_FAILED`.

---

## 5. Diagnostic & Setup Scripts

### 5.1 Diagnostic Script
```bash
npm run verify:firebase-admin
```
Audits server environment, validates private key PEM formatting, and tests reachability of Firebase Auth and RTDB APIs without printing sensitive values.

### 5.2 Bootstrap Script
```bash
npm run bootstrap:admin
```
- When service account credentials are in `.env`:
  - Verifies user record `BOkCLXp08tVmRHICTArgpReVh5Y2`.
  - Merges `{ platformAdmin: true }` into custom claims (preserving existing claims).
  - Outputs `PLATFORM_ADMIN_CLAIM_SETUP = SUCCESS`.
- When credentials are not yet configured:
  - Reports:
    ```
    PLATFORM_ADMIN_CLAIM_SETUP = BLOCKED_BY_CREDENTIALS
    Reason: FIREBASE_ADMIN_PRIVATE_KEY or FIREBASE_ADMIN_CLIENT_EMAIL is missing in .env.
    ```

---

## 6. System Administration Dashboard (`/system-admin`)

- **Route:** `/system-admin`
- **Access Guard:** Validated cryptographically against the Firebase ID token claims. Ordinary users receive an Access Denied screen.
- **Zero Company Requirement:** The console is fully operational even when the platform administrator has zero company memberships.
- **Refresh Control:** Manual "Refresh" button forces fresh token verification and queries server configuration status.
- **Banner Behavior:** Server administration warning banner automatically disappears as soon as `firebaseAdminReady === true`.
- **Sections:**
  1. **Organizations:** List all companies, view active user counts, inspect status, and create new organizations.
  2. **Platform Users:** Search users by email or display name, inspect company assignments, and register new login identities.
  3. **Access Control:** Provision company memberships, change roles, suspend/reactivate access, revoke memberships, and transfer company ownership.
