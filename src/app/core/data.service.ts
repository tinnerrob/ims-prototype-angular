import { Injectable, signal } from '@angular/core';

import {
  AuditFields,
  CatalogType,
  CATALOG_TYPE_KEYS,
  CategoryOption,
  Dispatch,
  DispatchStatus,
  INDUSTRY_MODULES,
  Inspection,
  InspectionCheckKey,
  Invoice,
  InvoiceStatus,
  InvoiceTotals,
  Item,
  Location,
  LocationType,
  ModuleKey,
  Movement,
  MovementKind,
  Order,
  OrderLine,
  Overhead,
  Party,
  PARTY_KIND_LABEL,
  PartyKind,
  PO_PROGRESS_LABEL,
  PO_STATUS_LABEL,
  PriceCard,
  PriceCardLine,
  PricingSettings,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseProgress,
  Receipt,
  ReceiptLine,
  RentalSub,
  StockLevel,
  TaxSchedule,
  Tenant,
  Timesheet,
  TIMESHEET_KIND,
  User,
  Vehicle,
  VERTICAL_KEYS,
  VerticalKey,
  WorkOrder,
  WorkOrderCost,
  WorkOrderPart,
  WorkOrderStatus,
  Yard,
  isCountedStock,
  isPurchasable,
  isUnitStock,
  needsReorder,
} from './models';
import { VerticalMetadata, VerticalTabMeta, verticalMetaFor, tabMetaFor } from './vertical-metadata';

/** Money helper — round to 2dp (prototype `round2`). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const pad2 = (n: number) => String(n).padStart(2, '0');

const pad3 = (n: number) => String(n).padStart(3, '0');

/**
 * Moving-average unit cost after receiving `qty` at `unitCost` — what a receipt
 * does to a stocked row's cost, so a screen can show one cost per SKU without
 * storing a cost history (the receipts *are* the history).
 */
function movingCost(onHand: number, current: number | undefined, qty: number, unitCost: number): number {
  if (!current || onHand <= 0) return round2(unitCost);
  return round2((onHand * current + qty * unitCost) / (onHand + qty));
}

/**
 * What `logMovement` is written from. `at` / `byUserId` default to now and the
 * session; the API takes both from the request context (the seed pins them so a
 * fixture doesn't move with the clock or with whoever is signed in).
 */
export interface MovementInput {
  type: CatalogType;
  refId: string;
  kind: MovementKind;
  qty: number;
  orderId?: string | null;
  party?: string;
  locationId?: string;
  receiptId?: string | null;
  byUserId?: string;
  at?: string;
  note?: string;
}

/** What `receiveAgainst` is posted from (see the rules on that method). */
export interface ReceiveInput {
  poId: string;
  /** FK -> `settings.locations`: where the stock is put away. */
  locationId: string;
  /** Quantity to receive *now*, keyed by PO line id (missing = not delivered). */
  qty: Record<string, number>;
  note?: string;
  at?: string;
  byUserId?: string;
}

/** "HH:mm" -> minutes past midnight (prototype `hmMin`). */
export function hmMin(s: string | null | undefined): number {
  if (s == null) return 0;
  const p = String(s).split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

/** Minutes past midnight -> "HH:mm" (prototype `minHM`). */
export function minHM(m: number): string {
  return pad2(Math.floor((((m % 1440) + 1440) % 1440) / 60)) + ':' + pad2(((m % 60) + 60) % 60);
}

/** Snap minutes to the nearest 15 (prototype `snap15`), clamped to the day. */
export function snap15(m: number): number {
  const r = Math.round(m / 15) * 15;
  return r < 0 ? 0 : r >= 1440 ? 1439 : r;
}

/** Local "YYYY-MM-DD" for a date (prototype `dISO`). */
export function dISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Period a date navigator can page through (Scheduler / Labor & Timesheets / inspection log). */
export type PeriodView = 'day' | 'week' | 'month';

/**
 * Label for a period in the date navigators, anchored on its first day — one
 * wording for every pager in the app: "Monday, Aug 17, 2026", "Week of Aug 17, 2026"
 * or "Month of August 2026". Week/month name the period and its first day only
 * (no end date).
 */
export function periodLabel(view: PeriodView, date: Date): string {
  if (view === 'month') return 'Month of ' + date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (view === 'week') {
    return 'Week of ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Sentence form of `periodLabel` for prose ("free for the week of Aug 17, 2026"):
 * the week/month labels are lower-cased and take an article, a day label is
 * already a date so it is returned as-is.
 */
export function periodPhrase(view: PeriodView, date: Date): string {
  const label = periodLabel(view, date);
  return view === 'day' ? label : `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** Monday of the week containing `d` — the app's one week convention (see `periodBounds`). */
export function mondayOf(d: Date): Date {
  return dayAt(d, -((d.getDay() + 6) % 7));
}

/** `d` moved by `days`, as a new Date (a period pager's step). */
export function dayAt(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Inclusive ISO bounds of the period a `day` / `week` / `month` navigator shows,
 * anchored on the day its label names — Monday-based weeks and a month ending on
 * its last day, the same day `periodLabel()` words.
 *
 * This is the window a **list** filter tests its rows against (`date >= start &&
 * date <= end`); the two calendars build their own columns from the same
 * convention rather than asking for bounds, so only the logs share this.
 */
export function periodBounds(view: PeriodView, anchor: Date): { start: string; end: string } {
  if (view === 'month') {
    return {
      start: dISO(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      end: dISO(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    };
  }
  if (view === 'week') {
    const start = mondayOf(anchor);
    return { start: dISO(start), end: dISO(dayAt(start, 6)) };
  }
  return { start: dISO(anchor), end: dISO(anchor) };
}


/** Calendar days spanned by [a, b], minimum 1 (prototype `daysBetween`). */
function daysBetween(a: string, b: string): number {
  const diff = (Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000;
  return Math.max(1, Math.round(diff));
}

/** Mon–Fri weekdays spanned by [a, b], minimum 1 (prototype `countWeekdays`). */
function countWeekdays(a: string, b: string): number {
  const end = new Date(Date.parse(b + 'T00:00:00'));
  const cur = new Date(Date.parse(a + 'T00:00:00'));
  let n = 0;
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, n);
}

/** Whole days from `a` to `b`: the day *index* of `b` (prototype `dayOffset`). */
function dayOffset(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);
}

/** A day ISO shifted by whole days (prototype `addDays`). */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00') + days * 86400000).toISOString().slice(0, 10);
}

/** Billable days in a day range, honouring a line's weekend policy (prototype `billableDays`). */
function billableDaysBetween(policy: OrderLine['weekendPolicy'], a: string, b: string): number {
  if (policy === 'skip') return countWeekdays(a, b);
  if (policy === 'overtime') return daysBetween(a, b) * 1.5;
  return daysBetween(a, b);
}

/** A party's billing cadence → the length of one cycle, in days (prototype `BILLING_CYCLES`). */
const BILLING_CYCLES: Record<string, number> = {
  daily: 1,
  weekly: 7,
  'bi-weekly': 14,
  monthly: 28,
  quarterly: 84,
};

/**
 * Whole rate units (weeks or months) of a booking that bill inside the day range
 * `[sDay, eDay]` — the prototype's `wholeUnitsBilled()`. A rental on the weekly or
 * monthly basis bills in **whole units**, never `rate x days`, so every unit has to
 * land in exactly one billing cycle: a unit is billed by the cycle that holds the
 * majority of its days, decided by the unit's upper-median day (the tie going to
 * the later cycle, which is what "run the next cycle" means). Every unit lands in
 * exactly one cycle, so summing cycles never double-bills and always adds up to
 * the line's own `lineTotal()`.
 *
 * @param sDay first day of the cycle, as an index from the line's first day
 * @param eDay last day of the cycle, as an index from the line's first day
 * @param unitDays 7 for the weekly basis, 28 for the monthly
 * @param totalDays the line's own length in days
 */
function wholeUnitsBilled(sDay: number, eDay: number, unitDays: number, totalDays: number): number {
  if (eDay < sDay) return 0;
  const units = Math.ceil(totalDays / unitDays);
  let billed = 0;
  for (let k = 0; k < units; k++) {
    const unitStart = k * unitDays;
    const unitEnd = Math.min((k + 1) * unitDays - 1, totalDays - 1);
    if (unitEnd < sDay) continue;
    const billDay = unitStart + Math.ceil((unitEnd - unitStart) / 2);
    if (billDay >= sDay && billDay <= eDay) billed++;
  }
  return billed;
}

/** The seeded demo workspace + the person the session starts as. */
const DEMO_TENANT_ID = 'TNT-NORTHLINE';
const DEMO_USER_ID = 'USR-003';
/** Who the fixtures are attributed to (the workspace owner, in a real install). */
const DEMO_OWNER_ID = 'USR-001';

/** The audit columns, ignored when comparing a row with the last saved copy. */
const AUDIT_KEYS = ['tenantId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];

/**
 * Seeded placement ids (`settings.locations`) — the fixtures' `locationId`
 * values. Named because the alternative is eight call sites repeating `'LOC-03'`
 * and a reader who can't tell a yard from a warehouse without scrolling to the
 * location seed.
 */
const YARD_STAGING = 'LOC-03'; // Yard A — equipment staging (machines, bulk, attachments)
const WAREHOUSE_1 = 'LOC-05'; // Warehouse 1 (kits, the shop's own stock)
/** Where a unit that is in the shop sits (vs. staged in the yard). */
const SHOP_STATUS = 'In Shop';

/**
 * A counted row's derived quantities (see `StockLevel`): the fields that are
 * `stock_levels`' sum and its busiest holding. They are written by
 * `syncStockTotals()` and nowhere else, so a patch carrying them is stripped
 * rather than trusted.
 */
const DERIVED_STOCK_KEYS: readonly string[] = ['qty', 'qtyOnHand', 'qtyAvailable', 'totalOwned', 'locationId'];

/**
 * Stock the fixture already keeps in *two* places: `[type, item id, the second
 * place, the quantity there]`. The rest of a counted row's holding is where its
 * seed says it sits (see `seedStockLevels`), so this is the one line that shows
 * the model the whole increment is about — the same part, in two bins, with a
 * count in each — on the Assets grid and in the location counts.
 */
const SEED_SPLIT_STOCK: readonly [CatalogType, string, string, number][] = [
  // Hydraulic Filter 40um: 24 in its bay, 6 on the bench-side bin in the same aisle.
  ['part', 'PRT-001', 'LOC-15', 6],
];

/**
 * A row's content without its audit columns — the signature `attribute()` diffs
 * against the last persisted copy to decide whether a row was edited.
 */
function contentSignature(row: object): string {
  return JSON.stringify(row, (k, v) => (AUDIT_KEYS.includes(k) ? undefined : v));
}

/**
 * IMS — DataService (the JSON store / API seam).
 *
 * Port of the prototype's `IMS` seed (js/data.js) + `IMS.store`: one typed
 * in-memory database behind accessors, persisted to localStorage and versioned
 * so a stale snapshot is ignored on upgrade. A future `HttpClient` adapter can
 * swap these synchronous methods for async JSON without touching feature code.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly KEY = 'ims-web.store';
  /** Bumped whenever the seed shape changes, so stale snapshots reseed. */
  private readonly VERSION = 11;

  /* `rev` is bumped on every persisted write, so a service can derive reactive
     state (the session, the tenant's module flags) from this one store instead
     of keeping a second copy of the data. */
  private readonly rev = signal(0);
  readonly revision = this.rev.asReadonly();

  /** True when a stored snapshot was from an older schema and the seed replaced
   *  it. The shell says so, rather than swapping the user's data out silently. */
  reseeded = false;

  /** Last persisted content signature per row, keyed `table:id`. */
  private readonly shadow = new Map<string, string>();
  /**
   * The store key a row was first seen under, by identity.
   *
   * Most rows are keyed by an id that never moves. A configuration row is keyed
   * by its *natural* key instead (`categories.type` + name, a location type's
   * name, a tax code), and those mutators rename in place — the row object is the
   * same row, its key is not. Following the object keeps a rename from reading as
   * a delete plus a fresh create, which would lose who added the row.
   */
  private readonly rowKeys = new WeakMap<AuditFields, string>();
  /** True when `hydrate()` adopted a persisted snapshot (so the fixtures it
   *  already contains must not be posted a second time). */
  private restored = false;
  /** False until the seed/restored rows have been attributed once. */
  private attributed = false;

  private db: {
    settings: {
      /** Location hierarchy (ragged / adjacency list — see `Location`). */
      locations: Location[];
      /** User-defined location types (Site, Yard, Bin, …). */
      locationTypes: LocationType[];
      taxSchedules: TaxSchedule[];
      overheads: Overhead[];
      pricing: PricingSettings;
      categories: Record<string, CategoryOption[]>;
    };
    /** Customer workspaces — the tenancy root (one today, many via the API). */
    tenants: Tenant[];
    /** People who may sign in, scoped to a tenant. */
    users: User[];
    /** Who the current session is acting as. */
    session: {
      tenantId: string;
      userId: string;
    };
    yard: Yard;
    parties: Party[];
    /**
     * Negotiated rates per counterparty (see `PriceCard`). Configuration, not a
     * document: nothing references a card, it is *read* when an order's amount is
     * derived.
     */
    priceCards: PriceCard[];
    orders: Order[];
    items: Record<string, Item[]>;
    /**
     * Stock held per place — one row per (row, location) while it holds
     * something (see `StockLevel`). The truth for a counted row's quantities;
     * `Item.qty*` and its `locationId` are this table's sum and its biggest
     * holding, refreshed by `syncStockTotals()`.
     */
    stockLevels: StockLevel[];
    movements: Movement[];
    /** What was ordered from suppliers (no copy of what arrived — see models). */
    purchaseOrders: PurchaseOrder[];
    /** Posted goods receipts: the documents that created the stock. */
    receipts: Receipt[];
    inspections: Inspection[];
    workOrders: WorkOrder[];
    timesheets: Timesheet[];
    rentals: RentalSub[];
    vehicles: Vehicle[];
    dispatches: Dispatch[];
    invoices: Invoice[];
  } = {
    settings: {
      locations: this.seedLocations(),
      locationTypes: this.seedLocationTypes(),
      taxSchedules: this.seedTaxSchedules(),
      overheads: this.seedOverheads(),
      pricing: this.seedPricing(),
      categories: this.seedCategories(),
    },
    tenants: this.seedTenants(),
    users: this.seedUsers(),
    session: { tenantId: DEMO_TENANT_ID, userId: DEMO_USER_ID },
    yard: { name: 'Main Yard — Buckhead Hub', lat: 33.749, lng: -84.388 },
    parties: this.seedParties(),
    priceCards: this.seedPriceCards(),
    orders: this.seedOrders(),
    items: this.seedItems(),
    /** Filled by `seedStockLevels()` in the constructor: a level row needs the
     *  item it belongs to, and every seeded quantity has to be placed. */
    stockLevels: [],
    /** Filled by `seedMovements()` in the constructor — a movement's place is
     *  derived from the unit's own seeded placement, which exists only once
     *  `items` above has been initialised. */
    movements: [],
    purchaseOrders: this.seedPurchaseOrders(),
    /** Posted by `seedReceipts()` in the constructor (see below). */
    receipts: [],
    inspections: this.seedInspections(),
    workOrders: this.seedWorkOrders(),
    timesheets: this.seedTimesheets(),
    rentals: this.seedRentals(),
    vehicles: this.seedVehicles(),
    dispatches: this.seedDispatches(),
    invoices: this.seedInvoices(),
  };

  constructor() {
    // The chain-of-custody seed is derived from the units it moved, so it runs
    // once `items` exists (see the `movements` field above).
    this.db.movements = this.seedMovements();
    // Restore before posting anything: the seed's receipts write through
    // `save()`, which would otherwise land on top of the snapshot `hydrate()`
    // still has to read (and would make an old-schema snapshot look current).
    this.hydrate();
    const seeded = !this.restored;
    // Stock that came with the workspace is placed: one level row per seeded
    // quantity. It runs *after* `hydrate()` so a restored snapshot keeps its own
    // levels (posting them twice would double the shelves).
    if (seeded) this.seedStockLevels();
    // Receipts are *posted*, not hand-written: the fixture runs the same
    // operation the Purchasing page runs, so the seed cannot describe stock the
    // ledger doesn't have (or a PO whose lines disagree with what arrived). A
    // restored snapshot already contains them — posting twice would land the
    // stock twice.
    if (seeded) this.seedReceipts();
    // Attribute the rows we start with (and remember them), so the first write
    // of the session is diffed against a known baseline.
    this.attributeSeed();
    // The fixture posting above persisted on its way in; write once more now
    // that every row carries its tenant/author stamps.
    if (seeded) this.save();
  }

  /* ----------------------------- persistence ---------------------------- */

  /** Restore a previously persisted snapshot if the version matches. */
  private hydrate(): void {
    try {
      const raw = localStorage.getItem(this.KEY);
      const snap = raw ? JSON.parse(raw) : null;
      if (snap && snap._v === this.VERSION) {
        this.restored = true;
        if (snap.settings?.categories) this.db.settings.categories = snap.settings.categories;
        if (Array.isArray(snap.settings?.locations)) this.db.settings.locations = snap.settings.locations;
        if (Array.isArray(snap.settings?.locationTypes)) this.db.settings.locationTypes = snap.settings.locationTypes;
        if (snap.settings?.taxSchedules) this.db.settings.taxSchedules = snap.settings.taxSchedules;
        if (snap.settings?.overheads) this.db.settings.overheads = snap.settings.overheads;
        if (snap.settings?.pricing) this.db.settings.pricing = snap.settings.pricing;
        if (snap.yard) this.db.yard = snap.yard;
        if (Array.isArray(snap.parties)) this.db.parties = snap.parties;
        if (Array.isArray(snap.priceCards)) this.db.priceCards = snap.priceCards;
        if (Array.isArray(snap.orders)) this.db.orders = snap.orders;
        if (snap.items && typeof snap.items === 'object') this.db.items = snap.items;
        if (Array.isArray(snap.stockLevels)) this.db.stockLevels = snap.stockLevels;
        if (Array.isArray(snap.movements)) this.db.movements = snap.movements;
        if (Array.isArray(snap.purchaseOrders)) this.db.purchaseOrders = snap.purchaseOrders;
        if (Array.isArray(snap.receipts)) this.db.receipts = snap.receipts;
        if (Array.isArray(snap.inspections)) this.db.inspections = snap.inspections;
        if (Array.isArray(snap.workOrders)) this.db.workOrders = snap.workOrders;
        if (Array.isArray(snap.timesheets)) this.db.timesheets = snap.timesheets;
        if (Array.isArray(snap.rentals)) this.db.rentals = snap.rentals;
        if (Array.isArray(snap.vehicles)) this.db.vehicles = snap.vehicles;
        if (Array.isArray(snap.dispatches)) this.db.dispatches = snap.dispatches;
        if (Array.isArray(snap.invoices)) this.db.invoices = snap.invoices;
        if (Array.isArray(snap.tenants) && snap.tenants.length) this.db.tenants = snap.tenants;
        if (Array.isArray(snap.users) && snap.users.length) this.db.users = snap.users;
        if (snap.session?.userId) this.db.session = snap.session;
      } else if (snap) {
        // Older schema: the seed replaces the snapshot. Flagged so the shell can
        // say so — a version bump must never look like data that vanished.
        this.reseeded = true;
      }
      this.adoptLegacyModuleFlags();
    } catch {
      /* corrupted storage -> keep seed */
    }
  }

  /**
   * One-time upgrade: fold the pre-tenancy `ims-web.modules` browser preference
   * into the demo tenant's licence flags, then drop the legacy key so module
   * enablement has exactly one home (the tenant — which is where the API will
   * keep it once licences are server-side).
   */
  private adoptLegacyModuleFlags(): void {
    const LEGACY = 'ims-web.modules';
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const flags: Record<string, boolean> = JSON.parse(raw);
      const tenant = this.db.tenants[0];
      if (tenant) {
        tenant.disabledModules = INDUSTRY_MODULES.filter((m) => flags[m.key] === false).map((m) => m.key);
        this.save();
      }
      localStorage.removeItem(LEGACY);
    } catch {
      /* ignore */
    }
  }

  /** Persist the full snapshot (writes are routed through here). */
  private save(): void {
    if (this.attributed) this.attributeWrites();
    try {
      localStorage.setItem(
        this.KEY,
        JSON.stringify({
          _v: this.VERSION,
          settings: this.db.settings,
          tenants: this.db.tenants,
          users: this.db.users,
          session: this.db.session,
          yard: this.db.yard,
          parties: this.db.parties,
          priceCards: this.db.priceCards,
          orders: this.db.orders,
          items: this.db.items,
          stockLevels: this.db.stockLevels,
          movements: this.db.movements,
          purchaseOrders: this.db.purchaseOrders,
          receipts: this.db.receipts,
          inspections: this.db.inspections,
          workOrders: this.db.workOrders,
          timesheets: this.db.timesheets,
          rentals: this.db.rentals,
          vehicles: this.db.vehicles,
          dispatches: this.db.dispatches,
          invoices: this.db.invoices,
        }),
      );
    } catch {
      /* storage unavailable (private mode / quota) -> in-memory only */
    }
    // The store changed either way, so anything derived from it (session,
    // module flags) recomputes even when persistence is unavailable.
    this.rev.update((n) => n + 1);
  }

  /* ----------------------------- attribution ----------------------------- */
  /*
   * Every write is attributed here, not in each mutator. `save()` is the store's
   * single writer, so it is the one place that can guarantee no row is ever
   * written without `tenantId` / `createdBy` / `updatedBy` — and a mutator added
   * later cannot forget to stamp it (the discipline that rots otherwise).
   *
   * How it knows a row was edited: each row's content — audit columns excluded —
   * is remembered after every persist. On the next write, a row whose content
   * moved gets `updatedAt/updatedBy`; a row that was not there at all gets the
   * create stamps too. That is the job a DB trigger does on INSERT/UPDATE.
   */

  /** The identity + time a write is attributed to (the API's request context). */
  private actor(): { tenantId: string; userId: string; at: string } {
    return {
      tenantId: this.sessionTenantId(),
      userId: this.sessionUserId(),
      at: new Date().toISOString(),
    };
  }

  /**
   * Every audited row in the store, keyed `table:id` (see `shadow`).
   *
   * Configuration belongs here too (A9): a settings row is written by a person in
   * Admin, so it is stamped like any other row. Those tables have no surrogate id
   * — their key *is* their meaning (`location_types.name`, `categories.type` +
   * `name`, `tax_schedules.code`) — so `keyOf` names it, and the two singletons
   * (`pricing`, `yard`) are one row per tenant with a key that says so.
   */
  private auditedRows(): [string, AuditFields][] {
    const out: [string, AuditFields][] = [];
    const add = (table: string, rows: AuditFields[], keyOf?: (row: AuditFields) => string) => {
      for (const r of rows) {
        const key = keyOf
          ? keyOf(r)
          : ((r as { id?: string; orderId?: string }).id ?? (r as { orderId?: string }).orderId ?? '');
        out.push([`${table}:${key}`, r]);
      }
    };
    for (const [type, rows] of Object.entries(this.db.items)) add(`items:${type}`, rows);
    add('stockLevels', this.db.stockLevels);
    add('parties', this.db.parties);
    add('priceCards', this.db.priceCards);
    add('orders', this.db.orders);
    add('movements', this.db.movements);
    add('purchaseOrders', this.db.purchaseOrders);
    add('receipts', this.db.receipts);
    add('inspections', this.db.inspections);
    add('workOrders', this.db.workOrders);
    add('timesheets', this.db.timesheets);
    add('rentals', this.db.rentals);
    add('vehicles', this.db.vehicles);
    add('dispatches', this.db.dispatches);
    add('invoices', this.db.invoices);
    add('locations', this.db.settings.locations);
    // Configuration (A9): the rows Admin edits, stamped like everything else.
    add('locationTypes', this.db.settings.locationTypes, (r) => (r as LocationType).name);
    for (const [type, rows] of Object.entries(this.db.settings.categories)) {
      add(`categories:${type}`, rows, (r) => (r as CategoryOption).name);
    }
    add('taxSchedules', this.db.settings.taxSchedules, (r) => (r as TaxSchedule).code);
    add('overheads', this.db.settings.overheads);
    add('pricing', [this.db.settings.pricing], () => 'settings');
    add('yard', [this.db.yard], () => 'settings');
    return out;
  }

  /**
   * Attribute the rows the seed (or a restored snapshot) started us with, and
   * remember them as the baseline. This is what a migration does for rows that
   * predate the columns (`UPDATE … SET created_by = … WHERE created_by IS NULL`),
   * so no screen or report ever shows a blank author.
   */
  private attributeSeed(): void {
    const when = `${this.db.tenants[0]?.createdAt ?? '2024-01-08'}T08:00:00`;
    for (const [key, row] of this.auditedRows()) {
      // A movement's author *is* the person who moved it, and its clock is its own
      // `at`. Everything else was authored when the workspace was set up.
      const mv = row as Partial<Movement>;
      row.tenantId ??= DEMO_TENANT_ID;
      row.createdAt ??= mv.at ?? when;
      row.createdBy ??= mv.byUserId ?? DEMO_OWNER_ID;
      row.updatedAt ??= row.createdAt;
      row.updatedBy ??= row.createdBy;
      this.shadow.set(key, contentSignature(row));
      this.rowKeys.set(row, key);
    }
    this.attributed = true;
  }

  /** Attribute everything written since the last persist (see the note above). */
  private attributeWrites(): void {
    const a = this.actor();
    const seen = new Set<string>();
    for (const [fresh, row] of this.auditedRows()) {
      // A row whose natural key moved is the same row: follow it, so a rename
      // takes the edit stamps instead of being read as a delete and a create.
      const key = this.rowKeys.get(row) ?? fresh;
      if (key === fresh) this.rowKeys.set(row, key);
      seen.add(key);
      const content = contentSignature(row);
      const before = this.shadow.get(key);
      if (before === content) continue;
      row.tenantId ??= a.tenantId;
      if (before === undefined) {
        row.createdAt = a.at;
        row.createdBy = a.userId;
      }
      row.updatedAt = a.at;
      row.updatedBy = a.userId;
      this.shadow.set(key, content);
    }
    // A removed row leaves with the shadow — nothing to attribute afterwards.
    for (const key of [...this.shadow.keys()]) if (!seen.has(key)) this.shadow.delete(key);
  }

  /** Display name for a user id — logs and record views show who, not an id. */
  userName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.getUser(id)?.name ?? id;
  }

  /* ------------------------------- format ------------------------------- */

  money(n: number | null | undefined): string {
    return '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  int(n: number | null | undefined): string {
    return Number(n ?? 0).toLocaleString('en-US');
  }

  pct(n: number | null | undefined): string {
    return (Number(n) || 0).toFixed(1) + '%';
  }

  /** Parse a date / ISO string; date-only strings are local midnight (prototype `parseDT`). */
  parseDT(s: string | Date): Date {
    if (s instanceof Date) return new Date(s.getTime());
    const str = String(s).replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date(str);
  }

  /** MM/DD/YYYY (prototype `fmtDate`). */
  fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = this.parseDT(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
  }

  /** MM/DD/YYYY HH:mm (prototype `fmtDT`). */
  fmtDT(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = this.parseDT(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ------------------------------- parties ------------------------------ */

  /**
   * Counterparties by role (`Party.kinds`). Orders pick customers, purchase
   * orders pick suppliers, and both read the same table, so a partner that is
   * both shows up in each list without a duplicate row.
   */
  listParties(): Party[] {
    return [...this.db.parties];
  }

  customerParties(): Party[] {
    return this.db.parties.filter((p) => !p.kinds || p.kinds.includes('customer'));
  }

  supplierParties(): Party[] {
    return this.db.parties.filter((p) => (p.kinds ?? []).includes('supplier'));
  }

  /** Roles of a party as text — a grid cell / record-view field. */
  partyKindLabel(p: Party): string {
    const kinds = p.kinds ?? [];
    return kinds.length ? kinds.map((k) => PARTY_KIND_LABEL[k]).join(' · ') : PARTY_KIND_LABEL.customer;
  }

  getParty(id: string): Party | undefined {
    return this.db.parties.find((p) => p.id === id);
  }

  createParty(data: Omit<Party, 'id'> & { active?: boolean }): Party {
    const rec: Party = { ...data, id: this.nextPartyId(), active: data.active !== false };
    this.db.parties.push(rec);
    this.save();
    return rec;
  }

  updateParty(id: string, patch: Partial<Party>): void {
    const p = this.db.parties.find((x) => x.id === id);
    if (p) {
      Object.assign(p, patch);
      this.save();
    }
  }

  togglePartyActive(id: string): void {
    const p = this.db.parties.find((x) => x.id === id);
    if (p) {
      p.active = p.active === false;
      this.save();
    }
  }

  /**
   * Remove a party. Refused (`false`) while a document names it — the rows that
   * point at the party would keep a dangling FK, and since the order screens
   * derive the customer's name from `party_id`, the gap would show. Deactivate
   * instead (`togglePartyActive`) if the trade has ended.
   */
  removeParty(id: string): boolean {
    const i = this.db.parties.findIndex((x) => x.id === id);
    if (i < 0 || this.partyRemovalBlockers(id).length > 0) return false;
    this.db.parties.splice(i, 1);
    this.save();
    return true;
  }

  /**
   * Party display name by id — the join every screen prints instead of storing a
   * copy of the name (prototype `partyName`). An id that names no party reads
   * back as itself: a row pointing at a partner the table no longer holds is a
   * bug, and showing the raw id beats showing nothing.
   */
  partyName(id: string): string {
    return this.getParty(id)?.name ?? id;
  }

  /**
   * What stops a party being removed — the single list the guard and the grid's
   * disabled button read (the `locationRemovalBlockers` pattern).
   *
   * A party is a document's counterparty, so every row that names one points at
   * it: orders (`orders.party_id`), purchase orders and their receipts
   * (`supplier_id`), the sub-rentals they hire to us, and the rate cards negotiated
   * with them (`price_cards.party_id` — A11's FK, and a card is a row that names
   * the party just as a document is). That FK now carries the only copy of the name
   * — the order screens derive it — so a party deleted out from under a row would
   * print a raw id where a customer belongs. Leaving the trade is `active = false`,
   * exactly as the document says.
   */
  partyRemovalBlockers(id: string): string[] {
    const out: string[] = [];
    const orders = this.orderCount(id);
    if (orders > 0) out.push(`${orders} order(s)`);
    const pos = this.supplierOrderCount(id);
    if (pos > 0) out.push(`${pos} purchase order(s)`);
    const receipts = this.db.receipts.filter((r) => r.supplierId === id).length;
    if (receipts > 0) out.push(`${receipts} receipt(s)`);
    const subs = this.rentalsFromSupplier(id).length;
    if (subs > 0) out.push(`${subs} sub-rental(s)`);
    const cards = this.db.priceCards.filter((c) => c.partyId === id).length;
    if (cards > 0) out.push(`${cards} rate card(s)`);
    return out;
  }

  /** Active-order count for a party (Customers grid "N active"). */
  activeOrderCount(partyId: string): number {
    return this.db.orders.filter((o) => o.partyId === partyId && o.status === 'active').length;
  }

  orderCount(partyId: string): number {
    return this.db.orders.filter((o) => o.partyId === partyId).length;
  }

  private nextPartyId(): string {
    let max = 0;
    for (const p of this.db.parties) {
      const n = Number(p.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'PTY-' + String(max + 1).padStart(3, '0');
  }


  /* ----------------------------- price cards ---------------------------- */

  /**
   * Negotiated rates per counterparty (see `PriceCard`).
   *
   * This is configuration a workspace edits, but unlike the settings tables it
   * hangs off a *party* rather than the tenant — so it lives beside `parties`, not
   * under `settings`, and its rows are stamped and audited like any other.
   */
  listPriceCards(): PriceCard[] {
    return [...this.db.priceCards];
  }

  getPriceCard(id: string): PriceCard | undefined {
    return this.db.priceCards.find((c) => c.id === id);
  }

  /** Every card a party has ever had, newest window first (the grid's detail). */
  priceCardsForParty(partyId: string): PriceCard[] {
    return this.db.priceCards
      .filter((c) => c.partyId === partyId)
      .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''));
  }

  createPriceCard(data: Omit<PriceCard, 'id'>): PriceCard {
    const rec: PriceCard = { ...data, id: this.nextPriceCardId(), active: data.active !== false };
    this.db.priceCards.push(rec);
    this.save();
    return rec;
  }

  updatePriceCard(id: string, patch: Partial<PriceCard>): void {
    const c = this.db.priceCards.find((x) => x.id === id);
    if (c) {
      Object.assign(c, patch);
      this.save();
    }
  }

  /**
   * Remove a card. No guard, and that is the point: nothing references a card —
   * it is read when an order's amount is derived — so removal cannot dangle an FK,
   * it only re-prices the orders the card covered (visible on those screens).
   * Retiring a card that still has to read back is `active = false`.
   */
  removePriceCard(id: string): void {
    const i = this.db.priceCards.findIndex((c) => c.id === id);
    if (i < 0) return;
    this.db.priceCards.splice(i, 1);
    this.save();
  }

  /**
   * The card in force for a party on a date: active, and the date inside its
   * window (an absent bound is open). When two cards overlap the later
   * `effectiveFrom` wins — a renewal supersedes what it replaced.
   */
  priceCardFor(partyId: string, onDate?: string): PriceCard | undefined {
    const day = onDate ?? dISO(new Date());
    const inForce = this.db.priceCards
      .filter((c) => c.partyId === partyId && c.active !== false && this.cardCovers(c, day))
      .sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''));
    return inForce[inForce.length - 1];
  }

  /** True when `onDate` falls inside a card's window (either bound may be absent). */
  cardCovers(card: PriceCard, onDate: string): boolean {
    if (card.effectiveFrom && onDate < card.effectiveFrom) return false;
    if (card.effectiveTo && onDate > card.effectiveTo) return false;
    return true;
  }

  /**
   * Where a card stands today, for the grid: `in-force` means it covers today and
   * is switched on (so a booking made today prices at it), `scheduled` starts
   * later, `expired` ended, `inactive` was switched off. A card never reports
   * `in-force` *and* reads as unused — the status is the window and the flag, the
   * same two facts `priceCardFor()` filters on.
   */
  cardStatus(card: PriceCard): 'in-force' | 'scheduled' | 'expired' | 'inactive' {
    if (card.active === false) return 'inactive';
    const today = dISO(new Date());
    if (card.effectiveFrom && today < card.effectiveFrom) return 'scheduled';
    if (card.effectiveTo && today > card.effectiveTo) return 'expired';
    return 'in-force';
  }

  /** A card's line for a catalog row, if the card negotiated one. */
  cardLineFor(card: PriceCard | undefined, type: CatalogType, refId: string): PriceCardLine | undefined {
    return card?.lines.find((l) => l.type === type && l.refId === refId);
  }

  /**
   * The price of a line that bills **once** — the catalog's own figure per type,
   * which is what `lineTotal()` has always billed: labor at its hourly billable, a
   * consumable at retail, a part at cost. A rented type has no single price, so it
   * reads back as `undefined` and the day/week/month rates apply instead.
   */
  oneTimePrice(item: Item): number | undefined {
    if (item.type === 'labor') return item.hourlyBillable ?? item.rateDaily;
    if (item.type === 'consumable') return item.retailPrice ?? item.rateDaily;
    if (item.type === 'part') return item.costPrice ?? item.retailPrice ?? item.rateDaily;
    return undefined;
  }

  /**
   * The rates a **booking** bills at — the single reader of a price card.
   *
   * Everything derived from a rate (`lineTotal()`, `rateBasis()`, an invoice's
   * cycle amounts) comes through here, so a screen cannot print one number and add
   * up another: the card's negotiated rate replaces the catalog's, field by field,
   * and `source` says which won so the UI can mark it. A line the card does not
   * name prices exactly as it did before the card existed.
   */
  cardRateFor(
    partyId: string,
    item: Item,
    onDate?: string,
  ): {
    rateDaily: number;
    baseWeekly?: number;
    baseMonthly?: number;
    unitPrice?: number;
    source: 'card' | 'list';
    card?: PriceCard;
  } {
    const catalog = {
      rateDaily: item.rateDaily,
      baseWeekly: item.baseWeekly,
      baseMonthly: item.baseMonthly,
      // The one-time price a type bills once, exactly the figure `lineTotal()`
      // has always used: labor bills its hourly billable, a consumable its retail,
      // a part its cost. (Before A11 the invoicing screen's `rateBasis()` read
      // `retailPrice` for a part while `lineTotal()` read `costPrice`; going
      // through one reader is what makes the printed rate and the billed amount
      // agree again.)
      unitPrice: this.oneTimePrice(item),
    };
    const card = partyId ? this.priceCardFor(partyId, onDate) : undefined;
    const line = this.cardLineFor(card, item.type, item.id);
    if (!card || !line) return { ...catalog, source: 'list' };
    const pick = (a: number | undefined, b: number | undefined) => (a == null ? b : a);
    return {
      rateDaily: pick(line.rateDaily, catalog.rateDaily) ?? 0,
      baseWeekly: pick(line.baseWeekly, catalog.baseWeekly),
      baseMonthly: pick(line.baseMonthly, catalog.baseMonthly),
      unitPrice: pick(line.unitPrice, catalog.unitPrice),
      source: 'card',
      card,
    };
  }

  /**
   * The cost a **supplier's** card sets for a catalog row, for the buying side.
   *
   * Unlike the bill side this is a *default*, not a derived figure: a purchase
   * order line stores the `unit_cost` it was raised at, so the card seeds the
   * editor (`syncLine`) and the document then stands on its own — a supplier's
   * own quote, kept as the fact it is. `undefined` means the card says nothing
   * about the row and the catalog's cost applies.
   */
  supplierCardCost(partyId: string, type: CatalogType, refId: string, onDate?: string): number | undefined {
    return this.cardLineFor(this.priceCardFor(partyId, onDate), type, refId)?.unitCost;
  }

  /**
   * What a PO line's cost *starts* at with a given supplier: their card's price if
   * the agreement names the row, else the catalog's own cost figure. One reader for
   * the editor's default, so the initial fill (`syncLine`) and the re-fill after a
   * change (`onSupplierChange`) can never disagree about the order of the fallback.
   */
  poLineCostFor(supplierId: string, type: CatalogType, refId: string): number {
    const agreed = this.supplierCardCost(supplierId, type, refId);
    if (agreed != null) return agreed;
    const item = refId ? this.getItem(type, refId) : undefined;
    return item?.costPrice ?? item?.purchaseValue ?? 0;
  }

  private nextPriceCardId(): string {
    let max = 0;
    for (const c of this.db.priceCards) {
      const n = Number(c.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'PC-' + String(max + 1).padStart(3, '0');
  }


  /* ------------------------------- orders ------------------------------- */

  listOrders(): Order[] {
    return [...this.db.orders];
  }

  getOrder(orderId: string): Order | undefined {
    return this.db.orders.find((o) => o.orderId === orderId);
  }

  createOrder(data: Omit<Order, 'orderId' | 'status' | 'lineItems'>): Order {
    const rec: Order = {
      ...data,
      orderId: this.nextOrderId(),
      status: 'active',
      lineItems: [],
    };
    this.db.orders.push(rec);
    this.save();
    return rec;
  }

  updateOrderStatus(orderId: string, status: Order['status']): void {
    const o = this.getOrder(orderId);
    if (o) {
      o.status = status;
      this.save();
    }
  }

  /** The id `createOrder` will assign next — for read-only previews in modals. */
  previewOrderId(): string {
    return this.nextOrderId();
  }

  private nextOrderId(): string {
    const year = new Date().getFullYear();
    const prefix = `CT-${year}-`;
    let max = 0;
    for (const o of this.db.orders) {
      const m = o.orderId.match(/-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return prefix + String(max + 1).padStart(3, '0');
  }

  addOrderLine(orderId: string, line: Omit<OrderLine, 'id'>): void {
    const order = this.getOrder(orderId);
    if (!order) return;
    const li: OrderLine = {
      id: this.nextLineId(order),
      ...line,
      startDate: line.startDate ?? order.startDate,
      endDate: line.endDate ?? order.endDate,
    };
    order.lineItems.push(li);
    this.save();
  }

  removeOrderLine(orderId: string, lineId: string): void {
    const order = this.getOrder(orderId);
    if (!order) return;
    const i = order.lineItems.findIndex((l) => l.id === lineId);
    if (i >= 0) {
      order.lineItems.splice(i, 1);
      this.save();
    }
  }

  private nextLineId(order: Order): string {
    let max = 0;
    for (const l of order.lineItems) {
      const n = Number(String(l.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'LI-' + String(max + 1).padStart(3, '0');
  }

  /** Resize an order line window (day ISO). Clamped to the order window. */
  updateOrderLineDates(orderId: string, lineId: string, startISO: string, endISO: string): void {
    const order = this.getOrder(orderId);
    const li = order?.lineItems.find((l) => l.id === lineId);
    if (!order || !li) return;
    const clamp = (iso: string, lo: string, hi: string): string => {
      const t = Date.parse(iso + 'T00:00:00');
      const l = Date.parse(lo + 'T00:00:00');
      const h = Date.parse(hi + 'T00:00:00');
      const v = Math.min(h, Math.max(l, t));
      return new Date(v).toISOString().slice(0, 10);
    };
    li.startDate = clamp(startISO, order.startDate, order.endDate);
    li.endDate = clamp(endISO, li.startDate, order.endDate);
    if (Date.parse(li.endDate + 'T00:00:00') < Date.parse(li.startDate + 'T00:00:00')) {
      li.endDate = li.startDate;
    }
    this.save();
  }

  /**
   * Quantity booked on a line — how many units of the resource this order takes.
   * Only meaningful for multi-unit resources (consumables, bulk, stock, kits),
   * and why the scheduler lets you type one: 24 jugs of hydraulic fluid can go out
   * on two orders without clashing. Not clamped to the item's capacity — the
   * conflicts pane is what flags over-asking (capacity-aware, see the scheduler).
   */
  updateOrderLineQty(orderId: string, lineId: string, qty: number): void {
    const order = this.getOrder(orderId);
    const li = order?.lineItems.find((l) => l.id === lineId);
    if (!li) return;
    li.qty = Math.max(1, Math.round(qty) || 1);
    this.save();
  }

  /** Resize an order window; clamps all its line windows to stay inside. */
  updateOrderDates(orderId: string, startISO: string, endISO: string): void {
    const order = this.getOrder(orderId);
    if (!order) return;
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const s = Date.parse(startISO + 'T00:00:00');
    let e = Date.parse(endISO + 'T00:00:00');
    if (e < s) e = s;
    order.startDate = iso(s);
    order.endDate = iso(e);
    for (const li of order.lineItems) {
      const ls = Date.parse((li.startDate ?? order.startDate) + 'T00:00:00');
      let le = Date.parse((li.endDate ?? order.endDate) + 'T00:00:00');
      const clampedS = Math.max(s, Math.min(e, ls));
      le = Math.min(e, Math.max(clampedS, le));
      li.startDate = iso(clampedS);
      li.endDate = iso(le);
    }
    this.save();
  }

  /** Minutes-of-day window (defaults 08:00–17:00). */
  orderT0(order: Order): number {
    return order.t0 ?? 480;
  }

  orderT1(order: Order): number {
    return order.t1 ?? 1020;
  }

  /** Resize the order's time-of-day window in Day view. */
  updateOrderTimes(orderId: string, t0: number, t1: number): void {
    const order = this.getOrder(orderId);
    if (!order) return;
    order.t0 = Math.max(0, Math.min(1440, Math.round(t0 / 15) * 15));
    order.t1 = Math.max(0, Math.min(1440, Math.round(t1 / 15) * 15));
    if (order.t1 < order.t0) order.t1 = order.t0;
    this.save();
  }

  /** Resize a line's time-of-day window, clamped inside the order's window. */
  updateOrderLineTimes(orderId: string, lineId: string, t0: number, t1: number): void {
    const order = this.getOrder(orderId);
    const li = order?.lineItems.find((l) => l.id === lineId);
    if (!order || !li) return;
    const lo = this.orderT0(order);
    const hi = this.orderT1(order);
    li.t0 = Math.max(lo, Math.min(hi, Math.round(t0 / 15) * 15));
    li.t1 = Math.max(lo, Math.min(hi, Math.round(t1 / 15) * 15));
    if (li.t1 < li.t0) li.t1 = li.t0;
    this.save();
  }

  /** Whole days spanned by an order window (inclusive). */
  orderDays(order: Order): number {
    return daysBetween(order.startDate, order.endDate);
  }

  /**
   * The day a booking starts: the line's own window when it has one, else the
   * order's. It is the date a price card is read on — the day the rate was agreed
   * for, not the day the screen happens to be open.
   */
  lineStart(li: OrderLine, order: Order): string {
    return li.startDate ?? order.startDate;
  }

  /** The day a booking ends: the line's own window when it has one, else the order's. */
  lineEnd(li: OrderLine, order: Order): string {
    return li.endDate ?? order.endDate;
  }

  /**
   * The length of a booking in whole days (prototype `liDays`). A line can be
   * booked for less than the order it rides on — a machine that leaves a week
   * after the crew does — and *that* is the count the rate basis steps up on:
   * a 3-day line inside a 21-day order bills the daily rate, not three weeks.
   */
  lineDays(li: OrderLine, order: Order): number {
    return daysBetween(this.lineStart(li, order), this.lineEnd(li, order));
  }

  /** Billable days honouring a line's weekend policy (prototype `billableDays`). */
  billableDays(order: Order, li: OrderLine): number {
    return billableDaysBetween(li.weekendPolicy, this.lineStart(li, order), this.lineEnd(li, order));
  }

  /**
   * Gross amount for an order: the sum of its lines' `lineTotal()` — so the
   * per-booking rows in Order Details always add up to the Gross above them.
   */
  orderAmount(order: Order): number {
    return round2(order.lineItems.reduce((sum, li) => sum + this.lineTotal(li, order), 0));
  }

  /**
   * Gross billable revenue for **one line** — a port of the prototype's
   * `computeLineTotal()`, and the number Order Details prints under a booking.
   * Order-line pricing *policy* (flat totals, unit prices) still isn't in the
   * ported `OrderLine`, so this is the rates path: the customer's **price card**
   * where it names the item (`cardRateFor`, A11), the catalog otherwise — and the
   * rate is applied by type:
   *  - labor / consumable / part bill **once** (negotiated unit price, else the
   *    catalog's hourly billable / retail / cost price),
   *  - kit + attachment bill their daily rate x billable days,
   *  - serialized + bulk step up to the weekly (`ceil(days / 7)`) and monthly
   *    (`ceil(days / 28)`) basis at 7 and 28 days, on the **line's own** days
   *    (`lineDays()`) — the same count `rateBasis()` steps on and the same one the
   *    invoice bills whole units of,
   *  - the risk premium scales everything except the one-time types.
   * `lineAmountForPeriod()` is the *invoicing* sibling (whole units per billing
   * cycle); this one is the whole-booking figure the scheduler and the queues show.
   */
  lineTotal(li: OrderLine, order: Order): number {
    const item = this.getItem(li.type, li.refId);
    if (!item) return 0;
    const qty = li.qty || 1;
    const premium = this.db.settings.pricing.riskPremiums[li.riskPremium ?? 'standard'] ?? 0;
    const days = this.lineDays(li, order);
    // The card is read on the day the booking starts, so a later renewal prices
    // the contracts that start under it and leaves the earlier ones alone.
    const rates = this.cardRateFor(order.partyId, item, this.lineStart(li, order));
    if (li.type === 'labor' || li.type === 'consumable' || li.type === 'part') {
      return round2(qty * (rates.unitPrice ?? rates.rateDaily));
    }
    if (li.type === 'kit' || li.type === 'attachment') {
      return round2(rates.rateDaily * qty * this.billableDays(order, li) * (1 + premium));
    }
    const perUnit =
      days >= 28 && rates.baseMonthly
        ? rates.baseMonthly * Math.ceil(days / 28)
        : days >= 7 && rates.baseWeekly
          ? rates.baseWeekly * Math.ceil(days / 7)
          : rates.rateDaily * this.billableDays(order, li);
    return round2(perUnit * qty * (1 + premium));
  }


  /* -------------------------------- items ------------------------------- */

  listItems(type: CatalogType): Item[] {
    return [...(this.db.items[type] ?? [])];
  }

  allItems(): Item[] {
    const out: Item[] = [];
    for (const t of CATALOG_TYPE_KEYS) out.push(...(this.db.items[t] ?? []));
    return out;
  }

  getItem(type: CatalogType, id: string): Item | undefined {
    return (this.db.items[type] ?? []).find((i) => i.id === id);
  }

  /** Create a catalog row (no persist) — `createItem` and receipts share it. */
  private addItemRow(type: CatalogType, data: Omit<Item, 'type' | 'id'>): Item {
    const rec: Item = { ...data, type, id: this.nextItemId(type) };
    (this.db.items[type] ??= []).push(rec);
    return rec;
  }

  createItem(type: CatalogType, data: Omit<Item, 'type' | 'id'>): Item {
    const rec = this.addItemRow(type, data);
    // A *new* counted row arrives with an opening balance, and an opening
    // balance is a placed quantity: the form's place + count become its first
    // level row (see `openStock`). Nothing else about the row's totals is stored.
    if (isCountedStock(type)) this.openStock(rec);
    this.save();
    return rec;
  }

  /**
   * The stock a brand-new counted row starts with: the editor's opening count at
   * the editor's place, as one level row (and no movement — an opening balance is
   * not something anyone *did*; the fixture's own stock is placed the same way).
   * A row created without a place, or with a zero count, simply holds nothing yet.
   */
  private openStock(item: Item): void {
    const qty = Math.floor(Number(item.qtyOnHand ?? item.qtyAvailable ?? item.qty ?? 0));
    const place = item.locationId;
    if (qty > 0 && place && this.getLocation(place)) this.writeLevel(item.type, item.id, place, qty);
    this.syncStockTotals(item);
  }

  /**
   * Patch a row. Counted stock's quantities and place are **not** patchable: they
   * are the level table's sum and its busiest holding (see `StockLevel`), and a
   * field edit that changed them would leave stock no document and no movement
   * accounts for. `moveStock` / `adjustStock` are the write paths for a place and
   * a count, and `receiveAgainst` is the only way stock arrives.
   */
  updateItem(type: CatalogType, id: string, patch: Partial<Item>): void {
    const it = this.getItem(type, id);
    if (it) {
      const next: Record<string, unknown> = { ...patch };
      if (isCountedStock(type)) for (const k of DERIVED_STOCK_KEYS) delete next[k];
      Object.assign(it, next, { type });
      this.save();
    }
  }

  removeItem(type: CatalogType, id: string): void {
    const list = this.db.items[type];
    if (!list) return;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) {
      list.splice(i, 1);
      // A level row points at the item it belongs to, so it goes with it — the
      // FK's `ON DELETE CASCADE`, and nothing is left holding orphaned shelves.
      this.db.stockLevels = this.db.stockLevels.filter((l) => !(l.type === type && l.refId === id));
      this.save();
    }
  }

  /** Display label for a catalog item (prototype `itemLabel`). */
  itemLabel(type: CatalogType, id: string): string {
    const it = this.getItem(type, id);
    return it ? `${it.id} · ${it.name}` : id;
  }

  /**
   * Units of an item that can be committed at once — the cap the scheduler's
   * conflict rule measures overlapping bookings against, and the number the
   * drop-to-book quantity prompt offers. Field-per-type, mirroring the prototype's
   * `resourceCapacity()`: bulk counts what is *owned* (`totalOwned`, not the
   * out-snapshot `qtyAvailable`), stock counts `qtyOnHand`, a kit / attachment its
   * owned count (`qty`), and a serialized unit or an employee is 1. Never below 1,
   * so a single-unit item keeps the old "any overlap is a clash" behaviour.
   */
  capacity(item: Item): number {
    const n =
      item.type === 'bulk'
        ? item.totalOwned ?? item.qty
        : item.type === 'consumable' || item.type === 'part'
          ? item.qtyOnHand ?? item.qty
          : item.qty;
    return Math.max(1, Number.isFinite(n) ? Math.round(n) : 1);
  }

  /** Short "make model" / name used in selects (prototype `mkName`). */
  mkName(item: Item | undefined): string {
    if (!item) return '';
    return [item.make, item.model].filter(Boolean).join(' ') || item.name;
  }

  /** Name for a labor employee id. */
  empName(empId: string): string {
    const e = this.getItem('labor', empId);
    return e ? e.name : empId;
  }

  /** CDL-certified drivers (prototype logistics driver options). */
  cdlDrivers(): Item[] {
    return this.listItems('labor').filter((e) => (e.certs ?? []).some((c) => c.includes('CDL')));
  }

  /** Low-stock consumables + parts (prototype dashboard reorder warnings). */
  reorders(): { type: CatalogType; ref: string; label: string; qtyOnHand: number; reorderPoint: number }[] {
    const rows: { type: CatalogType; ref: string; label: string; qtyOnHand: number; reorderPoint: number }[] = [];
    for (const type of ['consumable', 'part'] as CatalogType[]) {
      for (const it of this.listItems(type)) {
        if (needsReorder(it)) {
          rows.push({
            type,
            ref: it.id,
            label: it.name,
            qtyOnHand: it.qtyOnHand ?? it.qty,
            reorderPoint: it.reorderPoint ?? 0,
          });
        }
      }
    }
    return rows;
  }

  /** Count of items at/below their reorder point (dashboard badge). */
  reorderCount(): number {
    return this.reorders().length;
  }

  /**
   * Raise a draft purchase order for a stock row that has fallen to its reorder
   * point — what the dashboard's reorder panel does with one click.
   *
   * The prototype's `triggerReorder` set `qtyOnHand` to twice the reorder point
   * and left a number nothing backs (exactly the bug A5 exists to kill). A
   * reorder is a *document*: this creates it as a **draft** with one line — the
   * catalogue row, the shortfall up to twice the reorder point, the row's current
   * cost — and stops there.
   *
   * It deliberately names **no supplier**: whose stock to buy is the buyer's call,
   * and the Purchasing page's editor refuses to save a PO without one. Stock still
   * arrives only through `receiveAgainst()` on that order, so the one-click path
   * and the ledger agree.
   */
  raiseReorder(type: CatalogType, ref: string): PurchaseOrder | null {
    const it = this.getItem(type, ref);
    if (!it || !isPurchasable(type)) return null;
    const target = Math.max((it.reorderPoint ?? 0) * 2, 1);
    const shortfall = Math.max(target - this.countedQty(it), 1);
    const today = dISO(new Date());
    return this.createPurchaseOrder({
      supplierId: '',
      status: 'draft',
      orderedAt: today,
      expectedAt: today,
      reference: '',
      notes: `Raised from the reorder warning (${it.id} at ${this.countedQty(it)} / @${it.reorderPoint ?? 0}).`,
      lines: [
        {
          id: '',
          type,
          refId: it.id,
          description: it.name,
          qty: shortfall,
          unitCost: it.costPrice ?? it.purchaseValue ?? 0,
        },
      ],
    });
  }

  private static readonly ID_PREFIX: Record<CatalogType, string> = {
    serialized: 'IT-',
    bulk: 'BLK-',
    consumable: 'CN-',
    part: 'PRT-',
    labor: 'EMP-',
    kit: 'KIT-',
    attachment: 'ACC-',
  };

  private nextItemId(type: CatalogType): string {
    const prefix = DataService.ID_PREFIX[type];
    const list = this.db.items[type] ?? [];
    let max = 0;
    for (const it of list) {
      const m = it.id.match(/-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return prefix + String(max + 1).padStart(3, '0');
  }

  /* ----------------------------- categories ----------------------------- */

  /** Live, mutable per-type category records, seeded for every type. */
  get categories(): Record<string, CategoryOption[]> {
    return this.db.settings.categories;
  }

  /** Category records for a type (Categories grid). */
  categoryRecordsFor(type: CatalogType): CategoryOption[] {
    return [...(this.db.settings.categories[type] ?? [])];
  }

  /** Active category names for a type — what item pickers offer. */
  categoriesFor(type: CatalogType): string[] {
    return (this.db.settings.categories[type] ?? [])
      .filter((c) => c.active !== false)
      .map((c) => c.name);
  }

  /** Item count in a category (Categories grid "Items" column). */
  categoryCount(type: CatalogType, name: string): number {
    return this.listItems(type).filter((i) => i.category === name).length;
  }

  addCategory(type: CatalogType, name: string, active = true): void {
    const list = (this.db.settings.categories[type] ??= []);
    const clean = name.trim();
    if (!clean || list.some((c) => c.name === clean)) return;
    list.push({ name: clean, active });
    this.save();
  }

  renameCategory(type: CatalogType, oldName: string, newName: string, active = true): void {
    const list = this.db.settings.categories[type];
    const clean = newName.trim();
    if (!list || !clean) return;
    const rec = list.find((c) => c.name === oldName);
    if (!rec || list.some((c) => c.name === clean && c.name !== oldName)) return;
    rec.name = clean;
    rec.active = active;
    // Keep items in the renamed category consistent (prototype `renameRecords`).
    for (const it of this.db.items[type] ?? []) {
      if (it.category === oldName) it.category = clean;
    }
    this.save();
  }

  removeCategory(type: CatalogType, name: string): void {
    const list = this.db.settings.categories[type];
    if (!list) return;
    const i = list.findIndex((c) => c.name === name);
    if (i >= 0) {
      list.splice(i, 1);
      this.save();
    }
  }

  /** Ensure every catalog type has a (possibly empty) category table. */
  ensureCategoryTables(): void {
    for (const t of CATALOG_TYPE_KEYS) {
      this.db.settings.categories[t] ??= [];
    }
    this.save();
  }


  /* ------------------------------ locations ----------------------------- */

  /** Locations in insertion order (the view assembles the tree by `parentId`). */
  listLocations(): Location[] {
    return [...this.db.settings.locations];
  }

  getLocation(id: string): Location | undefined {
    return this.db.settings.locations.find((x) => x.id === id);
  }

  /** Direct children of a location (null/undefined parent = top level). */
  locationChildren(parentId: string | null | undefined): Location[] {
    const key = parentId ?? null;
    return this.db.settings.locations.filter((l) => (l.parentId ?? null) === key);
  }

  /** Number of locations sitting directly under a location. */
  locationChildCount(id: string): number {
    return this.db.settings.locations.filter((l) => l.parentId === id).length;
  }

  createLocation(data: Omit<Location, 'id'> & { id?: string }): Location {
    const rec: Location = { ...data, id: data.id ?? this.nextLocationId() };
    this.db.settings.locations.push(rec);
    this.save();
    return rec;
  }

  /**
   * Patch a location. Re-parenting is guarded so the ragged hierarchy can
   * never form a cycle: a location may not become its own ancestor.
   */
  updateLocation(id: string, patch: Partial<Location>): void {
    const loc = this.db.settings.locations.find((x) => x.id === id);
    if (!loc) return;
    const next: Partial<Location> = { ...patch };
    if (next.parentId && this.isLocationAncestor(next.parentId, id)) {
      delete next.parentId; // refuse the move — would create a cycle
    }
    Object.assign(loc, next);
    this.save();
  }

  /**
   * Why a location cannot be removed right now — empty when it can. The grid
   * asks this for the button's tooltip and `removeLocation` asks it before
   * acting, so the message and the guard can never disagree. Both reasons are
   * "a stored FK points at this row and only a person can decide what to do
   * about it".
   */
  locationRemovalBlockers(id: string): string[] {
    const out: string[] = [];
    const items = this.locationItemCount(id);
    if (items > 0) out.push(`${items} item(s) stored here`);
    const moves = this.locationMovementCount(id);
    // History is append-only: a logged movement can never be re-pointed at
    // another location, so a place the ledger mentions has to stay (deactivate
    // it instead if the yard is closing).
    if (moves > 0) out.push(`${moves} movement(s) logged here`);
    return out;
  }

  /**
   * Remove a location. Refused (`false`) while stock is stored *at* it or the
   * ledger records a movement there: those rows point at this row, and clearing
   * or re-pointing them silently is a data decision the grid must not take on
   * the user's behalf — the same rule `removeLocationType` applies while a type
   * is in use. Callers disable the action (see `locationRemovalBlockers`) or
   * abort on `false`.
   *
   * On success its children are re-parented to the removed node's own parent
   * (move up one level) so the hierarchy stays intact and nothing is orphaned —
   * the adjacency-list equivalent of re-pointing the child rows' `parent_id` at
   * the deleted node's parent. Items stored in those children keep a valid FK.
   */
  removeLocation(id: string): boolean {
    const i = this.db.settings.locations.findIndex((x) => x.id === id);
    if (i < 0) return false;
    if (this.locationRemovalBlockers(id).length > 0) return false;
    const [removed] = this.db.settings.locations.splice(i, 1);
    const up = removed.parentId ?? null;
    for (const child of this.db.settings.locations) {
      if (child.parentId === id) child.parentId = up;
    }
    this.save();
    return true;
  }

  /** True when `candidateId` is `ofId` or sits anywhere beneath it (cycle guard). */
  isLocationAncestor(candidateId: string, ofId: string): boolean {
    const seen = new Set<string>();
    let cur: string | null | undefined = candidateId;
    while (cur) {
      if (cur === ofId) return true;
      if (seen.has(cur)) return false; // defensive: pre-existing cycle
      seen.add(cur);
      cur = this.getLocation(cur)?.parentId ?? null;
    }
    return false;
  }

  private nextLocationId(): string {
    let max = 0;
    for (const l of this.db.settings.locations) {
      const m = l.id.match(/-(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
    return 'LOC-' + String(max + 1).padStart(2, '0');
  }

  /** The id `createLocation` will assign next — for read-only modal previews. */
  previewLocationId(): string {
    return this.nextLocationId();
  }

  /* --------------------------- placement (items) ------------------------- */
  /*
   * An item's place is one FK (`Item.locationId`) into the hierarchy above, so
   * "where is this?" and "what is here?" are one join — the shape the API needs
   * (`items.location_id → locations.id`), and the reason the prototype's
   * free-text `bin` was folded into the tree instead of kept beside it.
   */

  /** Display name of an item's location, for a table cell ('—' when unplaced). */
  locationLabel(id: string | null | undefined): string {
    return id ? this.getLocation(id)?.name ?? id : '—';
  }

  /**
   * Full path of a location: `Warehouse 1 › Aisle 1 › Bay A1-03`. Built at read
   * time from the parent links, so re-parenting a node re-reads correctly and no
   * row has to store a copy of the path.
   */
  locationPath(id: string | null | undefined): string {
    if (!id) return '—';
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: string | null | undefined = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const loc = this.getLocation(cur);
      if (!loc) {
        names.unshift(cur); // FK with no row (should not happen — see the guard)
        break;
      }
      names.unshift(loc.name);
      cur = loc.parentId ?? null;
    }
    return names.join(' › ');
  }

  /**
   * The hierarchy flattened depth-first as picker options (indented by depth) —
   * every location picker in the app reads this one walk, so the editor, the
   * items page and anything later agree on order and labels.
   *
   * `exceptId` drops a node *and its descendants* (cycle guard for the location
   * editor). Orphaned nodes are surfaced flat rather than hidden.
   */
  locationOptions(exceptId?: string | null): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    const visited = new Set<string>();
    const excluded = (id: string) => !!exceptId && this.isLocationAncestor(id, exceptId);
    const walk = (parentId: string | null, depth: number): void => {
      for (const loc of this.locationChildren(parentId)) {
        if (visited.has(loc.id) || excluded(loc.id)) continue;
        visited.add(loc.id);
        out.push({ id: loc.id, label: '— '.repeat(depth) + `${loc.name} (${loc.id})` });
        walk(loc.id, depth + 1);
      }
    };
    walk(null, 0);
    for (const loc of this.listLocations()) {
      if (!visited.has(loc.id) && !excluded(loc.id)) out.push({ id: loc.id, label: `${loc.name} (${loc.id})` });
    }
    return out;
  }

  /** A location plus every node beneath it (cycle-guarded). */
  locationSubtreeIds(id: string): Set<string> {
    const out = new Set<string>([id]);
    const walk = (parentId: string): void => {
      for (const loc of this.locationChildren(parentId)) {
        if (out.has(loc.id)) continue;
        out.add(loc.id);
        walk(loc.id);
      }
    };
    walk(id);
    return out;
  }

  /**
   * Rows holding stock in this location. Stock is not *at* a site — it is at a
   * bay under it — so `subtree` is what a location-scoped view asks for, while
   * the removal guard asks the narrower question below.
   *
   * The question is answered from `placements()`, not from a field: a counted
   * row can be in several places at once, so "what is here?" reads its level
   * rows (a row with stock in this bin *and* another is here in both) while a
   * unit keeps its single `locationId`.
   */
  itemsAtLocation(locationId: string, subtree = false): Item[] {
    const ids = subtree ? this.locationSubtreeIds(locationId) : new Set<string>([locationId]);
    return this.allItems().filter((i) => this.placements(i).some((p) => ids.has(p.locationId)));
  }

  /** Items stored *at* this node — the number that blocks its removal. */
  locationItemCount(id: string): number {
    return this.itemsAtLocation(id).length;
  }

  /** Items at this node or anywhere under it (Locations grid and tooltips). */
  locationSubtreeItemCount(id: string): number {
    return this.itemsAtLocation(id, true).length;
  }

  /**
   * How much stock sits at this node — the *quantity*, where the readers above
   * count rows. A bin holding a hundred bolts is one item and a hundred units,
   * and a locations grid has room for both facts.
   */
  locationStockQty(id: string, subtree = false): number {
    const ids = subtree ? this.locationSubtreeIds(id) : new Set<string>([id]);
    return this.itemsAtLocation(id, subtree).reduce(
      (sum, i) => sum + this.placements(i).reduce((n, p) => n + (ids.has(p.locationId) ? p.qty : 0), 0),
      0,
    );
  }

  /* ---------------------------- stock levels ---------------------------- */
  /*
   * The quantities of a counted row, per place (see `StockLevel`). One writer —
   * `writeLevel()` — and one deriver — `syncStockTotals()` — so the level table
   * and the row's totals can never drift: every path that moves counted stock
   * (a receipt landing it, a move, a count, a new row's opening balance) pays
   * the same two calls, and a caller that forgot would leave a row whose
   * `qtyOnHand` its shelves don't add up to.
   */

  /** The composite key of a level row (`<item>@<place>`). */
  private levelId(refId: string, locationId: string): string {
    return `${refId}@${locationId}`;
  }

  /**
   * Every level row, optionally narrowed to one row or one place. This is the
   * table read as a table — the query a stock report runs ("what is in this bay?",
   * "where is this part?") without going through an item first.
   */
  listStockLevels(refId?: string, locationId?: string): StockLevel[] {
    return this.db.stockLevels.filter(
      (l) => (refId === undefined || l.refId === refId) && (locationId === undefined || l.locationId === locationId),
    );
  }

  /**
   * Where a row's stock is, as (place, quantity) pairs — the level rows for
   * counted stock, or the row's one `locationId` for everything else. This is
   * the read every "what is where?" question goes through, so a grid, a
   * receipt's default destination and a location scope all agree.
   */
  placements(item: Item): { locationId: string; qty: number }[] {
    if (isCountedStock(item.type)) {
      return this.db.stockLevels
        .filter((l) => l.type === item.type && l.refId === item.id)
        .sort((a, b) => b.qty - a.qty || (a.locationId < b.locationId ? -1 : 1))
        .map((l) => ({ locationId: l.locationId, qty: l.qty }));
    }
    if (item.type === 'labor' || !item.locationId) return [];
    return [{ locationId: item.locationId, qty: this.countedQty(item) }];
  }

  /** How much of a row sits at one place (0 when it holds none of it there). */
  stockAt(item: Item, locationId: string): number {
    return this.placements(item).find((p) => p.locationId === locationId)?.qty ?? 0;
  }

  /** Everything a row holds, wherever it is (its level rows' sum). */
  stockTotal(item: Item): number {
    return this.placements(item).reduce((sum, p) => sum + p.qty, 0);
  }

  /**
   * The place a row's stock mostly sits — its *home*, and what `Item.locationId`
   * means for counted stock. Biggest holding first, ties broken by location id,
   * so the read is deterministic rather than "whichever row came first".
   */
  homePlace(item: Item): string | undefined {
    return this.placements(item)[0]?.locationId;
  }

  /** A grid cell's version of the placement: the busiest place, plus a count. */
  placeLabel(item: Item | undefined): string {
    const places = item ? this.placements(item) : [];
    if (!places.length) return this.locationLabel(undefined);
    const head = this.locationLabel(places[0].locationId);
    return places.length > 1 ? `${head} +${places.length - 1} more` : head;
  }

  /** The full placement, place by place — the viewer's and tips' wording. */
  placeBreakdown(item: Item | undefined): string {
    const places = item ? this.placements(item) : [];
    if (!places.length) return this.locationPath(undefined);
    return places.map((p) => `${this.locationPath(p.locationId)}: ${p.qty}`).join(' · ');
  }

  /** Write a level row: `qty <= 0` *removes* it (a level exists only while it holds stock). */
  private writeLevel(type: CatalogType, refId: string, locationId: string, qty: number): void {
    const n = Math.floor(Number(qty));
    const i = this.db.stockLevels.findIndex((l) => l.type === type && l.refId === refId && l.locationId === locationId);
    if (!Number.isFinite(n) || n <= 0) {
      if (i >= 0) this.db.stockLevels.splice(i, 1);
      return;
    }
    if (i >= 0) this.db.stockLevels[i].qty = n;
    else this.db.stockLevels.push({ id: this.levelId(refId, locationId), type, refId, locationId, qty: n });
  }

  /**
   * Recompute what a counted row *is* from its level rows, and point its
   * `locationId` at the busiest of them. Called after every level write and
   * never by hand: `qtyOnHand` is this table's sum, and the moment it isn't, the
   * app has two numbers for one shelf.
   */
  private syncStockTotals(item: Item): void {
    if (!isCountedStock(item.type)) return;
    const total = this.db.stockLevels
      .filter((l) => l.type === item.type && l.refId === item.id)
      .reduce((sum, l) => sum + l.qty, 0);
    if (item.type === 'bulk') {
      item.qtyAvailable = total;
      item.totalOwned = total + (item.qtyOut ?? 0);
      item.qty = total;
    } else {
      item.qtyOnHand = total;
      item.qty = total;
    }
    item.locationId = this.homePlace(item);
  }

  /* ------------------------ placement (movements) ------------------------ */
  /*
   * The ledger's place is the same FK as the shelf's (`Movement.locationId`), so
   * the two can be joined: "what is here?" reads the units, "what happened here?"
   * reads the log. A movement is a *past* fact, so it never moves with a unit —
   * that is what makes the log immutable.
   */

  /**
   * Movements recorded at a location. `subtree` is the default here (unlike the
   * item reader), because a movement is logged at the *node* it happened at
   * rather than at a shelf: asking about a yard means asking about its zones.
   */
  movementsAtLocation(locationId: string, subtree = true): Movement[] {
    const ids = subtree ? this.locationSubtreeIds(locationId) : new Set<string>([locationId]);
    return this.db.movements.filter((m) => !!m.locationId && ids.has(m.locationId));
  }

  /** Movements logged *at* this node — the number that blocks its removal. */
  locationMovementCount(id: string): number {
    return this.movementsAtLocation(id, false).length;
  }

  /** Movements at this node or anywhere under it (Locations grid and tips). */
  locationSubtreeMovementCount(id: string): number {
    return this.movementsAtLocation(id, true).length;
  }

  /* --------------------------- location types --------------------------- */

  /** All location types (Locations → Location Types grid). */
  locationTypeRecords(): LocationType[] {
    return [...this.db.settings.locationTypes];
  }

  /** Active location type names — what the location editor offers. */
  activeLocationTypes(): string[] {
    return this.db.settings.locationTypes.filter((t) => t.active !== false).map((t) => t.name);
  }

  /** Location count using a type (Location Types grid "Locations" column). */
  locationTypeCount(name: string): number {
    return this.db.settings.locations.filter((l) => l.type === name).length;
  }

  addLocationType(name: string, active = true): void {
    const clean = name.trim();
    if (!clean || this.db.settings.locationTypes.some((t) => t.name === clean)) return;
    this.db.settings.locationTypes.push({ name: clean, active });
    this.save();
  }

  /** Rename a type, keeping every location that uses it consistent. */
  renameLocationType(oldName: string, newName: string, active = true): void {
    const clean = newName.trim();
    if (!clean) return;
    const rec = this.db.settings.locationTypes.find((t) => t.name === oldName);
    if (!rec || this.db.settings.locationTypes.some((t) => t.name === clean && t.name !== oldName)) return;
    rec.name = clean;
    rec.active = active;
    for (const l of this.db.settings.locations) {
      if (l.type === oldName) l.type = clean;
    }
    this.save();
  }

  /** Remove a type when no location uses it. Returns false while still in use. */
  removeLocationType(name: string): boolean {
    if (this.locationTypeCount(name) > 0) return false;
    const i = this.db.settings.locationTypes.findIndex((t) => t.name === name);
    if (i < 0) return false;
    this.db.settings.locationTypes.splice(i, 1);
    this.save();
    return true;
  }

  /* ----------------------------- movements ------------------------------ */

  listMovements(): Movement[] {
    return [...this.db.movements].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /**
   * Append an immutable movement + (for serialized items) flip custody status.
   *
   * The movement's *place* is resolved here, once, so no caller can log a
   * movement at a location the unit was never at:
   *
   * - an **issue** leaves from where the unit sits (its own `locationId`) unless
   *   the caller knows better;
   * - a **return** comes back to the place the caller picked (`locationId`), and
   *   that place *becomes* the unit's placement — a return is a re-homing, and
   *   the shelf and the ledger must not disagree about where it is.
   */
  logMovement(input: MovementInput): Movement {
    const rec = this.appendMovement(input);
    this.applyCustody(rec);
    this.save();
    return rec;
  }

  /**
   * Shape a movement and push it without persisting — the one place a ledger row
   * is built, so `logMovement` and the receipt posting can't drift apart (a
   * posting writes several movements and persists once).
   */
  private appendMovement(input: MovementInput): Movement {
    const item = this.getItem(input.type, input.refId);
    const rec: Movement = {
      id: this.nextMovementId(),
      type: input.type,
      refId: input.refId,
      kind: input.kind,
      qty: input.qty,
      orderId: input.orderId ?? null,
      party: input.party ?? '',
      locationId: input.locationId || item?.locationId || undefined,
      receiptId: input.receiptId ?? null,
      at: input.at ?? new Date().toISOString(),
      byUserId: input.byUserId ?? this.sessionUserId(),
      note: input.note ?? '',
    };
    this.db.movements.push(rec);
    return rec;
  }

  /**
   * Custody follows the ledger for serialized units only: an issue rents a unit
   * out, a return frees it and re-places it. The other kinds (receive, transfer,
   * adjust) record a fact about stock without moving custody — a receipt creates
   * its units already `Available`, so it has nothing to flip.
   */
  private applyCustody(rec: Movement): void {
    if (rec.type !== 'serialized') return;
    const item = this.getItem('serialized', rec.refId);
    if (!item) return;
    if (rec.kind === 'issue') {
      item.status = 'On Rent';
      item.orderId = rec.orderId ?? null;
    } else if (rec.kind === 'return') {
      item.status = 'Available';
      item.orderId = null;
      if (rec.locationId) item.locationId = rec.locationId;
    }
  }

  /** Latest movement for a serialized asset (prototype `hoLatest`). */
  latestMovement(itemId: string): Movement | undefined {
    return this.db.movements
      .filter((m) => m.type === 'serialized' && m.refId === itemId)
      .slice(-1)[0];
  }

  /** Serialized items currently out (On Rent) — active custody. */
  custodyItems(): Item[] {
    return this.listItems('serialized').filter((i) => this.isOut(i.id));
  }

  /** Serialized items free to issue. */
  availableItems(): Item[] {
    return this.listItems('serialized').filter((i) => !this.isOut(i.id));
  }

  /**
   * The ledger for one row, newest first — what the Assets page shows under a
   * record so a count correction or a move can be read back where it was made.
   */
  movementsFor(type: CatalogType, refId: string): Movement[] {
    return this.listMovements().filter((m) => m.type === type && m.refId === refId);
  }

  /**
   * Move stock from one place to another: the shelf and the ledger move
   * together, and *what* moves is a quantity at a place rather than always the
   * whole row (a part can be stocked in two bins — see `StockLevel`).
   *
   * A placement change by hand leaves no trace, so this is the action that
   * *logs* a `transfer`. What it refuses is as deliberate as what it does:
   *
   * - **Labor is a person**, not stock (`isPurchasable`), so it has no place to
   *   move from.
   * - **A unit that is out on rent** is not on a shelf; its place changes when it
   *   comes back (the `return` movement re-homes it), so a transfer now would
   *   record a shelf it isn't on.
   * - **The source must actually hold that much.** You can move what is there
   *   (a quantity up to the whole holding), never invent it: an unknown place, a
   *   place holding none of this row, a zero/negative quantity and a quantity
   *   larger than the place holds are all refused, writing nothing.
   * - **The destination must be a real, *different* place** — a no-op is refused
   *   rather than logged as a movement.
   *
   * A unit-held row (serialized, kit, attachment) sits in one place with one
   * count, so its `qty` must be exactly the whole row: moving a kit's stock
   * *partly* would leave half a kit somewhere, which the model can't express.
   */
  moveStock(
    type: CatalogType,
    id: string,
    fromLocationId: string,
    toLocationId: string,
    qty: number,
    note = '',
  ): Movement | null {
    const item = this.getItem(type, id);
    if (!item || !isPurchasable(type)) return null;
    if (!this.getLocation(fromLocationId) || !this.getLocation(toLocationId)) return null;
    if (fromLocationId === toLocationId) return null;
    if (type === 'serialized' && this.isOut(id)) return null;
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n <= 0) return null;

    const held = this.stockAt(item, fromLocationId);
    if (held <= 0 || n > held) return null;

    if (isCountedStock(type)) {
      // The two level writes, then the totals they imply: the source keeps what
      // it didn't send, the destination gains it, and an emptied place loses its
      // row (see `writeLevel`).
      this.writeLevel(type, id, fromLocationId, held - n);
      this.writeLevel(type, id, toLocationId, this.stockAt(item, toLocationId) + n);
      this.syncStockTotals(item);
    } else {
      // One place, one count: only the whole row can move, and the FK *is* the
      // placement — there is no level row to move.
      if (n !== held) return null;
      item.locationId = toLocationId;
    }

    // A transfer is logged at the destination: the movement says where the stock
    // is *now*, and the shelf above agrees with it. Where it came from is a
    // readable note (the previous place may be deleted later; the movement it
    // moved through survives either way).
    const rec = this.appendMovement({
      type,
      refId: id,
      kind: 'transfer',
      qty: n,
      locationId: toLocationId,
      note: note || `Moved from ${this.locationPath(fromLocationId)}`,
    });
    this.save();
    return rec;
  }

  /**
   * Correct a count: set what a physical count found *at one place* and log the
   * difference as one signed `adjust` movement (a count that matches writes
   * nothing, because there is nothing to record).
   *
   * The count is per place, like the stock itself: counting Bay A says nothing
   * about Bay B, so this takes the location it was counted at, writes that
   * level (`writeLevel` drops the row when the count is 0) and logs the delta
   * there. Counting a place that holds none of the row yet is how stock found
   * where it wasn't recorded gets in — logged, with an author and an instant,
   * like every other correction.
   *
   * The delta is what the ledger keeps — `+/- n` at the place it happened — so
   * "where did these eight go?" is answerable months later instead of being an
   * edit that overwrote the old number. Status follows the count through
   * `refreshStockStatus()`, so a row can fall to `Low` (or climb out of it) the
   * moment someone counts the shelf rather than only when a receipt arrives.
   */
  adjustStock(
    type: CatalogType,
    id: string,
    locationId: string,
    countedQty: number,
    note = '',
  ): Movement | null {
    const item = this.getItem(type, id);
    if (!item || !isCountedStock(type)) return null;
    if (!this.getLocation(locationId)) return null;
    const counted = Math.floor(Number(countedQty));
    if (!Number.isFinite(counted) || counted < 0) return null;

    const before = this.stockAt(item, locationId);
    const delta = counted - before;
    if (delta === 0) return null;

    this.writeLevel(type, id, locationId, counted);
    this.syncStockTotals(item);
    this.refreshStockStatus(item);
    const rec = this.appendMovement({
      type,
      refId: id,
      kind: 'adjust',
      qty: delta,
      locationId,
      note: note || `Count corrected ${before} → ${counted} at ${this.locationPath(locationId)}`,
    });
    this.save();
    return rec;
  }

  /** Quantity a stock row holds in total, whichever field its type keeps it in. */
  private countedQty(item: Item): number {
    return item.type === 'bulk' ? item.qtyAvailable ?? item.totalOwned ?? item.qty : item.qtyOnHand ?? item.qty;
  }

  /** Keep a stock row's stock status in step with its count. */
  private refreshStockStatus(item: Item): void {
    if (!isCountedStock(item.type)) return;
    if (needsReorder(item)) item.status = 'Low';
    else if (item.status === 'Low') item.status = 'In Stock';
  }

  /** A serialized asset is out while its latest movement is an issue (prototype `assetOutInfo`). */
  isOut(itemId: string): boolean {
    const last = this.latestMovement(itemId);
    return !!last && last.kind === 'issue';
  }

  /** Where a serialized asset currently is (order id / party / yard). */
  outInfo(itemId: string): { orderId: string | null; party: string; at: string } | null {
    if (!this.isOut(itemId)) return null;
    const last = this.latestMovement(itemId)!;
    return { orderId: last.orderId ?? null, party: last.party ?? '', at: last.at };
  }

  private nextMovementId(): string {
    let max = 0;
    for (const m of this.db.movements) {
      const n = Number(String(m.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'MV-' + String(max + 1).padStart(3, '0');
  }

  /* ----------------------------- purchasing ----------------------------- */
  /*
   * The buying side of the spine: **suppliers are parties** (`Party.kinds`, see
   * `supplierParties()`), a purchase order is what was *ordered*, and a
   * **receipt** is the document that makes stock exist.
   *
   * Three rules, all deliberate:
   *
   * 1. A PO stores no copy of what arrived. `poLineReceived()` sums the
   *    receipts, so an order cannot claim stock the ledger doesn't have.
   * 2. A receipt lands real rows: it tops an existing SKU up (moving-average
   *    cost) or creates one row per serialized unit, always at a location FK,
   *    and logs one `receive` movement per landed row.
   * 3. A posted receipt is immutable (no update, no remove): it moved quantities
   *    and placed stock, so it is append-only like a movement.
   */

  listPurchaseOrders(): PurchaseOrder[] {
    return [...this.db.purchaseOrders].sort((a, b) => (a.orderedAt < b.orderedAt ? 1 : -1));
  }

  getPurchaseOrder(id: string): PurchaseOrder | undefined {
    return this.db.purchaseOrders.find((p) => p.id === id);
  }

  /** The ids `createPurchaseOrder` / `receiveAgainst` will assign next. */
  previewPurchaseOrderId(): string {
    return this.nextPurchaseOrderId();
  }

  previewReceiptId(): string {
    return this.nextReceiptId();
  }

  createPurchaseOrder(data: Omit<PurchaseOrder, 'id'>): PurchaseOrder {
    const rec = this.normalizePurchaseOrder({ ...data, id: this.nextPurchaseOrderId() });
    this.db.purchaseOrders.push(rec);
    this.save();
    return rec;
  }

  /**
   * Patch a PO. Stock that already arrived wins over an edit: a line that has
   * received quantity cannot be dropped or shrunk below what came in (the
   * receipt, not the order, is the record of that stock), and a PO that has
   * delivered cannot be cancelled. The order's *lifecycle* status stays the
   * chooser's; progress is always derived (see `poProgress`).
   */
  updatePurchaseOrder(id: string, patch: Partial<PurchaseOrder>): boolean {
    const po = this.getPurchaseOrder(id);
    if (!po) return false;
    const next = this.normalizePurchaseOrder({ ...po, ...patch, id: po.id });
    if (patch.lines) {
      const arrived = new Map(next.lines.map((l) => [l.id, this.poLineReceived(l.id)]));
      next.lines = next.lines.map((l) => ({ ...l, qty: Math.max(l.qty, arrived.get(l.id) ?? 0) }));
      for (const before of po.lines) {
        if (this.poLineReceived(before.id) > 0 && !next.lines.some((l) => l.id === before.id)) {
          next.lines.push(before); // a delivered line can't be deleted
        }
      }
    }
    if (patch.status === 'cancelled' && this.poProgress(po) !== 'none') next.status = po.status;
    Object.assign(po, next);
    this.save();
    return true;
  }

  /** Why a PO can't be removed right now (empty when it can) — grid tooltip. */
  purchaseOrderRemovalBlockers(id: string): string[] {
    const receipts = this.db.receipts.filter((r) => r.poId === id).length;
    return receipts > 0 ? [`${receipts} receipt(s) posted against it`] : [];
  }

  /** Remove a PO. Refused while a receipt points at it (append-only history). */
  removePurchaseOrder(id: string): boolean {
    const i = this.db.purchaseOrders.findIndex((p) => p.id === id);
    if (i < 0 || this.purchaseOrderRemovalBlockers(id).length > 0) return false;
    this.db.purchaseOrders.splice(i, 1);
    this.save();
    return true;
  }

  /** Ordered value of a PO (what the paperwork says it will cost). */
  poValue(po: PurchaseOrder): number {
    return round2(po.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0));
  }

  /** Value of what has actually been received so far. */
  poReceivedValue(po: PurchaseOrder): number {
    return round2(po.lines.reduce((sum, l) => sum + this.poLineReceived(l.id) * l.unitCost, 0));
  }

  /** How much of one line has arrived — summed from the receipts, not stored. */
  poLineReceived(poLineId: string): number {
    let sum = 0;
    for (const r of this.db.receipts) {
      for (const l of r.lines) if (l.poLineId === poLineId) sum += l.qty;
    }
    return sum;
  }

  /** Still to arrive on a line (never negative). */
  poLineOutstanding(line: PurchaseOrderLine): number {
    return Math.max(0, line.qty - this.poLineReceived(line.id));
  }

  /** Delivery progress across the PO — derived, so it can't drift from receipts. */
  poProgress(po: PurchaseOrder): PurchaseProgress {
    if (!po.lines.length) return 'none';
    const arrived = po.lines.map((l) => this.poLineReceived(l.id));
    if (arrived.every((n, i) => n >= po.lines[i].qty)) return 'received';
    return arrived.some((n) => n > 0) ? 'partial' : 'none';
  }

  /** What the grid shows: the lifecycle status unless the receipts say more. */
  poStatusLabel(po: PurchaseOrder): string {
    if (po.status === 'draft') return PO_STATUS_LABEL.draft;
    if (po.status === 'cancelled') return PO_STATUS_LABEL.cancelled;
    return PO_PROGRESS_LABEL[this.poProgress(po)];
  }

  /** Badge class for the status above (the shared `st-*` vocabulary). */
  poStatusClass(po: PurchaseOrder): string {
    if (po.status === 'draft') return 'st-closed';
    if (po.status === 'cancelled') return 'st-out';
    return { none: 'st-on', partial: 'st-reorder', received: 'st-available' }[this.poProgress(po)];
  }

  /** Lines that still have stock to come (the receiving editor's rows). */
  receivableLines(po: PurchaseOrder): { line: PurchaseOrderLine; outstanding: number }[] {
    return po.lines
      .map((line) => ({ line, outstanding: this.poLineOutstanding(line) }))
      .filter((r) => r.outstanding > 0);
  }

  /** Purchase orders placed with a supplier (grid counts / record views). */
  supplierOrderCount(supplierId: string): number {
    return this.db.purchaseOrders.filter((p) => p.supplierId === supplierId).length;
  }

  /** Open POs with a supplier: ordered, and not fully delivered. */
  supplierOpenOrderCount(supplierId: string): number {
    return this.db.purchaseOrders.filter(
      (p) => p.supplierId === supplierId && p.status === 'ordered' && this.poProgress(p) !== 'received',
    ).length;
  }

  /* ------------------------------- receipts ------------------------------ */

  listReceipts(): Receipt[] {
    return [...this.db.receipts].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  getReceipt(id: string): Receipt | undefined {
    return this.db.receipts.find((r) => r.id === id);
  }

  /** How many items one receipt landed (grid cell). */
  receiptQty(r: Receipt): number {
    return r.lines.reduce((sum, l) => sum + l.qty, 0);
  }

  /** What the receipt is worth at the ordered cost (grid cell). */
  receiptValue(r: Receipt): number {
    return round2(r.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0));
  }

  /** Receipts put away at a location — the buying side of the location spine. */
  receiptsAtLocation(locationId: string, subtree = false): Receipt[] {
    const ids = subtree ? this.locationSubtreeIds(locationId) : new Set<string>([locationId]);
    return this.db.receipts.filter((r) => ids.has(r.locationId));
  }

  /**
   * Post a goods receipt — the operation that makes stock exist.
   *
   * Refused (returns `null`, writing nothing) when the order is a draft or
   * cancelled, the destination isn't a real location, nothing positive was asked
   * for, or a line would receive more than is outstanding: an order can't
   * deliver more than it ordered, and a half-applied receipt would be worse than
   * none.
   *
   * On success it writes, in one persisted save:
   *   - the receipt row (one line per landed *row* — see `landStock`);
   *   - the stock itself: rows topped up / units created, placed at the
   *     destination with their cost updated;
   *   - one `receive` movement per landed row, carrying `receiptId`.
   *
   * `at` / `byUserId` are the API's request context; the seed passes both so a
   * fixture doesn't move with the clock or with whoever is signed in.
   */
  receiveAgainst(input: ReceiveInput): Receipt | null {
    const po = this.getPurchaseOrder(input.poId);
    if (!po || po.status === 'draft' || po.status === 'cancelled') return null;
    if (!this.getLocation(input.locationId)) return null;
    const wanted: { line: PurchaseOrderLine; qty: number }[] = [];
    for (const line of po.lines) {
      const qty = Math.floor(Number(input.qty[line.id] ?? 0));
      if (qty <= 0) continue;
      if (qty > this.poLineOutstanding(line)) return null;
      wanted.push({ line, qty });
    }
    if (!wanted.length) return null;

    const rec: Receipt = {
      id: this.nextReceiptId(),
      poId: po.id,
      supplierId: po.supplierId,
      locationId: input.locationId,
      at: input.at ?? new Date().toISOString(),
      note: input.note ?? '',
      lines: [],
    };
    this.db.receipts.push(rec);
    const by = input.byUserId ?? this.sessionUserId();
    for (const { line, qty } of wanted) {
      for (const landed of this.landStock(line, qty, input.locationId)) {
        rec.lines.push({
          id: `${rec.id}-${rec.lines.length + 1}`,
          poLineId: line.id,
          type: line.type,
          refId: landed.refId,
          qty: landed.qty,
          unitCost: line.unitCost,
        });
        this.appendMovement({
          type: line.type,
          refId: landed.refId,
          kind: 'receive',
          qty: landed.qty,
          party: this.partyName(po.supplierId),
          locationId: input.locationId,
          receiptId: rec.id,
          byUserId: by,
          at: rec.at,
          note: `Received against ${po.id}`,
        });
      }
    }
    this.save();
    return rec;
  }

  /**
   * Land one ordered line at a location: the rows that exist afterwards.
   *
   * - **Serialized**: one row per unit, created here at the ordered cost and
   *   billable rate. The count of rows *is* the stock, so a receipt can never
   *   leave a quantity lying about a machine that isn't there.
   * - **Everything else** (bulk, consumable, part, kit, attachment): the catalog
   *   row is topped up, its cost becomes a moving average, and it is placed at
   *   the destination — stock that arrived is stock that is *there*.
   */
  private landStock(line: PurchaseOrderLine, qty: number, locationId: string): ReceiptLine[] {
    const catalog = line.refId ? this.getItem(line.type, line.refId) : undefined;
    if (isUnitStock(line.type)) {
      const out: ReceiptLine[] = [];
      for (let i = 0; i < qty; i++) {
        const unit = this.addItemRow(line.type, {
          name: line.description || catalog?.name || line.type,
          category: catalog?.category ?? '',
          status: 'Available',
          qty: 1,
          rateDaily: line.rateDaily ?? catalog?.rateDaily ?? 0,
          purchaseValue: line.unitCost,
          costPrice: line.unitCost,
          locationId,
          active: true,
        });
        out.push({ id: '', poLineId: line.id, type: line.type, refId: unit.id, qty: 1, unitCost: line.unitCost });
      }
      return out;
    }
    if (!catalog) return [];
    const onHand = this.countedQty(catalog);
    catalog.costPrice = movingCost(onHand, catalog.costPrice, qty, line.unitCost);
    if (isCountedStock(catalog.type)) {
      // The stock lands as a *level*: receiving into a bin the SKU already sits in
      // tops that place up, receiving elsewhere adds a place — which is exactly how
      // one part ends up stocked in two bins. The row's totals and its home place
      // follow from the levels (see `syncStockTotals`), so nothing here writes
      // `qtyOnHand` or re-places the row by hand.
      this.writeLevel(catalog.type, catalog.id, locationId, this.stockAt(catalog, locationId) + qty);
      this.syncStockTotals(catalog);
    } else {
      // A kit or an attachment is an owned count in one place rather than a set of
      // units or a shelved quantity: its `qty` *is* its stock, so a receipt tops
      // the row up and places it, and it needs no level row (see `StockLevel`).
      catalog.qty = (catalog.qty ?? 0) + qty;
      catalog.locationId = locationId;
    }
    if (catalog.status === 'Low' && !needsReorder(catalog)) catalog.status = 'In Stock';
    return [{ id: '', poLineId: line.id, type: line.type, refId: catalog.id, qty, unitCost: line.unitCost }];
  }

  /** Normalise a PO on its way into the store: line ids, numbers, descriptions. */
  private normalizePurchaseOrder(po: PurchaseOrder): PurchaseOrder {
    const lines = po.lines.filter((l) => !!l.type && (!!l.refId || !!(l.description ?? '').trim()));
    const seen = new Set<string>();
    let seq = 0;
    for (const l of lines) {
      const m = l.id && l.id.match(/-(\d+)$/);
      if (m) seq = Math.max(seq, Number(m[1]));
    }
    po.lines = lines.map((l) => {
      const id = l.id && !seen.has(l.id) ? l.id : `${po.id}-${++seq}`;
      seen.add(id);
      return {
        ...l,
        id,
        description: (l.description ?? '').trim() || this.getItem(l.type, l.refId ?? '')?.name || l.refId || '',
        qty: Math.max(1, Math.floor(Number(l.qty) || 1)),
        unitCost: round2(Number(l.unitCost) || 0),
        rateDaily: l.rateDaily == null ? undefined : round2(Number(l.rateDaily) || 0),
      };
    });
    return po;
  }

  private nextPurchaseOrderId(): string {
    const year = new Date().getFullYear();
    return `PO-${year}-${pad3(this.maxIdSequence(this.db.purchaseOrders, /^PO-\d{4}-(\d+)$/) + 1)}`;
  }

  private nextReceiptId(): string {
    const year = new Date().getFullYear();
    return `RC-${year}-${pad3(this.maxIdSequence(this.db.receipts, /^RC-\d{4}-(\d+)$/) + 1)}`;
  }

  /** Highest numeric suffix in a table whose ids end `-<n>` (id generators). */
  private maxIdSequence(rows: { id: string }[], pattern: RegExp): number {
    let max = 0;
    for (const r of rows) {
      const m = r.id.match(pattern);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  /* ---------------------------- inspections ----------------------------- */

  listInspections(): Inspection[] {
    return [...this.db.inspections].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  getInspection(id: string): Inspection | undefined {
    return this.db.inspections.find((r) => r.id === id);
  }

  createInspection(data: Omit<Inspection, 'id'>): Inspection {
    const rec: Inspection = { ...data, id: this.nextInspectionId() };
    this.db.inspections.push(rec);
    this.save();
    return rec;
  }

  updateInspection(id: string, patch: Partial<Inspection>): void {
    const r = this.getInspection(id);
    if (r) {
      Object.assign(r, patch);
      this.save();
    }
  }

  closeInspection(id: string): void {
    this.updateInspection(id, { status: 'Closed' });
  }

  removeInspection(id: string): void {
    const i = this.db.inspections.findIndex((r) => r.id === id);
    if (i >= 0) {
      this.db.inspections.splice(i, 1);
      this.save();
    }
  }

  /** Last check-out meter reading for an asset (prototype `getLastMeter`). */
  lastMeter(itemId: string): number {
    const last = this.db.inspections
      .filter((x) => x.itemId === itemId && x.direction === 'Check-Out')
      .slice(-1)[0];
    return last?.meterOut ?? 0;
  }

  /** Meter-hour allowance for a rental window (prototype `meterOverage`). */
  allowedHours(order: Order | undefined): number {
    const days = order ? daysBetween(order.startDate, order.endDate) : 1;
    const p = this.db.settings.pricing;
    return days >= 7 ? p.weeklyHours : p.dailyMinHours * days;
  }

  private nextInspectionId(): string {
    let max = 0;
    for (const r of this.db.inspections) {
      const n = Number(String(r.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'INSP-' + String(max + 1).padStart(3, '0');
  }


  /* ---------------------------- work orders ----------------------------- */

  listWorkOrders(): WorkOrder[] {
    return [...this.db.workOrders];
  }

  getWorkOrder(id: string): WorkOrder | undefined {
    return this.db.workOrders.find((w) => w.id === id);
  }

  createWorkOrder(data: Omit<WorkOrder, 'id'>): WorkOrder {
    const rec: WorkOrder = { ...data, id: this.nextWorkOrderId() };
    this.db.workOrders.push(rec);
    // Putting an asset into service moves it to the shop.
    this.updateItem('serialized', rec.itemId, { status: 'In Shop' });
    // Consume the parts the work order booked.
    for (const p of rec.parts) {
      const it = this.getItem(p.kind, p.refId);
      if (it) it.qtyOnHand = Math.max(0, (it.qtyOnHand ?? it.qty) - p.qty);
    }
    this.save();
    return rec;
  }

  updateWorkOrder(id: string, patch: Partial<WorkOrder>): void {
    const w = this.getWorkOrder(id);
    if (w) {
      Object.assign(w, patch);
      this.save();
    }
  }

  setWorkOrderStatus(id: string, status: WorkOrderStatus): void {
    this.updateWorkOrder(id, { status });
  }

  removeWorkOrder(id: string): void {
    const i = this.db.workOrders.findIndex((w) => w.id === id);
    if (i >= 0) {
      this.db.workOrders.splice(i, 1);
      this.save();
    }
  }

  /** Parts + labour cost roll-up (prototype `woComputed`). */
  workOrderCost(w: WorkOrder): WorkOrderCost {
    const partsCost = w.parts.reduce((sum, p) => {
      const it = this.getItem(p.kind, p.refId);
      return sum + (it?.costPrice ?? 0) * p.qty;
    }, 0);
    const tech = this.listItems('labor').find((e) => e.role === 'Technician');
    const laborRate = tech?.hourlyCost ?? 30;
    const laborCost = (w.laborHours || 0) * laborRate;
    return {
      partsCost: round2(partsCost),
      laborCost: round2(laborCost),
      total: round2(partsCost + laborCost),
      laborRate,
    };
  }

  /** Work orders not yet completed (nav badge, prototype `inProgressWO`). */
  inProgressWorkOrders(): number {
    return this.db.workOrders.filter((w) => w.status !== 'Completed').length;
  }

  private nextWorkOrderId(): string {
    let max = 0;
    for (const w of this.db.workOrders) {
      const n = Number(String(w.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'WO-' + String(max + 1).padStart(3, '0');
  }

  /* ----------------------------- timesheets ----------------------------- */

  listTimesheets(): Timesheet[] {
    return [...this.db.timesheets].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  getTimesheet(id: string): Timesheet | undefined {
    return this.db.timesheets.find((t) => t.id === id);
  }

  /** Segments for one employee restricted to a set of day keys. */
  timesheetsFor(empId: string, dayKeys: string[]): Timesheet[] {
    const keys = new Set(dayKeys);
    return this.db.timesheets.filter((t) => t.empId === empId && keys.has(t.date));
  }

  /** Segments on a set of day keys, across every employee. */
  timesheetsIn(dayKeys: string[]): Timesheet[] {
    const keys = new Set(dayKeys);
    return this.db.timesheets.filter((t) => keys.has(t.date));
  }

  createTimesheet(data: Omit<Timesheet, 'id'>): Timesheet {
    const rec: Timesheet = { ...data, id: this.nextTimesheetId() };
    this.db.timesheets.push(rec);
    this.save();
    return rec;
  }

  updateTimesheet(id: string, patch: Partial<Timesheet>): void {
    const t = this.getTimesheet(id);
    if (t) {
      Object.assign(t, patch);
      this.save();
    }
  }

  removeTimesheet(id: string): void {
    const i = this.db.timesheets.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.timesheets.splice(i, 1);
      this.save();
    }
  }

  /** The running (no clock-out) segment for an employee, if any. */
  openSegment(empId: string): Timesheet | undefined {
    return this.db.timesheets.find((t) => t.empId === empId && !t.clockOut);
  }

  /** Close a running segment at an exact minute (prototype `closeOpen`). */
  closeOpen(empId: string, endMin: number): void {
    const open = this.openSegment(empId);
    if (!open) return;
    open.clockOut = minHM(endMin);
    open.hours = round2((endMin - hmMin(open.clockIn)) / 60);
    this.save();
  }

  /**
   * Start a segment for an employee at an exact minute (prototype `punchIn`),
   * closing whatever they were previously clocked into.
   */
  punchIn(
    empId: string,
    targetType: Timesheet['targetType'],
    targetId: string | null,
    startMin: number,
    dateISO?: string,
  ): Timesheet {
    this.closeOpen(empId, startMin);
    return this.createTimesheet({
      empId,
      date: dateISO ?? dISO(new Date()),
      clockIn: minHM(startMin),
      clockOut: null,
      targetType,
      targetId: targetType === 'order' || targetType === 'workorder' ? targetId : null,
      hours: null,
    });
  }

  /** Clock an employee out of their running segment (prototype `punchOut`). */
  punchOut(empId: string): void {
    const now = new Date();
    this.closeOpen(empId, now.getHours() * 60 + now.getMinutes());
  }

  /** Clock an employee into a target right now (prototype `clockInto`). */
  clockInto(empId: string, targetType: Timesheet['targetType'], targetId: string | null): void {
    const now = new Date();
    this.punchIn(empId, targetType, targetId, now.getHours() * 60 + now.getMinutes(), dISO(now));
  }

  /** Hours on a segment (running segments count 0 until clocked out). */
  segmentHours(ts: Timesheet): number {
    if (ts.hours != null) return ts.hours;
    if (ts.clockOut) return round2((hmMin(ts.clockOut) - hmMin(ts.clockIn)) / 60);
    return 0;
  }

  /** Billable value of a segment (lunch is unbillable). */
  segmentBill(ts: Timesheet): number {
    if (ts.targetType === 'lunch') return 0;
    const e = this.getItem('labor', ts.empId);
    return round2(this.segmentHours(ts) * (e?.hourlyBillable ?? 0));
  }

  /** Cost value of a segment (lunch is unbillable). */
  segmentCost(ts: Timesheet): number {
    if (ts.targetType === 'lunch') return 0;
    const e = this.getItem('labor', ts.empId);
    return round2(this.segmentHours(ts) * (e?.hourlyCost ?? 0));
  }

  /** Human label for a segment's target (prototype `segLabel`). */
  segmentLabel(ts: Timesheet): string {
    if (ts.targetType === 'order') {
      const o = ts.targetId ? this.getOrder(ts.targetId) : undefined;
      return o ? `${o.orderId} · ${o.projectName}` : (ts.targetId ?? 'Job');
    }
    if (ts.targetType === 'workorder') return ts.targetId ?? 'Work Order';
    return TIMESHEET_KIND[ts.targetType].label;
  }

  /** Short label used inside a calendar bar (prototype `tsShort`). */
  segmentShort(ts: Timesheet): string {
    if (ts.targetType === 'order' || ts.targetType === 'workorder') return ts.targetId ?? '—';
    return TIMESHEET_KIND[ts.targetType].label;
  }

  /** Hours logged against one employee (completed segments only). */
  empHours(empId: string): number {
    return round2(
      this.db.timesheets
        .filter((t) => t.empId === empId)
        .reduce((s, t) => s + this.segmentHours(t), 0),
    );
  }

  /** Total logged hours across the team. */
  totalHours(): number {
    return round2(this.db.timesheets.reduce((s, t) => s + this.segmentHours(t), 0));
  }

  private nextTimesheetId(): string {
    let max = 0;
    for (const t of this.db.timesheets) {
      const n = Number(String(t.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'TS-' + String(max + 1).padStart(4, '0');
  }


  /* ------------------------------ rentals ------------------------------- */

  listRentals(): RentalSub[] {
    return [...this.db.rentals];
  }

  /**
   * Record a sub-rental. The supplier is required and must be a partner we
   * know: a sub-rental with no vendor is an asset from nowhere, and the
   * wholesale cost side of the ledger has to point at a row (`supplierParties()`
   * feeds the picker).
   */
  createRental(data: Omit<RentalSub, 'id'>): RentalSub | null {
    if (!data.supplierId || !this.getParty(data.supplierId)) return null;
    const rec: RentalSub = { ...data, id: this.nextRentalId() };
    this.db.rentals.push(rec);
    this.save();
    return rec;
  }

  removeRental(id: string): void {
    const i = this.db.rentals.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.rentals.splice(i, 1);
      this.save();
    }
  }

  /** Display name of the partner a sub-rental came from (a supplier party). */
  rentalSupplier(r: RentalSub): string {
    return r.supplierId ? this.partyName(r.supplierId) : '—';
  }

  /** Sub-rentals sourced from one supplier (the buying history of a partner). */
  rentalsFromSupplier(supplierId: string): RentalSub[] {
    return this.db.rentals.filter((r) => r.supplierId === supplierId);
  }

  rentalSpread(r: RentalSub): number {
    return round2((r.retailRate - r.vendorCost) * r.qty);
  }

  private nextRentalId(): string {
    let max = 0;
    for (const r of this.db.rentals) {
      const n = Number(String(r.id).split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'RR-' + String(max + 1).padStart(3, '0');
  }

  /* ---------------------------- dispatch -------------------------------- */

  listVehicles(): Vehicle[] {
    return [...this.db.vehicles];
  }

  listDispatches(): Dispatch[] {
    return [...this.db.dispatches].sort((a, b) => a.routeSeq - b.routeSeq);
  }

  createDispatch(data: Omit<Dispatch, 'id' | 'routeSeq'> & { routeSeq?: number }): Dispatch {
    const rec: Dispatch = {
      ...data,
      id: this.nextDispatchId(),
      routeSeq: data.routeSeq ?? this.nextRouteSeq(),
    };
    this.db.dispatches.push(rec);
    this.save();
    return rec;
  }

  updateDispatch(id: string, patch: Partial<Dispatch>): void {
    const d = this.db.dispatches.find((x) => x.id === id);
    if (d) {
      Object.assign(d, patch);
      // Keep the fleet status in step with the dispatch status.
      if (d.vehicleId) {
        const v = this.db.vehicles.find((x) => x.id === d.vehicleId);
        if (v) v.status = d.status === 'En Route' ? 'En Route' : 'Available';
      }
      this.save();
    }
  }

  setDispatchStatus(id: string, status: DispatchStatus): void {
    this.updateDispatch(id, { status });
  }

  removeDispatch(id: string): void {
    const i = this.db.dispatches.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.dispatches.splice(i, 1);
      this.save();
    }
  }

  vehicleName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.db.vehicles.find((v) => v.id === id)?.name ?? id;
  }

  private nextRouteSeq(): number {
    return this.db.dispatches.reduce((m, d) => Math.max(m, d.routeSeq), 0) + 1;
  }

  private nextDispatchId(): string {
    let max = 0;
    for (const d of this.db.dispatches) {
      const n = Number(String(d.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'DSP-' + String(max + 1).padStart(3, '0');
  }


  /* ----------------------------- billing -------------------------------- */

  listInvoices(): Invoice[] {
    return [...this.db.invoices];
  }

  getInvoice(id: string): Invoice | undefined {
    return this.db.invoices.find((i) => i.id === id);
  }

  activeOrders(): Order[] {
    return this.db.orders.filter((o) => o.status === 'active');
  }

  /**
   * An order's invoices, oldest cycle first. A booking is billed in periods, so
   * "the invoice" is never single — `runNextCycle()` reads the last one to carry
   * the terms forward.
   */
  invoicesFor(orderId: string): Invoice[] {
    return this.db.invoices.filter((i) => i.orderId === orderId).sort((a, b) => a.cycle - b.cycle);
  }

  markInvoicePaid(id: string): void {
    const inv = this.getInvoice(id);
    if (inv) {
      inv.status = 'paid';
      this.save();
    }
  }

  setInvoiceStatus(id: string, status: InvoiceStatus): void {
    const inv = this.getInvoice(id);
    if (inv) {
      inv.status = status;
      this.save();
    }
  }

  removeInvoice(id: string): void {
    const i = this.db.invoices.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.invoices.splice(i, 1);
      this.save();
    }
  }

  /**
   * Amount billed for one line in one billing period (prototype
   * `liAmountForPeriod`) — the derived base of an invoice, and where the billing
   * rules bite:
   *  - the one-time types (labor / consumable / part) bill once, in the period
   *    that contains their rental start, so no cycle can bill them twice;
   *  - kit + attachment bill their daily rate x billable days inside the period;
   *  - serialized + bulk step up to the weekly / monthly basis on the **line's**
   *    days and bill **whole units** (`wholeUnitsBilled()`): the fixture's 21-day
   *    boom lift invoices three weekly units however long a cycle is — never
   *    `weekly rate x days`, which is not a price anyone agreed;
   *  - the risk premium is applied once, here, to the amount.
   * A period is `[periodStart, periodEnd)` — the day `periodEnd` names is the next
   * period's first, which is how the fixture's cycles are spaced (`partyCycleDays`
   * apart). Because every unit lands in exactly one period, the periods of a
   * booking sum to its `lineTotal()`.
   */
  lineAmountForPeriod(order: Order, li: OrderLine, periodStart: string, periodEnd: string): number {
    const item = this.getItem(li.type, li.refId);
    if (!item) return 0;
    const liS = this.lineStart(li, order);
    const liE = this.lineEnd(li, order);
    const s = liS > periodStart ? liS : periodStart;
    const e = liE < periodEnd ? liE : periodEnd;
    if (s > e) return 0; // no overlap with the period
    const qty = li.qty || 1;
    const premium = this.db.settings.pricing.riskPremiums[li.riskPremium ?? 'standard'] ?? 0;
    const rates = this.cardRateFor(order.partyId, item, liS);

    // One-time charges bill once, in the period that holds the rental start, so
    // they are never double-billed across cycles.
    if (li.type === 'labor' || li.type === 'consumable' || li.type === 'part') {
      const startsHere = liS >= periodStart && liS < periodEnd;
      return startsHere ? round2(qty * (rates.unitPrice ?? rates.rateDaily)) : 0;
    }
    // Kit + attachment bill their daily rate per billable day inside the period.
    if (li.type === 'kit' || li.type === 'attachment') {
      return round2(rates.rateDaily * billableDaysBetween(li.weekendPolicy, s, e) * qty * (1 + premium));
    }
    // Equipment: whole weeks / months, on the line's own days.
    const totalDays = this.lineDays(li, order);
    const sDay = Math.max(0, dayOffset(liS, s));
    const eDay = Math.max(
      sDay,
      Math.min(dayOffset(liS, periodEnd) - 1, dayOffset(liS, liE), totalDays - 1),
    );
    if (totalDays >= 28 && rates.baseMonthly) {
      return round2(wholeUnitsBilled(sDay, eDay, 28, totalDays) * rates.baseMonthly * qty * (1 + premium));
    }
    if (totalDays >= 7 && rates.baseWeekly) {
      return round2(wholeUnitsBilled(sDay, eDay, 7, totalDays) * rates.baseWeekly * qty * (1 + premium));
    }
    return round2(rates.rateDaily * billableDaysBetween(li.weekendPolicy, s, e) * qty * (1 + premium));
  }

  /**
   * Rate basis label + the **agreed rate** for a line (prototype `rateBasis`) — what
   * the invoicing screen prints beside a booking. It reads the card `lineTotal()`
   * reads, on the same day, and steps up on the same day count (`lineDays()`), so
   * the basis a row prints and the basis its amount multiplies cannot disagree.
   *
   * The rate is the rate a counterparty agreed: the line's own risk premium is not
   * folded into it but applied once, to the amount (`lineTotal()` /
   * `lineAmountForPeriod()`), where the premium scales the whole line. That is the
   * prototype's split, and it keeps the printed figure the negotiable one.
   */
  rateBasis(li: OrderLine, item: Item, order: Order): { basis: string; rate: number } {
    const days = this.lineDays(li, order);
    const rates = this.cardRateFor(order.partyId, item, this.lineStart(li, order));
    if (li.type === 'labor') return { basis: 'Hourly', rate: rates.unitPrice ?? rates.rateDaily };
    if (li.type === 'consumable' || li.type === 'part') {
      return { basis: 'Unit', rate: rates.unitPrice ?? rates.rateDaily };
    }
    if (days >= 28 && rates.baseMonthly) return { basis: 'Monthly', rate: rates.baseMonthly };
    if (days >= 7 && rates.baseWeekly) return { basis: 'Weekly', rate: rates.baseWeekly };
    return { basis: 'Daily', rate: rates.rateDaily };
  }

  /** Invoice totals: base + env fee + waiver + fuel + tax (prototype `invoiceCompute`). */
  invoiceTotals(inv: Invoice): InvoiceTotals {
    const order = this.getOrder(inv.orderId);
    const base = order
      ? round2(
          order.lineItems.reduce(
            (sum, li) => sum + this.lineAmountForPeriod(order, li, inv.cycleStart, inv.cycleEnd),
            0,
          ),
        )
      : 0;
    const envFee = round2(base * ((inv.envFeePct ?? this.db.settings.pricing.envFeePct) / 100));
    // The waiver is a flat 3% of the base when the invoice carries one — the
    // prototype's own figure (js/pages/invoicing.js `invoiceCompute`); there is no
    // setting for it, so the constant lives here once.
    const waiver = inv.damageWaiver ? round2(base * 0.03) : 0;
    const fuel = round2(inv.fuelCharge ?? 0);
    const taxable = base + envFee + waiver + fuel;
    const tax = round2(taxable * (inv.taxRate ?? 0));
    return { base, envFee, waiver, fuel, tax, total: round2(taxable + tax) };
  }

  /** Total billed across all invoices (invoicing KPI). */
  totalBilled(): number {
    return round2(this.db.invoices.reduce((s, inv) => s + this.invoiceTotals(inv).total, 0));
  }

  /**
   * A party's billing cadence as a cycle length in days (prototype
   * `partyCycleDays`). `parties.billing_cycle` is a counterparty term — the same
   * kind of per-party fact a price card carries — so the invoicing screen *reads*
   * it to space the periods instead of storing a cycle length per order. A party
   * with no known cadence (a supplier's `net-30` terms, an empty field) falls back
   * to the pricing setting's `cycleDays`.
   */
  partyCycleDays(order: Order): number {
    const cadence = this.getParty(order.partyId)?.billingCycle;
    return (cadence && BILLING_CYCLES[cadence]) || this.db.settings.pricing.cycleDays;
  }

  /**
   * Raise the next billing period for every active order — the Invoicing screen's
   * "Run Next Cycle" (prototype `#invCycle`), and the only way a cycle comes into
   * being. Each order gets the period that follows its last one,
   * `[lastEnd, lastEnd + partyCycleDays())`, clamped to the booking's end; an order
   * that has never been billed gets cycle 1, `[start, start + cadence)`. The
   * fixture's cycles are exactly this: Halstead bill weekly, Meridian bi-weekly,
   * Coastal monthly — three parties, three cadences, one rule.
   *
   * Two deliberate differences from the prototype, both about not raising money
   * nothing accounts for:
   *  - a period that bills **no base** is not raised. The prototype rolls every
   *    unpaid invoice forever, so a booking that has run out of days collects `$0`
   *    cycles carrying its fuel charge; here the derived base decides, and a period
   *    with nothing billable in it stays unwritten.
   *  - payment status does not gate the calendar. The prototype rolls only
   *    *unpaid* invoices, which would stop the clock — and the billing — the moment
   *    a customer settles one cycle.
   *
   * The snapshot columns (`envFeePct`, `damageWaiver`, `taxRate`) are copied from
   * the order's previous invoice, so a cycle keeps stating the terms the earlier
   * ones were raised at; cycle 1 takes them from the pricing settings.
   */
  runNextCycle(): number {
    const pricing = this.db.settings.pricing;
    let raised = 0;
    for (const order of this.activeOrders()) {
      const last = this.invoicesFor(order.orderId).pop();
      const cycleStart = last ? last.cycleEnd : order.startDate;
      const candidate: Invoice = {
        id: this.nextInvoiceId(),
        orderId: order.orderId,
        cycle: (last?.cycle ?? 0) + 1,
        cycleStart,
        cycleEnd: this.periodEnd(order, cycleStart),
        envFeePct: last?.envFeePct ?? pricing.envFeePct,
        damageWaiver: last?.damageWaiver ?? false,
        fuelCharge: last?.fuelCharge ?? 0,
        taxRate: last?.taxRate ?? this.taxRate(),
        status: 'pending',
      };
      if (this.invoiceTotals(candidate).base <= 0) continue; // nothing left to bill
      this.db.invoices.push(candidate);
      raised++;
    }
    this.save();
    return raised;
  }

  /** The exclusive end of a period that starts at `cycleStart`: the party's cadence, clamped to the order. */
  private periodEnd(order: Order, cycleStart: string): string {
    const window = addDays(cycleStart, this.partyCycleDays(order));
    return window < order.endDate ? window : order.endDate;
  }

  /** Default sales-tax rate (GA schedule, prototype `taxRate`). */
  taxRate(): number {
    const ga = this.db.settings.taxSchedules.find((t) => t.code === 'GA');
    return ga ? ga.rate : 0.08;
  }

  private nextInvoiceId(): string {
    let max = 0;
    for (const inv of this.db.invoices) {
      const n = Number(String(inv.id).split('-').pop());
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'INV-' + String(max + 1).padStart(3, '0');
  }


  /* ------------------------- identity & tenancy -------------------------- */

  listTenants(): Tenant[] {
    return [...this.db.tenants];
  }

  getTenant(id: string): Tenant | undefined {
    return this.db.tenants.find((t) => t.id === id);
  }

  /** The workspace the current session acts as (tenancy is always seeded). */
  get activeTenant(): Tenant {
    return this.getTenant(this.db.session.tenantId) ?? this.db.tenants[0];
  }

  /** Users in a tenant (defaults to the active one). */
  listUsers(tenantId?: string): User[] {
    const id = tenantId ?? this.db.session.tenantId;
    return this.db.users.filter((u) => u.tenantId === id);
  }

  getUser(id: string): User | undefined {
    return this.db.users.find((u) => u.id === id);
  }

  /** The person the session is acting as. */
  get activeUser(): User | undefined {
    return this.getUser(this.db.session.userId) ?? this.listUsers()[0];
  }

  sessionUserId(): string {
    return this.db.session.userId;
  }

  sessionTenantId(): string {
    return this.db.session.tenantId;
  }

  /**
   * Switch who the session is acting as — the shell's user switcher, which
   * stands in for sign-in until the API owns it. Follows the user's tenant.
   */
  setSessionUser(userId: string): void {
    const u = this.getUser(userId);
    if (!u) return;
    this.db.session.userId = u.id;
    this.db.session.tenantId = u.tenantId;
    this.save();
  }

  setSessionTenant(tenantId: string): void {
    if (!this.getTenant(tenantId)) return;
    this.db.session.tenantId = tenantId;
    const first = this.listUsers(tenantId)[0];
    if (first) this.db.session.userId = first.id;
    this.save();
  }

  /**
   * Licence flags for a tenant: a module absent from `disabledModules` is ON,
   * so the default for a new workspace is "everything the plan includes".
   */
  moduleFlags(tenantId?: string): Record<string, boolean> {
    const t = tenantId ? this.getTenant(tenantId) : this.activeTenant;
    const off = t?.disabledModules ?? [];
    const flags: Record<string, boolean> = {};
    for (const m of INDUSTRY_MODULES) flags[m.key] = !off.includes(m.key);
    return flags;
  }

  setTenantModule(key: ModuleKey, on: boolean): void {
    const t = this.activeTenant;
    if (!t) return;
    const off = t.disabledModules ?? [];
    t.disabledModules = on
      ? off.filter((k) => k !== key)
      : Array.from(new Set<ModuleKey>([...off, key]));
    this.save();
  }

  /* --------------------------- policies / pricing ------------------------ */

  /**
   * Active industry vertical. This is tenant configuration (it drives the
   * catalog tabs and the per-vertical field sets) — not a browser preference, so
   * it lives with the workspace.
   */
  get vertical(): string {
    return this.activeTenant?.vertical ?? 'HeavyEquipment';
  }

  /**
   * What the active tenant's vertical makes the catalog *look like*: tabs in
   * order, per-tab label / icon / "add" wording, the grid's columns and a new
   * record's defaults (see `core/vertical-metadata.ts`).
   *
   * Read straight from the tenant on every call, so switching the vertical
   * re-shapes the page with no reload — and no component carries a vertical map
   * of its own, which is the point of the registry: a new vertical is data.
   */
  verticalMeta(): VerticalMetadata {
    return verticalMetaFor(this.vertical);
  }

  /** The tab metadata for one type in the active vertical (undefined if hidden). */
  tabMeta(type: CatalogType): VerticalTabMeta | undefined {
    return tabMetaFor(this.verticalMeta(), type);
  }

  setVertical(v: string): void {
    const t = this.activeTenant;
    if (!t || !VERTICAL_KEYS.includes(v as VerticalKey)) return;
    t.vertical = v as VerticalKey;
    this.save();
  }

  /** Live pricing-rules engine settings (prototype `IMS.settings.pricing`). */
  get pricing(): PricingSettings {
    return this.db.settings.pricing;
  }

  get yard(): Yard {
    return this.db.yard;
  }

  updatePricing(patch: Partial<PricingSettings>): void {
    Object.assign(this.db.settings.pricing, patch);
    this.save();
  }

  listTaxSchedules(): TaxSchedule[] {
    return [...this.db.settings.taxSchedules];
  }

  createTaxSchedule(data: Omit<TaxSchedule, 'code'> & { code?: string }): TaxSchedule {
    const rec: TaxSchedule = { ...data, code: data.code ?? this.nextTaxCode() };
    this.db.settings.taxSchedules.push(rec);
    this.save();
    return rec;
  }

  updateTaxSchedule(code: string, patch: Partial<TaxSchedule>): void {
    const t = this.db.settings.taxSchedules.find((x) => x.code === code);
    if (t) {
      Object.assign(t, patch);
      this.save();
    }
  }

  removeTaxSchedule(code: string): void {
    const i = this.db.settings.taxSchedules.findIndex((x) => x.code === code);
    if (i >= 0) {
      this.db.settings.taxSchedules.splice(i, 1);
      this.save();
    }
  }

  private nextTaxCode(): string {
    return 'TX-' + String(this.db.settings.taxSchedules.length + 1).padStart(2, '0');
  }

  listOverheads(): Overhead[] {
    return [...this.db.settings.overheads];
  }

  createOverhead(data: Omit<Overhead, 'id'>): Overhead {
    const rec: Overhead = { ...data, id: this.nextOverheadId() };
    this.db.settings.overheads.push(rec);
    this.save();
    return rec;
  }

  updateOverhead(id: string, patch: Partial<Overhead>): void {
    const o = this.db.settings.overheads.find((x) => x.id === id);
    if (o) {
      Object.assign(o, patch);
      this.save();
    }
  }

  removeOverhead(id: string): void {
    const i = this.db.settings.overheads.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.settings.overheads.splice(i, 1);
      this.save();
    }
  }

  private nextOverheadId(): string {
    return 'OH-' + String(this.db.settings.overheads.length + 1).padStart(3, '0');
  }

  /* ----------------------------- KPIs (dashboard) ------------------------ */

  /** Executive dashboard KPIs (prototype `fleetKPIs`). */
  fleetKpis(): { fleet: number; onRent: number; util: number; book: number; run: number } {
    const fleet = this.listItems('serialized').length;
    const onRent = this.listItems('serialized').filter((a) => a.status === 'On Rent').length;
    const book = this.listItems('serialized').reduce((s, a) => s + (a.purchaseValue ?? 0), 0);
    let run = 0;
    for (const o of this.activeOrders()) {
      const days = this.orderDays(o);
      if (days) run += (this.orderAmount(o) / days) * 365;
    }
    return { fleet, onRent, util: fleet ? (onRent / fleet) * 100 : 0, book, run: round2(run) };
  }

  /** Serialized fleet grouped by status (dashboard "Fleet Status"). */
  fleetByStatus(): Record<string, number> {
    const by: Record<string, number> = {};
    for (const a of this.listItems('serialized')) {
      by[a.status] = (by[a.status] ?? 0) + 1;
    }
    return by;
  }

  /** Active orders with gross/net/margin, for the dashboard orders table. */
  activeOrderTotals(): { order: Order; days: number; gross: number; net: number; margin: number }[] {
    return this.activeOrders().map((order) => {
      const days = this.orderDays(order);
      const gross = this.orderAmount(order);
      const net = round2(gross - this.orderCost(order));
      const margin = gross ? round2((net / gross) * 100) : 0;
      return { order, days, gross, net, margin };
    });
  }

  /** Depreciated cost + overhead for an order (prototype `orderTotals` net side). */
  orderCost(order: Order): number {
    const annual = this.db.settings.pricing.depreciationAnnual;
    const days = this.orderDays(order);
    return round2(
      order.lineItems.reduce((sum, li) => {
        const item = this.getItem(li.type, li.refId);
        if (!item) return sum;
        const value = item.purchaseValue ?? item.costPrice ?? 0;
        return sum + li.qty * (value * annual / 365) * days;
      }, 0),
    );
  }


  /* -------------------------------- seeds ------------------------------- */

  /** Category options per catalog type (prototype `IMS.settings.categories`). */
  private seedCategories(): Record<string, CategoryOption[]> {
    const on = (names: string[]): CategoryOption[] => names.map((name) => ({ name, active: true }));
    return {
      serialized: on([
        'Boom Lift',
        'Skid Steer',
        'Mini Excavator',
        'Forklift',
        'Generator',
        'Telehandler',
        'Compressor',
        'Light Tower',
        'Traffic Control',
        'Safety',
      ]),
      bulk: on(['Scaffolding', 'Traffic', 'Shoring', 'Concrete', 'Safety']),
      consumable: on(['Safety', 'Fluids', 'Hardware', 'General']),
      labor: on(['Field', 'Shop', 'Dispatch']),
      part: on(['Filters', 'Hoses', 'Hydraulics', 'Hardware', 'Electrical']),
      kit: on(['Traffic Control', 'Confined Space', 'Fall Protection']),
      attachment: on(['Bucket', 'Carriage', 'Platform', 'Hydraulic']),
    };
  }

  private seedParties(): Party[] {
    return [
      {
        id: 'PTY-001',
        name: 'Halstead Construction',
        contact: 'M. Halstead',
        phone: '(404) 555-0134',
        email: 'projects@halstead.com',
        billingAddress: '100 Peachtree Pkwy NE, Atlanta, GA',
        billingCycle: 'weekly',
        notes: 'Boom & aerial work; weekly cadence.',
        active: true,
      },
      {
        id: 'PTY-002',
        name: 'Meridian Civil Works',
        contact: 'L. Bishop',
        phone: '(678) 555-0192',
        email: 'ops@meridiancivil.com',
        billingAddress: '88 River Rd, Atlanta, GA',
        billingCycle: 'bi-weekly',
        notes: 'Bridge / heavy civil. Net-30 terms.',
        active: true,
      },
      {
        id: 'PTY-003',
        name: 'Coastal Energy Group',
        contact: 'R. Vance',
        phone: '(404) 555-0117',
        email: 'supply@coastalenergy.com',
        billingAddress: '1 Fuel Pier, Savannah, GA',
        billingCycle: 'monthly',
        notes: 'Refinery/hazmat; risk premium applies.',
        active: true,
      },
      {
        id: 'PTY-004',
        name: 'Port Authority',
        contact: 'T. Nguyen',
        phone: '(912) 555-0165',
        email: 'facilities@portauthority.gov',
        billingAddress: 'Terminal Way, Savannah, GA',
        billingCycle: 'quarterly',
        notes: 'Public works; coastal surcharge.',
        active: true,
      },
      {
        id: 'PTY-005',
        name: 'Brightleaf General Contracting',
        contact: 'S. Rawlins',
        phone: '(770) 555-0149',
        email: 'pm@brightleafgc.com',
        billingAddress: '1200 Piedmont Ave, Atlanta, GA',
        billingCycle: 'monthly',
        notes: 'Small jobs; no active orders.',
        active: true,
      },
      /*
       * Suppliers are the same kind of row as a customer — one partner table
       * with roles on the row (`Party.kinds`) — so the buying side has a FK to
       * point at from the day it exists: a purchase order names a *party*, not
       * the vendor string the prototype's sub-rentals carried. A row seeded
       * without `kinds` is a customer (every pre-A5 row), which is why only the
       * suppliers below spell it out.
       */
      {
        id: 'PTY-006',
        name: 'United Rentals — Southeast',
        contact: 'D. Whitfield',
        phone: '(404) 555-0210',
        email: 'orders@ur-southeast.com',
        billingAddress: '4400 Buford Hwy, Norcross, GA',
        billingCycle: 'net-30',
        kinds: ['supplier'],
        notes: 'Equipment purchases; fleet pricing.',
        active: true,
      },
      {
        id: 'PTY-007',
        name: 'Fastenal Industrial Supply',
        contact: 'Inside Sales',
        phone: '(770) 555-0188',
        email: 'atlanta@fastenal.com',
        billingAddress: '2100 Industrial Blvd, Atlanta, GA',
        billingCycle: 'net-30',
        kinds: ['supplier'],
        notes: 'Filters, hoses, hardware; weekly van stock.',
        active: true,
      },
      {
        id: 'PTY-008',
        name: 'Wacker Neuson Southeast',
        contact: 'P. Adeyemi',
        phone: '(678) 555-0133',
        email: 'sales@wackerneuson-se.com',
        billingAddress: '900 Commerce Dr, McDonough, GA',
        billingCycle: 'net-45',
        kinds: ['supplier'],
        notes: 'OEM dealer: compact equipment and OEM parts.',
        active: true,
      },
      {
        id: 'PTY-009',
        name: 'SafetyMart Direct',
        contact: 'R. Ivey',
        phone: '(800) 555-0142',
        email: 'orders@safetymartdirect.com',
        billingAddress: '77 Distribution Ct, Savannah, GA',
        billingCycle: 'prepaid',
        kinds: ['supplier'],
        notes: 'PPE consumables; prepaid card on file.',
        active: true,
      },
      /*
       * The three partners the sub-rental ledger draws from (`seedRentals`): we
       * don't own their machines, we rent them to fill an order and bill the
       * customer — "in" rentals rather than "out". They carry the supplier kind
       * because that is what they are to us: a counterparty we buy from.
       */
      {
        id: 'PTY-010',
        name: 'PowerGen Rentals',
        contact: 'A. Kowalski',
        phone: '(912) 555-0173',
        email: 'dispatch@powergen-rentals.com',
        billingAddress: '19 Turbine Rd, Savannah, GA',
        billingCycle: 'net-30',
        kinds: ['supplier'],
        notes: 'Temporary power / generators; same-day delivery.',
        active: true,
      },
      {
        id: 'PTY-011',
        name: 'Forklift Fleet Co',
        contact: 'J. Marchetti',
        phone: '(770) 555-0197',
        email: 'rentals@forkliftfleet.com',
        billingAddress: '620 Industrial Park Dr, Marietta, GA',
        billingCycle: 'net-30',
        kinds: ['supplier'],
        notes: 'Material handling; sub-rentals billed weekly.',
        active: true,
      },
      {
        id: 'PTY-012',
        name: 'Meridian Tools Supply',
        contact: 'D. Osei',
        phone: '(678) 555-0151',
        email: 'hire@meridiantools.com',
        billingAddress: '410 Foundry St, Atlanta, GA',
        billingCycle: 'net-15',
        kinds: ['supplier'],
        notes: 'Compaction & small plant hire.',
        active: true,
      },
    ];
  }


  /**
   * Negotiated rates, one card per counterparty (see `PriceCard`).
   *
   * The fixture is a set of *cases* rather than a set of prices, because the card
   * is read rather than copied and the interesting questions are which card wins
   * and when:
   *
   *  - `PC-001` is **in force** and reprices a live order — CT-2024-001
   *    (Halstead, from 2026-08-20) now bills at the negotiated rates;
   *  - `PC-002` is in force for a second customer, so an order priced by one
   *    party's card shows whether the other's leaked into it;
   *  - `PC-003` is **expired** (2025) for Meridian, whose CT-2024-002 starts in
   *    2026: the order must keep the catalog rates. That window is the whole
   *    reason a card carries dates — a renewal is a new card, so an old contract
   *    keeps the price it was written at;
   *  - `PC-004` is a **supplier's** card. Its `unitCost` is the cost side: the PO
   *    editor's default, while PO-2026-001 still states the price it was ordered
   *    at (the document's own fact beats the default it was seeded from).
   */
  private seedPriceCards(): PriceCard[] {
    return [
      {
        id: 'PC-001',
        partyId: 'PTY-001',
        name: '2026 Master Agreement',
        active: true,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        note: 'Volume rates on the aerial fleet; agreed hourly and PPE prices.',
        lines: [
          { type: 'serialized', refId: 'BL-119', rateDaily: 465, baseWeekly: 2325, baseMonthly: 6975 },
          { type: 'serialized', refId: 'FL-401', rateDaily: 195, baseWeekly: 975, baseMonthly: 2925 },
          { type: 'consumable', refId: 'SG-LFT-001', unitPrice: 4.6 },
          { type: 'labor', refId: 'EMP-001', unitPrice: 62 },
        ],
      },
      {
        id: 'PC-002',
        partyId: 'PTY-003',
        name: 'Refinery Hazmat Rates 2026',
        active: true,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        note: 'Hazmat-rated units sit above list; the barriers are capped.',
        lines: [
          { type: 'serialized', refId: 'GN-511', rateDaily: 155, baseWeekly: 775, baseMonthly: 2325 },
          { type: 'bulk', refId: 'BR-010', rateDaily: 5.75, baseWeekly: 23, baseMonthly: 69 },
          { type: 'labor', refId: 'EMP-002', unitPrice: 78 },
        ],
      },
      {
        id: 'PC-003',
        partyId: 'PTY-002',
        name: '2025 Rates (superseded)',
        active: true,
        effectiveFrom: '2025-01-01',
        effectiveTo: '2025-12-31',
        note: 'Superseded 2025 agreement — kept for history, no longer in force.',
        lines: [
          { type: 'serialized', refId: 'SS-204', rateDaily: 199, baseWeekly: 995, baseMonthly: 2985 },
          { type: 'serialized', refId: 'TL-605', rateDaily: 355 },
        ],
      },
      {
        id: 'PC-004',
        partyId: 'PTY-007',
        name: 'FY26 Supply Agreement',
        active: true,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        note: 'Consumable/filter pricing agreed for the year.',
        lines: [
          { type: 'part', refId: 'PRT-001', unitCost: 16.1 },
          { type: 'part', refId: 'PRT-002', unitCost: 19.4 },
        ],
      },
    ];
  }


  /** Orders + line items + job-site geofences (prototype `IMS.orders`). */
  private seedOrders(): Order[] {
    return [
      {
        orderId: 'CT-2024-001',
        partyId: 'PTY-001',
        jobSite: 'Downtown Plaza, 245 Peachtree St',
        geofenceRadius: 300,
        projectName: 'Downtown Plaza Renovation',
        startDate: '2026-08-20',
        endDate: '2026-09-10',
        status: 'active',
        siteLat: 33.756,
        siteLng: -84.3905,
        lineItems: [
          { id: 'LI-101', type: 'serialized', refId: 'BL-119', qty: 1, weekendPolicy: 'bill', riskPremium: 'standard' },
          { id: 'LI-102', type: 'serialized', refId: 'FL-401', qty: 1, weekendPolicy: 'bill', riskPremium: 'standard' },
          { id: 'LI-103', type: 'bulk', refId: 'CN-018', qty: 50, weekendPolicy: 'bill', riskPremium: 'standard' },
          { id: 'LI-104', type: 'consumable', refId: 'SG-LFT-001', qty: 20, weekendPolicy: 'bill', riskPremium: 'standard' },
          { id: 'LI-105', type: 'labor', refId: 'EMP-001', qty: 40, weekendPolicy: 'bill', riskPremium: 'standard' },
        ],
      },
      {
        orderId: 'CT-2024-002',
        partyId: 'PTY-002',
        jobSite: 'Riverside Bridge, 88 River Rd',
        geofenceRadius: 500,
        projectName: 'Riverside Bridge Repair',
        startDate: '2026-09-01',
        endDate: '2026-09-20',
        status: 'active',
        siteLat: 33.731,
        siteLng: -84.43,
        lineItems: [
          { id: 'LI-201', type: 'serialized', refId: 'SS-204', qty: 1, weekendPolicy: 'skip', riskPremium: 'standard' },
          { id: 'LI-202', type: 'serialized', refId: 'TL-605', qty: 1, weekendPolicy: 'skip', riskPremium: 'standard' },
          { id: 'LI-203', type: 'bulk', refId: 'SCF-040', qty: 30, weekendPolicy: 'skip', riskPremium: 'standard' },
          { id: 'LI-204', type: 'labor', refId: 'EMP-003', qty: 24, weekendPolicy: 'bill', riskPremium: 'standard' },
        ],
      },
      {
        orderId: 'CT-2024-003',
        partyId: 'PTY-003',
        jobSite: 'Bayport Refinery, 1 Fuel Pier',
        geofenceRadius: 400,
        projectName: 'Refinery Catalyst Swap',
        startDate: '2026-09-02',
        endDate: '2026-09-30',
        status: 'active',
        siteLat: 33.72,
        siteLng: -84.36,
        lineItems: [
          { id: 'LI-301', type: 'serialized', refId: 'GN-511', qty: 1, weekendPolicy: 'overtime', riskPremium: 'hazmat' },
          { id: 'LI-302', type: 'bulk', refId: 'BR-010', qty: 20, weekendPolicy: 'overtime', riskPremium: 'hazmat' },
          { id: 'LI-303', type: 'consumable', refId: 'FL-DSL-005', qty: 8, weekendPolicy: 'bill', riskPremium: 'standard' },
          { id: 'LI-304', type: 'labor', refId: 'EMP-002', qty: 30, weekendPolicy: 'bill', riskPremium: 'standard' },
        ],
      },
      {
        orderId: 'CT-2024-004',
        partyId: 'PTY-004',
        jobSite: 'Pier 12 Bulkhead, Terminal Way',
        geofenceRadius: 250,
        projectName: 'Pier 12 Bulkhead Repair',
        startDate: '2026-08-01',
        endDate: '2026-08-25',
        status: 'closed',
        siteLat: 33.742,
        siteLng: -84.352,
        lineItems: [
          { id: 'LI-401', type: 'serialized', refId: 'ET-310', qty: 1, weekendPolicy: 'bill', riskPremium: 'coastal' },
        ],
      },
    ];
  }


  /** Unified catalog seed (prototype `itemInstances`/`bulkResources`/…). */
  private seedItems(): Record<string, Item[]> {
    return {
      ...this.seedStockItems(),

      /* --- serialized fleet (prototype `IMS.itemInstances`) --- */
      serialized: [
        this.fleet('BL-118', 'Boom Lift', 'JLG 450AJ Boom Lift', 'JLG', '450AJ', 'JLG-450AJ-88F2201', 1245, 'Diesel', 145000, 450, 2250, 6750, 33.7495, -84.3882, 'Available', 92, null),
        this.fleet('BL-119', 'Boom Lift', 'JLG 600S Boom Lift', 'JLG', '600S', 'JLG-600S-77D3314', 2210, 'Diesel', 178000, 520, 2600, 7800, 33.7571, -84.3892, 'On Rent', 78, 'CT-2024-001'),
        this.fleet('BL-120', 'Boom Lift', 'Genie S-65 Boom Lift', 'Genie', 'S-65', 'GEN-S65-12A8870', 980, 'Diesel', 156000, 480, 2400, 7200, 33.749, -84.3876, 'Available', 88, null),
        this.fleet('SS-204', 'Skid Steer', 'Bobcat S650 Skid Steer', 'Bobcat', 'S650', 'BOB-S650-55B1004', 4150, 'Diesel', 62000, 265, 1325, 3975, 33.7312, -84.4292, 'On Rent', 84, 'CT-2024-002'),
        this.fleet('SS-205', 'Skid Steer', 'CAT 262D Skid Steer', 'Caterpillar', '262D', 'CAT-262D-71C2219', 8400, 'Diesel', 68000, 290, 1450, 4350, 33.7492, -84.3878, 'In Shop', 61, null),
        this.fleet('ET-310', 'Mini Excavator', 'Kubota KX040-4 Mini Excavator', 'Kubota', 'KX040-4', 'KUB-KX040-99E5540', 1730, 'Diesel', 88000, 340, 1700, 5100, 33.7497, -84.3888, 'Staged', 95, null),
        this.fleet('ET-311', 'Mini Excavator', 'CAT 305.5E2 Mini Excavator', 'Caterpillar', '305.5E2', 'CAT-3055-43A0901', 1490, 'Diesel', 92000, 355, 1775, 5325, 33.7488, -84.3872, 'Available', 90, null),
        this.fleet('FL-401', 'Forklift', 'CAT EP25 Forklift', 'Caterpillar', 'EP25', 'CAT-EP25-88J6602', 3670, 'Electric', 48000, 215, 1075, 3225, 33.7553, -84.3912, 'On Rent', 66, 'CT-2024-001'),
        this.fleet('FL-402', 'Forklift', 'Toyota 8FGU25 Forklift', 'Toyota', '8FGU25', 'TYT-8FGU25-10H8821', 2980, 'LPG', 45000, 205, 1025, 3075, 33.7493, -84.3884, 'Available', 87, null),
        this.fleet('GN-510', 'Generator', 'Generac SD100 Generator', 'Generac', 'SD100', 'GEN-100KW-22K1105', 1220, 'Diesel', 38000, 175, 875, 2625, 33.7489, -84.388, 'Available', 58, null),
        this.fleet('GN-511', 'Generator', 'CAT XQ60 Generator', 'Caterpillar', 'XQ60', 'CAT-XQ60-03M7741', 2310, 'Diesel', 29000, 135, 675, 2025, 33.7206, -84.3611, 'On Rent', 73, 'CT-2024-003'),
        this.fleet('TL-605', 'Telehandler', 'JCB 540-170 Telehandler', 'JCB', '540-170', 'JCB-540170-66P9910', 1960, 'Diesel', 105000, 395, 1975, 5925, 33.7307, -84.4311, 'On Rent', 81, 'CT-2024-002'),
        this.fleet('AB-201', 'Traffic Control', 'Wanco VMS-812 Message Board', 'Wanco', 'VMS-812', 'WAN-VMS812-55A1023', 410, 'Solar', 34000, 95, 380, 1140, 33.749, -84.3882, 'Available', 71, null),
        this.fleet('GA-610', 'Safety', 'Industrial Scientific Ventis MX4', 'Industrial Sci', 'Ventis MX4', 'IS-MX4-22C5510', 520, 'Battery', 5200, 35, 140, 420, 33.7491, -84.3883, 'Available', 88, null),
      ],

      /* --- bulk resources (prototype `IMS.bulkResources`) --- */
      bulk: [
        this.bulk('SCF-040', 'Scaffold Frame 4 ft x 6 ft', 'Scaffolding', 120, 78, 42, 4.5, 18, 55),
        this.bulk('SCF-080', 'Scaffold Frame 6 ft x 10 ft', 'Scaffolding', 85, 40, 45, 6.5, 26, 78),
        this.bulk('PLK-014', 'Scaffold Plank 14 ft', 'Scaffolding', 60, 60, 0, 3, 12, 36),
        this.bulk('CN-018', 'Traffic Cone 28 in', 'Traffic', 300, 180, 120, 0.75, 3.25, 9),
        this.bulk('BR-010', 'Water Barrier 10 ft', 'Traffic', 90, 55, 35, 5, 20, 60),
        this.bulk('SHG-020', 'Trench Shoring Beam', 'Shoring', 25, 25, 0, 9.5, 38, 114),
        this.bulk('SB-005', 'Sandbag (50 lb)', 'Traffic', 400, 400, 0, 0.5, 2.5, 7.5),
        this.bulk('TR-030', 'Confined Space Tripod', 'Safety', 15, 15, 0, 18, 72, 216),
        this.bulk('FLH-001', 'Full Body Harness', 'Safety', 40, 40, 0, 6, 24, 72),
        this.bulk('LS-002', 'Shock-Absorbing Lanyard', 'Safety', 40, 40, 0, 5, 20, 60),
      ],
    };
  }

  /** Consumables / parts / labor / kits / attachments seed. */
  private seedStockItems(): Record<string, Item[]> {
    return {
      consumable: [
        // Safety PPE on one bay, fluids on the next — consumables are shelved
        // stock, so they carry a bin (a `Bin` node), not just a warehouse.
        this.stock('SG-LFT-001', 'consumable', 'Lifting Gloves (pair)', 'Safety', 240, 60, 2.1, 5.5, 'LOC-07'),
        this.stock('SG-NS-002', 'consumable', 'Nitrile Gloves (box)', 'Safety', 120, 40, 3.4, 8.25, 'LOC-07'),
        this.stock('FL-HYD-010', 'consumable', 'Hydraulic Fluid 5 gal', 'Fluids', 36, 12, 42, 78, 'LOC-08'),
        this.stock('FL-DSL-005', 'consumable', 'DEF Fluid 2.5 gal', 'Fluids', 55, 15, 14.5, 26, 'LOC-08'),
        this.stock('HW-HLM-003', 'consumable', 'Hard Hat', 'Safety', 48, 20, 11, 22, 'LOC-07'),
        this.stock('VST-VES-001', 'consumable', 'Hi-Vis Safety Vest', 'Safety', 90, 25, 6.2, 14.5, 'LOC-07'),
        this.stock('BP-ENG-020', 'consumable', 'Engine Oil 15W-40 (gal)', 'Fluids', 44, 16, 16.8, 31, 'LOC-08'),
        this.stock('GN-GRL-001', 'consumable', 'Grease Cartridge', 'Fluids', 32, 10, 4.9, 9.75, 'LOC-08'),
      ],
      part: [
        this.stock('PRT-001', 'part', 'Hydraulic Filter 40um', 'Filters', 24, 6, 18.5, 0, 'LOC-14'),
        this.stock('PRT-002', 'part', 'Air Filter Element', 'Filters', 18, 5, 22, 0, 'LOC-15'),
        this.stock('PRT-003', 'part', 'Fuel Filter Assembly', 'Filters', 30, 8, 14.75, 0, 'LOC-16'),
        this.stock('PRT-004', 'part', 'Grease Fitting Kit', 'Hardware', 60, 20, 6.4, 0, 'LOC-17'),
        this.stock('PRT-005', 'part', 'Hydraulic Hose 1in x 6ft', 'Hoses', 12, 4, 34, 0, 'LOC-19'),
        this.stock('PRT-006', 'part', 'Track Pin & Bushing Set', 'Hydraulics', 8, 2, 120, 0, 'LOC-21'),
      ],
      labor: [
        this.emp('EMP-001', 'Marcus Webb', 'Operator', 'Field', ['OSHA 30', 'AWP'], 28, 68),
        this.emp('EMP-002', 'Dana Cho', 'Technician', 'Shop', ['Forklift', 'Electrical'], 32, 75),
        this.emp('EMP-003', 'Luis Ortega', 'CDL Driver', 'Dispatch', ['CDL Class A'], 27, 62),
        this.emp('EMP-004', 'Priya Nair', 'Operator', 'Field', ['OSHA 30', 'Telehandler'], 30, 72),
        this.emp('EMP-005', 'Sam Kovac', 'Technician', 'Shop', ['Welding', 'Hydraulics'], 34, 80),
        this.emp('EMP-006', 'Rita Gomez', 'Operator', 'Field', ['Forklift'], 24, 58),
      ],
      kit: [
        { id: 'KT-001', type: 'kit', name: 'Traffic Control Kit', category: 'Traffic Control', status: 'Available', qty: 8, rateDaily: 185, notes: 'AB-201 + cones + sandbags', locationId: WAREHOUSE_1, active: true },
        { id: 'KT-002', type: 'kit', name: 'Confined Space Entry Kit', category: 'Confined Space', status: 'Available', qty: 4, rateDaily: 260, notes: 'GA-610 + tripod', locationId: WAREHOUSE_1, active: true },
        { id: 'KT-003', type: 'kit', name: 'Fall Protection Kit', category: 'Fall Protection', status: 'Available', qty: 10, rateDaily: 120, notes: 'Harnesses + lanyards', locationId: WAREHOUSE_1, active: true },
      ],
      attachment: [
        { id: 'ACC-001', type: 'attachment', name: '24" Digging Bucket', category: 'Bucket', status: 'Available', qty: 6, rateDaily: 45, notes: 'Fits ET-310 / ET-311', locationId: YARD_STAGING, active: true },
        { id: 'ACC-002', type: 'attachment', name: '36" Ditch Bucket', category: 'Bucket', status: 'Available', qty: 3, rateDaily: 55, notes: 'Fits ET-310 / ET-311', locationId: YARD_STAGING, active: true },
        { id: 'ACC-003', type: 'attachment', name: 'Fork Carriage 48 in', category: 'Carriage', status: 'Available', qty: 4, rateDaily: 38, notes: 'Fits TL-605 / FL-401', locationId: YARD_STAGING, active: true },
        { id: 'ACC-004', type: 'attachment', name: 'Work Platform Cage', category: 'Platform', status: 'Available', qty: 5, rateDaily: 60, notes: 'Fits BL-118 / BL-119 / BL-120', locationId: YARD_STAGING, active: true },
        { id: 'ACC-005', type: 'attachment', name: 'Breaker Attachment', category: 'Hydraulic', status: 'Available', qty: 2, rateDaily: 90, notes: 'Fits ET-310', locationId: YARD_STAGING, active: true },
      ],
    };
  }

  /** Stock record helper (prototype `IMS.consumables` / `IMS.parts` row). */
  private stock(
    id: string,
    type: CatalogType,
    name: string,
    category: string,
    qtyOnHand: number,
    reorderPoint: number,
    costPrice: number,
    retailPrice: number,
    locationId?: string,
  ): Item {
    return {
      id,
      type,
      name,
      category,
      status: 'In Stock',
      qty: qtyOnHand,
      rateDaily: retailPrice,
      qtyOnHand,
      reorderPoint,
      costPrice,
      retailPrice,
      locationId,
      active: true,
    };
  }

  /** Labor record helper (prototype `IMS.labor` row). */
  private emp(
    id: string,
    name: string,
    role: string,
    category: string,
    certs: string[],
    hourlyCost: number,
    hourlyBillable: number,
  ): Item {
    return {
      id,
      type: 'labor',
      name,
      category,
      status: 'Active',
      qty: 1,
      rateDaily: hourlyBillable * 8,
      role,
      certs,
      hourlyCost,
      hourlyBillable,
      active: true,
    };
  }

  private fleet(
    id: string,
    category: string,
    name: string,
    make: string,
    model: string,
    serial: string,
    meterHours: number,
    fuelType: string,
    purchaseValue: number,
    baseDaily: number,
    baseWeekly: number,
    baseMonthly: number,
    lat: number,
    lng: number,
    status: Item['status'],
    battery: number,
    orderId: string | null,
  ): Item {
    return {
      id,
      type: 'serialized',
      name,
      category,
      status,
      qty: 1,
      rateDaily: baseDaily,
      baseWeekly,
      baseMonthly,
      make,
      model,
      serial,
      meterHours,
      fuelType,
      purchaseValue,
      lat,
      lng,
      battery,
      lastReported: '2026-09-01T08:00:00',
      orderId,
      // A unit out on rent is with the customer (that is what custody records);
      // its location is where it lives and returns to — the shop if it is down.
      locationId: status === SHOP_STATUS ? WAREHOUSE_1 : YARD_STAGING,
      active: true,
    };
  }

  /** Bulk resource record helper (prototype `IMS.bulkResources` row). */
  private bulk(
    id: string,
    name: string,
    category: string,
    totalOwned: number,
    qtyAvailable: number,
    qtyOut: number,
    baseDaily: number,
    baseWeekly: number,
    baseMonthly: number,
  ): Item {
    return {
      id,
      type: 'bulk',
      name,
      category,
      status: qtyOut > 0 ? 'Committed' : 'Available',
      qty: qtyAvailable,
      rateDaily: baseDaily,
      baseWeekly,
      baseMonthly,
      totalOwned,
      qtyAvailable,
      qtyOut,
      // Bulk stock is yard stock (staged in the yard zone), not shelf stock.
      locationId: YARD_STAGING,
      active: true,
    };
  }


  /**
   * The fixture's shelves: one level row per seeded counted quantity, at the
   * place the row's seed says it sits.
   *
   * Stock that a workspace already owns is an *opening balance* — nobody moved
   * it in, which is why there is no movement behind it — and this is that
   * balance written the only way the model stores one (`stock_levels`). It runs
   * from the constructor, after `hydrate()`, because it needs `items` and must
   * not overwrite a restored snapshot's own levels. The receipts posted right
   * after it then land *into* these levels (a partial delivery into a bay the
   * SKU already sits in tops that bin up), which is the point of seeding it
   * first.
   */
  private seedStockLevels(): void {
    this.db.stockLevels = [];
    const counted = Object.entries(this.db.items).filter(([type]) => isCountedStock(type as CatalogType));
    for (const [type, rows] of counted) {
      for (const row of rows) {
        const qty = Math.floor(Number(row.qtyOnHand ?? row.qtyAvailable ?? row.qty ?? 0));
        if (qty > 0 && row.locationId) this.writeLevel(type as CatalogType, row.id, row.locationId, qty);
      }
    }
    // The rows the fixture already keeps in two bins (the same stock, a second
    // place) — then every counted row's totals are recomputed so its `qtyOnHand`
    // is its shelves' sum from the first render, a split row included.
    for (const [type, refId, locationId, qty] of SEED_SPLIT_STOCK) {
      this.writeLevel(type, refId, locationId, qty);
    }
    for (const [, rows] of counted) {
      for (const row of rows) this.syncStockTotals(row);
    }
  }

  /**
   * Append-only chain-of-custody seed (prototype `IMS.movements`).
   *
   * Each row's `locationId` is *the place the unit left from* — its own seeded
   * placement — rather than a label repeated per row, so the ledger and the
   * shelf can't disagree from the first record. It runs from the constructor
   * (the `movements` field above is empty) because that lookup needs `items`.
   */
  private seedMovements(): Movement[] {
    // item, order, customer contact, handled by (user id), at, note
    const rows: [string, string, string, string, string, string][] = [
      ['BL-119', 'CT-2024-001', 'M. Halstead', 'USR-003', '2026-08-20T07:15', 'Delivered to Downtown Plaza site.'],
      ['FL-401', 'CT-2024-001', 'M. Halstead', 'USR-003', '2026-08-20T08:05', 'Forklift offloaded with operator handoff.'],
      ['SS-204', 'CT-2024-002', 'L. Bishop', 'USR-005', '2026-09-01T06:45', 'Skid steer delivered to bridge site.'],
      ['TL-605', 'CT-2024-002', 'L. Bishop', 'USR-005', '2026-09-01T07:10', 'Telehandler staged for Riverside Bridge.'],
      ['GN-511', 'CT-2024-003', 'R. Vance', 'USR-004', '2026-09-02T06:30', 'Generator placed at refinery skid.'],
    ];
    return rows.map(([refId, orderId, party, byUserId, at, note], i) => ({
      id: 'MV-' + String(i + 1).padStart(3, '0'),
      type: 'serialized' as CatalogType,
      refId,
      kind: 'issue' as MovementKind,
      qty: 1,
      orderId,
      party,
      locationId: this.seedPlacement(refId),
      at,
      byUserId,
      note,
    }));
  }

  /** The seeded placement of one stock row, by id (movement-seed lookup). */
  private seedPlacement(refId: string): string {
    for (const rows of Object.values(this.db.items)) {
      const found = rows.find((r) => r.id === refId);
      if (found?.locationId) return found.locationId;
    }
    return YARD_STAGING;
  }

  /**
   * Purchase-order seed — one PO per state the page has to render: an order still
   * waiting, one delivered in full, and one part-delivered. The last two become
   * delivered/partial by *posting* the receipts below, not by being written that
   * way: there is no stored "received" column to seed (see `poProgress`).
   */
  private seedPurchaseOrders(): PurchaseOrder[] {
    return [
      {
        id: 'PO-2026-001',
        supplierId: 'PTY-007',
        status: 'ordered',
        orderedAt: '2026-09-04',
        expectedAt: '2026-09-12',
        reference: 'FAS-88214',
        notes: 'Monthly filter and hose restock.',
        lines: [
          { id: 'PO-2026-001-1', type: 'part', refId: 'PRT-001', description: 'Hydraulic Filter 40um', qty: 12, unitCost: 17.25 },
          { id: 'PO-2026-001-2', type: 'part', refId: 'PRT-002', description: 'Air Filter Element', qty: 6, unitCost: 20.4 },
        ],
      },
      {
        id: 'PO-2026-002',
        supplierId: 'PTY-006',
        status: 'ordered',
        orderedAt: '2026-08-18',
        expectedAt: '2026-08-28',
        reference: 'UR-PO-55901',
        notes: 'Two compact loaders for the Riverside Bridge job.',
        lines: [
          {
            id: 'PO-2026-002-1',
            type: 'serialized',
            description: 'CAT 259D3 Compact Track Loader',
            qty: 2,
            unitCost: 78500,
            rateDaily: 385,
          },
          { id: 'PO-2026-002-2', type: 'attachment', refId: 'ACC-002', description: '36" Ditch Bucket', qty: 2, unitCost: 41 },
        ],
      },
      {
        id: 'PO-2026-003',
        supplierId: 'PTY-008',
        status: 'ordered',
        orderedAt: '2026-09-02',
        expectedAt: '2026-09-15',
        reference: 'WN-Q-33120',
        notes: 'Excavator plus OEM hose stock.',
        lines: [
          {
            id: 'PO-2026-003-1',
            type: 'serialized',
            description: 'Wacker Neuson ET42 Mini Excavator',
            qty: 1,
            unitCost: 62000,
            rateDaily: 320,
          },
          { id: 'PO-2026-003-2', type: 'part', refId: 'PRT-005', description: 'Hydraulic Hose 1in x 6ft', qty: 12, unitCost: 33.5 },
        ],
      },
    ];
  }

  /**
   * Post the fixture receipts through the *same* path the page uses, with the
   * clock and the actor pinned: a fixture that ran `receiveAgainst` at seed time
   * can't describe stock the store doesn't have. By the time the app renders,
   * PO-2026-002 is delivered, PO-2026-003 is partial, and the units those
   * receipts landed are real rows in the catalog.
   */
  private seedReceipts(): void {
    this.receiveAgainst({
      poId: 'PO-2026-002',
      locationId: YARD_STAGING,
      qty: { 'PO-2026-002-1': 2, 'PO-2026-002-2': 2 },
      note: 'Delivered on the lowboy; unloaded at Yard A.',
      at: '2026-08-28T09:20:00',
      byUserId: DEMO_OWNER_ID,
    });
    this.receiveAgainst({
      poId: 'PO-2026-003',
      locationId: 'LOC-19', // Bay C-04: the bin the hose stock already lives in
      qty: { 'PO-2026-003-2': 4 }, // 4 of 12 — the excavator hasn't landed
      note: 'Partial delivery: hose stock only.',
      at: '2026-09-08T14:05:00',
      byUserId: DEMO_OWNER_ID,
    });
  }

  /**
   * User-defined location types. These are the vocabulary the location editor
   * offers and the levels a ragged hierarchy is usually built from.
   */
  private seedLocationTypes(): LocationType[] {
    return ['Site', 'Yard', 'Zone', 'Warehouse', 'Rack', 'Shelf', 'Bin', 'Dock', 'Office', 'Customer Site', 'Vehicle']
      .map((name) => ({ name, active: true }));
  }

  /**
   * Location hierarchy (ragged / adjacency list). Demonstrates that any node
   * may be a parent and that depth is unbounded. `parentId: null` = top level.
   */
  private seedLocations(): Location[] {
    return [
      { id: 'LOC-01', name: 'Atlanta Main Campus', type: 'Site', parentId: null, address: '1200 Logistics Dr, Atlanta GA', phone: '(404) 555-0100', tz: 'America/New_York' },
      { id: 'LOC-02', name: 'Main Yard', type: 'Yard', parentId: 'LOC-01', address: '1200 Logistics Dr, Atlanta GA', phone: '(404) 555-0101', tz: 'America/New_York' },
      { id: 'LOC-03', name: 'Yard A — Equipment Staging', type: 'Zone', parentId: 'LOC-02', address: '1200 Logistics Dr, Atlanta GA', phone: '', tz: 'America/New_York' },
      { id: 'LOC-04', name: 'Yard B — Trailer Parking', type: 'Zone', parentId: 'LOC-02', address: '1200 Logistics Dr, Atlanta GA', phone: '', tz: 'America/New_York' },
      { id: 'LOC-05', name: 'Warehouse 1', type: 'Warehouse', parentId: 'LOC-01', address: '1210 Logistics Dr, Atlanta GA', phone: '(404) 555-0120', tz: 'America/New_York' },
      { id: 'LOC-06', name: 'Aisle 1', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-07', name: 'Bay A1-01', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-08', name: 'Bay A1-02', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-09', name: 'Aisle 2', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-10', name: 'Savannah Port Depot', type: 'Site', parentId: null, address: '8 Terminal Way, Savannah GA', phone: '(912) 555-0177', tz: 'America/New_York' },
      { id: 'LOC-11', name: 'Dock 4', type: 'Dock', parentId: 'LOC-10', address: '8 Terminal Way, Savannah GA', phone: '', tz: 'America/New_York' },
      { id: 'LOC-12', name: 'Bonded Warehouse', type: 'Warehouse', parentId: 'LOC-10', address: '10 Terminal Way, Savannah GA', phone: '(912) 555-0178', tz: 'America/New_York' },
      { id: 'LOC-13', name: 'Secure Cage C', type: 'Zone', parentId: 'LOC-12', address: '', phone: '', tz: 'America/New_York' },
      /* The bins the prototype's parts carried as free text (`bin: 'A-03'`, …)
         now live in the hierarchy they always described — a part's `locationId`
         points at one of these rows instead of repeating its label. */
      { id: 'LOC-14', name: 'Bay A-03', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-15', name: 'Bay A-07', type: 'Bin', parentId: 'LOC-06', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-16', name: 'Bay B-01', type: 'Bin', parentId: 'LOC-09', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-17', name: 'Bay B-12', type: 'Bin', parentId: 'LOC-09', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-18', name: 'Aisle 3', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-19', name: 'Bay C-04', type: 'Bin', parentId: 'LOC-18', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-20', name: 'Aisle 4', type: 'Rack', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' },
      { id: 'LOC-21', name: 'Bay D-02', type: 'Bin', parentId: 'LOC-20', address: '', phone: '', tz: 'America/New_York' },
    ];
  }

  /** Sales-tax schedules (prototype `IMS.settings.taxSchedules`). */
  private seedTaxSchedules(): TaxSchedule[] {
    return [
      { code: 'GA', state: 'Georgia', county: 'Fulton', city: 'Atlanta', rate: 0.08, note: 'State + county combined' },
      { code: 'AL', state: 'Alabama', county: '', city: '', rate: 0.07, note: 'Standard state rate' },
      { code: 'TN', state: 'Tennessee', county: 'Davidson', city: 'Nashville', rate: 0.0925, note: 'Highest local rate' },
    ];
  }

  /** Overhead / service-fee configurations (prototype `IMS.settings.overheads`). */
  private seedOverheads(): Overhead[] {
    return [
      { id: 'OH-ENV', name: 'Environmental Fee Surcharge', category: 'Freight/Logistics', chargeType: 'Percent of Equipment Total', cost: 0, retail: 0, pct: 2.5, locked: true },
      { id: 'OH-MOB', name: 'Standard Mobilization / Delivery', category: 'Freight/Logistics', chargeType: 'Flat Fee', cost: 150, retail: 250, pct: 0, locked: true },
      { id: 'OH-PMT', name: 'Oversized Transport Permit', category: 'Compliance', chargeType: 'Flat Fee', cost: 75, retail: 110, pct: 0, locked: false },
      { id: 'OH-STR', name: 'Warehouse Storage Slot B', category: 'Facility', chargeType: 'Per Day', cost: 40, retail: 95, pct: 0, locked: false },
    ];
  }

  /** Pricing rules engine defaults (prototype `IMS.settings.pricing`). */
  private seedPricing(): PricingSettings {
    return {
      dailyMinHours: 8,
      weeklyHours: 40,
      cycleDays: 28,
      weekendPolicyDefault: 'bill',
      riskPremiums: { standard: 0, coastal: 0.15, hazmat: 0.25 },
      envFeePct: 5,
      depreciationAnnual: 0.1,
    };
  }

  /** Yard in/out inspections (prototype `IMS.inspections`). */
  private seedInspections(): Inspection[] {
    const all: Record<InspectionCheckKey, boolean> = {
      tires: true,
      fluids: true,
      guards: true,
      lights: true,
      engine: true,
    };
    return [
      {
        id: 'INSP-001',
        itemId: 'BL-119',
        orderId: 'CT-2024-001',
        direction: 'Check-Out',
        date: '2026-08-20',
        meterOut: 2210,
        meterIn: null,
        fuelOut: 85,
        fuelIn: null,
        checks: { ...all },
        photos: 2,
        status: 'Open',
      },
      {
        id: 'INSP-002',
        itemId: 'SS-204',
        orderId: 'CT-2024-002',
        direction: 'Check-Out',
        date: '2026-09-01',
        meterOut: 4150,
        meterIn: null,
        fuelOut: 78,
        fuelIn: null,
        checks: { ...all, lights: false },
        photos: 1,
        status: 'Open',
      },
      {
        id: 'INSP-003',
        itemId: 'BL-120',
        orderId: null,
        direction: 'Check-In',
        date: '2026-08-28',
        meterOut: 3190,
        meterIn: 3200,
        fuelOut: 60,
        fuelIn: 40,
        checks: { ...all },
        photos: 3,
        status: 'Closed',
      },
    ];
  }


  /** Service work orders (prototype `IMS.workOrders`). */
  private seedWorkOrders(): WorkOrder[] {
    return [
      { id: 'WO-401', itemId: 'SS-205', type: 'Repair', meterReading: 8400, status: 'In Progress', parts: [{ kind: 'consumable', refId: 'FL-HYD-010', qty: 2 }], laborHours: 3, date: '2026-08-30' },
      { id: 'WO-402', itemId: 'GN-510', type: 'Preventive', meterReading: 1220, status: 'Completed', parts: [{ kind: 'consumable', refId: 'BP-ENG-020', qty: 2 }, { kind: 'consumable', refId: 'GN-GRL-001', qty: 2 }], laborHours: 1.5, date: '2026-08-28' },
      { id: 'WO-403', itemId: 'BL-120', type: 'Inspection', meterReading: 3200, status: 'Completed', parts: [], laborHours: 1, date: '2026-08-25' },
      { id: 'WO-404', itemId: 'FL-402', type: 'Repair', meterReading: 2980, status: 'Scheduled', parts: [{ kind: 'consumable', refId: 'BP-ENG-020', qty: 1 }], laborHours: 2, date: '2026-09-01' },
    ];
  }

  /**
   * Labour clock segments (prototype `IMS.timesheets`): two days of punches
   * across the six employees, with the shop / overhead / idle buckets.
   */
  private seedTimesheets(): Timesheet[] {
    const rows: [string, string, string, string, string, number, Timesheet['targetType'], string | null][] = [
      /* 2026-08-31 (Monday) */
      ['TS-0001', 'EMP-001', '2026-08-31', '07:00', '11:30', 4.5, 'order', 'CT-2024-001'],
      ['TS-0002', 'EMP-001', '2026-08-31', '11:30', '12:30', 1, 'overhead', null],
      ['TS-0003', 'EMP-001', '2026-08-31', '12:30', '16:00', 3.5, 'order', 'CT-2024-001'],
      ['TS-0004', 'EMP-002', '2026-08-31', '08:00', '12:00', 4, 'workorder', 'WO-402'],
      ['TS-0005', 'EMP-002', '2026-08-31', '12:30', '16:30', 4, 'workorder', 'WO-402'],
      ['TS-0006', 'EMP-005', '2026-08-31', '09:00', '12:00', 3, 'workorder', 'WO-401'],
      ['TS-0007', 'EMP-005', '2026-08-31', '13:00', '15:00', 2, 'idle', null],
      /* 2026-09-01 (Tuesday) */
      ['TS-0008', 'EMP-001', '2026-09-01', '07:00', '12:00', 5, 'order', 'CT-2024-001'],
      ['TS-0009', 'EMP-001', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
      ['TS-0010', 'EMP-001', '2026-09-01', '13:00', '17:00', 4, 'order', 'CT-2024-001'],
      ['TS-0011', 'EMP-002', '2026-09-01', '08:00', '12:00', 4, 'workorder', 'WO-401'],
      ['TS-0012', 'EMP-002', '2026-09-01', '13:00', '17:00', 4, 'shop', null],
      ['TS-0013', 'EMP-003', '2026-09-01', '06:30', '10:30', 4, 'order', 'CT-2024-002'],
      ['TS-0014', 'EMP-003', '2026-09-01', '10:30', '11:30', 1, 'overhead', null],
      ['TS-0015', 'EMP-003', '2026-09-01', '11:30', '14:30', 3, 'order', 'CT-2024-002'],
      ['TS-0016', 'EMP-004', '2026-09-01', '07:00', '12:00', 5, 'order', 'CT-2024-001'],
      ['TS-0017', 'EMP-004', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
      ['TS-0018', 'EMP-004', '2026-09-01', '13:00', '16:00', 3, 'order', 'CT-2024-001'],
      ['TS-0019', 'EMP-005', '2026-09-01', '08:00', '12:00', 4, 'workorder', 'WO-404'],
      ['TS-0020', 'EMP-005', '2026-09-01', '13:00', '17:00', 4, 'shop', null],
      ['TS-0021', 'EMP-006', '2026-09-01', '08:00', '12:00', 4, 'order', 'CT-2024-001'],
      ['TS-0022', 'EMP-006', '2026-09-01', '12:00', '13:00', 1, 'idle', null],
      ['TS-0023', 'EMP-006', '2026-09-01', '13:00', '16:00', 3, 'order', 'CT-2024-001'],
    ];
    return rows.map(([id, empId, date, clockIn, clockOut, hours, targetType, targetId]) => ({
      id,
      empId,
      date,
      clockIn,
      clockOut,
      targetType,
      targetId,
      hours,
      note: TIMESHEET_KIND[targetType].label,
    }));
  }

  /** Sub-rentals from third-party vendors (prototype `IMS.rentals`). */
  /**
   * Sub-rentals from third-party vendors (prototype `IMS.rentals`). The prototype
   * stored each vendor as a string; here the vendors are supplier *parties*
   * (`PTY-010`…`PTY-012`), so the wholesale side of the business points at the
   * same partner table the purchase orders do.
   */
  private seedRentals(): RentalSub[] {
    return [
      { id: 'RR-001', itemId: 'GN-510', assetName: 'Generac 100 kW Generator', orderId: 'CT-2024-003', supplierId: 'PTY-010', vendorCost: 110, retailRate: 175, qty: 1 },
      { id: 'RR-002', itemId: 'FL-402', assetName: 'Toyota Forklift 8FGU25', orderId: 'CT-2024-004', supplierId: 'PTY-011', vendorCost: 95, retailRate: 205, qty: 1 },
      { id: 'RR-003', itemId: null, assetName: 'Compaction Roller 5T', orderId: 'CT-2024-002', supplierId: 'PTY-012', vendorCost: 140, retailRate: 260, qty: 1 },
    ];
  }

  /** Transport fleet (prototype `IMS.vehicles`). */
  private seedVehicles(): Vehicle[] {
    return [
      { id: 'TRK-01', name: 'Freightliner M2 26 ft', plate: 'ABC-4521', status: 'Available' },
      { id: 'TRK-02', name: 'F-550 Flatbed', plate: 'XYZ-7789', status: 'En Route' },
      { id: 'TRK-03', name: 'Isuzu NPR Box', plate: 'QRS-9912', status: 'Available' },
    ];
  }

  /** Dispatch board (prototype `IMS.dispatches`). */
  private seedDispatches(): Dispatch[] {
    return [
      { id: 'DSP-001', orderId: 'CT-2024-001', assetId: 'BL-119', routeSeq: 1, driverId: 'EMP-003', vehicleId: 'TRK-01', status: 'En Route' },
      { id: 'DSP-002', orderId: 'CT-2024-001', assetId: 'FL-401', routeSeq: 2, driverId: null, vehicleId: null, status: 'Staged' },
      { id: 'DSP-003', orderId: 'CT-2024-002', assetId: 'SS-204', routeSeq: 3, driverId: 'EMP-001', vehicleId: 'TRK-02', status: 'Delivered' },
      { id: 'DSP-004', orderId: 'CT-2024-002', assetId: 'TL-605', routeSeq: 4, driverId: null, vehicleId: null, status: 'Staged' },
      { id: 'DSP-005', orderId: 'CT-2024-003', assetId: 'GN-511', routeSeq: 5, driverId: 'EMP-003', vehicleId: 'TRK-01', status: 'Pending Return' },
    ];
  }

  /** Cycle invoices (prototype `IMS.invoices`). */
  private seedInvoices(): Invoice[] {
    return [
      { id: 'INV-001', orderId: 'CT-2024-001', cycle: 1, cycleStart: '2026-08-20', cycleEnd: '2026-08-27', envFeePct: 5, damageWaiver: false, fuelCharge: 120, taxRate: 0.08, status: 'invoiced' },
      { id: 'INV-002', orderId: 'CT-2024-002', cycle: 1, cycleStart: '2026-09-01', cycleEnd: '2026-09-15', envFeePct: 5, damageWaiver: true, fuelCharge: 0, taxRate: 0.07, status: 'pending' },
      { id: 'INV-003', orderId: 'CT-2024-003', cycle: 1, cycleStart: '2026-09-02', cycleEnd: '2026-09-30', envFeePct: 7, damageWaiver: true, fuelCharge: 210, taxRate: 0.07, status: 'paid' },
    ];
  }

  /* ----------------------- identity & tenancy seeds ---------------------- */

  /**
   * The customer workspaces. One is seeded because the UI runs against a single
   * browser today; the shape is what matters — the API resolves a tenant from
   * the signed-in user and every query is scoped to it.
   */
  private seedTenants(): Tenant[] {
    return [
      {
        id: DEMO_TENANT_ID,
        name: 'Northline Equipment Co.',
        slug: 'northline',
        plan: 'professional',
        vertical: 'HeavyEquipment',
        disabledModules: [],
        createdAt: '2024-01-08',
      },
    ];
  }

  /**
   * Seeded people — one per role, so the shell's user switcher can demonstrate
   * exactly what each permission set can and cannot do.
   */
  private seedUsers(): User[] {
    return [
      { id: 'USR-001', tenantId: DEMO_TENANT_ID, name: 'Marcus Alvarez', email: 'marcus@northline.example', role: 'owner', title: 'Managing Director', initials: 'MA', active: true },
      { id: 'USR-002', tenantId: DEMO_TENANT_ID, name: 'Priya Raman', email: 'priya@northline.example', role: 'admin', title: 'Operations Administrator', initials: 'PR', active: true },
      { id: 'USR-003', tenantId: DEMO_TENANT_ID, name: 'Dana Reynolds', email: 'dana@northline.example', role: 'manager', title: 'Dispatch Manager', initials: 'DR', active: true },
      { id: 'USR-004', tenantId: DEMO_TENANT_ID, name: 'Ray Chen', email: 'ray@northline.example', role: 'warehouse', title: 'Warehouse Lead', initials: 'RC', active: true },
      { id: 'USR-005', tenantId: DEMO_TENANT_ID, name: 'Tunde Okafor', email: 'tunde@northline.example', role: 'field', title: 'Field Technician', initials: 'TO', active: true },
      { id: 'USR-006', tenantId: DEMO_TENANT_ID, name: 'Sandra Patel', email: 'sandra@northline.example', role: 'viewer', title: 'Accountant', initials: 'SP', active: true },
    ];
  }
}

