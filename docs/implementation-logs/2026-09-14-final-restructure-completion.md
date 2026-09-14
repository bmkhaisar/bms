# Final Production Restructure completion log

Date: 2026-09-14

## Scope completed

- Firebase Admin: retained the single existing initialization path; live Admin Auth and RTDB verification both pass.
- Canonical legacy-party migration: authenticated server migration, explicit mappings, same-name-safe identity rules, missing AR/AP ledger creation, foreign-key rewrite, frozen snapshot preservation, audit record.
- Persistence and realtime: Firebase-first document/master mutation flow retained; realtime reconciliation expanded and serialized per collection for ordered cross-device create/edit/delete.
- Deletion: invoice/purchase/receipt/payment deletion waits for completion, shows `Deleting…`, retains failed modals, and reverses posted vouchers rather than destroying accounting history.
- Quotation conversion: deterministic invoice identity, authoritative multi-path quote/invoice linking, `sourceType`, source quotation ID/number, Direct Invoice badge, and source navigation.
- Invoice Preview: draft and saved invoices use the same canonical vector-PDF generator as download.
- Authentication: company-access denial is gated on fully resolved auth and membership state; the unsafe timeout-to-denied path was removed.
- Settlement linkage: receipt+invoice and payment+purchase balances persist together; payments expose purchase selection, listing, and deletion.
- Controlled reset: company-scoped dry-run by default, explicit confirmation token, local backup, allowlisted operational paths, optional products, audit/reset marker, and connected-client cache/outbox purge.

## Permanence and PDF follow-up

- Removed competing page-level Firebase listeners that could finish out of order and purge a newly saved invoice or resurrect a deleted quotation. The application guard now owns the single ordered realtime pipeline.
- Invoice and purchase work-in-progress records become explicit Firebase-backed drafts after 750 ms and flush again when their route unmounts.
- Quotation form drafts use the same Firebase-backed autosave and unmount flush behavior.
- Invoice and quotation PDF/DOCX bank rendering now resolves `accountNo`, `bankAccountNo`, `accountNumber`, `bankAccount`, and `bankAccountNumber`, then falls back to the frozen company bank account.
- Customer, supplier, party, product, and category screens now also rely on the single ordered company-level realtime owner; their create/edit/delete writes remain Firebase-backed.
- If an active company has no financial year configured, an authenticated, membership-checked Admin function idempotently restores the appropriate India April–March financial year before document-number allocation. This closes the silent local-only save path that caused documents to disappear after navigation.

## Verification log

- `npm run verify:firebase-admin`: PASS — Admin SDK Init, Auth Access, RTDB Access; final status READY. No secret values printed.
- `npx tsc --noEmit`: PASS.
- Original PRD integration/regression run: 62 passed, 0 failed.
- Permanence/PDF focused regression run: 36 passed, 0 failed.
- `npm run build`: PASS (client, SSR, and Nitro/Vercel bundle).
- Full `npm test`: 361 passed, 1 failed. The only failure was the untouched Archify validation test encountering Windows `EPERM` while resolving `C:\Users\maazm`; all application tests passed.
- Local development runtime: `http://127.0.0.1:8080/` returned HTTP 200 after the final hot reload.

## Reset tool safety

Dry run:

`npm run reset:company-data -- --company=<company-id>`

Execute only after reviewing the dry-run manifest:

`npm run reset:company-data -- --company=<company-id> --confirm=RESET:<company-id>`

Add `--include-products` only when product/category masters must also be cleared. No reset was executed during implementation.
