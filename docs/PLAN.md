# ims-web — Tenant-Aware SaaS Foundation: Plan & Progress

**Why this exists.** `ims-web` is a working single-workspace IMS port. It is also
the **specification** for a multi-tenant SaaS backend that does not exist yet.
So work on it is not "add features": it is *deciding the shape of the data* by
making the client exercise it — a column nobody reads never gets written, and a
column nobody writes never gets designed. Every increment below ends with the
front end able to produce, display and (where it matters) reason about the fact
the backend will have to store.

This file is the plan. `HANDOFF.md` is the current state. When they disagree,
`HANDOFF.md` is right.

## Working agreement

- **One gated commit per step.** No step is left half-applied; each commit
  message states the problem, the shape of the fix and the verification run.
- **Green before commit:** `npm run build` (AOT, strict templates),
  `npm run lint:ctor`, `npm run lint:styles`.
- **Runtime checks:** there is no Chrome on the dev box, so Karma specs can't
  run. Store/service logic is verified by compiling the core services to JS and
  running a Node harness against the *real* store (see "Verification recipe").
- **Class-field initializers must not read injected services** (`lint:ctor`).
- **List pages** register in `VIEWS` + `app.routes.ts` and report their row
  counts to `PageSearchService` via `search.report(thunk)`.
- **Writes go through `DataService.save()`** — that is the single writer, and
  where tenant scoping and attribution happen.

## Phase A — identity, audit, and the physical spine (the foundation)

| # | Increment | Status |
|---|---|---|
| A1 | Identity & tenancy: `Tenant`/`User`/`Role`/`Permission` + `can()`, session as signals, modules become tenant licence flags, `vertical` moves to the tenant, reseed banner | ✅ `0e547ae` |
| A2 | Audit trail: `AuditFields` on every table, `Movement.byUserId` FK, attribution in `save()`, seeded rows backfilled, audit block in record views | ✅ `592bc37` |
| A3 | Item ↔ location spine: seed `locationId`, picker in both item editors, Location column + search, `itemsAtLocation()`, `bin` duplicate resolved, location removal guarded by contents | ✅ `d13bafa` |
| A4 | Movements write real locations: `Movement.location` string → `locationId` FK, hand-off picks a location, custody log shows the path | ✅ `6fd10ad` |
| A5 | Purchasing as core: supplier → PO → receipt → stock (absent entirely today) | ✅ `fc643e1` |
| A5.1 | Close the holes A5 exposed: the `transfer` / `adjust` write paths (Move, Count), a reorder that raises a document instead of a count, sub-rental vendors as supplier FKs | ✅ `1a8bf96` |
| A5.2 | Purchasing lists page by period: the PO and Receipts lists take the inspection log's `All/Day/Week/Month` chips + `‹ range ›` pager, on one shared `periodBounds()` window that the log now reads too | ✅ `e043478` |
| A6 | One SKU, many places: `stock_levels(item_id, location_id, qty)` as the truth for counted stock, with `qtyOnHand` as its sum and a move / count that act on a place | ✅ `1ede7b5` |
| A7 | Vertical metadata registry: the per-vertical field/tab/label sets become data `core/vertical-metadata.ts` carries, read by the store, not conditionals in components | ✅ `522f885` |
| A8 | `docs/DATA-MODEL.md` — tables, columns, FKs and enums derived from `models.ts`, as the schema the API implements | ✅ `5560a98` |
| A9 | Every table is a tenant's: the configuration rows (`location_types`, `categories`, `tax_schedules`, `overheads`, `pricing`, `yard`) join `auditedRows()`, and a rename keeps the row's history | ✅ `c1812bf` |
| A10 | The last hole A8 named: `orders.party` (a stored copy of the counterparty's name) leaves the model — the screens read the join — and `partyRemovalBlockers()` keeps the FK from dangling | ✅ `99653e1` |
| A11 | Negotiated rates per party: `price_cards` + `price_card_lines` hang off `parties`, an order bills at the card in force on the day its booking starts (`cardRateFor()`), a supplier's card is the PO editor's cost default (one rule, re-applied when the supplier changes), and the Pricing page edits them | ✅ `13f8f5b` |
| A11.2 | The invoice bills what the Gross prints: whole weeks/months per period (`wholeUnitsBilled()`), on the line's own days, at the party's own cadence (`partyCycleDays()` — the only reader `parties.billing_cycle` ever had), with "Run Next Cycle" (`runNextCycle()`) advancing every active order, so a booking's cycles tile it and add up to its `lineTotal()` | ✅ |

### Acceptance criteria per increment

**A1 — identity & tenancy.** A user belongs to a tenant; a role is a set of
permissions; a screen asks for a capability, never for a role name. Module
enablement is tenant configuration (a licence), not a browser preference.
Switching the acting user changes what the app allows without a reload, and a
store-version bump tells the user their saved data was replaced.

**A2 — audit trail.** Every row carries `tenantId`, `createdAt/By`,
`updatedAt/By`, and no write can avoid it: attribution lives in the one writer,
not in 59 mutators. A movement's author is a user id, not a name, so a rename
can't rewrite history. Seeded rows are backfilled as a migration would. Two
screens can read the stamps they produce.

**A3 — item ↔ location spine.** An item's *place* is a row in `locations` (an
FK), not free text, so stock can be counted per location and a bin is a node in
the hierarchy rather than a string beside it. Both item editors (Assets,
Scheduler pool) write the same field; the column, the search and the record
viewer read it; `itemsAtLocation()` answers "what is here?" for one node and for
its whole subtree; a location holding stock can't be deleted out from under it.

**A4 — movements.** A movement records where it happened as an FK, so the ledger
can be read back per location ("what left Yard A this month?") and the immutable
log stops carrying a display string. A4 also settled the FK's other end: the
place is *resolved* rather than asked for (an issue leaves from where the unit
sits), only a **return** re-homes a unit — the other kinds log a place and leave
the shelf alone — and a place the ledger mentions can no longer be deleted,
because an append-only log can't be re-pointed at another location.

**A5 — purchasing.** A receipt is how stock *arrives*; without it, `qtyOnHand`
is a number someone typed. A5 answered it in core: suppliers are parties
carrying a role, a purchase order holds what was ordered and **no copy of what
arrived** (received quantity is summed from receipts, and delivery progress is
derived), and `receiveAgainst()` is the one operation that creates stock — it
lands real rows at a location FK, logs a `receive` movement per landed row, and
updates a moving-average cost. A posted receipt is append-only, like the
custody ledger it feeds.

**A5.1 — the holes A5 exposed.** A5 left four things visible but unusable, and
this increment closes them because each is the *same* kind of hole: a fact the
store could represent but nothing could produce. `transfer` and `adjust` had no
write path (an item's place and its count were silent edits), the dashboard's
one-click **Restock** still set `qtyOnHand` with no document behind it, and
`RentalSub.vendor` was still free text where a supplier FK now belonged. So:
`moveStock()` logs a transfer at the destination and `adjustStock()` logs the
signed difference of a physical count (with stock status following the count, in
both directions); `raiseReorder()` raises a **draft purchase order** and moves no
quantity, so a reorder cannot become stock without a supplier and a receipt; and
a sub-rental names a partner carrying the supplier role. The Items page gained the
**Move** and **Count** actions and a **Ledger** section in the record viewer, so
the screen that writes a movement is where it is read back.

**A5.2 — the buying lists read by date.** A5's two document lists were long: a
purchase order carries the day it was raised and a receipt the instant it was
posted, so neither list could answer "what came in last week?" without reading the
whole table. Both now take the inspection log's period filter — `All / Day / Week /
Month` chips with the `‹ range ›` pager — reading orders by `orderedAt` and
receipts by the day their posting instant falls on. The window itself is **one
definition for the app**: `periodBounds(view, anchor)` beside `periodLabel()` in
`core/data.service.ts`, Monday-based weeks and months ending on their last day,
with the cursor kept on the period's *first* day so that the label names the window
the rows were filtered by — which is exactly why the chip that switches the view
snaps the cursor (a week to its Monday, a month to its 1st). Each list keeps its
own window, because "what did we order?" and "what arrived?" are asked of two
different dates and one shared cursor would put a different week under one label.
The empty state names the period when the period is the reason it is empty, the
record count and the topbar search pill count what the list actually shows, and
the inspection log reads the same helper instead of keeping private copies of the
week/month maths — so the two logs cannot drift apart.

**A6 — one SKU, many places.** A3 gave an item a *place* (one FK) and A5.1 made a
change of place a logged movement, but a part could still only be in one bin with
one count — while a receipt *re-placed* the row it topped up. Real stock is spread
out, so the quantities move into a table the schema needs anyway:
`stock_levels(item_id, location_id, qty)`, one row per pair **only while it holds
something**, with the row's `qtyOnHand` (and a bulk row's `qtyAvailable` /
`totalOwned`) as its **sum** and its `locationId` as the place holding the most —
both recomputed by the one writer that moves a level, so the shelves and the
totals cannot drift. `moveStock()` becomes "take *n* out of this place and put it
in that one" (an emptied place loses its row, a place that already holds the SKU
is topped up rather than duplicated), `adjustStock()` counts **one place** and
logs the difference there, a receipt lands as a level (delivering into a new bin
*adds a place*, which is how one part ends up in two), and `itemsAtLocation()` /
the locations grid / the removal guard read the shelves instead of a column. A
unit (serialized, kit, attachment) keeps its single FK — one machine is one thing
in one place — and labour still has no place at all. Two things the increment
deliberately leaves out: no bulk / cycle-count *screen* (one place at a time
through the row's Count action), and a placement edited straight on a counted row
is silently refused rather than logged, because stock moves through movements.

**A7 — vertical metadata.** A vertical used to re-shape the catalog through
conditionals inside the page: a `VERTICAL_TABS` map, a `COLUMNS` map and a handful
of label strings in `assets.component.ts`, plus a second copy of those labels on
the Categories page. It is now a registry — `core/vertical-metadata.ts`, one entry
per `VerticalKey`, read through `DataService.verticalMeta()` — carrying the tab set
*in its own order*, each tab's label / icon / "add" wording, its grid columns and
what a new record of that type starts as. Two limits keep it a registry rather
than a second app: a column may only name a field the model already has (the page
*selects* and *orders* facts, never invents them — a harness check fails the build
if it tries), and nothing in it decides what is *allowed* (the module licence is
`Tenant.disabledModules`; a tab list is what a catalog *is*). The store reads the
tenant's vertical on every call, so Admin → Feature Modules re-shapes the Assets
tab strip, its columns, its wording and its opening tab with no reload and no
component-level map in step — and that panel now *shows* the consequence, tab by
tab, instead of just flipping a switch.

**A8 — data model.** The front end has been the spec all along; this increment
writes the spec down as tables/columns/FKs/types, so the API is built against a
document rather than inferred from TypeScript. `docs/DATA-MODEL.md` is 30-odd
tables (identity, configuration, the catalog, `stock_levels`, the ledger, the
buying side, the module tables) with keys, nullable/required flags, collisions
resolved and enums written out, plus three sections a schema designer needs and
the types cannot say: what is **derived at read time and must never be a column**
(the totals, a PO's received quantity, an order's amount), **what the server must
enforce** (the refusals the store makes today, as constraints), and **what is
deliberately not modelled yet** (reservations, level-tracked kits, count
sessions, documents). The document is guarded like the code: `check9.mjs` reads
`models.ts`, `data.service.ts` and the doc as text and fails the harness if a
model has no table, a table invents a name, a column is not a field, a `NOT NULL`
contradicts the type's optionality, an enum drifts, a foreign key dangles, the
five derived stock columns are not the ones the store derives, or the per-type
status table stops matching `ITEM_STATUSES`. A column the model does not have is
a bug in the doc, not a wish — so a new field is proposed in TypeScript first.

**A9 — every table is a tenant's.** A8 closed by naming a hole out loud: the
settings tables were the one place a screen writes rows that `auditedRows()` did
not cover, so Admin could add a category, retire a location type or change a tax
rate and nothing recorded who. They are now rows like any other — the six
configuration types carry `AuditFields`, the writer stamps them (seeded rows
backfilled by the same pass that backfills everything else, a new one attributed
to the acting user, an edit re-stamping `updatedBy` without touching the create
stamps). Two things about *settings* rows are special and are handled rather than
hidden: they have no surrogate id, so the writer keys them by their natural key
(`location_types.name`, `categories.type` + `name`, `tax_schedules.code`, and one
`settings` row each for `pricing` / `yard`), and because the rename mutators move
that key *in place*, the writer follows the row — a rename takes the edit stamps
instead of reading as a delete plus a fresh create that would lose the original
author. The other direction is now guarded too: `check9` fails if a mapped table
names a store key `auditedRows()` never writes, so the hole cannot be reopened by
a new settings table — and the two tables that genuinely cannot take a stamp from
a request context (`tenants` — the workspace is its own boundary; `users` — a
person is created by a sign-up, and `users.tenant_id` already scopes the row) are
**declared exceptions** in the document, with the reason, rather than left silent.

**A10 — the customer is a join, not a copy.** A9's close-out left one hole A8 had
named still open, and the follow-up list carried it: `orders.party` was a stored
copy of the counterparty's name — the single column in the model that duplicated a
join, and one the API would have had to keep in step with `parties` by hand. The
fix is subtraction: the column is gone from `models.ts`, from the fixture and from
both order-creation paths, and every screen that printed it now resolves the name
through the FK (`partyName(order.partyId)`) — the same rule `userName()` and
`locationPath()` already follow, and the reason a partner renamed on the Parties
grid renames every contract at once. Removing a stored copy is only safe if the
join cannot fail, so the increment adds the other half: `partyRemovalBlockers()`
names what points at a party (orders, purchase orders, their receipts, the
sub-rentals it hires to us) and `removeParty()` refuses while that list is
non-empty. That is the API's `ON DELETE RESTRICT` — and it is enforced now, not
claimed: before A10 the document asserted the refusal and `removeParty()` deleted
the row anyway, which is exactly the kind of promise a derived name would have
turned into a screen printing a raw `PTY-00x` where a customer belongs. The
Customers grid's Remove button reads the same list the guard does (the
`locationRemovalBlockers` pattern: one source, two readers). What is left of a
party with history is `active = false`, which the document already said.

**A11 — a negotiated rate is read, never copied.** The gap the document named last
("Pricing per party and per contract… a customer-specific rate card is not
modelled") is the other half of the same idea as A10: money that belongs to a
counterparty, resolved through the FK rather than written down twice. So
`price_cards` (with `price_card_lines`) hangs off `parties`, and the order screens
**read** it — `lineTotal()` and `rateBasis()` both go through one reader,
`cardRateFor(partyId, item, onDate)` — which means a repriced card moves every
order it covers at once and the order row is never written. The catalog keeps its
own list prices (`items.rate_daily` is the fallback, not the override), so the
"printed rate" and the "Gross above it" cannot drift: they are the same call. The
line's own risk premium is the one factor the *amount* applies and the printed rate
does not (A11.2, and the prototype's own split), so the figure a row shows stays the
figure a counterparty agreed.

The card carries a **window**, and that is what makes the join safe rather than
retroactive: an order prices at the card in force on the day its *booking* starts
(`lineStart()`), so a renewal is a new card with a later `effectiveFrom` and last
year's contracts keep last year's prices. Deleting a card cannot dangle an FK —
nothing holds a `price_card_id` — so the consequence of a removal is visible on
the order screens instead, and `active = false` is how a card is retired while it
still has to read back.

The buying side is deliberately **not symmetric**, and the document says why: an
order line has no price column (its price is derived), while a purchase order line
stores the `unit_cost` it was raised at — a supplier's quote is the document's own
fact. So a supplier's card seeds the PO editor's cost and the raised PO keeps
stating its own price. The default is **one rule** (`poLineCostFor()`: the card,
else the row's cost), read both when a line is picked (`syncLine()`) and when the
supplier changes (`onSupplierChange()`): a price agreed with the previous
counterparty is not the next one's starting point, so those lines move — which is
what makes the dashboard's reorder draft (lines, no supplier) end up at the
negotiated price the moment the buyer picks who it is going to. The form only ever
replaces a figure *it* supplied; a cost a person typed is the document's. One
table, two readers, each reading its own half. The counterparty is a row in
`parties` because
A5 made a customer and a supplier the same row, so a partner that is both has one
card, not two that drift. That FK joins the party guard, so a party whose only row
is a card cannot be removed either — the card has to go first.

**A11.2 — the invoice bills what the Gross prints.** A11 made the *rate* a join;
auditing the money it produces found the invoicing engine disagreeing with it, and
disagreeing worse than the gap list admitted: `lineAmountForPeriod()` multiplied the
rate `rateBasis()` returns — which can be the *weekly* or *monthly* one — by the day
count of the cycle, so a 21-day boom lift invoiced `2325 x 21` where Order Details
prints three weeks, and a rental on an expired card could not agree with itself
either (the printed rate came from one day count, the amount from another). The
prototype's rule is the one the increment rests on: a rental on the weekly or monthly
basis bills in **whole units** (`wholeUnitsBilled()`), each unit going to the cycle
that holds the majority of its days, so every unit lands in exactly one cycle and a
booking's cycles add up to its `lineTotal()`. The cuts that make that true are one
reader each: the basis steps on the **line's own days** (`lineDays()` — a three-day
line inside a 21-day order is a daily booking, and the invoice bills the same three
days), the basis *prints* the agreed rate while the *amount* applies the line's risk
premium once (the prototype's split, and the only way `rate x units x (1 + premium)`
reconciles), and the period length is the **party's cadence** (`partyCycleDays()`
reads `parties.billing_cycle` — a stored column with no reader until now; the
fixture's three customers bill weekly, bi-weekly and monthly, and their three cycle
shapes are what proves the read).

"Run Next Cycle" is part of the same repair: it was wired to a store method that only
raised cycle 1 for orders that had none, so no second cycle could exist and the rest
of every booking was unreachable — the button's own comment described the behaviour
the store did not have. `runNextCycle()` now raises the period that follows each
active order's last one, at that party's cadence, and raises **nothing** when the
period bills no base: the prototype rolls every unpaid invoice forever, which
collects `$0` cycles still carrying a fuel charge, and stops the clock entirely the
moment a customer settles one. `check13` holds the invariant directly — the
fixture's cycles tile the booking and their bases sum to the Gross, to the cent —
and the same reconciliation caught the fee chain's one wrong constant: the damage
waiver is 3% of the base (the prototype's `invoiceCompute`), not the 5% the port had
carried unremarked since its first commit.


## Open decisions (need the owner's call)

1. **"One SKU, one place" — settled: a SKU lives in as many places as it holds
   stock in.** The owner called it, and A6 is in. The shape delivered is exactly
   the one this doc described: `stock_levels(item_id, location_id, qty)` with
   `qtyOnHand` as its sum, one row per pair *while it holds something*, and the
   row's `locationId` kept as the place holding the most (a derived home, written
   by the same call that sums the levels). The increment did not decide whether a
   *kit* or an *attachment* (an owned count, not a shelf quantity) should also be
   held in levels; **A8's schema states it rather than implying it** — they keep
   one place and a `qty`, and the doc says so and says why. The other half is
   still open: how a stock *transfer between tenants' sites* would read (the same
   table with both sites' locations, which is why the FK is a location and not a
   tenant).
2. **What a vertical does *not* yet carry (A7's leftovers).** The registry holds the
   catalog's shape, not everything industry-shaped in the app. Still decided
   elsewhere, and each wants an owner's call before it moves:
   **per-vertical category seeds** (a clinic's supplies are grouped nothing like a
   yard's), **per-vertical search wording and view titles** (the shell's `VIEWS`
   titles are static — "Assets" is every vertical's page name even where the
   registry calls the rows "Supplies"), and **per-vertical view gating** (a
   warehouse has no scheduling). All three are deliberately outside the registry so
   far: two are permissions or shell concerns, and the third needs a seed-shape
   decision first.
3. **`bin` vs location.** Resolved in A3 by *deleting* `bin` and putting the bin
   into the hierarchy (Aisle → Rack → Bin), because the seeded location types
   already included `Bin` — i.e. two models of one fact. If the real yards keep a
   printed shelf label that is not a hierarchy node, say so: A3's commit is the
   thing to revert, and the alternative is `bin` becoming the label *within* a
   location (a composite key the hierarchy alone can't express).
4. **Phases B–E are not recorded in this repo.** They were discussed as "beyond
   the foundation" (the API seam, persistence/offline, auth, tenant admin), but
   no scope was written down, and this doc will not invent one. State the phase
   titles and they get written up before any work starts.

## Verification recipe

```bash
npm run build          # AOT + strict templates
npm run check:store    # 140 runtime checks against the real store, no browser
npm run lint:ctor      # class-field initializer order
npm run lint:styles    # duplicate/unused stylesheet rules
```

There is no Chrome on the dev box, so Karma can't run. Instead
`npm run check:store` (`scripts/check-store.sh`) compiles the core services with
`tsc` into a temp dir and runs the harnesses in `scripts/runtime-checks/`, which
hand-roll `localStorage` and assert on the store's own output:

- `check.mjs` — **A1, 9 checks:** tenancy, roles/`can()`, tenant licence flags,
  session switching, the schema-bump reseed.
- `check2.mjs` — **A2, 8 checks:** seeded rows backfilled, new rows stamped,
  edits stamped without smearing untouched rows, movement authorship, deletion.
- `check3.mjs` — **A3, 12 checks:** the seeded hierarchy, `locationPath()` /
  `locationLabel()`, the depth-first option walk and its cycle guard, every stock
  row placed (and labour deliberately not), the `bin` string gone, the same
  warehouse rule for shop units, `itemsAtLocation()` direct vs. subtree, the
  block-on-contents removal guard, and an edit re-pointing the FK.
- `check4.mjs` — **A4, 11 checks:** the seeded ledger carries FKs and no display
  string, each seeded movement left from where its own unit sits, the path reads
  back, `movementsAtLocation()` at a node vs. its subtree, the store-resolved
  issue place, a return that re-homes the unit, the earlier issue keeping its old
  place, a caller-chosen place on a non-return, both removal blockers (stock and
  history) and that an unreferenced node still removes.
- `check5.mjs` — **A5, 16 checks:** supplier roles partition the partner table,
  the three PO states with progress derived from receipts (no stored received
  column), units created / SKUs topped up at the ordered cost, a moving-average
  cost, every receipt line placed at the receipt's location, one movement per
  landed row carrying the receipt id, a second receipt completing a partial
  line, the refusals that write nothing (over-receipt, draft, cancelled,
  unknown, mis-located), edits that contradict arrivals, the removal guard,
  attribution + receipt immutability, store-assigned line ids, a reload that
  restores the receipts instead of posting them twice, and the partner-creation
  path.

- `check6.mjs` — **A5.1, 14 checks:** the fixture ledger carries only the kinds
  the fixture can produce (no hand-written transfer/adjust), a move re-placing the
  *stock* and logging one transfer at its destination (readable per row and per
  location, old place as the default note, the emptied source losing its row), a
  unit row moved whole, a count logging one signed adjustment at the place it was
  taken, counting one bin leaving the other bin's stock alone, a bulk count keeping
  owned = available + out (so `capacity()` is untouched), status following the
  count both ways, seventeen refusals that write nothing (matching/negative/
  no-such-place/unknown-row/uncountable counts, same-place/no-such-place/
  no-such-source/unknown-row/zero/over-quantity/empty-source/partial-unit
  refusals, labour, a unit that is out), a reorder raising a draft with the
  shortfall line **without moving on-hand**, a draft being unreceivable until a
  supplier is named (then the receipt moves it), every sub-rental naming a
  supplier party, and a vendor-less sub-rental being refused.

- `check7.mjs` — **A6, 14 checks:** the fixture's levels (a row only while it
  holds stock, the composite key written out, only counted types in the table) and
  the invariant underneath the increment (every counted row's total equals its
  levels' sum), the part the fixture keeps in two bins with a count in each, the
  unit/labour answers from `placements()`, a move taking *part* of a place away
  (source keeps the rest, destination gains it, one movement, an emptied place
  losing its row, the total unmoved and the home following the biggest holding), a
  move into a place that already holds the row adding to it, a receipt landing as
  a level (a *new* place for the same SKU, then the same composite key topped up),
  the place readers (`itemsAtLocation`, `locationStockQty`) following the shelves,
  the removal guard blocked by stock and released when the place empties, that
  guard still blocked by the *history* a count leaves, a counted row refusing an
  edit that would move stock (while a unit row obeys one), a new row's opening
  balance at its opening place (and no movement for it), a removed row taking its
  levels with it, the shelves surviving a reload, and the table read directly as
  a report.

- `check8.mjs` — **A7, 9 checks:** every vertical has an entry (each with a label,
  a noun, tabs and a default tab it actually carries) and an unknown key falling
  back to the default catalog; every tab naming a real `CatalogType` once, with a
  label, an icon, an "add" wording, columns and a default status/count the type's
  editor offers; **every column naming a field the model actually has** (the guard
  that caught a warehouse bulk line reading a `qtyOnHand` a bulk row doesn't
  store); the store reading the *tenant's* vertical and following a switch live;
  flipping the vertical changing tabs, order, labels and the opening tab (yard →
  clinic → warehouse); the columns following the vertical rather than the type
  (the same part, priced in one industry and not the other); a new record starting
  as the vertical's default rather than a constant; the terminology being data (a
  lumberyard's "New Bulk Material", no rental rate column); and the verticals
  being distinct entries with more than one tab shape.

- `check9.mjs` — **A8, 10 checks:** `docs/DATA-MODEL.md` against `models.ts` —
  every model named in the doc and every table heading naming a real model; every
  documented column a field of that table's type (with only the audit columns, a
  declared rename and a declared parent/map key allowed to differ); **`NOT NULL`
  agreeing with the type's optionality**, so a nullable field is never documented
  as required; every table `auditedRows()` writes appearing in the map, with a
  section — **and the other direction: every mapped table that names a store key
  being one `auditedRows()` writes, unless the doc declares it an exception** (so
  a settings table written without stamps fails the harness); every enum matching
  its union member for member, and every column type being a documented enum or a
  scalar; every `REFERENCES` naming a real table; the five derived stock columns
  the doc marks derived being exactly `DERIVED_STOCK_KEYS`; and the per-type status
  table matching `ITEM_STATUSES`.

- `check10.mjs` — **A9, 10 checks:** every configuration row (location types,
  categories, tax schedules, overheads, the `pricing` and `yard` singletons)
  carrying all five stamps after the seed backfill, each naming a user the store
  resolves; a category added in-session attributed to the acting user; an edit
  (`updateTaxSchedule`, `updatePricing`) re-stamping `updatedBy` while the create
  stamps stand; **a rename keeping the row it renamed** — the natural key moves, so
  the stamps must follow the row (checked for a location type *and* a category,
  which is what fails if the writer keys rows by name alone); a settings write not
  smearing its neighbours; and the whole settings surface still stamped after an
  unrelated write.

- `check11.mjs` — **7 checks:** the day/week/month window the two Purchasing &
  Receiving lists filter by (`periodBounds()`, shared with the inspection log) —
  a day is its own day, a week is Monday→Sunday *wherever* the cursor sits in it
  (Sunday's `getDay()` of 0 is the case a naive offset gets wrong), a month is the
  1st to its last day including a leap February, and the pager's label names the
  window the filter selects (the cursor has to be the period's first day, which is
  why `setRange()` snaps it). Then the fixture's own dates: a purchase order is
  dated by the *day* it was raised and a receipt by the instant it was posted, so
  the day/week/month windows select exactly the documents the seed intends — a
  month, a week that straddles a month end, and a single day.

- `check12.mjs` — **A10, 6 checks:** the order's customer is a join — no order row
  carries a name (`'party' in o` is false), the store resolves one for every
  seeded order from `parties`, and a **rename reaches every contract without
  writing an order row** (the test a stored copy cannot pass: the order's own
  `updatedAt`/`updatedBy` stand while the name it prints changes). Then the FK
  that makes the derivation safe: a party named by an order is refused removal for
  every order in the fixture, the buying side and the sub-rentals are in the same
  list (a PO's supplier, every receipt's supplier, a sub-rental vendor), and a
  party nothing points at still removes — the guard is a guard, not a freeze.

- `check13.mjs` — **A11 + A11.2, 14 checks:** a negotiated rate is a join like the name
  is, and the invoice bills it whole.
  Every card in the fixture names a real party and carries its stamps; one order
  bills at its customer's card (the weekly basis prints the *card's* `baseWeekly`,
  the one-time types its `unitPrice`, and the Gross is the sum of them); and the
  **catalog keeps its own list prices** while a party with no card bills exactly
  what it billed before cards existed. Then the window: an expired card prices
  nothing (Meridian's 2025 rates leave CT-2024-002 at the catalog's 1325 x 3, and a
  card created for them moves the same line to 995 x 3, then removing it puts the
  catalog back — the test a fixture-only coincidence cannot pass). Repricing a card
  moves the Gross **without writing the order row** (A10's test, in money), a card
  for one customer does not touch another's order, the buying side takes a
  supplier's card as the editor's *default* while the raised PO keeps the price it
  was ordered at, the dashboard's reorder draft (a line and no supplier) lands on
  the agreed price the moment a supplier is picked — one rule, `poLineCostFor()`,
  behind both fills — and removing a card — a row nothing references, so it needs no
  guard — sends the booking back to the catalog rates. Finally the FK A11 added
  joins the party guard: a party whose only row is a rate card cannot be removed
  either (the card has to go first), which is what keeps `price_cards.party_id`
  from dangling the way a removed `orders.party_id` would have.

  A11.2's five checks take that rate through the invoice. A fixture cycle bills **whole
  weeks** (2325 for the boom lift's week — explicitly not `2325 x 8`, the day-multiplied
  figure it replaced) and a monthly party's 28 days one monthly unit, premium applied
  once; the fee chain is asserted against the *period's* base rather than the order's
  Gross (env fee from the invoice's snapshot, the waiver 3% as the prototype computes it,
  tax on the lot); the cycle length is the **party's** (7, 14 and 28 days, each matching
  its fixture cycle, with a cadence the store doesn't know falling back to
  `pricing.cycleDays`); a booking's cycles **tile it and sum to the Gross** — asserted
  per line and on the bases, with a settled cycle still rolling and no `$0` cycle raised
  once the days run out; and the basis steps on the **line's own days** (a three-day
  line inside a 24-day order bills the daily rate, and the invoice agrees), which is the
  second day-source bug the same audit found.

Add a check with each increment — the seed is the fixture, so a harness check is
the cheapest way to prove an invariant still holds.

## Conventions worth restating

- A new table must be added to `DataService.auditedRows()` or it is written
  without tenant/author stamps — and `check9` fails if the document's map names a
  store key the writer never covers (unless the doc declares the table an
  exception, which only `tenants` and `users` are).
- A new seed shape must bump `VERSION`, and the shell must keep telling the user
  their data was replaced.
- Display strings are resolved at read time (`userName`, `locationPath`,
  `partyName`), never stored — an order names its customer by FK and nothing else,
  so a rename on the Parties grid reaches every contract without touching a single
  order row (A10).
- Rates are resolved the same way (A11): one reader (`cardRateFor()`) feeds both
  the printed rate and the line total, and the catalog keeps its own list prices
  underneath. Anything a counterparty *agreed* is read through the FK; anything a
  document *states* (a PO line's `unitCost`) is the document's own fact. A default
  is one rule too (`poLineCostFor()`), never an inline `??` chain in a form —
  anywhere the same figure is filled twice, the two copies will drift.
- A rental bills in **whole units** of its basis (A11.2), never `rate x days`: a week
  is a week and a month is a month, and each unit belongs to exactly one billing
  period, so a booking's cycles add up to its Gross and none of them double-bills.
  The *period* length is a counterparty term as well (`partyCycleDays()` reads
  `parties.billing_cycle`) — when a figure is per-party, the schedule that repeats it
  is read from the same party, not copied onto the document.
- A movement's place is *derived*, not asked for: the store resolves it from the
  unit (`logMovement`), so a hand-off can't be logged somewhere the machine never
  was. Only a `return` re-homes a unit — the shelf follows the ledger, and the
  ledger never follows the unit.
- A stored FK must stay resolvable, so a place can only be removed while nothing
  points at it (stock *and* log rows) — `locationRemovalBlockers()` is the single
  list both the guard and the grid's disabled button read.
- A document that moved stock is append-only: a posted receipt has no edit and no
  delete, and a PO that delivered can't be cancelled or shrunk. Correct a mistake
  with a new movement, never by rewriting the document that caused it.
- Stock arrives through `receiveAgainst()` and nowhere else. A counter that no
  document backs (`qtyOnHand`, a PO's "received" total) is a bug waiting to
  happen — sum the receipts instead.
- A reorder is a document too: `raiseReorder()` raises a **draft purchase order**
  and names no supplier, because "what should we buy" and "who from" are two
  decisions and only the first belongs to a button.
- Placement and count are *movements*, not fields: `moveStock()` and
  `adjustStock()` write the ledger as they write the row, so `transfer` / `adjust`
  are never logged by hand and a difference always has an author, a place and an
  instant. Editing an item's location directly is a data fix, not a stock
  movement.
- **A counted row's quantity is a table, not a number.** `stock_levels` (one row
  per item + place, only while it holds something) is the truth; `qtyOnHand` /
  `qtyAvailable` / `totalOwned` are its sum and `locationId` is its busiest
  holding, recomputed by `syncStockTotals()` after every level write and never
  written by a mutator — a patch carrying them is stripped, because a field edit
  that moved stock would leave a number nothing accounts for.
- A *place* is emptied by the movement that empties it, not by a delete: an
  emptied level row leaves the table, and a count to zero still logs its movement
  at that place — so history keeps the place alive after the shelf is clear (the
  same rule A4 set for the ledger).
- Opening balances are levels without movements: stock a workspace already owns
  arrived by no operation the app can name, so `createItem` writes one level row
  and logs nothing — exactly how the fixture places its own stock.
- **A vertical is metadata, not a conditional.** Which tabs a catalog exposes, in
  what order, what each is called, what its "add" button says, which columns its
  grid prints and what a new record starts as live in `core/vertical-metadata.ts`
  and are read from the tenant (`DataService.verticalMeta()`). A page may ask the
  store for them; it may not keep a vertical map of its own, and a column may only
  name a field the model already has (check8 fails if it doesn't).
- A vertical shapes the *catalog*, not permissions: what a workspace may use is the
  module licence (`Tenant.disabledModules`), and the two must not be conflated —
  hiding a tab is not denying a right.
- **The schema is a document, not an inference.** `docs/DATA-MODEL.md` is the
  spec the API is built from, and it is kept in step with the code by `check9`:
  add a model and it needs a table, add a field and the table needs the column,
  write a `NOT NULL` the type does not promise and the harness fails. A column the
  model does not have is a bug in the doc — so a new field is proposed in
  `models.ts` (and used) first, then written down.
- **Configuration is a tenant's data, so it is stamped (A9).** A settings row
  (`location_types`, `categories`, `tax_schedules`, `overheads`, `pricing`,
  `yard`) is written by a person in Admin, so it is in `auditedRows()` like any
  other table. Two consequences worth knowing before editing one: it has no
  surrogate id, so the writer keys it by its **natural** key
  (`location_types.name`, `categories.type` + `name`, `tax_schedules.code`), and
  because a rename mutates that key in place the writer **follows the row** — a
  rename is an edit, never a delete plus a create. Only `tenants` and `users` are
  outside the writer, and `docs/DATA-MODEL.md` declares both as exceptions with
  the reason; a new table needs a `store key` in the doc's map *and* an
  `auditedRows()` entry, or `check9` fails.
