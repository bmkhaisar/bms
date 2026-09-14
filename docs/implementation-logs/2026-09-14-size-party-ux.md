# BMS NEXT implementation log — Size and Party UX

Date: 2026-09-14  
Scope: user-requested Quotation/Invoice Size UX, product-specific size memory, Party Master terminology, and human-readable party IDs.

## Implemented

- Added a clearly labelled `Size` control to the shared line-item editor used by both Quotation and Invoice, on desktop and mobile.
- Added product-specific `Recent / Saved Sizes` suggestions and an explicit `Custom Size` entry path.
- Added structured `sizeSnapshot` fields (label, length, width, height, unit) to frozen line items.
- Added company-scoped `ProductSizePreference` persistence with deterministic retry-safe IDs, usage count, last-used timestamp, Dexie v6 storage, Firebase RTDB persistence, and centralized realtime reconciliation.
- Updated the canonical Invoice PDF renderer to use a dedicated `Size` table column for GST and non-GST documents. Quotation PDF already used a dedicated Size column.
- Added server-authoritative, company-scoped party-code allocation using an atomic Firebase Admin transaction. Assignments are idempotent per immutable party ID and render as `CUS-000001` / `SUP-000001`.
- Routed Party Master and quick customer/supplier creation through a trusted server mutation that atomically saves the canonical party, its AR/AP ledger, the idempotency record, and an audit log. New operational writes do not require client permission to write protected audit paths.
- Displayed party codes in Party Master and customer/supplier selectors for client disambiguation.
- Confirmed `partyCode` is not referenced by the Quotation or Invoice PDF renderers.
- Replaced user-facing Party Master creation/type labels with `New Customer`, `New Supplier`, `Customer`, and `Supplier`. Canonical stored types are `SUNDRY_DEBTOR` and `SUNDRY_CREDITOR`; legacy plural/type aliases remain read-compatible.
- Allowed same-name parties to remain distinct; immutable IDs and exact GSTIN are identity/collision controls.
- Added RTDB rules/indexes for canonical `parties` and product-size preferences.
- Added automated acceptance coverage in `test/size-and-party-ux.test.mjs` and updated the affected terminology assertion.

## Verification results

- `npx tsc --noEmit` — PASS (exit 0).
- `npm test` — PASS: 349 tests, 349 passed, 0 failed.
- `npm run build` — PASS. Client, SSR, and Nitro/Vercel production output built successfully. The first sandboxed attempt reached the Nitro trace stage but was blocked by Windows `EPERM` on `C:\Users\maazm`; the approved unrestricted rerun passed.
- `database.rules.json` parse — PASS.
- `git diff --check` — PASS; only existing Windows LF/CRLF conversion warnings were emitted.
- `npm run verify:r2` — PASS on approved unrestricted rerun: bucket reachability, object write, object read, and cleanup all succeeded; status `R2_VERIFICATION_READY`.
- `npm run verify:firebase-admin` — PARTIAL / EXTERNAL CREDENTIAL ISSUE: configuration present, credential parse PASS, project match PASS, Admin SDK initialization PASS, RTDB access PASS; Firebase Auth access failed with `app/invalid-credential`, yielding `FIREBASE_ADMIN_STATUS = INITIALIZATION_FAILED`.

## Repository safety

- No browser/manual QA was performed, per PRD instruction.
- No operational data reset was executed.
- No files under `.agents/skills/archify` or `docs/architecture` were modified by this implementation.
- Existing untracked Archify work and unrelated `package.json` changes were left untouched.
