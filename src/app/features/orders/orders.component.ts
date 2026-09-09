import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import {
  CatalogType,
  CATALOG_TYPES,
  Order,
  ORDER_STATUS_LABEL,
  Party,
} from '../../core/models';

type Tab = 'parties' | 'orders';

/** Editing form shape for a party. */
interface PartyForm {
  name: string;
  contact: string;
  phone: string;
  email: string;
  billingAddress: string;
  billingCycle: string;
  notes: string;
}

const EMPTY_FORM: PartyForm = {
  name: '',
  contact: '',
  phone: '',
  email: '',
  billingAddress: '',
  billingCycle: 'monthly',
  notes: '',
};

const BILLING_CYCLES = ['daily', 'weekly', 'bi-weekly', 'monthly', 'quarterly'];

/** New-order header form (no line items yet — item booking comes with the Items & Stock slice). */
interface OrderForm {
  partyId: string;
  projectName: string;
  jobSite: string;
  startDate: string;
  endDate: string;
}

@Component({
  selector: 'ims-orders',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent {
  readonly cycles = BILLING_CYCLES;
  readonly statusLabel = ORDER_STATUS_LABEL;

  tab: Tab = 'parties';

  partyFormOpen = false;
  editingId: string | null = null;
  form: PartyForm = { ...EMPTY_FORM };

  orderFormOpen = false;
  orderForm: OrderForm = {
    partyId: '',
    projectName: '',
    jobSite: '',
    startDate: this.todayStr(),
    endDate: this.addDays(this.todayStr(), 7),
  };
  openOrderId: string | null = null;

  /** Add-line booking state. */
  addType: CatalogType = 'serialized';
  addItemId = '';
  addQty = 1;

  constructor(readonly data: DataService) {}

  types() {
    return CATALOG_TYPES;
  }

  lineCandidates() {
    return this.data.listItems(this.addType);
  }

  lineName(type: CatalogType, refId: string): string {
    return this.data.itemLabel(type, refId);
  }

  onTypeChange(): void {
    this.addItemId = '';
  }

  addLine(order: Order): void {
    if (!this.addItemId || !order) return;
    this.data.addOrderLine(order.orderId, {
      type: this.addType,
      refId: this.addItemId,
      qty: this.addQty,
    });
    this.addItemId = '';
    this.addQty = 1;
  }

  removeLine(order: Order, lineId: string): void {
    this.data.removeOrderLine(order.orderId, lineId);
  }

  parties(): Party[] {
    return this.data.listParties();
  }

  orders(): Order[] {
    return this.data.listOrders();
  }

  activeOrder(): Order | undefined {
    return this.openOrderId ? this.data.getOrder(this.openOrderId) : undefined;
  }

  openPartyForm(p?: Party): void {
    this.editingId = p ? p.id : null;
    this.form = p
      ? {
          name: p.name,
          contact: p.contact,
          phone: p.phone,
          email: p.email,
          billingAddress: p.billingAddress,
          billingCycle: p.billingCycle,
          notes: p.notes,
        }
      : { ...EMPTY_FORM };
    this.partyFormOpen = true;
  }

  saveParty(): void {
    const f = this.form;
    if (!f.name.trim()) return;
    if (this.editingId) {
      this.data.updateParty(this.editingId, f);
    } else {
      this.data.createParty(f);
    }
    this.closePartyForm();
  }

  closePartyForm(): void {
    this.partyFormOpen = false;
    this.editingId = null;
  }

  removeParty(p: Party): void {
    if (confirm(`Remove party "${p.name}"?`)) {
      this.data.removeParty(p.id);
    }
  }

  newOrder(): void {
    this.orderForm.partyId = this.data.listParties()[0]?.id ?? '';
    this.orderFormOpen = true;
  }

  saveOrder(): void {
    const f = this.orderForm;
    const party = this.data.getParty(f.partyId);
    if (!party || !f.projectName.trim()) return;
    this.data.createOrder({
      partyId: party.id,
      party: party.name,
      projectName: f.projectName,
      jobSite: f.jobSite || party.billingAddress || '—',
      startDate: f.startDate,
      endDate: f.endDate,
    });
    this.orderFormOpen = false;
    this.openOrderId = this.data.listOrders().slice(-1)[0]?.orderId ?? null;
  }

  lineCount(o: Order): number {
    return o.lineItems.length;
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private addDays(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
