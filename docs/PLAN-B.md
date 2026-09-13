# Phase B — the workspace defines its own forms, every counted asset has places, and receiving becomes a desk

**Why this file exists.** `docs/PLAN.md` is Phase A — identity, audit and the
physical spine — and it ends by saying explicitly that *"Phases B–E are not
recorded in this repo… State the phase titles and they get written up before any
work starts"* (open decision 4). This is that write-up. It is a **plan, not a
commit**: nothing here is applied until an increment below lands green under the
working agreement in `PLAN.md` (one gated commit per step, `npm run build` +
`lint:ctor` + `lint:styles` + `npm run check:store` green, and `docs/DATA-MODEL.md`
updated *before* the code that depends on it).

Three asks drive it, and they turn out to be the same ask seen from three sides:

1. **A jsonb form builder**, so a vertical is not compiled into the app — a
   tenant can capture the facts *its* industry has (a lot number, a calibration
   date, a temperature range) without a release.
2. **Assets with a quantity above one can be in more than one place.** Counted
   stock already can (A6); kits and attachments deliberately could not, and there
   is no screen that shows a *place's* contents.
3. **Receiving and inspections get a desk**, not a button: per-line put-away,
   condition, over/short tolerance, and an inspection that can fail.

> **Read with:** `docs/PLAN.md` (Phase A, the acceptance-criteria voice this file
> copies), `docs/DATA-MODEL.md` (the tables every increment here has to update),
> `docs/HANDOFF.md` (current state — it wins if it disagrees).

---

## 0. Deep dive — what the system is today

### 0.1 The spine (the parts every increment below has to respect)

- **One store, one writer.** `core/data.service.ts` (4,326 lines after B1's helper
  extraction; was 4,479) is the typed
  in-memory DB *and* the `apiAdapter` seam the backend will replace. `save()` is
  the single writer: tenant scoping and audit attribution (`tenantId`,
  `createdAt/By`, `updatedAt/By`) happen there, not in the ~60 mutators.
- **One catalog.** `items` is one table for seven `CatalogType`s — `serialized`,
  `bulk`, `consumable`, `part`, `labor`, `kit`, `attachment` — differing by type,
  not by table, so a cross-type read (a reorder list) is one pass.
- **One truth for quantities.** `stock_levels(refId@locationId, qty)` holds the
  quantities of counted stock; `item.qtyOnHand` / `qtyAvailable` / `totalOwned` /
  `qty` **and** a counted row's `locationId` are derived — the level sum and the
  busiest place — by `syncStockTotals()`, and `updateItem()` strips those five
  keys from any patch. `placements()`, `stockAt()`, `homePlace()` are the readers.
- **One ledger.** `movements` is append-only and carries a `locationId` FK and a
  `byUserId` FK. `receiveAgainst()` is the only way stock *arrives*;
  `moveStock()` / `adjustStock()` are the only write paths for a place and for a
  count. Custody (`isOut()`) is serialized-only.
- **Verticals are metadata.** `core/vertical-metadata.ts` is a registry keyed by
  `Tenant.vertical` — tabs, labels, icons, per-tab columns, per-tab new-record
  defaults — read through `DataService.verticalMeta()`. `check8` fails if a column
  names a field the model does not have, or if a vertical lacks an entry.
- **Modules are a licence.** `Tenant.disabledModules` + `requireModule()` guard;
  a vertical shapes the catalog, a licence decides what is allowed, and the two
  are never conflated.
- **The schema is a document.** `docs/DATA-MODEL.md` is the spec the API is built
  from, kept in step with the code by `check9` (every model ↔ a table, every
  column ↔ a field, `NOT NULL` ↔ optionality, enums ↔ unions, FKs ↔ tables, the
  five derived stock columns, and every table `auditedRows()` writes ↔ the map).
- **Verified without a browser.** `npm run check:store` compiles the core
  services and drives the real store from Node — it held 140 checks in 13 harnesses
  when this plan was written and holds **210 in 25** today. This
  is where a new model/mutator gets its proof, and where the form/level/receiving
  invariants below will be proven too.

### 0.2 Where each focus area stands (and the gap)

| focus | today | the gap |
|---|---|---|
| **jsonb form builders** | No form builder. The only `jsonb` is `Inspection.checks` (five named booleans) and `PricingSettings.riskPremiums`. Vertical metadata is **compiled-in TypeScript**; `Item`'s per-type extras are **fixed optional columns**. | A new industry fact (a lot, a calibration, a temperature band) is a `models.ts` edit → `DATA-MODEL.md` edit → `check9` update → a release. A tenant cannot own its forms, and the Assets editor is hard-coded to `BLANK_ITEM_FORM`. |
| **assets, qty > 1, many places** | Done for counted stock (`bulk`/`consumable`/`part`) via `stock_levels`; a row can sit in two bins with a count in each (`SEED_SPLIT_STOCK` proves it). | A **kit** or **attachment** with `qty > 1` is still one place + `qty` (A6/A8 chose that on purpose: *"an owned count, not a shelved quantity"*). There is **no place/bin screen** ("everything in Bay A-03") and **no bulk count session**. |
| **receiving** | `receiveAgainst()` posts one receipt with **one** `locationId` for every line, one `qty` per PO line, an optional note; over-receipt is refused outright; a receipt is immutable. | No per-line put-away (a crate lands in three bays), no condition (good / damaged / short), no lot/expiry, no over/short **tolerance**, no link to an inspection, no return-to-vendor, no reason code. |
| **inspections** | `Inspection` carries `checks: Record<InspectionCheckKey, boolean>` — a **five-key union** (`tires/fluids/guards/lights/engine`) — plus meter/fuel pairs, `photos` as an integer, `Open`/`Closed`, and the meter-overage preview. | No template, no severity, no measurements (a tread depth, a pressure), no pass/fail/na, no photo *evidence*, no failure consequence (hold, work order), no link to the receipt that delivered the unit. |

### 0.3 Code-health observations (what "streamline" means here)

- **`data.service.ts` is ~4,326 lines** and carries three different jobs: ~800
  lines of seed fixtures, the DB shape + persistence, and the mutators. Nothing
  is wrong with the *facade*, but the seed and the pure helpers do not need to be
  in it.
- **The period filter is copy-pasted.** `LOG_RANGES`/`LOG_RANGE_LABEL` + the
  `‹ range ›` pager + `periodBounds()` wiring exist in `inspections.component.ts`
  and again (as `LIST_RANGES`) in `purchasing.component.ts`.
- **The modal shell is copy-pasted** into every editor template
  (`modal show d-block` + `.modal-backdrop` + `imsModalDismiss` + `imsDirty`).
- **`InspectionCheckKey` + `INSPECTION_CHECKS` + `INSPECTION_CHECK_LABEL`** are
  three parallel sources for one fact — exactly the shape a form schema replaces
  with one.
- Already shared and worth keeping as-is: `record-view`, `tip-*`, `confirm`,
  `unsaved-changes`, `page-search`, the `periodBounds()`/`periodLabel()` helpers.

---

## 1. The one decision that unlocks all three

> **A fact the business *asks questions of* is a column; a fact that is only
> *shown back* on its own record may live in `attributes jsonb`.**

The line is **queried vs. display-only**, *not* "core vs. type-specific". A fact
that is **filtered, sorted, joined, summed, priced, constrained, or read by a
guard/derivation** gets a real column — and it is a column *because of that*, even
when only some tenants use it. "This tenant doesn't care about fuel type" is a
*form-visibility* choice, not a reason to demote the value to a blob: a nullable
column says "absent" perfectly well. A fact that is **only ever rendered on the
record it belongs to** — sparse, heterogeneous, per-industry — goes in
`attributes jsonb`, governed by a `form_schemas` row (B2). The schema is the
*rows*, the values are the *jsonb*, and both the client and the API validate the
values against the same schema.

Three tiers, and the form builder hides the difference so a tenant never notices:

1. **Universal / queried → columns** (nullable when optional): identity, status,
   the derived stock quantities, the placement/custody FKs, the money and rates
   the pricing engine reads, and the fields inspections / telemetry / maintenance
   read. §1.1 buckets the current model.
2. **Tenant-specific / display-only → `attributes jsonb`**, validated by the
   owning `form_schemas` row: the lot, the expiry, the calibration date, the
   temperature band — the facts a company invents for itself.
3. **A promotion path.** The day a company asks "which lots expire this month?",
   the key moves from `attributes` to a column. The form builder keeps rendering
   it identically, so the promotion is a storage change the UI never sees.

**Indexing inside JSON is real, and it is the fallback, not the default.**
Postgres answers `WHERE attributes->>'fuel_type' = 'Electric'` (GIN + `->>`), but
that path buys no FK, no `UNIQUE`, no `CHECK`, no planner statistics as good as a
column's, and it cannot join or feed the derived-column machinery
(`syncStockTotals()`). So `->>` is for the long tail you forgot to promote — not
for a field a fleet view filters on every day. That is why `fuel_type` stays a
column here.

**A wide table is honest; a blob is hidden.** The current `items` has ~35 columns
because the code *reads* them; `NULL` is cheap and a documented nullable column is
navigable. Cramming the same facts into one `extended_properties` blob makes the
database *narrower and harder to navigate* — the real schema then lives in the
app's form definitions and only JavaScript can explain a row. "Clean and
navigable" comes from naming, constraints and `docs/DATA-MODEL.md`'s per-type
column map, not the column count. So the single `items` table stays (a seven-table
split would turn every cross-type read — the reorder list, the page search — into
a `UNION ALL`), and B2 *adds* `attributes` for the new per-tenant fields rather
than replacing the queryable columns with it.

This is the same argument Phase A used for the vertical registry (A7) and for
`orders.party` (A10): **data over conditionals, one source, derived at read
time.** Phase B extends it from "the catalog's *shape* is data" to "the catalog's
*fields* are data" and from "stock is a table" to "stock is a table that carries
its own facts".

### 1.1 The per-type split (fixed columns vs `attributes`)

Every row carries `id`, `sku`, `type`, `name`, `category`, `status`, `notes`,
`active` and the audit columns — see D6 for `sku` vs `id`. Then, per type:

| type | **fixed columns** (queried / derived / joined) | **`attributes` jsonb** (display-only) |
|---|---|---|
| `serialized` | `serial`, `make`, `model`, `meter_hours`, `fuel_type`, `purchase_value`, `base_weekly`, `base_monthly`, `rate_daily`, `order_id` (custody), `lat` / `lng` / `battery` / `last_reported` (telemetry) | colour, year, VIN beyond `serial`, emissions tier, warranty expiry |
| `bulk` | `total_owned`, `qty_available`, `qty_out` (derived), `location_id` (derived), `uom` (if sorted/filtered) | density, grade, moisture %, source |
| `consumable` | `qty_on_hand` (derived), `reorder_point`, `cost_price`, `retail_price`, `location_id` | lot, expiry, calibration date, sterility, storage temperature, manufacturer part no. |
| `part` | `qty_on_hand` (derived), `reorder_point`, `cost_price`, `retail_price`, `location_id`, manufacturer part no. (if searched) | dimensions, torque spec, interchange numbers |
| `labor` | `role`, `certs`, `hourly_cost`, `hourly_billable` | licence detail, certification dates, availability notes |
| `kit` | `qty` (derived once B4 lands), `cost_price`, `retail_price`, `location_id` | — (a kit's *contents* are a bill of materials, a table, not a blob) |
| `attachment` | `qty` (derived), `cost_price`, `retail_price`, `location_id`, `fits_item_id` (if "which attachment fits this machine" is queried) | coupler type, dimensions, weight |

Two things stay columns even though they look "type-specific": the **derived
stock quantities** (`qty`, `qty_on_hand`, `qty_available`, `total_owned`,
`location_id`) because `syncStockTotals()` recomputes them and grids sort on them,
and a **kit's contents**, which are a relationship (Phase C's bill of materials),
not a JSON array.

## 2. Decisions to confirm before coding

These are the owner's calls; the increments below assume the recommended answer
and say so, so a different answer changes one increment rather than the phase.

1. **D1 — where custom values live.** Recommended: a real `attributes jsonb`
   column on `items` (and later on `stock_levels` / `receipt_lines` /
   `inspections`), **not** an EAV key/value table, and the split is **queried vs.
   display-only** (§1) — *not* "core fields only, everything else in the blob".
   The record is read whole by one editor, the API validates the blob against the
   owning `form_schemas` row, and a key that becomes a predicate is promoted to a
   column (a migration, not a rewrite). EAV would make every grid a self-join; a
   core-vs-type-specific split would demote facts the pricing, reorder, telemetry
   and inspection code already reads. §1.1 is the agreed bucketing.
2. **D2 — who owns a schema.** Recommended: `form_schemas` is **tenant data**
   (audited like `categories` and `location_types`), **seeded** from a default
   template the vertical registry names. A tenant may clone-and-edit a template
   but may not silently change another tenant's; the vertical is the *starting
   point*, never a runtime source.
3. **D3 — the validation contract.** Recommended: a **JSON-Schema subset** —
   `type` (`string|number|integer|boolean|date|array`), `required`, `enum`,
   `minimum` / `maximum`, `pattern`, `maxLength`, `items` — small enough to write
   once, strict enough that the API can reject a bad `attributes` blob.
4. **D4 — do kits and attachments get levels?** Recommended: **yes** (B4). The
   user's requirement is "assets with more than one on hand can be in more than
   one location", and a kit/attachment with `qty > 1` is exactly that. Supersedes
   the A6/A8 carve-out; the "half a kit somewhere" worry is answered by making a
   *partial move* legal only in whole units, which the level model already
   expresses.
5. **D5 — does the checklist become a template?** Recommended: **yes** (B7). The
   five booleans become the seeded **default** inspection template for the
   HeavyEquipment/Rental vertical; Healthcare's default asks different questions.
   `INSPECTION_CHECKS` stops being a union and becomes seed data.
6. **D6 — is the SKU a column apart from the `id`?** Recommended for now: **no** —
   the readable `id` (`PRT-001`) *is* the SKU, and nothing in the app depends on
   an id's shape except the generators (`DATA-MODEL.md` says so). `sku` is still
   named in §1.1's universal list so the decision is visible: when the API hands
   out opaque uuids, `sku` becomes the human key (`UNIQUE (tenant_id, sku)`) and
   `id` the surrogate — a rename at the boundary, not a redesign, because every
   reader already goes through `itemLabel()` and the grids.

---

## 3. Phase B increments

Each ends green under the Phase A working agreement and updates
`docs/DATA-MODEL.md` **before** the code. B1 is first because B2/B6/B7 all edit
the same editors; B2 is second because B3/B6/B7 all store into the schema it adds.

| # | Increment | Depends on |
|---|---|---|
| B1 | Prepare the ground — split the seed and pure helpers out of `data.service.ts`, share the period filter, share the modal shell | — |
| B2 | The form schema is data — `form_schemas` (jsonb fields) + `items.attributes` (jsonb) + `<ims-dynamic-form>` | B1 |
| B3 | The vertical carries its template — the registry names a schema, seeds its categories and its titles | B2 |
| B4 | Places for every counted asset — levels for kits and attachments | B1 |
| B5 | Levels carry lot / expiry / hold, and the *place* becomes a screen | B4 |
| B6 | The receiving desk — per-line put-away, condition, tolerance, lot capture | B2, B4 |
| B7 | Inspections from templates — results, severity, measurements, failure consequence | B2, B3 |
| B8 | Follow-ups and evidence — a failed inspection raises a hold / work order, documents land | B6, B7 |

### B1 — Prepare the ground (no behaviour change)

**Problem.** Three later increments touch the same two editors and the same
service, and the code that will be copied a fourth time is already copied twice.

**Shape.**
- Lift the pure functions and the fixtures out of `DataService`:
  `core/domain/period.ts` (`periodBounds`, `periodLabel`, `periodPhrase`,
  `mondayOf`, `dayAt`), `core/domain/pricing.ts` (`movingCost`,
  `wholeUnitsBilled`, `round2`, `pad3`), and `core/seed/` (`seedLocations`,
  `seedItems`, `seedStockLevels`, …). `data.service.ts` keeps the DB shape, the
  writer and the mutators — the public method surface is untouched, so no feature
  file changes.
- One `shared/period-filter/` component (the All/Day/Week/Month chips + `‹ range ›`
  pager + label + `Today`), taking `[(range)]` / `[(anchor)]` and
  `view: PeriodView`. `inspections.component.ts` and `purchasing.component.ts`
  both use it and delete their private copies.
- One `<ims-modal>` (backdrop + `modal-dialog`/`content` + `imsModalDismiss` +
  `imsDirty` + `(dismiss)`), so the ~12 editor templates stop repeating the
  shell. Keep `ModalDismissDirective` — the component wraps it.

**Acceptance criteria.** `npm run build` warning-free; `check:store` still 140
green (the extraction changed no behaviour); the two pages visibly unchanged; no
component keeps a private `Range` type or `all|day|week|month` constant.

**Data-model.** None.

**Status (B1, part 1 — done).** The pure date/time/period helpers now live in
`core/period.ts` (pad2, hmMin, minHM, snap15, dISO, PeriodView, periodLabel,
periodPhrase, mondayOf, dayAt, periodBounds, daysBetween, countWeekdays,
dayOffset, addDays) and the money/billing helpers in `core/pricing.ts` (round2,
movingCost, billableDaysBetween, BILLING_CYCLES, wholeUnitsBilled). `data.service.ts`
imports them and **re-exports the public names** (`export { … } from './period'`),
so every `from '../../core/data.service'` import — and `check11` — keeps working
untouched. `npm run check:store`, `npm run build`, `npm run lint:ctor` and
`npm run lint:styles` are all green. Still to do under B1: the seed split into
`core/seed/`, then the shared `period-filter` and `ims-modal` components.


### B2 — The form schema is data

**Problem.** A tenant's industry facts are columns in `Item` chosen at compile
time. There is no way for a workspace to say "our pumps carry a calibration date
and a flow rate" without a release, and the Assets editor's field list is the
hand-written `BLANK_ITEM_FORM`.

**Shape.**
- One model, `FormSchema`, and its two supporting types:

  ```ts
  export type FormFieldKind =
    | 'text' | 'textarea' | 'number' | 'integer' | 'boolean'
    | 'date' | 'select' | 'multiselect' | 'measurement';

  export interface FormField {
    key: string;              // resolved against the row's `attributes`
    label: string;
    kind: FormFieldKind;
    group?: string;           // the editor's section heading
    help?: string;            // the tooltip/pill under the input
    required?: boolean;
    options?: string[];       // select / multiselect
    unit?: string;            // measurement, or a number's suffix ("hrs", "mm")
    min?: number; max?: number; maxLength?: number; pattern?: string;
    defaultValue?: string | number | boolean;
    /** Display-only: never a predicate without promoting it to a column (D1). */
    showIf?: { key: string; equals: unknown };
  }

  /** Which row / record an editor uses this schema for. */
  export type FormScope = 'item' | 'inspection' | 'receipt-line' | 'stock-level';

  export interface FormSchema extends AuditFields {
    id: string;               // `FS-<scope>-<type>` for a seeded default
    name: string;
    scope: FormScope;
    /** The catalog type it shapes (an item schema), or '*' for any. */
    type?: CatalogType;
    /** The vertical it was seeded from (provenance, not a runtime gate). */
    seededFrom?: VerticalKey;
    active: boolean;
    version: number;
    fields: FormField[];
  }
  ```

- `Item` gains `attributes?: Record<string, unknown>` — the values the schema
  captured. `updateItem()` stores it as-is (it is not derived), and the API
  validates it against the schema in force.
- `FormsService` (`core/forms.service.ts`): `schemasFor(scope, type)`,
  `schema(id)`, `validate(schema, values): FormError[]`, `coerce(schema, raw)`
  (string inputs → typed values) and `defaults(schema)` for a blank form. It
  derives from the same store (`computed` off `data.revision`), like
  `ModulesService` does.
- One shared `<ims-dynamic-form [schema] [values] [readonly]>` rendering
  `FormField[]` over `ngModel` into a plain object, grouped by `field.group`, with
  a small `FieldError[]` under each input. `assets.component.ts` renders its
  built-in fields **and** the schema's fields — the built-ins are simply the
  fields that have columns.
- `docs/DATA-MODEL.md` gains `form_schemas` (with `fields jsonb`), the
  `items.attributes jsonb` column, the resolution rule (`scope='item'` + `type`,
  the tenant's most specific active schema wins), and both map rows;
  `DataService.VERSION` is bumped so a stale snapshot reseeds.

**Acceptance criteria.** A tenant can add a schema field, see it in the editor,
save a value, reload and read it back; an unknown key in `attributes` is dropped
by `coerce()`; a required field blocks save with an inline error; a schema row is
audited (`createdBy` is the person who added it).

**Verification.** `check14.mjs` — a schema round-trips, defaults come from the
schema, `coerce()` types the values, `validate()` names a missing required key and
a bad enum, an unknown key is stripped, and a schema edit is attributed.

**Data-model.** new `form_schemas`; `items.attributes`; `Tenant.disabledModules`
analogy for per-tenant seeding (no new column).

**Status (B2 — core done).** Landed: `FormSchema` / `FormField` /
`FormFieldKind` / `FormScope` and `items.attributes` in `core/models.ts`; the
`formSchemas` table in the store (db shape, seed, `hydrate`, `save`,
`auditedRows`, `VERSION` 11→12) with `list/get/create/update/removeFormSchema`
and a seeded default schema per catalog type; `core/forms.service.ts`
(`schemasFor` / `schemaFor` / `defaults` / `coerce` / `validate`, `coerce` dropping
every undeclared key); `<ims-dynamic-form>` (`shared/dynamic-form`) rendering any
schema; the Assets editor renders its type's schema, coerces + validates on save
and shows the captured fields in the record viewer; `docs/DATA-MODEL.md` has the
`form_schemas` table, `items.attributes`, the map row and both enums. Verified by
`check14.mjs` (7 checks) and `check9` (10) — plus build, `lint:ctor`, `lint:styles`
all green. **Not yet:** a tenant-facing schema *authoring* UI (Admin), which lands
with B3 where the vertical names its template.


### B3 — The vertical carries its template

**Problem.** A7 gave the vertical registry the catalog's *shape* (tabs, labels,
columns, defaults) but left three industry facts outside it — open decision 2 in
`PLAN.md`: **category seeds**, **view titles / search wording**, and **view
gating**. Now that a form schema is data, the *fields* become the fourth, and it
is the one that makes the other three worth doing.

**Shape.**
- `VerticalTabMeta` gains `formSchema: string` — the seeded schema id the tab's
  editor loads (a HeavyEquipment part asks for a manufacturer part number; a
  Healthcare supply asks for a lot and an expiry). The store exposes it through
  `verticalMeta()` exactly as it exposes columns, so a page still keeps no
  vertical map of its own.
- `VerticalMetadata` gains the three leftovers as optional metadata:
  `categoriesSeed?: Partial<Record<CatalogType, string[]>>`,
  `pageTitle?: string` / `searchPlaceholder?: string`, and
  `views?: string[]` (a warehouse exposes no `scheduler`). Each is **read, not
  enforced**: titles/search shape the shell, categories seed a new tenant, and
  `views` is a *suggestion* the licence still outranks (per A7's limit 2 — a tab
  list never grants or denies anything).
- The **Business type & Categories** page (Phase C) is where the registry's effect
  is chosen and seen today: the type's categories are its tabs, and flipping to
  another business type visibly changes the *fields*, not just the columns. (B2's
  original panel for that — a schema-per-tab list on Feature Modules — went with the
  Industry / Vertical switch it belonged to.)
- The per-vertical seeds are applied in `seedCategories()` keyed by the tenant's
  vertical (the fixture already has a vertical), rather than one shared list.

**Acceptance criteria.** Switching the tenant's vertical changes the Assets
editor's extra fields (a schema with a lot field appears for Healthcare), its
tab columns, its titles, and the seeded categories — with no reload and no
component-level map. `check8` grows: every tab's `formSchema` names a real
`FormSchema` of scope `item` whose `type` is the tab's type.

**Data-model.** No new table; `vertical-metadata.ts` is code (a registry), and the
`form_schemas` it names are the B2 rows.

**Status (B3 — done, scoped).** `VerticalTabMeta` gained a `formSchema` id: every
tab now names the `FormSchema` its editor loads, read through `verticalMeta()` so
no page keeps a vertical map. The verticals genuinely differ in *fields*, not just
tabs: Healthcare's supply tab names `FS-item-consumable-clinic` (lot / expiry /
storage temperature) while a warehouse names the generic `FS-item-consumable`.
The Assets editor resolves the schema from the tab first, then by type. `check8`
grew a check that every tab's `formSchema` is a real item schema of that tab's
type, and that the clinic and warehouse differ. **Not yet:** a tenant-facing schema
*authoring* screen (Admin) — the store API (`create/update/removeFormSchema`)
exists; only the UI is left.

### B4 — Places for every counted asset

**Problem.** A kit or an attachment with `qty > 1` is one place and one number
(A6/A8's deliberate carve-out). The requirement is that *any* asset with more than
one on hand can be in more than one place — and today `placements()` returns a
single row for a kit, `moveStock()` refuses a partial move of it, and a receipt
re-places the whole row.

**Shape.**
- Introduce one predicate the code reads instead of `isCountedStock` in the
  placement paths: `isLevelTracked(type)` = `isCountedStock(type) || 'kit' ||
  'attachment'`. `serialized` stays one unit in one place; `labor` stays
  placeless.
- `placements()`, `stockAt()`, `stockTotal()`, `homePlace()`, `syncStockTotals()`,
  `moveStock()`, `adjustStock()`, `landStock()` and `seedStockLevels()` all switch
  to it. A kit's `qty` becomes the level sum like `qtyOnHand` is for a part, so
  the derived-key strip in `updateItem()` grows to the same field set for those
  types.
- `moveStock()`'s "a unit moves whole" refusal becomes "a **serialized** row moves
  whole"; a kit or attachment moves in whole units like counted stock.
- The Assets grid's Location cell already reads `placeLabel()` ("Bay A-03 +1
  more") and the viewer `placeBreakdown()`, so both get the multi-place answer for
  kits/attachments with no screen change.

**Acceptance criteria.** A kit seeded in one place can be received into a second
place and then shows both with a count in each; a partial move leaves the source
holding the rest; a level for a kit survives a reload; `removeItem()` still takes
its levels with it; a serialized unit is still refused a partial move.

**Verification.** `check7.mjs` grows (or `check15.mjs` is added) — the level
invariant ("every level-tracked row's total equals its levels' sum") is asserted
across all five level-tracked types, not the three it covers today.

**Data-model.** `stock_levels.type` is already `catalog_type`, so no column
changes; the `items` per-type table in `DATA-MODEL.md` and the "only counted
stock lives here" paragraph must be rewritten to name the five types and why
(which is the *documented* form of D4).

**Status (B4 — done).** `isLevelTracked()` (counted stock + kit + attachment)
replaces `isCountedStock()` in every placement path: `placements` / `stockAt` /
`stockTotal` / `homePlace` / `syncStockTotals` / `moveStock` / `adjustStock` /
`landStock` / `seedStockLevels`, plus `createItem`'s opening balance and the
derived-key strip in `updateItem` (a kit's `qty` and place are levels now, so a
patch cannot move them). `moveStock`'s whole-row rule now applies only to a
**serialized** unit, and a kit or attachment moves in whole units. Verified by the
new **`check15.mjs` (4 checks)** plus updated `check3` / `check6` / `check7`, which
now use a serialized unit for the "a unit moves by edit" cases. `docs/DATA-MODEL.md`
rewritten for the five types. **Not yet:** levels for *labour* (a person has no
place, by design) and a bill of materials for a kit's *contents*.


### B5 — A level carries its own facts; a place becomes a screen

The two halves of `HANDOFF.md`'s gap 10 ("a counted row's quantity is in a table,
but nothing *shows* the table") and the stock-side answer to D1.

**Shape.**
- `StockLevel` gains `attributes?: Record<string, unknown>` — the per-place facts
  the stock-level schema captures: `lot`, `expiry`, `serial`, `hold`
  (`none | qc | quarantine | customer`), a certificate number. Same rule as B2:
  a fact that becomes a *screen* ("expiring this month", "on hold") is promoted to
  a real column then; today these are displayed on the place's row and filtered
  nowhere. `writeLevel()` accepts the attributes; `moveStock()` carries them
  only when moving the whole level (a partial move of a lot-tracked level is
  refused, because half a lot is not a fact the model can state); `receiveAgainst`
  / `landStock()` write them from the receiving desk (B6).
- **A Place screen** — the missing table view. Two parts:
  - A new sub-tab (or a route `locations/:id/stock`) that lists **everything in a
    place**: for the chosen node (with a subtree toggle), one row per item +
    attributes + qty, reading `listStockLevels(undefined, locationId)` and the
    units from `itemsAtLocation()`. This is the read the location spine has never
    had a screen for.
  - **Move all / count all** from that list, reusing `moveStock()` /
    `adjustStock()` so the write paths do not multiply.
- **A count sheet (cycle count).** A `CountSession`-shaped increment: pick a
  place (or a subtree), the screen freezes a snapshot of its levels, the counter
  enters counted quantities, and posting writes one `adjust` movement per
  difference — the batch `HANDOFF.md` gap 9 names. New model `CountSession` +
  `CountLine` (both audited, a session is a document) so the count is reviewable
  before it posts, and `adjustStock()` is the only thing that moves a number.

**Acceptance criteria.** "What is in Bay A-03?" is one screen; a session on a
place with three SKUs posts exactly the differences and leaves matching counts
alone; a session cannot post twice; every posted line is attributable and lands
as an `adjust` movement.

**Verification.** `check16.mjs` — the place read matches `placements()`, the
session posts a delta per line and nothing when a count matches, a repost is
refused, and lot attributes survive a move of the whole level.

**Data-model.** `stock_levels.attributes jsonb`; new `count_sessions` +
`count_lines` (or a rejected alternative noted in the doc, as A8 does).

**Status (B5 — backend done; screen pending).** `StockLevel.attributes` is a real
`jsonb` column, written through `writeLevel(type, refId, locationId, qty,
attributes?)` so a receipt's landing carries its lot/expiry onto the level, and
`moveStock()` moves a level that carries facts **whole** (a partial move of an
attributed level is refused — half a lot is not a fact the model can state).
`levelAt()` is the single-level read. **Count sessions** are a document:
`openCountSession(place, subtree)` freezes the levels, `setCountLine()` records
findings, `postCountSession()` writes one `adjust` per difference through the same
`adjustStock()` a one-row count uses (a matching row writes nothing, a posted sheet
cannot be re-posted, a draft one is discardable). Verified by the new
**`check16.mjs` (4 checks)**. **Not yet:** the *screens* — the per-place stock list
("everything in Bay A-03") and the count-sheet UI. The store surface they need
(`listStockLevels`, `placements`, `openCountSession`/`setCountLine`/
`postCountSession`) is in place.

### B6 — The receiving desk

**Problem.** `receiveAgainst()` is one destination, one quantity per line, a note.
A real delivery is a crate split across bays, three of twenty damaged, one line
short, and a lot number to record — and the front end cannot say any of it.

**Shape.**
- `ReceiveInput` grows from `{ poId, locationId, qty: Record<lineId, number> }` to
  **per-line landings, so one PO line can be split across places**: a line carries
  `landings: { locationId, qty, condition?, damagedQty?, reasonCode?, attributes? }[]`
  (lot / expiry / serial range — validated against the B2 receipt-line schema).
  "50 in Bay A-03, 100 in Bay B-01" is therefore **one line and one receipt**, and
  each landing writes its own `stock_levels` row (a new bin *adds* a place, an
  existing bin is topped up) plus its own `receive` movement — which is already
  how `landStock()` works; the desk stops forcing one destination on the whole
  document. `receipt_lines` becomes **one row per landing** (not per PO line), so
  the receipt reads back to the place each quantity actually went. The old shape
  stays a thin adapter over this, so the seed and the current editor keep working.
- **Tolerance instead of a wall.** A new `receiving` settings row (audited, one
  per tenant, like `pricing`): `overReceiptTolerancePct`, `requireInspection`
  (a landed serialized unit must have an `Open` inspection before put-away),
  `quarantineLocationId`, `defaultPutAwayLocationId`, `requirePoReference`.
  `receiveAgainst()` refuses an over-receipt only beyond the tolerance; a damaged
  quantity lands in the quarantine location (a real location, so the ledger still
  reads back) and its line's condition is the receipt's own fact.
- **Short-close.** `closePurchaseOrderShort(poId, lineId?)` marks the outstanding
  quantity as not coming (a derived `shortClosed` on the line, not a deleted
  line), so a PO can reach `received` without inventing stock.
- **The editor.** The receiving modal becomes the desk: a row per outstanding PO
  line with a qty, a per-row destination defaulting to the PO's, a condition
  dropdown, a lot/expiry input when the schema asks, and a live total/discrepancy
  footer. The same `receiveAgainst()` posts it.
- **Return to vendor.** Add `'return-to-vendor'` to `MovementKind` (a real enum
  change, `DATA-MODEL.md`'s enum block and `check9` both move) so a damaged crate
  is sent back as a movement, not a silent adjust.

**Acceptance criteria.** One PO line lands **50 in one bay and 100 in another** on
one receipt, writing two level rows and two `receive` movements; a lot/expiry
captured at the desk is on the level afterwards; a 5% over-receipt is accepted
where 20% is refused; a damaged quantity sits in quarantine with a `receive`
movement; a short-closed line stops the PO reading `partial`; the receipt view
shows each landing's condition and destination.

**Verification.** `check17.mjs` — a line split across two places (two level rows,
two movements), tolerance boundary (inclusive), quarantine landing, short-close,
RTV movement, and the refusal set (unknown place, draft/cancelled PO, zero, beyond
tolerance) all writing nothing.

**Data-model.** new `receiving` settings; `receipt_lines` gains `location_id` (one
row per landing), `condition`, `damaged_qty`, `reason_code`, `attributes`;
`purchase_order_lines` gains the derived `short_closed` marker (declared, since it
is chosen not derived); `MovementKind` enum.

**Status (B6, part 1 — split landings done).** `receiveAgainst()` takes per-line
**landings** now (the whole-receipt `qty` shape is kept as an adapter, so the seed
and the simple case are unchanged): each landing writes its own `stock_levels`
row, its own `receipt_line` (`receipt_lines.location_id`) and its own `receive`
movement, and a landing with no place falls back to the receipt's header. The
receiving editor splits a line with **Add place** (`receiving.component` landing
rows). Verified by `check17.mjs` (5 checks): the split, the header fallback, the
old shape, the over-receipt refusal writing nothing, and the per-place levels.
Still to do under B6: the `receiving` settings (over-receipt tolerance,
quarantine place, require-inspection, short-close) and the
`return-to-vendor` `MovementKind`.


### B7 — Inspections from templates

**Problem.** `Inspection.checks` is a five-key union (`InspectionCheckKey`) with a
parallel `INSPECTION_CHECKS` array and `INSPECTION_CHECK_LABEL` map. A clinic
checks different things than a yard, a failed item has no severity, and a measured
fact (tread depth, hydraulic pressure, battery health) cannot be captured at all.
`photos` is an integer.

**Shape.**
- Delete the union. An inspection's checklist is the **fields of an
  `inspection`-scope `FormSchema`** (B2), and the five booleans become the seeded
  HeavyEquipment/Rental template. `Inspection` gains:
  - `templateId: string` (the schema in force, so an old inspection still renders
    even after a template is edited),
  - `results: Record<string, InspectionResult>` where an item is
    `{ value: string | number | boolean | null; result: 'pass' | 'fail' | 'na';
      severity?: 'minor' | 'major' | 'critical'; note?: string; photoCount?: number }`,
    stored as `jsonb` (this is what replaces `checks`),
  - `receiptId?` / `movementId?` so the inspection of a delivered unit joins the
    delivery it inspected (the B6 link the desk needs),
  - `signedBy?: string` (a user FK) and `signatureAt?: string`.
- Meter/fuel stay columns: they are read by the overage math (`allowedHours()`,
  `reading()`), which is exactly the "queried fact gets a column" rule.
- The editor renders `templateId`'s schema through `<ims-dynamic-form>` with a
  pass/fail/na control per field, and keeps the live overage preview. `Open` /
  `Closed` stays the lifecycle.
- **Failure has a consequence.** A `critical` failure marks the inspection blocked
  and offers two actions — **hold** the unit (a B5 level hold, or `In Shop`) and
  **raise a work order** through the existing `createWorkOrder()`; the inspection
  stores the raised id.

**Acceptance criteria.** The vertical's default template is the five booleans
(behaviour preserved); a Healthcare tenant's inspection asks a lot/expiry and a
temperature range; a measured field round-trips a number with its unit; a `fail`
on a required field blocks `Closed`; a `critical` failure offers hold + work
order; editing a template does not re-render an old inspection's results (they
name their `templateId`).

**Verification.** `check18.mjs` — the default template matches the five seeded
keys, `results` round-trips, a required `fail` blocks close, a template edit
leaves an existing inspection readable, and the raised work order id is stored.

**Data-model.** `inspections` loses `checks` and gains `template_id`, `results
jsonb`, `receipt_id`, `movement_id`, `signed_by`, `signature_at`; the
`inspection_check_key` enum leaves the enum block (it becomes fields).

**Status (B7 — done).** The `InspectionCheckKey` union is gone: the checklist is
the fields of an `inspection`-scope `FormSchema`, seeded as
`FS-inspection-default` (the same five condition items, now data a tenant can
edit). `Inspection` carries `templateId` + `results` (`InspectionResult` per field
key: value, `InspectionOutcome`, `InspectionSeverity`, note) plus `receiptId` /
`movementId` / `workOrderId` / `signedBy` / `signatureAt`; the meter and fuel
readings stay columns because the overage maths reads them. The inspection editor
renders the template's fields with an outcome (and a severity when it failed),
refuses a `Closed` record while a **required** item has failed, and offers
**Raise Work Order** on a failure — `raiseWorkOrderForInspection()` creates the job
(`Repair` only when critical) and links it back once. Verified by the new
**`check18.mjs` (6 checks)**. **Not yet:** the photo *files* (a count today →
B8 `documents`) and enforcing `receiving_settings.require_inspection` on put-away.

### B8 — Follow-ups and evidence

**Problem.** A photo is a count, a failed inspection stops at a badge, and a
damaged receipt has nowhere to go but a note.

**Shape.**
- **Documents.** A `documents` table (`id`, `scope`, `refId`, `kind`
  (`photo | signature | packing-slip | certificate | coa`), `url`/`path`, `mime`,
  `size`, `caption`) so inspection evidence and receipt paperwork become rows the
  record viewer can list. The fixture keeps `photoCount` as a derived count so the
  port still runs with no file store (documented as the deliberate local stand-in).
- **A shared evidence panel** used by the inspection editor, the receipt viewer
  and the asset viewer.
- **Hold is a first-class read.** If B5 left `hold` in the level's jsonb, this
  increment makes it a real read (`isHeld(itemId)`, `availableItems()` filters it)
  so custody and the scheduler agree.

**Acceptance criteria.** A failed inspection with evidence shows its photographs
on the record; a held unit is not offered by `availableItems()` / the scheduler; a
critical failure's work order and its inspection cross-link.

**Data-model.** new `documents`; a `hold` column on `items` or `stock_levels` if
B5 left it as a jsonb key.

**Status (B8 — done).** `documents` is a table (`id`, `scope`, `refId`, `kind`,
`url`, `mime`, `size`, `caption`), audited and mapped; a record's photo **count is
derived** from it (`photoCount()`), so `Inspections.photos` (a stored integer) is
gone from the model and the doc. The shared **`<ims-evidence>`** panel lists and
attaches captions (no file store — a row *is* the evidence; documented as the local
stand-in), and it is wired into the inspection editor; the asset record viewer
lists the same rows read-only. **Hold** is a first-class read: `Item.hold`,
`isHeld()` / `setHold()`, and `availableItems()` filters a held unit — a hold is
not custody, so `isOut()` / `custodyItems()` are untouched. Verified by the new
**`check19.mjs` (4 checks)**, including the end-to-end *inspect → hold → work
order* path. **This completes Phase B's eight increments.**


---

## 4. Rules this phase must not break

Restating Phase A's invariants that the increments above come closest to:

- **Derive, never duplicate.** A schema's values are the only copy; `qtyOnHand`
  and a level-tracked row's `locationId` stay `stock_levels`' sum and busiest
  place; a PO's received quantity stays summed from receipts.
- **One writer.** All writes go through `DataService.save()`; a new table joins
  `auditedRows()` *and* the doc's map, or `check9` fails.
- **Documents are append-only.** A receipt, a movement, a posted count session and
  a signed inspection are not edited; a correction is a new row.
- **A vertical is not a licence.** The schemas, tabs and titles a vertical names
  shape the catalog; `Tenant.disabledModules` is the only thing that permits or
  denies.
- **A column before a key.** A jsonb key becomes a predicate only by being
  promoted to a column *and* written in `DATA-MODEL.md` first — never a filter
  over an unindexed blob.
- **The doc is the spec.** New model → table, new field → column, new enum →
  `-- Name` block, new jsonb → the scalar list and the derived table where it
  applies; all before the code.

## 5. Verification additions

`scripts/check-store.sh` lists its harnesses explicitly, so each new file is one
line there. Proposed:

| harness | increment | proves |
|---|---|---|
| `check14.mjs` | B2 | schema round-trip, defaults, coercion, validation, unknown-key strip, attribution |
| `check15.mjs` | B4 | the level invariant across all five level-tracked types |
| `check16.mjs` | B5 | the place read, a count session's deltas and its no-repost rule, lot survival |
| `check17.mjs` | B6 | per-line put-away, tolerance boundary, quarantine, short-close, RTV, refusals |
| `check18.mjs` | B7 | default template, results round-trip, fail-blocks-close, template-edit safety |

`check8` grows the `formSchema` assertion (B3) and `check9` grows the new
tables/columns/jsonb scalars (B2, B5, B6, B8).

## 6. Suggested order

1. **B1** — the ground (no behaviour change, so it is provable in isolation).
2. **B2** — the schema is data (the foundation B3/B6/B7 stand on).
3. **B3** — the vertical carries it (cheap once B2 exists, and it is what makes
   the builder *industry-specific*).
4. **B4 → B5** — places for every counted asset, then the place screen and count
   session (the multi-location ask, read and written).
5. **B6** — the receiving desk.
6. **B7 → B8** — inspections from templates, then their consequences.

## 7. Deliberately left for Phase C

Named so the gaps are decisions, not omissions — the same closing section
`DATA-MODEL.md` uses:

- **A bill of materials** for a kit (assemble a kit *from* parts and draw the
  parts down), which is the level model's next step after B4.
- **An advance ship notice / expected receipt**, so the desk can receive against
  something other than a PO.
- **Real file storage, signatures and OCR** — B8 models the `documents` rows and
  keeps the local no-file-store stand-in.
- **Reservations.** A booking still has no ledger row; the scheduler clamps on
  `capacity()`. A `reservations` table is its own increment (the doc already
  names it).
- **A price on the order line** (a contract override of a price card), which
  `DATA-MODEL.md` names under "Not in the model yet".
- **Multi-tenant membership** (`users.tenant_id` is a single FK), which the
  session is where it will show up first.

---

**Status when written:** Phase A complete through A11.2 (`0240938`), 140 runtime
checks green, no increment here started. Pick the phase up at B1.
