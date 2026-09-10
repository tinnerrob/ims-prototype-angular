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

## Structure

```
src/app/
├── core/
│   ├── models.ts        # Typed domain models + catalog type registry
│   └── data.service.ts  # Typed in-memory store + localStorage persistence (the apiAdapter seam)
├── features/
│   ├── admin/           # Administration shell (Locations, Categories, Feature Modules)
│   ├── dashboard/       # Landing + port roadmap
│   ├── categories/      # Categories (Admin submenu: type tabs, list + add/rename/remove)
│   ├── items/           # Items & Stock (typed catalog: list + CRUD per type)
│   ├── invoicing/       # Billing & Invoicing (module: invoices from orders)
│   ├── handoff/         # Item Hand-Off & Custody (movements: issue/return + log)
│   ├── inspections/     # Receiving / Inspections (check in/out meter/fuel log)
│   ├── locations/       # Locations (Admin submenu: hierarchy + location type tabs)
│   ├── logistics/       # Logistics & Dispatch (module: truck dispatch)
│   ├── maintenance/     # Field Service & Maintenance (module: work orders)
│   ├── rentals/         # Rentals & Sub-Rentals (module: vendor sub-rentals)
│   ├── scheduler/       # Scheduling (module: week timeline + conflicts)
│   ├── telemetry/       # Fleet Telemetry (module: GPS sim live feed)
│   ├── timesheet/       # Labor & Timesheets (module: time records)
│   └── orders/          # Parties & Orders (party CRUD + order headers/detail)
├── shared/
│   └── record-view/     # shared read-only record viewer (click a table row)
├── app.component.*      # Shell: sidebar (Core vs Planned groups) + topbar + router outlet
├── app.routes.ts        # Core-first route map
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
- [x] Receiving / Inspections (core) — check-in/out with meter/fuel + inspection log.
- [x] Order line-item booking — add catalog items to order lines (connects Items ↔ Orders ↔ Hand-Off).
- [x] Module registry + gating (ModulesService + route guard) — Field Service, Labor, Rentals, Dispatch, Billing ported.
- [x] Admin — Administration shell with submenus: Locations, Categories, Feature Modules.
- [x] Scheduling — week timeline, conflict detection, item booking (overbooking allowed); blocks drag to another day, lists group by type, double-click opens the read-only asset/contract viewer without flashing the lane shut first (a lane click waits out the 250 ms double-click window); every modal closes on ✕, a click outside the dialog, or its footer actions (no redundant footer Close).
- [x] Fleet Telemetry — GPS-sim live feed with geofence breaches.

**Port coverage complete:** full core + all 6 industry modules + module gating + admin, on a single typed, persisted data store.
- [ ] Industry modules (scheduling, dispatch, telemetry, labor, service, rentals,
      billing) as lazy-loaded guarded routes once the module registry is ported.

Design tokens, modal, and column-profile specs live in the prototype repo under
`docs/architecture/` (`modal-design-spec.md`, `app-review-*.md`, `AI-ONBOARDING.md`).
