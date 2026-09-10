import { Routes } from '@angular/router';

import { requireModule } from './core/module.guard';
import { AdminComponent } from './features/admin/admin.component';
import { FeatureModulesComponent } from './features/admin/feature-modules.component';
import { CategoriesComponent } from './features/categories/categories.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HandoffComponent } from './features/handoff/handoff.component';
import { InspectionsComponent } from './features/inspections/inspections.component';
import { InvoicingComponent } from './features/invoicing/invoicing.component';
import { ItemsComponent } from './features/items/items.component';
import { LocationsComponent } from './features/locations/locations.component';
import { LogisticsComponent } from './features/logistics/logistics.component';
import { MaintenanceComponent } from './features/maintenance/maintenance.component';
import { OrdersComponent } from './features/orders/orders.component';
import { PricingComponent } from './features/pricing/pricing.component';
import { RentalsComponent } from './features/rentals/rentals.component';
import { SchedulerComponent } from './features/scheduler/scheduler.component';
import { TelemetryComponent } from './features/telemetry/telemetry.component';
import { TimesheetComponent } from './features/timesheet/timesheet.component';

/**
 * Core-first route map (mirrors the prototype's VIEWS registry).
 * Core views are top-level; future industry modules become lazy-loaded
 * child modules under a guard once the module registry is ported.
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
      { path: 'locations', component: LocationsComponent },
      { path: 'categories', component: CategoriesComponent },
      { path: 'modules', component: FeatureModulesComponent },
      // Location Types merged into the Locations page as a sub-tab — keep the
      // old URL working for bookmarks.
      { path: 'location-types', redirectTo: 'locations', pathMatch: 'full' },
      { path: '**', redirectTo: 'modules' },
    ],
  },
  // Legacy deep links: these views now live under Administration.
  { path: 'locations', redirectTo: 'admin/locations', pathMatch: 'full' },
  { path: 'categories', redirectTo: 'admin/categories', pathMatch: 'full' },
  { path: 'handoff', component: HandoffComponent },
  { path: 'inspections', component: InspectionsComponent },
  { path: 'invoicing', component: InvoicingComponent, canActivate: [requireModule('billing')] },
  { path: 'items', component: ItemsComponent },
  { path: 'logistics', component: LogisticsComponent, canActivate: [requireModule('dispatch')] },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [requireModule('service')] },
  { path: 'orders', component: OrdersComponent },
  { path: 'pricing', component: PricingComponent },
  { path: 'rentals', component: RentalsComponent, canActivate: [requireModule('rentals')] },
  { path: 'scheduler', component: SchedulerComponent, canActivate: [requireModule('scheduling')] },
  { path: 'telemetry', component: TelemetryComponent, canActivate: [requireModule('telemetry')] },
  { path: 'timesheet', component: TimesheetComponent, canActivate: [requireModule('labor')] },
  { path: '**', redirectTo: 'dashboard' },
];
