import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DataService } from '../../core/data.service';
import { Order, ORDER_STATUS_LABEL, Party, statusClass } from '../../core/models';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { orderRecordTip, partyTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

const BILLING_CYCLES = ['daily', 'weekly', 'bi-weekly', 'monthly', 'quarterly'];

/**
 * Parties & Orders (core) — port of the prototype's `renderOrdersParties`
 * (js/pages/contracts.js): Customers / Contracts sub-tabs with counts, the
 * active/closed contract filter, and the customer / contract editors.
 */
@Component({
  selector: 'ims-orders',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
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
  /** Editor values as they were when it opened (drives the discard prompt). */
  private customerSnap = '';

  orderOpen = false;
  orderForm = {
    partyId: '',
    projectName: '',
    jobSite: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  };
  /** Editor values as they were when it opened (drives the discard prompt). */
  private orderSnap = '';
  detail: Order | null = null;

  /** Read-only record viewer (customer rows; contract rows reuse `detail`). */
  viewer: ViewModel | null = null;
  /** Customer behind the open viewer, so the footer Edit can reopen the editor. */
  private viewing: Party | null = null;

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
    this.customerSnap = snapshotForm(this.customerForm);
    this.customerOpen = true;
  }

  /** True when the customer editor holds edits that Save has not written yet. */
  customerDirty(): boolean {
    return formChanged(this.customerForm, this.customerSnap);
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
    this.customerSnap = '';
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
    this.orderSnap = snapshotForm(this.orderForm);
    this.orderOpen = true;
  }

  /** True when the contract editor holds edits that Save has not written yet. */
  orderDirty(): boolean {
    return formChanged(this.orderForm, this.orderSnap);
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
    this.closeOrderForm();
  }

  closeOrderForm(): void {
    this.orderOpen = false;
    this.orderSnap = '';
  }

  openDetail(o: Order): void {
    this.detail = o;
  }

  closeDetail(): void {
    this.detail = null;
  }

  /** Switch sub-tab — closing any open viewer/detail so a stale modal can't linger. */
  setTab(t: 'customers' | 'orders'): void {
    this.tab = t;
    this.closeViewer();
    this.closeDetail();
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Customer row click → read-only viewer (row actions keep their own click). */
  showView(e: Event, p: Party): void {
    if (isInteractiveTarget(e)) return;
    this.viewing = p;
    this.viewer = {
      title: p.name,
      subtitle: p.id,
      icon: 'bi-person-badge',
      badge: p.active === false ? 'Inactive' : 'Active',
      badgeClass: p.active === false ? 'st-out' : 'st-active',
      sections: [
        {
          title: 'Contact',
          fields: [
            { label: 'Customer ID', value: p.id, mono: true },
            { label: 'Contact', value: p.contact || '—' },
            { label: 'Phone', value: p.phone || '—' },
            { label: 'Email', value: p.email || '—' },
          ],
        },
        {
          title: 'Commercial',
          fields: [
            { label: 'Billing Address', value: p.billingAddress || '—' },
            { label: 'Billing Cycle', value: p.billingCycle },
            { label: 'Contracts', value: String(this.data.orderCount(p.id)) },
            { label: 'Active Contracts', value: String(this.data.activeOrderCount(p.id)) },
            { label: 'Notes', value: p.notes || '—' },
          ],
        },
      ],
    };
  }

  /** Contract row click → the page's existing read-only contract detail modal. */
  showContractView(e: Event, o: Order): void {
    if (isInteractiveTarget(e)) return;
    this.openDetail(o);
  }

  closeViewer(): void {
    this.viewer = null;
    this.viewing = null;
  }

  /** Viewer footer Edit → reopen the customer editor for the shown record. */
  editFromViewer(): void {
    const p = this.viewing;
    this.closeViewer();
    if (p) this.openCustomer(p);
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

  /* ------------------------------ tooltips ------------------------------ */

  /** Customer row: contact details and how much business is live with them. */
  tipCustomer(p: Party): Tip {
    return partyTip(this.data, p);
  }

  /** Contract row: the whole order record — window, site, size and value. */
  tipContract(o: Order): Tip {
    return orderRecordTip(this.data, o);
  }
}
