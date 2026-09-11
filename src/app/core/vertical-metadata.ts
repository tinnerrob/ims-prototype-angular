import { CatalogType, ItemStatus, VerticalKey, VERTICALS, verticalLabel } from './models';

/**
 * IMS — the vertical metadata registry (single source of truth).
 *
 * A vertical is not a *feature flag*: it is the industry the workspace is for, and
 * it changes what the catalog looks like — which tabs the Assets page shows, in
 * what order, what each is called, which columns its grid prints and what a new
 * record of that type starts as. All of that used to be a set of conditionals
 * inside `assets.component.ts` (a `VERTICAL_TABS` map, a `COLUMNS` map and a
 * handful of label strings), which meant a new vertical or a new column set was a
 * code change in a component that has nothing to do with the industry.
 *
 * Here it is *data*: one entry per `VerticalKey`, and the page asks the store for
 * the active tenant's entry (`DataService.verticalMeta()`). Flipping the tenant's
 * vertical therefore re-shapes the page with no reload and no component knowing
 * what a "lumberyard" is — which is what makes it a licence-level fact rather than
 * a UI preference, and what the API has to store per tenant.
 *
 * Two deliberate limits, so this stays a registry rather than a second app:
 *
 * 1. **Only fields the model already has.** A tab's `columns` name `Item` fields
 *    (plus the one virtual column the page computes, `spread`), so a vertical can
 *    *select* and *order* facts, not invent them — a column nobody stores is a
 *    schema conversation, not a label.
 * 2. **Nothing here decides what is *allowed*.** Which modules a tenant may use is
 *    the licence (`Tenant.disabledModules`); a vertical's tab list is what its
 *    catalog *is*, not a permission. Per-vertical category seeds and per-vertical
 *    view gating are their own decisions, not this file's.
 */

/** `[field, header, align?]` — `align` is `num` for right-aligned figures. */
export type ColumnMeta = [field: string, header: string, align?: 'num' | 'text-end'];

/** What one tab of a vertical's catalog is: how it reads and what it prints. */
export interface VerticalTabMeta {
  key: CatalogType;
  label: string;
  /** Bootstrap Icons class for the tab strip. */
  icon: string;
  /** The tab's "add" button, in this vertical's words ("New Equipment"). */
  addLabel: string;
  /** Grid columns, in print order. */
  columns: ColumnMeta[];
  /** What a new record of this type starts as (the editor's blank form). */
  defaults: { status: ItemStatus; qty: number };
}

/** One industry: the tabs it exposes, in the order it exposes them. */
export interface VerticalMetadata {
  key: VerticalKey;
  /** Human label for the vertical itself (Admin → Feature Modules). */
  label: string;
  /** The type the page lands on when the vertical changes. */
  defaultTab: CatalogType;
  /** What this vertical calls a catalog row ("Assets", "Stock Lines", …). */
  noun: string;
  tabs: VerticalTabMeta[];
}


/*
 * The column sets, grouped by what they are about, so a vertical reads as a list
 * of choices rather than 40 lines of arrays. Every entry is a field on `Item`
 * (see models.ts) — a header may be this vertical's wording, the field is the
 * model's.
 */
const COL_ID: ColumnMeta = ['id', 'SKU'];
const COL_NAME: ColumnMeta = ['name', 'Name'];
const COL_CATEGORY: ColumnMeta = ['category', 'Category'];
const COL_LOCATION: ColumnMeta = ['locationId', 'Location'];
const COL_STATUS: ColumnMeta = ['status', 'Status'];
const COL_ON_HAND: ColumnMeta = ['qtyOnHand', 'On Hand', 'num'];
const COL_REORDER: ColumnMeta = ['reorderPoint', 'Reorder Pt', 'num'];
const COL_COST: ColumnMeta = ['costPrice', 'Cost', 'num'];
const COL_RETAIL: ColumnMeta = ['retailPrice', 'Retail', 'num'];
const COL_OWNED: ColumnMeta = ['totalOwned', 'Total Owned', 'num'];
const COL_AVAILABLE: ColumnMeta = ['qtyAvailable', 'Available', 'num'];
const COL_OUT: ColumnMeta = ['qtyOut', 'Out', 'num'];
const COL_RATE: ColumnMeta = ['rateDaily', 'Daily', 'num'];
const COL_MONTHLY: ColumnMeta = ['baseMonthly', 'Monthly', 'num'];
const COL_QTY: ColumnMeta = ['qty', 'Qty', 'num'];
const COL_SPREAD: ColumnMeta = ['spread', 'Spread / hr', 'num'];

const SERIALIZED: VerticalTabMeta = {
  key: 'serialized',
  label: 'Assets (Serialized)',
  icon: 'bi-truck-front',
  addLabel: 'New Equipment',
  columns: [
    COL_ID,
    ['serial', 'Serial / VIN'],
    ['name', 'Name / Model'],
    COL_CATEGORY,
    ['meterHours', 'Meter Hrs', 'num'],
    ['fuelType', 'Fuel'],
    ['purchaseValue', 'Purchase Value', 'num'],
    COL_RATE,
    COL_LOCATION,
    COL_STATUS,
  ],
  defaults: { status: 'Available', qty: 1 },
};

const BULK: VerticalTabMeta = {
  key: 'bulk',
  label: 'Assets (Bulk)',
  icon: 'bi-boxes',
  addLabel: 'New Bulk Resource',
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_OWNED, COL_AVAILABLE, COL_OUT, COL_LOCATION, COL_RATE, COL_MONTHLY],
  defaults: { status: 'Available', qty: 0 },
};

const CONSUMABLE: VerticalTabMeta = {
  key: 'consumable',
  label: 'Consumables',
  icon: 'bi-capsule',
  addLabel: 'New Consumable',
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_ON_HAND, COL_REORDER, COL_COST, COL_RETAIL, COL_LOCATION, COL_STATUS],
  defaults: { status: 'In Stock', qty: 0 },
};

const PART: VerticalTabMeta = {
  key: 'part',
  label: 'Stock Inventory',
  icon: 'bi-wrench-adjustable',
  addLabel: 'New Part',
  columns: [['id', 'Part ID'], COL_NAME, COL_CATEGORY, COL_LOCATION, COL_ON_HAND, COL_REORDER, COL_COST, COL_STATUS],
  defaults: { status: 'In Stock', qty: 0 },
};

const LABOR: VerticalTabMeta = {
  key: 'labor',
  label: 'Labor / Employees',
  icon: 'bi-person-badge',
  addLabel: 'New Labor Item',
  columns: [
    ['id', 'Emp ID'],
    COL_NAME,
    ['role', 'Role'],
    COL_CATEGORY,
    ['hourlyCost', 'Cost / hr', 'num'],
    ['hourlyBillable', 'Billable / hr', 'num'],
    COL_SPREAD,
    COL_STATUS,
  ],
  defaults: { status: 'Active', qty: 1 },
};

const KIT: VerticalTabMeta = {
  key: 'kit',
  label: 'Kits',
  icon: 'bi-boxes',
  addLabel: 'New Kit',
  columns: [['id', 'Kit ID'], COL_NAME, COL_CATEGORY, COL_QTY, COL_RATE, COL_LOCATION, COL_STATUS],
  defaults: { status: 'Available', qty: 1 },
};

const ATTACHMENT: VerticalTabMeta = {
  key: 'attachment',
  label: 'Attachments',
  icon: 'bi-puzzle',
  addLabel: 'New Attachment',
  columns: [['id', 'Acc ID'], COL_NAME, COL_CATEGORY, COL_QTY, COL_RATE, COL_LOCATION, COL_STATUS],
  defaults: { status: 'Available', qty: 1 },
};

/*
 * Four verticals are variations on the fleet/yard catalog above, and each is
 * written as *what its industry actually looks at*:
 *
 * - a **warehouse / 3PL** rents nothing, so it has no serialized tab and no fleet
 *   wording, and its stock tabs lead with the *place* — "where is it" is the first
 *   question a picker asks;
 * - a **yard** (lumberyard) measures stock instead of renting it: no rates;
 * - a **clinic** dispenses supplies, so the reorder point comes before the count.
 */
const WAREHOUSE_BULK: VerticalTabMeta = {
  ...BULK,
  label: 'Bulk Stock',
  addLabel: 'New Bulk Item',
  // A bulk row counts what it *owns* and what is free (it has no single on-hand
  // field — see the `bulk` seed shape), so a warehouse reads those, not a shelf
  // count it doesn't store.
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_LOCATION, COL_OWNED, COL_AVAILABLE, COL_OUT, COL_STATUS],
  defaults: { status: 'Available', qty: 0 },
};

const WAREHOUSE_CONSUMABLE: VerticalTabMeta = {
  ...CONSUMABLE,
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_LOCATION, COL_ON_HAND, COL_REORDER, COL_STATUS],
};

const WAREHOUSE_PART: VerticalTabMeta = {
  ...PART,
  columns: [['id', 'Part ID'], COL_NAME, COL_CATEGORY, COL_LOCATION, COL_ON_HAND, COL_REORDER, COL_COST, COL_STATUS],
};

const YARD_BULK: VerticalTabMeta = {
  ...BULK,
  addLabel: 'New Bulk Material',
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_OWNED, COL_AVAILABLE, COL_OUT, COL_LOCATION],
};

const CLINIC_CONSUMABLE: VerticalTabMeta = {
  ...CONSUMABLE,
  label: 'Supplies',
  addLabel: 'New Supply',
  columns: [COL_ID, COL_NAME, COL_CATEGORY, COL_REORDER, COL_ON_HAND, COL_COST, COL_LOCATION, COL_STATUS],
};

const CLINIC_PART: VerticalTabMeta = {
  ...PART,
  columns: [['id', 'Part ID'], COL_NAME, COL_CATEGORY, COL_LOCATION, COL_ON_HAND, COL_REORDER, COL_STATUS],
};

/**
 * The registry. Every `VerticalKey` has an entry (the type makes a missing one a
 * compile error, not a runtime surprise) and every tab is a real `CatalogType`
 * with at least one column — the harness checks both, plus that no column names a
 * field the model doesn't have.
 */
export const VERTICAL_METADATA: Record<VerticalKey, VerticalMetadata> = {
  HeavyEquipment: {
    key: 'HeavyEquipment',
    label: verticalLabel('HeavyEquipment'),
    defaultTab: 'serialized',
    noun: 'Assets',
    tabs: [SERIALIZED, BULK, CONSUMABLE, PART, LABOR, ATTACHMENT, KIT],
  },
  Rental: {
    key: 'Rental',
    label: verticalLabel('Rental'),
    defaultTab: 'serialized',
    noun: 'Rental Items',
    // A rental yard books the attachment with the machine it fits, and kits are
    // not a thing it tracks: it rents out the units it owns.
    tabs: [SERIALIZED, BULK, CONSUMABLE, PART, LABOR, ATTACHMENT],
  },
  Healthcare: {
    key: 'Healthcare',
    label: verticalLabel('Healthcare'),
    defaultTab: 'consumable',
    noun: 'Supplies',
    tabs: [CLINIC_CONSUMABLE, CLINIC_PART, BULK, LABOR],
  },
  Lumberyard: {
    key: 'Lumberyard',
    label: verticalLabel('Lumberyard'),
    defaultTab: 'bulk',
    noun: 'Stock Lines',
    tabs: [YARD_BULK, CONSUMABLE, PART, LABOR],
  },
  Warehouse: {
    key: 'Warehouse',
    label: verticalLabel('Warehouse'),
    defaultTab: 'consumable',
    noun: 'Stock Lines',
    tabs: [WAREHOUSE_CONSUMABLE, WAREHOUSE_PART, WAREHOUSE_BULK, LABOR],
  },
};

/** The vertical a key names, or the default catalog when the key is unknown. */
export function verticalMetaFor(key: string | null | undefined): VerticalMetadata {
  const known = VERTICALS.some((v) => v.key === key);
  return VERTICAL_METADATA[(known ? key : 'HeavyEquipment') as VerticalKey];
}

/** Look one of a vertical's tabs up by type (`undefined` when it isn't exposed). */
export function tabMetaFor(meta: VerticalMetadata, type: CatalogType): VerticalTabMeta | undefined {
  return meta.tabs.find((t) => t.key === type);
}

