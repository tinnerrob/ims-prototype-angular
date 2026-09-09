import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Item, MOVEMENT_KIND_LABEL, Movement } from '../../core/models';

@Component({
  selector: 'ims-handoff',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './handoff.component.html',
  styleUrl: './handoff.component.scss',
})
export class HandoffComponent {
  readonly kindLabel = MOVEMENT_KIND_LABEL;

  /** Issue form state. */
  orderId: string;
  itemId = '';
  note = '';

  constructor(readonly data: DataService) {
    this.orderId = data.listOrders().filter((o) => o.status === 'active')[0]?.orderId ?? '';
  }

  orders() {
    return this.data.listOrders().filter((o) => o.status === 'active');
  }

  available() {
    return this.data.availableItems();
  }

  custody() {
    return this.data.custodyItems();
  }

  movements(): Movement[] {
    return this.data.listMovements().slice(0, 30);
  }

  issue(): void {
    if (!this.itemId || !this.orderId) return;
    const order = this.data.getOrder(this.orderId);
    this.data.logMovement({
      type: 'serialized',
      refId: this.itemId,
      kind: 'issue',
      qty: 1,
      orderId: order?.orderId,
      party: order?.party,
      note: this.note || `Issued to ${order?.orderId ?? ''}`.trim(),
    });
    this.itemId = '';
    this.note = '';
  }

  returnItem(item: Item): void {
    this.data.logMovement({
      type: 'serialized',
      refId: item.id,
      kind: 'return',
      qty: 1,
      party: 'Main yard',
      note: 'Returned to yard / available',
    });
  }

  /** Where a custody item is currently out (latest movement order/party). */
  outFor(item: Item): string {
    const latest = this.data
      .listMovements()
      .find((m) => m.type === 'serialized' && m.refId === item.id);
    if (!latest) return '—';
    return latest.orderId ?? latest.party ?? '—';
  }
}
