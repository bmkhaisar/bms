# User Access Management — BMS NEXT

## 1. User Identity & Authentication

In BMS NEXT, login identities are managed exclusively by **Firebase Authentication**.
- **User Login:** Users log in using their email and password (e.g. `accounts@abccompany.com`).
- **Internal UID:** The Firebase UID is an internal technical identifier. Normal business users never enter or memorize their UID.
- **Resolution Flow:**
  ```
  Email + Password
        ↓
  Firebase Authentication
        ↓
  Cryptographic ID Token (UID)
        ↓
  /userCompanies/{uid} (Allowed Companies)
        ↓
  /memberships/{companyId}/{uid} (Assigned Role & Permissions)
        ↓
  Company Operational Workspace
  ```

---

## 2. User Creation Workflow

Platform administrators provision users through the server-side function `createPlatformUser()`:
1. **Existing User Lookup:** Checks `getUserByEmail(email)`. If the account already exists, returns the existing UID without error.
2. **Account Creation:** If no account exists, invokes `admin.auth().createUser({ email, displayName })`.
3. **Password Delivery:**
   - Plaintext passwords are **never** logged or stored in the Realtime Database.
   - If automated transactional email delivery is not configured, the invitation status is marked as:
     `PASSWORD_INVITATION_EMAIL = NOT_CONFIGURED`
   - A random temporary password can be shared once securely by the administrator during initial provisioning.

---

## 3. Membership Lifecycle & Status Transitions

Each membership record at `/memberships/{companyId}/{uid}` maintains an explicit lifecycle status:

| Status | Reverse Index (`/userCompanies/{uid}/{companyId}`) | Tenant Operational Access | Description |
| :--- | :--- | :--- | :--- |
| **`active`** | `true` | **Allowed** | Member can access authorized modules in the company workspace. |
| **`suspended`** | *Removed (`null`)* | **Blocked** | Temporarily locked out. Reverse index is removed so company disappears from selector and Firebase Rules reject client access. |
| **`revoked`** | *Removed (`null`)* | **Blocked** | Permanently revoked. Membership record is preserved for historical audit trail. |
| **`reactivated`**| `true` | **Allowed** | Restores active status and reinstates the reverse index entry atomically. |

---

## 4. Audit Trail Specification

All administrative user and access operations are logged immutably in `/platformAuditLogs/{auditId}`:

- `platform.admin.bootstrap`: Initial platform admin claim assignment
- `platform.user.created`: New user registered in Firebase Auth
- `company.created`: New organization initialized
- `company.access.granted`: User assigned to a company
- `company.access.updated`: Role or custom permissions updated
- `company.access.suspended`: User access temporarily suspended
- `company.access.reactivated`: Suspended user reinstated
- `company.access.revoked`: User access revoked
- `company.owner.promoted`: New company owner elevated
- `company.owner.demoted`: Previous owner transitioned to administrative role

> [!IMPORTANT]
> **Audit Privacy Rule:** Audit log records capture `actorUid`, `targetUid`, `companyId`, `before`, and `after` snapshots. Secrets, passwords, ID tokens, and private keys are strictly stripped before writing to the database.
