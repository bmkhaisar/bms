# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file here defines a
route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat`, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## This app's routes

**Shell**
- `__root.tsx` — html shell, SEO metadata (title, description, OG/Twitter,
  JSON-LD, canonical), favicon + PWA icons, theme colour, font `<link>`, and the
  single `<Toaster />`.
- `_app.tsx` — private layout. Checks the 24-hour session *before* rendering, so
  unauthenticated users get the login page with no dashboard flash, and are
  redirected when the session expires. Renders children inside `AppShell`.

**Public**
- `login.tsx` — single-user sign-in with spinner + "Entering your workspace…"
  overlay.
- `about.tsx`, `contact.tsx` — `PublicShell`, contact info, "Built by
  Mohammed Maaz — MMA".

**Private (`_app.*`)**

| File | URL | Screen |
| --- | --- | --- |
| `_app.index.tsx` | `/` | Dashboard |
| `_app.customers.tsx` | `/customers` | Customers |
| `_app.suppliers.tsx` | `/suppliers` | Suppliers |
| `_app.products.tsx` | `/products` | Products & stock |
| `_app.categories.tsx` | `/categories` | Categories |
| `_app.quotations.tsx` | `/quotations` | Quotations |
| `_app.masters.tsx` | `/masters` | Quote masters (sizes, terms, specs, banks, templates) |
| `_app.invoices.tsx` | `/invoices` | GST invoices |
| `_app.receipts.tsx` | `/receipts` | Receipts |
| `_app.purchases.tsx` | `/purchases` | Purchases |
| `_app.ledger.tsx` | `/ledger` | Party ledgers |
| `_app.reports.tsx` | `/reports` | Reports |
| `_app.settings.tsx` | `/settings` | Company settings |
| `_app.backup.tsx` | `/backup` | JSON backup / restore |

Each route file sets its own `head()` with a unique title and description.
Never call `db()` in a route `loader` — Dexie is browser-only.
