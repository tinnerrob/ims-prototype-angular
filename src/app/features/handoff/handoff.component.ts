import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Item, MOVEMENT_KIND_LABEL, statusClass } from '../../core/models';

/** One row on the hand-off day board. */
interface BoardRow {
  orderId: string;
  project: string;
  itemId: string;
  model: string;
  start: string;
  end: string;
  custodian: string;
  outAt: string | null;
  kind: 'out' | 'in';
  overdue: boolean;
}

/**
 * Item Hand-Off & Custody (core) — port of the prototype's `renderHandoff`
 * (js/pages/handoff.js): an outbound / incoming day board for a selected day
 * with Check-Out / Check-In, plus the immutable chain-of-custody log.
 */
@Component({
  selector: 'ims-handoff',
  standalone: true,
  templateUrl: './handoff.component.html',
  styleUrl: './handoff.component.scss',
})
export class HandoffComponent {
  readonly kindLabel = MOVEMENT_KIND_LABEL;

  /** Selected board day (ISO), defaults to today. */
  day = new Date().toISOString().slice(0, 10);

  constructor(readonly data: DataService) {}

  dayLabel(): string {
    return this.data.parseDT(this.day).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  moveDay(n: number): void {
    const d = this.data.parseDT(this.day);
    d.setDate(d.getDate() + n);
    this.day = d.toISOString().slice(0, 10);
  }

  today(): void {
    this.day = new Date().toISOString().slice(0, 10);
  }

  private rows(kind: 'out' | 'in'): BoardRow[] {
    const rows: BoardRow[] = [];
    for (const order of this.data.activeOrders()) {
      for (const li of order.lineItems) {
        if (li.type !== 'serialized') continue;
        const start = (li.startDate ?? order.startDate).slice(0, 10);
        const end = (li.endDate ?? order.endDate).slice(0, 10);
        const item = this.data.getItem('serialized', li.refId);
        const out = this.data.outInfo(li.refId);
        const base = {
          orderId: order.orderId,
          project: order.projectName,
          itemId: li.refId,
          model: this.data.mkName(item),
          start,
          end,
          custodian: this.data.partyName(order.partyId),
          outAt: out?.at ?? null,
        };
        if (kind === 'out' && !out && start <= this.day && this.day <= end) {
          rows.push({ ...base, kind: 'out', overdue: start < this.day });
        }
        if (kind === 'in' && out && end <= this.day) {
          rows.push({ ...base, kind: 'in', overdue: end < this.day });
        }
      }
    }
    return rows;
  }

  outbound(): BoardRow[] {
    return this.rows('out');
  }

  incoming(): BoardRow[] {
    return this.rows('in');
  }

  custody(): Item[] {
    return this.data.custodyItems();
  }

  movements() {
    return this.data.listMovements().slice(0, 40);
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /** Check a unit out to its order (prototype `hoCheckOut`). */
  checkOut(row: BoardRow): void {
    const item = this.data.getItem('serialized', row.itemId);
    this.data.logMovement({
      type: 'serialized',
      refId: row.itemId,
      kind: 'issue',
      qty: 1,
      orderId: row.orderId,
      party: row.custodian,
      note: `Checked out to ${row.orderId}`,
    });
    if (item) this.data.updateItem('serialized', row.itemId, { status: 'On Rent', orderId: row.orderId });
  }

  /** Return a unit to the yard (prototype `hoCheckIn`). */
  checkIn(row: BoardRow): void {
    const item = this.data.getItem('serialized', row.itemId);
    this.data.logMovement({
      type: 'serialized',
      refId: row.itemId,
      kind: 'return',
      qty: 1,
      party: 'Main yard',
      note: 'Returned to yard / available.',
    });
    if (item) this.data.updateItem('serialized', row.itemId, { status: 'Available', orderId: null });
  }

  /** Where a custody item is out to. */
  outFor(item: Item): string {
    const info = this.data.outInfo(item.id);
    return info?.orderId ?? info?.party ?? '—';
  }
}
