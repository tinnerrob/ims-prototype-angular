import { Injectable } from '@angular/core';

import { DASHBOARD_WIDGETS, DashboardWidget } from './dashboard';
import { DataService } from './data.service';
import { ModulesService } from './modules.service';

/**
 * IMS — DashboardService (Phase C).
 *
 * Joins the widget registry (`core/dashboard.ts`, a compile-time constant) to the
 * workspace's stored arrangement (`Tenant.dashboard`, tenant data) and answers the
 * two questions the two screens ask:
 *
 *  - the **dashboard** asks which widgets to render, in which order
 *    (`widgets()` — visible, licensed, in order);
 *  - **Admin → Dashboard** asks for the whole arrangement to edit
 *    (`adminVisible()` / `adminHidden()` + `toggle()` / `move()`).
 *
 * It is the `ModulesService` pattern applied to layout: the flags live on the
 * tenant, the reactive read/write sits in a service, and the pages never disagree
 * about what is on or where it goes. Nothing here knows what a widget *draws* —
 * that is the dashboard template's `@switch`, keyed by `widget.key`.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly byKey = new Map<string, DashboardWidget>(DASHBOARD_WIDGETS.map((w) => [w.key, w]));

  constructor(
    private readonly data: DataService,
    private readonly mods: ModulesService,
  ) {}

  /* ------------------------------ dashboard ----------------------------- */

  /** Widgets the dashboard renders: the workspace's order, visible, licensed. */
  widgets(): DashboardWidget[] {
    const hidden = this.hidden();
    return this.order()
      .filter((k) => !hidden.includes(k))
      .map((k) => this.byKey.get(k))
      .filter((w): w is DashboardWidget => !!w && this.moduleOn(w));
  }

  /* -------------------------------- admin ------------------------------- */

  /** Widgets the workspace shows, in order (Admin → Dashboard, module-agnostic). */
  adminVisible(): DashboardWidget[] {
    const hidden = this.hidden();
    return this.order()
      .filter((k) => !hidden.includes(k))
      .map((k) => this.byKey.get(k))
      .filter((w): w is DashboardWidget => !!w);
  }

  /** Widgets the workspace has switched off, in registry order. */
  adminHidden(): DashboardWidget[] {
    const hidden = this.hidden();
    return hidden.map((k) => this.byKey.get(k)).filter((w): w is DashboardWidget => !!w);
  }

  /** Whether a widget is switched on for this workspace. */
  visible(key: string): boolean {
    return !this.hidden().includes(key);
  }

  /** Whether a widget's industry module is licensed (a gaugeless widget is always on). */
  moduleOn(w: DashboardWidget): boolean {
    return !w.module || this.mods.isEnabled(w.module);
  }

  /** Switch a widget on (back to its place) or off. */
  toggle(key: string, on: boolean): void {
    const hidden = this.hidden().filter((k) => k !== key);
    this.data.setDashboardLayout({ order: this.order(), hidden: on ? hidden : [...hidden, key] });
  }

  /** Move a *visible* widget one slot up (`-1`) or down (`+1`). */
  move(key: string, delta: number): void {
    const hidden = this.hidden();
    const visible = this.order().filter((k) => !hidden.includes(k));
    const i = visible.indexOf(key);
    const to = i + delta;
    if (i < 0 || to < 0 || to >= visible.length) return;
    const [k] = visible.splice(i, 1);
    visible.splice(to, 0, k);
    // Visible widgets lead, hidden trail — order is only meaningful for what shows.
    this.data.setDashboardLayout({ order: [...visible, ...hidden], hidden });
  }

  /** True when a widget has a neighbour in the given direction (arrow state). */
  canMove(key: string, delta: number): boolean {
    const hidden = this.hidden();
    const visible = this.order().filter((k) => !hidden.includes(k));
    const to = visible.indexOf(key) + delta;
    return visible.indexOf(key) >= 0 && to >= 0 && to < visible.length;
  }

  /** Restore the registry default (every widget, registry order). */
  reset(): void {
    this.data.setDashboardLayout(undefined);
  }

  /** Switch every widget back on, keeping the current order. */
  enableAll(): void {
    this.data.setDashboardLayout({ order: this.order(), hidden: [] });
  }

  /* ------------------------------ internals ----------------------------- */

  /**
   * Every registry key, in the workspace's order: the stored order with unknown
   * keys dropped, then any registry widget the stored order has never seen
   * appended — so a widget added in a later release shows up rather than being
   * silently missing (the workspace can switch it off again).
   */
  private order(): string[] {
    this.data.revision();
    const known = DASHBOARD_WIDGETS.map((w) => w.key);
    const stored = (this.data.dashboardLayout()?.order ?? []).filter((k) => known.includes(k));
    for (const k of known) if (!stored.includes(k)) stored.push(k);
    return stored;
  }

  /** Keys the workspace has switched off. */
  private hidden(): string[] {
    this.data.revision();
    return this.data.dashboardLayout()?.hidden ?? [];
  }
}
