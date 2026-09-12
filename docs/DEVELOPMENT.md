# Development guide

## Scripts

```bash
bun install
bun run dev        # dev server on http://localhost:8080
bun run build      # production build
bun run build:dev  # development-mode build (prerender check)
bun run lint
bun run format
```

## Conventions

- **Routing** is file-based in `src/routes`. Never create `src/pages`,
  `_app/index.tsx` or a React Router table; never hand-edit
  `src/routeTree.gen.ts` beyond what the generator writes.
- **Data** always goes through `src/lib/db.ts`; never touch IndexedDB directly.
- **Reads** use `useLive` / `useLiveOne`; don't fetch in `useEffect`.
- **Money and stock maths** belong in `src/lib/calc.ts`, formatting in
  `src/lib/format.ts`. Don't recompute totals inline in a component.
- **Colours** use theme tokens only (see `docs/DESIGN-SYSTEM.md`).
- Every content route defines its own `head()` with a unique title and
  description.

## Adding a new module

1. Create `src/routes/_app.<name>.tsx` that renders
   `<AppShell title="…"><YourPage /></AppShell>` and a `head()`.
2. Add types + a store to `src/lib/db.ts`. If a new table is needed, bump the
   Dexie version with an **additive** `.stores({...})` block; keep new fields
   optional so existing records stay valid.
3. Build the screen in `src/components/app/`, reusing `DocumentListPage`,
   `LineItemsEditor`, `ConfirmDialog` and `ListHelpers` where possible.
4. Add a nav entry to `src/components/app/Sidebar.tsx`.
5. Include the table in backup/restore.

## Extending a Dexie schema safely

```ts
this.version(3).stores({
  myTable: "id, name, createdAt",
});
```

Additive stores and optional fields require no upgrade hook. Only write an
`.upgrade()` when existing rows must be rewritten.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `db() called on server` | Dexie touched during SSR — move the call into a component/effect |
| Hydration mismatch | `localStorage` read in a `useState` initializer — move it into `useEffect` |
| `FileRoutesByPath` type error | The linked route file doesn't exist yet — create it |
| `₹` prints as `¹` in PDF | jsPDF Helvetica lacks the glyph — use `Rs. ` (already handled) |
| Save button unreachable in a dialog | Body must scroll, header/footer sticky — follow the dialog pattern |
| Data “disappeared” | IndexedDB is per browser profile/device — restore from a JSON backup |

## Data safety

There is no cloud copy. Clearing site data, wiping the browser profile or losing
the device loses everything — encourage regular JSON backups from `/backup`.
