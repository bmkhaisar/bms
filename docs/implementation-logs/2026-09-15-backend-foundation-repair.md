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

## Voucher Party Master and Firebase payload invariant follow-up

Invoice posting subsequently exposed an unsafe optional-field construction in the
server posting engine: every processed voucher line included `partyType` and
`partyId` keys even when their values were `undefined`. Document posting also
provided a party subledger ID without consistently providing the canonical Party
Master ID, so the server could neither derive nor validate the required party role.

The server posting boundary now resolves every AR/AP subledger through
`companyData/<company>/parties/<partyId>` before voucher-number allocation. AR
lines store `SUNDRY_DEBTOR`; AP lines store `SUNDRY_CREDITOR`; `BOTH` is resolved
according to the ledger role. Missing, nonexistent, or incompatible party data is
rejected as a domain error before mutation. Invoice, purchase, receipt, payment,
and advance-refund builders now pass their canonical `partyId`. Journal/contra and
other genuine non-party lines omit both optional fields.

Posting and reversal multi-path payloads are recursively audited for JavaScript
`undefined` immediately before the atomic Admin RTDB `update()`. This is an
assertion, not a sanitizer: invalid required data is never silently removed.
Optional voucher header/line fields are constructed conditionally. Party identity
is also included in the idempotency hash.

Verification:

- New voucher-party/payload regressions: 6 passed, 0 failed
- Targeted accounting/foundation/voucher suite: 41 passed, 0 failed
- Full suite: 373 passed; one untouched Archify Windows `EPERM` validation failure
- TypeScript (`tsc --noEmit`): PASS
- Production Vercel/Nitro build: PASS
- Local runtime: HTTP 200 at `http://127.0.0.1:8080/`

No credentials, tokens, account values, or private keys were printed.

## Canonical ledger and quotation follow-up

The later invoice failure for `led_<company>_sales` revealed that the canonical
chart initializer contained only cash and opening-offset ledgers even though the
document posting service has always required sales, purchase, output GST, input
GST, and advance-GST-adjustment ledgers. Those five ledgers now live in the one
shared default-ledger definition used by both company initialization and the
posting engine's additive self-heal.

The controlled tenant repair reported exactly five missing system ledgers and
created only those records. The post-repair audit reports 27 groups and 8 ledgers;
a second dry run reports zero missing foundation records. Existing records and
balances were preserved.

The quotation-tab crash was caused by applying JavaScript `.length`/`.map()` to
RTDB array fields that can legitimately arrive as `null` or numeric-key objects,
especially for legacy or empty data. A shared quotation normalizer now canonicalizes
these fields at the centralized realtime ingress, list boundary, and edit-form
boundary. Empty arrays are intentionally normalized on read rather than repeatedly
rewritten in RTDB, because RTDB represents an empty collection as no child value.

Follow-up verification:

- Targeted document, Firebase/realtime, quotation/PDF, and foundation suite: 43 passed, 0 failed
- TypeScript (`tsc --noEmit`): PASS
- Firebase Admin Auth, token verification, Platform Admin claim, and RTDB: READY
- Production Vercel/Nitro build: PASS
