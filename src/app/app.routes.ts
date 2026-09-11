import { Routes } from '@angular/router';

import { requireAuth } from './core/auth.guard';
import { requireModule } from './core/module.guard';
import { AdminComponent } from './features/admin/admin.component';
import { FeatureModulesComponent } from './features/admin/feature-modules.component';
import { CategoriesComponent } from './features/categories/categories.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HandoffComponent } from './features/handoff/handoff.component';
import { InspectionsComponent } from './features/inspections/inspections.component';
import { InvoicingComponent } from './features/invoicing/invoicing.component';
import { AssetsComponent } from './features/assets/assets.component';
import { LocationsComponent } from './features/locations/locations.component';
import { LogisticsComponent } from './features/logistics/logistics.component';
import { MaintenanceComponent } from './features/maintenance/maintenance.component';
import { OrdersComponent } from './features/orders/orders.component';
import { PricingComponent } from './features/pricing/pricing.component';
import { PurchasingComponent } from './features/purchasing/purchasing.component';
import { RentalsComponent } from './features/rentals/rentals.component';
import { SchedulerComponent } from './features/scheduler/scheduler.component';
import { SignInComponent } from './features/sign-in/sign-in.component';
import { TelemetryComponent } from './features/telemetry/telemetry.component';
import { TimesheetComponent } from './features/timesheet/timesheet.component';

/**
 * Core-first route map (mirrors the prototype's VIEWS registry).
 *
 * Two guards, two questions (B2): the **sign-in form** is the one screen outside the
 * guarded parent, and everything else is a child of it, so `requireAuth` runs for
 * every route in the app — including ones added later — while `requireModule` still
 * decides, per route, whether the workspace's licence includes that feature.
 */
export const routes: Routes = [
  { path: 'signin', component: SignInComponent },
  {
    path: '',
    canActivateChild: [requireAuth],
    children: [
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
      { path: 'assets', component: AssetsComponent },
      // The view is "Assets" now — keep the old URL working for bookmarks.
      { path: 'items', redirectTo: 'assets', pathMatch: 'full' },
      { path: 'logistics', component: LogisticsComponent, canActivate: [requireModule('dispatch')] },
      { path: 'maintenance', component: MaintenanceComponent, canActivate: [requireModule('service')] },
      { path: 'orders', component: OrdersComponent },
      { path: 'pricing', component: PricingComponent },
      { path: 'purchasing', component: PurchasingComponent },
      { path: 'rentals', component: RentalsComponent, canActivate: [requireModule('rentals')] },
      { path: 'scheduler', component: SchedulerComponent, canActivate: [requireModule('scheduling')] },
      { path: 'telemetry', component: TelemetryComponent, canActivate: [requireModule('telemetry')] },
      { path: 'timesheet', component: TimesheetComponent, canActivate: [requireModule('labor')] },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
