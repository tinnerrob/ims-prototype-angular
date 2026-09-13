import { Component } from '@angular/core';

import { DashboardWidget } from '../../core/dashboard';
import { DashboardService } from '../../core/dashboard.service';
import { ModulesService } from '../../core/modules.service';

/**
 * Administration → Dashboard (Phase C) — switch the Operations Dashboard's
 * widgets on or off and order them.
 *
 * The arrangement is the **workspace's** (`Tenant.dashboard`), like the module
 * licences next door: two people on the same tenant see the same board. The
 * widgets themselves are the compile-time registry in `core/dashboard.ts`; this
 * page only edits *which* of them show and *in what order*, so the dashboard
 * template and this page never have to be changed in step.
 */
@Component({
  selector: 'ims-dashboard-widgets',
  standalone: true,
  templateUrl: './dashboard-widgets.component.html',
  styleUrl: './dashboard-widgets.component.scss',
})
export class DashboardWidgetsComponent {
  constructor(
    readonly dash: DashboardService,
    readonly mods: ModulesService,
  ) {}

  /** Widgets the workspace shows, in order. */
  visible(): DashboardWidget[] {
    return this.dash.adminVisible();
  }

  /** Widgets switched off, in registry order. */
  hidden(): DashboardWidget[] {
    return this.dash.adminHidden();
  }

  on(key: string): boolean {
    return this.dash.visible(key);
  }

  toggle(key: string): void {
    this.dash.toggle(key, !this.on(key));
  }

  move(key: string, delta: number): void {
    this.dash.move(key, delta);
  }

  canMove(key: string, delta: number): boolean {
    return this.dash.canMove(key, delta);
  }

  /** A widget whose industry module is off is listed but cannot show yet. */
  moduleOn(w: DashboardWidget): boolean {
    return this.dash.moduleOn(w);
  }

  reset(): void {
    this.dash.reset();
  }

  enableAll(): void {
    this.dash.enableAll();
  }
}
