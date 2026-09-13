# Phase C — the tenant owns the catalog (verticals, categories, fields)

**Why this file exists.** Phase A built the spine and Phase B (`docs/PLAN-B.md`)
made the *fields* data. This phase fixes what Phase B left: **"what an asset is and
what fields it has" is still decided in four places**, and only one of them is the
tenant's.

| where it is decided today | what it decides | owner |
|---|---|---|
| `CatalogType` (7, compiled) | the stock *behaviour* (one unit per row / counted levels / no place) | code |
| `core/vertical-metadata.ts` (5, compiled) | which **tabs** show, their labels, icons, columns, defaults | code (tenant picks one) |
| `settings.categories[type]` | a flat **name list per type** | tenant |
| `Item` columns + B2 `form_schemas` | the **fields** (fixed columns + a per-type schema) | code + tenant |

The owner's call (recorded here so it is not re-litigated):

> "A vertical owns its own tab list: each tab is a category the tenant names and
> orders, with the behaviour as a property of that category. Verticals are groups
> of categories, the user defines their order, and the labels come from the
> category. When defining a category they determine whether it is **serialized**
> (unique — only one of each exists) or **bulk/consumable** (multiple may exist)."

## The model

**Three tenant rows, one field engine.**

```sql
verticals(       id, name, slug, active, is_default )              -- tenant-authored
asset_categories(id, vertical_id, name, behaviour, active, sort, fields jsonb )
stock_schema(    tenant_id, fields jsonb )                          -- one row per tenant
```

- **`vertical` groups categories** and fixes their **order** (`category.sort`); a
  category's **name is its own** (it is the tab's label). A vertical owns its
  categories — a many-to-many membership table is a later refinement, noted below.
- **`category.behaviour`** is the one fact the spine keys off:
  `serialized` (one unique unit per row), `quantity` (a counted level — the
  "bulk/consumable" case), or `labor` (a person, no place — kept so the Labor tab
  and timesheets keep working; it is not stock). `CatalogType` becomes an internal
  *derivation* of behaviour, not something a user picks.
- **Fields resolve as `stock_schema.fields ∪ category.fields`** — the **stock set**
  (what every asset carries, tenant-editable) plus the category's own. This is the
  consolidation: **one field engine** (`FormField` / `FormsService` /
  `<ims-dynamic-form>` from B2), three scopes, instead of fields living in two
  unrelated places.
- **`Item.categoryId` is the join** the screens want; `Item.type` / `Item.category`
  (a stored name) retire once behaviour is derived. The load-bearing columns that
  the ledger and pricing read (the stock quantities, `location_id`, `status`, the
  prices) **stay columns** — the stock set is the *editable* common fields, by the
  same rule Phase B set ("a fact the business asks questions of is a column").

Two naming notes, so the doc and code agree: the table is **`asset_categories`**
(a `Category` is a catalog row, not a settings one) and **`vertical-metadata.ts`
survives only as seed defaults** — the same way `form_schemas` was seeded from it —
so a new workspace starts with the five industry catalogs and then owns them.

## Increments

| # | Increment | Depends on |
|---|---|---|
| C1 | The catalog is tenant data — `verticals` / `asset_categories` / `stock_schema`, seeded from the registry, with CRUD; nothing else changes yet | — |
| C2 | One field engine — `FormsService.fieldsFor(category)` = stock set ∪ category fields; the Assets editor renders them | C1 |
| C3 | The Assets page is category-driven — tabs from the tenant's vertical (ordered), labels from the category; `vertical-metadata` stops being read at runtime | C2 |
| C4 | Authoring — Admin → **Verticals & Categories**: CRUD verticals, categories (name / behaviour / order) and a **field editor** for a category and the stock set (the B3 authoring UI, finally) | C1 |
| C5 | `Item.type` retires — `categoryId` is the catalog identity; every stock path keys off `behaviourOf(item)`; `isLevelTracked` becomes behaviour-driven; the harnesses follow | C2, C3 |
| C6 | Cleanup — fold `form_schemas` scope `item` into categories (inspection / receipt-line / stock-level scopes keep standalone schemas); drop the dead compiled reads; docs | C5 |

Each ends green under the working agreement (build + `lint:ctor` + `lint:styles` +
`check:store`), updates `docs/DATA-MODEL.md` first, and adds/extend a harness
(`check20`+).

**Status.** **C1 done.** `Vertical`, `Category` and `StockSchema` are in
`models.ts`; the store has `verticals` / `assetCategories` (audited, persisted,
`VERSION` 13) and a `settings.stockSchema` row, all **seeded from the compiled
registry** (`VERTICAL_METADATA` → one vertical per key, each vertical's tabs → its
categories, typed by behaviour, with the type's default fields — shared with
`form_schemas` through one `ASSET_FIELD_DEFAULTS` map so the two cannot drift).
Accessors: `listVerticals` / `activeVertical` / `verticalBySlug` / `create` /
`update` / `removeVertical` (guarded), `categoriesForVertical` / `create` /
`update` / `moveCategory` (reorders + renumbers) / `categoryItemCount` /
`removeAssetCategory` (guarded), `stockSchema` / `updateStockSchema`. `Item` gained
`categoryId`. Verified by **`check20.mjs` (6 checks)**. Nothing else reads these
yet — the Assets page still runs off the registry — which is C2/C3.

**Status — C2 done.** The pair is stored: `Category.behaviour` (the user-facing
choice) **and** `Category.type` (the spine type), because the seven `CatalogType`s
carry nuances a two-way choice cannot (a bulk row's owned/available split, a kit's
levels, a part's reorder status). `behaviourOfType()` / `typeForBehaviour()` are the
mapping, and a seeded category keeps its exact type. `FormsService` gained the
engine: **`fieldsFor(categoryId)`** = the tenant's `stockSchema.fields` union the
category's (a category key overrides a stock key of the same name), plus
`schemaForCategory(categoryId)` (an ephemeral `FormSchema`, id `CAT:<id>`, so
`<ims-dynamic-form>` / `coerce` / `validate` / `defaults` work unchanged) and
`categoryForType(verticalId, type)`. Verified by **`check21.mjs` (4 checks)**.

**Status — C3 done (scoped).** The Assets page's **tab strip is the tenant's
categories** for the active vertical (`categoriesForVertical`), ordered by the
tenant, labelled and iconed by the category — the compiled registry no longer
supplies the strip. The page opens on the vertical's **first category**, follows a
vertical switch onto the first category, and the **editor's fields resolve through
the category** (`schemaForCategory`, with the legacy type-scoped schema as a
fallback for rows/categories that predate C1). `Category` gained `icon`.

**The page is keyed on the _category_, not the type.** A business type may hold two
categories of one spine type ("Shop Pumps" and "Shop Seals" are both `quantity` →
`consumable`), and keying the page on the type made them one tab: selecting either
highlighted both, listed the whole type's rows and showed the same count. The open
tab is now `categoryId`; `type` is a **derived** getter off the open category (what
`listItems` / `createItem` / `isCountedStock` take), the strip marks
`categoryId === t.id`, and rows/counts/pills filter on `item.categoryId` — so a
type's rows partition across its tabs instead of repeating in each. A row with no
category (the editor's "— none —") still shows in the **first** category of its
type, so nothing becomes invisible.
**Still registry-read (deliberate, C4):** the grid's **columns** and the per-type
**status list** — those become data when the field/column editor lands.

**Status — C4 done.** A new Admin section, **Verticals & Categories**
(`/admin/verticals`, added to the admin submenu) is the authoring screen: create and
remove **verticals**, mark one **active**, add **categories** to a vertical (name,
behaviour, icon), **reorder** them, and edit the **fields** a category carries and
the tenant's **stock set** — through a new shared **`<ims-field-editor>`** (the
authoring counterpart of `<ims-dynamic-form>`: same `FormField` vocabulary, one
engine). The store gained `setActiveVertical()` / `Tenant.verticalId` so a
tenant-created vertical can be the workspace's, and `createCategory` now takes a
`CategoryDraft` (no `type`) and derives it — `updateCategory` only moves the type
when the **behaviour actually changes**, so renaming a seeded bulk category leaves
it bulk. Verified by **`check22.mjs` (5 checks)**.

**Next:** C5 (item type *derived from* its category; every stock path keys off the
category) and C6 (fold item-scope `form_schemas` into categories; make the grid's
columns and statuses data so the last registry reads go).

**Status — catalog cleanup done.** So a workspace can *use* the category system
rather than stare at the fixture:
- **The fixture is linked.** `linkItemsToCategories()` (run once at construction,
  idempotent) points every seeded row at the active vertical's category of its type,
  so the authoring screen's item counts are real instead of 0 everywhere. `VERSION`
  13→14 reseeds existing snapshots cleanly.
- **The Assets editor picks a category *row*** (`categoryOptions()` = the active
  vertical's categories of the tab's type) instead of the legacy per-type name
  list; on save it writes `categoryId` **and** derives the legacy `category` name
  from the row, so the two cannot disagree.
- **Start clean** (`resetCatalog()` + a confirmed button on Admin → Verticals &
  Categories) drops the sample catalog — assets, shelves, the ledger, orders, POs,
  receipts, inspections, work orders, timesheets, rentals, dispatches, invoices,
  documents, count sessions, **categories**, the stock set, the legacy per-type
  category names and the item-scope `form_schemas` — while keeping what a workspace
  *is* (tenant, people, locations, partners, price cards, pricing, **verticals**).
- **The category icon is a dropdown** (a curated `CATEGORY_ICONS` set) rather than a
  class name typed from memory.
- **The "add" wording is the tab's own title.** The Assets button, its empty state
  and the editor's header read `New <the open tab's title>` — the tenant's category
  name — instead of the registry's fixed `addLabel` ("New Consumable" under a tab
  called Consumables). Rename a category and its button renames with it; the
  registry's wording survives only as the fallback for a type the business type
  doesn't carry. (C6's grid columns and statuses are the registry reads left.)
- **Placement applies to labour too.** A person now carries a place like a machine
  does — their **home base** — so the editor's Placement block is no longer skipped
  for labour (`Placement` → `Home base`), `placements()` reports it, and the labour
  tab's grid prints it (`COL_LOCATION`). The seeded crew is based by department
  (operators in the yard, technicians at the shop, drivers in Yard B). The stock
  readers stay stock: a base is a **row** at a node (`itemsAtLocation` — and so it
  guards that node's removal, the FK being real) but adds **no units**
  (`locationStockQty` skips labour). Move/Count stay off for labour: there are no
  shelves to split and no quantity to correct.
- **A field key identifies a field in its list.** Two categories may both declare
  `rate`; one list may not declare it twice — `attributes` has room for one value
  per key. `duplicateFieldKeys()` is the rule (the shared `<ims-field-editor>` marks
  the row and the Save buttons hold while any row is bad, naming *which* key), and
  every field-list write in the store goes through `uniqueFields()` so no other path
  can leave a list that names one key twice. A category field repeating a *stock*
  key stays an **override** — that is a cross-list shadow, and the merged schema
  still holds one entry per key.
- **The industry has one owner.** `Tenant.vertical` (the registry key as a setting
  of its own) is gone, and with it the **Industry / Vertical** switch on
  Admin → Feature Modules — which now keeps only the module licence flags. The key
  the registry is read through is **derived** from the business type's row slug
  (`DataService.vertical`), so the two can no longer disagree. A snapshot from
  before this change migrates in `hydrate()`: its old key is resolved onto the
  matching `vertical_id`, so a workspace's choice (and its data) survives.

**Status — one business type per workspace (C4 revised).** The vertical screen was
built for a *list* of verticals; a company is one, so it now works that way:
- **A workspace is one business type** (`tenants.vertical_id`), chosen from the
  catalog — a warehouse, a lumber yard, a hospital, a fleet — and the categories
  below it are that type's. Clicking a type switches to it (confirmed); the
  categories authored under the other type are kept, so switching back restores them.
  "Add a type" is for a business the templates don't cover; it becomes yours.
- **The delete dead-end is gone.** Row actions live in a click-stopping cell and are
  **never disabled** — they run, or they *say why*: every business type now carries
  the × (`verticalRemovalBlockers` explains a refusal, `removeTitle` warns before the
  click). The only guards left are data-shaped: a type holding rows, and the last
  type left. Removing the type the workspace is **on** works — the store clears
  `vertical_id` and the workspace lands on the default type. The click-through bug
  is gone with it: a `disabled` button fires no click at all, so its click fell
  through to the row and opened the slot's editor — which is why deleting a
  category opened its editor (`removeCategory` → "…17 asset(s) are still in it.
  Change their category on the Assets page first."). Move up/down are the same: a
  click at either end is ignored in the component rather than written as a no-op
  save.

Verified by **`check23.mjs` (7 checks)**.

## Decisions recorded

1. **Behaviour vocabulary**: `serialized` / `quantity` / `labor` (the owner named
   the first two; `labor` is kept as a third because the Labor tab, timesheets and
   the scheduler a person books to all depend on "a person is not stock in a place").
2. **A category belongs to one vertical** (`category.vertical_id`). A category
   shared across verticals is a `vertical_categories` membership table later; the
   per-vertical duplication the seed shows is the price of "each vertical names its
   own tabs", and it is what the owner asked for.
3. **The stock set is a settings row, not a table of rows** (`stock_schema.fields`
   jsonb), like `pricing` — it is small, read whole, and edited in one place.
4. **Behaviour is stored on the category, derived on the item** — one source, so an
   item cannot disagree with its category about how it is stocked.
5. **The compiled registry is seed-only.** `VERTICAL_METADATA` is read once, to
   create a workspace's default verticals/categories; runtime reads the tenant's
   rows.

## Deliberately left (recorded, not forgotten)

- A **category shared by several verticals** (membership table).
- **Per-vertical stock-set overrides** (the stock set is tenant-wide for now).
- **Field-level permissions / conditional fields beyond `showIf`**.

**Done ahead of C5/C6 — the legacy category list is retired.** The prototype's
per-type name list (`settings.categories` / `CategoryOption`) and its screen
(`/admin/categories`) are gone, so there is **one** category concept: the tenant's
`asset_categories` rows. Nothing was lost in the move:

- the page's **Add / rename / remove / Active** are the category editor on Business
  type & Categories (plus `updateCategory`, `removeAssetCategory`);
- its **"Items" count** is `categoryItemCount()`, and its **viewer's audit stamps**
  are the row tooltip (who added / last changed);
- its **rename cascade** — which rewrote every `items.category` in the type — is now
  `updateCategory()`'s cascade on `categoryId`, so the denormalised name still
  follows the row;
- its **only real consumer**, the Scheduler's New Resource picker, now offers the
  workspace's category rows for that pool type (`categoryOptions()`), like Assets;
- `/categories` and `/admin/categories` **redirect** to
  `/admin/verticals` for bookmarks.
