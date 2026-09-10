import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { DataService } from '../../core/data.service';
import { ModulesService } from '../../core/modules.service';
import { CatalogType, statusClass } from '../../core/models';
import { TelemetryService } from '../../core/telemetry.service';

/**
 * Operations Dashboard — port of the prototype's `renderDashboard`
 * (js/pages/dashboard.js): a bento grid of fleet KPIs, the active-order margin
 * table, live geofence alerts, reorder warnings, fleet status and bulk out.
 */
@Component({
  selector: 'ims-dashboard',
  standalone: true,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  readonly fleetStatusOrder = ['Available', 'On Rent', 'In Shop', 'Staged'];

  constructor(
    readonly data: DataService,
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

  triggerReorder(type: CatalogType, ref: string): void {
    this.data.triggerReorder(type, ref);
  }

  openView(id: string): void {
    this.router.navigate(['/' + id]);
  }
}
