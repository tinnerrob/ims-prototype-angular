import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { ModulesService } from './core/modules.service';
import { TelemetryService } from './core/telemetry.service';
import { NAV_GROUPS, ViewDef, viewFor } from './core/views';
import { ConfirmDialogComponent } from './shared/confirm/confirm-dialog.component';

/**
 * App shell — sidebar + topbar, ported from the prototype's index.html and
 * `js/router.js` (`showView` / `applyModuleNav`).
 *
 * - Nav sections + labels + icons + MOD tags come from the shared VIEWS registry.
 * - The topbar shows the active view's title/subtitle (the prototype sets
 *   `#pageTitle` / `#pageSub` on every `showView`).
 * - Global search and the notification bell route to Fleet Telemetry (or the
 *   catalog when telemetry is disabled), exactly like the prototype.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, ConfirmDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly groups = NAV_GROUPS;

  /** Active view (drives the topbar title + subtitle). */
  view: ViewDef | undefined;

  search = '';

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
  ) {
    this.setViewFromUrl(this.router.url);
  }

  ngOnInit(): void {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.setViewFromUrl((e as NavigationEnd).urlAfterRedirects);
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

  /** Enter in the global search runs the telemetry filter (prototype behaviour). */
  onSearch(): void {
    const q = this.search.trim();
    if (!q) return;
    const target = this.mods.isEnabled('telemetry') ? '/telemetry' : '/items';
    this.router.navigate([target], { queryParams: { q } });
    this.search = '';
  }

  openNotifications(): void {
    this.router.navigate([this.mods.isEnabled('telemetry') ? '/telemetry' : '/dashboard']);
  }

  toggleSidebar(): void {
    document.querySelector('.sidebar')?.classList.toggle('open');
  }

  private setViewFromUrl(url: string): void {
    const path = url.split('?')[0].split('#')[0];
    const id = path.split('/').filter(Boolean)[0] ?? 'dashboard';
    this.view = viewFor(id) ?? viewFor('dashboard');
  }
}
