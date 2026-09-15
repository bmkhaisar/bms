# BMS NEXT — Archify Architecture Intelligence & System Mapping

## 1. Executive Summary & Purpose

This directory maintains the interactive architecture intelligence system for **BMS NEXT**, powered by [Archify](https://github.com/tt-a1i/archify). It provides an authoritative, validated, and interactive architectural map documenting how primary components, operational workflows, financial engines, databases, and background synchronizers connect.

### Important Architectural Philosophy
> [!IMPORTANT]
> **Archify is NOT an automatic runtime blast-radius oracle.**
> 
> Archify represents **validated AUTHORED architecture relationships**. Actual change impact is determined by combining:
> 1. Codebase and file inspection
> 2. Archify authored topology
> 3. Import, function-call, and schema dependencies
> 4. Automated regression test suites (`npm test`)
> 5. Architecture Delta reviews (`npm run arch:compare`)
> 
> A downstream relationship in Archify does not by itself prove a runtime breaking failure. Never present a *possible* downstream area as *confirmed*.

---

## 2. Directory Structure

```
docs/architecture/
├── source/          # Authoritative JSON source diagrams (validated with showcase profile)
├── generated/       # Delivered self-contained standalone interactive HTML artifacts
├── snapshots/       # Base and head versioned snapshots for architecture delta comparison
├── reviews/         # Generated Architecture Delta diff reports (HTML and JSON receipts)
├── impact-map.json  # Manifest mapping repository source modules to stable architecture node IDs
└── README.md        # Comprehensive architecture governance & maintenance handbook
```

---

## 3. Authoritative Architecture Maps Catalog

| Diagram Name | Type | Source JSON | Delivered HTML | Last Verified | Quality Profile / Validation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BMS Runtime Architecture** | `architecture` | [`source/bms-runtime.architecture.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/bms-runtime.architecture.json) | [`generated/bms-runtime.architecture.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/bms-runtime.architecture.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Invoice Posting Sequence** | `sequence` | [`source/invoice-post.sequence.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/invoice-post.sequence.json) | [`generated/invoice-post.sequence.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/invoice-post.sequence.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Receipt / Payment Workflow** | `workflow` | [`source/receipt-payment.workflow.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/receipt-payment.workflow.json) | [`generated/receipt-payment.workflow.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/receipt-payment.workflow.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Financial Data Flow** | `dataflow` | [`source/financial-data.dataflow.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/financial-data.dataflow.json) | [`generated/financial-data.dataflow.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/financial-data.dataflow.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Document Lifecycle** | `lifecycle` | [`source/document-lifecycle.lifecycle.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/document-lifecycle.lifecycle.json) | [`generated/document-lifecycle.lifecycle.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/document-lifecycle.lifecycle.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Realtime Sync & Cache Map** | `sequence` | [`source/realtime-sync.sequence.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/realtime-sync.sequence.json) | [`generated/realtime-sync.sequence.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/realtime-sync.sequence.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |
| **Quotation → Invoice Conversion** | `sequence` | [`source/quotation-conversion.sequence.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/source/quotation-conversion.sequence.json) | [`generated/quotation-conversion.sequence.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/generated/quotation-conversion.sequence.html) | `2f9fb148` (2026-09-14) | Showcase (9/9 checks, 0 errors, 0 warnings) |

---

## 4. Source & Authority Boundaries

BMS NEXT enforces strict operational and financial trust boundaries across storage engines:

```
+-------------------------------------------------------------------------------+
|                             CLIENT APPLICATION                                |
|                                                                               |
|  [Frontend UI (React/TanStack)] <---> [Dexie bms_cache_v1 (Local IndexedDB)]   |
|                                        * Local read cache & offline outbox    |
|                                        * NOT an accounting authority          |
|                                        * Cannot mint financial vouchers       |
+-------------------------------------------------------------------------------+
                                  |
                                  | HTTPS / API POST (Trusted Auth Boundary)
                                  v
+-------------------------------------------------------------------------------+
|                       TRUSTED SERVER / FIREBASE ADMIN                         |
|                                                                               |
|  [postingService] ---> [calculateCanonicalDocument] ---> [postingEngine]     |
|  * Idempotency Check    * Statutory GST Recalculation   * Double-Entry Vouchers|
|  * Tenant Validation    * HSN & Roundoff Enforcement    * Stock Journal Move  |
+-------------------------------------------------------------------------------+
                                  |
                                  | Authoritative Commits (Admin SDK)
                                  v
+-------------------------------------------------------------------------------+
|                         OPERATIONAL CLOUD PERSISTENCE                         |
|                                                                               |
|  [Firebase Realtime Database (RTDB)]           [Cloudflare R2 Storage]        |
|  * Shared operational cloud truth              * Immutable binary PDFs        |
|  * Protected by database.rules.json            * Company logos & signatures   |
|  * Vouchers & stock ledger are server-write-only                              |
+-------------------------------------------------------------------------------+
```

### The Financial Trust Boundary
1. **Client Isolation**: The browser frontend and Dexie local cache cannot generate or write posted ledger vouchers, journal entries, or inventory movements directly.
2. **Server Enforcement**: All commercial posting operations must transit `documentPostingService` and `postingEngine` using Firebase Admin SDK authority.
3. **Database Rules Guard**: `database.rules.json` strictly forbids client writes to `/vouchers`, `/voucherLines`, `/stockMovements`, `/auditLogs`, and `/docCounters`.
4. **Reconciliation**: Local state is reconciled via `companyRealtimeSync`, guaranteeing convergence between local Dexie tables and Firebase cloud truth.

---

## 5. Change Impact Review Workflow

When preparing to modify BMS NEXT source code or architectural components, developers and architects must execute this 7-step review workflow:

```
[1. Identify Changed Files]
             │
             ▼
[2. Map Files to Architecture Node IDs (docs/architecture/impact-map.json)]
             │
             ▼
[3. Inspect Direct Code Dependencies (Imports / Functions)]
             │
             ▼
[4. Trace Archify Upstream & Downstream Relationships]
             │
             ▼
[5. Classify Impact Categories]
             ├── CONFIRMED DIRECTLY AFFECTED (Files modified directly)
             ├── CONFIRMED DEPENDENCIES (Direct callers / imports)
             ├── POSSIBLE DOWNSTREAM AREAS (Authoritative flows)
             ├── TESTS REQUIRED (Automated test suites)
             └── NOT ANALYZED / UNKNOWN
             │
             ▼
[6. Execute Automated Regression Suites (npm test)]
             │
             ▼
[7. Compare Architecture Delta (npm run arch:compare)]
```

---

## 6. Architecture Snapshots & Delta Comparison

Archify Architecture Delta allows comparing a validated **base** architecture against a proposed **head** architecture to inspect topological diffs before implementation.

### Base Snapshot
- Path: `docs/architecture/snapshots/bms-runtime.base.json`
- Represents the approved, production-verified baseline architecture.

### Head Snapshot
- Path: `docs/architecture/snapshots/bms-runtime.head.json`
- Represents proposed architectural evolutions (e.g., adding external GSTN e-invoicing bridges or new persistence engines).

### Running Architecture Delta
```bash
npm run arch:compare
```
Generated outputs:
- Interactive HTML Delta: [`docs/architecture/reviews/bms-runtime-delta.html`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/reviews/bms-runtime-delta.html)
- JSON Delta Receipt: [`docs/architecture/reviews/bms-runtime-delta.receipt.json`](file:///c:/Users/maazm/Downloads/Business%20Hub/docs/architecture/reviews/bms-runtime-delta.receipt.json)

---

## 7. Developer NPM Commands

Archify development tooling is decoupled from the production build bundle:

| Command | Action | Description |
| :--- | :--- | :--- |
| `npm run arch:doctor` | Health Check | Verifies Node.js runtime (>=18), renderers, schemas, and delta comparison runtimes. |
| `npm run arch:validate` | Strict Validation | Validates all 7 JSON source diagrams under `docs/architecture/source/` with `--quality showcase`. |
| `npm run arch:build` | Artifact Delivery | Generates self-contained interactive HTML deliverables under `docs/architecture/generated/`. |
| `npm run arch:compare` | Delta Diff | Compares `bms-runtime.base.json` with `bms-runtime.head.json` and produces `bms-runtime-delta.html`. |
| `npm test` | Automated Suite | Executes all 344 repository unit and architecture acceptance tests. |

---

## 8. Architecture Update Policy (Preventing Staleness)

### When Diagrams MUST Be Updated:
1. **New Database or Persistence Tier**: Any addition of IndexedDB tables, RTDB paths, or external object stores.
2. **New External Integration / API**: Any third-party service integration (e.g., WhatsApp, payment gateways, GSTN).
3. **Change in Financial Trust Boundary**: Any modification to voucher creation, posting authority, or database rules.
4. **Altered Document Lifecycle**: Adding or modifying allowed document states (`draft`, `posted`, `partial`, `paid`, `cancelled`, `reversed`).
5. **Realtime Sync Protocol Change**: Changes in websocket handlers, optimistic mutation pipelines, or cache reconciliation.

### When Diagrams MUST NOT Be Updated:
- Purely aesthetic styling updates (Tailwind/CSS alterations).
- Internal component refactors that do not alter service boundaries or data flows.
- Minor bug fixes within existing deterministic engines.

---

## 9. Security & Privacy Invariants

Architecture artifacts are strictly subject to security and privacy invariants:
- **Zero Secrets**: No private keys (`-----BEGIN PRIVATE KEY-----`), API secrets, Firebase tokens, passwords, or customer PII are permitted inside any architecture diagram or snapshot.
- **Conceptual Security Nodes**: Authentication and security boundaries are represented as conceptual boundaries (e.g., `firebase-auth`, `trusted-server`).
- **Automated Verification**: `test/architecture.test.mjs` enforces zero-secret regex scanning across all architecture directories on every test run.
