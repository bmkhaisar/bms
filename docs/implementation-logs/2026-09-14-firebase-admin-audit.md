# Firebase Admin credential-path audit

Date: 2026-09-14

## Scope

- Audited the existing `.env`; no alternate credential source or second Admin initialization system was added.
- Kept `src/server/firebaseAdmin.ts` as the single application-runtime Firebase Admin initializer.
- Centralized scalar outer-quote removal and private-key escaped-newline normalization in `src/server/config/serverEnv.ts`.
- Added a service-account email/project consistency check without logging either value.
- Strengthened `scripts/verify-firebase-admin.mjs` so it cryptographically parses the PEM and makes real Admin Auth and RTDB network calls.
- Removed identifier values from verifier output. No private key, client email, project ID, database URL, UID, or other credential value was printed.

## Fresh-process verification

The verifier was launched in a new Node process after the audit.

- Required variables: PRESENT
- Credential parse: PASS
- Client/Admin project match: PASS
- Service-account email project match: PASS
- Admin SDK initialization: PASS
- Admin Auth access: PASS
- RTDB network read: PASS
- Final status: `FIREBASE_ADMIN_STATUS = READY`

## Automated checks

- `npx tsc --noEmit`: PASS
- `node --test test/server-config-status.test.mjs`: 11 passed, 0 failed

