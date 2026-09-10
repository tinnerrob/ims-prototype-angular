import { Component } from '@angular/core';

import { DataService, periodLabel } from '../../core/data.service';
import { Item, Movement, MOVEMENT_KIND_LABEL, statusClass } from '../../core/models';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

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
  imports: [RecordViewComponent],
  templateUrl: './handoff.component.html',
  styleUrl: './handoff.component.scss',
})
export class HandoffComponent {
  readonly kindLabel = MOVEMENT_KIND_LABEL;

  /** Selected board day (ISO), defaults to today. */
  day = new Date().toISOString().slice(0, 10);

  /** Read-only record viewer (opened by clicking a board / log row). */
  viewer: ViewModel | null = null;

  constructor(readonly data: DataService) {}

  dayLabel(): string {
    return periodLabel('day', this.data.parseDT(this.day));
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

  /* --------------------------- record viewer ---------------------------- */

  /**
   * Board row click → read-only viewer for one unit's hand-off (the Check Out /
   * Check In buttons keep their own click).
   */
  showBoardView(e: Event, r: BoardRow): void {
    if (isInteractiveTarget(e)) return;
    const item = this.data.getItem('serialized', r.itemId);
    const out = this.data.outInfo(r.itemId);
    this.viewer = {
      title: r.itemId,
      subtitle: `${r.model} · ${r.orderId}`,
      icon: r.kind === 'out' ? 'bi-box-arrow-up-right' : 'bi-box-arrow-in-down',
      badge: r.kind === 'out' ? (r.overdue ? 'Go out (overdue)' : 'Pick-up today') : r.overdue ? 'Overdue return' : 'Due back today',
      badgeClass: r.overdue ? 'st-reorder' : 'st-out',
      sections: [
        {
          title: 'Hand-Off',
          fields: [
            { label: 'Asset', value: r.itemId, mono: true },
            { label: 'Model', value: r.model || '—' },
            { label: 'Direction', value: r.kind === 'out' ? 'Check-Out' : 'Check-In' },
            { label: 'Board Day', value: this.data.fmtDate(this.day), mono: true },
            { label: 'Overdue', value: r.overdue ? 'Yes' : 'No' },
          ],
        },
        {
          title: 'Contract',
          fields: [
            { label: 'Contract', value: r.orderId, mono: true },
            { label: 'Project', value: r.project || '—' },
            { label: 'Custodian', value: r.custodian || '—' },
            { label: 'Rental Window', value: `${this.data.fmtDate(r.start)} → ${this.data.fmtDate(r.end)}`, mono: true },
            { label: 'Out Since', value: r.outAt ? this.data.fmtDT(r.outAt) : '—', mono: true },
          ],
        },
        {
          title: 'Asset Status',
          fields: [
            { label: 'Catalog Name', value: item ? this.data.mkName(item) || item.name : '—' },
            { label: 'Service Status', value: item ? item.status : '—' },
            { label: 'Current Custody', value: out?.orderId ?? out?.party ?? 'In yard' },
            { label: 'Meter Hours', value: item ? this.data.int(item.meterHours ?? 0) : '—' },
          ],
        },
      ],
    };
  }

  /** Chain-of-custody log row click → read-only viewer for that movement. */
  showMovementView(e: Event, m: Movement): void {
    if (isInteractiveTarget(e)) return;
    this.viewer = {
      title: `Movement ${m.id}`,
      subtitle: `${this.kindLabel[m.kind]} · ${m.refId}`,
      icon: 'bi-journal-text',
      badge: this.kindLabel[m.kind],
      badgeClass: m.kind === 'issue' ? 'st-out' : 'st-available',
      sections: [
        {
          fields: [
            { label: 'Movement ID', value: m.id, mono: true },
            { label: 'Kind', value: this.kindLabel[m.kind] },
            { label: 'Item Type', value: m.type },
            { label: 'Item', value: m.refId, mono: true },
            { label: 'Quantity', value: String(m.qty) },
            { label: 'Contract', value: m.orderId || '—', mono: true },
            { label: 'Party', value: m.party || '—' },
            { label: 'Location', value: m.location || '—' },
            { label: 'Recorded At', value: this.data.fmtDT(m.at), mono: true },
            { label: 'Recorded By', value: m.by || '—' },
            { label: 'Note', value: m.note || '—' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }
}
