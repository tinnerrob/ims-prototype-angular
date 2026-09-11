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
| A6 | One SKU, many places: `stock_levels(item_id, location_id, qty)` as the truth for counted stock, with `qtyOnHand` as its sum and a move / count that act on a place | ✅ |
| A7 | Vertical metadata registry: the per-vertical field/tab/label sets become data the tenant carries, not conditionals in components | ⏳ |
| A8 | `docs/DATA-MODEL.md` — tables, columns, FKs and enums derived from `models.ts`, as the schema the API implements | ⏳ |

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

**A7 — vertical metadata.** A vertical currently re-shapes the app through
conditionals scattered across components. It should be a registry (tabs, field
sets, labels, defaults) so a new vertical is data, not code.

**A8 — data model.** The front end has been the spec all along; this increment
writes the spec down as tables/columns/FKs/types, so the API is built against a
document rather than inferred from TypeScript.


## Open decisions (need the owner's call)

1. **"One SKU, one place" — settled: a SKU lives in as many places as it holds
   stock in.** The owner called it, and A6 is in. The shape delivered is exactly
   the one this doc described: `stock_levels(item_id, location_id, qty)` with
   `qtyOnHand` as its sum, one row per pair *while it holds something*, and the
   row's `locationId` kept as the place holding the most (a derived home, written
   by the same call that sums the levels). What the increment did **not** decide,
   and A8's schema should state rather than imply: whether a *kit* or an
   *attachment* (an owned count, not a shelf quantity) should also be held in
   levels — it has one place and `qty` for now — and how a stock *transfer between
   tenants' sites* would read (the same table with both sites' locations, which is
   why the FK is a location and not a tenant).
2. **`bin` vs location.** Resolved in A3 by *deleting* `bin` and putting the bin
   into the hierarchy (Aisle → Rack → Bin), because the seeded location types
   already included `Bin` — i.e. two models of one fact. If the real yards keep a
   printed shelf label that is not a hierarchy node, say so: A3's commit is the
   thing to revert, and the alternative is `bin` becoming the label *within* a
   location (a composite key the hierarchy alone can't express).
3. **Phases B–E are not recorded in this repo.** They were discussed as "beyond
   the foundation" (the API seam, persistence/offline, auth, tenant admin), but
   no scope was written down, and this doc will not invent one. State the phase
   titles and they get written up before any work starts.

## Verification recipe

```bash
npm run build          # AOT + strict templates
npm run check:store    # 84 runtime checks against the real store, no browser
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
- `check3.mjs` — **A3, 11 checks:** the seeded hierarchy, `locationPath()` /
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

Add a check with each increment — the seed is the fixture, so a harness check is
the cheapest way to prove an invariant still holds.

## Conventions worth restating

- A new table must be added to `DataService.auditedRows()` or it is written
  without tenant/author stamps.
- A new seed shape must bump `VERSION`, and the shell must keep telling the user
  their data was replaced.
- Display strings are resolved at read time (`userName`, `locationPath`), never
  stored.
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
