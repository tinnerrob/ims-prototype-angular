import { Component } from '@angular/core';

import { DataService } from '../../core/data.service';
import { Item, statusClass } from '../../core/models';
import { PageSearchService } from '../../core/page-search.service';
import { GEO_BOUNDS, TrackedPosition, TelemetryService } from '../../core/telemetry.service';
import { isInteractiveTarget, RecordViewComponent, ViewModel } from '../../shared/record-view/record-view.component';
import { assetTip } from '../../shared/tip/tip-builders';
import { Tip } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

interface Pin {
  id: string;
  x: number;
  y: number;
  alerting: boolean;
}

interface Ring {
  id: string;
  x: number;
  y: number;
  /** Diameter as a % of the map width (the element keeps a 1:1 aspect ratio). */
  d: number;
  label: string;
}

/** Longitude span of the simulated map window, in degrees (for ring scaling). */
const LNG_SPAN_DEG = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng;
/** Approximate ground width of the map window, in metres (~0.13° at 33.7°N). */
const MAP_WIDTH_M = LNG_SPAN_DEG * 111320 * Math.cos((33.735 * Math.PI) / 180);

/**
 * Fleet Telemetry (module) — port of the prototype's `renderGeo`
 * (js/pages/geo.js): the fleet asset status grid (status + breach badge,
 * last reported, battery bar, meter hours) with a live filter, the geofence
 * breach alert log, and the map (grid, yard hub, geofence rings, asset pins).
 */
@Component({
  selector: 'ims-telemetry',
  standalone: true,
  imports: [RecordViewComponent, TipDirective],
  templateUrl: './telemetry.component.html',
  styleUrl: './telemetry.component.scss',
})
export class TelemetryComponent {
  /** Read-only record viewer (opened by clicking a fleet row). */
  viewer: ViewModel | null = null;

  constructor(
    readonly data: DataService,
    readonly telemetry: TelemetryService,
    readonly search: PageSearchService,
  ) {
    // The topbar search box is this page's search: report how much of the fleet
    // survives it (the shell shows "shown of total" next to the box).
    this.search.report(() => ({
      shown: this.rows().length,
      total: this.telemetry.tracked().length,
    }));
    this.telemetry.start();
  }

  /* ------------------------------- fleet -------------------------------- */

  /** Tracked assets, narrowed by the page search. */
  rows(): TrackedPosition[] {
    return this.telemetry
      .tracked()
      .filter((t) =>
        this.search.matches(
          t.item.id,
          this.data.mkName(t.item),
          t.item.serial,
          t.item.category,
          t.item.status,
        ),
      );
  }

  totalTracked(): number {
    return this.data.listItems('serialized').length;
  }

  /** Fleet-size label; narrows to "shown of total" while the search is on. */
  unitsLabel(): string {
    const total = this.totalTracked();
    return this.search.isBlank()
      ? `${total} serialized units`
      : `${this.rows().length} of ${total} serialized units`;
  }

  badge(status: string): string {
    return 'badge-status st-' + statusClass(status);
  }

  /** Battery bar colour band (prototype `battCls`). */
  batteryColor(item: Item): string {
    const b = item.battery ?? 0;
    return b > 60 ? 'var(--success)' : b > 30 ? 'var(--warning)' : 'var(--danger)';
  }

  meterHours(item: Item): number {
    return item.meterHours ?? 0;
  }

  reported(item: Item): string {
    return this.data.fmtDT(item.lastReported);
  }

  locationLabel(item: Item): string {
    return this.telemetry.locationLabel(item).label;
  }

  /* ------------------------------- alerts ------------------------------- */

  alerts() {
    return this.telemetry.recentAlerts();
  }

  breachCount(): number {
    return this.telemetry.breachCount();
  }

  clearAlerts(): void {
    this.telemetry.clearAlerts();
  }

  /* --------------------------- record viewer ---------------------------- */

  /** Fleet row click → read-only viewer for that tracked asset. */
  showView(e: Event, t: TrackedPosition): void {
    if (isInteractiveTarget(e)) return;
    const item = t.item;
    const loc = this.telemetry.locationLabel(item);
    this.viewer = {
      title: item.id,
      subtitle: this.data.mkName(item),
      icon: 'bi-broadcast-pin',
      badge: t.breached ? 'Geofence breach' : item.status,
      badgeClass: t.breached ? 'st-out' : 'st-' + statusClass(item.status),
      sections: [
        {
          title: 'Fleet',
          fields: [
            { label: 'Asset ID', value: item.id, mono: true },
            { label: 'Name / Model', value: this.data.mkName(item) },
            { label: 'Serial / VIN', value: item.serial || '—', mono: true },
            { label: 'Status', value: item.status },
            { label: 'Category', value: item.category },
          ],
        },
        {
          title: 'Telemetry',
          fields: [
            { label: 'Last Reported', value: this.reported(item), mono: true },
            { label: 'Battery', value: item.battery == null ? '—' : item.battery + '%' },
            { label: 'Meter Hours', value: this.data.int(this.meterHours(item)) },
            { label: 'Position', value: `${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}`, mono: true },
            { label: 'Location', value: loc.label },
            { label: 'Geofence', value: t.breached ? 'Breach — outside the site fence' : 'Inside the fence' },
          ],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  /* -------------------------------- map --------------------------------- */

  /** Map X/Y as a percentage of the viewport (prototype `latLngToXY`). */
  private toXY(lat: number, lng: number): { x: number; y: number } {
    const x = ((lng - GEO_BOUNDS.minLng) / LNG_SPAN_DEG) * 100;
    const y = ((GEO_BOUNDS.maxLat - lat) / (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat)) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }

  yardPin(): { x: number; y: number } {
    return this.toXY(this.data.yard.lat, this.data.yard.lng);
  }

  /** Geofence rings for every open order (prototype `renderGeoMap`). */
  rings(): Ring[] {
    return this.data
      .listOrders()
      .filter((o) => o.status !== 'closed' && o.siteLat != null && o.siteLng != null)
      .map((o) => {
        const p = this.toXY(o.siteLat as number, o.siteLng as number);
        const radius = o.geofenceRadius ?? 300;
        // Diameter as a share of the map width (the element is 1:1).
        const d = (2 * radius * 100) / MAP_WIDTH_M;
        return {
          id: o.orderId,
          x: p.x,
          y: p.y,
          d: Math.max(4, Math.min(46, d)),
          label: `${o.projectName} (${radius}m)`,
        };
      });
  }

  /** Live asset pins, red when outside their geofence. */
  pins(): Pin[] {
    return this.telemetry.tracked().map((t) => {
      const p = this.toXY(t.lat, t.lng);
      return { id: t.item.id, x: p.x, y: p.y, alerting: t.breached };
    });
  }

  /* ------------------------------ tooltips ------------------------------ */

  /** Tracked asset row: the unit, its fix and whether it is out of the fence. */
  tipTracked(t: TrackedPosition): Tip {
    const asset = t.item;
    return assetTip(this.data, asset, [
      { label: 'Position', value: `${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}` },
      { label: 'Geofence', value: t.breached ? 'Breached' : 'Inside' },
    ]);
  }
}
