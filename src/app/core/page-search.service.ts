import { computed, Injectable, signal } from '@angular/core';

/** Rows the view is showing, out of the rows it holds without the query. */
export interface SearchCount {
  shown: number;
  total: number;
}

/**
 * Page search — the one search box in the shell topbar.
 *
 * The box belongs to the view on screen, not to the app. The shell renders it
 * only for views whose `VIEWS` entry declares a `search` placeholder (the eight
 * searchable pages — Assets, Hand-Off, Receiving/Inspections, Parties &
 * Orders, Fleet Telemetry, Labor & Timesheets, Field Service, Billing &
 * Invoicing), shows that view's wording, and hides it everywhere else.
 *
 * The mounted view reads `query()` and narrows its own lists through the shared
 * `matches()` rule, so the search *and* filter are one thing: what the box says
 * is what the page shows. A page searches all of itself — on a tabbed page
 * (Assets, Hand-Off & Custody, Parties & Orders) the query keeps working
 * as tabs change and narrows every tab's rows, so the tab counts read as "where
 * are the matches" rather than "what is on this tab".
 *
 * `activate()` runs on every navigation ('' for a view with no page search), so
 * the box never appears on Dashboard / Scheduling / Locations … and a query
 * never leaks from one page to the next.
 *
 * This replaces the prototype's global search (`App.onSearch`), which jumped to
 * Fleet Telemetry / Items with `?q=` no matter which page it was typed on.
 */
@Injectable({ providedIn: 'root' })
export class PageSearchService {
  /** What the user has typed (live — the page filters as you type, no Enter). */
  readonly query = signal('');

  /** The active view's placeholder; '' while that view has no page search. */
  readonly placeholder = signal('');

  /** The topbar renders the box only while the active view is searchable. */
  readonly active = computed(() => this.placeholder() !== '');

  /**
   * Result feedback for the box ("3 of 12"), handed over by the mounted view.
   *
   * A view publishes a *thunk* rather than a number so the count stays live
   * without re-pushing it: `results` runs the thunk inside its own evaluation,
   * which tracks every signal the view reads while counting (its rows, its
   * active tab, the query).
   */
  private readonly counter = signal<(() => SearchCount) | null>(null);

  /** How much of the page survives the query, or null while nothing is typed. */
  readonly results = computed(() => (this.isBlank() ? null : (this.counter()?.() ?? null)));

  /**
   * Called by the shell on every navigation: the active view's
   * `VIEWS[].search` placeholder, or '' for a view with no page search. Either
   * way the query starts clean, so no page inherits another's search.
   */
  activate(placeholder: string): void {
    this.placeholder.set(placeholder);
    this.query.set('');
    this.counter.set(null);
  }

  /** Empty the box (the box's × / Escape) without leaving the page. */
  clear(): void {
    this.query.set('');
  }

  /** Nothing is being searched for — the view shows its full lists. */
  isBlank(): boolean {
    return this.query().trim() === '';
  }

  /**
   * The shared match rule every searchable view narrows through: the trimmed,
   * case-insensitive query against any of the view's own fields. An empty query
   * matches everything, so a view can filter unconditionally.
   */
  matches(...parts: (string | number | null | undefined)[]): boolean {
    const q = this.query().trim().toLowerCase();
    if (!q) return true;
    return parts.some((p) => p != null && p !== '' && String(p).toLowerCase().includes(q));
  }

  /**
   * Publish what the view is currently showing, for the box's result chip.
   * Called once from the view's constructor; `activate()` clears it again.
   */
  report(counter: () => SearchCount): void {
    this.counter.set(counter);
  }
}
