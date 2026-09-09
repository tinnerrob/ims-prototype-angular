import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { CatalogType, CATALOG_TYPES, Item, Order, OrderLine } from '../../core/models';

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
interface BarModel { orderId: string; liId: string | null; label: string; sub: string; color: string; conflict: boolean; geom: BarGeom; }
interface OrderModel { order: Order; isExpanded: boolean; orderBar: BarModel | null; lines: BarModel[]; }
interface ResizeState { orderId: string; liId: string | null; edge: 'l' | 'r'; track: HTMLElement; }
const POOL_TYPES = CATALOG_TYPES.map((t) => ({ key: t.key, label: 'Items (' + t.label + ')' }));
@Component({
  selector: 'ims-scheduler',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.scss',
})
export class SchedulerComponent implements OnDestroy {
  readonly poolTypes = POOL_TYPES;
  view: View = 'week';
  anchor: number = this.startOfDay(new Date());
  poolType: CatalogType = 'serialized';
  selectedOrderId = '';
  expanded = new Set<string>();
  dragging: { type: CatalogType; refId: string } | null = null;
  resizing: ResizeState | null = null;

  constructor(readonly data: DataService, private cdr: ChangeDetectorRef) {}

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
        const c = new Date(base + i * DAY_MS);
        out.push({ start: c.getTime(), label: DAY_NAMES[c.getDay()], sub: MONTHS[c.getMonth()] + ' ' + c.getDate() });
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
    if (this.view === 'day') return new Date(this.anchor).toLocaleDateString() + ' · 24h';
    const c = this.columns();
    const a = new Date(c[0].start);
    if (this.view === 'month') return MONTHS[a.getMonth()] + ' ' + a.getFullYear();
    const b = new Date(c[c.length - 1].start);
    return a.toLocaleDateString() + ' - ' + b.toLocaleDateString();
  }

  shift(dir: number): void {
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      this.anchor = this.startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      this.anchor += dir * (this.view === 'week' ? 7 : 1) * DAY_MS;
    }
    this.expanded.clear();
    this.selectedOrderId = '';
  }

  orders(): Order[] { return this.data.listOrders().filter((o) => o.status === 'active'); }
  lanes(): Item[] { return this.data.listItems(this.poolType); }
  selectOrder(id: string): void { this.selectedOrderId = this.selectedOrderId === id ? '' : id; }
  toggleExpand(orderId: string): void { if (this.expanded.has(orderId)) this.expanded.delete(orderId); else this.expanded.add(orderId); }
  onOrderClick(orderId: string): void { this.selectOrder(orderId); this.toggleExpand(orderId); }
  lineStart(li: OrderLine, order: Order): string { return li.startDate ?? order.startDate; }
  lineEnd(li: OrderLine, order: Order): string { return li.endDate ?? order.endDate; }
  itemName(type: CatalogType, refId: string): string { return this.data.itemLabel(type, refId); }
  dateAt(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
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
    const s0 = Math.floor(new Date(startISO + 'T00:00:00').getTime() / DAY_MS) * DAY_MS;
    const e0 = Math.floor((new Date(endISO + 'T00:00:00').getTime() + DAY_MS - 1) / DAY_MS) * DAY_MS;
    const sIdx = (s0 - view) / DAY_MS;
    const eIdx = (e0 - view) / DAY_MS;
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
        ? { orderId: o.orderId, liId: null, label: o.orderId, sub: oSub, color: '#334155', conflict: false, geom: og }
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
          label: this.itemName(li.type, li.refId),
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
    if (order.lineItems.some((li) => li.type === t && li.refId === refId)) return;
    this.data.addOrderLine(order.orderId, { type: t, refId, qty: 1 });
    this.selectedOrderId = order.orderId;
    this.expanded.add(order.orderId);
  }

  startResize(e: PointerEvent, bar: BarModel, edge: 'l' | 'r'): void {
    e.preventDefault();
    e.stopPropagation();
    const track = (e.target as Element).closest('.tl-track') as HTMLElement | null;
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
    const idx = Math.floor(((ev.clientX - rect.left) / rect.width) * this.colCount());
    const day = this.dateAt(this.viewStart() + idx * DAY_MS);
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
