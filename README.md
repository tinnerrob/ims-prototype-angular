# IMS — Angular Port (ims-web)

**Angular 19.2 (standalone).** This is the migration home for the IMS product
(replacing the vanilla-JS prototype in the sibling `IMSdev` repo and its minimal
.NET static host). The port is **core-first**: an Inventory Management System
core with opt-in industry modules layered on top. It is being written incrementally,
porting one feature at a time from the prototype (source of truth).

> **Resuming work?** Read `docs/HANDOFF.md` — it documents the full current state,
> the scheduler behavior/model, conventions, and known gaps.

## Run locally

```bash
npm install        # once
npm start          # dev server → http://localhost:4200 (hot reload)
npm run build      # production build to dist/ims-web
```

There are **no Karma specs** — verification is `npm run check:store`, 25 harnesses
that compile the core services to JS and drive the *real* store from Node (no
browser, no server), plus two hand-rolled audits:

```bash
npm run check:store   # 210 runtime checks against the real store
npm run lint:ctor     # class-field initializer order
npm run lint:styles   # unused / re-set stylesheet rules
npm run lint:dead     # imported & exported names nothing references
npm run css:equiv     # prove a styles.scss change neutral (two built CSS files)
npm run e2e           # render the built app headless: routes, console errors, screenshots
```

## Structure

```
src/app/
├── core/
│   ├── models.ts            # Typed domain models + catalog type registry + the FormField vocabulary
│   ├── data.service.ts      # Typed in-memory store + versioned localStorage persistence (the apiAdapter seam)
│   ├── forms.service.ts     # The form-builder engine: schema resolution, coerce(), validate(), fieldsFor()
│   ├── vertical-metadata.ts # The business-type registry — the *seed* for a tenant's own verticals
│   ├── modules.service.ts   # Module licence flags (+ module.guard.ts: requireModule)
│   ├── session.service.ts   # Who the app is acting as (workspace + person) + can() permissions
│   ├── format.ts period.ts pricing.ts # Pure value/date formatting, date-period and money helpers
│   ├── seed/                # The demo fixture in modules: 24 pure data factories + the shared fixture facts
│   └── views.ts page-search.service.ts telemetry.service.ts
├── features/
│   ├── admin/           # Administration: Locations · Business type & Categories · Feature Modules
│   ├── assets/          # Assets (typed catalog: list + CRUD per category tab)
│   ├── dashboard/       # Landing + port roadmap
│   ├── handoff/         # Item Hand-Off & Custody (movements: issue/return + log)
│   ├── inspections/     # Receiving / Inspections (check in/out meter/fuel log)
│   ├── invoicing/       # Billing & Invoicing (module: invoices from orders)
│   ├── locations/       # Locations (Admin submenu: hierarchy + location type tabs)
│   ├── logistics/       # Logistics & Dispatch (module: truck dispatch)
│   ├── maintenance/     # Field Service & Maintenance (module: work orders)
│   ├── orders/          # Parties & Orders (party CRUD + order headers/detail)
│   ├── pricing/         # Pricing & Policies (rules engine, fees, tax, counterparty rate cards)
│   ├── purchasing/      # Purchasing & Receiving (purchase orders + the receiving desk)
│   ├── rentals/         # Rentals & Sub-Rentals (module: vendor sub-rentals)
│   ├── scheduler/       # Scheduling (module: week timeline + conflicts)
│   ├── telemetry/       # Fleet Telemetry (module: GPS sim live feed)
│   └── timesheet/       # Labor & Timesheets (module: time records)
├── shared/
│   ├── confirm/         # Confirmation dialog (ask before a destructive/state-changing act)
│   ├── dynamic-form/    # Renders FormField *values* (<ims-dynamic-form>)
│   ├── evidence/        # Document/evidence panel
│   ├── field-editor/    # Authors FormField *definitions* (<ims-field-editor>)
│   ├── modal-dismiss/   # ✕ / click-outside / dirty-guard for every modal
│   ├── record-view/     # Shared read-only record viewer (click a table row)
│   └── tip/             # Tooltips
├── app.component.*      # Shell: sidebar (inventory / movement / admin / module groups) + topbar + outlet
├── app.routes.ts        # Route map (feature routes + module-guarded ones)
└── app.config.ts
```

## Port pattern (per feature)

1. Add/extend typed models in `core/models.ts`.
2. Add/extend a table in `core/data.service.ts` (seed + repo accessors + persistence).
3. Create `features/<name>/` components that read/write through the service.
4. Register the route in `app.routes.ts` and the nav group in `app.component.ts`.

Table row actions follow one shared pattern (Admin → Locations is the reference):
`class="btn btn-ims-outline btn-sm2"` with a single icon and no label text —
`bi-plus-lg` add, `bi-pencil` edit, `bi-x-lg` remove, `bi-eye` view — labelled by a
`title` tooltip inside a `text-end text-nowrap` cell. The icon carries the action's
colour: remove = red, view = blue, edit = green (global rules in `src/styles.scss`).

Clicking a **table row** opens the shared read-only record viewer
(`src/app/shared/record-view`): `class="row-open"` + `(click)="showView($event, rec)"`
on the `<tr>`, and `<ims-record-view [view]="viewer" …>` in the template. The
handler ignores clicks on the row's own buttons, and `[editable]="true"` adds a
footer **Edit** that reopens the page's editor.

The `DataService` mirrors the prototype's `IMS.store`; a future `HttpClient`
adapter replaces its synchronous methods (the `apiAdapter` contract) without
touching feature code.

## Port roadmap

- [x] Foundation: shell, typed data store + persistence, routing, Categories.
- [x] Parties & Orders (core) — parties CRUD + order headers + detail + persistence.
- [x] Items & Stock (core) — typed catalog: list + CRUD per item type.
- [ ] Items & Stock (core) — typed catalog + item registry.
- [x] Item Hand-Off & Custody (core) — movements: issue/return + chain-of-custody log.
- [x] Locations — ragged location hierarchy (parent/child adjacency list) + location type vocabulary, as two tabs under Admin.
- [x] Receiving / Inspections (core) — check-in/out with meter/fuel + inspection log; the log's ‹ › date navigator leads the card header (at the far left of the table, shown once a Day/Week/Month filter is picked) with the All / Day / Week / Month chips and the **Log Inspection** button against the right end; clicking a logged inspection opens the inspection editor (no read-only step, no pencil column), and **Log Inspection** opens that same editor on a new record (the old side pane is gone).
- [x] Order line-item booking — add catalog items to order lines (connects Items ↔ Orders ↔ Hand-Off).
- [x] Module registry + gating (ModulesService + route guard) — Field Service, Labor, Rentals, Dispatch, Billing ported.
- [x] Admin — Administration shell with submenus: Locations, **Business type & Categories** (the tenant's own verticals, categories and stock fields), Feature Modules.
- [x] Scheduling — week timeline, conflict detection, item booking (overbooking allowed); blocks drag to another day, lists group by type, double-click opens the read-only asset/contract viewer without flashing the lane shut first (a lane click waits out the 250 ms double-click window); every modal closes on ✕ or a click outside the dialog (no footer Close/Cancel duplicates) and asks before discarding unsaved form edits.
- [x] Fleet Telemetry — GPS-sim live feed with geofence breaches.

**Port coverage complete:** full core + all 6 industry modules + module gating + admin, on a single typed, persisted data store.
- [x] Industry modules as **lazy-loaded guarded routes** — every feature page (and every admin child) is
      its own chunk, fetched on first navigation; the dashboard and the Administration shell stay eager.
      Initial bundle 830 kB → 478 kB, and the `canActivate` licence check still runs before the fetch.

Design tokens, modal, and column-profile specs live in the prototype repo under
`docs/architecture/` (`modal-design-spec.md`, `app-review-*.md`, `AI-ONBOARDING.md`).
