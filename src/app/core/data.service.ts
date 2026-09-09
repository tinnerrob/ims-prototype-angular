import { Injectable } from '@angular/core';

import {
  CatalogType,
  CATALOG_TYPE_KEYS,
  Item,
  Inspection,
  Location,
  Movement,
  MovementKind,
  Order,
  OrderLine,
  OrderStatus,
  Party,
  RentalSub,
  Dispatch,
  DispatchStatus,
  Timesheet,
  Vehicle,
  Invoice,
  InvoiceStatus,
  WorkOrder,
  WorkOrderStatus,
} from './models';

/**
 * IMS — DataService (the JSON store / API seam).
 *
 * Faithful first port of the prototype's `IMS.store`: a small in-memory
 * database behind typed accessors, persisted to localStorage, versioned so a
 * stale snapshot is ignored on upgrade. A future `HttpClient` adapter can swap
 * these synchronous methods for async JSON without touching feature code.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly KEY = 'ims-web.store';
  private readonly VERSION = 1;

  private db: {
    settings: { categories: Record<string, string[]> };
    parties: Party[];
    orders: Order[];
    items: Record<string, Item[]>;
    movements: Movement[];
    locations: Location[];
    inspections: Inspection[];
    workOrders: WorkOrder[];
    timesheets: Timesheet[];
    rentals: RentalSub[];
    vehicles: Vehicle[];
    dispatches: Dispatch[];
    invoices: Invoice[];
  } = {
    settings: { categories: this.seedCategories() },
    parties: this.seedParties(),
    orders: this.seedOrders(),
    items: this.seedItems(),
    movements: this.seedMovements(),
    locations: this.seedLocations(),
    inspections: this.seedInspections(),
    workOrders: this.seedWorkOrders(),
    timesheets: this.seedTimesheets(),
    rentals: this.seedRentals(),
    vehicles: this.seedVehicles(),
    dispatches: this.seedDispatches(),
    invoices: [],
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
      if (Array.isArray(snap.parties)) this.db.parties = snap.parties;
      if (Array.isArray(snap.orders)) this.db.orders = snap.orders;
      if (snap.items && typeof snap.items === 'object') this.db.items = snap.items;
      if (Array.isArray(snap.movements)) this.db.movements = snap.movements;
      if (Array.isArray(snap.locations)) this.db.locations = snap.locations;
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
          parties: this.db.parties,
          orders: this.db.orders,
          items: this.db.items,
          movements: this.db.movements,
          locations: this.db.locations,
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
    let s = Date.parse(startISO + 'T00:00:00');
    let e = Date.parse(endISO + 'T00:00:00');
    if (e < s) e = s;
    order.startDate = iso(s);
    order.endDate = iso(e);
    for (const li of order.lineItems) {
      let ls = Date.parse((li.startDate ?? order.startDate) + 'T00:00:00');
      let le = Date.parse((li.endDate ?? order.endDate) + 'T00:00:00');
      ls = Math.max(s, Math.min(e, ls));
      le = Math.min(e, Math.max(ls, le));
      li.startDate = iso(ls);
      li.endDate = iso(le);
    }
    this.save();
  }

  /** Minutes-of-day window (defaults 08:00–17:00). */
  orderT0(order: Order): number { return order.t0 ?? 480; }
  orderT1(order: Order): number { return order.t1 ?? 1020; }

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

  private nextLineId(order: Order): string {
    let max = 0;
    for (const l of order.lineItems) {
      const n = Number(l.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'LI-' + String(max + 1).padStart(3, '0');
  }

  /* ------------------------------- items -------------------------------- */

  private static readonly ID_PREFIX: Record<string, string> = {
    serialized: 'EQ-',
    bulk: 'BLK-',
    consumable: 'CN-',
    part: 'PRT-',
    labor: 'EMP-',
    kit: 'KIT-',
    attachment: 'ACC-',
  };

  listItems(type: CatalogType): Item[] {
    return [...(this.db.items[type] ?? [])];
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

  private nextItemId(type: CatalogType): string {
    const prefix = DataService.ID_PREFIX[type] ?? 'IT-';
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

  /* ------------------------------ categories ---------------------------- */

  /** Live, mutable per-type category arrays (names), seeded for every type. */
  get categories(): Record<string, string[]> {
    return this.db.settings.categories;
  }

  categoriesFor(type: CatalogType): string[] {
    return [...(this.db.settings.categories[type] ?? [])];
  }

  addCategory(type: CatalogType, name: string): void {
    const list = (this.db.settings.categories[type] ??= []);
    const clean = name.trim();
    if (!clean || list.includes(clean)) return;
    list.push(clean);
    this.save();
  }

  renameCategory(type: CatalogType, oldName: string, newName: string): void {
    const list = this.db.settings.categories[type];
    const clean = newName.trim();
    if (!list || !clean) return;
    const i = list.indexOf(oldName);
    if (i >= 0 && !list.includes(clean)) {
      list[i] = clean;
      this.save();
    }
  }

  removeCategory(type: CatalogType, name: string): void {
    const list = this.db.settings.categories[type];
    if (!list) return;
    const i = list.indexOf(name);
    if (i >= 0) {
      list.splice(i, 1);
      this.save();
    }
  }

  /** Ensure every catalog type has a (possibly empty) category array. */
  ensureCategoryTables(): void {
    for (const t of CATALOG_TYPE_KEYS) {
      this.db.settings.categories[t] ??= [];
    }
    this.save();
  }

  /* -------------------------------- seeds ------------------------------- */

  /* ----------------------------- timesheets ----------------------------- */

  listTimesheets(): Timesheet[] {
    return [...this.db.timesheets].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  createTimesheet(data: Omit<Timesheet, 'id'>): Timesheet {
    const rec: Timesheet = { ...data, id: this.nextTimesheetId() };
    this.db.timesheets.push(rec);
    this.save();
    return rec;
  }

  removeTimesheet(id: string): void {
    const i = this.db.timesheets.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.timesheets.splice(i, 1);
      this.save();
    }
  }

  totalHours(): number {
    return this.db.timesheets.reduce((s, t) => s + t.hours, 0);
  }

  private nextTimesheetId(): string {
    let max = 0;
    for (const t of this.db.timesheets) {
      const n = Number(t.id.split('-')[1]);
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
    return (r.retailRate - r.vendorCost) * r.qty;
  }

  private nextRentalId(): string {
    let max = 0;
    for (const r of this.db.rentals) {
      const n = Number(r.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'RR-' + String(max + 1).padStart(3, '0');
  }

  /* ---------------------------- dispatch -------------------------------- */

  listVehicles(): Vehicle[] {
    return [...this.db.vehicles];
  }

  listDispatches(): Dispatch[] {
    return [...this.db.dispatches];
  }

  createDispatch(data: Omit<Dispatch, 'id' | 'orderLabel' | 'status'> & { status?: DispatchStatus }): Dispatch {
    const order = this.getOrder(data.orderId);
    const rec: Dispatch = {
      ...data,
      id: this.nextDispatchId(),
      orderLabel: order ? `${order.orderId} · ${order.projectName}` : data.orderId,
      status: data.status ?? 'Staged',
    };
    this.db.dispatches.push(rec);
    this.save();
    return rec;
  }

  setDispatchStatus(id: string, status: DispatchStatus): void {
    const d = this.db.dispatches.find((x) => x.id === id);
    if (d) {
      d.status = status;
      this.save();
    }
  }

  removeDispatch(id: string): void {
    const i = this.db.dispatches.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.dispatches.splice(i, 1);
      this.save();
    }
  }

  vehicleName(id: string): string {
    return this.db.vehicles.find((v) => v.id === id)?.name ?? id;
  }

  private nextDispatchId(): string {
    let max = 0;
    for (const d of this.db.dispatches) {
      const n = Number(d.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'DSP-' + String(max + 1).padStart(3, '0');
  }

  /* ----------------------------- billing -------------------------------- */

  listInvoices(): Invoice[] {
    return [...this.db.invoices];
  }

  activeOrders() {
    return this.db.orders.filter((o) => o.status === 'active');
  }

  /** Whole days spanned by an order window (inclusive). */
  orderDays(order: Order): number {
    const s = Date.parse(order.startDate + 'T00:00:00');
    const e = Date.parse(order.endDate + 'T00:00:00');
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
  }

  /** Simple cycle amount: sum of rateDaily * qty * days across the order lines. */
  orderAmount(order: Order): number {
    const days = this.orderDays(order);
    const total = order.lineItems.reduce((sum, li) => {
      const item = this.getItem(li.type, li.refId);
      const rate = item?.rateDaily ?? 0;
      return sum + rate * li.qty * days;
    }, 0);
    return Math.round(total * 100) / 100;
  }

  invoiceFor(orderId: string): Invoice | undefined {
    return this.db.invoices.find((i) => i.orderId === orderId);
  }

  /** Invoice every active order that does not yet have one. Returns count created. */
  generateInvoices(): number {
    let created = 0;
    for (const o of this.activeOrders()) {
      if (this.invoiceFor(o.orderId)) continue;
      const amount = this.orderAmount(o);
      this.db.invoices.push({
        id: this.nextInvoiceId(),
        orderId: o.orderId,
        orderLabel: `${o.orderId} · ${o.projectName}`,
        amount,
        periodStart: o.startDate,
        periodEnd: o.endDate,
        status: 'pending',
      });
      created++;
    }
    this.save();
    return created;
  }

  markInvoicePaid(id: string): void {
    const inv = this.db.invoices.find((i) => i.id === id);
    if (inv) {
      inv.status = 'paid';
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

  totalBilled(): number {
    return this.db.invoices.reduce((s, i) => s + i.amount, 0);
  }

  private nextInvoiceId(): string {
    let max = 0;
    for (const i of this.db.invoices) {
      const n = Number(i.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'INV-' + String(max + 1).padStart(3, '0');
  }

  /* ---------------------------- work orders ----------------------------- */

  listWorkOrders(): WorkOrder[] {
    return [...this.db.workOrders].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  }

  createWorkOrder(data: Omit<WorkOrder, 'id' | 'status'> & { status?: WorkOrderStatus }): WorkOrder {
    const rec: WorkOrder = { ...data, id: this.nextWorkOrderId(), status: data.status ?? 'Open' };
    this.db.workOrders.push(rec);
    this.save();
    return rec;
  }

  setWorkOrderStatus(id: string, status: WorkOrderStatus): void {
    const w = this.db.workOrders.find((x) => x.id === id);
    if (w) {
      w.status = status;
      this.save();
    }
  }

  removeWorkOrder(id: string): void {
    const i = this.db.workOrders.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.workOrders.splice(i, 1);
      this.save();
    }
  }

  private nextWorkOrderId(): string {
    let max = 0;
    for (const w of this.db.workOrders) {
      const n = Number(w.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'WO-' + String(max + 1).padStart(3, '0');
  }

  /* ---------------------------- inspections ----------------------------- */

  listInspections(): Inspection[] {
    return [...this.db.inspections].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  createInspection(data: Omit<Inspection, 'id'>): Inspection {
    const rec: Inspection = { ...data, id: this.nextInspectionId() };
    this.db.inspections.push(rec);
    this.save();
    return rec;
  }

  closeInspection(id: string): void {
    const r = this.db.inspections.find((x) => x.id === id);
    if (r) {
      r.status = 'Closed';
      this.save();
    }
  }

  removeInspection(id: string): void {
    const i = this.db.inspections.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.db.inspections.splice(i, 1);
      this.save();
    }
  }

  private nextInspectionId(): string {
    let max = 0;
    for (const r of this.db.inspections) {
      const n = Number(r.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'INS-' + String(max + 1).padStart(3, '0');
  }

  /* ----------------------------- locations ------------------------------ */

  listLocations(): Location[] {
    return [...this.db.locations];
  }

  createLocation(data: Omit<Location, 'id'>): Location {
    const rec: Location = { ...data, id: this.nextLocationId() };
    this.db.locations.push(rec);
    this.save();
    return rec;
  }

  updateLocation(id: string, patch: Partial<Location>): void {
    const loc = this.db.locations.find((l) => l.id === id);
    if (loc) {
      Object.assign(loc, patch);
      this.save();
    }
  }

  removeLocation(id: string): void {
    const i = this.db.locations.findIndex((l) => l.id === id);
    if (i >= 0) {
      this.db.locations.splice(i, 1);
      this.save();
    }
  }

  private nextLocationId(): string {
    let max = 0;
    for (const l of this.db.locations) {
      const n = Number(l.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'LOC-' + String(max + 1).padStart(3, '0');
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
      if (it) it.status = input.kind === 'issue' ? 'On Rent' : 'Available';
    }
    this.save();
    return rec;
  }

  /** Serialized items currently out (On Rent) — active custody. */
  custodyItems(): Item[] {
    return this.listItems('serialized').filter((i) => i.status === 'On Rent');
  }

  /** Serialized items free to issue. */
  availableItems(): Item[] {
    return this.listItems('serialized').filter((i) => i.status === 'Available');
  }

  itemLabel(type: CatalogType, id: string): string {
    const it = this.getItem(type, id);
    return it ? `${it.id} · ${it.name}` : id;
  }

  private nextMovementId(): string {
    let max = 0;
    for (const m of this.db.movements) {
      const n = Number(m.id.split('-')[1]);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return 'MV-' + String(max + 1).padStart(4, '0');
  }

  private seedCategories(): Record<string, string[]> {
    return {
      serialized: ['Boom Lifts', 'Scissor Lifts', 'Forklifts', 'Excavators', 'Cranes'],
      bulk: ['Bulk Materials', 'Concrete', 'Sand & Gravel'],
      consumable: ['Filters', 'Hoses', 'Lubricants'],
      part: ['Filters', 'Hardware', 'Hoses', 'Hydraulics'],
      labor: ['Operators', 'Technicians', 'CDL Drivers'],
      kit: ['Lift Kits', 'Pump Kits'],
      attachment: ['Buckets', 'Augers', 'Grapples'],
    };
  }

  private seedParties(): Party[] {
    return [
      { id: 'PTY-001', name: 'Halstead Construction', contact: 'M. Halstead', phone: '(404) 555-0134', email: 'projects@halstead.com', billingAddress: '100 Peachtree Pkwy NE, Atlanta, GA', billingCycle: 'weekly', notes: 'Boom & aerial work; weekly cadence.', active: true },
      { id: 'PTY-002', name: 'Meridian Civil Works', contact: 'L. Bishop', phone: '(678) 555-0192', email: 'ops@meridiancivil.com', billingAddress: '88 River Rd, Atlanta, GA', billingCycle: 'bi-weekly', notes: 'Bridge / heavy civil. Net-30 terms.', active: true },
      { id: 'PTY-003', name: 'Coastal Energy Group', contact: 'R. Vance', phone: '(404) 555-0117', email: 'supply@coastalenergy.com', billingAddress: '1 Fuel Pier, Savannah, GA', billingCycle: 'monthly', notes: 'Refinery/hazmat; risk premium applies.', active: true },
    ];
  }

  private seedOrders(): Order[] {
    return [
      {
        orderId: 'CT-2026-001',
        partyId: 'PTY-001',
        party: 'Halstead Construction',
        projectName: 'Downtown Plaza Renovation',
        jobSite: '245 Peachtree St, Atlanta, GA',
        startDate: '2026-08-20',
        endDate: '2026-09-10',
        status: 'active',
        lineItems: [
          { id: 'LI-101', type: 'serialized', refId: 'BL-119', qty: 1 },
          { id: 'LI-102', type: 'serialized', refId: 'FL-401', qty: 1 },
          { id: 'LI-103', type: 'bulk', refId: 'CN-018', qty: 50 },
        ],
      },
      {
        orderId: 'CT-2026-002',
        partyId: 'PTY-002',
        party: 'Meridian Civil Works',
        projectName: 'River Crossing — Phase 1',
        jobSite: '88 River Rd, Atlanta, GA',
        startDate: '2026-09-01',
        endDate: '2026-10-05',
        status: 'active',
        lineItems: [{ id: 'LI-201', type: 'serialized', refId: 'SS-204', qty: 1 }],
      },
    ];
  }

  private seedItems(): Record<string, Item[]> {
    return {
      serialized: [
        { id: 'EQ-101', type: 'serialized', name: 'JLG 340AJ Boom Lift 40ft', category: 'Boom Lifts', status: 'Available', qty: 1, rateDaily: 320 },
        { id: 'EQ-102', type: 'serialized', name: 'JLG 1930ES Scissor Lift', category: 'Scissor Lifts', status: 'On Rent', qty: 1, rateDaily: 180 },
        { id: 'EQ-103', type: 'serialized', name: 'CAT 315 Excavator', category: 'Excavators', status: 'In Shop', qty: 1, rateDaily: 640 },
      ],
      bulk: [
        { id: 'BLK-011', type: 'bulk', name: 'Crusher Run Stone', category: 'Bulk Materials', status: 'Available', qty: 200, rateDaily: 4 },
      ],
      consumable: [
        { id: 'CN-020', type: 'consumable', name: 'Hydraulic Filter 40um', category: 'Filters', status: 'In Stock', qty: 24, rateDaily: 0 },
      ],
      part: [
        { id: 'PRT-006', type: 'part', name: 'Track Pin & Bushing Set', category: 'Hydraulics', status: 'In Stock', qty: 8, rateDaily: 0 },
      ],
      labor: [
        { id: 'EMP-001', type: 'labor', name: 'Daniel Reynolds', category: 'Operators', status: 'Active', qty: 1, rateDaily: 320, notes: 'Equipment operator' },
        { id: 'EMP-002', type: 'labor', name: 'S. Mercer', category: 'Technicians', status: 'Active', qty: 1, rateDaily: 0 },
      ],
      kit: [],
      attachment: [
        { id: 'ACC-050', type: 'attachment', name: '48" Bucket', category: 'Buckets', status: 'Available', qty: 1, rateDaily: 60 },
      ],
    };
  }

  private seedMovements(): Movement[] {
    return [
      { id: 'MV-0001', type: 'serialized', refId: 'EQ-102', orderId: 'CT-2026-001', party: 'Halstead Construction', kind: 'issue', qty: 1, at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), by: 'D. Reynolds', note: 'Issued to order CT-2026-001' },
    ];
  }

  private seedLocations(): Location[] {
    return [
      { id: 'LOC-001', name: 'Main Yard — Buckhead Hub', type: 'yard', address: 'Buckhead, Atlanta, GA' },
      { id: 'LOC-002', name: 'Atlanta Branch', type: 'branch', address: 'Atlanta, GA', parentId: 'LOC-001' },
      { id: 'LOC-003', name: 'Savannah Yard', type: 'yard', address: 'Savannah, GA' },
      { id: 'LOC-004', name: 'Parts Warehouse A', type: 'warehouse', address: 'Atlanta, GA', parentId: 'LOC-002' },
    ];
  }

  private seedInspections(): Inspection[] {
    return [
      { id: 'INS-001', itemId: 'EQ-101', date: new Date().toISOString().slice(0, 10), direction: 'out', meter: 2210, fuel: 85, notes: 'Issued out — clean.', status: 'Open' },
      { id: 'INS-002', itemId: 'EQ-103', date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), direction: 'in', meter: 3180, fuel: 40, notes: 'Returned from shop.', status: 'Closed' },
    ];
  }

  private seedWorkOrders(): WorkOrder[] {
    return [
      { id: 'WO-001', itemId: 'EQ-103', title: 'Hydraulic leak repair', serviceType: 'Repair', status: 'Open', priority: 'high', openedAt: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), notes: 'Bucket tilt line weeping.' },
      { id: 'WO-002', itemId: 'EQ-101', title: '50-hour service', serviceType: 'Preventive', status: 'In Progress', priority: 'normal', openedAt: new Date(Date.now() - 86400000).toISOString().slice(0, 10) },
    ];
  }

  private seedTimesheets(): Timesheet[] {
    return [
      { id: 'TS-0001', empId: 'EMP-001', date: new Date().toISOString().slice(0, 10), hours: 8, orderId: 'CT-2026-001', targetLabel: 'CT-2026-001 · Downtown Plaza', note: 'Boom operator' },
      { id: 'TS-0002', empId: 'EMP-001', date: new Date().toISOString().slice(0, 10), hours: 4, orderId: null, targetLabel: 'Shop', note: 'Maintenance support' },
    ];
  }

  private seedRentals(): RentalSub[] {
    return [
      { id: 'RR-001', itemId: null, assetName: 'Generac 100 kW Generator', vendor: 'PowerGen Rentals', vendorCost: 110, retailRate: 175, qty: 1, note: 'Backfill for EQ fleet' },
    ];
  }

  private seedVehicles(): Vehicle[] {
    return [
      { id: 'TRK-01', name: 'Freightliner M2 26 ft', plate: 'ABC-4521', status: 'Available' },
      { id: 'TRK-02', name: 'F-550 Flatbed', plate: 'XYZ-7789', status: 'Available' },
      { id: 'TRK-03', name: 'Isuzu NPR Box', plate: 'QRS-9912', status: 'Available' },
    ];
  }

  private seedDispatches(): Dispatch[] {
    return [
      { id: 'DSP-001', orderId: 'CT-2026-001', orderLabel: 'CT-2026-001 · Downtown Plaza Renovation', itemId: 'EQ-101', vehicleId: 'TRK-01', status: 'En Route' },
    ];
  }
}
