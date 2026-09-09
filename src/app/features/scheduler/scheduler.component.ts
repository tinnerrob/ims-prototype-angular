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
    } else {
      const n = this.view === 'week' ? 7 : 1;
      const base = this.mondayOf(this.anchor);
      for (let i = 0; i < n; i++) {
        const c = new Date(base + i * DAY_MS);
        out.push({ start: c.getTime(), label: DAY_NAMES[c.getDay()], sub: MONTHS[c.getMonth()] + ' ' + c.getDate() });
      }
    }
    return out;
  }

  colCount(): number { return this.columns().length; }
  viewStart(): number { return this.columns()[0].start; }
  tlWidth(): number { return 170 + this.colCount() * DAY_W; }

  rangeLabel(): string {
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
    return this.orders().map((o) => {
      const og = this.geom(o.startDate, o.endDate);
      const orderBar: BarModel | null = og
        ? { orderId: o.orderId, liId: null, label: o.orderId, sub: o.lineItems.length + ' items', color: '#334155', conflict: false, geom: og }
        : null;
      const lines: BarModel[] = [];
      for (const li of o.lineItems) {
        const lg = this.geom(this.lineStart(li, o), this.lineEnd(li, o));
        if (!lg) continue;
        const conflict = this.isConflicted(li, o);
        lines.push({ orderId: o.orderId, liId: li.id, label: this.itemName(li.type, li.refId),
          sub: this.lineDays(li, o) + 'd' + (conflict ? ' - CONFLICT' : ''), color: TYPE_COLORS[li.type] ?? '#334155',
          conflict, geom: lg });
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
    const idx = Math.floor(((ev.clientX - rect.left) / rect.width) * this.colCount());
    const day = this.dateAt(this.viewStart() + idx * DAY_MS);
    const order = this.data.getOrder(r.orderId);
    if (!order) return;
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
