import { Injectable } from '@angular/core';

import {
  CatalogType,
  CATALOG_TYPE_KEYS,
  CategoryOption,
  Dispatch,
  DispatchStatus,
  Inspection,
  InspectionCheckKey,
  Invoice,
  InvoiceStatus,
  InvoiceTotals,
  Item,
  Location,
  LocationType,
  Movement,
  MovementKind,
  Order,
  OrderLine,
  Overhead,
  Party,
  PricingSettings,
  RentalSub,
  TaxSchedule,
  Timesheet,
  TIMESHEET_KIND,
  Vehicle,
  WorkOrder,
  WorkOrderCost,
  WorkOrderPart,
  WorkOrderStatus,
  Yard,
  needsReorder,
} from './models';

/** Money helper — round to 2dp (prototype `round2`). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const pad2 = (n: number) => String(n).padStart(2, '0');

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
  private readonly VERSION = 4;

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
      /** Active industry vertical (drives the catalog tabs on Items & Stock). */
      vertical: string;
    };
    yard: Yard;
    parties: Party[];
    orders: Order[];
    items: Record<string, Item[]>;
    movements: Movement[];
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
      vertical: 'HeavyEquipment',
    },
    yard: { name: 'Main Yard — Buckhead Hub', lat: 33.749, lng: -84.388 },
    parties: this.seedParties(),
    orders: this.seedOrders(),
    items: this.seedItems(),
    movements: this.seedMovements(),
    inspections: this.seedInspections(),
    workOrders: this.seedWorkOrders(),
    timesheets: this.seedTimesheets(),
    rentals: this.seedRentals(),
    vehicles: this.seedVehicles(),
    dispatches: this.seedDispatches(),
    invoices: this.seedInvoices(),
  };

  constructor() {
    this.hydrate();
  }

  /* ----------------------------- persistence ---------------------------- */

  /** Restore a previously persisted snapshot if the version matches. */
  private hydrate(): void {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap || snap._v !== this.VERSION) return; // stale/incompatible -> reseed
      if (snap.settings?.categories) this.db.settings.categories = snap.settings.categories;
      if (Array.isArray(snap.settings?.locations)) this.db.settings.locations = snap.settings.locations;
      if (Array.isArray(snap.settings?.locationTypes)) this.db.settings.locationTypes = snap.settings.locationTypes;
      if (snap.settings?.taxSchedules) this.db.settings.taxSchedules = snap.settings.taxSchedules;
      if (snap.settings?.overheads) this.db.settings.overheads = snap.settings.overheads;
      if (snap.settings?.pricing) this.db.settings.pricing = snap.settings.pricing;
      if (snap.settings?.vertical) this.db.settings.vertical = snap.settings.vertical;
      if (snap.yard) this.db.yard = snap.yard;
      if (Array.isArray(snap.parties)) this.db.parties = snap.parties;
      if (Array.isArray(snap.orders)) this.db.orders = snap.orders;
      if (snap.items && typeof snap.items === 'object') this.db.items = snap.items;
      if (Array.isArray(snap.movements)) this.db.movements = snap.movements;
      if (Array.isArray(snap.inspections)) this.db.inspections = snap.inspections;
      if (Array.isArray(snap.workOrders)) this.db.workOrders = snap.workOrders;
      if (Array.isArray(snap.timesheets)) this.db.timesheets = snap.timesheets;
      if (Array.isArray(snap.rentals)) this.db.rentals = snap.rentals;
      if (Array.isArray(snap.vehicles)) this.db.vehicles = snap.vehicles;
      if (Array.isArray(snap.dispatches)) this.db.dispatches = snap.dispatches;
      if (Array.isArray(snap.invoices)) this.db.invoices = snap.invoices;
    } catch {
      /* corrupted storage -> keep seed */
    }
  }

  /** Persist the full snapshot (writes are routed through here). */
  private save(): void {
    try {
      localStorage.setItem(
        this.KEY,
        JSON.stringify({
          _v: this.VERSION,
          settings: this.db.settings,
          yard: this.db.yard,
          parties: this.db.parties,
          orders: this.db.orders,
          items: this.db.items,
          movements: this.db.movements,
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

  listParties(): Party[] {
    return [...this.db.parties];
  }

  getParty(id: string): Party | undefined {
    return this.db.parties.find((p) => p.id === id);
  }

  createParty(data: Omit<Party, 'id' | 'active'>): Party {
    const rec: Party = { ...data, id: this.nextPartyId(), active: true };
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

  removeParty(id: string): void {
    const i = this.db.parties.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.parties.splice(i, 1);
      this.save();
    }
  }

  /** Party/order display name by id (prototype `partyName`). */
  partyName(id: string): string {
    const p = this.getParty(id);
    if (p) return p.name;
    const o = this.getOrder(id);
    return o ? o.party : id;
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

  /** Billable days honouring a line's weekend policy (prototype `billableDays`). */
  billableDays(order: Order, li: OrderLine): number {
    const s = li.startDate ?? order.startDate;
    const e = li.endDate ?? order.endDate;
    if (li.weekendPolicy === 'skip') return countWeekdays(s, e);
    if (li.weekendPolicy === 'overtime') return daysBetween(s, e) * 1.5;
    return daysBetween(s, e);
  }

  /** Gross amount for an order: rateDaily x qty x billable days per line. */
  orderAmount(order: Order): number {
    const total = order.lineItems.reduce((sum, li) => {
      const item = this.getItem(li.type, li.refId);
      const rate = item?.rateDaily ?? 0;
      return sum + rate * li.qty * this.billableDays(order, li);
    }, 0);
    return round2(total);
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

  createItem(type: CatalogType, data: Omit<Item, 'type' | 'id'>): Item {
    const rec: Item = { ...data, type, id: this.nextItemId(type) };
    (this.db.items[type] ??= []).push(rec);
    this.save();
    return rec;
  }

  updateItem(type: CatalogType, id: string, patch: Partial<Item>): void {
    const it = this.getItem(type, id);
    if (it) {
      Object.assign(it, patch, { type });
      this.save();
    }
  }

  removeItem(type: CatalogType, id: string): void {
    const list = this.db.items[type];
    if (!list) return;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) {
      list.splice(i, 1);
      this.save();
    }
  }

  /** Display label for a catalog item (prototype `itemLabel`). */
  itemLabel(type: CatalogType, id: string): string {
    const it = this.getItem(type, id);
    return it ? `${it.id} · ${it.name}` : id;
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

  /** Restock a low item to 2x its reorder point (prototype `triggerReorder`). */
  triggerReorder(type: CatalogType, ref: string): void {
    const it = this.getItem(type, ref);
    if (!it) return;
    const restock = Math.max((it.reorderPoint ?? 0) * 2, 1);
    it.qtyOnHand = restock;
    it.status = 'In Stock';
    this.save();
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

  /** Category records for a type (Categories & Types grid). */
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
   * Remove a location. Its children are re-parented to the removed node's own
   * parent (move up one level) so the hierarchy stays intact and nothing is
   * orphaned — the adjacency-list equivalent of re-pointing the child rows'
   * `parent_id` at the deleted node's parent.
   */
  removeLocation(id: string): void {
    const i = this.db.settings.locations.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [removed] = this.db.settings.locations.splice(i, 1);
    const up = removed.parentId ?? null;
    for (const child of this.db.settings.locations) {
      if (child.parentId === id) child.parentId = up;
    }
    this.save();
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

  /** Append an immutable movement + (for serialized items) flip custody status. */
  logMovement(input: {
    type: CatalogType;
    refId: string;
    kind: MovementKind;
    qty: number;
    orderId?: string | null;
    party?: string;
    note?: string;
  }): Movement {
    const rec: Movement = {
      id: this.nextMovementId(),
      type: input.type,
      refId: input.refId,
      kind: input.kind,
      qty: input.qty,
      orderId: input.orderId ?? null,
      party: input.party ?? '',
      at: new Date().toISOString(),
      by: 'D. Reynolds',
      note: input.note ?? '',
    };
    this.db.movements.push(rec);
    // Serialized items are whole-unit custody: an issue rents it out, a return frees it.
    if (input.type === 'serialized') {
      const it = this.getItem('serialized', input.refId);
      if (it) {
        it.status = input.kind === 'issue' ? 'On Rent' : 'Available';
        it.orderId = input.kind === 'issue' ? (input.orderId ?? null) : null;
      }
    }
    this.save();
    return rec;
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

  createRental(data: Omit<RentalSub, 'id'>): RentalSub {
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

  invoiceFor(orderId: string): Invoice | undefined {
    return this.db.invoices.find((i) => i.orderId === orderId);
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

  /** Line amount billed in a period, honouring billing rules (prototype `liAmountForPeriod`). */
  lineAmountForPeriod(order: Order, li: OrderLine, periodStart: string, periodEnd: string): number {
    const item = this.getItem(li.type, li.refId);
    if (!item) return 0;
    const liS = li.startDate ?? order.startDate;
    const liE = li.endDate ?? order.endDate;
    const s = liS > periodStart ? liS : periodStart;
    const e = liE < periodEnd ? liE : periodEnd;
    if (s > e) return 0; // no overlap with the cycle
    const qty = li.qty || 1;
    const rates = this.rateBasis(li, item, order);

    // One-time charges (labor / consumable / part) bill once, in the cycle that
    // contains the rental start, so they are never double-billed across cycles.
    if (li.type === 'labor' || li.type === 'consumable' || li.type === 'part') {
      const startsHere = liS >= periodStart && liS <= periodEnd;
      return startsHere ? round2(qty * rates.rate) : 0;
    }
    // Day-rated lines bill per billable day inside the cycle.
    const days = li.weekendPolicy === 'skip'
      ? countWeekdays(s, e)
      : li.weekendPolicy === 'overtime'
        ? daysBetween(s, e) * 1.5
        : daysBetween(s, e);
    return round2(qty * rates.rate * days);
  }

  /** Rate basis label + effective rate for a line (prototype `rateBasis`). */
  rateBasis(li: OrderLine, item: Item, order: Order): { basis: string; rate: number } {
    const premium = this.db.settings.pricing.riskPremiums[li.riskPremium ?? 'standard'] ?? 0;
    const days = this.orderDays(order);
    if (li.type === 'labor') return { basis: 'Hourly', rate: item.hourlyBillable ?? item.rateDaily };
    if (li.type === 'consumable' || li.type === 'part') {
      return { basis: 'Unit', rate: round2((item.retailPrice ?? item.rateDaily) * (1 + premium)) };
    }
    if (days >= 28 && item.baseMonthly) return { basis: 'Monthly', rate: item.baseMonthly };
    if (days >= 7 && item.baseWeekly) return { basis: 'Weekly', rate: item.baseWeekly };
    return { basis: 'Daily', rate: round2(item.rateDaily * (1 + premium)) };
  }

  /** Invoice totals: base + env fee + waiver + fuel + tax (prototype `invoiceTotals`). */
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
    const waiver = inv.damageWaiver ? round2(base * 0.05) : 0;
    const fuel = round2(inv.fuelCharge ?? 0);
    const taxable = base + envFee + waiver + fuel;
    const tax = round2(taxable * (inv.taxRate ?? 0));
    return { base, envFee, waiver, fuel, tax, total: round2(taxable + tax) };
  }

  /** Total billed across all invoices (invoicing KPI). */
  totalBilled(): number {
    return round2(this.db.invoices.reduce((s, inv) => s + this.invoiceTotals(inv).total, 0));
  }

  /** Generate cycle-1 invoices for active orders that don't have one yet. */
  generateInvoices(): number {
    const pricing = this.db.settings.pricing;
    let created = 0;
    for (const o of this.activeOrders()) {
      if (this.invoiceFor(o.orderId)) continue;
      const start = o.startDate;
      const endMs = Math.min(
        Date.parse(start + 'T00:00:00') + (pricing.cycleDays - 1) * 86400000,
        Date.parse(o.endDate + 'T00:00:00'),
      );
      this.db.invoices.push({
        id: this.nextInvoiceId(),
        orderId: o.orderId,
        cycle: 1,
        cycleStart: start,
        cycleEnd: new Date(endMs).toISOString().slice(0, 10),
        envFeePct: pricing.envFeePct,
        damageWaiver: false,
        fuelCharge: 0,
        taxRate: this.taxRate(),
        status: 'pending',
      });
      created++;
    }
    this.save();
    return created;
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


  /* --------------------------- policies / pricing ------------------------ */

  /** Active industry vertical (prototype `IMS.metadata.vertical()`). */
  get vertical(): string {
    return this.db.settings.vertical;
  }

  setVertical(v: string): void {
    this.db.settings.vertical = v;
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
    ];
  }


  /** Orders + line items + job-site geofences (prototype `IMS.orders`). */
  private seedOrders(): Order[] {
    return [
      {
        orderId: 'CT-2024-001',
        partyId: 'PTY-001',
        party: 'Halstead Construction',
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
        party: 'Meridian Civil Works',
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
        party: 'Coastal Energy Group',
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
        party: 'Port Authority',
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
        this.stock('SG-LFT-001', 'consumable', 'Lifting Gloves (pair)', 'Safety', 240, 60, 2.1, 5.5),
        this.stock('SG-NS-002', 'consumable', 'Nitrile Gloves (box)', 'Safety', 120, 40, 3.4, 8.25),
        this.stock('FL-HYD-010', 'consumable', 'Hydraulic Fluid 5 gal', 'Fluids', 36, 12, 42, 78),
        this.stock('FL-DSL-005', 'consumable', 'DEF Fluid 2.5 gal', 'Fluids', 55, 15, 14.5, 26),
        this.stock('HW-HLM-003', 'consumable', 'Hard Hat', 'Safety', 48, 20, 11, 22),
        this.stock('VST-VES-001', 'consumable', 'Hi-Vis Safety Vest', 'Safety', 90, 25, 6.2, 14.5),
        this.stock('BP-ENG-020', 'consumable', 'Engine Oil 15W-40 (gal)', 'Fluids', 44, 16, 16.8, 31),
        this.stock('GN-GRL-001', 'consumable', 'Grease Cartridge', 'Fluids', 32, 10, 4.9, 9.75),
      ],
      part: [
        this.stock('PRT-001', 'part', 'Hydraulic Filter 40um', 'Filters', 24, 6, 18.5, 0, 'A-03'),
        this.stock('PRT-002', 'part', 'Air Filter Element', 'Filters', 18, 5, 22, 0, 'A-07'),
        this.stock('PRT-003', 'part', 'Fuel Filter Assembly', 'Filters', 30, 8, 14.75, 0, 'B-01'),
        this.stock('PRT-004', 'part', 'Grease Fitting Kit', 'Hardware', 60, 20, 6.4, 0, 'B-12'),
        this.stock('PRT-005', 'part', 'Hydraulic Hose 1in x 6ft', 'Hoses', 12, 4, 34, 0, 'C-04'),
        this.stock('PRT-006', 'part', 'Track Pin & Bushing Set', 'Hydraulics', 8, 2, 120, 0, 'D-02'),
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
        { id: 'KT-001', type: 'kit', name: 'Traffic Control Kit', category: 'Traffic Control', status: 'Available', qty: 8, rateDaily: 185, notes: 'AB-201 + cones + sandbags', active: true },
        { id: 'KT-002', type: 'kit', name: 'Confined Space Entry Kit', category: 'Confined Space', status: 'Available', qty: 4, rateDaily: 260, notes: 'GA-610 + tripod', active: true },
        { id: 'KT-003', type: 'kit', name: 'Fall Protection Kit', category: 'Fall Protection', status: 'Available', qty: 10, rateDaily: 120, notes: 'Harnesses + lanyards', active: true },
      ],
      attachment: [
        { id: 'ACC-001', type: 'attachment', name: '24" Digging Bucket', category: 'Bucket', status: 'Available', qty: 6, rateDaily: 45, notes: 'Fits ET-310 / ET-311', active: true },
        { id: 'ACC-002', type: 'attachment', name: '36" Ditch Bucket', category: 'Bucket', status: 'Available', qty: 3, rateDaily: 55, notes: 'Fits ET-310 / ET-311', active: true },
        { id: 'ACC-003', type: 'attachment', name: 'Fork Carriage 48 in', category: 'Carriage', status: 'Available', qty: 4, rateDaily: 38, notes: 'Fits TL-605 / FL-401', active: true },
        { id: 'ACC-004', type: 'attachment', name: 'Work Platform Cage', category: 'Platform', status: 'Available', qty: 5, rateDaily: 60, notes: 'Fits BL-118 / BL-119 / BL-120', active: true },
        { id: 'ACC-005', type: 'attachment', name: 'Breaker Attachment', category: 'Hydraulic', status: 'Available', qty: 2, rateDaily: 90, notes: 'Fits ET-310', active: true },
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
    bin?: string,
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
      bin,
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
      active: true,
    };
  }


  /** Append-only chain-of-custody seed (prototype `IMS.movements`). */
  private seedMovements(): Movement[] {
    const rows: [string, string, string, string, string][] = [
      ['BL-119', 'CT-2024-001', 'M. Halstead', '2026-08-20T07:15', 'Delivered to Downtown Plaza site.'],
      ['FL-401', 'CT-2024-001', 'M. Halstead', '2026-08-20T08:05', 'Forklift offloaded with operator handoff.'],
      ['SS-204', 'CT-2024-002', 'L. Bishop', '2026-09-01T06:45', 'Skid steer delivered to bridge site.'],
      ['TL-605', 'CT-2024-002', 'L. Bishop', '2026-09-01T07:10', 'Telehandler staged for Riverside Bridge.'],
      ['GN-511', 'CT-2024-003', 'R. Vance', '2026-09-02T06:30', 'Generator placed at refinery skid.'],
    ];
    return rows.map(([refId, orderId, party, at, note], i) => ({
      id: 'MV-' + String(i + 1).padStart(3, '0'),
      type: 'serialized' as CatalogType,
      refId,
      kind: 'issue' as MovementKind,
      qty: 1,
      orderId,
      party,
      location: 'Main Yard — Buckhead Hub',
      at,
      by: 'D. Reynolds',
      note,
    }));
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
  private seedRentals(): RentalSub[] {
    return [
      { id: 'RR-001', itemId: 'GN-510', assetName: 'Generac 100 kW Generator', orderId: 'CT-2024-003', vendor: 'PowerGen Rentals', vendorCost: 110, retailRate: 175, qty: 1 },
      { id: 'RR-002', itemId: 'FL-402', assetName: 'Toyota Forklift 8FGU25', orderId: 'CT-2024-004', vendor: 'Forklift Fleet Co', vendorCost: 95, retailRate: 205, qty: 1 },
      { id: 'RR-003', itemId: null, assetName: 'Compaction Roller 5T', orderId: 'CT-2024-002', vendor: 'Meridian Tools Supply', vendorCost: 140, retailRate: 260, qty: 1 },
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
}

