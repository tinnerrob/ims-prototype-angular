import { Routes } from '@angular/router';

import { requireModule } from './core/module.guard';
import { CategoriesComponent } from './features/categories/categories.component';
import { ConfigComponent } from './features/config/config.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HandoffComponent } from './features/handoff/handoff.component';
import { InspectionsComponent } from './features/inspections/inspections.component';
import { InvoicingComponent } from './features/invoicing/invoicing.component';
import { ItemsComponent } from './features/items/items.component';
import { LocationsComponent } from './features/locations/locations.component';
import { LogisticsComponent } from './features/logistics/logistics.component';
import { MaintenanceComponent } from './features/maintenance/maintenance.component';
import { OrdersComponent } from './features/orders/orders.component';
import { RentalsComponent } from './features/rentals/rentals.component';
import { SchedulerComponent } from './features/scheduler/scheduler.component';
import { TimesheetComponent } from './features/timesheet/timesheet.component';

/**
 * Core-first route map (mirrors the prototype's VIEWS registry).
 * Core views are top-level; future industry modules become lazy-loaded
 * child modules under a guard once the module registry is ported.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'categories', component: CategoriesComponent },
  { path: 'admin', component: ConfigComponent },
  { path: 'handoff', component: HandoffComponent },
  { path: 'inspections', component: InspectionsComponent },
  { path: 'invoicing', component: InvoicingComponent, canActivate: [requireModule('billing')] },
  { path: 'items', component: ItemsComponent },
  { path: 'locations', component: LocationsComponent },
  { path: 'logistics', component: LogisticsComponent, canActivate: [requireModule('dispatch')] },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [requireModule('service')] },
  { path: 'orders', component: OrdersComponent },
  { path: 'rentals', component: RentalsComponent, canActivate: [requireModule('rentals')] },
  { path: 'scheduler', component: SchedulerComponent, canActivate: [requireModule('scheduling')] },
  { path: 'timesheet', component: TimesheetComponent, canActivate: [requireModule('labor')] },
  { path: '**', redirectTo: 'dashboard' },
];
