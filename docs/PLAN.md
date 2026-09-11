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
| A4 | Movements write real locations: `Movement.location` string → `locationId` FK, hand-off picks a location, custody log shows the path | ⏳ next |
| A5 | Purchasing as core: supplier → PO → receipt → stock (absent entirely today) | ⏳ **needs a decision (see below)** |
| A6 | Vertical metadata registry: the per-vertical field/tab/label sets become data the tenant carries, not conditionals in components | ⏳ |
| A7 | `docs/DATA-MODEL.md` — tables, columns, FKs and enums derived from `models.ts`, as the schema the API implements | ⏳ |

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
the hierarchy rather than a string beside it. Both item editors (Items & Stock,
Scheduler pool) write the same field; the column, the search and the record
viewer read it; `itemsAtLocation()` answers "what is here?" for one node and for
its whole subtree; a location holding stock can't be deleted out from under it.

**A4 — movements.** A movement records where it happened as an FK, so the ledger
can be read back per location ("what left Yard A this month?") and the immutable
log stops carrying a display string.

**A5 — purchasing.** A receipt is how stock *arrives*; without it, `qtyOnHand`
is a number someone typed. This is the largest missing core flow — see the
decision below before starting.

**A6 — vertical metadata.** A vertical currently re-shapes the app through
conditionals scattered across components. It should be a registry (tabs, field
sets, labels, defaults) so a new vertical is data, not code.

**A7 — data model.** The front end has been the spec all along; this increment
writes the spec down as tables/columns/FKs/types, so the API is built against a
document rather than inferred from TypeScript.


## Open decisions (need the owner's call)

1. **A5 scope.** Is purchasing (supplier → PO → receipt → stock/cost) in *this*
   core pass, or does the core stop at custody and the money side stay an
   industry module? It changes the A4/A6 ordering, because receipts are what
   make per-location stock trustworthy and they are the natural first consumer of
   `itemsAtLocation()`.
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
npm run check:store    # 28 runtime checks against the real store, no browser
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

Add a check with each increment — the seed is the fixture, so a harness check is
the cheapest way to prove an invariant still holds.

## Conventions worth restating

- A new table must be added to `DataService.auditedRows()` or it is written
  without tenant/author stamps.
- A new seed shape must bump `VERSION`, and the shell must keep telling the user
  their data was replaced.
- Display strings are resolved at read time (`userName`, `locationPath`), never
  stored.
