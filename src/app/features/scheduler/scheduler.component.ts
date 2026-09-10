import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService, hmMin } from '../../core/data.service';
import { CatalogType, CATALOG_TYPES, ITEM_STATUSES, Item, Order, OrderLine } from '../../core/models';

const DAY_MS = 86400000;
const DAY_W = 90;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_COLORS: Record<string, string> = {
  serialized: '#16a34a', bulk: '#2563eb', consumable: '#d97706', part: '#0891b2',
  labor: '#7c3aed', kit: '#059669', attachment: '#db2777',
};

type View = 'day' | 'week' | 'month';
interface DayCol { start: number; label: string; sub: string; }
interface BarGeom { left: number; width: number; }
interface BarModel {
  orderId: string;
  liId: string | null;
  type: CatalogType | 'order';
  label: string;
  /** Short label shown in the row gutter (prototype `shortItemLabel`). */
  short: string;
  sub: string;
  color: string;
  conflict: boolean;
  geom: BarGeom;
}
interface OrderModel { order: Order; isExpanded: boolean; orderBar: BarModel | null; lines: BarModel[]; }
interface ResizeState { orderId: string; liId: string | null; edge: 'l' | 'r'; track: HTMLElement; }
/** A booking (order line) of one pool item, with its effective window. */
interface BookingRef { orderId: string; start: string; end: string }
/** Pool-card availability state (prototype `resCard` `avail.key`).
 *  Evaluated against the **visible period**, so the badge follows the selected
 *  range; `blocked` only means "not schedulable at all" (a retired item). */
interface Availability { key: 'free' | 'partial' | 'busy' | 'inactive'; blocked: boolean; badge: string; note: string; }

const POOL_TYPES = CATALOG_TYPES.map((t) => ({ key: t.key, label: 'Items (' + t.label + ')' }));

/** Short type labels used by `.type-chip` / row gutters (prototype `TYPE_LABEL`). */
const TYPE_LABEL: Record<string, string> = {
  serialized: 'Serialized',
  bulk: 'Bulk',
  consumable: 'Consumable',
  labor: 'Labor',
  part: 'Part',
  kit: 'Kit',
  attachment: 'Attachment',
};

/** "New <resource>" button copy per pool tab (prototype `poolAddLabel`). */
const POOL_ADD_LABEL: Record<string, string> = {
  serialized: 'New Item (Serialized)',
  bulk: 'New Bulk Item',
  consumable: 'New Consumable',
  part: 'New Stock Part',
  labor: 'New Labor / Crew',
  kit: 'New Kit',
  attachment: 'New Attachment',
};
@Component({
  selector: 'ims-scheduler',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.scss',
})
export class SchedulerComponent implements OnDestroy {
  readonly poolTypes = POOL_TYPES;
  /** Per-type status options, exposed for the New Resource modal. */
  readonly statuses = ITEM_STATUSES;
  view: View = 'week';
  anchor: number = this.startOfDay(new Date());
  poolType: CatalogType = 'serialized';
  selectedOrderId = '';
  expanded = new Set<string>();
  dragging: { type: CatalogType; refId: string } | null = null;
  resizing: ResizeState | null = null;

  /** "New Order" modal (prototype `orderModal` → `openOrderModal`). */
  orderOpen = false;
  orderForm = this.emptyOrder();

  /** "New <resource>" modal (prototype `addPoolResource` → `openAddModal`). */
  resOpen = false;
  resForm = this.emptyRes();

  constructor(readonly data: DataService, private cdr: ChangeDetectorRef) {
    // Anchor the calendar on the first active order's start week (prototype
    // `renderScheduler`), so the seeded orders are on screen immediately.
    const starts = this.orders()
      .map((o) => Date.parse(o.startDate + 'T00:00:00'))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    this.anchor = this.view === 'month'
      ? this.startOfDay(new Date(new Date(starts[0] ?? Date.now()).getFullYear(), new Date(starts[0] ?? Date.now()).getMonth(), 1))
      : this.mondayOf(starts[0] ?? Date.now());
    this.selectedOrderId = this.orders()[0]?.orderId ?? '';
  }

  ngOnDestroy(): void {
    this.detachResize();
  }

  columns(): DayCol[] {
    const out: DayCol[] = [];
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= n; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), i);
        out.push({ start: c.getTime(), label: String(i), sub: DAY_NAMES[c.getDay()] });
      }
    } else if (this.view === 'week') {
      const base = this.mondayOf(this.anchor);
      for (let i = 0; i < 7; i++) {
        const c = this.dayAt(base, i);
        out.push({ start: c, label: DAY_NAMES[new Date(c).getDay()], sub: MONTHS[new Date(c).getMonth()] + ' ' + new Date(c).getDate() });
      }
    } else {
      // Day view: 24 one-hour segments (00:00 .. 23:00)
      for (let h = 0; h < 24; h++) {
        out.push({ start: 0, label: this.pad2(h) + ':00', sub: '' });
      }
    }
    return out;
  }

  colCount(): number { return this.columns().length; }
  viewStart(): number { return this.columns()[0].start; }
  tlWidth(): number { return 170 + this.colCount() * DAY_W; }

  rangeLabel(): string {
    if (this.view === 'day') {
      return (
        new Date(this.anchor).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' · 24h'
      );
    }
    const c = this.columns();
    const a = new Date(c[0].start);
    if (this.view === 'month') return a.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const b = new Date(c[c.length - 1].start);
    return 'Week of ' + a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' + b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  shift(dir: number): void {
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      this.anchor = this.startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      this.anchor = this.startOfDay(new Date(this.dayAt(this.anchor, dir * (this.view === 'week' ? 7 : 1))));
    }
    this.expanded.clear();
    this.selectedOrderId = '';
  }

  /** Switch Day/Week/Month, re-anchoring so the new period contains the cursor
   *  date (prototype `setLabView` / `#viewToggle`). */
  setView(v: View): void {
    this.view = v;
    const a = new Date(this.anchor);
    if (v === 'month') this.anchor = this.startOfDay(new Date(a.getFullYear(), a.getMonth(), 1));
    else if (v === 'week') this.anchor = this.mondayOf(a.getTime());
    else this.anchor = this.startOfDay(a);
  }

  orders(): Order[] { return this.data.listOrders().filter((o) => o.status === 'active'); }
  lanes(): Item[] { return this.data.listItems(this.poolType); }
  selectOrder(id: string): void { this.selectedOrderId = this.selectedOrderId === id ? '' : id; }
  toggleExpand(orderId: string): void { if (this.expanded.has(orderId)) this.expanded.delete(orderId); else this.expanded.add(orderId); }
  onOrderClick(orderId: string): void { this.selectOrder(orderId); this.toggleExpand(orderId); }
  lineStart(li: OrderLine, order: Order): string { return li.startDate ?? order.startDate; }
  lineEnd(li: OrderLine, order: Order): string { return li.endDate ?? order.endDate; }
  itemName(type: CatalogType, refId: string): string { return this.data.itemLabel(type, refId); }

  /** Short type label for chips / row gutters (prototype `TYPE_LABEL`). */
  typeLabel(type: string): string { return TYPE_LABEL[type] ?? type; }

  /** Short item label used in a line row's gutter (prototype `shortItemLabel`). */
  shortItemLabel(li: OrderLine): string {
    const it = this.data.getItem(li.type, li.refId);
    return it ? this.data.mkName(it) || it.name : li.refId;
  }

  /* ------------------------------- header ------------------------------- */

  /** Header grid template — all views shrink columns so the view fits the pane. */
  headColumns(): string {
    if (this.view === 'day') return '120px 1fr';
    if (this.view === 'month') return '120px repeat(' + this.colCount() + ',minmax(0,1fr))';
    return '120px repeat(' + this.colCount() + ',minmax(0,1fr))';
  }

  cornerLabel(): string {
    return this.view === 'day' ? 'Day' : this.view === 'month' ? 'Month' : 'Week';
  }

  /** Minimum timeline width — the calendar is fixed-width and never scrolls sideways. */
  minWidth(): number {
    return 120;
  }

  /** Order bar sub-line: gross · items · days (prototype). */
  orderSub(o: Order): string {
    return `${this.data.money(this.data.orderAmount(o))} · ${o.lineItems.length} items · ${this.data.orderDays(o)}d`;
  }

  /** Tooltip for an order bar (prototype `cTitle`). */
  orderTitle(o: Order): string {
    return (
      `${o.orderId}\n${o.projectName}\n` +
      `${this.data.fmtDate(o.startDate)} ${this.fmtMin(this.orderT0(o))} →\n` +
      `${this.data.fmtDate(o.endDate)} ${this.fmtMin(this.orderT1(o))}`
    );
  }

  /* ---------------------------- pool cards ------------------------------ */

  /**
   * The visible period as inclusive local-midnight millisecond bounds.
   * Day view = the anchor day; Week/Month = the first..last column.
   */
  private rangeBounds(): { start: number; end: number } {
    const cols = this.columns();
    const start = this.view === 'day' ? this.anchor : cols[0].start;
    const last = this.view === 'day' ? this.anchor : cols[cols.length - 1].start;
    return { start, end: this.dayAt(last, 1) - 1 };
  }

  /**
   * Active-order bookings of a pool item that **overlap the visible period**
   * (prototype's `capAvailUI` recomputed per render instead of a fixed state).
   * This is what makes the pool reflect the range selected in the calendar.
   */
  bookingsInRange(item: Item): BookingRef[] {
    const r = this.rangeBounds();
    const out: BookingRef[] = [];
    for (const o of this.orders()) {
      for (const li of o.lineItems) {
        if (li.type !== item.type || li.refId !== item.id) continue;
        const start = this.lineStart(li, o);
        const end = this.lineEnd(li, o);
        const s = new Date(start + 'T00:00:00').getTime();
        const e = new Date(end + 'T00:00:00').getTime() + DAY_MS - 1;
        if (s <= r.end && r.start <= e) out.push({ orderId: o.orderId, start, end });
      }
    }
    return out;
  }

  /**
   * Availability of a pool resource **for the visible period** — the badge/colour
   * update as the Day/Week/Month view, the period pager or the bookings change.
   * A booked item stays schedulable (overbooking is allowed and flagged in the
   * conflicts pane); only a retired unit is refused.
   */
  availability(item: Item): Availability {
    if (item.active === false) {
      return { key: 'inactive', blocked: true, badge: 'Inactive', note: 'Retired — activate it to schedule.' };
    }
    const booked = this.bookingsInRange(item);
    if (booked.length) {
      const orders = [...new Set(booked.map((b) => b.orderId))];
      const detail =
        orders.length === 1
          ? `${orders[0]} (${this.data.fmtDate(booked[0].start)} → ${this.data.fmtDate(booked[0].end)})`
          : orders.join(', ');
      return {
        key: 'busy',
        blocked: false,
        badge: booked.length + ' booked',
        note: 'Booked on ' + detail + ' — drop to overbook.',
      };
    }
    const out = this.data.outInfo(item.id);
    if (out) {
      const where = out.orderId ?? out.party;
      return {
        key: 'partial',
        blocked: false,
        badge: ('On site · ' + (out.orderId ?? '')).trim(),
        note: 'Out now on ' + where + ' — free for ' + this.rangeLabel() + '.',
      };
    }
    if (item.status === 'In Shop') {
      return { key: 'partial', blocked: false, badge: 'In Shop', note: 'In the shop — free to schedule later.' };
    }
    return { key: 'free', blocked: false, badge: '', note: '' };
  }

  /** Badge colour for a pool card's range-aware availability state. */
  poolBadgeClass(a: Availability): string {
    if (a.key === 'busy') return 'st-onrent';
    if (a.key === 'partial') return a.badge.startsWith('On site') ? 'st-out' : 'st-inshop';
    if (a.key === 'inactive') return 'st-closed';
    return 'st-available';
  }

  /** Jump the calendar to an order's start period and expand it (prototype `focusOrder`). */
  focusOrder(id: string): void {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.selectedOrderId = id;
    const stDate = new Date(o.startDate + 'T00:00:00');
    const st = this.startOfDay(stDate);
    if (this.view === 'month') {
      this.anchor = this.startOfDay(new Date(stDate.getFullYear(), stDate.getMonth(), 1));
    } else if (this.view === 'week') {
      this.anchor = this.mondayOf(st);
    } else {
      this.anchor = st;
    }
    this.expanded.add(id);
  }

  /* ------------------------------- create ------------------------------- */

  /** Pool add-button copy, switching with the tab (prototype `poolAddLabel`). */
  poolAddLabel(): string {
    return POOL_ADD_LABEL[this.poolType] ?? 'New Resource';
  }

  /** First day of the visible period (ISO) — the new-order window default. */
  private periodStartISO(): string {
    return this.view === 'day' ? this.dateAt(this.anchor) : this.dateAt(this.viewStart());
  }

  private addDaysISO(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return this.dateAt(d.getTime());
  }

  /** Open the New Order editor (prototype `orderModal`). */
  openOrder(): void {
    const start = this.periodStartISO();
    const party = this.data.listParties()[0];
    this.orderForm = {
      active: true,
      partyId: party?.id ?? '',
      projectName: '',
      jobSite: party?.billingAddress ?? '',
      geofenceRadius: 300,
      siteLat: this.data.yard.lat,
      siteLng: this.data.yard.lng,
      startDate: start,
      startTime: '07:00',
      endDate: this.addDaysISO(start, 14),
      endTime: '17:00',
    };
    this.orderOpen = true;
  }

  /** Create the order and focus it on the timeline (prototype `c-save`). */
  saveOrder(): void {
    const f = this.orderForm;
    const party = this.data.getParty(f.partyId);
    if (!party || !f.projectName.trim()) return;
    const created = this.data.createOrder({
      partyId: party.id,
      party: party.name,
      projectName: f.projectName.trim(),
      jobSite: f.jobSite.trim() || party.billingAddress || '—',
      startDate: f.startDate,
      endDate: f.endDate,
      geofenceRadius: Number(f.geofenceRadius) || 300,
      siteLat: Number(f.siteLat) || this.data.yard.lat,
      siteLng: Number(f.siteLng) || this.data.yard.lng,
      t0: hmMin(f.startTime),
      t1: hmMin(f.endTime),
    });
    if (!f.active) this.data.updateOrderStatus(created.orderId, 'closed');
    this.orderOpen = false;
    this.focusOrder(created.orderId);
  }

  closeOrder(): void {
    this.orderOpen = false;
  }

  /** Open the New <resource> editor for the active pool tab (prototype `addPoolResource`). */
  openRes(): void {
    this.resForm = {
      ...this.emptyRes(),
      category: this.data.categoriesFor(this.poolType)[0] ?? '',
      status: ITEM_STATUSES[this.poolType][0],
      lat: this.data.yard.lat,
      lng: this.data.yard.lng,
    };
    this.resOpen = true;
  }

  /** Create the resource so it lands in the pool immediately (prototype `itemWrite`). */
  saveRes(): void {
    const f = this.resForm;
    if (!f.name.trim()) return;
    const patch: Record<string, unknown> = {
      name: f.name.trim(),
      category: f.category,
      status: f.status,
      qty: Number(f.qty) || 0,
      rateDaily: Number(f.rateDaily) || 0,
    };
    if (this.poolType === 'serialized') {
      Object.assign(patch, {
        make: f.make,
        model: f.model,
        serial: f.serial,
        meterHours: Number(f.meterHours) || 0,
        fuelType: f.fuelType,
        purchaseValue: Number(f.purchaseValue) || 0,
        lat: Number(f.lat) || this.data.yard.lat,
        lng: Number(f.lng) || this.data.yard.lng,
      });
    }
    if (this.poolType === 'consumable' || this.poolType === 'part') {
      Object.assign(patch, {
        qtyOnHand: Number(f.qtyOnHand) || 0,
        reorderPoint: Number(f.reorderPoint) || 0,
        costPrice: Number(f.costPrice) || 0,
        retailPrice: Number(f.retailPrice) || 0,
        bin: f.bin,
      });
    }
    if (this.poolType === 'labor') {
      Object.assign(patch, {
        role: f.role,
        hourlyCost: Number(f.hourlyCost) || 0,
        hourlyBillable: Number(f.hourlyBillable) || 0,
      });
    }
    this.data.createItem(this.poolType, patch as unknown as Omit<Item, 'type' | 'id'>);
    this.resOpen = false;
  }

  closeRes(): void {
    this.resOpen = false;
  }
  dateAt(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** Local midnight `i` days after the local midnight at `base` (DST-safe). */
  dayAt(base: number, i: number): number {
    const d = new Date(base);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime();
  }

  private pad2(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }
  orderT0(o: Order): number { return this.data.orderT0(o); }
  orderT1(o: Order): number { return this.data.orderT1(o); }
  lineT0(li: OrderLine, o: Order): number { return li.t0 ?? this.orderT0(o); }
  lineT1(li: OrderLine, o: Order): number { return li.t1 ?? this.orderT1(o); }

  /** Does this order's date window include the Day-view anchor? */
  private dateIncludes(o: Order): boolean {
    const day = new Date(this.anchor);
    day.setHours(0, 0, 0, 0);
    const d = day.getTime();
    const s = new Date(o.startDate + 'T00:00:00').getTime();
    const e = new Date(o.endDate + 'T00:00:00').getTime() + DAY_MS - 1;
    return d >= s && d <= e;
  }

  /** Percentage geometry across the 24-hour day (0..1440 minutes). */
  private geomMin(t0: number, t1: number): BarGeom | null {
    const l = Math.max(0, Math.min(1440, t0));
    const r = Math.max(0, Math.min(1440, t1));
    if (r <= l) return null;
    return { left: (l / 1440) * 100, width: ((r - l) / 1440) * 100 };
  }

  fmtMin(t: number): string {
    return this.pad2(Math.floor(t / 60)) + ':' + this.pad2(Math.round(t % 60));
  }

  geom(startISO: string, endISO: string): BarGeom | null {
    const N = this.colCount();
    const view = this.viewStart();
    // Day index from LOCAL midnights (never floor raw epoch — that is UTC and
    // would make indices fractional in non-UTC timezones, mis-sizing the bars).
    const dayIndex = (iso: string): number =>
      Math.round((new Date(iso + 'T00:00:00').getTime() - view) / DAY_MS);
    const sIdx = dayIndex(startISO);
    const eIdx = dayIndex(endISO);
    if (eIdx < 0 || sIdx >= N) return null;
    const cs = Math.max(0, sIdx);
    const ce = Math.min(N - 1, eIdx);
    return { left: (cs / N) * 100, width: ((ce - cs + 1) / N) * 100 };
  }

  lineDays(li: OrderLine, order: Order): number {
    const s = new Date(this.lineStart(li, order) + 'T00:00:00').getTime();
    const e = new Date(this.lineEnd(li, order) + 'T00:00:00').getTime();
    return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
  }

  private isConflicted(li: OrderLine, order: Order): boolean {
    const s = new Date(this.lineStart(li, order) + 'T00:00:00').getTime();
    const e = new Date(this.lineEnd(li, order) + 'T00:00:00').getTime();
    for (const other of this.orders()) {
      if (other.orderId === order.orderId) continue;
      for (const ol of other.lineItems) {
        if (ol.type !== li.type || ol.refId !== li.refId) continue;
        const os = new Date(this.lineStart(ol, other) + 'T00:00:00').getTime();
        const oe = new Date(this.lineEnd(ol, other) + 'T00:00:00').getTime();
        if (s <= oe && os <= e) return true;
      }
    }
    return false;
  }

  models(): OrderModel[] {
    const isDay = this.view === 'day';
    return this.orders().map((o) => {
      let og: BarGeom | null = null;
      let oSub = o.lineItems.length + ' items';
      if (isDay) {
        if (this.dateIncludes(o)) {
          og = this.geomMin(this.orderT0(o), this.orderT1(o));
          oSub = this.fmtMin(this.orderT0(o)) + '–' + this.fmtMin(this.orderT1(o));
        }
      } else {
        og = this.geom(o.startDate, o.endDate);
      }
      const orderBar: BarModel | null = og
        ? {
            orderId: o.orderId,
            liId: null,
            type: 'order',
            label: o.orderId,
            short: o.orderId,
            sub: oSub,
            color: '#334155',
            conflict: false,
            geom: og,
          }
        : null;
      const lines: BarModel[] = [];
      for (const li of o.lineItems) {
        let lg: BarGeom | null = null;
        let sub = '';
        if (isDay) {
          if (this.dateIncludes(o)) {
            const t0 = Math.max(this.orderT0(o), Math.min(this.orderT1(o), this.lineT0(li, o)));
            const t1 = Math.max(t0, Math.min(this.orderT1(o), this.lineT1(li, o)));
            lg = this.geomMin(t0, t1);
            sub = this.fmtMin(t0) + '–' + this.fmtMin(t1);
          }
        } else {
          lg = this.geom(this.lineStart(li, o), this.lineEnd(li, o));
          sub = this.lineDays(li, o) + 'd';
        }
        if (!lg) continue;
        const conflict = !isDay && this.isConflicted(li, o);
        lines.push({
          orderId: o.orderId,
          liId: li.id,
          type: li.type,
          label: this.itemName(li.type, li.refId),
          short: this.shortItemLabel(li),
          sub: sub + (conflict ? ' - CONFLICT' : ''),
          color: TYPE_COLORS[li.type] ?? '#334155',
          conflict,
          geom: lg,
        });
      }
      return { order: o, isExpanded: this.expanded.has(o.orderId), orderBar, lines };
    });
  }

  conflictCount(): number {
    let n = 0;
    for (const m of this.models()) for (const l of m.lines) if (l.conflict) n++;
    return n;
  }

  /** Flat conflict list for the inspector pane (prototype `renderInspector`). */
  conflicts(): { type: CatalogType; refId: string; orderId: string; label: string }[] {
    const out: { type: CatalogType; refId: string; orderId: string; label: string }[] = [];
    for (const m of this.models()) {
      for (const line of m.lines) {
        if (!line.conflict) continue;
        const li = m.order.lineItems.find((l) => l.id === line.liId);
        if (!li) continue;
        out.push({ type: li.type, refId: li.refId, orderId: m.order.orderId, label: line.label });
      }
    }
    return out;
  }

  onPoolStart(e: Event, item: Item): void {
    (e as DragEvent).dataTransfer?.setData('text/plain', item.type + '|' + item.id);
    this.dragging = { type: item.type, refId: item.id };
  }
  onDragEnd(): void { this.dragging = null; }
  allowDrop(e: Event): void { e.preventDefault(); }

  onDropOrder(e: Event, orderId: string): void {
    e.preventDefault();
    const raw = (e as DragEvent).dataTransfer?.getData('text/plain');
    this.dragging = null;
    if (!raw) return;
    const [type, refId] = raw.split('|');
    const t = type as CatalogType;
    const order = this.data.getOrder(orderId);
    if (!order) return;
    // Only a retired item is refused — an item that is already booked (or out on
    // custody) can still be scheduled; the conflicts pane flags the overbook.
    const item = this.data.getItem(t, refId);
    if (item && this.availability(item).blocked) return;
    this.data.addOrderLine(order.orderId, { type: t, refId, qty: 1 });
    this.selectedOrderId = order.orderId;
    this.expanded.add(order.orderId);
  }

  startResize(e: PointerEvent, bar: BarModel, edge: 'l' | 'r'): void {
    e.preventDefault();
    e.stopPropagation();
    // The track carries the geometry for both the order bar and the line bars.
    const track = (e.target as Element).closest('.tl-row-track') as HTMLElement | null;
    if (!track) return;
    this.resizing = { orderId: bar.orderId, liId: bar.liId, edge, track };
    const move = (ev: PointerEvent) => this.onResizeMove(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.resizing = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private onResizeMove(ev: PointerEvent): void {
    const r = this.resizing;
    if (!r) return;
    const rect = r.track.getBoundingClientRect();
    const order = this.data.getOrder(r.orderId);
    if (!order) return;

    // Day view: 15-minute snapping across the 24-hour day.
    if (this.view === 'day') {
      const mins = Math.round((((ev.clientX - rect.left) / rect.width) * 1440) / 15) * 15;
      if (r.liId == null) {
        let a = this.data.orderT0(order);
        let b = this.data.orderT1(order);
        if (r.edge === 'l') { a = mins; if (b < a) b = a; }
        else { b = mins; if (a > b) a = b; }
        this.data.updateOrderTimes(order.orderId, a, b);
      } else {
        const li = order.lineItems.find((l) => l.id === r.liId);
        if (!li) return;
        const lo = this.data.orderT0(order);
        const hi = this.data.orderT1(order);
        const m = Math.max(lo, Math.min(hi, mins));
        let a = this.lineT0(li, order);
        let b = this.lineT1(li, order);
        if (r.edge === 'l') { a = m; if (b < a) b = a; }
        else { b = m; if (a > b) a = b; }
        this.data.updateOrderLineTimes(order.orderId, li.id, a, b);
      }
      this.cdr.detectChanges();
      return;
    }

    // Week / Month: day-granular date snapping.
    const idx = Math.min(this.colCount() - 1, Math.max(0, Math.floor(((ev.clientX - rect.left) / rect.width) * this.colCount())));
    const day = this.dateAt(this.dayAt(this.viewStart(), idx));
    if (r.liId == null) {
      let ns = order.startDate;
      let ne = order.endDate;
      if (r.edge === 'l') { ns = day; if (Date.parse(ns + 'T00:00:00') > Date.parse(ne + 'T00:00:00')) ne = ns; }
      else { ne = day; if (Date.parse(ne + 'T00:00:00') < Date.parse(ns + 'T00:00:00')) ns = ne; }
      this.data.updateOrderDates(order.orderId, ns, ne);
    } else {
      const li = order.lineItems.find((l) => l.id === r.liId);
      if (!li) return;
      let ns = this.lineStart(li, order);
      let ne = this.lineEnd(li, order);
      if (r.edge === 'l') { ns = day; if (Date.parse(ns + 'T00:00:00') > Date.parse(ne + 'T00:00:00')) ne = ns; }
      else { ne = day; if (Date.parse(ne + 'T00:00:00') < Date.parse(ns + 'T00:00:00')) ns = ne; }
      this.data.updateOrderLineDates(r.orderId, r.liId, ns, ne);
    }
    this.cdr.detectChanges();
  }

  detachResize(): void { this.resizing = null; }

  /** Blank New Order form (no service access — safe as a field initializer). */
  private emptyOrder() {
    return {
      active: true,
      partyId: '',
      projectName: '',
      jobSite: '',
      geofenceRadius: 300,
      siteLat: 33.749,
      siteLng: -84.388,
      startDate: '',
      startTime: '07:00',
      endDate: '',
      endTime: '17:00',
    };
  }

  /** Blank New Resource form (no service access — safe as a field initializer). */
  private emptyRes() {
    return {
      name: '',
      category: '',
      status: 'Available' as Item['status'],
      qty: 1,
      rateDaily: 0,
      make: '',
      model: '',
      serial: '',
      meterHours: 0,
      fuelType: 'Diesel',
      purchaseValue: 0,
      qtyOnHand: 0,
      reorderPoint: 0,
      costPrice: 0,
      retailPrice: 0,
      bin: '',
      role: '',
      hourlyCost: 0,
      hourlyBillable: 0,
      lat: 33.749,
      lng: -84.388,
    };
  }
  private startOfDay(d: Date): number {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }
  private mondayOf(ms: number): number {
    const x = new Date(ms);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return this.startOfDay(x);
  }
}
