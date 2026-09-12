# Modules

Every private screen lives at `src/routes/_app.<name>.tsx` and renders inside
`AppShell` (sidebar + topbar + global search).

| Route | Screen | Purpose |
| --- | --- | --- |
| `/` | Dashboard | KPI cards, recent documents, low-stock and outstanding highlights |
| `/customers` | Customers | CRUD, GSTIN/address, opening balance, ledger link |
| `/suppliers` | Suppliers | CRUD for purchase parties |
| `/products` | Products | CRUD, unit/HSN/GST, prices, stock, reorder level, default sizes, specifications |
| `/categories` | Categories | Product grouping |
| `/quotations` | Quotations | Full quotation system — see `docs/QUOTATION-MODULE.md` |
| `/masters` | Quote Masters | Sizes, Terms, General Info, Technical, Electrical, Bank Accounts, Quotation Templates |
| `/invoices` | GST Invoices | Tax invoices, GST split, payments, load from quotation |
| `/receipts` | Receipts | Money received against a customer/invoice |
| `/purchases` | Purchases | Supplier bills, paid/balance, stock in |
| `/ledger` | Ledgers | Party statement built from invoices, receipts, purchases |
| `/reports` | Reports | Sales, GST summary, stock and outstanding with charts |
| `/settings` | Company | Company profile, logo, bank, signature, stamp, prefixes, numbering |
| `/backup` | Backup | JSON export/import of every table |
| `/about`, `/contact` | Public | Info + contact, "Built by Mohammed Maaz — MMA" |
| `/login` | Public | Single-user sign-in |

## Shared document engine

`DocumentListPage` powers invoices and purchases (and the generic list parts of
other screens). One component provides:

- search, status/date filters, sorting and a responsive table
- create/edit dialog with a **sticky header, scrollable body, sticky footer** so
  Save is always reachable on mobile (no sideways shake)
- line items via `LineItemsEditor`, live totals via `computeTotals`
- print / PDF actions via `DocumentPrint` + `src/lib/pdf.ts`
- skeleton loading via `Skeletons` + `useInitialLoading`

Invoices additionally offer **Load from quotation**: pick a saved quote and its
customer, items, charges and totals are copied into the new invoice.

## Stock behaviour

Saving an invoice decreases `currentStock`; saving a purchase increases it,
using `applyStockDelta` inside a Dexie transaction. Editing or deleting reverses
the previous delta before applying the new one, so stock never drifts.

## Numbering

Each document calls `nextNumber(kind)`, which reads the prefix and next counter
from company settings, increments it and returns e.g. `INV-0042`. Prefixes and
starting numbers are editable in Company settings.

## Backup / restore

Export writes a single JSON file containing every Dexie table plus a schema
version. Import validates the shape, clears matching tables and bulk-puts the
records, then the live queries repaint automatically.
