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
| **Administration** | `features/admin` | submenu shell: Locations · Categories · Feature Modules |
| Locations | `features/locations` | ragged hierarchy + location type vocabulary behind a tab strip (Admin submenu) |
| Categories | `features/categories` | type tabs, add/rename/remove (Admin submenu) |
| Parties & Orders | `features/orders` | party CRUD + order headers + per-order **line booking** |
| Items & Stock | `features/items` | typed catalog: list/CRUD per type |
| Inspections | `features/inspections` | check in/out with meter/fuel log |
| Hand-Off & Custody | `features/handoff` | movements: issue/return + log |
| **Scheduling** | `features/scheduler` | prototype-style scheduler (see below) |
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
  **Overbooking is allowed** — an item already booked for the visible period can be
  dropped again (the conflict pane flags it); only a *retired* item (`active: false`)
  is refused.
- **Range-aware pool:** each pool card's badge is computed from the **visible period**
  (`availability()` → `bookingsInRange()`), not from a fixed/lifetime state, and
  re-evaluates when the Day/Week/Month view, the period pager or the bookings change:
  `n booked` (booked somewhere in the range), `On site · ORD-…` (out on custody now),
  `In Shop`, `Inactive`. `rangeLabel()` is shown above the pool for context.
- **Resize (day-granular in Week/Month; 15-min in Day):** every order and each
  inventory bar has edge handles. Dragging snaps to a day (Week/Month) or to
  15 minutes (Day). Line bars are clamped inside their order window; resizing an
  order clamps all its lines.
- **Move a whole block:** drag a bar's *body* (`startMove`) to another day
  (Week/Month) or another time (Day) — the window length is preserved, unlike the
  handles that move one end. Moving an order carries its bookings with it; a
  booking bar slides inside its order window instead of collapsing onto the edge.
  The first 3 px are ignored so a plain click still selects/expands, and a real
  drag swallows the trailing click.
- **Type grouping:** every mixed-type list — the expanded timeline rows, the
  Order Details booked list and the conflicts pane — is ordered by catalog type
  (`sortedLines()` / `typeRank()` in `CATALOG_TYPES` order: serialized, bulk,
  consumable, part, labor, kit, attachment), then name/date. The lists re-render
  from data, so the moment a conflict is resolved (bar moved/resized, booking
  dropped) the like types fall back together.
- **Double-click to view (read-only):** pool cards, resource bars and Order
  Details booking rows open the shared `ims-record-view` **asset** viewer;
  order bars and queue cards open the **order/contract** viewer. The conflicts
  pane has a per-row eye button for the same asset view. A lane click is held
  back for `DBLCLICK_MS` (250 ms, `onRowClick`) and dropped by the second click,
  so a double-click opens the viewer *without* expanding/contracting the lane
  first; `showOrderView()` still sets selection + expansion explicitly. The
  expand chevron keeps its own immediate toggle and swallows the `dblclick`, so
  double-clicking the expander never opens the viewer.
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
- `src/app/shared/record-view/*` — shared read-only record viewer (opened by a table
  row click) + the `isInteractiveTarget()` row-click guard.
- `src/app/shared/modal-dismiss/*` — `ModalDismissDirective` (`imsModalDismiss`),
  the single close policy for every hand-rolled modal root: click-outside **or** the
  corner ✕, plus the "discard changes?" guard.
- `src/app/shared/confirm/*` — `ConfirmService` + `ims-confirm-dialog` (mounted once in
  the app shell, raised above the editor modals) and the `snapshotForm()` /
  `formChanged()` compare-on-close helpers.
- `src/app/app.component.*` — shell (nav groups Core / Modules / Admin).
- `src/app/app.routes.ts` — route map (module routes are guarded).
- `src/styles.scss` — token-driven global theme; `index.html` loads Bootstrap Icons CDN.

## Conventions
- Standalone components (Angular 19), no NgModules. New control flow (`@if`/`@for`).
- Angular templates **cannot use inline arrow functions** — put logic in methods.
- Feature = model + DataService table (+seed/persistence) + list/overlay UI + route +
  nav + roadmap note. Build + serve each change; commit + push.
- **Table row actions** use one shared pattern (Admin → Locations is the reference):
  `class="btn btn-ims-outline btn-sm2"` + a single Bootstrap icon, no label text —
  `bi-plus-lg` (add a child), `bi-pencil` (edit/rename), `bi-x-lg` (remove),
  `bi-eye` (view). The label lives in a `title` tooltip, cells are
  `class="text-end text-nowrap"`, and a still-in-use row is `[disabled]` (global
  `.btn:disabled { cursor: not-allowed; }` in `src/styles.scss`).
  The icon carries the action's colour (global rules in `src/styles.scss`):
  **remove = red (`--danger`), view = blue (`--accent`), edit = green (`--success`)**.
- **Clickable table rows** open the shared read-only viewer
  (`src/app/shared/record-view`): `<tr class="row-open" (click)="showView($event, rec)">`
  plus `<ims-record-view [view]="viewer" …>` in the template. `showView()` bails out
  via `isInteractiveTarget(e)` when the click landed on a row control, so the row's
  own icon buttons keep working. `ViewModel` = title/subtitle/icon/badge + sections of
  label/value fields; `[editable]="true"` adds a footer **Edit** that reopens the
  page's own editor (`editFromViewer()`). Pages with an existing read-only detail
  modal (Orders → contract, Invoicing) route the row click into it instead, and
  Inspections skips the viewer entirely: a log row opens the inspection editor.
- **Modal dismissal:** every hand-rolled modal root
  (`<div class="modal show d-block" …>`) carries `imsModalDismiss (dismiss)="closeFoo()"`.
  The directive owns **both** exits — a press-and-release outside the `.modal-content`
  dialog and the corner ✕ — so the ✕ needs no `(click)` of its own and footers hold
  only real actions (Save, Download CSV, Edit). A press that starts inside the dialog is
  ignored, so drags out of a modal never dismiss it; `ims-record-view`'s footer renders
  only when `[editable]="true"`.
- **Unsaved changes:** an editor modal that can lose typed work adds
  `[imsDirty]="formDirty()"` next to `imsModalDismiss`. Take a snapshot when the editor
  opens and compare it on close (`snapshotForm()` / `formChanged()` from
  `shared/confirm/unsaved-changes.ts`):

  ```ts
  private formSnap = '';
  openForm(): void { this.form = …; this.formSnap = snapshotForm(this.form); this.modalOpen = true; }
  formDirty(): boolean { return formChanged(this.form, this.formSnap); }
  ```

  A clean editor closes straight away; a dirty one asks first (`ConfirmService.ask()`
  → `ims-confirm-dialog`: Discard / Keep editing). Closing after a successful save calls
  the component's close method directly, which never asks. Editor modals also work on a
  **copy** of the record (`openEdit(r) { this.editRecord = { ...r, … } }`) so Save is the
  only write — otherwise "discard" would have nothing to discard.
- **Inspection log:** the Receiving / Inspections page is just the log — the prototype's
  left-hand *Asset In / Out Inspection* pane is gone, and the log card's header is a bare
  control strip (**no title, no count badge, no Today reset**): the `All` / Day / Week /
  Month chips then the **Log Inspection** button against the right end, with the date
  navigator (the scheduler's ‹ › pager, Monday-based weeks) leading the header on the LEFT
  and only rendered once a Day/Week/Month filter is active (`.log-filter` / `.log-pager`).
  A log row click opens the **inspection editor** (the prototype's `inspectionModal` on the
  `data-edit` row) rather than the read-only viewer — the redundant pencil column is gone.
  **Log Inspection opens that same editor on a blank draft** (`newInspection()`): `isNew()`
  (`id === ''`) makes Save call `createInspection()` instead of `updateInspection()` and run
  the prototype's side-effects (check-out → asset *On Rent*, check-in → *Available*), and a
  new record re-anchors the log so a narrowed period can't hide it. The editor carries the
  fields the old pane had (Contract, Date) plus the live overage preview
  (`editOverage()`), and the log's **Overage** column badges any check-in over its meter
  allowance (prototype `meterOverage`).
- **Date navigators sit on the left:** every period pager — the range label between ‹ ›
  arrows — sits at the left of its bar/header: it takes up the free space and packs its
  content against its start, so the Scheduler and Timesheet timeline navs read
  `‹ range › … [Day|Week|Month]` (the toggle keeps the right end), Hand-Off's day stepper +
  Today button sit right after the card title (`me-auto`), and the Inspection log's
  navigator (`.log-pager`, only rendered with a Day/Week/Month filter) leads that header
  before the chips + **Log Inspection** button. See `.period-pager` in `styles.scss`.
- **One label wording for every navigator** (`periodLabel()` in `core/data.service.ts`, used
  by the Scheduler, Labor & Timesheets, the inspection log and Hand-Off): `Monday, Aug 17, 2026`
  for a day, `Week of Aug 17, 2026` for a Monday-anchored week (first day only — no end date)
  and `Month of August 2026` for a month. `periodPhrase()` is the sentence form for prose
  (`free for the week of Aug 17, 2026`, `No inspections logged for the month of August 2026.`)
  used by the Scheduler's availability line/note and the log's empty state. The label is one
  shared pill — `.period-pager .tl-range` in `styles.scss` (Hand-Off's stepper, whose label
  sits inside its `.btn-group`, matches it via `.btn-group .tl-range`).

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
