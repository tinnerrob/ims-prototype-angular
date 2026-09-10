import { Injectable } from '@angular/core';

import { DataService } from './data.service';
import { Item } from './models';

/** One entry in the geofence alert log (prototype `App.breachAlerts`). */
export interface GeoAlert {
  kind: 'breach' | 'info';
  ts: string;
  msg: string;
}

/** Live position of a tracked asset on the simulated map. */
export interface TrackedPosition {
  item: Item;
  lat: number;
  lng: number;
  breached: boolean;
}

/** Map viewport bounds (prototype `GEO_BOUNDS`). */
export const GEO_BOUNDS = { minLat: 33.7, maxLat: 33.77, minLng: -84.46, maxLng: -84.33 };

/** Earth-distance in metres between two coordinates (prototype `haversineMeters`). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * IMS — TelemetryService.
 *
 * Shared geofence alert log + GPS movement simulator, ported from the
 * prototype's global `App.breachAlerts` + `initSim`/`geoSimTick`/`updateBadges`.
 * The shell (nav badge + notification count), the dashboard alert panel and the
 * Fleet Telemetry view all read the same state, so they always agree.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  /** Append-only alert log, newest last (prototype caps it at 40). */
  alerts: GeoAlert[] = [];

  /** Simulated drift per serialized asset. */
  private drift = new Map<string, { lat: number; lng: number; breached: boolean }>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  constructor(private readonly data: DataService) {
    this.reset();
  }

  /* ------------------------------- lifecycle ---------------------------- */

  /** Seed the engine + start the live loop (prototype `initSim` + interval). */
  start(): void {
    this.reset();
    if (this.timer) return;
    this.timer = setInterval(() => this.simTick(), 2500);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private reset(): void {
    this.drift.clear();
    for (const a of this.data.listItems('serialized')) {
      this.drift.set(a.id, { lat: a.lat ?? this.data.yard.lat, lng: a.lng ?? this.data.yard.lng, breached: false });
    }
    // Seed one breach so the dashboard / telemetry log show activity immediately
    // (the prototype does the same on boot).
    if (this.alerts.length === 0) {
      this.alerts.push({
        kind: 'breach',
        ts: '08:11:47',
        msg: 'ALERT: Asset BL-119 exited Geofence boundary at Job Site: Downtown Plaza Renovation (120m out)',
      });
    }
  }

  /** Live board rows: every tracked asset with its current position + breach flag. */
  tracked(): TrackedPosition[] {
    return this.data.listItems('serialized').map((item) => {
      const d = this.drift.get(item.id);
      return {
        item,
        lat: d?.lat ?? item.lat ?? this.data.yard.lat,
        lng: d?.lng ?? item.lng ?? this.data.yard.lng,
        breached: d?.breached ?? false,
      };
    });
  }

  /** Assets currently outside their job-site geofence. */
  breachCount(): number {
    return this.alerts.filter((a) => a.kind === 'breach').length;
  }

  /** Alert log newest-first (prototype `renderGeoAlerts`). */
  recentAlerts(): GeoAlert[] {
    return [...this.alerts].reverse();
  }

  clearAlerts(): void {
    this.alerts.length = 0;
  }

  /** In-yard vs on-site split for the live board. */
  locationLabel(item: Item): { label: string; inYard: boolean } {
    const out = this.data.outInfo(item.id);
    if (!out) return { label: 'Yard', inYard: true };
    return { label: out.orderId ?? 'On site', inYard: false };
  }

  /* --------------------------------- sim -------------------------------- */

  /** One simulation step (prototype `geoSimTick`). */
  private simTick(): void {
    try {
      this.tick++;
      const t = this.tick;
      for (const item of this.data.listItems('serialized')) {
        const state = this.drift.get(item.id);
        if (!state) continue;
        const baseLat = item.lat ?? state.lat;
        const baseLng = item.lng ?? state.lng;
        const ordered = !!item.orderId;
        // Bigger amplitude for units on rent, a gentle drift for yard units.
        const ampLat = item.id === 'BL-119' ? 0.0015 : ordered ? 0.0005 : 0.00006;
        const ampLng = item.id === 'BL-119' ? 0.001 : ordered ? 0.0005 : 0.00006;
        const sp = item.id === 'BL-119' ? 0.9 : ordered ? 0.7 : 0.4;
        state.lat = baseLat + ampLat * Math.sin(t * sp * 0.4);
        state.lng = baseLng + ampLng * Math.cos(t * sp * 0.33);

        if (!item.orderId) continue;
        const order = this.data.getOrder(item.orderId);
        if (!order?.siteLat || !order?.siteLng) continue;
        const radius = order.geofenceRadius ?? 300;
        const d = haversineMeters(state.lat, state.lng, order.siteLat, order.siteLng);
        if (d > radius && !state.breached) {
          state.breached = true;
          this.push({
            kind: 'breach',
            ts: this.timeNow(),
            msg: `ALERT: Asset ${item.id} exited Geofence boundary at Job Site: ${order.projectName} (${Math.round(d)}m out)`,
          });
        } else if (d <= radius && state.breached) {
          state.breached = false;
          this.push({
            kind: 'info',
            ts: this.timeNow(),
            msg: `Asset ${item.id} re-entered Geofence at ${order.projectName}`,
          });
        }
      }
    } catch {
      /* never let the sim break the UI (prototype logs + continues) */
    }
  }

  private push(a: GeoAlert): void {
    this.alerts.push(a);
    if (this.alerts.length > 40) this.alerts.shift();
  }

  private timeNow(): string {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

