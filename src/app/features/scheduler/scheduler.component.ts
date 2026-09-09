import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { CatalogType, CATALOG_TYPES, Item, Order } from '../../core/models';

const DAY_MS = 86400000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type View = 'day' | 'week' | 'month';

interface Column {
  start: number;
  end: number;
  head: string;
  sub: string;
}

interface Occ {
  orderId: string;
  label: string;
  conflict: boolean;
}

interface Lane {
  item: Item;
  cells: (Occ | null)[];
}

const POOL_TYPES: { key: CatalogType; label: string }[] = CATALOG_TYPES.map((t) => ({
  key: t.key,
  label: 'Items (' + t.label + ')',
}));

@Component({
  selector: 'ims-scheduler',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.scss',
})
export class SchedulerComponent implements OnDestroy {
  readonly dayNames = DAY_NAMES;
  readonly poolTypes = POOL_TYPES;

  view: View = 'week';
  anchor: number = this.startOfDay(new Date());
  poolType: CatalogType = 'serialized';
  selectedOrderId = '';
  dragging: { type: CatalogType; refId: string } | null = null;

  constructor(readonly data: DataService) {}

  ngOnDestroy(): void {
    /* no timers */
  }

  orders(): Order[] {
    return this.data.listOrders().filter((o) => o.status === 'active');
  }

  selectedOrder(): Order | undefined {
    return this.selectedOrderId ? this.data.getOrder(this.selectedOrderId) : undefined;
  }

  /** Items for the current pool type (the timeline lanes). */
  lanes(): Item[] {
    return this.data.listItems(this.poolType);
  }

  bookedCount(order: Order): number {
    return order.lineItems.length;
  }

  selectOrder(id: string): void {
    this.selectedOrderId = this.selectedOrderId === id ? '' : id;
  }

  /* ------------------------------ columns ------------------------------- */

  columns(): Column[] {
    const out: Column[] = [];
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let i = 0; i < days; i++) {
        const start = this.startOfDay(new Date(d.getFullYear(), d.getMonth(), i + 1));
        out.push(this.col(start));
      }
    } else {
      const n = this.view === 'week' ? 7 : 1;
      const mon = this.mondayOf(this.anchor);
      for (let i = 0; i < n; i++) {
        out.push(this.col(mon + i * DAY_MS));
      }
    }
    return out;
  }

  rangeLabel(): string {
    const c = this.columns();
    const a = new Date(c[0].start);
    const b = new Date(c[c.length - 1].start);
    if (this.view === 'month') return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
    return `${a.toLocaleDateString()} – ${b.toLocaleDateString()}`;
  }

  shift(dir: number): void {
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      this.anchor = this.startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      this.anchor += dir * (this.view === 'week' ? 7 : 1) * DAY_MS;
    }
  }
  /* ------------------------------ occupancy ----------------------------- */

  board(): Lane[] {
    const cols = this.columns();
    const rows: Lane[] = [];
    for (const item of this.lanes()) {
      const cells: (Occ | null)[] = [];
      for (const col of cols) {
        const occ: Occ[] = [];
        for (const order of this.orders()) {
          if (!this.orderHasItem(order, item.type, item.id)) continue;
          if (this.overlaps(order, col.start, col.end)) occ.push({ orderId: order.orderId, label: order.orderId, conflict: false });
        }
        cells.push(occ.length === 0 ? null : { ...occ[0], conflict: occ.length > 1 });
      }
      rows.push({ item, cells });
    }
    return rows;
  }

  conflicts(): string[] {
    const out: string[] = [];
    for (const row of this.board()) {
      row.cells.forEach((c, i) => {
        if (c && c.conflict) {
          out.push(`${new Date(this.columns()[i].start).toLocaleDateString()}: ${row.item.id} double-booked`);
        }
      });
    }
    return [...new Set(out)];
  }

  itemLabel(item: Item): string {
    return this.data.itemLabel(item.type, item.id);
  }

  /* ----------------------------- drag & drop ---------------------------- */

  onPoolStart(e: Event, item: Item): void {
    (e as DragEvent).dataTransfer?.setData('text/plain', `${item.type}|${item.id}`);
    this.dragging = { type: item.type, refId: item.id };
  }

  onDragEnd(): void {
    this.dragging = null;
  }

  allowDrop(e: Event): void {
    e.preventDefault();
  }

  onDropOrder(e: Event, order: Order): void {
    e.preventDefault();
    const raw = (e as DragEvent).dataTransfer?.getData('text/plain');
    this.dragging = null;
    if (!raw) return;
    const [type, refId] = raw.split('|');
    const t = type as CatalogType;
    if (this.orderHasItem(order, t, refId)) return;
    this.data.addOrderLine(order.orderId, { type: t, refId, qty: 1 });
    this.selectedOrderId = order.orderId;
  }

  /* -------------------------------- misc -------------------------------- */

  private orderHasItem(order: Order, type: CatalogType, refId: string): boolean {
    return order.lineItems.some((li) => li.type === type && li.refId === refId);
  }

  private overlaps(order: Order, dayStart: number, dayEnd: number): boolean {
    const s = Date.parse(order.startDate + 'T00:00:00');
    const e = Date.parse(order.endDate + 'T00:00:00') + DAY_MS - 1;
    return s <= dayEnd && e >= dayStart;
  }

  private col(start: number): Column {
    const d = new Date(start);
    return {
      start,
      end: start + DAY_MS - 1,
      head: DAY_NAMES[d.getDay()],
      sub: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
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

