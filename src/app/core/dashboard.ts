import { ModuleKey } from './models';

/**
 * IMS — dashboard widget registry (Phase C).
 *
 * The Operations Dashboard is a *set of widgets*, not a fixed page. This registry
 * declares each one — its stable key, the admin label, a one-line description, an
 * icon, the bento span it wants, and the industry module that gates it — and the
 * workspace stores the *order* and the *visible set* (`Tenant.dashboard`).
 * `DashboardService` joins the two; the dashboard template renders the result.
 *
 * Adding a widget is one entry here plus one `@case` in the dashboard template:
 * it appears on Admin → Dashboard to switch, and in the registry default, with no
 * change to the store. The same "declare it once" shape as the view registry
 * (`core/views.ts`) and the item-type registry (`core/models.ts`).
 */
export interface DashboardWidget {
  /** Stable key — what `Tenant.dashboard.order`/`hidden` store and what the template switches on. */
  key: string;
  /** The admin list's title and the panel's heading. */
  label: string;
  /** One line under the label on the admin page. */
  desc: string;
  /** Bootstrap Icons class. */
  icon: string;
  /** Bento column span out of 12 (the `c-*` class). */
  span: number;
  /** A compact KPI tile (`bento--kpi`) rather than a panel. */
  kpi?: boolean;
  /** Hidden unless this industry module is licensed. */
  module?: ModuleKey;
}

/**
 * The widgets an Operations Dashboard can carry, in the registry's order (which
 * is the default layout). Keys are stable — they are what a workspace stores.
 */
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { key: 'book-value', label: 'Fleet Book Value', desc: 'Total book value of the serialized fleet.', icon: 'bi-safe', span: 3, kpi: true },
  { key: 'utilization', label: 'Physical Utilization', desc: 'Units on rent against the whole fleet.', icon: 'bi-arrow-repeat', span: 3, kpi: true },
  { key: 'geo-alerts', label: 'Out-of-Geofence Alerts', desc: 'Live breach count (Fleet Telemetry).', icon: 'bi-sign-stop', span: 3, kpi: true, module: 'telemetry' },
  { key: 'revenue', label: 'Revenue Run-Rate', desc: 'Annualised revenue from the active orders.', icon: 'bi-graph-up-arrow', span: 3, kpi: true },
  { key: 'active-orders', label: 'Active Orders & Margin', desc: 'Open orders with gross, net and margin.', icon: 'bi-folder2-open', span: 8 },
  { key: 'geo-feed', label: 'Recent Geofence Alerts', desc: 'The geofence alert stream (Fleet Telemetry).', icon: 'bi-broadcast', span: 4, module: 'telemetry' },
  { key: 'reorders', label: 'Reorder Warnings', desc: 'Consumables and stock at or below their reorder point.', icon: 'bi-exclamation-triangle', span: 8 },
  { key: 'fleet-status', label: 'Fleet Status', desc: 'Serialized units by status.', icon: 'bi-pie-chart', span: 4 },
  { key: 'bulk-out', label: 'Assets (Bulk) Out', desc: 'Bulk resources and how much of each is out.', icon: 'bi-boxes', span: 12 },
];
