# Architecture

## Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | TanStack Start v1 (React 19) | File-based routing, SSR shell |
| Build | Vite 7 | `vite.config.ts`, `vite-tsconfig-paths` |
| Styling | Tailwind CSS v4 | Tokens in `src/styles.css` via `@theme` |
| UI kit | shadcn/ui + Radix | `src/components/ui/*` |
| Icons | lucide-react | |
| Storage | Dexie (IndexedDB) | `src/lib/db.ts`, database `bms_db_v1` |
| Reactivity | `dexie-react-hooks` (`useLiveQuery`) | wrapped by `src/lib/useLive.ts` |
| Drag & drop | @dnd-kit | quotation item reordering |
| Documents | jspdf + jspdf-autotable, docx, html2canvas | see `docs/EXPORTS.md` |
| Toasts | sonner | `<Toaster />` mounted once in `__root.tsx` |
| Charts | recharts | reports |

There is **no backend and no network dependency**. Every byte of business data
lives in the browser's IndexedDB on the user's device.

## Folder layout

```
src/
  routes/            file-based routes (see src/routes/README.md)
    __root.tsx       html shell, SEO metadata, favicon/PWA, Toaster
    _app.tsx         private layout: auth gate + AppShell wiring
    _app.*.tsx       one file per business screen
    login.tsx        public login
    about.tsx        public
    contact.tsx      public
  components/
    app/             application components (see that folder's README)
    ui/              shadcn primitives — avoid editing
  lib/               db, calculations, formatting, exports, session, hooks
  assets/            logo
  styles.css         theme tokens + global rules
public/              favicon, PWA icons, manifest, robots.txt, sitemap.xml
```

## Rendering & data flow

1. A route renders a screen component wrapped in `AppShell` (sidebar + topbar).
2. The component reads data with `useLive(...)` / `useLiveOne(...)`, which wrap
   Dexie's `useLiveQuery`. Any write to IndexedDB re-renders every subscriber
   automatically — there is no global store, no manual cache invalidation.
3. Writes go straight to Dexie tables (`db().invoices.put(...)`), often inside
   `db().transaction("rw", ...)` when stock must move with the document.
4. Numeric truth lives in `src/lib/calc.ts` (`computeLine`, `computeTotals`,
   `applyStockDelta`) so every module totals identically.

### SSR safety

Dexie only exists in the browser. `db()` throws if called on the server, and
`useLive` returns empty data during SSR. Rules:

- Never call `db()` at module scope or in a route `loader`.
- Read `localStorage` (session, UI prefs) inside `useEffect`, never in a
  `useState` initializer, to avoid hydration mismatches.

### Performance choices

- Router preloads on intent (hover/focus) with a 20 ms delay — tab switches feel
  instant (`src/router.tsx`).
- `useInitialLoading(120)` gives a 120 ms skeleton flash only when a screen
  genuinely needs a frame, avoiding both flashes and blank screens.
- Scrollbars are hidden globally while scrolling still works (`styles.css`).

## SEO & PWA

`__root.tsx` sets title, description, OG/Twitter tags, JSON-LD
(`SoftwareApplication`), canonical, theme color and the favicon /
apple-touch-icon. `public/manifest.webmanifest` provides the installable PWA
with the BMS logo at 192/512 px. `robots.txt` and `sitemap.xml` cover the public
pages only. No Lovable branding or metadata remains.
