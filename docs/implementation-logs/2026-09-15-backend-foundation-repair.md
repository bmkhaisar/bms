# Backend foundation repair log

Date: 2026-09-15

## Reported failures

- Blank optional product SKU caused an `undefined` value inside the Firebase audit-log portion of an atomic product create.
- Invoice posting rejected the legacy company because its required `br_main` record did not exist.
- Local trusted server functions returned `EACCES` while Firebase Admin attempted ID-token verification.
- Platform Admin consequently could not load companies, users, or access records.

## Root causes and corrections

- The product itself was sanitized, but the complete multi-path payload was not. The full product + mutation + audit payload is now recursively sanitized before RTDB `update()`.
- The affected legacy company predated the branch and chart-of-accounts bootstrap invariant. Voucher posting now additively ensures missing system groups/ledgers and transactionally creates only a missing `br_main`; existing ledgers and balances are preserved.
- Added read-only and confirmation-gated company-foundation tools for repeatable diagnosis/repair.
- The local Vite server had been started in a restricted process without outbound access. It was replaced by the approved runtime on `127.0.0.1:8080`.
- Firebase Admin verification now exercises actual custom-token exchange, ID-token verification, and the Platform Admin custom claim in addition to Auth lookup and RTDB.

## Affected-company audit

Before repair:

- Company record: present
- Active memberships: 1
- Financial years: 1
- Main branch: missing
- Account groups: 0
- Ledgers: 1
- Products: 0 (the failed create never committed)

Controlled repair created only the missing main branch, 27 system account groups, and 2 missing system ledgers. Post-repair audit confirmed:

- Main branch: present
- Account groups: 27
- Ledgers: 3
- Active memberships: 1
- Financial years: 1

No existing ledger or balance was overwritten.

## Verification

- Firebase Admin initialization: PASS
- Admin Auth lookup: PASS
- ID-token verification: PASS
- Platform Admin claim: PASS
- RTDB access: PASS
- Firebase Admin final status: READY
- TypeScript: PASS
- Backend foundation regressions: 4 passed, 0 failed
- Full application suite: 364 passed; one untouched Archify validator failed on Windows `EPERM`
- Production Vercel/Nitro build: PASS
- Local runtime: HTTP 200 at `http://127.0.0.1:8080/`

No credentials, tokens, account values, or private keys were printed.
