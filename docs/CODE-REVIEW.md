# IMS Angular Port — Code Review, Consistency & Reporting Plan

**Date:** 2026-09-13 · **Repo:** `tinnerrob/ims-prototype-angular` (`main`)
**Scope:** a fresh end-to-end pass after P1–P11 — styling & visual consistency, a
modular Operations Dashboard, printable reporting, and a terminology sweep. Real API
connections remain out of scope (the `DataService` seam is untouched).
**Convention:** this document follows `angular-refactor-log.md` — one phase at a time,
**Analyze → Document → Execute → Verify**, smallest diff that achieves the finding, and
the gate suite green before the next phase starts.

---

## 0. Gate suite (run after every phase)

```bash
npm run build        # production build, expect warning-free
npm run check:store  # Node harnesses against the real store
npm run lint:ctor    # class-field initializer order
npm run lint:styles  # unused / re-set stylesheet rules
npm run lint:dead    # imported & exported names nothing references
npm run e2e          # headless render: routes, console, screenshots
```

The **baseline** for this document (measured 2026-09-13, before any change):

| Gate | Baseline |
|---|---|
| `build` | complete, 0 warnings |
| `check:store` | 246 ok / 0 FAIL, 28 harnesses |
| `lint:ctor` | OK (8 method-based initializers) |
| `lint:styles` | 0 unused; 122 selectors in 2+ rules (the ported-vs-refresh layering, by design) |
| `lint:dead` | 0 external orphans (only self-referenced API types, by design) |
| `e2e` | all checks passed, empty `console-errors.txt` |

---

## 1. Audit summary — what is already strong

The prior passes left the codebase in very good shape, so this review is **additive**,
not remedial:

- **Types:** `strict` + `strictTemplates`; **0 `any`**, 0 `as any`, 0 `@ts-ignore`.
- **Hygiene:** 0 TODO/FIXME/HACK; the only `console.*` is the bootstrap `.catch()`.
- **Angular:** standalone everywhere (0 NgModules); `takeUntilDestroyed` on the two
  router subscriptions; `OnPush` on the one provably-safe pilot (`field-editor`);
  signals used deliberately; no lifecycle leaks (P4/P4b/P4c proved this).
- **Design system:** token-driven, responsive height tiers, one 57px card header,
  one segmented-control style, a documented additive "visual refresh" layer.

## 2. Findings (fresh — not previously logged)

| # | Finding | Where | Phase |
|---|---|---|---|
| 1 | **Terminology drift:** the page is "Parties & Orders" and the model is `Order`/`orderId`, but the UI says "Contract" throughout; "vendor" and "supplier" are mixed; the `desc` names a phantom "site" role. | `views.ts`, `orders.*`, `invoicing.*`, `rentals.component.ts`, `tip-builders.ts` | **A** |
| 2 | **No print support at all** — invoices export CSV only; no `@media print`, no `window.print()`, no print sheet. | whole app | **B** |
| 3 | **Dashboard is a hardcoded bento grid** — no widget registry, no per-tenant ordering, no admin surface. | `features/dashboard` | **C** |
| 4 | Empty section banners in the global sheet; 4 `!important` sites; muted-token contrast unaudited. | `styles.scss` | **D** |
| 5 | **No spec files** (0 `*.spec.ts`); new capabilities need harness/e2e coverage. | repo-wide | **E** |
| 6 | `RentalSub.vendorCost` / `vendor_cost` is the last "vendor" identifier beside `supplierId`. | `models.ts`, `DATA-MODEL.md`, seed | **A (optional)** |

---

## 3. Canonical terminology (decided 2026-09-13)

The domain model already speaks this language — the UI is what drifted. Standardise on
the model:

| Concept | Canonical term | Retired |
|---|---|---|
| The page | **Parties & Orders** | — |
| Counterparty sub-tab | **Parties** | "Customers" (page keeps "Customer" only where a *role* is meant) |
| Order sub-tab / entity / label | **Order** (`orderId` shown as `ORD-…`) | **"Contract"** as a UI noun |
| A `supplier`-role counterparty | **Supplier** | **"vendor"** as a UI noun |
| A counterparty that is neither | — | phantom **"site"** role in prose |

Rules: *code identifiers do not change* (`Order`, `orderId`, `listOrders`) — only
user-facing labels, tab names, column headers, tooltips and descriptions. A company
*name* (e.g. the seeded "Brightleaf General Contracting") is not a label and stays.

**Not changed on purpose (different meanings of "contract"):**
- the **verb** "contract" = collapse (`timesheet` day-columns, scheduler double-click);
- "the schema **is the contract**" / the `apiAdapter` **contract** (an interface promise);
- the prototype's own file/field names in historical comments (`js/pages/contracts.js`,
  the prototype's free-text `vendor` field).
- the `vendorCost` **field** / `vendor_cost` **column**, and the `return-to-vendor`
  **enum value** — the last "vendor" *identifiers* (see the open item in §6).

---

## 4. Phase plan

### Phase A — Terminology & label consistency · `LOW` · status: **done (2026-09-13)**
**Done (UI-facing only; no identifier/persistence change):**
- `core/views.ts` — Parties & Orders `desc` (dropped the phantom "sites", "vendors"→
  "suppliers") + `search` ("contracts"→"orders"); Billing `search`; Rentals `desc`.
- `features/orders/orders.component.*` — tabs **Parties / Orders**, action **New Order**,
  column **Order**, modal **New Order** / **Order — {id}** / **Save Order**, empty-state
  wording; internal tab key `customers`→`parties`; viewer labels **Orders / Active Orders**;
  method renames `showContractView`→`showOrderView`, `tipContract`→`tipOrder` + comments.
- `features/invoicing/*` — column, CSV header and tooltip **Order**.
- `features/rentals/*` — KPI **Supplier Wholesale Cost**, columns **Order / Supplier /
  Supplier Cost**, editor labels, viewer/tooltip labels; comments.
- `features/dashboard`, `inspections`, `timesheet`, `scheduler`, `handoff`, `logistics`,
  `pricing` — viewer/section/tooltip labels and comments ("Contract"→"Order").
- `shared/tip/tip-builders.ts` — **Orders** label; "Customer / supplier card" comment.
- `core/models.ts` — `MOVEMENT_KIND_LABEL['return-to-vendor']` = **Return to Supplier**;
  rentals module `desc`; comments.
- `core/data.service.ts` — the return-to-supplier movement note; comments.
- `core/seed/*.ts` — comments (the seeded company *name* is untouched).

**Verified:** `npm run build` exit 0, **0 warnings** · `check:store` exit 0 (**246 ok /
0 FAIL**, 28 harnesses) · `lint:ctor` OK · `lint:styles` 0 unused (122 selectors in 2+
rules — unchanged from baseline) · `lint:dead` unchanged · `e2e` all checks passed.

### Phase B — Printable documents / reporting · `MED` · status: **done (2026-09-13)**
**The mechanism.** A printable document is *data*, not markup: `PrintDocument` (heading ·
number · status · party block · meta fields · columns · align · rows · totals · note) in
`shared/print/print.service.ts`. A page builds one and calls `PrintService.print()`, which
shows it and opens the dialog on the next tick; the single `<ims-print-document>` host —
mounted at the app root, **outside** the shell, beside the tip/confirm hosts — renders it.
The `@media print` block in `styles.scss` hides `.app-shell`, the prompt and the tip,
sets `@page { margin: 16mm }` and preserves solids (`print-color-adjust: exact`), so the
document prints alone.
- **New files:** `shared/print/print.service.ts`,
  `shared/print/print-document.component.{ts,html,scss}`; the `@media print` block in
  `styles.scss`; the host wired into `app.component.{ts,html}`.
- **v1 documents wired:** **Invoice** (Invoicing — row action + detail footer), **Purchase
  Order** (Purchasing — row action), **Order** (Orders — row action + detail footer),
  **Pick List / Return Pick List** (Hand-Off — the day's Outbound/Incoming board). Each
  builds its document from the *same* readers the screen uses (`invoiceTotals`,
  `detailLines`, `lineTotal`, `poValue`, the board rows), so paper and screen cannot
  disagree.
- Every print action is the shared `btn-ims-outline btn-sm2` + `bi-printer` chip, sitting
  with the row's other actions or at the card's action edge.
**Verified:** build exit 0 · `check:store` 246 ok / 0 FAIL · lints clean · **e2e** now
prints a PO in headless Chromium (`window.print` stubbed) and asserts the host renders the
document with its heading and totals — 4 new checks, all passed.

**Stretch — delivered (2026-09-13):** **Goods Receipt** (Purchasing — the receipts tab,
each line printing the place *it* landed), **Dispatch Note** (Logistics — a delivery
manifest: the carried order's lines under the trip's driver/truck/route), **Work Order**
(Field Service — parts and labour priced to the same total the grid's Cost column prints)
and **Rate Card** (Pricing — each negotiated figure beside the catalog's own). Each is one
builder function, no new component: the registry-agnostic `PrintDocument` paid off exactly
as the phase predicted. **Verified:** build exit 0 · `check:store` 256/0 · lints clean ·
`e2e` prints all five documents (10 print checks), all passed.

### Phase C — Dashboard widget system · `MED/HIGH` · status: **done (2026-09-13)**
**The mechanism.** The Operations Dashboard is a *set of widgets*, not a fixed page.
`core/dashboard.ts` declares each one (`DashboardWidget`: key, label, desc, icon, bento
`span`, `kpi`, and the industry `module` that gates it) as the `DASHBOARD_WIDGETS`
constant — the same "declare it once" shape as `core/views.ts`. The workspace stores the
arrangement (`Tenant.dashboard`: `order` = every key in order, `hidden` = the keys switched
off), the store persists it (`dashboardLayout()` / `setDashboardLayout()`), and
`DashboardService` joins the two — the `ModulesService` pattern applied to layout.
- **New files:** `core/dashboard.ts` (registry), `core/dashboard.service.ts`,
  `features/admin/dashboard-widgets.component.{ts,html,scss}`.
- **Store:** `Tenant.dashboard` (`DashboardLayout`) + the two accessors. The store stays
  registry-agnostic — it persists keys, it does not know what a widget *is*.
- **Dashboard** (`features/dashboard`): the hardcoded bento became a `@for (w of
  widgets())` + `@switch (w.key)` — nine widgets, one `@case` each, plus an empty state
  when everything is switched off. A widget whose module is off is dropped by the service,
  so the page no longer gates panels itself.
- **Admin → Dashboard** (new submenu entry + `admin/dashboard` lazy route): every widget
  listed with a switch, up/down reordering of the shown ones, a hidden section, "Show All"
  and "Reset Order" — mirroring `feature-modules`.
- **Data model:** `tenants.dashboard jsonb` documented in `docs/DATA-MODEL.md` (with the
  `DashboardLayout` shape), so `check9`'s "every model is a table" rule holds.
**Verified:** build exit 0 · `check:store` **256 ok / 0 FAIL in 29 harnesses** (`check29`,
10 checks, drives the join directly: default order, stored order, unknown keys, toggle
round-trip, move, arrow ends, module gating, reset, persistence) · lints clean · **e2e**
adds 5 checks — the admin lists every widget, a switch hides one, the dashboard drops it,
Reset restores, no console errors.
**Not done (deliberate):** drag-to-reorder (the arrows cover it; a drag is a gesture the
e2e would have to own) and per-*user* layouts (the arrangement is the workspace's, like the
module licences).

### Phase D — Styling / visual polish · `LOW` · status: **done (2026-09-13)**
**1. The contrast review, as a tool.** `scripts/audit-contrast.js` + `npm run lint:contrast`
(report-only, like the other audits): it parses the design tokens out of `src/styles.scss` and
computes the WCAG 2.1 ratio for **35 pairs the app actually renders**, each against the
threshold that applies — text 4.5:1, icons/borders/fills 3:1. The first pass over-reported:
the `st-*` chips set hand-picked darker text (not the base token), and hairlines are exempt
under 1.4.11 — so the tool now measures the real pairs, which is also how it stays honest.
**2. Five token fixes**, each minimal and each proven:
| change | why | before → after |
|---|---|---|
| `--muted` #64748b → **#5a6a7f** | secondary text (`text-muted2`) missed AA on the page tint | 4.21 → 4.88 (page) · 4.76 → 5.52 (card) |
| `--faint` #94a3b8 → **#7a8aa1** | the two icons that use it missed the 3:1 UI threshold | 2.56 → 3.51 (card) · 2.27 → 3.11 (page) |
| `--brand-2` #6366f1 → **#5c60e8** | white label on the brand gradient's light stop | 4.47 → 4.89 |
| `--success-soft` #e7f6ec → **#dcfce7** | two "good" green tints; unifying them also fixed `.st-available`'s 10.5px text | 4.49 → 4.57 |
| `.kpi-green` light stop #22c55e → **#15803d** | white glyph on the green KPI tile | 2.28 → 5.02 |
**Proof:** `npm run css:equiv` on the built CSS reports **exactly 6 winning values changed** —
those five plus the deleted rule below — and nothing else (625 → 624 selectors).
**3. The `!important` audit.** P5's four pre-existing sites were re-examined, each against what
it actually beats:
- `.hidden { display:none !important }` — **deleted: the class was dead.** No template,
  binding, `classList` call or script ever applies it. *Why `lint:styles` never flagged it:*
  its "used" test is a **substring** match over the source, so `DashboardLayout.hidden` (a
  store field) counted as a reference.
- `.text-danger` — **kept, documented:** Bootstrap 5.3 (CDN, `index.html`) declares
  `.text-danger` `!important` itself, so only an equally important later rule keeps this app's
  danger hue (#dc2626, not #dc3545).
- `.tl-inner` — **kept, documented:** it beats the inline `[style.min-width.px]="minWidth()"`
  both calendars bind (the fixed-width, no-horizontal-scroll contract).
- `.admin-nav-chev` — **kept, documented:** `.admin-nav-item i` (0,2,0) out-specifies it.
The four the print sheet added (Phase B) sit in a `@media print` block and follow the usual
print-stylesheet convention.
**4. Reported, not acted on.** Tightening `lint:styles`'s matcher to real class positions
surfaces a candidate dead-class list (`lab-*`, `oh-info`/`oh-edits`, `queue-list`,
`sched-pool-tabs`, `sched-row`, `res-busy`/`res-free`, `kpi-cyan`/`kpi-ink`/`kpi-orange`,
`ts-*` …) — but the same blunt scan *would* have deleted `.st-inprogress`, which is **live**:
it is built at runtime as `'st-' + statusClass('In Progress')`. A safe sweep needs a matcher
that understands interpolation (`tl-res-{{…}}`, `tc-{{…}}`) and `[class]` concatenation; that
is its own task, not a cleanup, so it is filed here rather than done blind.
**Verified:** build exit 0 · `lint:contrast` all 35 pairs pass · `check:store` 256/0 · lints
clean · `e2e` 32 checks.

### Phase E — Tests + docs · `LOW/MED` · status: **done (2026-09-13)**
**Done:** `check29` (the dashboard layout, 10 checks); `check30` (**11 checks** — the eight
printable documents' *content*: each builder instantiated against the real store with a
capturing printer, asserting every document is well-formed and that the money it prints is
the **store's own** figure — `invoiceTotals().total`, `poValue()`, `workOrderCost()`); and
the e2e additions — the **applied-stylesheet guard** (the sidebar rail painted at its
pinned width and resolving to its dark slate ramp `rgb(28,36,52) → rgb(21,27,40)`, the
shell a flex box, the tokens resolving — text renders with *no* CSS, so "it reads fine"
never proved "it looks right"), the dashboard-widget-admin flow, and all five probe
documents. `docs/DATA-MODEL.md` carries `tenants.dashboard`; README / HANDOFF /
PLAN quote the current counts.
**`check:store` is 267 ok / 0 FAIL in 30 harnesses.**

---

### Phase F — the print surface, the field-service filter, and sub-rental windows · `MED` · status: **done (2026-09-13)**

**The print action is a menu.** `PrintService.print(doc, mode)` takes a `PrintMode`
(`print` / `pdf`, plus `-expanded` for the two reports that offer a detail level), and
`<ims-print-menu>` renders the printer icon **with a down chevron** that opens it. The
panel is drawn from the app root (`PrintMenuService` + `ims-print-menu-host`), beside the
confirm dialog and the tip panel — a dropdown rendered inside the button would be clipped
by the `.table-wrap` (or the modal) it hangs in. `Save to PDF` runs the same dialog as
`Print`: this app has no PDF library, and the browser's dialog is where the PDF
destination lives; the choice sets the page **title** to the document's heading and number,
which is what names a saved file. All eight existing print buttons became menus.

**Four more documents**, each one builder function:

- **Custody Log** (Hand-Off) — the ledger as the page holds it: same rows, same place
  scope, same search.
- **Inspection Log** *and* **Inspection Report** (Receiving / Inspections) — the period's
  log, and a single record's checklist with its pass/fail and severity.
- **Schedule** (Scheduling) — the Day / Week / Month the timeline is showing, at two detail
  levels: contracted (one row per order) or **expanded** (one row per booked item).
- **Timesheet** (Labor & Timesheets) — the same two levels: one row per employee (hours,
  bill, cost) or one row per logged segment.
- **Sub-Rental Register** (Rentals) — what is held in, over which window, and whether it
  is back.

**Field Service & Maintenance.** The period filter every other list page has (All / Day /
Week / Month chips + a ‹ range › pager) now narrows the work-order grid, and the action
cell's status `select` and its buttons sit in one `d-inline-flex` row so they align (they
were inline siblings with different heights, which is what read as misaligned).

**Sub-rentals get a window and a return.** `RentalSub` gains `rentFrom` / `rentTo` — the
window we hold the unit for, which is what says whether it can cover the customer order it
is re-let on — and `returnedAt`, plus `DataService.returnRental()` and the derived
`rentalOut()` / `rentalOverdue()`. The editor takes both dates, the ledger shows the window
and a status (`Out` / `Overdue` / `Returned <date>`) with a one-click **Return**, and
`docs/DATA-MODEL.md` documents the three columns. A return is a *date*, not a status flag,
so "did it go back late?" stays answerable.

**Verified:** build exit 0, **0 warnings** · `check:store` **274 ok / 0 FAIL in 31
harnesses** (`check31`, 7 checks: the seeded windows, create-with-dates, an open end, the
return stamp, the today default, overdue before/after a return, an unknown id) · all four
lints clean · **e2e 47 checks** — the menu opens on screen with both items, Save to PDF
runs the same builder, every new document prints, and the two calendars' menus carry the
four items.

---

### Phase G — the two calendars print *reports*, not tables · `LOW/MED` · status: **done (2026-09-13)**

**Grouped documents.** `PrintDocument` gained an optional `groups: PrintGroup[]` beside
`rows` (which became optional): a document is either a flat table or one that *has a
shape*. A `PrintGroup` is a heading (`title`), the facts beside it (`meta`), its own
`rows`, its own `subtotals`, and an optional second level (`subgroups`) — so the renderer
walks two levels, repeats the column header **per group** (a group can then survive a page
break with its own header), and prints the group's subtotal under it, which is what puts
the total for the primary *before* the detail that makes it up. One `columns` legend
serves the whole document.

- **Schedule (Scheduling)** — grouped **by order**, each order closing with assets ·
  booked units · order value. Contracted lists the order's **assets**, one row each with
  its bookings aggregated (window, days, value); expanded adds the second level — a block
  per **asset** with a row per booking, closing with that asset's units and value.
- **Timesheet (Labor & Timesheets)** — grouped **by employee**, each employee closing with
  hours · bill · cost. Contracted lists the **orders** they clocked into, one row each with
  its segment count; expanded adds the second level — a block per **order** with a row per
  logged segment. Target labels come from the store's own `segmentLabel()`, so Shop /
  Overhead / Idle read on paper exactly as they do on the board.
- Document-level totals stay, and are now the roll-up of the groups: orders · booked items
  · total value, and employees · logged hours · billable · cost.
- `check30`'s row-width check walks **both** levels, so a new group or subgroup cannot
  quietly print a ragged table.

**A timesheet that opened empty.** The board anchored on *today*, and the fixture's
segments sit on one week; whenever those differed the page — and now its printout — was
empty (measured: today's week showed six lanes at `0 hr logged`, and one ‹ step back showed
all six with hours). It now anchors on the week its segments are in, the same "open where
the data is" move the scheduler already made with its first active order. Nothing else
about the calendar changed.

**Verified:** build exit 0, **0 warnings** · `check:store` **278 ok / 0 FAIL in 31
harnesses** (`check30` 11 → **15 checks**: the schedule groups by order and emphasises each
order's total, the expanded schedule adds the asset level under every order, the timesheet
groups by employee and emphasises each employee's total, the expanded timesheet adds the
order level under every employee) · all four lints clean (contrast 35/35) · **e2e 49
checks** — both reports render their groups, their per-group subtotals and their second
level in the real browser.

---

### Phase H — Sample data: two workspace-wide buttons · `MED` · status: **done (2026-09-13)**

**The ask.** Load every sample row back in one click, and remove *all* of it in another —
because the removal that already existed (`resetCatalog`, Phase C's "Start clean")
deliberately keeps the workspace's partners, locations and settings. That is right for
"replace my catalog" and wrong for "show me this empty".

**One factory, called twice.** The fixture was the `db` field's initializer; it is a named
shape (`StoreDb`) built by a factory (`DataService.fixture()`) now, and the field
initializer and **Load sample data** both call it. `loadSampleData()` then runs the same
passes a first load runs, in the same order (`seedStockLevels`, `seedReceipts`,
`linkItemsToCategories`) and re-takes the attribution baseline. The payoff is not "it looks
seeded": the snapshot it persists is **byte-identical** to a fresh browser's, which is what
`check32` asserts — the `cmp`-clean habit P6/2 established when the seed left the store.

**The wipe draws an explicit line.** `clearAllData()` empties every table the fixture fills
— parties and suppliers, price cards, locations and their types, tax schedules, overheads,
the catalog with its shelves and ledger, orders, purchase orders and their receipts,
inspections, work orders, timesheets, sub-rentals, the fleet, dispatches, invoices,
documents, count sheets, business types, categories and form schemas. What stays is the
workspace **itself**, or the app could not render: the tenant, its people, the session, the
yard, and the settings that say how a workspace behaves (pricing, the receiving rules, the
stock set's shape). `vertical_id` is cleared with the row it named, so it cannot dangle.

**The subtlety worth the comment it got.** `save()` attributes a write by diffing each row
against what it remembered last time. Swapping the whole store out makes every one of those
memories wrong in the same direction, so the baseline is dropped *before* the fixture is
re-laid — seeding posts its receipts through the real purchasing operation, which calls
`save()`. Get that order wrong and pressing the button stamps 92 kB of seeded rows with
today's date and the signed-in user; `check32` asserts that exact failure.

**Where it lives.** `Admin → Sample data` (`/admin/sample-data`), a new admin child: the two
buttons, a live tally of what the workspace is holding table by table, and a plain account
of what each one does — including where the narrower **Start clean** sits, and why. Both
confirm through the shared dialog; the tally is built from the store's own accessors, so the
effect is visible rather than remembered.

**And the tally stayed out of the eager store.** Its twenty-odd labels are presentation, and
the first cut put them in `data.service.ts` — which pushed the *initial* bundle from 497.85
to 500.51 kB, over its 500 kB budget, and the build grew a warning. The labels moved to the
page (a lazy chunk, with one cheap `listCategories()` accessor added for the table the store
could not previously count whole), which put the bundle at **499.39 kB** with the warning
gone. The gate did not move; the code did.

**The claim the e2e now makes:** every one of the **19 routes** renders with a clean console
on an **emptied** workspace. That is the state most likely to find a page quietly assuming
the seed (a `[0]`, a `.find()`, a vertical that is not there) — and it passes.

**Verified:** build exit 0, **0 warnings** · `check:store` **286 ok / 0 FAIL in 32
harnesses** (`check32`, 8 checks) · all four lints clean (contrast 35/35) · **e2e 73
checks**.

---

### Phase I — the table footer: record count, page size, pager · `MED` · status: **done (2026-09-13)**

**The ask.** The "n of n record(s)" a few pages showed *above* the table moves into a footer
under it, and every table gets a page-size choice (10 / 25 / 50 / All) and a pager.

**One attribute.** `<table class="table" imsPaged="assets">`. `TablePagerDirective` slices the
rows it finds (hiding the ones outside the current page with an inline `display`), builds the
footer under the table's own scrolling box, and re-applies on every row change — Angular
re-creates rows on each filter, tab and store write, and a fresh row is always shown. An
empty-state row (`colspan`) is a message, not a record, so it is never counted or paged.

**Default All.** Nothing changes until a reader picks a size, so the footer is not a surprise;
the choice is remembered per table (`localStorage`, `ims.rows.<id>`) — the same per-browser
habit as the prototype's own column profiles.

**The counters moved.** Purchasing and Hand-Off each showed
`{{ count(tab) }} of {{ totalCount(tab) }} record(s)` in their toolbar, and Locations showed
`{{ rows().length }} of {{ locations().length }} locations`. Those spans are gone: the footer
states the count for every table, in one place, and the page search's own "shown of total"
still lives in the topbar.

**Wired: 27 tables** — Orders (2), Assets, Locations (2), Purchasing (3), Hand-Off (4),
Inspections (2), Invoicing (2), Pricing (4), Maintenance, Logistics, Telematics, Rentals,
Admin → Verticals (2) and the dashboard's low-stock tile. **Left alone on purpose:** the
printable documents (documents, not lists) and the line tables *inside modals* — a three-line
PO does not need a pager (Purchasing's PO-lines and receipt-lines tables).

**The footer carries its own styles.** It is built in the page's own card, where no component's
styles reach, so the alternative was adding to `styles.scss` — which ships in the *initial*
bundle. Inline styles leave that sheet untouched; the footer is a widget, not a theme, and it
reuses the app's own button and select classes.

**Verified:** build exit 0, **0 warnings** (502.76 kB) · `check:store` **286 ok / 0 FAIL in 32
harnesses** · all four lints clean (contrast 35/35) · **e2e 81 checks**, eight of them the
footer: the range is stated beside the pager (`Records 1–16 of 16`), the far-left of the
footer is free, the page-size box leaves its value clear of the chevron (measured, not
eyeballed), a page size slices the rows, the pager moves off page 1, the size survives a
reload, the count is *not* in the card header, and the console stays clean.

**Follow-up tweak (same day).** The pager used to say `Page 1 of 2` with the record count
stranded on the far left of the footer. The range *is* the page indicator, so `Page n of n` is
gone and the middle of the pager reads **`Records 1–16 of 16`** — which frees the whole left
side (the footer is one right-aligned tools row now) — and the size box is `min-width: 74px`
with 26 px of right padding, so its chevron cannot sit over the value. Both are asserted in the
e2e: the left edge has no count, and the value has more room than the widest option needs.

**The budget moved again — the second feature in a row to need it.** 500 kB with 499.39 kB used
could not take the ~3 kB this costs in the initial chunk (a directive that thirteen lazy pages
import is hoisted there). `angular.json`'s initial **warn** threshold is now **520 kB**; the
1 MB error ceiling is untouched. The honest read: the app has outgrown a 500 kB ceiling, and
the next step should be a deliberate bundle-trimming pass rather than another nudge.

### Phase J — the table footer lines up on every page · `LOW` · status: **done (2026-09-13)**

**The ask.** The footer read as a different size on Receiving/Inspections, Logistics & Dispatch
and Field Service than on Item Hand-Off — all of them should match Hand-Off.

**The cause — three views used a markup shape no other page used.** `TablePagerDirective` drops
the footer in *after* the table's wrapper (`wrap.after(foot)`), so the footer's width and insets
come from whatever contains that wrapper. Every other table nests a plain
`<div class="table-wrap">` inside `<div class="card-body">`; exactly three — Inspections,
Maintenance and Logistics — put both classes on **one** element
(`<div class="card-body table-wrap">`). There `.table-wrap` *is* the card body, so the footer
landed outside its padding: a child of `.card`, ~1 px from the card's edge, while the table it
describes sat inside the body's 12–14 px padding. Measured at a 1440 px viewport:

| page | footer's parent | footer inset | vs. its table |
|---|---|---|---|
| Item Hand-Off (the reference) | `DIV.card-body` | 15 px | **0 / 0** — flush |
| Inspections / Logistics / Field Service | `DIV.card` | **1 px** | **−14 / −14** — 28 px wider |

Height (41 px), button size (30 px) and type (12 / 12.5 / 14 px) were identical on all four, so
the difference was width and inset — which is what reads as "a different size".

**The fix.** Nest the wrapper in those three views, as every other table already does:
`<div class="card-body"><div class="table-wrap"><table …`. The footer then lands inside the padded
body and spans exactly the box the table is laid out in. A guard also went in beside it: the
now-unreachable `.content > … > .card > .card-body.table-wrap` rule is deleted, proved neutral by
`css:equiv` (**624 → 623 selectors**, and the *only* differences are that rule's own three
declarations — no other selector's winning value moved).

**Layout-neutral, proved by A/B.** Reverting the three templates, rebuilding and re-measuring:

| route | card height | table height | footer insets |
|---|---|---|---|
| /inspections | 270 → 270 | 138 → 138 | 1,1 → **15,15** |
| /logistics | 427 → 427 | 295 → 295 | 1,1 → **15,15** |
| /maintenance | 452 → 452 | 320 → 320 | 1,1 → **15,15** |

**And an e2e guard that fails on the bug.** The smoke test now walks eleven table routes and
asserts, for every `.tbl-foot`, that it spans the **content box** of the `.table-wrap` it follows
— the box the table is laid out in. (Comparing *border* boxes would not catch this: the buggy
wrapper's border box is precisely what the footer matched.) Proved by mutation — restoring the old
markup on Inspections makes the check fail with
`inspections: left off -12, right off -12 (wrapper padding 10px 12px)` while /handoff stays green.

**Verified:** build exit 0, **0 warnings** (502.92 kB) · `check:store` **294 ok / 0 FAIL in 33
harnesses** · `lint:dead` 0/0 · `lint:ctor` OK · `css:equiv` as above · **e2e: all checks passed**,
eleven of them the new per-route footer-alignment walk.

### Phase K — the rail goes matte slate · `LOW` · status: **done (2026-09-13)**

**The ask.** The sidebar should be a dark matte slate grey — `#1e293b`.

**What changed.** `--sidebar-bg` `#1c2434` → **`#1e293b`** (slate-800), and the rail is now one
flat fill: the two-stop `linear-gradient(--sidebar-bg → --sidebar-bg-2)` and the
`1px 0 0 rgba(255,255,255,.035)` edge hairline are gone — that gloss *is* what "matte" removes.
`--sidebar-bg-2` survives for the one place that still wants depth, the user-switcher popover
(`.user-menu` is its only other consumer), retuned from `#151b28` to slate-900 `#0f172a` so both
tones sit in one ramp. Three supporting nudges, each with a reason: `--sidebar-ink-dim`
`#8695ad` → `#8b99b3` (the lighter fill costs a little text contrast — the dim tier was 5.12 and
would have landed at ~4.65, so it keeps ~5.1), and the white-alpha overlays
(`--sidebar-line` / `--sidebar-hover` / `--sidebar-icon-chip`) each up ~1 %, since white over a
lighter slate reads weaker.

**Verified:** build exit 0, **0 warnings** (502.86 kB) · `check:store` **294 ok / 0 FAIL in 33
harnesses** · `lint:dead` 0/0 · `lint:ctor` OK · `lint:styles` unchanged (670 rules / 556
selectors, no new layering) · **`lint:contrast` all 35 pairs ok** — the rail's own text is now
`--sidebar-ink` **9.40**, `--sidebar-ink-strong` **14.63**, `--sidebar-ink-dim` **5.09** (all AA) ·
**e2e: all checks passed**, and the shell-pixels check was rewritten rather than deleted: it used
to assert the gradient and the old tokens, and now asserts a flat `rgb(30, 41, 59)` rail with
`background-image: none` and `--sidebar-bg: #1e293b` — so a future edit that reintroduces a
gradient fails the smoke test. Screenshots regenerated under `dist/e2e/`.

### Phase L — flat row actions · `LOW/MED` · status: **done (2026-09-13)**

**The ask.** The table action buttons (+ / pencil / remove / view / …) should match a supplied
mock: transparent, borderless glyphs in a 6px box, a muted slate resting tone, a faint wash and a
per-action colour on hover, and quiet-until-hovered rows.

**What the app had.** Every row action was `btn btn-ims-outline btn-sm2` — a white pill with a 1px
border — and only the *glyph* carried colour (green pencil, red remove, blue eye).

**What changed.** Two new classes, and the markup to use them:

- **`.action-cell`** — the cell: flex, `gap: 12px`, right-aligned. **`.action-btn`** — the glyph:
  transparent, no border, 6px padding, 6px radius, resting in `--faint`, with a `--slate-50` wash
  and a `color` transition on the app's own `--t-fast`.
- **45 icon buttons across 14 templates** now carry it — the 24 action cells, the nested
  line-item removes (PO lines, rate-card lines), the receiving desk's per-place remove and the
  dashboard-widget arrows. **Labelled** row buttons ("Check Out", "Check In", "Return",
  "Receive") keep their filled `.btn-ims` look: they carry text, which a flat glyph does not
  describe.
- **The kind comes from the icon the button already carries** — `.action-btn:has(.bi-plus-lg):hover`
  → `--success`, `bi-pencil` / `bi-eye` → `--accent`, `bi-x-lg` / `bi-trash*` → `--danger` — so a
  new action on a new page picks up the right colour with no modifier class, the same rule the
  status chip follows. The mock's `action-btn--add/edit/delete` modifiers were therefore **not**
  added as classes: an unused class is dead CSS, and this repo's audits say so.
- **The print menu joins them.** Its icon-only variant is bound to `.action-btn`
  (`[class.action-btn]="!primary && !text"`) so the row's print action is indistinguishable from
  the glyphs beside it; its labelled and footer variants keep the outline / filled button. It is
  the one place the new class has to out-specify another (it keeps `.btn` for the reset), which is
  why the cascade there is asserted in the e2e rather than assumed.
- **Quiet rows:** `.table tbody tr .action-btn { opacity: .35 }`, revealed on `:hover` **and**
  `:focus-within` (so keyboard users are not hunting for a 35%-opacity target), and left at full
  strength under `@media (hover: none)` — on a touch device there is no row hover, so 35% would
  have been permanently unreachable.
- The old icon-colour block (`.btn-ims-outline.btn-sm2 > .bi-*`) is deleted alongside its last
  consumer.

**Two deliberate deviations from the mock, both flagged to the owner.**

1. **Resting tone is `--faint` (#7a8aa1), not the mock's `--slate-400` (#94a3b8).** At 2.56:1 on a
   white card that grey fails the 3:1 UI threshold this repo audits — it is *exactly* the value
   Phase D moved `--faint` off. `--faint` is 3.51:1 and reads the same at a glance.
2. **`justify-content: flex-end`, not the mock's `flex-start`.** Every action column in the app is
   right-aligned (`<th class="text-end">`); the mock's own value would have moved all 24 columns to
   the left edge of their column. A one-line change if the mock is what's wanted.

Also: the wash uses a new `--slate-50` token rather than a bare hex (the ramp already ran
900 → 100), and the transition uses `--t-fast` rather than a raw `0.2s`.

**No table rhythm changed.** On a real table the row height is driven by the text cells (112px on
Locations) while the action cell is 41px; the glyph box is 27px (6px padding + a 15px glyph)
against the old 30px pill, so only in the rare table whose action cell is the tallest would a row
shorten by 3px.

**Verified:** build exit 0, **0 warnings** (503.71 kB) · `check:store` **294 ok / 0 FAIL in 33
harnesses** · `lint:dead` 0/0 · `lint:ctor` OK · `lint:styles` **679 rules / 567 selectors**, the
new classes reported neither as re-set nor as unmentioned · `lint:contrast` **35/35** · **e2e: all
checks passed**, with **seven new ones**: the glyph is bare (border `0px`, radius `6px`, padding
`6px`, transparent fill, `--faint`), it stays at `0.35` until its own row is hovered, add / edit /
remove turn **green / blue / red** on hover, two actions in one cell sit **12px** apart, and the
print action is flat too. Two of these failed first for reasons worth recording: a flex *item*'s
`inline-flex` **computes to `flex`** (blockification), and a transitioned colour must be read after
it **settles**, not on the frame it starts.

---

### Phase M — Hand-Off's board buttons join the flat glyphs · `LOW` · status: **done (2026-09-13)**

**The ask.** The **Check In** and **Return** buttons on Item Hand-Off should work like the row
actions on Assets — the glyph the sub-rental register uses to record the return to a supplier.

**What changed.** Both were labelled filled pills (`btn btn-ims btn-sm2`, reading "Check In" and
"Return"). They are now the shared `.action-btn` glyph — `bi-box-arrow-in-down`, the same icon the
sub-rental register's *record the return* action carries — with the meaning in the tooltip rather
than in text. That corrects the note in Phase L above which listed them among the labelled
buttons that keep the filled look: these were the two that did not need to.

**Check Out stays labelled, deliberately.** The outbound board's action is that board's primary
move, and it is the only one in its tab, so it reads better as a button that says what it does.
It is the same one-line change if the glyph is wanted there too.

### Phase N — a partner's Active is a switch, and the parties tab filters · `LOW` · status: **done (2026-09-13)**

**The ask.** The power button on the party rows of Parties & Orders should be a slider, and the
tab should filter by active / inactive / all.

**What changed.**

- The `bi-power` toggle button is a **`form-check form-switch`** — the app's existing switch
  (Admin → Dashboard widgets uses the same markup) — bound `[checked]="p.active !== false"`,
  because `Party.active` is *absent* on every pre-A5 row and absent means active. The switch
  carries an `aria-label` naming the partner and the state, plus a title saying what flipping it
  will do; the visible state is now readable at a glance instead of inferred from an icon.
- **A filter strip above the table** — All / Active / Inactive, the same `.btn-group` shape and
  "Showing …" line the orders tab below it already uses — and a `partyFilter` field on the
  component. `parties()` applies it *after* the page search, so the sub-tab pill, the toolbar
  count and the rows on screen are one number.
- The row's own click handler already ignores clicks landing on a `label` / `input` / form
  control (`isInteractiveTarget`), so the switch does not open the record viewer behind it.

### Phase O — a work order's parts move into its modal, shaped like an invoice · `MED` · status: **done (2026-09-13)**

**The ask.** Hide Parts Used on Field Service & Maintenance, and reformat the modal that opens
when a row is clicked so it reads more like an invoice.

**What changed.**

- The grid **drops the Parts Used column** — a run of chips that was the widest and least
  scannable cell in the table. Nothing is lost: the row still carries Parts Cost, Labor Cost and
  Total Cost.
- The **record viewer gained an itemised table** (`ViewTable` on `ViewModel`: title, columns,
  per-column alignment, rows, totals) rendered the way the invoice modal renders its lines — a
  heading, a `.table`, a divider, then the money lines. A work order now opens on
  **Part / Labor · Kind · Qty · Rate · Amount** with **Parts / Labor / Total Cost** under it,
  instead of six labelled lines.
- **One source for both surfaces.** `workOrderLines()` prices each part/consumable at its catalog
  cost and appends the shop-labor row; the *printable* work order now renders that same array, so
  the sheet and the modal cannot drift apart. The old inline `partLabel()` helper is gone with its
  last consumer.

### Phase P — the action columns, and a darker row highlight · `LOW/MED` · status: **done (2026-09-13)**

**The ask.** Every action icon should carry the same margin/padding and sit in its own column, so
the buttons line up across rows; the stated example was Billing & Invoicing, where the row with no
**Mark paid** action pushed Print and Details one column to the right. And the row highlight should
be a little darker.

**Why it happened.** `justify-content: flex-end` right-aligns *whatever the row rendered*, so an
action that was **conditionally rendered** moved every button after it. Two cells did that:
Invoicing ("Mark paid" only while unpaid) and the sub-rental register (the return action only while
the unit is out). Assets' move / count actions vary by **tab**, not by row, so they never drifted —
and a `[disabled]` button was already safe, because a disabled box keeps its place.

**What changed.**

- **Both conditional actions render always and disable instead** — `[disabled]` plus a title that
  says why ("Already paid", "Already returned to the supplier"). Nothing re-flows, and the reader
  can see the action exists and is spent, which is the same "show the action, explain the block"
  shape the Locations and Parties remove buttons already use.
- **Every action is the same 27×27 box** (the mock's `padding: 6px` with `width`/`height` 27px and
  `box-sizing: border-box`). The print menu was the odd one out: its button carries a chevron as
  well as its glyph, so it was ~9px wider than its neighbours. The chevron is now a 7px **corner
  marker** (absolutely positioned), which keeps the "this opens a menu" hint *and* the box.
- **A disabled glyph stays disabled-looking**: the hover colour rules are guarded with
  `:not(:disabled)` and a disabled action rests in `--slate-300`, so an unavailable action cannot
  light up green / blue / red as though it worked.
- **Maintenance's status `<select>` lost its `gap-1` wrapper**, so that cell's own 12px gap and
  27px boxes govern all three of its controls like every other table's action column.
- **The row wash steps up**: `tr.row-open:hover` `rgba(37, 99, 235, .05)` → **`.09`**, and the
  general `tr:hover` wash with it (`.05` → `.09`) so the two stay in step.

**Verified (M–P):** build exit 0, **0 warnings** (505.27 kB) · `check:store` **294 ok / 0 FAIL in
33 harnesses** · `lint:dead` 0/0 · `lint:ctor` OK · `lint:styles` **679 rules / 568 selectors** ·
`lint:contrast` **35/35** · **e2e: all checks passed (121)**, with **eight new ones**: the board's
Check In / Return are bare `bi-box-arrow-in-down` glyphs; a party's Active is a
`role="switch"` checkbox that flips off, filters to the one deactivated partner, and flips back;
the work-order grid has no Parts Used column; its modal's table is
`Part / Labor · Kind · Qty · Rate · Amount` with three totals; **every action keeps its column
across the rows of every table on 12 routes**; every row action measures **27×27**; a paid
invoice's paid action is present-**and**-disabled; and a pointed-at row measures
`rgba(37, 99, 235, 0.09)`.

Two of the new checks failed first, and both times the fault was the test's — worth recording,
because the same traps will catch the next person:

1. The pager leaves paged-out rows **in the DOM with no layout box** (`left: 0`), so a column
   comparison has to skip elements without client rects; comparing them reported "drift" that was
   only the pager.
2. `.btn-group button` + `hasText: 'Inactive'` did not reliably reach the Inactive filter button
   sitting beside Active; `getByRole('button', { name: 'Inactive', exact: true })` does.

---

## 5. Verification recipe (every phase)

```bash
npm run build        # expect exit 0, 0 warnings
npm run check:store  # expect exit 0, N ok / 0 FAIL
npm run lint:ctor && npm run lint:styles && npm run lint:dead
npm run e2e          # expect "all checks passed", empty dist/e2e/console-errors.txt
```

---

## 6. Open items / decisions

1. **`vendorCost` / `vendor_cost` / `return-to-vendor` identifiers** — the only "vendor"
   *code* names left (their UI labels already say "Supplier"). Renaming them means a
   `models.ts` + seed + `check6.mjs` + `DATA-MODEL.md` sweep and a **persistence schema
   bump** (the stored snapshot reseeds on a version change). **Awaiting a go-ahead.**
