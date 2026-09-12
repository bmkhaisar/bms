# Design system

## Direction

Soft-brutalist blue: crisp borders, offset hard shadows (`card-soft`), generous
radii, dense but readable data tables, and a look closer to a commercial desktop
application than a web page.

## Tokens

All colours, gradients and shadows are semantic tokens declared in
`src/styles.css` under `@theme` (Tailwind v4 — there is no `tailwind.config.js`).
Components use token utilities (`bg-primary`, `text-muted-foreground`,
`border`, `bg-muted/30`) and **never** hardcoded colours such as `text-white`,
`bg-black` or `bg-[#123456]`, so theming and dark mode keep working.

Quotation templates inject their accent as a CSS variable for the print/preview
surfaces, which is the only runtime colour override.

## Components

- `src/components/ui/*` — shadcn/Radix primitives; treat as vendor code.
- `src/components/app/*` — application components (shells, tables, dialogs,
  editors, print views). See that folder's README.

## Layout rules

- Screens are grids of `Card`s with matching padding and aligned headers.
- Dialogs: exactly **one** close button, sticky header, scrollable body, sticky
  footer. Tab bars inside dialogs scroll horizontally and stay stuck to the top.
- Forms never exceed the viewport; the body scrolls vertically only, so mobile
  layouts don't shift sideways.

## Motion & feedback

Framer Motion for entrance and overlay transitions, `sonner` toasts for every
create/update/delete, `ConfirmDialog` before destructive actions, and skeleton
tables (`Skeletons` + `useInitialLoading`, 120 ms) for first paint.

## Scrollbars

Scrollbars are hidden globally (tables, dialogs, sidebar, item editor) while
wheel, trackpad and touch scrolling still work — set once in `src/styles.css`.

## Typography & fonts

Web fonts load through a `<link>` in `src/routes/__root.tsx`. Never `@import` a
remote stylesheet from `src/styles.css` — Tailwind v4's Lightning CSS resolves
imports from the filesystem and the build fails.
