import { Routes } from '@angular/router';

import { requireModule } from './core/module.guard';
import { AdminComponent } from './features/admin/admin.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';

/**
 * Core-first route map (mirrors the prototype's VIEWS registry).
 *
 * **Two pages stay eager.** The dashboard is the landing page a fresh load renders, so
 * paying a chunk round-trip for it buys nothing; the Administration shell is the frame its
 * child pages move inside. Everything else — the thirteen feature pages and the four admin
 * children — loads on first navigation, each as its own chunk, which is what the port's
 * roadmap asked for and what keeps the initial bundle small.
 *
 * The gates still run first: `canActivate` is evaluated *before* the chunk is fetched, so a
 * licence the workspace does not hold refuses the navigation without downloading the page.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  {
    // Administration shell — the submenu moves between child routes.
    path: 'admin',
    component: AdminComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'modules' },
      {
        path: 'locations',
        loadComponent: () => import('./features/locations/locations.component').then((m) => m.LocationsComponent),
      },
      {
        path: 'verticals',
        loadComponent: () => import('./features/admin/verticals.component').then((m) => m.VerticalsComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/admin/dashboard-widgets.component').then((m) => m.DashboardWidgetsComponent),
      },
      {
        path: 'modules',
        loadComponent: () => import('./features/admin/feature-modules.component').then((m) => m.FeatureModulesComponent),
      },
      {
        path: 'sample-data',
        loadComponent: () => import('./features/admin/sample-data.component').then((m) => m.SampleDataComponent),
      },
      // Location Types merged into the Locations page as a sub-tab — keep the
      // old URL working for bookmarks.
      { path: 'location-types', redirectTo: 'locations', pathMatch: 'full' },
      // Categories (the old per-type name list) are the business type's categories
      // now — the same screen the verticals page edits.
      { path: 'categories', redirectTo: 'verticals', pathMatch: 'full' },
      { path: '**', redirectTo: 'modules' },
    ],
  },
  // Legacy deep links: these views now live under Administration.
  { path: 'locations', redirectTo: 'admin/locations', pathMatch: 'full' },
  { path: 'categories', redirectTo: 'admin/verticals', pathMatch: 'full' },
  {
    path: 'handoff',
    loadComponent: () => import('./features/handoff/handoff.component').then((m) => m.HandoffComponent),
  },
  {
    path: 'inspections',
    loadComponent: () => import('./features/inspections/inspections.component').then((m) => m.InspectionsComponent),
  },
  {
    path: 'invoicing',
    loadComponent: () => import('./features/invoicing/invoicing.component').then((m) => m.InvoicingComponent),
    canActivate: [requireModule('billing')],
  },
  {
    path: 'assets',
    loadComponent: () => import('./features/assets/assets.component').then((m) => m.AssetsComponent),
  },
  // The view is "Assets" now — keep the old URL working for bookmarks.
  { path: 'items', redirectTo: 'assets', pathMatch: 'full' },
  {
    path: 'logistics',
    loadComponent: () => import('./features/logistics/logistics.component').then((m) => m.LogisticsComponent),
    canActivate: [requireModule('dispatch')],
  },
  {
    path: 'maintenance',
    loadComponent: () => import('./features/maintenance/maintenance.component').then((m) => m.MaintenanceComponent),
    canActivate: [requireModule('service')],
  },
  {
    path: 'orders',
    loadComponent: () => import('./features/orders/orders.component').then((m) => m.OrdersComponent),
  },
  {
    path: 'pricing',
    loadComponent: () => import('./features/pricing/pricing.component').then((m) => m.PricingComponent),
  },
  {
    path: 'purchasing',
    loadComponent: () => import('./features/purchasing/purchasing.component').then((m) => m.PurchasingComponent),
  },
  {
    path: 'rentals',
    loadComponent: () => import('./features/rentals/rentals.component').then((m) => m.RentalsComponent),
    canActivate: [requireModule('rentals')],
  },
  {
    path: 'scheduler',
    loadComponent: () => import('./features/scheduler/scheduler.component').then((m) => m.SchedulerComponent),
    canActivate: [requireModule('scheduling')],
  },
  {
    path: 'telemetry',
    loadComponent: () => import('./features/telemetry/telemetry.component').then((m) => m.TelemetryComponent),
    canActivate: [requireModule('telemetry')],
  },
  {
    path: 'timesheet',
    loadComponent: () => import('./features/timesheet/timesheet.component').then((m) => m.TimesheetComponent),
    canActivate: [requireModule('labor')],
  },
  { path: '**', redirectTo: 'dashboard' },
];
