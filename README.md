# Business Management Software (BMS)

An offline-first, single-user business management suite for small business owners.
Quotations, GST invoices, receipts, purchases, customers, suppliers, stock,
ledgers, reports and backups — all stored **locally on the user's device**.
No accounts, no cloud, no subscriptions.

Built by **Mohammed Maaz — MMA**.

- Preview: https://id-preview--f0e62c59-1b8b-4b2c-b902-d17079cdaf58.lovable.app
- Published: https://bmssolution.lovable.app

---

## Documentation map

| Doc | What it covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, folder layout, routing, rendering & data-flow rules |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every Dexie table, field and migration |
| [docs/MODULES.md](docs/MODULES.md) | Each screen: what it does and how it works |
| [docs/QUOTATION-MODULE.md](docs/QUOTATION-MODULE.md) | The professional quotation system in depth |
| [docs/EXPORTS.md](docs/EXPORTS.md) | PDF / DOCX / print pipeline and layout rules |
| [docs/AUTH-AND-SESSION.md](docs/AUTH-AND-SESSION.md) | Login gate, 24h session, public vs private routes |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) | Theme tokens, components, motion, scrollbars |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Scripts, conventions, adding a module, troubleshooting |
| [src/routes/README.md](src/routes/README.md) | File-based routing conventions |
| [src/lib/README.md](src/lib/README.md) | Purpose of every helper module |
| [src/components/app/README.md](src/components/app/README.md) | Purpose of every app component |

---

## Quick start

```bash
bun install
bun run dev        # http://localhost:8080
```

Demo credentials (hard-coded, single user):

```
email:    admin@business.local
password: Admin@123
```

Other scripts: `bun run build`, `bun run lint`, `bun run format`.

---

## Feature summary

**Sales**
- Quotations with unlimited items, sizes, descriptions, extra charges, reusable
  masters, multi-page PDF + DOCX export, duplicate / share / status tracking.
- GST invoices with CGST/SGST/IGST split, round-off, amount-in-words,
  payments and balance; can be pre-filled **from a saved quotation**.
- Receipts against customers/invoices with mode and reference.

**Purchasing & stock**
- Purchases with supplier, items, paid/balance.
- Product master with unit, HSN, GST%, purchase/selling price,
  opening/current stock, reorder level, default sizes and specifications.
- Stock moves automatically with invoice/purchase line items.

**Parties & books**
- Customers and suppliers with GSTIN, address, opening balance.
- Ledgers per party derived from invoices, receipts and purchases.
- Reports: sales, GST summary, stock and outstanding.

**Company & data**
- Company settings: name, logo, address, phone, GSTIN/PAN/CIN, bank details,
  signature, stamp, currency, document prefixes and next numbers.
  Invoices/quotations automatically show the company logo, name, address and
  phone once these are filled — otherwise the BMS logo is used.
- Backup/restore: full JSON export and import of every table.

**Platform**
- Works fully offline (IndexedDB via Dexie), installable as a PWA.
- Login required for all business screens; About and Contact are public.
- Session auto-expires after 24 hours.
- Hidden scrollbars, skeleton loading, hover route preloading for instant tabs.
