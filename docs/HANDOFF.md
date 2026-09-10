# IMS — Angular Port: Handoff / State

**Date:** 2026-09-09 · **Repo:** `https://github.com/tinnerrob/ims-prototype-angular.git` (`main`)
**Purpose:** Everything a fresh session needs to resume work with no guesswork.

## Run / test

```bash
cd /Users/robt/Projects/ims-web
npm install        # once
npm start          # dev server → http://localhost:4200 (hot reload)
npm run build      # production build to dist/ims-web
```

There are **no unit tests yet** (no Karma specs were written — see "Known gaps").

## What is built (functionally complete port)

Core (always-on) + all six industry modules, all on one typed, versioned,
persisted data store. Module views are gated by `ModulesService` + a route guard;
**Admin → Feature Modules** toggles them.

| Area | Path | Notes |
|---|---|---|
| Dashboard / roadmap | `features/dashboard` | landing + port checklist |
| **Administration** | `features/admin` | submenu shell: Locations & Types · Categories & Types · Feature Modules |
| Locations & Types | `features/locations` | ragged hierarchy + type vocabulary behind a tab strip (Admin submenu) |
| Categories & Types | `features/categories` | type tabs, add/rename/remove (Admin submenu) |
| Parties & Orders | `features/orders` | party CRUD + order headers + per-order **line booking** |
| Items & Stock | `features/items` | typed catalog: list/CRUD per type |
| Inspections | `features/inspections` | check in/out with meter/fuel log |
| Hand-Off & Custody | `features/handoff` | movements: issue/return + log |
| **Allocations & Scheduling** | `features/scheduler` | prototype-style scheduler (see below) |
| Field Service & Maintenance | `features/maintenance` | work orders on items |
| Labor & Timesheets | `features/timesheet` | task-chip → employee drag to clock in |
| Logistics & Dispatch | `features/logistics` | trucks + dispatch status board |
| Rentals & Sub-Rentals | `features/rentals` | vendor sub-rentals w/ spread |
| Billing & Invoicing | `features/invoicing` | invoices from priced orders |
| Fleet Telemetry | `features/telemetry` | live GPS sim + geofence feed |

Routes: `/admin` redirects to `/admin/modules`; the Admin submenu entries are
`/admin/locations`, `/admin/categories` and `/admin/modules`. The old
`/categories` and `/locations` deep links redirect into the Admin section, and
`/admin/location-types` redirects to `/admin/locations` (its types are now the
second tab there).

## Scheduler (the most complex view) — current behavior

Layout mirrors the prototype: **pickers left / calendar middle / conflicts + order
detail right**, with orders as the top rows.

- **Order rows on top, contracted by default.** Click an order (row/bar) to expand;
  expanding reveals one row per booked inventory item nested under it.
- **Drag-to-book:** drag a resource card from the left Inventory Pool onto an order
  (queue card or its timeline row) to book it at that order's window. Auto-expands.
- **Resize (day-granular in Week/Month; 15-min in Day):** every order and each
  inventory bar has edge handles. Dragging snaps to a day (Week/Month) or to
  15 minutes (Day). Line bars are clamped inside their order window; resizing an
  order clamps all its lines.
- **Views:** Day (24 one-hour segments, time-of-day windows), Week (Mon–Sun), Month
  (all days of the month). `‹ ›` steps by day/week/month.
- **Conflicts:** same resource on two orders that overlap is flagged red; the right
  pane lists conflicts + shows the selected order's detail.

### Scheduler data model (resume point)
- `Order` / `OrderLine` carry a **date window** (`startDate`/`endDate`,
  `YYYY-MM-DD`) and a **minutes-of-day window** (`t0`/`t1`, default 08:00–17:00).
  `OrderLine` optional `startDate`/`endDate`/`t0`/`t1` fall back to the order's.
- Geometry is **percentage-based** over the visible columns; resize maps pointer →
  column/day (or minutes-of-day in Day view) and persists via `DataService`
  (`updateOrderDates`, `updateOrderLineDates`, `updateOrderTimes`,

## Architecture

- `src/app/core/models.ts` — typed models (Party, Order/OrderLine, Item registry,
  Movement, Location, Inspection, WorkOrder, Timesheet, RentalSub, Vehicle/Dispatch,
  Invoice, module + status enums/labels).
- `src/app/core/data.service.ts` — one typed in-memory store + versioned
  localStorage persistence (`ims-web.store`); typed accessors + a simple pricing
  calc (`rateDaily x qty x days`). This is the **`apiAdapter` seam** — swap for an
  `HttpClient` later without touching features.
- `src/app/core/modules.service.ts` + `module.guard.ts` — module gating.
- `src/app/features/*` — one folder per view (component.ts/html/scss).
- `src/app/app.component.*` — shell (nav groups Core / Modules / Admin).
- `src/app/app.routes.ts` — route map (module routes are guarded).
- `src/styles.scss` — token-driven global theme; `index.html` loads Bootstrap Icons CDN.

## Conventions
- Standalone components (Angular 19), no NgModules. New control flow (`@if`/`@for`).
- Angular templates **cannot use inline arrow functions** — put logic in methods.
- Feature = model + DataService table (+seed/persistence) + list/overlay UI + route +
  nav + roadmap note. Build + serve each change; commit + push.

## Known gaps / next steps
1. **No unit tests** — add a few Jasmine/Karma specs (DataService, scheduler
   geometry/conflict) when convenient.
2. **Day-view gridlines:** the header shows 24 one-hour columns but row cells don't
   yet render subtle hour gridlines; add if visual polish is wanted.
3. **Order create/edit UI** has no time picker (lines default 08:00–17:00); a modal
   to set order `t0`/`t1` would help Day view.
4. **Tooltips** (resource/date hover) and a **double-click "Schedule Time"** popup,
   as in the JS prototype, are not ported.
5. **Backend:** point `DataService` at a real API (`HttpClient`) behind the same
   method surface (the `apiAdapter` seam), then wire the real backend.
6. Scheduler **drag-to-position** (drop a pool item at a specific calendar position
   to set its window) is not yet implemented — currently drops book the full order
   window.

## Source of truth for behavior
The original vanilla-JS prototype lives in the sibling repo
`/Users/robt/Projects/IMSdev/IMSdev/wwwroot/ims-prototype` (docs under
`docs/architecture/`: `modal-design-spec.md`, `AI-ONBOARDING.md`,
`app-review-*.md`). Match UI/behavior against `js/pages/scheduler.js` /
`js/pages/timesheet.js` when refining.

  `updateOrderLineTimes`).
