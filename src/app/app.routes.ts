import { Routes } from '@angular/router';

import { CategoriesComponent } from './features/categories/categories.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';

/**
 * Core-first route map (mirrors the prototype's VIEWS registry).
 * Core views are top-level; future industry modules become lazy-loaded
 * child modules under a guard once the module registry is ported.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'categories', component: CategoriesComponent },
  { path: '**', redirectTo: 'dashboard' },
];
