# ims-web — the data model (the schema the API implements)

**Why this file exists.** `src/app/core/models.ts` is the port's TypeScript. This
is the same thing as *tables*: columns, types, keys, foreign keys and enums,
written for the person who will build the backend, so the API is built against a
document instead of being inferred from a front end. Every table below exists in
the store today — a fixture seeds it, a screen reads it, a mutator writes it —
which is why the shapes can be trusted: they were forced by working code.

`check9.mjs` keeps this file honest (see `docs/PLAN.md` → "Verification recipe").
It reads this document, `models.ts` and `data.service.ts` as text and fails if a
model has no table, a table invents a name, a column is not a field, a `NOT NULL`
disagrees with the type's optionality, an enum's members drift, a foreign key
points at a table that does not exist, a table `auditedRows()` writes is missing
from the map (or a mapped table that writer does not stamp is not declared an
exception below), or the columns the store derives are not the ones called derived
here. **A column here that `models.ts` does not have is a bug, not a wish** —
propose the field first.

## How to read this

- **Names.** Tables and columns are `snake_case`; `models.ts` fields are
  camelCase of the same name (`by_user_id` ↔ `byUserId`). check9 applies exactly
  that mapping, so a column that is *not* the camelCase of a field has to declare
  itself in its table's heading: this document has one rename
  (`stock_levels.item_id` for `StockLevel.refId`) and two declared structural
  columns — a child table's parent key (`order_lines.order_id`), which the API
  needs and the nested type cannot carry, and a key the store keeps as a map
  (`categories.type`).
- **One row per thing, one table per thing.** Where the front end keeps a map or
  an array on a row, this doc names the table it will become (`items` is keyed by
  type in the store, one table here; `Tenant.disabledModules` becomes
  `tenant_modules`).
- **Every table carries the audit columns** (`tenant_id`, `created_at`,
  `created_by`, `updated_at`, `updated_by` — `AuditFields`). They are *not*
  repeated in the column lists below except where a table's own semantics differ
  (`movements` keeps its author and instant as domain facts). `tenant_id` is on
  every table because every query is scoped by it; `created_by` / `updated_by`
  are FKs into `users`, and the fixture's ids are readable strings the API will
  hand out as uuids.
- **Types.** `text` for the fixture's readable ids (the API will use `uuid`; the
  shape is what matters — see the ids bullet below), `numeric(14,2)` for money and
  rates, `numeric(14,3)` for counted quantities, `date` for calendar dates,
  `timestamptz` for instants, `jsonb` only where a value is genuinely structured
  (`inspections.checks`).
- **Ids.** The store's ids are readable (`LOC-14`, `PRT-001`, `PO-2026-003`,
  `TNT-NORTHLINE`). They are the *fixture's*, not the schema's: they document
  sequencing and prefixes (an API-assigned id must still be stable, opaque and
  unguessable, so a real install gets uuids). Each table states its key; nothing
  in the app depends on the id's shape except the generators.
- **Nothing is stored twice.** Where a value can be summed, it is (see
  "Derived at read time"). A column that duplicates a join is named as such and
  marked as the API's to derive.

## Tenancy and identity

### `tenants` — `Tenant`

```sql
tenants(
  id                text          PRIMARY KEY,
  name              text          NOT NULL,
  slug              text          NOT NULL,
  plan              tenant_plan   NOT NULL,
  vertical          vertical_key  NOT NULL,
  disabled_modules  module_key[]  NOT NULL DEFAULT '{}',
  created_at        timestamptz   NOT NULL
)
```

**Keys/rules.** `slug` is the workspace's URL-safe handle — unique across the
platform (`UNIQUE (slug)`), unlike every other key in this document, which is
unique within a tenant. `plan` is commercial (`starter` / `professional` /
`enterprise`); `vertical` is what the *catalog looks like* — the vertical
metadata registry in `core/vertical-metadata.ts` is keyed by it, and it is read
from this row on every call (so switching it re-shapes the Assets page with no
reload). `disabled_modules` is the licence: absent = enabled, which is why the
column is the *disabled* list rather than the enabled one (a new module shipped
later is on for everyone unless a tenant says otherwise).

### `tenant_modules` — licence flags (from `Tenant.disabledModules`)

```sql
tenant_modules(
  tenant_id   uuid      NOT NULL REFERENCES tenants(id),
  module_key  module_key NOT NULL,
  enabled     boolean   NOT NULL,
  PRIMARY KEY (tenant_id, module_key)
)
```

The store keeps the disabled set as an array on the tenant; the API should keep
it as rows, because the licence will grow columns (who granted it, when it
expires, what it costs). Either way the *rule* is the same: a screen is gated by
the module licence, and a per-vertical tab list never grants or denies anything
(see `docs/PLAN.md`, A7).

### `users` — `User`

```sql
users(
  id          text      PRIMARY KEY,
  tenant_id   uuid      NOT NULL REFERENCES tenants(id),
  name        text      NOT NULL,
  email       text      NOT NULL,
  role        role_key  NOT NULL,
  title       text      NOT NULL,
  initials    text      NOT NULL,
  active      boolean   NOT NULL,
  UNIQUE (tenant_id, email)
)
```

**Keys/rules.** `role` is a permission bundle, never the thing a screen asks
about: `can(user, 'stock.adjust')` is the only question, and the bundle is
defined in code (`ROLES`), not stored per user. `title` is the job title and
carries no rights. Deleting a user is not modelled: a person leaves (`active =
false`) because the audit columns and `movements.by_user_id` point at them, and
history must not break.

**The session is not a table.** Who the client is acting as (`tenantId` +
`userId`) is client state in the store; on the API it is the authenticated
principal, and it replaces every `sessionUserId()` / `sessionTenantId()` call
site. A user may hold more than one tenant later; today one round-trips through
the demo fixture.

## Configuration

These are rows a workspace edits in Admin, not documents the app posts. Two
honest notes before them:

- **They are audited like anything else (A9).** These were the last rows written
  without stamps — `auditedRows()` covered `locations` and nothing else in this
  section — so who added a category, who retired a location type or who changed a
  tax rate was simply not recorded. A settings row is a person's write, so it
  carries the same `tenant_id` + audit columns as every other table, and a
  *rename* (a category, a location type, a tax code) keeps the row's history: the
  natural key moves, the row does not.
- **A settings row is unique per tenant**, so their keys are composite with
  `tenant_id` rather than a surrogate id (which is why `pricing` and `yard` show
  `tenant_id` as their own primary key).

### `locations` — `Location`

```sql
locations(
  id          text          PRIMARY KEY,
  name        text          NOT NULL,
  type        text          NOT NULL,
  parent_id   text          NULL REFERENCES locations(id),
  address     text          NOT NULL,
  phone       text          NOT NULL,
  tz          text          NOT NULL
)
```

**Keys/rules.** `parent_id` is a self-reference: a location has at most one
parent and any number of children, at any depth (an adjacency list — Site → Yard
→ Zone → Rack → Bin today). A root has `parent_id IS NULL`. Cycles are refused by
the app (`isLocationAncestor`), so the API must too: a trigger or a recursive
`WITH` check, because a cycle is unqueryable rather than merely wrong.

Removal is refused while anything points at the row — `locationRemovalBlockers()`
is the shape of the rule: stock *stored* here, or any `movements.location_id`
mentioning it (history is append-only, so a place the ledger names stays; close a
yard by deactivating it instead). On removal the app re-parents the node's
children to its own parent, which is the one action that keeps every FK valid.

`type` names a row in `location_types` by value, not by id: renaming a type
rewrites the column on every location that uses it (`renameLocationType`), and a
type cannot be deleted while a location carries it. That is a `text` column with
a trigger or a lookup by name — the app is not the only writer, so the
constraint belongs in the database.

### `location_types` — `LocationType`

```sql
location_types(
  name    text     NOT NULL,
  active  boolean  NOT NULL,
  PRIMARY KEY (tenant_id, name)
)
```

The list a workspace may choose from (Site, Yard, Zone, Warehouse, Dock, Rack,
Bin). Inactive types stay in Admin and drop out of the pickers.

### `categories` — `CategoryOption` (`type` as the key)

```sql
categories(
  type    catalog_type  NOT NULL,
  name    text          NOT NULL,
  active  boolean       NOT NULL,
  PRIMARY KEY (tenant_id, type, name)
)
```

**Keys/rules.** Categories are per catalog type — the store keeps them as
`Record<CatalogType, CategoryOption[]>`, so `type` is the map's key and the
table's first key column. Renaming is a cascading write: every `items.category`
with the old name is rewritten, in that type only (`renameCategory`), which is
why `items.category` is a `text` name rather than an FK — a schema may prefer an
FK into this table, and if it does, it must carry the rename with a trigger so
the two cannot disagree. A category is never deleted while items use it. Inactive
categories stay listed and drop out of the editor's picker.

### `tax_schedules` — `TaxSchedule`

```sql
tax_schedules(
  code    text           NOT NULL,
  state   text           NOT NULL,
  county  text           NOT NULL,
  city    text           NOT NULL,
  rate    numeric(14,6)  NOT NULL,
  note    text           NOT NULL,
  PRIMARY KEY (tenant_id, code)
)
```

A jurisdiction's rate, applied to an order by the billing module. `rate` is a
fraction (`0.08`), not a percentage — every rate in the model is.

### `overheads` — `Overhead`

```sql
overheads(
  id           text              NOT NULL,
  name         text              NOT NULL,
  category     overhead_category NOT NULL,
  charge_type  overhead_charge   NOT NULL,
  pct          numeric(14,6)     NOT NULL,
  cost         numeric(14,2)     NOT NULL,
  retail       numeric(14,2)     NOT NULL,
  locked       boolean           NOT NULL,
  PRIMARY KEY (tenant_id, id)
)
```

**Keys/rules.** `id` is a generated text id (`OH-…`) inside the tenant, not a
global key. `locked` means "inject into every new order", which is the flag the
order editor reads; it is configuration, not a foreign key, so nothing enforces
it but the writer.

### `pricing` — `PricingSettings` (one row per tenant)

```sql
pricing(
  tenant_id               uuid           NOT NULL REFERENCES tenants(id) PRIMARY KEY,
  daily_min_hours         numeric(6,2)   NOT NULL,
  weekly_hours            numeric(6,2)   NOT NULL,
  cycle_days              integer        NOT NULL,
  weekend_policy_default  weekend_policy NOT NULL,
  risk_premiums           jsonb          NOT NULL,
  env_fee_pct             numeric(14,6)  NOT NULL,
  depreciation_annual     numeric(14,6)  NOT NULL
)
```

The pricing-rules engine as data: the shortest billable day, the weekly hours
roll-up, the billing-cycle length, the default weekend policy and the
environmental fee. `risk_premiums` is a `Record<RiskPremiumKey, number>` — three
named multipliers — kept as `jsonb` because it is a small closed map a pricing
engine reads whole; a schema that prefers columns can widen it to
(`tenant_id`, `key`, `multiplier`). Everything derived from it (an order's
amount, a line's total, an invoice's cycles) is computed at read time, never
stored — see "Derived at read time".

### `yard` — `Yard` (one row per tenant)

```sql
yard(
  tenant_id  uuid           NOT NULL REFERENCES tenants(id) PRIMARY KEY,
  name       text           NOT NULL,
  lat        numeric(9,6)   NOT NULL,
  lng        numeric(9,6)   NOT NULL
)
```

The operating yard, used as the geofence centre for telemetry breaches. One row
per tenant because there is one home yard; a second site is a `locations` row
with its own address, not a second yard.


## The catalog

### `items` — `Item`

One table, every kind of thing the tenant owns: equipment, bulk resources,
consumables, parts, people, kits and attachments differ by `type`, not by table.
That is deliberate. They share an id, a name, a category, a status, a place on
the shelf and a set of audit columns, and the Operations pages list them across
types (a reorder list reads bulk, consumable and part rows in one pass); seven
tables would mean a `UNION ALL` behind every one of those reads, and a new type
would mean a migration instead of a row.

```sql
items(
  id               text          PRIMARY KEY,
  type             catalog_type  NOT NULL,
  name             text          NOT NULL,
  category         text          NOT NULL,
  status           text          NOT NULL,
  qty              numeric(14,3) NOT NULL, -- derived for counted stock: the sum of stock_levels
  rate_daily       numeric(14,2) NOT NULL,
  notes            text          NULL,
  serial           text          NULL,
  make             text          NULL,
  model            text          NULL,
  meter_hours      numeric(12,1) NULL,
  fuel_type        text          NULL,
  purchase_value   numeric(14,2) NULL,
  base_weekly      numeric(14,2) NULL,
  base_monthly     numeric(14,2) NULL,
  lat              numeric(9,6)  NULL,
  lng              numeric(9,6)  NULL,
  battery          integer       NULL,
  last_reported    timestamptz   NULL,
  order_id         text          NULL REFERENCES orders(order_id),
  total_owned      numeric(14,3) NULL, -- derived (bulk): the sum of stock_levels
  qty_available    numeric(14,3) NULL, -- derived (bulk): the sum of stock_levels
  qty_out          numeric(14,3) NULL,
  qty_on_hand      numeric(14,3) NULL, -- derived: the sum of stock_levels
  reorder_point    numeric(14,3) NULL,
  cost_price       numeric(14,2) NULL,
  retail_price     numeric(14,2) NULL,
  role             text          NULL,
  certs            text[]        NULL,
  hourly_cost      numeric(14,2) NULL,
  hourly_billable  numeric(14,2) NULL,
  location_id      text          NULL REFERENCES locations(id), -- derived for counted stock: the busiest place
  active           boolean       NULL
)
```

**Keys/rules.**

- `id` is unique per tenant and is prefixed by type (`IT-` serialized, `BLK-`
  bulk, `CN-` consumable, `PRT-` part, `EMP-` labor, `KIT-` kit, `ACC-`
  attachment). The prefix is an aid, not a constraint: a `CHECK` on it would
  freeze a list the vertical registry is allowed to grow.
- `qty` is **the count of the thing**, and its meaning is per type: `1` for a
  serialized unit or an employee, the owned count for a kit or an attachment, and
  for counted stock **the sum of `stock_levels`** (derived — see below). Nothing
  writes it by hand for a counted row; `DataService.updateItem()` strips it from
  a patch, and the API must ignore or reject it too.
- `location_id` is where the row *is*: the whole placement for a unit, kit or
  attachment; and for counted stock the **home** place (the level holding the
  most), written by the same call that sums the levels. Null means labour (no
  place) or not yet placed — never a made-up default.
- `active` and `notes` are optional in the model (fixtures and older rows omit
  them), so the columns are nullable here; the API can tighten either to
  `NOT NULL` with a default once the data is migrated. Everywhere the model marks
  a field optional, the column below is nullable for that reason — check9 compares
  the two and fails if they disagree in either direction.
- `order_id` is custody for a serialized unit: the order it is currently out on,
  kept in step with the ledger (`isOut()` reads the latest movement; the
  issue/return pair re-homes it). Work orders and dispatches point the other way.

**Columns by type.** The optional groups are the prototype's per-type extras; a
feature reads only the ones it needs.

| type | rows | columns it uses |
|---|---|---|
| `serialized` | one machine, one row | `serial`, `make`, `model`, `meter_hours`, `fuel_type`, `purchase_value`, `base_weekly`, `base_monthly`, `lat`, `lng`, `battery`, `last_reported`, `order_id` |
| `bulk` | a resource held in quantity | `total_owned`, `qty_available`, `qty_out`, `location_id` |
| `consumable` | stock that is used up | `qty_on_hand`, `reorder_point`, `cost_price`, `retail_price`, `location_id` |
| `part` | stock / spare parts | `qty_on_hand`, `reorder_point`, `cost_price`, `retail_price`, `location_id` |
| `labor` | a person | `role`, `certs`, `hourly_cost`, `hourly_billable` |
| `kit` | an owned set, in one place | `qty`, `cost_price`, `retail_price`, `location_id` |
| `attachment` | an owned attachment, in one place | `qty`, `cost_price`, `retail_price`, `location_id` |

**Statuses offered per type** (`ITEM_STATUSES`; check9 compares this table with
the model):

| type | statuses offered |
|---|---|
| `serialized` | Available, On Rent, In Shop, Staged |
| `bulk` | Available, Committed |
| `consumable` | In Stock, Low |
| `part` | In Stock, Low |
| `labor` | Active, Inactive |
| `kit` | Available, On Rent, In Shop |
| `attachment` | Available, On Rent |

`status` is a `text` column rather than one enum, because the ten `ItemStatus`
values are shared across types and *which set a type may take* is a registry
concern (`ITEM_STATUSES`), not a column type. Two values are derived rather than
chosen: a stock row is `Low` while `needsReorder()` holds (`qty_on_hand <=
reorder_point`, both non-zero) and `In Stock` otherwise, written by
`refreshStockStatus()` whenever a count or a receipt changes the shelf.


### `stock_levels` — `StockLevel` (`item_id` for `refId`)

```sql
stock_levels(
  item_id      text          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id  text          NOT NULL REFERENCES locations(id),
  type         catalog_type  NOT NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (item_id, location_id)
)
```

**This is the truth for counted stock** (`bulk`, `consumable`, `part`) — one row
per (item, place) pair, holding the quantity there. `items.qty_on_hand` (and a
bulk row's `qty_available` / `total_owned`) is this table's **sum**; the row's
`location_id` is the place holding the most. Both are recomputed by the write
that moves a level (`syncStockTotals()`), so a shelf and a total cannot drift.

Two rules make it the truth rather than a second copy:

1. **A row exists only while it holds something** (`CHECK (qty > 0)`). An emptied
   place loses its row, so "where is this stock?" is `SELECT … WHERE item_id = …`
   with no zero rows to filter — and that is why the pair can be the primary key.
2. **Nothing writes the totals directly.** A move takes *n* out of one place and
   puts it in another; a count sets one place's number and logs the difference; a
   receipt adds a level (delivering into a new bin *adds a place* — which is how
   one part ends up in two bins). `updateItem()` strips `qty`, `qty_on_hand`,
   `qty_available`, `total_owned` and `location_id` from a patch for exactly this
   reason, and check9 asserts that this document marks the same five columns
   derived.

Only counted stock lives here. A serialized unit, a kit or an attachment is a
*thing* in one place, so `items.location_id` is its placement and it needs no
rows; labour has no place at all.

**Indexes.** `(location_id)` — "what is in this bin / this aisle's subtree?"
walks places, not items.

### `movements` — `Movement`

```sql
movements(
  id           text           PRIMARY KEY,
  type         catalog_type   NOT NULL,
  ref_id       text           NOT NULL REFERENCES items(id),
  order_id     text           NULL REFERENCES orders(order_id),
  party        text           NULL,
  location_id  text           NULL REFERENCES locations(id),
  kind         movement_kind  NOT NULL,
  qty          numeric(14,3)  NOT NULL,
  receipt_id   text           NULL REFERENCES receipts(id),
  at           timestamptz    NOT NULL,
  by_user_id   text           NOT NULL REFERENCES users(id),
  note         text           NULL
)
```

**Keys/rules.** The ledger, and **append-only**: a written movement is never
edited or deleted, so a correction is a new `adjust` row. That is why every
display name on it is an FK, not a string — a rename cannot rewrite history, and
"what left Yard A this month?" is an equality test rather than a substring
search.

- `kind` is `issue` (out to an order), `return` (back to a place), `receive` (in,
  from a receipt), `transfer` (place to place) or `adjust` (a count correction).
- `qty` is positive except on `adjust`, where it is the **signed** delta
  (`+`/`- n`); a zero delta writes nothing at all.
- `location_id` is where the movement happened. A `transfer` is logged at its
  **destination** (the movement says where the stock is *now*, agreeing with the
  shelf); the origin is readable in `note`, because the place it left may later be
  removed while the movement stays.
- `order_id` (rentals side) and `receipt_id` (buying side) are the two documents
  a movement can explain itself with: "which order?" and "where did this stock
  come from?" are joins, not notes.
- `at` and `by_user_id` are the row's own facts — the ledger's clock and author,
  not the audit columns' — and the audit columns are stamped from them for a
  movement (`attributeSeed()`), so a movement's `created_by` is always the person
  who moved it.


## Counterparties

### `parties` — `Party`

```sql
parties(
  id               text         PRIMARY KEY,
  name             text         NOT NULL,
  contact          text         NOT NULL,
  phone            text         NOT NULL,
  email            text         NOT NULL,
  billing_address  text         NOT NULL,
  billing_cycle    text         NOT NULL,
  notes            text         NOT NULL,
  kinds            party_kind[] NULL,
  active           boolean      NULL
)
```

**Keys/rules.** Customers and suppliers are **the same kind of row** — a business
the tenant deals with, one address, one contact — so they share this table and
differ by role: orders pick `customer` partners, purchase orders pick `supplier`
partners, and a dealer that both buys and rents is one row with two kinds rather
than two rows that drift apart. `kinds` null/empty means "customer", which is
what every row written before suppliers existed means — so a reader that needs a
supplier tests `kinds` for membership and a reader that counts customers counts
the nulls too. A schema that prefers a join table uses
(`party_id`, `kind`) with a row per kind instead of the array.

Removal is refused while an order, a purchase order, a receipt, a sub-rental or a
**rate card** points at the party — the API's `ON DELETE RESTRICT`, enforced in
the store by `partyRemovalBlockers()` (one list the guard and the grids' disabled
buttons share), because those rows carry the FK that is now the only name the
screens have. Leaving the trade is `active = false`.

### `price_cards` — `PriceCard`

```sql
price_cards(
  id              text         PRIMARY KEY,
  party_id        text         NOT NULL REFERENCES parties(id),
  name            text         NOT NULL,
  active          boolean      NOT NULL,
  effective_from  date         NULL,
  effective_to    date         NULL,
  note            text         NULL
)
```

**Keys/rules.** A counterparty's negotiated price list. Rates otherwise live on
`items.rate_daily` and in `pricing` (the rules engine); a *customer's* agreed
numbers are neither, so they hang off the counterparty they were agreed with —
one table, because A5 made a customer and a supplier the same row and a partner
can be both.

The card is **read, never copied**. An order's amount is derived at read time
(`lineTotal()` → `cardRateFor()`), so the card line is the only place its price is
written down and a repriced card moves every order it covers at once — the A10
argument (`orders.party` was a stored copy of a name) applied to money instead of
a name. Nothing holds a `price_card_id`: a card is not referenced by any row, so
removing one cannot dangle an FK, it only re-prices the orders it priced (visible
on those screens). That is also why the two directions are not symmetrical: an
order line has no price column, so its price is derived; a purchase order line
stores the `unit_cost` it was raised at, so a supplier's card is the editor's
*default* and the raised document keeps stating its own price.

`effective_from` / `effective_to` are the window (inclusive, either bound may be
null = open). An order prices at the card in force on the day its booking starts,
which is what makes a renewal a *new* card rather than an edit of the old one:
last year's contracts keep last year's prices. When two windows overlap, the later
`effective_from` wins. A card past its window is kept and readable — it is the
history of what was agreed — so the way to retire one is `active = false` (or let
it expire by date), never a delete that erases the record.

### `price_card_lines` — `PriceCardLine` (`card_id` is the parent key, `item_id` for `refId`)

```sql
price_card_lines(
  card_id      text          NOT NULL REFERENCES price_cards(id),
  type         catalog_type  NOT NULL,
  item_id      text          NOT NULL REFERENCES items(id),
  rate_daily   numeric(14,2) NULL,
  base_weekly  numeric(14,2) NULL,
  base_monthly numeric(14,2) NULL,
  unit_price   numeric(14,2) NULL,
  unit_cost    numeric(14,2) NULL,
  PRIMARY KEY (card_id, item_id)
)
```

One negotiated rate per catalog row. The columns are named after the item fields
they replace, so a reader can say "the card's `rate_daily`, else the item's"
without a translation: a rented type reads `rate_daily` / `base_weekly` /
`base_monthly`, a line that bills once reads `unit_price` (labor hourly bill, a
consumable's retail, a part's cost — the figures `lineTotal()` has always billed),
and the buying side reads `unit_cost`, the price we pay. A null column means the
card says nothing about it and the catalog's value stands, so a card can set one
rate without restating the rest. A line whose item is removed goes with it
(`ON DELETE CASCADE`) — a negotiated price for something no longer owned is not
history, it is noise.

## Orders (the selling side)

### `orders` — `Order`

```sql
orders(
  order_id         text         PRIMARY KEY,
  party_id         text         NOT NULL REFERENCES parties(id),
  project_name     text         NOT NULL,
  job_site         text         NOT NULL,
  start_date       date         NOT NULL,
  end_date         date         NOT NULL,
  status           order_status NOT NULL,
  t0               integer      NULL,
  t1               integer      NULL,
  geofence_radius  numeric(9,1) NULL,
  site_lat         numeric(9,6) NULL,
  site_lng         numeric(9,6) NULL
)
```

**Keys/rules.** The key is `order_id` (`CT-2024-001`), not `id`: the contract
number *is* the row's identity and is printed on paperwork, so it is the primary
key here and the FK's target everywhere else. `status` is the lifecycle a person
chooses (`draft` → `active` → `closed`) — whether the equipment has actually
gone out is a different, derived fact (`isOut()` reads the ledger).

`party_id` is the counterparty and the **only** place the customer is named: the
row stores the FK, and the screens read the name through it (`partyName()`), so a
partner renamed on the Parties grid renames every contract at once. There is no
`party` column — a stored copy is the one duplication this table used to carry, and
the API derives it with a `JOIN parties`; if a cached column is ever wanted for
list performance it needs a trigger or a view, not a hand-written string. That is
what makes the FK's guard load-bearing: a party named by an order cannot be
deleted (`partyRemovalBlockers()`, the API's `ON DELETE RESTRICT`), because with
no copy to fall back on the removal would print a raw id where a customer belongs.

`t0` / `t1` are minutes of the day (the Day view's window, defaulting 08:00–17:00
when null) and the per-line columns below override them. `site_lat` / `site_lng` /
`geofence_radius` describe the job site for telemetry breaches.

### `order_lines` — `OrderLine` (`order_id` is the parent key)

```sql
order_lines(
  id              text           PRIMARY KEY,
  order_id        text           NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  type            catalog_type   NOT NULL,
  ref_id          text           NOT NULL REFERENCES items(id),
  qty             numeric(14,3)  NOT NULL CHECK (qty > 0),
  start_date      date           NULL,
  end_date        date           NULL,
  t0              integer        NULL,
  t1              integer        NULL,
  weekend_policy  weekend_policy NULL,
  risk_premium    risk_premium   NULL
)
```

**Keys/rules.** One row per thing rented: `ref_id` is the catalog row (a machine,
a bulk resource, a person), never a free-text description — an order line that
names something the catalog does not have is not a line. The window columns
override the order's for that line only. `weekend_policy` and `risk_premium`
override the pricing defaults for that line, which is why they are nullable: null
means "take the tenant's default", not "none".


## Purchasing (the buying side of the spine)

Two rules shape every table below, and both are load-bearing:

1. **A purchase order stores no copy of what arrived.** How much of a line has
   been received is summed from `receipt_lines` at read time
   (`poLineReceived()`, `poLineOutstanding()`, `poProgress()`), so an order can
   never claim stock the ledger does not have.
2. **A receipt is posted, never edited.** It moved quantities and wrote shelves,
   so it is append-only like a movement: a wrong receipt is corrected by a new
   adjustment, not by rewriting history.

### `purchase_orders` — `PurchaseOrder`

```sql
purchase_orders(
  id           text                  PRIMARY KEY,
  supplier_id  text                  NOT NULL REFERENCES parties(id),
  status       purchase_order_status NOT NULL,
  ordered_at   date                  NOT NULL,
  expected_at  date                  NOT NULL,
  reference    text                  NULL,
  notes        text                  NULL
)
```

**Keys/rules.** `supplier_id` is a partner carrying the `supplier` kind — the
same table as a customer, so "what have we bought from them?" is a join. `status`
is the document's own lifecycle, chosen by a person: `draft` (being written),
`ordered` (sent), `cancelled`. How far it has progressed is *not* a status —
`poProgress()` derives `none` / `partial` / `received` from the receipts, which is
what stops a stale stored flag from lying. A PO in a draft or cancelled state
cannot be received into; a cancelled PO cannot be forced back while anything has
arrived; a delivered line cannot be deleted or reduced below what came in; and a
PO with a receipt against it cannot be removed (its `id` is the receipt's FK).

### `purchase_order_lines` — `PurchaseOrderLine` (`po_id` is the parent key)

```sql
purchase_order_lines(
  id           text          PRIMARY KEY,
  po_id        text          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  type         catalog_type  NOT NULL,
  ref_id       text          NULL REFERENCES items(id),
  description  text          NOT NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost    numeric(14,2) NOT NULL,
  rate_daily   numeric(14,2) NULL
)
```

**Keys/rules.** `ref_id` is the catalog row a line *restocks* (a part, a
consumable, a bulk resource, a kit, an attachment); it is null for a serialized
line, which describes machines that do not exist yet — receiving such a line
**creates one `items` row per unit** at `unit_cost`, billable at `rate_daily`.
That is why `description` is required even when `ref_id` is set: it is what goes
on the paperwork, and it is the new unit's name for a serialized line.

### `receipts` — `Receipt`

```sql
receipts(
  id           text        PRIMARY KEY,
  po_id        text        NOT NULL REFERENCES purchase_orders(id),
  supplier_id  text        NOT NULL REFERENCES parties(id),
  location_id  text        NOT NULL REFERENCES locations(id),
  at           timestamptz NOT NULL,
  note         text        NULL
)
```

**Keys/rules.** The document that makes stock exist. `supplier_id` is copied from
the order as the receipt's own fact (paperwork is what it is, even if a PO is
later corrected), and `location_id` is where the stock was put away — every
landed line is placed there, and one movement per landed row records it. Nothing
in the app edits or deletes a receipt.

### `receipt_lines` — `ReceiptLine` (`receipt_id` is the parent key)

```sql
receipt_lines(
  id          text          PRIMARY KEY,
  receipt_id  text          NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  po_line_id  text          NOT NULL REFERENCES purchase_order_lines(id),
  type        catalog_type  NOT NULL,
  ref_id      text          NOT NULL REFERENCES items(id),
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost   numeric(14,2) NOT NULL
)
```

**Keys/rules.** `ref_id` is always a real row — the restocked SKU *or* the unit
this line created — so a receipt reads back into `itemsAtLocation()` and the
buying side joins the item ↔ location spine without a special case. A line may be
received in instalments: two receipts against the same `po_line_id` are summed,
and the second cannot exceed the outstanding quantity (`poLineOutstanding()`).
`unit_cost` is the cost at the moment of receipt: a counted row's `cost_price`
becomes a moving average of what is held at the new price
(`movingCost(onHand, cost, qty, unit_cost)`), so a purchase never rewrites the
cost of stock already on the shelf.

**Indexes.** `receipt_lines (po_line_id)` — the arrival sum; `receipts (po_id)` —
the removal guard.


## Module tables

These belong to the optional industry modules (`Tenant.disabledModules` gates the
screens, not the tables — a licence changing does not delete history).

### `inspections` — `Inspection`

```sql
inspections(
  id         text                  PRIMARY KEY,
  item_id    text                  NOT NULL REFERENCES items(id),
  order_id   text                  NULL REFERENCES orders(order_id),
  direction  inspection_direction  NOT NULL,
  date       date                  NOT NULL,
  meter_out  numeric(12,1)         NULL,
  meter_in   numeric(12,1)         NULL,
  fuel_out   numeric(14,3)         NULL,
  fuel_in    numeric(14,3)         NULL,
  checks     jsonb                 NOT NULL,
  photos     integer               NULL,
  status     text                  NOT NULL,
  notes      text                  NULL
)
```

A yard in/out condition check on a serialized unit. `checks` is the five named
booleans (`InspectionCheckKey`) as a small fixed map — `jsonb` because it is read
whole by one form; a stricter schema widens it to
(`inspection_id`, `check_key`, `passed`). `status` is `Open` / `Closed` (an
inline union in the model, not a named enum). One open inspection per unit would
be a natural partial unique index; the app does not enforce it today.

### `work_orders` — `WorkOrder`

```sql
work_orders(
  id             text              PRIMARY KEY,
  item_id        text              NOT NULL REFERENCES items(id),
  type           text              NOT NULL,
  meter_reading  numeric(12,1)     NOT NULL,
  status         work_order_status NOT NULL,
  labor_hours    numeric(6,2)      NOT NULL,
  date           date              NOT NULL,
  notes          text              NULL
)
```

Service and maintenance on a unit. `type` is `Preventive` / `Repair` /
`Inspection` (`SERVICE_TYPES`, a value list rather than a column type). The cost
roll-up (`parts_cost`, `labor_cost`, `total`, `labor_rate` — `WorkOrderCost`) is
**not stored**: it is computed from the parts below and the shop labour rate at
read time.

### `work_order_parts` — `WorkOrderPart` (`work_order_id` is the parent key, `id` as the key)

```sql
work_order_parts(
  id             text          PRIMARY KEY,
  work_order_id  text          NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  kind           text          NOT NULL,
  ref_id         text          NOT NULL REFERENCES items(id),
  qty            numeric(14,3) NOT NULL CHECK (qty > 0)
)
```

What the job consumed: `kind` is `part` or `consumable` (which tells a reader
which status/stock shape `ref_id` has) and `ref_id` is the catalog row. Consuming
these through the ledger (issuing them off the shelf) is *not* wired up yet — the
row records the consumption, the movement that would decrement
`stock_levels` does not exist, which is a gap and not a design.

### `timesheets` — `Timesheet`

```sql
timesheets(
  id           text              PRIMARY KEY,
  emp_id       text              NOT NULL REFERENCES items(id),
  date         date              NOT NULL,
  clock_in     time              NOT NULL,
  clock_out    time              NULL,
  target_type  timesheet_target  NOT NULL,
  target_id    text              NULL,
  hours        numeric(6,2)      NULL,
  note         text              NULL
)
```

**Keys/rules.** A labo(u)r clock segment; `emp_id` points at a `labor` item, so
the person is a catalog row and their cost is `hourly_cost`. `clock_out` and
`hours` are null **while the segment is running** — an employee who is clocked in
has no end, which is why neither can be `NOT NULL`. `target_type` is what the
time is against (`order`, `workorder`, `shop`, `overhead`, `idle`, `lunch`) and
`target_id` is null unless the target is an order or a work order. At most one
open segment per employee (an app rule; the API should make it a partial unique
index: `UNIQUE (emp_id) WHERE clock_out IS NULL`).

### `rental_subs` — `RentalSub`

```sql
rental_subs(
  id           text          PRIMARY KEY,
  item_id      text          NULL REFERENCES items(id),
  asset_name   text          NOT NULL,
  order_id     text          NULL REFERENCES orders(order_id),
  supplier_id  text          NOT NULL REFERENCES parties(id),
  vendor_cost  numeric(14,2) NOT NULL,
  retail_rate  numeric(14,2) NOT NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  note         text          NULL
)
```

**Keys/rules.** A thing rented *in* from a third party and billed out to a
customer: `supplier_id` is the FK (a partner carrying the `supplier` kind), which
replaced the prototype's free-text vendor name for the same reason `bin` was
deleted — "what else have we rented from them?" is a join, not a string.
`item_id` is optional because a sub-rental may not map to a catalog row;
`asset_name` is then the only name it has. The spread (`retail_rate -
vendor_cost`) is derived.

### `vehicles` — `Vehicle`

```sql
vehicles(
  id      text  PRIMARY KEY,
  name    text  NOT NULL,
  plate   text  NOT NULL,
  status  text  NOT NULL
)
```

Trucks and trailers on the dispatch board. `status` is an inline union
(`Available`, `En Route`, `In Use`, `Out of Service`) — `DISPATCH_STATUSES`'
sibling, and the same five-row value list a CHECK constraint would use.

### `dispatches` — `Dispatch`

```sql
dispatches(
  id          text            PRIMARY KEY,
  order_id    text            NOT NULL REFERENCES orders(order_id),
  asset_id    text            NULL REFERENCES items(id),
  route_seq   integer         NOT NULL,
  driver_id   text            NULL REFERENCES items(id),
  vehicle_id  text            NULL REFERENCES vehicles(id),
  status      dispatch_status NOT NULL
)
```

One stop on a route: an order, the asset moved, a driver (a `labor` item), a
vehicle, and its place in the run (`route_seq`, assigned by the store).
`asset_id`, `driver_id` and `vehicle_id` are nullable because a row is often
staged before those are chosen — the board fills them in as the day firms up.


### `invoices` — `Invoice`

```sql
invoices(
  id             text           PRIMARY KEY,
  order_id       text           NOT NULL REFERENCES orders(order_id),
  cycle          integer        NOT NULL,
  cycle_start    date           NOT NULL,
  cycle_end      date           NOT NULL,
  env_fee_pct    numeric(14,6)  NOT NULL,
  damage_waiver  boolean        NOT NULL,
  fuel_charge    numeric(14,2)  NOT NULL,
  tax_rate       numeric(14,6)  NOT NULL,
  status         invoice_status NOT NULL
)
```

**Keys/rules.** One billing period of one order (`cycle` counts from 1).
`env_fee_pct`, `damage_waiver` and `tax_rate` are **snapshots taken when the
document was written**, deliberately copied from the pricing settings: an invoice
must keep stating the rate it was raised at even after a setting changes. Its
totals (`InvoiceTotals`: base, env fee, waiver, fuel, tax, total) are derived at
read time from the order's lines, the period and those rates — never stored, so
an invoice cannot disagree with what it bills.

## Derived at read time (never a column)

The spine's rule is "derive, don't duplicate", and every screen obeys it. An API
that *stores* any of these is wrong even if it computes them correctly, because
two copies drift. Each has a single reader in the store:

| derived value | from | reader |
|---|---|---|
| `items.qty_on_hand`, `qty_available`, `total_owned`, `qty`, and a counted row's `location_id` | `stock_levels` (the sum, and the busiest place) | `syncStockTotals()`; `stockTotal()`, `stockAt()`, `placements()` |
| a PO line's received quantity and outstanding balance | `receipt_lines` summed by `po_line_id` | `poLineReceived()`, `poLineOutstanding()`, `receivableLines()` |
| a PO's progress (`none`/`partial`/`received`) and display status | the receipts against it, and its own lifecycle status | `poProgress()`, `poStatusLabel()` |
| whether a unit is out, where to, since when | the latest `movements` row for that unit | `isOut()`, `outInfo()`, `custodyItems()` |
| what a place holds, direct or subtree | `stock_levels` for counted rows, `items.location_id` for units | `itemsAtLocation()`, `locationStockQty()`, `locationItemCount()` |
| a location's label and its path | the `locations` tree walked up `parent_id` | `locationLabel()`, `locationPath()` |
| a stock row's `Low` / `In Stock` status | `qty_on_hand` vs `reorder_point` | `needsReorder()`, `refreshStockStatus()` |
| what an item can commit at once | `total_owned` (bulk), `qty_on_hand` (stock), `qty` (kit/attachment), else 1 | `capacity()` |
| an order's days, line totals, gross, margin | the order window, the line windows, `pricing`, the customer's price card, `items.rate_daily` | `orderDays()`, `billableDays()`, `lineTotal()`, `orderAmount()`, `activeOrderTotals()` |
| the rate a booking bills at | the card in force on the day the booking starts, else the catalog | `cardRateFor()`, `rateBasis()` |
| an invoice's cycles and totals | the order, the cycle window, the module rates | `lineAmountForPeriod()`, `invoiceTotals()` |
| a work order's cost | `work_order_parts` and the shop labour rate | `workOrderCost()` |
| a timesheet segment's hours, bill, cost | `clock_in`/`clock_out` and the employee's rates | `segmentHours()`, `segmentBill()`, `segmentCost()` |
| the reorder list, page row counts, KPIs | the rows themselves | `reorders()`, `PageSearchService`, `fleetKpis()` |

Two of these escape into a column anyway, and they are named above rather than
hidden: `items.qty*` (written only by `syncStockTotals()`, so a grid can sort
without a join) and `items.status`
for a stock row — *partly* derived, because a person chooses between `In Stock`
and `Low` and a count can move it. A third used to: `orders.party` was a stored
copy of the counterparty's name, and it is gone — the column the API would have had
to sync is now a join (`parties.name` through `orders.party_id`), which is why the
party's removal guard matters.


## What the API must enforce

The store refuses these today and a screen shows the refusal. They belong in the
database or the service layer — a constraint, not a convention, because the front
end will not be the only writer.

| rule | the store's behaviour | the API |
|---|---|---|
| a level never holds nothing | an emptied place loses its row | `CHECK (qty > 0)` |
| a count is never negative | `adjustStock()` returns null | validate input, then the level check |
| a move needs a source holding that much | `held <= 0 \|\| n > held` → null | conditional `UPDATE … WHERE qty >= n` in one transaction |
| a move is never to the same place | `from === to` → null | service validation |
| a unit moves whole | a partial move of a unit → null | service validation (a unit is one row) |
| counted stock is not patched directly | `updateItem()` strips the five derived keys | ignore or `409` on those columns |
| a draft or cancelled PO cannot be received | `receiveAgainst()` returns null | service validation |
| a receipt never over-receives a line | `qty > outstanding` → null | sum receipts inside the transaction |
| a delivered PO line cannot shrink or vanish | the store re-adds or raises it | service validation |
| a cancelled PO with arrivals stays cancelled | the status change is ignored | service validation |
| a PO with a receipt cannot be deleted | `purchaseOrderRemovalBlockers()` | `ON DELETE RESTRICT` |
| a receipt is immutable | nothing edits or deletes it | no `UPDATE`/`DELETE` grant |
| a location with stock or history cannot be deleted | `locationRemovalBlockers()` | `ON DELETE RESTRICT` on both FKs |
| a location type in use cannot be deleted | `removeLocationType()` returns false | `ON DELETE RESTRICT` |
| a party with rows naming it cannot be deleted | `partyRemovalBlockers()` (orders, POs, receipts, sub-rentals, rate cards) | `ON DELETE RESTRICT` |
| an item's negotiated prices go with it | a card line for a removed item never matches | `ON DELETE CASCADE` on `price_card_lines` |
| a category in use cannot be deleted | `removeCategory()` refuses | `ON DELETE RESTRICT` |
| a deleted item takes its shelves with it | `removeItem()` drops its levels | `ON DELETE CASCADE` on `stock_levels` |
| a movement is appended, never rewritten | no edit path exists | no `UPDATE`/`DELETE` grant |
| a location hierarchy has no cycles | `isLocationAncestor()` guard | trigger or recursive check |

The store's own schema bump is the last rule worth copying: the persisted
snapshot carries `_v`, and a version the client does not know is discarded and
reseeded rather than half-read (`DataService.VERSION`, currently `11`). A server
does that job with migrations, and the client's banner — "your saved data was
replaced" — is the honest version of a silent upgrade.


## Enums and value lists

Postgres enum types, each one matching a named union in `models.ts` (the
`-- Name` comment is what check9 matches, and it compares the members **exactly**
— a value added in TypeScript without a line here fails the harness).

```sql
-- `CatalogType`
catalog_type AS ENUM ('serialized', 'bulk', 'consumable', 'part', 'labor', 'kit', 'attachment')
-- `PartyKind`
party_kind AS ENUM ('customer', 'supplier')
-- `ItemStatus`
item_status AS ENUM ('Available', 'On Rent', 'In Use', 'In Shop', 'Staged', 'Active', 'Inactive', 'In Stock', 'Low', 'Committed')
-- `OrderStatus`
order_status AS ENUM ('draft', 'active', 'closed')
-- `MovementKind`
movement_kind AS ENUM ('issue', 'return', 'receive', 'transfer', 'adjust')
-- `PurchaseOrderStatus`
purchase_order_status AS ENUM ('draft', 'ordered', 'cancelled')
-- `PurchaseProgress`
purchase_progress AS ENUM ('none', 'partial', 'received')
-- `RiskPremiumKey`
risk_premium AS ENUM ('standard', 'coastal', 'hazmat')
-- `InspectionDirection`
inspection_direction AS ENUM ('Check-Out', 'Check-In')
-- `InspectionCheckKey`
inspection_check_key AS ENUM ('tires', 'fluids', 'guards', 'lights', 'engine')
-- `ModuleKey`
module_key AS ENUM ('scheduling', 'dispatch', 'telemetry', 'labor', 'service', 'rentals', 'billing')
-- `RoleKey`
role_key AS ENUM ('owner', 'admin', 'manager', 'warehouse', 'field', 'viewer')
-- `TenantPlan`
tenant_plan AS ENUM ('starter', 'professional', 'enterprise')
-- `VerticalKey`
vertical_key AS ENUM ('HeavyEquipment', 'Rental', 'Healthcare', 'Lumberyard', 'Warehouse')
-- `WorkOrderStatus`
work_order_status AS ENUM ('In Progress', 'Completed', 'Pending', 'Scheduled')
-- `TimesheetTarget`
timesheet_target AS ENUM ('order', 'workorder', 'shop', 'overhead', 'idle', 'lunch')
-- `DispatchStatus`
dispatch_status AS ENUM ('Staged', 'En Route', 'Delivered', 'Pending Return')
-- `InvoiceStatus`
invoice_status AS ENUM ('pending', 'invoiced', 'paid')
```

Three types below have **no named union** in the model — the values are written
inline where the field is declared — so a schema that types them picks the names:

```sql
-- inline union on PricingSettings.weekendPolicyDefault / OrderLine.weekendPolicy
weekend_policy AS ENUM ('bill', 'skip', 'overtime')
-- inline union on Overhead.category
overhead_category AS ENUM ('Facility', 'Freight/Logistics', 'Compliance')
-- inline union on Overhead.chargeType
overhead_charge AS ENUM ('Flat Fee', 'Percent of Equipment Total', 'Per Mile', 'Per Day')
```

**Value lists kept as `text` plus a list, not a type** (the set is a screen's, and
changes with the module or the vertical): `items.status` (per-type sets,
`ITEM_STATUSES`), `work_orders.type` (`SERVICE_TYPES`), `vehicles.status` (`Available` / `En Route`
/ `In Use` / `Out of Service`) and `inspections.status` (`Open`/`Closed`), and
`work_order_parts.kind` (`part`/`consumable`). Where a column is one of these it
is `text` **on purpose** — the list is a screen's, and each column's reader is
named beside it.

**App-side vocabularies (not tables, not columns):** `CatalogTypeDef`
(`CATALOG_TYPES` — the catalog's own tab labels), `IndustryModuleDef`
(`INDUSTRY_MODULES` — module labels and blurbs), `RoleDef` (`ROLES` — a
permission bundle per role), and `Permission` (`ALL_PERMISSIONS` — the capability
strings a screen gates on, which are code, never data: a tenant does not get to
invent `stock.teleport`). The vertical registry
(`core/vertical-metadata.ts`) is the same kind of thing: labels, tab order and
grid columns per `vertical_key`, shipped in code because they describe the *app*,
not the tenant's data.


## Table ↔ model ↔ resource map

One row per table, with the model it comes from, the key it has in the store
(what `auditedRows()` calls it — configuration lives under `settings.*` in the
snapshot, and a settings row is keyed by its **natural** key rather than an id) and
a resource path an API can expose. check9 reads this table both ways: every table
the store audits must appear here, and every table here that names a store key must
be one the store audits.

| table | model | store key | resource |
|---|---|---|---|
| `tenants` | `Tenant` | `tenants` | `/api/tenants` |
| `tenant_modules` | `Tenant.disabledModules` | — | `/api/tenant/modules` |
| `users` | `User` | `users` | `/api/users` |
| `locations` | `Location` | `locations` | `/api/locations` |
| `location_types` | `LocationType` | `locationTypes` | `/api/settings/location-types` |
| `categories` | `CategoryOption` | `categories:<type>` | `/api/settings/categories` |
| `tax_schedules` | `TaxSchedule` | `taxSchedules` | `/api/settings/tax-schedules` |
| `overheads` | `Overhead` | `overheads` | `/api/settings/overheads` |
| `pricing` | `PricingSettings` | `pricing` | `/api/settings/pricing` |
| `yard` | `Yard` | `yard` | `/api/settings/yard` |
| `items` | `Item` | `items` | `/api/items` |
| `stock_levels` | `StockLevel` | `stockLevels` | `/api/stock-levels` |
| `movements` | `Movement` | `movements` | `/api/movements` (append-only) |
| `parties` | `Party` | `parties` | `/api/parties` |
| `price_cards` | `PriceCard` | `priceCards` | `/api/price-cards` |
| `price_card_lines` | `PriceCardLine` | `priceCards[].lines` | `/api/price-cards/:id/lines` |
| `orders` | `Order` | `orders` | `/api/orders` |
| `order_lines` | `OrderLine` | `orders[].lineItems` | `/api/orders/:id/lines` |
| `purchase_orders` | `PurchaseOrder` | `purchaseOrders` | `/api/purchase-orders` |
| `purchase_order_lines` | `PurchaseOrderLine` | `purchaseOrders[].lines` | `/api/purchase-orders/:id/lines` |
| `receipts` | `Receipt` | `receipts` | `/api/receipts` (append-only) |
| `receipt_lines` | `ReceiptLine` | `receipts[].lines` | `/api/receipts/:id/lines` |
| `inspections` | `Inspection` | `inspections` | `/api/inspections` |
| `work_orders` | `WorkOrder` | `workOrders` | `/api/work-orders` |
| `work_order_parts` | `WorkOrderPart` | `workOrders[].parts` | `/api/work-orders/:id/parts` |
| `timesheets` | `Timesheet` | `timesheets` | `/api/timesheets` |
| `rental_subs` | `RentalSub` | `rentals` | `/api/sub-rentals` |
| `vehicles` | `Vehicle` | `vehicles` | `/api/vehicles` |
| `dispatches` | `Dispatch` | `dispatches` | `/api/dispatches` |
| `invoices` | `Invoice` | `invoices` | `/api/invoices` |
| `store` | `—` | — | the client's snapshot: `_v` + every table above |

`store` is the last row because it is the one table that should *not* survive to
the API: it is the localStorage snapshot (`_v` + the tables), the client's stand-in
for a database. On the server it becomes a schema version and a migration history.

A store key with a path in it (`orders[].lineItems`, `workOrders[].parts`) is a row
*inside* another table's row: it is attributed by its parent, whose `updated_by` is
the writer, and `tenant_id` reaches it through the parent's key. `—` is a table the
store does not keep as rows at all (the snapshot, and the tenant's licence flags).

**Declared exceptions**: `tenants`, `users` — the two mapped tables a write does
not stamp, and why:

- `tenants` — the workspace is its own boundary. `tenants.id` is the one id a
  `tenant_id` column cannot scope, and the row is created by the platform (a sign-up
  or the console), not by a workspace's person. `created_at` stands on its own.
- `users` — a person is created by a sign-up, not by another row's author; a
  `created_by` would be a stranger's id from another tenant or a self-reference on
  insert. `users.tenant_id` is stored, so the row is scoped even though it is not
  stamped.

Anything else a screen writes is in `auditedRows()`. That is what the reverse check
in `check9.mjs` holds: add a settings table and forget the writer, and the harness
fails rather than the hole being discovered later.

## Not in the model yet (deliberately)

Named here so nobody mistakes an absence for an oversight. Each has a reason, and
each is an increment waiting for its turn:

- **Reservations / availability holds.** "Committed" is a status on a bulk row,
  not a table; a booking that has not left the yard has no rows anywhere. The
  scheduler clamps a drop against `capacity()` and overlapping bookings, which is
  a *rule*, not a ledger — a real reservation table (`item_id`, `location_id`,
  window, qty, order) is the next thing this spine needs.
- **Levels for kits and attachments.** They hold one place and a `qty`; a kit
  assembled from parts would need `stock_levels` (or a bill of materials) to say
  what it is made of. A6 drew that line on purpose (see `docs/PLAN.md`, open
  decision #1).
- **A cycle-count / bulk-count session.** Counting happens one place at a time
  through a row's Count action; there is no document that groups a whole
  warehouse count into one reviewable batch.
- **Ledger-backed consumption.** `work_order_parts` records what a job used but
  writes no movement, so a work order does not decrement the shelf (see
  `work_orders` above).
- **Documents and attachments.** `inspections.photos` is a *count*, not a file;
  nothing in the model stores a binary, a URL or a signature.
- **A price on the order line, and on the contract.** A negotiated rate now has a
  home (`price_cards`, A11), but it is the *counterparty's* card: two bookings for
  the same customer at different prices, a one-off deal on a single contract or a
  flat line total still cannot be said, because `order_lines` has no price column.
  A card that a single order overrides is the next step, and it is a column on
  `order_lines` plus a rule for which one wins (the line, then the card, then the
  catalog) — the resolution order `cardRateFor()` already has room for.
- **Soft delete.** Rows are removed (`removeItem`, `removeLocation`), and the
  guard is contents/history rather than a deleted flag. A financial system
  usually wants `deleted_at` on the catalog side; this model does not have one.
- **Per-vertical category seeds, and per-vertical view gating or titles.** A7
  settled that the registry carries tabs, labels, columns and new-record
  defaults; it deliberately does not decide which categories a vertical seeds, or
  which pages a vertical hides.
- **Multi-tenant membership.** `users.tenant_id` is a single FK: a person belongs
  to one workspace. Contractors who work across two workspaces need a membership
  table, and the session is where that shows up first.

