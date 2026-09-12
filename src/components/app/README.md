# `src/components/app`

Application components. UI primitives live in `src/components/ui` (shadcn) and
should be treated as vendor code.

| File | Purpose |
| --- | --- |
| `AppShell.tsx` | Private layout frame: sidebar, topbar, page title, content area, hidden scrollbars. |
| `Sidebar.tsx` | Nav list (Dashboard → Backup, plus Quote Masters and About), BMS logo, active-route highlight, mobile drawer. |
| `Topbar.tsx` | Page title, global search trigger, logout. |
| `PublicShell.tsx` | Header/footer for `/login`, `/about`, `/contact` with logo, contact info and "Built by Mohammed Maaz — MMA". |
| `GlobalSearch.tsx` | Command palette across customers, suppliers, products and documents (Dexie-backed via `useLive`). |
| `DocumentListPage.tsx` | Generic document module (invoices, purchases): list, search/filter/sort, create-edit dialog with sticky header + scrollable body + sticky footer, line items, live totals, print/PDF, "Load from quotation". |
| `LineItemsEditor.tsx` | Reusable item rows: product picker with autofill, size (preset or custom), qty, unit, rate, discount %, GST %, amount, add/duplicate/remove, focus-stable inputs. |
| `QuotationsPage.tsx` | Quotation list with status/date filters and row actions: edit, duplicate, delete, print, PDF, DOCX, share. |
| `QuotationForm.tsx` | Tabbed quotation form — Details, Items (drag-reorder + sizes), Charges, General Info, Technical, Electrical, Terms & Bank — with live totals and master snapshots. |
| `DocumentPrint.tsx` | On-screen A4 print view. Header shows only company logo, name, address and phone (BMS logo as fallback). |
| `ListHelpers.tsx` | Shared table/list pieces: toolbars, empty states, status pills, pagination bits. |
| `ConfirmDialog.tsx` | Confirmation before destructive actions. |
| `Skeletons.tsx` | Animated table/card skeletons used with `useInitialLoading`. |

See `docs/QUOTATION-MODULE.md` and `docs/MODULES.md` for behaviour details.
