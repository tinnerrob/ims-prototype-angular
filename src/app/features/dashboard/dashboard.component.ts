import { Component, Inject } from '@angular/core';
import { Router } from '@angular/router';

import { ApiAdapter, IMS_API } from '../../core/api';
import { ModulesService } from '../../core/modules.service';
import { CatalogType, Order, statusClass } from '../../core/models';
import { TelemetryService } from '../../core/telemetry.service';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';

/** One row of the dashboard's active-order margin table. */
interface OrderTotalRow {
  order: Order;
  days: number;
  gross: number;
  net: number;
  margin: number;
}

/**
 * Operations Dashboard — port of the prototype's `renderDashboard`
 * (js/pages/dashboard.js): a bento grid of fleet KPIs, the active-order margin
 * table, live geofence alerts, reorder warnings, fleet status and bulk out.
 */
@Component({
  selector: 'ims-dashboard',
  standalone: true,
  imports: [RecordViewComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly fleetStatusOrder = ['Available', 'On Rent', 'In Shop', 'Staged'];

  /** Read-only record viewer (opened by clicking the margin table's rows). */
  viewer: ViewModel | null = null;

  constructor(
    @Inject(IMS_API) readonly data: ApiAdapter,
    readonly telemetry: TelemetryService,
    readonly mods: ModulesService,
    private readonly router: Router,
  ) {}

  kpis() {
    return this.data.fleetKpis();
  }

  telemetryOn(): boolean {
    return this.mods.isEnabled('telemetry');
  }

  /** Alert panel is only shown while the telemetry module is enabled. */
  recentAlerts() {
    return this.telemetryOn() ? this.telemetry.recentAlerts().slice(0, 6) : [];
  }

  activeOrders() {
    return this.data.activeOrderTotals();
  }

  reorders() {
    return this.data.reorders();
  }

  fleetByStatus(status: string): number {
    return this.data.fleetByStatus()[status] ?? 0;
  }

  bulkOut() {
    return this.data.listItems('bulk');
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /** Margin pill colour band (prototype: >=30 green, >=10 amber, else red). */
  marginBadge(margin: number): string {
    const cls = margin >= 30 ? 'st-available' : margin >= 10 ? 'st-reorder' : 'st-out';
    return 'badge-status ' + cls;
  }

  /**
   * Raise a draft purchase order for a low row and go where the buyer finishes it.
   *
   * The prototype's one-click restock set `qtyOnHand` directly, which left stock
   * nothing in the ledger accounted for. Here the click raises a **document**
   * (`DataService.raiseReorder`) and lands on Purchasing: pick the supplier, send
   * it, receive it — and the receipt is what moves the quantity.
   */
  raiseReorder(type: CatalogType, ref: string): void {
    if (this.data.raiseReorder(type, ref).ok) this.router.navigate(['/purchasing']);
  }

  openView(id: string): void {
    this.router.navigate(['/' + id]);
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Margin-table row click → read-only viewer for that active contract. */
  showView(e: Event, row: OrderTotalRow): void {
    if (isInteractiveTarget(e)) return;
    const o = row.order;
    this.viewer = {
      title: o.orderId,
      subtitle: `${o.projectName} · ${this.data.partyName(o.partyId)}`,
      icon: 'bi-briefcase',
      badge: o.status === 'active' ? 'Active' : 'Closed',
      badgeClass: 'st-' + statusClass(o.status),
      sections: [
        {
          title: 'Contract',
          fields: [
            { label: 'Contract', value: o.orderId, mono: true },
            { label: 'Customer', value: this.data.partyName(o.partyId) },
            { label: 'Project', value: o.projectName },
            { label: 'Job Site', value: o.jobSite || '—' },
            { label: 'Window', value: `${this.data.fmtDate(o.startDate)} → ${this.data.fmtDate(o.endDate)}`, mono: true },
            { label: 'Days', value: String(row.days) },
            { label: 'Lines', value: String(o.lineItems.length) },
          ],
        },
        {
          title: 'Margin',
          fields: [
            { label: 'Gross', value: this.data.money(row.gross) },
            { label: 'Net', value: this.data.money(row.net) },
            { label: 'Margin', value: this.data.pct(row.margin) },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }
}
