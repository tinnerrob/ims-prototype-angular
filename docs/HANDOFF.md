# IMS — Angular Port: Handoff / State

**Date:** 2026-09-11 · **Repo:** `https://github.com/tinnerrob/ims-prototype-angular.git` (`main`)
**Purpose:** Everything a fresh session needs to resume work with no guesswork.
**The three documents:** this file is the *state*; `docs/PLAN.md` is the *plan*
(the increments, their acceptance criteria, the open decisions and the
verification recipe); `docs/DATA-MODEL.md` is the *schema the backend implements*
— tables, columns, FKs, enums, what is derived and what the server must enforce.

## Run / test

```bash
cd /Users/robt/Projects/ims-web
npm install        # once
npm start          # dev server → http://localhost:4200 (hot reload)
npm run build      # production build to dist/ims-web
```

**Entering the app (B2, B3).** A fresh browser lands on the **sign-in form**, not on a
dashboard: the fixture ships signed out, and every screen is a child of a route parent
that carries `requireAuth`. The form lists the six seeded demo accounts with the
passwords this build publishes (click a row to sign in as that role) — a real
deployment has neither the list nor the passwords, and the sidebar chip's account
panel is now **Sign out**. A session also **ends**: signing in stamps an expiry, every
navigation rolls it (`session.touch()` is the guard's question and the app's activity),
and the store stops acting as that person the moment the stamp passes — a lapsed session
is cleared when the guard notices it and the form says the session ended. The window is
the *server's* term and the client only reads the stamp.

There are **no unit tests yet** (no Karma specs were written — see "Known gaps").
Runtime checks that don't need a browser: `npm run check:store` compiles the core
services to JS and drives the real store from Node (178 checks across tenancy,
attribution, the item↔location spine, per-place stock levels, the vertical
registry, the data-model document, the custody ledger, purchasing, the
transfer / adjust / reorder paths, configuration attribution, the day/week/
month windows the purchasing lists filter by, the order↔party join, the
counterparty rate cards, credentials / sign-in, session expiry, and the route
guard + sign-in screen's wiring — see `docs/PLAN.md` → "Verification recipe").

Build budgets (`angular.json`): the initial bundle warns at 500 kB (the app sits at
~738 kB, so that warning is expected); the `anyComponentStyle` warn threshold is **6 kB**
(raised from 4 kB), because `scheduler.component.scss` — by far the largest component
stylesheet, everything else lives in `styles.scss` — is ~4.4 kB minified. Builds should
otherwise be warning-free; a new component-style warning means a component's SCSS has
grown past that, not that the build broke.

## What is built (functionally complete port)

Core (always-on) + all six industry modules, all on one typed, versioned,
persisted data store. Module views are gated by `ModulesService` + a route guard
against the active tenant's licence flags; **Admin → Feature Modules** toggles
them. The workspace and the people in it (roles → permissions) are modelled in the
store, and **B1 + B2 + B3 are in**: each person has a credential (`user_credentials` — a
salt and a digest, never a password), `signIn()` proves one and `signOut()` ends the
session, a fresh fixture ships *signed out*, every screen sits behind `requireAuth`
(so the **sign-in form** is what a visitor meets), and the shell's chip offers Sign
out instead of switching the acting person. A session also lapses: an expiry is stamped
at sign-in, rolled by `touchSession()` on each navigation, enforced where identity is
read (`activeUser` / `sessionUserId()` answer nobody once the stamp passes) and cleared
where it is noticed. An empty session acts as nobody —
`activeUser` used to fall back to the first person in the tenant.

Stock only moves through documents and movements: a purchase arrives by receiving
against a purchase order (`receiveAgainst`), a reorder raises a **draft** PO rather
than editing a count, and a change of place or a physical count logs a
`transfer` / `adjust` movement from the Assets page. What the catalog *looks like*
(tabs, labels, columns, new-record defaults) is the tenant's vertical, read from
`core/vertical-metadata.ts` — not a conditional in a page.

| Area | Path | Notes |
|---|---|---|
| **Sign in** | `features/sign-in` | the one screen outside the shell (B2): proves the credential pair, prints the one refusal it gets back, says so when a session *ended* (B3, `?expired=1`), and lists the fixture's demo accounts so the seeded roles stay enterable |
| Dashboard / roadmap | `features/dashboard` | landing + port checklist |
| **Administration** | `features/admin` | submenu shell: Locations · Categories · Feature Modules (the vertical switch + what it exposes) |
| Locations | `features/locations` | ragged hierarchy + location type vocabulary behind a tab strip (Admin submenu); a node's **items**, **units** (`Qty`) and its logged movements are shown, and stock **and** history block removal |
| Categories | `features/categories` | type tabs (named by the tenant's vertical registry), add/rename/remove (Admin submenu) |
| Pricing & Policies | `features/pricing` | the pricing rules engine · overhead / service fees · sales-tax schedules · **counterparty rate cards** (negotiated rates per party, read by the order screens and used as the PO editor's cost default) |
| Parties & Orders | `features/orders` | party CRUD + order headers + per-order **line booking**; a party's name is read through the order's FK (never stored) and removal is refused while a document names it |
| Assets | `features/assets` | typed catalog: list/CRUD per type, scoped by location, with tabs/labels/columns/defaults read from the tenant's vertical registry; row actions **Move** (logs a `transfer` of a chosen quantity between places) and **Count** (logs a signed `adjust` at one place), the record viewer's **Ledger** section reads both back, and a counted row's stock is per place (`stock_levels`) |
| Purchasing & Receiving | `features/purchasing` | suppliers (parties w/ role) · purchase orders · receipts that land stock — the two document lists filter by **period** (All/Day/Week/Month + `‹ range ›`, the inspection log's control) |
| Inspections | `features/inspections` | check in/out with meter/fuel log |
| Hand-Off & Custody | `features/handoff` | movements: issue/return + log, each logged at a location FK |
| **Scheduling** | `features/scheduler` | prototype-style scheduler (see below) |
| Field Service & Maintenance | `features/maintenance` | work orders on items |
| Labor & Timesheets | `features/timesheet` | task-chip → employee drag to clock in |
| Logistics & Dispatch | `features/logistics` | trucks + dispatch status board |
| Rentals & Sub-Rentals | `features/rentals` | sub-rentals with a supplier-FK vendor (party w/ `supplier` role) + spread |
| Billing & Invoicing | `features/invoicing` | invoices from priced orders |
| Fleet Telemetry | `features/telemetry` | live GPS sim + geofence feed |

Routes: `/admin` redirects to `/admin/modules`; the Admin submenu entries are
`/admin/locations`, `/admin/categories` and `/admin/modules`. The old
`/categories` and `/locations` deep links redirect into the Admin section, and
`/admin/location-types` redirects to `/admin/locations` (its types are now the
second tab there). Core views added by the foundation pass: `/purchasing`
(Purchasing & Receiving, in the *Movement & Custody* nav group).

## Scheduler (the most complex view) — current behavior

Layout mirrors the prototype: **pickers left / calendar middle / conflicts + order
detail right**, with orders as the top rows.

- **Order rows on top, contracted by default.** Click an order (row/bar) to expand;
  expanding reveals one row per booked inventory item nested under it.
- **Drag-to-book:** drag a resource card from the left Assets pool onto an order
  (queue card or its timeline row) to book it at that order's window. Auto-expands.
  A resource we own **more than one** of opens the quantity prompt first
  (prototype `bookQtyModal` / `doAllocate`: "NN owned · NN committed on ORD-1001's
  window · NN available", a ×N field, an inline "Overbooked" note once the count
  passes what is free) — 24 jugs of hydraulic fluid or 300 traffic cones are booked
  in counts, not ones. Single-unit resources (serialized, labor) book straight away.
  **Overbooking is allowed** — an item already booked for the visible period can be
  dropped again (the conflict pane flags it); only a *retired* item (`active: false`)
  is refused.
- **Range-aware pool:** each pool card's state is computed from the **visible period**
  (`availability()` → `bookingsInRange()`), not from a fixed/lifetime state, and
  re-evaluates when the Day/Week/Month view, the period pager or the bookings change.
  `rangeLabel()` is shown above the pool for context.
- **Capacity, not one-unit-per-resource:** a booking is only a clash when the
  overlapping bookings need **more units than the item owns** (`data.capacity()` =
  `totalOwned` for bulk, else `qty` — on-hand for stock, 1 for a serialized unit or an
  employee). 24 jugs of hydraulic fluid on two orders is fine; 12 + 13 overlapping is
  not. `committedUnits()` (a sweep over the day boundaries — `peakUnits()` in the
  component) measures the peak committed at any instant inside the window under test,
  so *staggered* bookings never add up to a false conflict, and a handover day counts
  for both. Capacity 1 reproduces the old rule exactly.
- **Pool card layout** — one fact per row, so it reads as a record rather than a label:

  ```
  SS-204  CAT 320 Excavator                    id · name (name ellipsises)
  $650/d · Available                           cost · item status
  Booked on CT-2024-001          8/20/26 → 8/24/26   ← range right-justified
  ```

  There is **no type chip and no count badge** ("2 booked" is gone). The card's own
  colour *is* the highlight — `.res-busy` red, `.partial` amber, `.res-free` green,
  `.inactive` faded — and the state is spelled out in that third row. `.partial` now
  also carries **partly booked**: a multi-unit resource with bookings that don't fill
  it goes amber ("Booked on ORD-1001" + range, hover adds "12 of 36 out, 24 free") and
  only a period that commits everything it owns goes red. "— drop to
  overbook" was dropped from the row (it lives in the hover `title`, along with the
  full order list and span, and overbooking is still allowed).
- **The booking range shares the order row but is right-justified** (`.res-when` is
  `margin-left: auto` inside `.res-note.res-booked`, a `flex` row) and in **M/D/YY**
  (`fmtDay()`, not `data.fmtDate()`'s 08/24/2026). Flush-right beats trailing the
  order id — ids vary in width, so the dates now form one clean vertical column at
  the card's right edge across the whole list. The row is the only place that
  flexes: the other `line` states ("In the shop", "Retired") stay a plain sentence,
  and `.res-when` is `nowrap` + `tabular-nums` so a range never splits and the
  columns stay aligned. Fits with room to spare (41 chars ≈ 200px in ~318px of card
  text, worst case two orders ≈ 260px). The hover `title` still carries the full
  MM/DD/YYYY span.
- **`Availability` carries structured fields** (`badge` / `line` / `dates` / `note`),
  not one prose string: `line` = "Booked on ORD-1001" (all distinct orders, comma-
  joined), `dates` = the min start → max end across every booking in range (the old
  prose silently *dropped* the dates once an item was booked on two orders). `badge`
  survives only for the read-only asset viewer's "State"; `poolBadgeClass()` and the
  `.res-card-head` / `.badge-status` badge row it fed are deleted.
- **Pool select labels are the plain catalog names** (`poolTypes = CATALOG_TYPES`:
  "Bulk Resources", not "Items (Bulk Resources)") — "Items (…)" only made sense as
  an Assets-page tab label, and here it both duplicated the Assets card title and
  crowded the 340px pane. The card header is title-only for the same reason (the
  "drag to a block · dbl-click to view" hint moved into each card's `title` tooltip);
  a header hint ellipsed the title onto two lines.
- **Pane action buttons are pinned:** `.sched-side .card-body > .form-select /
  .pool-scope / .btn-sm2` are `flex: 0 0 auto` (only `.queue-scroll` flexes) — as
  plain column flex items they defaulted to `flex-shrink: 1`, so a long pool list
  squashed the `<select>` and the action button, leaving "New <resource>"
  visibly shorter than "New Order" (whose own `.sched-actions` body never shrinks).
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
- **Order Details line rows are three rows, led by ONE type dot** — no type badge:

  ```text
  ● SS-204 · CAT 320 Excavator        ×      ← code · name, one line (ellipsises)
    8/20/26 → 8/24/26                        ← compact M/D/YY range, inset
    $3,412.00                                ← what the booking bills
  ```

  The `.type-chip` is gone from these rows: the **dot carries the type**, painted from
  the shared resource-type palette (`.tl-res-*`'s `--tint-accent` core with the type's
  `--tint-bg` as a 2px halo — a miniature of that type's timeline bar, and the same hue
  as its chip), with `--slate-400` covering a type the palette doesn't name. **One dot
  only** — on the item row — and the rows under it are inset by
  `--bl-inset` (dot 7px + `.bl-main` gap 7px) so the date and the amount line up
  exactly under the name and the dot reads as the bullet for the whole block. (The halo
  is a `box-shadow`, i.e. painted *outside* the box, so it costs the row no layout width
  and `--bl-inset` stays dot + gap.) Hovering the dot names the type (`typeLabel()`) —
  the only place the badge's text survives. The "dbl-click a booking" header hint is
  gone (the row keeps its own `title`, and double-click still opens the viewer).
  `lineDates()` →
  `fmtDay()` gives the compact M/D/YY range, matching the pool cards. The amount is
  `lineRevenue()` = `data.lineTotal()`, a port of the prototype's
  `computeLineTotal()`: labor / consumable / part bill **once** (hourly billable,
  retail, cost price), kit + attachment their daily rate x billable days, and
  serialized + bulk step up to the weekly (`ceil(days / 7)`) / monthly
  (`ceil(days / 28)`) basis, risk premium applied. `orderAmount()` is **the sum of
  those lines**, so a column of bookings adds up to the Gross printed above it
  (before this, the Gross used `rateDaily x qty x billable days` for *every* type —
  which billed a labor line's hourly rate per *day*, e.g. $478k instead of $2.7k on
  the seeded CT-2024-001).
- **Quantity is editable per line** (`×[ 12 ]` at the right end of the date row,
  `.bl-qty`, and the drop prompt above books the first count) — rendered only when the
  item owns more than one unit
  (`lineCapacity()` > 1: consumables, bulk, stock, parts, kits, attachments), because
  that is exactly the set where a quantity is meaningful. Typing re-runs
  `data.updateOrderLineQty()` (clamped ≥ 1) and every dependent list re-renders from
  data, so a conflict clears the moment the numbers stop over-asking. The box is bound
  `[value]`/`(input)`, **not `ngModel`**: a rejected entry (0, blank, a fraction) has to
  be echoed straight back into the box, and with `ngModel` the model stores the clamped
  1 while the DOM keeps showing what was typed (the bound value never "changed").
  Multi-unit bars also print it on the timeline (`5d · ×12`, `models()` →
  `qtySuffix()`), so a booked quantity is visible on the calendar too.
- **Unbooking: the `×` at the right end of each booking row** (`.bl-x`, `removeBooking()`
  in `scheduler.component.ts`) — the exact inverse of drag-to-book
  (`data.removeOrderLine()`; the item goes back to the Assets pool). It is the row's only
  control, so it **asks first**, through the app-wide `ConfirmService` (the same prompt
  that guards unsaved edits, mounted once in the app shell; `scheduler` injects it),
  naming the item and the order — the row's own click target is "double-click to view"
  and dropping a line is not undoable. Details: the button sits at `.5` opacity rather
  than `0`, since there is no row hover on touch and `opacity: 0` would leave a focusable
  invisible control (it reddens on its own hover, rings on `:focus-visible`); it swallows
  `click` **and** `dblclick` so a fast double-click doesn't also open the viewer, and a
  second `confirm.ask()` supersedes the first, so that double-click still shows exactly
  one prompt. Every list reads `order.lineItems` live, so Order Details, the timeline
  rows and the conflicts pane all update the instant the line is dropped.
- **Double-click to view (read-only):** pool cards, resource bars and Order
  Details booking rows open the shared `ims-record-view` **asset** viewer;
  order bars and queue cards open the **order/contract** viewer. The conflicts
  pane has a per-row eye button for the same asset view. A lane click is held
  back for `DBLCLICK_MS` (250 ms, `onRowClick`) and dropped by the second click,
  so a double-click opens the viewer *without* expanding/contracting the lane
  first; `showOrderView()` still sets selection + expansion explicitly. The
  expand chevron keeps its own immediate toggle and swallows the `dblclick`, so
  double-clicking the expander never opens the viewer. The quantity box swallows
  its own `dblclick` for the same reason.
- **Views:** Day (24 one-hour segments, time-of-day windows), Week (Mon–Sun), Month
  (all days of the month). `‹ ›` steps by day/week/month.
- **Conflicts are capacity-aware:** a booking is flagged red only when the peak
  units committed across overlapping orders exceed what the item owns, and the pane
  row says why (`ci-why`, e.g. `30 needed · 24 owned`) next to the order id. Capacity
  1 keeps "any overlap is a clash" for serialized units, employees, … The right pane
  lists the conflicts + shows the selected order's detail.

### Scheduler data model (resume point)
- `Order` / `OrderLine` carry a **date window** (`startDate`/`endDate`,
  `YYYY-MM-DD`) and a **minutes-of-day window** (`t0`/`t1`, default 08:00–17:00).
  `OrderLine` optional `startDate`/`endDate`/`t0`/`t1` fall back to the order's.
- Geometry is **percentage-based** over the visible columns; resize maps pointer →
  column/day (or minutes-of-day in Day view) and persists via `DataService`
  (`updateOrderDates`, `updateOrderLineDates`, `updateOrderTimes`,
  `updateOrderLineQty`).
- **`OrderLine.qty`** is *units booked*, and it is what the conflict check weighs:
  1 for a serialized unit or an employee, on-hand for a consumable, owned for bulk.
  A drop books 1 and Order Details lets you type the rest (`lineCapacity()` > 1 →
  the `×[ n ]` box). `data.capacity(item)` is the ceiling — `totalOwned` for bulk,
  else `qty` — so widening it (a bigger stock count) is all it takes to allow more
  concurrent bookings.

## Architecture

- `src/app/core/models.ts` — typed models (Tenant/User/Role, Party, Order/OrderLine,
  Item registry, Movement, Location, Inspection, WorkOrder, Timesheet, RentalSub,
  Vehicle/Dispatch, Invoice, module + status enums/labels, `AuditFields`).
  `docs/DATA-MODEL.md` is the same thing as *tables* — the schema the API
  implements, and the document `check9` keeps in step with this file.
- `src/app/core/api.ts` — **the API seam** (C1a): the store's whole public surface as
  a contract, split into `ApiQueries` (reads) and `ApiCommands` (writes), `Pick`ed from
  `DataService` so no signature is copied, with two compile-time assertions that fail
  the build if a member is unclassified or the store does not satisfy it. `IMS_API` is
  the token a screen injects and `provideImsApi()` decides who answers it (`useExisting`
  — the store, as the same instance). `check17` re-derives the split from the store.
- `src/app/core/data.service.ts` — one typed in-memory store + versioned
  localStorage persistence (`ims-web.store`); typed accessors + the pricing calcs:
  `lineTotal(li, order)` (port of the prototype's `computeLineTotal()` — the
  per-booking gross Order Details prints and the queues show) and `orderAmount()`
  (its sum). It is the **first implementation** of the contract above; features move
  onto `IMS_API` in C1b, and `useExisting` is what keeps them talking to this instance.
- `src/app/core/session.service.ts` — who the app is signed in as (workspace +
  person) as signals over the store, `signIn()` / `signOut()`, `touch()` (the guard's
  question, B3: it rolls the expiry or reports that the session lapsed), and
  `can('stock.adjust')`-style permission checks.
- `src/app/core/auth.guard.ts` + `app.routes.ts` — `requireAuth` on the route parent
  every screen is a child of (B2); `/signin` is the one route outside it. It reads
  every navigation as activity and marks a session that *ended* with `?expired=1` so
  the form can say why it is on screen (B3).
- `src/app/core/modules.service.ts` + `module.guard.ts` — module gating, read from
  the **tenant's** licence flags (`Tenant.disabledModules`), not a browser pref.
- `src/app/features/*` — one folder per view (component.ts/html/scss).
- `src/app/shared/record-view/*` — shared read-only record viewer (opened by a table
  row click) + the `isInteractiveTarget()` row-click guard + `auditSections()`.
- `src/app/shared/modal-dismiss/*` — `ModalDismissDirective` (`imsModalDismiss`),
  the single close policy for every hand-rolled modal root: click-outside **or** the
  corner ✕, plus the "discard changes?" guard.
- `src/app/shared/confirm/*` — `ConfirmService` + `ims-confirm-dialog` (mounted once in
  the app shell, raised above the editor modals) and the `snapshotForm()` /
  `formChanged()` compare-on-close helpers.

### Identity, tenancy & attribution (invariants to preserve)

The store models the SaaS boundary the API will implement, so these are load-bearing:

- **Everything belongs to a tenant.** `tenantId` is on every table row; reads are
  meant to be scoped by it at the source (`DataService` accessors), and the
  `vertical` is tenant configuration rather than a display preference.
- **Every write is attributed.** `save()` is the store's single writer and stamps
  `createdAt/createdBy` on rows it has not seen and `updatedAt/updatedBy` on rows
  whose content moved, comparing against a shadow of the last persisted copy
  (`attributeWrites`, primed by `attributeSeed` in the constructor). New mutators
  therefore need no stamping discipline — but they must go through `save()`, and a
  new table must be added to `auditedRows()` to be covered (`check9` fails if the
  document's map names a store key the writer never covers). Every table a screen
  writes is covered, **including configuration** (A9): the settings rows are keyed
  by their natural key and the writer follows the row, so renaming a category or a
  location type is an edit, never a delete plus a create. The only two tables
  outside the writer are `tenants` and `users`, which `docs/DATA-MODEL.md` declares
  as exceptions with the reason.
- **Attribution is a foreign key, not a name.** `Movement.byUserId` (and every
  `createdBy/updatedBy`) holds a user id; display names come from
  `DataService.userName(id)`.
- **An item's place is a foreign key too.** `Item.locationId` points into the
  location hierarchy (`settings.locations`, an adjacency list), so a yard zone,
  an aisle, a rack and a bin are one thing — the prototype's free-text
  `bin: 'A-03'` string was folded into the tree (LOC-14 is the `Bin` row that
  label now names) rather than kept beside it. Labels are resolved at read time
  (`locationLabel()` for a cell, `locationPath()` for `Warehouse 1 › Aisle 1 ›
  Bay A1-01`), and the two questions a stock system asks are store queries, not
  screen logic: `itemsAtLocation(id, subtree)`. Removing a location is refused
  while stock is stored *at* it (`removeLocation()` returns `false`) — that is
  what keeps a stored FK always resolvable, so no screen has to invent a
  fallback for a dangling place.
- **A partner is a foreign key too, and the name is read through it.**
  `Order.partyId` points into `parties` and the customer's *name* is not stored
  beside it — `partyName(order.partyId)` prints it. That was the last column in
  the model that duplicated a join (A10 dropped it), and it is what makes a rename
  on the Parties grid reach every contract at once. The price is a rule that now
  has to hold: because there is no copy to fall back on, **a party a row names
  cannot be removed**. `partyRemovalBlockers()` — orders, purchase orders, their
  receipts, sub-rentals, and the party's rate cards (A11's FK) — is the single list
  the guard and the Customers
  grid's disabled Remove button read, so a dangling `party_id` cannot be created;
  the same shape as `locationRemovalBlockers()`, and the store's version of
  `ON DELETE RESTRICT`.
- **A negotiated rate is read the same way (A11).** A customer's price card
  (`price_cards`, one per counterparty, with `price_card_lines`) is what an order
  actually bills at: `lineTotal()` and `rateBasis()` both go through one reader,
  `cardRateFor(partyId, item, onDate)`, so the rate a row *prints* is the rate the
  amount is built from, on the same day and from the same source — and repricing a
  card never writes an order row. (The line's own risk premium is the one factor the
  *amount* applies and the printed rate does not, A11.2: the figure a row shows stays
  the figure a counterparty agreed.) The card carries an effective window and the
  date it is read on is the
  booking's own start (`lineStart()`), which is what makes a renewal a new card
  rather than a re-pricing of history. The catalog keeps its list prices
  underneath (`items.rateDaily` is the fallback). The buying side is deliberately
  asymmetric: a PO line stores the cost it was raised at, so a supplier's card is
  the PO editor's *default* — one rule, `poLineCostFor()` (the card, else the row's
  cost), applied when a line is picked and again when the supplier changes, so a
  supplier chosen *after* the lines (the reorder draft the dashboard raises names
  none) still reaches them, while a cost the buyer typed is never overwritten.
  Nothing references a card, so removing one
  needs no guard — it re-prices, visibly, on the order screens.
- **The invoice bills that rate whole (A11.2).** The same audit that confirmed A11's
  reader found the *money* disagreeing with it: `lineAmountForPeriod()` multiplied the
  rate `rateBasis()` returns — a weekly or monthly one, for most bookings — by the day
  count of the cycle, so a 21-day boom lift invoiced `2325 x 21` for what Order Details
  prints as three weeks. It bills whole units now (`wholeUnitsBilled()`, the prototype's
  rule: a unit goes to the cycle holding the majority of its days), on the **line's own
  days** (`lineDays()`), with the risk premium applied once to the amount while the rate
  a row prints stays the agreed one — so `rate x units x qty x (1 + premium)` reconciles
  and a booking's cycles add up to its `lineTotal()` (`check13` asserts the sum to the
  cent). The period length is a counterparty term too: `partyCycleDays()` reads
  `parties.billing_cycle`, a column the model had carried since A5 with no reader at all,
  and "Run Next Cycle" is a real roll now (`runNextCycle()` — the store method it called
  only ever raised cycle 1 for orders that had none, so no second cycle could exist).
  The same pass fixed the fee chain's one wrong constant: the damage waiver is **3%** of
  the base, the prototype's figure (`invoiceCompute`, js/pages/invoicing.js:111), where
  the port had 5% — a slip from the original port commit that nothing had questioned
  because no number on screen was ever reconciled against another.
- **A movement's place is the same FK.** `Movement.locationId` points at the same
  hierarchy, so "what left Yard A this month?" is `movementsAtLocation(id)` — a
  subtree query — instead of a substring search on a stored label. The store
  resolves the place once, in `logMovement`: an *issue* leaves from where the unit
  sits, a *return* comes back to the place the editor chose, and that place then
  becomes the unit's `locationId` (a return re-homes it; an `adjust`/`transfer`
  records a place without moving the shelf). History is append-only, so a movement
  never re-points — which is why a location the ledger mentions is refused for
  removal too (`locationRemovalBlockers()`, read by both the guard and the grid's
  disabled button).
- **Purchasing is how stock arrives.** A supplier is a *party* carrying the
  `supplier` role (`Party.kinds`), so both sides of the business are one table
  (`customerParties()` / `supplierParties()`); a purchase order is what was
  ordered and **stores no copy of what arrived** (`poLineReceived()` sums the
  receipts and `poProgress()` derives none/partial/received), and
  `receiveAgainst()` is the one call that creates stock: it tops a SKU up by
  quantity (moving-average cost), creates one row per serialized unit at the
  ordered cost/rate, places all of it at a location FK, and logs a `receive`
  movement per landed row (`Movement.receiptId` is the buying-side FK beside
  `orderId`). A posted receipt is append-only — no edit, no delete — and a PO
  with receipts can't be deleted; the seed posts its fixture through the same
  call, with a pinned clock and actor.
- **A counted row's stock is per place.** `stock_levels` (one row per item +
  location, only while it holds something) is the *truth* for bulk / consumable /
  part rows: `qtyOnHand` (and a bulk row's `qtyAvailable` / `totalOwned`) is their
  sum and `Item.locationId` is their busiest holding, both recomputed by
  `syncStockTotals()` after every level write — a mutator can't set them (a patch
  carrying them is stripped), so the shelves and the totals can't drift.
  `moveStock(type, id, from, to, qty, note)` takes a quantity out of one place and
  puts it in another (an emptied place loses its row, a place that already holds
  the row is topped up), `adjustStock(type, id, place, counted, note)` counts one
  place and logs the difference there, and `receiveAgainst()` lands stock as a
  level (delivering into a bin the SKU isn't in *adds a place*). `placements(item)`
  is the one read — level rows for counted stock, the single FK for a unit —
  behind `itemsAtLocation()`, the grid's Location cell (`Bay A-03 +1 more`), the
  record viewer's breakdown and `locationStockQty()`. A unit (serialized, kit,
  attachment) keeps its single FK: one machine is one thing in one place.
- **A vertical is metadata on the tenant, not a conditional in a page.** Which tabs
  the Assets catalog exposes (and in what order), what each is called, what its
  "add" button says, which columns its grid prints and what a new record starts as
  all live in `src/app/core/vertical-metadata.ts` — one entry per `VerticalKey`,
  read through `DataService.verticalMeta()`. Admin → Feature Modules switches the
  tenant's vertical and lists what it exposes (tab by tab), so the effect is
  visible where it is chosen; the Assets page re-shapes itself with no reload (its
  constructor `effect()` follows the store revision and moves to the vertical's
  `defaultTab` if the open tab isn't one of its own), and the Categories page takes
  its tab names from the same registry. Two rules keep it honest: a column may only
  name a field the model has (check8 fails the build otherwise — it caught a
  warehouse bulk line reading a `qtyOnHand` a bulk row doesn't store), and a tab
  list is *not* a permission (that is the module licence, `Tenant.disabledModules`).
- Opening balances are levels without movements, and a counted row's quantity is
  **not** patchable: `updateItem()` strips `qty` / `qtyOnHand` / `qtyAvailable` /
  `totalOwned` / `locationId` for a counted type, so the editor can set what a row
  *is* but never what it holds (a unit row still re-places by edit — its FK is its
  placement).
- **Bumping `VERSION` replaces saved data**, so the shell must keep saying so
  (`DataService.reseeded` → the banner in `app.component.html`).
- **The schema is written down, and the document is guarded.** `docs/DATA-MODEL.md`
  is the tables/columns/FKs/enums the API implements, derived from `models.ts`
  (30-odd tables, the audit columns on each, `stock_levels`, the ledger, the
  buying side, what is *derived at read time and never a column*, what the server
  must enforce, and what is deliberately not modelled yet). `check9.mjs` reads the
  doc, `models.ts` and `data.service.ts` as text and fails the harness if a model
  has no table, a table invents a name, a column is not a field, a `NOT NULL`
  contradicts the type's optionality, an enum drifts, a foreign key dangles, a
  mapped table names a store key `auditedRows()` never writes (unless the doc
  declares it an exception — only `tenants` and `users` are), the five derived
  stock columns are not exactly `DERIVED_STOCK_KEYS`, or the per-type status table
  stops matching `ITEM_STATUSES`. So: a new field is added to `models.ts` (and
  used) *first*, then written into the doc — a column the model does not have is a
  bug in the doc, not a wish, and a table the writer does not stamp is a hole the
  harness names for you.
- `src/app/app.component.*` — shell (nav groups Core / Modules / Admin).
- `src/app/core/page-search.service.ts` — the page-scoped topbar search (below).
- `src/app/app.routes.ts` — route map (module routes are guarded).
- `src/styles.scss` — token-driven global theme; `index.html` loads Bootstrap Icons CDN.

## Conventions
- Standalone components (Angular 19), no NgModules. New control flow (`@if`/`@for`).
- Angular templates **cannot use inline arrow functions** — put logic in methods.
- Feature = model + DataService table (+seed/persistence) + list/overlay UI + route +
  nav + roadmap note. Build + serve each change; commit + push.
- **One stylesheet, layered — pages override it, they don't restyle it.** `src/styles.scss`
  is the base → refresh → polish cascade, and each layer is the last word on what it
  declares, so a rule states only what *it* decides: a declaration a later layer re-sets is
  dead weight. Reuse the base before adding a page rule — the `Today` reset is the single
  `.btn-ims-quiet` chip on all three pager headers, every list toolbar shares
  `.filter-input.search`, and page SCSS files hold only real page overrides (pool-card
  density on the Scheduler, the inspection log's filters, month-head tuning). When a shared
  control needs a variant, add the variant beside its base in this file with a name
  (`.btn-ims-quiet`, `.btn-ims.btn-create`, `.btn-ims-outline.btn-sm2` row actions) rather
  than a page-scoped copy, and delete rules whose classes no template mentions
  (`.rn-*` / `.rw-*` / `.ho-*` / `.tc-*` were prototype leftovers, as were the dead
  `#viewToggle` / `#tsViewToggle` / `#tlWeek` / `#schedQueue` / `#invPanel` / `#ccPanel`
  hooks). A stylesheet edit is verifiable without a browser: compile it (`npx sass`)
  before/after and compare the *winning* declaration of every `(selector, property)` pair —
  a pure declutter moves none of them.
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
- **Topbar search = page search** (`src/app/core/page-search.service.ts`). The box is
  not global: the shell renders it only on the views whose `VIEWS` entry carries a
  `search` placeholder — Assets, Hand-Off, Receiving / Inspections, Parties &
  Orders, Fleet Telemetry, Labor & Timesheets, Field Service, Billing & Invoicing — and
  hides it on every other view (Dashboard, Scheduling, Locations, … have no search box).
  A page searches *all* of itself through the service's shared `matches()` rule (the
  same case-insensitive "any field contains the query" on every page), the query
  survives tab switches, and the tab pills/counts then read as matches instead of
  totals (Assets filters all seven types at once, Hand-Off all four lists,
  Parties & Orders both sub-tabs — the point of "search the page, not the tab").
  The shell also shows a "shown of total" chip beside the box: a page publishes it once
  from its constructor with `search.report(() => ({ shown, total }))`, a thunk the
  service runs *inside* a `computed`, so the chip stays live off the page's own signals
  with no push. That thunk is why the shell hands the box over at **NavigationStart**
  (before the target page is constructed and reports) — doing it on NavigationEnd wiped
  the fresh report. Pages with no count row (Inspections, Field Service, Invoicing, and
  the timesheet board) word their `@empty` row for the search instead
  ("No work orders match your search."). This deliberately replaces the prototype's
  global search (`App.onSearch`, which jumped to Telemetry/Items with `?q=` from any
  page), and the per-page search fields those pages used to carry (`.filter-input.search`
  on Items, Hand-Off, Telemetry) went with it — Admin → Locations keeps its own, since
  that view has no page search.
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
- **Date navigators sit on the left … except in a timeline nav:** every period pager — the
  range label between ‹ › arrows — takes up the free space and packs its content against one
  edge, so the page reads selector-first and controls-last. The Scheduler and Timesheet
  timeline navs use `.period-pager.end`, which packs the pager against the **right** end:
  `[Day|Week|Month] … ‹ range › [Today]`. Hand-Off's day stepper + Today button sit right
  after the card title (`me-auto`). The two **log filters** read the same way — chips first,
  then the navigator, and the navigator only exists with a Day/Week/Month filter: the
  Inspection log's (`.log-pager`) sits in its card header between the `All/Day/Week/Month`
  chips and the **Log Inspection** button, and the two Purchasing & Receiving lists (POs,
  Receipts) put theirs in the body's filter row beside the record count, since that header's
  left is already the sub-tab strip. Both window their rows through the same
  `periodBounds()`. See `.period-pager` in `styles.scss`.
- **A "Today" reset trails the period navigation** (Hand-Off's board was the first: ‹ › day
  stepper, then `Today`, then the action). The two calendars now carry the same control in
  the same place — `goToday()` + `isToday()` on the Scheduler, `goToday()` + `atToday()` on
  Labor & Timesheets (`atToday` only because `isToday(d)` there is the day-header flag) —
  with the hand-off board's semantics: **keep the Day/Week/Month granularity**, land on the
  first day the pager would show for that view (Monday / the 1st / today — the same day
  `periodLabel()` names, via the shared `periodStart`/`periodStartOf` helper), and
  **disable the button while that period is already on screen** so it never reads as a
  no-op you can keep pressing. Side effects mirror each calendar's own pager: the Scheduler
  clears the expanded lanes and the focused order (exactly like `shift()`), the Timesheet
  leaves lane expansion alone (like `nav()` — the same employees are on the board either
  way).
  All three buttons are `class="btn btn-ims-quiet btn-sm2"` — one shared chip, not three
  copies: `btn-ims-quiet` (in `styles.scss`, "6. Buttons") is **grey at rest *and* when
  disabled**, because the earlier `btn-ims-outline` version took that class's brand blue
  whenever the pager happened to be off today while the two disabled ones fell back to
  Bootstrap's grey — same button, two colours. Grey in both states keeps the chip stable as
  the period moves; the disabled state only flattens it (Bootstrap's `opacity: .65` fade is
  deliberately overridden, it read as a broken control).
  The two **log filters** carry no `Today` on purpose: their default is `All` with the newest
  row first, so today is already the top of the list — the chips are there to narrow *away*
  from it, and coming back is one click on `All`.
- **One label wording for every navigator** (`periodLabel()` in `core/data.service.ts`, used
  by the Scheduler, Labor & Timesheets, the inspection log, Hand-Off and both purchasing
  lists): `Monday, Aug 17, 2026`
  for a day, `Week of Aug 17, 2026` for a Monday-anchored week (first day only — no end date)
  and `Month of August 2026` for a month. `periodPhrase()` is the sentence form for prose
  (`free for the week of Aug 17, 2026`, `No inspections logged for the month of August 2026.`)
  used by the Scheduler's availability line/note and the two logs' empty states. A **list**
  filter (the inspection log, the two purchasing lists) takes its window from
  `periodBounds(view, anchor)` beside it — one definition of "this week" (Monday-based, month
  to its last day) for every pager, with the cursor kept on the period's first day so the
  label names the window the rows were filtered by. The label is one
  shared pill — `.period-pager .tl-range` in `styles.scss` (Hand-Off's stepper, whose label
  sits inside its `.btn-group`, matches it via `.btn-group .tl-range`).
- **Calendar styling (Scheduler + Labor & Timesheets) is token-driven** — both calendars
  share one timeline block in `src/styles.scss`; change it there, never per page:
  - *Row rhythm:* `--tl-bar` (a sub/resource bar) → `--tl-bar-base`
    (`calc(var(--tl-bar) * 1.5)`) → `--tl-row` / `--tl-row-base` / `--tl-track…`. A lane's
    **base** row (order/contract bar) is therefore exactly **1.5×** the resource rows it
    books, so the primary task leads. `.tl-row-track` stretches to the row height and
    `.tl-block` is inset 4px top/bottom, so the visible bar is `row − 8px` — the sizing
    maths is expressed on the bar and the row follows. Re-size in **one** place: `--tl-bar`.
  - *Banded rows:* a striped row swaps the `--tl-band-label` / `--tl-band-track` pair
    for its `…-alt` twin; the band covers the sticky label column *and* the bar track, so
    a stripe reads as one line. The `…-alt` tints are **light on purpose** (`#f0f4fa` /
    `#eef3f9` — a ~10% luminance step off white): heavy zebra fought the bar colours.
    **Who gets striped differs by page:** Labor & Timesheets
    has nothing to group its rows by, so it simply alternates
    (`.tl-body > .tl-row:nth-child(even)`); the Scheduler takes parity from the *template*
    instead — `[class.band]="i % 2 === 1"` on the booked-item `@for` — so **the stripes
    restart at every order** rather than running on down the whole calendar. Data tables
    band the same way via `--row-band` on `.table tbody tr:nth-child(even)` (declared
    **before** the hover rule so hover still wins).
  - *Flush table, not floating strips:* `.tl-body` / `.tl-lane` have **`gap: 0`** and
    `.tl-row-track` / `.tl-day-head` are **square** (`border-radius: 0`), so rows share one
    continuous gridline and the calendar reads as a table. `.tl-head` has no bottom margin
    either — its sticky `box-shadow` is what separates it from the first row. The line
    between two rows is `--tl-grid` (`#e4e9f0`), applied as the track's inset ring (the
    real border is stripped to keep bars aligned with the header columns — see the
    "Calendar alignment" block at the end of the file); it is chosen to read on a white,
    banded *and* grey row. `--slate-100` (the old ring) vanished on a banded row.
  - *Lane heading:* the order/contract row (`.tl-row-order` / `.tl-row-contract`) is
    deliberately **not** a stripe — it pins both band vars to the flat **blue**
    `--tl-base-row` so label + track read as one continuous blue band, and its bar falls
    back to the blue `--tl-base-bar` / `--tl-base-ink` / `--tl-base-accent` (it carries no
    `--tint-*`). The pastel item rows underneath then read as that order's detail lines,
    and the blue row is what makes "banding resets here" obvious. Blue is the order's
    colour everywhere — this band, the Timesheets' job bars and the active-contract
    pickers — so the lead row announces itself before you read the id. Keep
    `--tl-base-row` **light** (`hsl(214 40% 92%)`): it spans the full width, so a deep
    blue turns an unscheduled stretch into a black hole; the depth belongs to the bar
    (`hsl(214 52% 86%)`, a step deeper than the bulk pastel so the heading leads it),
    and the label takes the same blue ink (`.tl-row-order .tl-row-label`, with its
    `.text-muted2` party line at `hsl(214 32% 42%)`).
  - *Bar colours:* pastel fill + dark same-hue ink, never solid saturated blocks
    (monday-style). The recipe: **hue** per type, spaced around the wheel so no two types
    are confused — green 148 (serialized), teal 168 (kit), cyan 192 (part), blue 214
    (bulk), violet 264 (labor), pink 326 (attachment), amber 30 (consumable) and red 0 for
    a conflict; **fill** at S 50-82% / L 89-92% (pastel = *tinted* and light, not grey —
    the old S 25-35% fills read as dirty white next to the new ones), **ink** a dark tone
    of the same hue (L 19-32) and **accent** the mid tone that draws the 3px left edge +
    the 40% border + the Order Details dot. Each pairing measures **≥ 7.5:1** on its own
    fill (sub-line at `opacity: .9` stays **> 5.9:1**, so the 12px title *and* the 10.5px
    sub-line stay readable instead of leaning on the fill to separate bars) and every
    accent stays above **3:1** on white for the dots/edges. Declared once per type on
    `.tl-res-*` (`styles.scss`, the block commented "THE RESOURCE-TYPE PALETTE" — the
    single source of truth), mirrored by `.ts-*` (Timesheets) and `.tc-*` (the type chips
    in Orders / Invoicing / the conflicts pane, previously on the status tokens and
    disagreeing with the calendar — a `bulk` chip was purple while a `bulk` bar was blue).
    In the Timesheets `--tcol` is that type's accent, so the icons, the legend swatch,
    the chip/punch-target edges and the summary mini-bars all match the dot and the bar
    edge; the mini-bar itself now copies the bar recipe (type fill + accent on the left)
    instead of a half-mixed tint. `.tl-h` / `.ts-h` resize handles are dark, not white,
    since the bars are light. `ts-order` deliberately reuses the Scheduler's lane-heading
    blue (fill L 86, not the lighter bulk pastel): the order is the job you clock into and
    leads the row on both calendars. `ts-idle` (cool slate) and `ts-lunch` (warm stone,
    S 22-24%) are the two neutrals — warm enough apart to tell apart at a glance, muted
    enough not to be mistaken for the amber `overhead`.
  - *No selected row chrome:* clicking a calendar row sets the focus id but paints
    nothing — the work is drag/drop driven and the Order Details inspector reports the
    selection, so a blue row/ring was noise. Only the left **queue card**
    (`.queue-order.active`) and the inspector mark the focused order.
- **Right-hand inspector cards sit straight on the page:** `.sched-inspector` is a bare
  flex column (no background/border/padding of its own), so Scheduling Conflicts +
  Order Details read like the `.sched-side` panels — a card, not a card-on-a-card.
- **Both right-hand cards split the pane exactly like the left pair.** `.sched-inspector`
  no longer scrolls as a whole (the long conflict/booking lists used to stretch the pane
  and push the second card out of view): it is `height: 100%; overflow: hidden`, each
  `> .card` is `flex: 1 1 0; min-height: 160px` with `overflow: hidden`, and the card
  bodies are the same flex column as the left pane, so the two lists land at the same
  heights as the queue and pool lists. Each card then scrolls **its own** body:
  `.conflict-list` and `.booking-scroll` (`flex: 1 1 auto; min-height: 0; overflow-y:
  auto`) are the scroll regions. The conflicts explainer line and the Order Details
  summary (id · project · dates · Days / Gross / Items booked, wrapped in `.od-summary`,
  `flex: 0 0 auto`) stay pinned above them; only the bookings scroll.
- **Card titles are short:** the left cards are titled **Orders** (was "Orders &
  Scheduling") and **Assets** (was "Inventory Pool") — the pane context already says
  they're the scheduler's pickers, and the longer titles were the ones ellipsing onto
  two lines in the 340px pane.

## Known gaps / next steps
1. **No unit tests** — add a few Jasmine/Karma specs (DataService, scheduler
   geometry/conflict) when convenient.
2. **Day-view gridlines:** the header shows 24 one-hour columns but row cells don't
   yet render subtle hour gridlines; add if visual polish is wanted.
3. **Order create/edit UI** has no time picker (lines default 08:00–17:00); a modal
   to set order `t0`/`t1` would help Day view.
4. **Tooltips** (resource/date hover) and a **double-click "Schedule Time"** popup,
   as in the JS prototype, are not ported.
5. **Backend / the API seam (Phase C).** Point the client at a real API
   (`HttpClient`) behind the same method surface, then wire the real backend. The four
   phases beyond Phase A are recorded in `docs/PLAN.md` — **B authentication · C this
   seam · D persistence/offline · E tenant administration** — with their scope and
   acceptance criteria. **B is complete** (B1/B2/B3, each with its own note and harness
   there) and **C is the active phase**: C1a has landed the contract
   (`core/api.ts` — the store's surface split into queries and commands, held by two
   compile-time assertions and `check17`), and **C1b is next** (the features inject
   `IMS_API` instead of the `DataService` class). Still open on the *auth* seam, and
   named in DATA-MODEL's "not in the model yet": **revocation** — nothing cuts a session
   short before it is given up, and no other client is told one ended (the API's job: a
   `sessions` row or a token version).
6. Scheduler **drag-to-position** (drop a pool item at a specific calendar position
   to set its window) is not yet implemented — currently drops book the full order
   window (a multi-unit resource asks for its count first; the count is editable
   afterwards in Order Details). The prototype also gated overbooking behind a
   second confirm dialog (`overbookModal`); here the prompt shows the same facts as
   an inline note and lets the booking through, which is this port's existing
   "overbooking is allowed, the pane flags it" policy.
7. **Consumable stock is not decremented by a booking** — a booked consumable is a
   commitment against `qtyOnHand` for the conflict check, but only *parts used* on a
   work order draw stock down (`DataService` work-order posting). Deciding whether a
   booking should also reserve/move stock is open.
8. **Invoicing bills what the Gross prints (closed in A11.2).** It used to multiply
   the rate `rateBasis()` returned — a *weekly* or *monthly* figure — by the day count
   of the cycle, so a 21-day boom lift invoiced `2600 x 21` where Order Details prints
   `2600 x 3` (and an expired-card rental could not agree even with itself, since the
   printed rate and the amount read different day counts). `lineAmountForPeriod()` now
   bills whole weeks/months (`wholeUnitsBilled()`, js/pages/invoicing.js), on the
   line's own days, so a booking's cycles tile it and sum to its `lineTotal()` — and
   the period length comes from the party's cadence rather than the pricing default.
   What is still open here: cycles are raised only by the Invoicing page's button
   (`runNextCycle()` — nothing runs on a timer), and a raised invoice can only change
   status, with no correction path (a credit note or a re-issued cycle) — deleting it
   is the only way to undo one. The line's risk premium is also applied to money but
   printed nowhere: the invoicing detail shows the agreed rate with the amount beside
   it (as the prototype does), so on a hazmat or overtime line the two figures only
   reconcile for a reader who knows the multiplier — naming it in that panel is a
   small UI job and the obvious next step there.

9. **Only `issue`, `return`, `receive`, `transfer` and `adjust` are ever
   written, and the last two only by the Assets page.** `transfer` and `adjust`
   gained their write paths in A5.1 (`moveStock()` / `adjustStock()` — the *Move*
   and *Count* row actions, each logging a movement the record viewer reads back),
   but there is still no bulk/cycle-count *screen* (a count sheet for a whole
   location at once), and a placement edited on a **counted** row's Location field
   is refused outright rather than logged (a unit row's edit still re-places it) —
   deliberately, as stock moves through movements.
10. **A counted row's quantity is in a table, but nothing *shows* the table.** A6
    gave stock levels (`stock_levels(item_id, location_id, qty)`, `qtyOnHand` as
    their sum): a part can now sit in two bins with a count in each, the Assets
    grid's Location cell says "+N more" and its record view lists every place with
    its count, and the Locations grid gained a **Qty** column. What is still
    missing is a *screen* for the table itself — a place's stock list ("everything
    in Bay A-03") and a count sheet for a whole location at once — and kits /
    attachments are still one place + `qty` rather than levels (they are an owned
    count, not a shelved quantity; see `docs/PLAN.md`'s open decision 1).
11. **The vertical registry holds the catalog's shape, not everything
    industry-shaped.** Left where they are, deliberately (see `docs/PLAN.md`'s open
    decision 2): per-vertical *category seeds*, per-vertical *search wording and
    view titles* (the shell's `VIEWS` titles are static, so every vertical's page is
    called "Assets" even where the registry names the rows "Supplies"), and
    per-vertical *view gating* (a warehouse has no Scheduling).
12. **The schema in `docs/DATA-MODEL.md` is a specification, not an
    enforcement.** Nothing in the app (or anywhere) *applies* it: the store has no
    constraints, so every rule the doc lists under "What the API must enforce" —
    never over-receive a line, never let a level hold nothing, never patch a
    derived column, keep the ledger append-only — is enforced by `DataService`
    mutators returning `null`/`false`, not by a database. The two holes the doc
    named in A8 are now both closed, and both by *deleting* rather than syncing:
    A9 stamped the configuration tables, and A10 removed `orders.party` — the last
    stored copy of a name a join should have produced — replacing it with
    `partyName(partyId)` at every read site and a `partyRemovalBlockers()` guard
    so the FK the screens now depend on cannot dangle. A11 then took the same
    argument to money: a counterparty's negotiated rates are a `price_cards` row
    read at read time, not a price copied onto an order — which is why
    `price_card_lines` carries an effective window (the date a booking is priced on
    is its own start day, so a renewal is a new card and history is not re-priced).
    A11.2 finished the sentence on the other side of the ledger: the invoice reads
    the same rules (`partyCycleDays()`, `lineDays()`, `wholeUnitsBilled()`) instead
    of carrying its own arithmetic, so what a cycle bills and what the Gross prints
    are the same number seen twice, not two numbers that have to be kept in step.
    What the doc still states
    and nothing enforces is the rest of the table; it is the API's to implement.

## Source of truth for behavior
The original vanilla-JS prototype lives in the sibling repo
`/Users/robt/Projects/IMSdev/IMSdev/wwwroot/ims-prototype` (docs under
`docs/architecture/`: `modal-design-spec.md`, `AI-ONBOARDING.md`,
`app-review-*.md`). Match UI/behavior against `js/pages/scheduler.js` /
`js/pages/timesheet.js` when refining.

One deliberate shell-level deviation: the prototype's **global** search jumped to Fleet
Telemetry / Items from any page, while this port scopes the topbar search to the page it
is on (see "Topbar search = page search" above). Don't restore the global jump.
