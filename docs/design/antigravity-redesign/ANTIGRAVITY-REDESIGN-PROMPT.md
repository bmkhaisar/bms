# Antigravity implementation prompt — BMS NEXT frontend redesign

## 1. Assignment and outcome

Act as a senior product designer, design engineer, and frontend engineer. Redesign the entire existing BMS NEXT business management application into a coherent, polished product that feels calm, substantial, trustworthy, and exceptionally easy for a nontechnical business owner to use.

Implement the redesign in the existing application. Deliver working screens and interactions, not only a design proposal or a dashboard mockup. Preserve the existing business features and their behavior.

**Support both light and dark mode.** Light is the default for a new user; retain a returning user's saved choice. Design both modes deliberately and completely.

The desired character is: soft neutral surfaces, confident typography, precise alignment, restrained mint accents, subtle depth, readable business data, and immediate feedback. Visual weight should come from hierarchy, contrast, and craftsmanship. Keep the interface clean, practical, and fast.

Complete coverage means inspect every frontend surface and state. It does not mean rewriting every source line. Preserve sound logic and make the smallest implementation changes that achieve a comprehensive visual result.

## 2. References and skill

Use the three attached images as visual references only:

- **Photo 1 / Photo-1.jpg:** Take the soft white surface, generous internal spacing, gentle corners, and quiet separation between layers. A very faint static mint wash may appear in the sign-in composition. Omit the reference's assistant interface, microphone, prompts, brand, and social-media framing.
- **Photo 2 / Photo-2.jpg:** Take the tactile controls, precise grouping, small shadows, restrained green highlights, and thoughtful small-component detailing. Keep boundaries and text more readable than the washed-out image. Do not add its quiz, shift, survey, chat, or task features.
- **Photo 3 / Photo-3.jpg:** Use as the main reference for application structure: a tidy sidebar, quiet page background, white KPI surfaces, clear filters, aligned metrics, and disciplined charts. Preserve our own navigation, reports, data, and business terminology. Do not add country filters, ecommerce metrics, or any feature simply because it appears in the image.

Reference priority: Photo 3 for the application layout, Photo 2 for controls and surface detail, Photo 1 sparingly for softness. Do not embed these screenshots into the product or reproduce their brands. Their light palettes inform the light theme; derive a complementary dark theme from the same hierarchy.

Read and apply Emil Kowalski's official **emil-design-eng** skill if available:
https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md

If it is not installed, read the source directly. Do not claim to have used a skill you could not access. Apply its interaction judgment within this brief; optional decorative examples in the skill are not a requirement.

## 3. Frontend-only boundary — mandatory

**Do not modify my server, backend, database, or business rules.**

You may change frontend layouts, presentation components, design tokens, CSS, accessible markup, responsive behavior, UI copy, visual feedback, and local interaction state. Mixed route/component files may contain data and security logic: change their presentation without changing those contracts.

Treat these areas as read-only for implementation:

- src/server/**, src/server.ts, src/functions/**.
- Backend/API contracts, Firebase rules and configuration, server environment variables, secrets, infrastructure, storage services, deployment configuration, schema and database migrations.
- Accounting, tax, pricing, inventory, numbering, posting, reversal, reconciliation, and document-conversion business logic.
- Authentication, authorization, company membership and isolation, roles, security checks, and server-side validation.
- Persistence and synchronization internals, including src/lib/db.ts, src/lib/mutationPipeline.ts, src/modules/sync/**, and service/domain layers.

Read those areas as necessary to understand how the UI works. Use existing handlers and contracts. Do not create an alternative data store, mutation pipeline, offline queue, or calculation engine to make the redesign easier.

Preserve URLs, deep links, meaningful query parameters, data fields, payloads, exports, financial results, and permission-dependent visibility. A UI-only improvement must never weaken a protected action.

Keep the existing stack: React, TypeScript, TanStack Router/Start and Query, Tailwind, the current Radix/shadcn-style components, Lucide, Recharts, Sonner, and existing motion utilities. Avoid framework migrations, dependency upgrades, and new UI, chart, icon, or animation libraries.

If a discovered issue requires a backend change, leave that behavior intact and report the specific blocker. Continue the frontend work that can be completed independently.

Respect AGENTS.md and the Lovable integration. Preserve unrelated changes and published Git history. Do not deploy, push, reset data, run repair/bootstrap scripts, or perform real production transactions as part of this redesign.

## 4. Audit before implementation

Inspect the current source and running application where access is available. The source is authoritative when older README descriptions conflict with it. This application has real authentication, companies, cloud interactions, local caching, and financial workflows; do not assume it is a local-only demo.

Create a coverage checklist containing:

- Every route and its nested tabs.
- Shared layouts and all rendered component variants.
- Forms, drawers, dialogs, menus, previews, tooltips, toasts, tables, charts, and print surfaces.
- Loading, empty, filtered-empty, saving, pending, error, denied, offline, and retry states where supported.
- Light mode, dark mode, mobile layout, keyboard access, and functional verification status.

Search beyond this brief's file inventory for additional rendered surfaces. Review inline styles, hard-coded colors, dark variants, direct HTML controls, portal content, root fallbacks, and CSS outside shared primitives. Updating global tokens alone is not completion.

Record a baseline for build/lint/test status and representative page performance. Identify pre-existing failures separately.

## 5. Visual system

Use semantic design tokens consistently rather than scattered colors. Start with this palette, then measure contrast in the actual rendered UI and adjust tokens where needed:

| Role | Light | Dark |
| --- | --- | --- |
| App canvas | #F4F6F3 | #151817 |
| Main surface | #FFFFFF | #1C211E |
| Raised surface / menu | #FFFFFF | #252C27 |
| Subtle surface / hover | #EDF1ED | #29312B |
| Decorative divider | #DEE5DF | #37423A |
| Primary text | #202923 | #F1F5F2 |
| Secondary text | #606D64 | #ADB9B0 |
| Primary button fill | #24352B | #DDECE2 |
| Primary button text | #FFFFFF | #19271F |
| Mint emphasis | #2C7B52 | #8DD6AA |
| Mint-tinted selection | #E4F3E8 | #253F30 |
| Focus indicator | #267147 | #99E2B3 |

These are starting tokens, not proof of accessibility. Decorative dividers may be subtle; interactive boundaries, focus, text, and chart series must remain distinguishable.

- Use mint selectively for active emphasis and meaningful positive states. Give warnings amber, errors muted red, and information restrained blue. Pair status colors with text or icons.
- Limit decorative color in KPIs to a small icon background or a tiny accent. A row of competing colored panels will reduce clarity.
- Keep dark surfaces neutral with a slight green undertone. Use surface separation and fine borders for depth; avoid glowing shadows, pure-black expanses, neon green, and simply inverting the light theme.
- Use one UI font family, preferably the existing Inter with system fallbacks. Preserve specialized fonts required for signatures and document output, scoped to those uses.
- Aim for 14–16px body text, readable 13–14px supporting labels, 24–30px page titles, and approximately 28–36px key metrics. Adapt to content and viewport. Do not shrink the entire mobile interface to make it fit.
- Use tabular numerals for currency, quantities, percentages, and aligned financial columns. Keep meaningful precision, locale, currency, and date conventions.
- Use a consistent spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48px. Main content gets about 24–32px desktop padding and 16px on small screens.
- Use controlled corner radii: approximately 8–10px for small controls, 12–16px for ordinary cards, and 18–24px for larger dialogs or the login composition. Match nested corners to their inset.
- Use fine neutral edges and shallow shadows. Reserve stronger elevation for menus and dialogs. Avoid card-inside-card repetition and making every object float.
- Use 40–44px desktop controls and comfortable touch targets around 44px on mobile. Compact tables may be denser while keeping actions usable.

Avoid oversized hero sections inside business screens, unnecessary gradients, glass effects, decorative 3D, bouncy cards, endless pills, oversized whitespace, emoji, and stock illustrations added merely to fill space.

## 6. Theme behavior

Provide one clear, accessible light/dark control using the existing theme preference mechanism. Use the saved selection consistently across public pages, authenticated pages, startup, company selection, admin, charts, dialogs, portaled menus, toasts, and error pages.

Apply the correct theme before the first visible render using an approach compatible with the current SSR setup and content-security policy. Avoid hydration mismatches, wrong-theme flashes, and independent theme state in different layouts. Do not weaken security policy to implement theme initialization.

Theme changes should be immediate and preserve focus, open forms, unsaved edits, scroll, and chart state. Do not recreate the application tree or add a dramatic theme-switch animation.

Set native form controls and scrollbars appropriately for each theme. Review logos and image transparency on both backgrounds. Keep printed/PDF documents on readable white paper regardless of the application theme.

## 7. Navigation and global shell

Create a coherent shell with a roughly 232–256px desktop sidebar, a compact topbar, and a readable content region that uses available space for tables.

Retain existing navigation destinations, company switching, financial-year context, search, permission-gated admin access, and logout. Clarify grouping and labels where useful; if several links point to the same route, avoid multiple competing active states and retain discoverability. Audit broken links: the dashboard's Cash & Bank link currently points to /ledgers while the existing accounting route is /ledger. Correct such frontend wiring to the intended existing route instead of adding a duplicate page.

Use a calm selected navigation treatment, aligned icons and labels, and concise section labels. Put the active company where users can readily identify it. Preserve authorized deep links and browser Back/Forward.

Show plain-language connectivity status based on actual evidence. An available network alone does not prove all data is synchronized. Avoid exposing implementation names such as Firebase or Dexie to ordinary users. Retain relevant diagnostics in existing administrator-only contexts.

On mobile, use a well-behaved navigation drawer with focus management and automatic closure after navigation. Keep the current page and essential actions clear.

## 8. Required page coverage

Redesign all of the following, including their nested content and states. These routes exist in the current project; inspect again for additions.

| Area | Required coverage and direction |
| --- | --- |
| /login | A compact, confident sign-in composition with the existing BMS identity, visible labels, clear input states, accessible password entry, helpful failure text, pending feedback, and existing lockout/recovery behavior. Preserve login and destination-resolution logic. Do not add unsupported social sign-in, registration, or password-reset services. |
| /select-company | Readable company choices, active selection, loading and error states; preserve company authorization and isolation. |
| /no-company-access and /platform-admin-setup-required | Clear explanation of the existing access/setup state and only the real available next actions. Match the rest of the product. |
| / | Redesign the complete dashboard: existing KPIs, summaries, existing actions, lists, and all existing charts. Make financial status easy to scan without inventing metrics or comparisons. |
| /parties, /customers, /suppliers | Lists, all existing filters/tabs, creation/editing, addresses, balances, payment policy, historical-use restrictions, deactivation, and customer/supplier insight drawers. Preserve the distinction between customer, supplier, credit, and advance behavior. |
| /products and /categories | Product/category lists and editors, prices, units, HSN/GST, sizes, measurements, stock information, specifications, and product insight views. Preserve inventory and price calculations. |
| /quotations | Full list workflow, filters, preview, copy, existing status/share/export/conversion actions, quick-create helpers, and the complete editor. Preserve the existing Details, Items, and Charges & Totals sections and all fields within them. |
| /invoices | Lists and editors, line items, party status, linked quotations/drafts, taxes, totals, payment/balance information, posting, correction restrictions, reconciliation, preview and export actions. Financial calculations and document lifecycle remain unchanged. |
| /receipts | Both Customer Receipts and Supplier Payments tabs; existing lists/editors, invoice/purchase allocations, payment modes, references, credit/advance/refund controls, printing, validation, deletion confirmations, and final confirmation states. |
| /purchases | Supplier selection, items, existing charges/taxes, payment/balance presentation, list actions and forms; preserve stock/accounting behavior. |
| /ledger | All Day Book, Ledger Statement, Trial Balance, and Chart of Accounts views; voucher forms, ledger/group management, financial-year context, and reversal confirmation. |
| /reports | Every report: sales/revenue, purchases, credit outstanding and aging, customer advances, supplier advances, stock, profit/costing, GST statutory register, financial reconciliation, and GST data-integrity audit. Preserve permissions and current access paths to restricted reports. |
| /masters | Sizes, terms templates, general information, technical specifications, bank accounts, and quotation templates; include every modal, row editor, default selector, and delete state. |
| /settings | Business profile, addresses, logo, document series, signatory/stamp, document visibility/defaults, quotation general information/technical specs/terms, invoice terms, closing note, and banking/settlement sections. Preserve uploads and existing save semantics. |
| /backup | Existing backup/export, cache/sync status, protections and clear-local-data confirmation. Do not invent restore/import or promise capabilities absent from the source. |
| /system-admin | Overview, companies, users, company access, existing setup states, diagnostics, forms, permission failures, empty states and confirmations. This receives equal design attention. |
| /about and /contact | Consistent public shell, typography, spacing, theme behavior, and existing working links/contact actions. Preserve accurate content and attribution. |
| 404 and root error boundaries | Thoughtful, compact layouts, readable messages, and working recovery actions appropriate to the current authentication state. Preserve reset/error-reporting behavior. No decorative full-screen artwork is needed. |
| Startup, configuration and access fallbacks | Startup/loading/retry, ConfigRequired, AccessDenied, install-PWA prompts, and any shared fallback. Preserve protected-content safeguards. |

## 9. Shared components and difficult details

Audit src/components/ui/**, src/components/app/**, accounting components, company switching, and platform-admin components. Every rendered instance should belong to the same system.

- **Buttons:** Consistent primary, secondary, ghost, and destructive hierarchy. Usually one prominent primary action per task region. Give each icon-only action an accessible name. Pending states must keep button width stable and prevent duplicate submission.
- **Forms:** Persistent labels, useful field help, visible required status, field-specific errors, and clear sections. Preserve user input after errors. Use suitable input types, autocomplete, and numeric keyboards without changing validation rules.
- **Editors:** Preserve explicit Save behavior. Changing a field, selecting a customer/product, adding an item, or switching a tab must not accidentally save or close the editor. Preserve existing draft recovery, dirty-close confirmation, and editor stability during real-time updates. Nested controls must not submit a parent form.
- **Line items:** Align description, unit, quantity, rate, discount, tax and amount clearly. Keep add/remove actions discoverable, long descriptions usable, totals legible, and keyboard entry efficient.
- **Tables:** Clear column hierarchy, aligned financial values, subtle separators, readable header contrast, predictable row actions, selection and pagination. Retain existing sorting/filtering capabilities. Avoid hiding essential business information for aesthetics.
- **Search/selects:** Design typing, focus, loading, empty results, selected values, long labels and keyboard navigation. Preserve the existing GlobalSearch, PartySearchSelect and PartyAddressSelect behavior and supported shortcuts.
- **Dialogs/drawers:** Consistent headings and action placement; correct initial focus, Escape behavior, focus return, scroll containment and dirty-form protection. Prevent stacked overlays from trapping users.
- **Other controls:** Tabs, tooltips, popovers, calendars, date filters, switches, checkboxes, radios, uploads, progress, badges, pagination and any other rendered primitive need full interaction states in both themes.
- **Document surfaces:** Include DocumentListPage, QuotationsPage, QuotationForm, LineItemsEditor, quick-create forms, insight drawers, MeasurementDialog, StructuredTermsEditor, GeneralInformationEditor, TechnicalSpecificationsEditor, address management, previews, DocumentCopyModal, reconciliation and advance-restriction dialogs.
- **Print/export:** Improve presentation where safely possible within the existing frontend rendering layer. Preserve document content, identifiers, tax fields, totals, signatures, stamps, snapshots, page-break behavior and A4/output contracts. Do not replace the export pipeline or let global dark styles leak into printed documents.
- **Feedback:** Style confirmations, Sonner toasts, skeletons, empty states and inline errors. Use actionable plain language. Persistent failures should remain discoverable after a toast disappears.

Preserve separate receivable and payable positions when a party is both customer and supplier. Keep advance/credit behavior and overpayment treatment intact. Preserve restrictions on historically used master records and posted documents; visual simplification must not turn deactivation/reversal into destructive deletion.

## 10. Dashboard and chart design

Take Photo 3's clarity and chart restraint, adapted to our actual data.

Give each KPI a clear label, value, and existing relevant context. Display a comparison only if the application supplies a valid comparison. Never substitute a zero for unavailable data, invent a trend, or make every positive numeric movement green regardless of its business meaning.

Use neutral supporting series with mint emphasis where appropriate. For multiple series, use a small distinguishable palette shared across related charts. Supply readable legends, real units, consistent formatting, sparse gridlines, unclipped axes, and usable tooltips in both modes.

Bars may have slightly rounded top corners. Lines should be crisp with restrained weight; interpolation must not misrepresent the data. Avoid decorative smoothing, excessive area gradients, 3D charts, animated counting, and expensive hover effects.

Charts must adapt to small screens and retain the existing textual data or a useful accessible summary. Give them stable dimensions so loading and filter changes do not shift the page. Style legitimate zero-data, missing-data, loading and error states separately.

## 11. Optimistic UI with trustworthy state

Make the application react immediately to input while keeping saved business state accurate.

- Apply tabs, expanded sections, filter selections and other local presentation changes immediately. Never delay a click response for an animation.
- Reuse the existing optimistic UI/mutation mechanisms where they already support a reversible action. Preserve canonical server confirmation, rollback, cache reconciliation and company scoping.
- For an eligible optimistic edit, distinguish pending from saved, retain the previous state for rollback, prevent duplicate writes, preserve user input on failure, and reconcile authoritative IDs/results once confirmed.
- Do not add a second optimistic cache over existing list overrides. Do not let an older response overwrite a newer edit or expose one company's pending data in another company.
- Payments, receipt allocation, posting/reversing vouchers, stock movements, final document numbering, irreversible deletion, access/role changes, restore/reset, and other authoritative actions must show immediate pending feedback but only show final success after the existing authoritative operation confirms it.
- Never show a success toast merely because an optimistic row appeared.
- Do not promise queued offline saves, automatic retries or universal offline mutation support unless the existing implementation actually provides them. Keep retry behavior within existing guarantees and avoid duplicate financial operations.

Speed means both responsive interaction and honest state. Users must understand whether a change is being saved, has saved, or needs attention.

## 12. Motion and interaction craft

Apply Emil Kowalski's guidance selectively: frequent actions should feel immediate; motion should explain a state change or acknowledge input. Use brief, interruptible transitions, generally below 300ms. Give pointer presses subtle feedback, anchor popover motion to its trigger, and keep centered dialogs centered. Avoid scale-from-zero entrances and transition-all. Prefer small opacity/transform changes. Keyboard shortcuts should respond without animated delay. Respect reduced-motion preferences and touch-specific hover behavior.

For this product, use approximately 100–160ms control feedback, 120–180ms menus, and 180–240ms drawers/dialogs as starting values. No cascading dashboard entrances, celebratory animations, constantly pulsing status dots, or animated chart redraws on routine interaction.

The current BmsStartupController contains a forced four-second visual gate. Remove the artificial visual waiting while preserving authentication/company readiness, concurrent initialization, authorized destination resolution, deep links, opaque protection against sensitive-content flashes, and real timeout/retry handling. A user whose workspace is ready should not wait for a branding sequence.

## 13. Responsive design and accessibility

Make the entire app practical on phones, tablets, laptops and large desktops.

Check at approximately 360, 390, 768, 1024 and 1440px widths, narrow landscape layouts, and 200% zoom. Handle long names, lengthy document numbers, large currency amounts, multiline addresses and crowded toolbars.

Use one-column forms on small screens, wrap controls intentionally, and keep dialog actions reachable above the on-screen keyboard. Put necessary wide tables in clearly scrollable regions; the page itself should not overflow horizontally. Do not clip content with blanket overflow hiding.

Target accessible contrast in both themes: at least 4.5:1 for ordinary text and 3:1 for large text and essential non-text UI indicators. Verify rather than assume. Maintain visible focus, semantic headings and tables, keyboard operation, associated labels/errors, understandable status announcements, and accessible dialog behavior.

Allow browser zoom. The current root viewport configuration restricts zoom; correct this frontend metadata issue. Do not remove focus outlines, disable selection globally, or rely only on hover/color to reveal critical information.

## 14. Performance requirements

Preserve or improve measured frontend performance.

- Reuse existing components and dependencies; introduce no ornamental asset downloads.
- Keep typography loading efficient. Avoid duplicate font requests and unnecessary UI font families while preserving signature/document needs.
- Keep calculations and subscriptions out of unnecessary render work. Preserve established query/caching behavior.
- Avoid broad state updates, unstable component keys, duplicated listeners, heavy blur and large animated shadows.
- Use existing pagination. Add virtualization only if a measured large-list problem warrants it and accessibility remains intact.
- Where appropriate, load genuinely heavy optional frontend features on demand without delaying core inputs or breaking existing navigation.
- Reserve layout space for charts, images, skeletons and pending controls.
- Never enforce a minimum loading duration to showcase a spinner or splash.
- Compare production builds and representative interactions under the same conditions before and after. Report actual bundle/performance observations and limitations; do not claim speed based only on appearance.

## 15. Implementation sequence and verification

Proceed through the complete redesign:

1. Audit routes, business boundaries, UI states and the baseline.
2. Establish semantic tokens and the two theme palettes.
3. Refine shared primitives, shell, responsive behavior and theme initialization.
4. Implement sign-in, dashboard and a representative dense editor/table to establish consistency; use them as internal calibration, then continue through all remaining routes.
5. Complete every nested view, overlay, public page, admin page, document preview and fallback.
6. Exercise existing workflows, slow-network/failure states and eligible optimistic rollback using test fixtures or a safe nonproduction environment.
7. Review the coverage checklist, fix inconsistencies, and verify the final result.

Use the repository's established package manager and tooling. Run build, lint, TypeScript checking where configured, and relevant tests. Existing npm script equivalents include npm run build, npm run lint and npm test. Inspect test requirements before execution; do not run production mutations or data-repair commands.

Pay particular attention to existing tests for form stability, explicit save, calculation parity, company isolation, auth routing, optimistic mutations, document deep links, posted-document correction, and printing/signatures. Do not remove assertions or weaken tests to disguise regressions. Tests tied solely to intentionally replaced visual markup or the superseded artificial splash duration may be updated with a clear explanation while retaining behavioral/security checks.

Manually verify representative routes and overlays in both themes, including 404, root error, denied/configuration states, browser refresh and theme persistence. Use keyboard-only navigation, reduced motion, mobile viewports, long content and safe failure simulation.

If authenticated test access is unavailable, use safe existing fixtures where possible and clearly identify what remains unverified. Never bypass authentication or claim untested screens are working perfectly.

## 16. Completion criteria and handoff

The work is complete when:

- Every discovered frontend route, nested section and rendered shared component has been reviewed and brought into the same design system.
- Light and dark mode both look intentional, remain readable, and persist without flashes or form resets.
- Existing features, data contracts, permissions, calculations and financial workflows retain their behavior.
- Nontechnical users can identify the page, understand its information, find the next action, and recover from errors.
- Pending, saved, failed, empty and unavailable states are clear and truthful.
- Existing workflows remain usable on small screens and with a keyboard.
- There are no known introduced console errors, broken links, clipped controls, inaccessible overlays, inconsistent colors, or material performance regressions.
- Server, schema, security, service and business-rule layers remain unchanged.

Deliver a concise summary, the route/state coverage checklist, representative light/dark desktop/mobile screenshots, commands run with their actual outcomes, performance observations, and any remaining limitation. For UI review findings, use a Before / After / Why table. Identify any pre-existing issue separately.

Do not stop after the dashboard, return a mockup as completion, add features from the inspiration images, or trade functionality for visual neatness.

**Final design judgment:** Choose the simpler treatment whenever decoration competes with comprehension. The finished BMS NEXT should feel carefully designed in every detail, visually substantial, responsive, and effortless to use.
