/**
 * IMS — pure date, time and period helpers.
 *
 * Lifted out of `data.service.ts` (B1): the store is a store, not a toolkit. The
 * Scheduler, Labor & Timesheets, the inspection log, Hand-Off and both purchasing
 * lists all page by the same day/week/month convention, and this is where that
 * convention lives — one definition the calendars and the list filters share.
 *
 * These names are re-exported from `core/data.service.ts`, so every existing
 * `from '../../core/data.service'` import keeps working unchanged.
 */

/** Zero-pad to 2 (`minHM`, `dISO`). */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** "HH:mm" -> minutes past midnight (prototype `hmMin`). */
export function hmMin(s: string | null | undefined): number {
  if (s == null) return 0;
  const p = String(s).split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

/** Minutes past midnight -> "HH:mm" (prototype `minHM`). */
export function minHM(m: number): string {
  return pad2(Math.floor((((m % 1440) + 1440) % 1440) / 60)) + ':' + pad2(((m % 60) + 60) % 60);
}

/** Snap minutes to the nearest 15 (prototype `snap15`), clamped to the day. */
export function snap15(m: number): number {
  const r = Math.round(m / 15) * 15;
  return r < 0 ? 0 : r >= 1440 ? 1439 : r;
}

/** Local "YYYY-MM-DD" for a date (prototype `dISO`). */
export function dISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Period a date navigator can page through (Scheduler / Labor & Timesheets / inspection log). */
export type PeriodView = 'day' | 'week' | 'month';

/**
 * A list/log **period filter**: one of the three periods, or `all` for no filter.
 *
 * The inspection log, the work-order grid and both purchasing lists show the same
 * All / Day / Week / Month chips over the same ‹ › pager, so the vocabulary lives
 * here rather than being re-declared per page. `all` is a *filter* state, not a
 * period, which is why it is not part of `PeriodView`.
 */
export type RangeFilter = 'all' | PeriodView;

/** The chips, in render order (`All` leads). */
export const RANGE_FILTERS: RangeFilter[] = ['all', 'day', 'week', 'month'];

/** Chip label for a filter. */
export const RANGE_FILTER_LABEL: Record<RangeFilter, string> = {
  all: 'All',
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/**
 * The `PeriodView` a filter pages through: `all` has no pager of its own, so it
 * reads as a single day (its bounds are the cursor's day, and its label is that
 * day) — exactly what the three pages did inline.
 */
export function rangeView(range: RangeFilter): PeriodView {
  return range === 'all' ? 'day' : range;
}

/**
 * Label for a period in the date navigators, anchored on its first day — one
 * wording for every pager in the app: "Monday, Aug 17, 2026", "Week of Aug 17, 2026"
 * or "Month of August 2026". Week/month name the period and its first day only
 * (no end date).
 */
export function periodLabel(view: PeriodView, date: Date): string {
  if (view === 'month') return 'Month of ' + date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (view === 'week') {
    return 'Week of ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Sentence form of `periodLabel` for prose ("free for the week of Aug 17, 2026"):
 * the week/month labels are lower-cased and take an article, a day label is
 * already a date so it is returned as-is.
 */
export function periodPhrase(view: PeriodView, date: Date): string {
  const label = periodLabel(view, date);
  return view === 'day' ? label : `the ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** Monday of the week containing `d` — the app's one week convention (see `periodBounds`). */
export function mondayOf(d: Date): Date {
  return dayAt(d, -((d.getDay() + 6) % 7));
}

/** `d` moved by `days`, as a new Date (a period pager's step). */
export function dayAt(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Inclusive ISO bounds of the period a `day` / `week` / `month` navigator shows,
 * anchored on the day its label names — Monday-based weeks and a month ending on
 * its last day, the same day `periodLabel()` words.
 *
 * This is the window a **list** filter tests its rows against (`date >= start &&
 * date <= end`); the two calendars build their own columns from the same
 * convention rather than asking for bounds, so only the logs share this.
 */
export function periodBounds(view: PeriodView, anchor: Date): { start: string; end: string } {
  if (view === 'month') {
    return {
      start: dISO(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      end: dISO(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    };
  }
  if (view === 'week') {
    const start = mondayOf(anchor);
    return { start: dISO(start), end: dISO(dayAt(start, 6)) };
  }
  return { start: dISO(anchor), end: dISO(anchor) };
}

/**
 * Anchor a period cursor inside the window its view shows: a month on its 1st and
 * a week on its Monday (a day is already a day). The three period pages ran this
 * branch themselves after a chip change; it lives here so they cannot drift.
 */
export function alignPeriod(view: PeriodView, anchor: Date): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (view === 'week') return mondayOf(anchor);
  return anchor;
}

/**
 * Page a period cursor one step: a month moves by calendar month, a week by seven
 * days and a day by one — always from the anchored cursor, so ‹ › from a month is
 * the 1st of the previous/next month.
 */
export function shiftPeriod(view: PeriodView, anchor: Date, dir: number): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return dayAt(anchor, dir * (view === 'week' ? 7 : 1));
}

/** Calendar days spanned by [a, b], minimum 1 (prototype `daysBetween`). */
export function daysBetween(a: string, b: string): number {
  const diff = (Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000;
  return Math.max(1, Math.round(diff));
}

/** Mon–Fri weekdays spanned by [a, b], minimum 1 (prototype `countWeekdays`). */
export function countWeekdays(a: string, b: string): number {
  const end = new Date(Date.parse(b + 'T00:00:00'));
  const cur = new Date(Date.parse(a + 'T00:00:00'));
  let n = 0;
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, n);
}

/** Whole days from `a` to `b`: the day *index* of `b` (prototype `dayOffset`). */
export function dayOffset(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);
}

/** A day ISO shifted by whole days (prototype `addDays`). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00') + days * 86400000).toISOString().slice(0, 10);
}

