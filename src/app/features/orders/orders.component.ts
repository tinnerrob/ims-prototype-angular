import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Order, ORDER_STATUS_LABEL, Party, statusClass } from '../../core/models';

const BILLING_CYCLES = ['daily', 'weekly', 'bi-weekly', 'monthly', 'quarterly'];

/**
 * Parties & Orders (core) — port of the prototype's `renderOrdersParties`
 * (js/pages/contracts.js): Customers / Contracts sub-tabs with counts, the
 * active/closed contract filter, and the customer / contract editors.
 */
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

  tab: 'customers' | 'orders' = 'customers';
  filter: 'active' | 'closed' = 'active';

  customerOpen = false;
  editingCustomerId: string | null = null;
  customerForm = this.emptyCustomer();

  orderOpen = false;
  orderForm = {
    partyId: '',
    projectName: '',
    jobSite: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  };
  detail: Order | null = null;

  constructor(readonly data: DataService) {}

  parties(): Party[] {
    return this.data.listParties();
  }

  orders(): Order[] {
    return this.data.listOrders().filter((o) => o.status === this.filter);
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /* ------------------------------ customers ----------------------------- */

  openCustomer(p?: Party): void {
    this.editingCustomerId = p ? p.id : null;
    this.customerForm = p
      ? {
          name: p.name,
          contact: p.contact,
          phone: p.phone,
          email: p.email,
          billingAddress: p.billingAddress,
          billingCycle: p.billingCycle,
          notes: p.notes,
          active: p.active !== false,
        }
      : this.emptyCustomer();
    this.customerOpen = true;
  }

  saveCustomer(): void {
    const f = this.customerForm;
    if (!f.name.trim()) return;
    const patch = {
      name: f.name,
      contact: f.contact,
      phone: f.phone,
      email: f.email,
      billingAddress: f.billingAddress,
      billingCycle: f.billingCycle,
      notes: f.notes,
    };
    if (this.editingCustomerId) this.data.updateParty(this.editingCustomerId, { ...patch, active: f.active });
    else this.data.createParty(patch);
    this.closeCustomer();
  }

  toggleActive(p: Party): void {
    this.data.togglePartyActive(p.id);
  }

  removeCustomer(p: Party): void {
    this.data.removeParty(p.id);
  }

  closeCustomer(): void {
    this.customerOpen = false;
    this.editingCustomerId = null;
  }

  /* ------------------------------- orders ------------------------------ */

  newOrder(): void {
    const party = this.data.listParties()[0];
    this.orderForm = {
      partyId: party?.id ?? '',
      projectName: '',
      jobSite: party?.billingAddress ?? '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
    };
    this.orderOpen = true;
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
      endDate: f.endDate || f.startDate,
    });
    this.orderOpen = false;
  }

  openDetail(o: Order): void {
    this.detail = o;
  }

  closeDetail(): void {
    this.detail = null;
  }

  gross(o: Order): number {
    return this.data.orderAmount(o);
  }

  private emptyCustomer() {
    return {
      name: '',
      contact: '',
      phone: '',
      email: '',
      billingAddress: '',
      billingCycle: 'monthly',
      notes: '',
      active: true,
    };
  }
}
