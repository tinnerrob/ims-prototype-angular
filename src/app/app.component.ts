import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { ModulesService } from './core/modules.service';
import { PageSearchService } from './core/page-search.service';
import { TelemetryService } from './core/telemetry.service';
import { NAV_GROUPS, ViewDef, viewFor } from './core/views';
import { ConfirmDialogComponent } from './shared/confirm/confirm-dialog.component';
import { TipHostComponent } from './shared/tip/tip-host.component';

/**
 * App shell — sidebar + topbar, ported from the prototype's index.html and
 * `js/router.js` (`showView` / `applyModuleNav`).
 *
 * - Nav sections + labels + icons + MOD tags come from the shared VIEWS registry.
 * - The topbar shows the active view's title/subtitle (the prototype sets
 *   `#pageTitle` / `#pageSub` on every `showView`).
 * - The topbar search belongs to the page, not to the app: it is rendered only
 *   on the views the registry marks searchable (`VIEWS[].search`) and narrows
 *   that view's own lists through `PageSearchService`. The notification bell
 *   still routes to Fleet Telemetry, exactly like the prototype.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, ConfirmDialogComponent, TipHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly groups = NAV_GROUPS;

  /** Active view (drives the topbar title, subtitle and page search). */
  view: ViewDef | undefined;

  readonly today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  constructor(
    private readonly router: Router,
    readonly mods: ModulesService,
    readonly telemetry: TelemetryService,
    readonly search: PageSearchService,
  ) {
    this.view = this.viewFromUrl(this.router.url);
    this.search.activate(this.view?.search ?? '');
  }

  ngOnInit(): void {
    // Hand the search box over at *NavigationStart*, before the router builds
    // the target view: NavigationEnd arrives after the new page's constructor
    // has already reported its counts, so resetting there would wipe them.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationStart))
      .subscribe((e) => this.search.activate(this.viewFromUrl((e as NavigationStart).url)?.search ?? ''));
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.view = this.viewFromUrl((e as NavigationEnd).urlAfterRedirects);
      window.scrollTo(0, 0);
    });
    // The live GPS loop runs while the telemetry module is enabled (prototype `init`).
    if (this.mods.isEnabled('telemetry')) this.telemetry.start();
  }

  ngOnDestroy(): void {
    this.telemetry.stop();
  }

  /** Nav entries for a section, hiding routes whose module is switched off. */
  navItems(group: { views: ViewDef[] }): ViewDef[] {
    return group.views.filter((v) => !v.module || this.mods.isEnabled(v.module));
  }

  /** Topbar subtitle for the active view. */
  subtitle(): string {
    return this.view?.desc ?? '';
  }

  /** Nav badge on Fleet Telemetry (prototype `#navGeoBadge`). */
  geoAlerts(): number {
    return this.telemetry.breachCount();
  }

  /** Bell count (prototype `#notifCount`). */
  notifications(): number {
    return this.mods.isEnabled('telemetry') ? this.telemetry.breachCount() : 0;
  }

  /** The topbar box writes straight into the page-search query (live filter). */
  setSearch(value: string): void {
    this.search.query.set(value);
  }

  /** The box's × and Escape both empty it. */
  clearSearch(): void {
    this.search.clear();
  }

  openNotifications(): void {
    this.router.navigate([this.mods.isEnabled('telemetry') ? '/telemetry' : '/dashboard']);
  }

  toggleSidebar(): void {
    document.querySelector('.sidebar')?.classList.toggle('open');
  }

  /** The view a URL belongs to ('' and unknown paths fall back to Dashboard). */
  private viewFromUrl(url: string): ViewDef | undefined {
    const path = url.split('?')[0].split('#')[0];
    const id = path.split('/').filter(Boolean)[0] ?? 'dashboard';
    return viewFor(id) ?? viewFor('dashboard');
  }
}
