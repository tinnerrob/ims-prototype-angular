import { Component, OnDestroy } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Item, Order } from '../../core/models';

const DAY_MS = 86400000;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface OccCell {
  orderId: string;
  label: string;
  conflict: boolean;
}

interface BoardRow {
  item: Item;
  cells: (OccCell | null)[];
}

@Component({
  selector: 'ims-scheduler',
  standalone: true,
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.scss',
})
export class SchedulerComponent implements OnDestroy {
  readonly dayNames = DAY_NAMES;
  weekStart: number = this.mondayOf(new Date());
  draggingItemId = '';

  constructor(readonly data: DataService) {}

  ngOnDestroy(): void {
    /* no timers */
  }

  activeOrders(): Order[] {
    return this.data.listOrders().filter((o) => o.status === 'active');
  }

  serialized(): Item[] {
    return this.data.listItems('serialized');
  }

  /** Resource pool: serialized items currently free to book. */
  pool(): Item[] {
    return this.data.availableItems();
  }

  bookedIds(order: Order): string[] {
    return order.lineItems.filter((li) => li.type === 'serialized').map((li) => li.refId);
  }

  /* ---------------------------- drag & drop ----------------------------- */

  onDragStart(e: Event, itemId: string): void {
    (e as DragEvent).dataTransfer?.setData('text/plain', itemId);
    this.draggingItemId = itemId;
  }

  onDragEnd(): void {
    this.draggingItemId = '';
  }

  allowDrop(e: Event): void {
    e.preventDefault();
  }

  onDropOrder(e: Event, order: Order): void {
    e.preventDefault();
    const id = (e as DragEvent).dataTransfer?.getData('text/plain') ?? '';
    this.draggingItemId = '';
    if (!id || this.orderHasItem(order, id)) return;
    this.data.addOrderLine(order.orderId, { type: 'serialized', refId: id, qty: 1 });
  }

  /* ------------------------------- board ------------------------------- */

  board(): BoardRow[] {
    const rows: BoardRow[] = [];
    for (const item of this.serialized()) {
      const cells: (OccCell | null)[] = [];
      for (let i = 0; i < 7; i++) {
        const dayStart = this.weekStart + i * DAY_MS;
        const dayEnd = dayStart + DAY_MS - 1;
        const occ: OccCell[] = [];
        for (const order of this.activeOrders()) {
          if (!this.orderHasItem(order, item.id)) continue;
          if (this.overlaps(order, dayStart, dayEnd)) occ.push({ orderId: order.orderId, label: order.orderId, conflict: false });
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
        if (c) {
          const others = this.activeOrders().filter(
            (o) =>
              o.orderId !== c.orderId &&
              this.orderHasItem(o, row.item.id) &&
              this.overlaps(o, this.weekStart + i * DAY_MS, this.weekStart + i * DAY_MS + DAY_MS - 1),
          );
          if (others.length) out.push(`${this.fmtDay(i)}: ${row.item.id} booked to ${c.orderId} + ${others.map((o) => o.orderId).join(', ')}`);
        }
      });
    }
    return [...new Set(out)];
  }

  dateLabel(i: number): string {
    return this.fmtDay(i);
  }

  shift(weeks: number): void {
    this.weekStart += weeks * 7 * DAY_MS;
  }

  private orderHasItem(order: Order, itemId: string): boolean {
    return order.lineItems.some((li) => li.type === 'serialized' && li.refId === itemId);
  }

  private overlaps(order: Order, dayStart: number, dayEnd: number): boolean {
    const s = Date.parse(order.startDate + 'T00:00:00');
    const e = Date.parse(order.endDate + 'T00:00:00') + DAY_MS - 1;
    return s <= dayEnd && e >= dayStart;
  }

  private mondayOf(d: Date): number {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  private fmtDay(i: number): string {
    return new Date(this.weekStart + i * DAY_MS).toISOString().slice(0, 10);
  }
}
