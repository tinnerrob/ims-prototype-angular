/**
 * The Scheduler's **calendar and capacity math**, as pure functions.
 *
 * Extracted from `scheduler.component.ts` (P6/3 in `angular-refactor-log.md`) for two
 * reasons, in this order:
 *
 * 1. **Testability.** These functions decide which days are on screen, which bookings
 *    fall inside them, and whether a booking over-asks a resource — the questions the
 *    screen exists to answer — yet they lived inside a 1,591-line component that no
 *    test could reach. `scripts/runtime-checks/check26.mjs` now drives them directly
 *    (and instantiates the component on top, because P9b made that possible).
 * 2. **One definition.** `columnsFor()` is the single source of truth for "what is a
 *    week": the pager, the pager label, the pool badges, the day-view geometry and the
 *    drag clamps all read it through the component's thin delegates.
 *
 * Everything here is a pure function of its arguments — no store, no Angular, no DOM —
 * so the day/week/month arithmetic can be reasoned about (and tested) without a browser.
 * The component keeps thin same-named methods, so its ~100 call sites and its template
 * did not have to change.
 *
 * The *geometry* layer (`models()`, `conflicts()` and the `geom*`/`*T0`/`*T1` helpers
 * that turn these windows into pixels) is deliberately not here yet: it reads catalog
 * names and capacities from the store, so it is the next slice, not this one.
 */
import { CatalogType, Item, Order, OrderLine } from '../../core/models';

export type View = 'day' | 'week' | 'month';

/** One column of the timeline (a day in Week/Month, an hour in Day view). */
export interface DayCol { start: number; label: string; sub: string }
/** A bar's placement inside its row, in pixels (Day view: within one day). */
export interface BarGeom { left: number; width: number }
export interface BarModel {
  orderId: string;
  liId: string | null;
  type: CatalogType | 'order';
  label: string;
  /** Short label shown in the row gutter (prototype `shortItemLabel`). */
  short: string;
  sub: string;
  conflict: boolean;
  geom: BarGeom;
}
export interface OrderModel { order: Order; isExpanded: boolean; orderBar: BarModel | null; lines: BarModel[] }
/** A booking (order line) of one pool item, with its effective window. */
export interface BookingRef { orderId: string; start: string; end: string }
/** One day-inclusive window asking for `qty` units (see `peakUnits`). */
export interface Span { start: number; end: number; qty: number }
/** The visible period as inclusive local-midnight millisecond bounds. */
export interface RangeBounds { start: number; end: number }

export const DAY_MS = 86400000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local midnight of `d`, in milliseconds. */
export function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Local midnight of the Monday of `ms`'s week (the Week view's anchor day). */
export function mondayOf(ms: number): number {
  const x = new Date(ms);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return startOfDay(x);
}

/** Local midnight `i` days from `base` — calendar-safe across DST. */
export function dayAt(base: number, i: number): number {
  const d = new Date(base);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime();
}

/** Zero-pads a day-view hour label (`9` → `09`). */
export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * The visible columns of a view, anchored on `anchor`: the whole month's days
 * (`start` = that day's midnight), the anchor's Monday..Sunday, or the 24 one-hour
 * segments of Day view (`start` is 0 — hours are positions, not dates).
 */
export function columnsFor(view: View, anchor: number): DayCol[] {
  const out: DayCol[] = [];
  if (view === 'month') {
    const d = new Date(anchor);
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= n; i++) {
      const c = new Date(d.getFullYear(), d.getMonth(), i);
      out.push({ start: c.getTime(), label: String(i), sub: DAY_NAMES[c.getDay()] });
    }
  } else if (view === 'week') {
    const base = mondayOf(anchor);
    for (let i = 0; i < 7; i++) {
      const c = dayAt(base, i);
      out.push({ start: c, label: DAY_NAMES[new Date(c).getDay()], sub: MONTHS[new Date(c).getMonth()] + ' ' + new Date(c).getDate() });
    }
  } else {
    // Day view: 24 one-hour segments (00:00 .. 23:00)
    for (let h = 0; h < 24; h++) {
      out.push({ start: 0, label: pad2(h) + ':00', sub: '' });
    }
  }
  return out;
}

/** First day of the visible period — the one the pager label is anchored on. */
export function periodStartFor(view: View, anchor: number): Date {
  return view === 'day' ? new Date(anchor) : new Date(columnsFor(view, anchor)[0].start);
}

/**
 * The visible period as inclusive local-midnight millisecond bounds.
 * Day view = the anchor day; Week/Month = the first..last column.
 */
export function rangeBoundsFor(view: View, anchor: number): RangeBounds {
  const cols = columnsFor(view, anchor);
  const start = view === 'day' ? anchor : cols[0].start;
  const last = view === 'day' ? anchor : cols[cols.length - 1].start;
  return { start, end: dayAt(last, 1) - 1 };
}

/** A line's own window, falling back to the order's (see `OrderLine.startDate`). */
export function lineStart(li: OrderLine, order: Order): string { return li.startDate ?? order.startDate; }
export function lineEnd(li: OrderLine, order: Order): string { return li.endDate ?? order.endDate; }

/**
 * Peak units committed at once across a set of windows. Each span is day-
 * inclusive; its end event lands on the day *after* the window, so a booking
 * that finishes the day another begins still counts as overlapping that day.
 *
 * Ties end before they start, so a window closing as an identical one opens
 * doesn't read as a momentary clash it never had.
 */
export function peakUnits(spans: Span[]): number {
  const events: { at: number; delta: number }[] = [];
  for (const s of spans) {
    events.push({ at: s.start, delta: s.qty });
    events.push({ at: s.end + DAY_MS, delta: -s.qty });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const ev of events) {
    running += ev.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

/**
 * Active-order bookings of a pool item that **overlap the visible period**
 * (prototype's `capAvailUI` recomputed per render instead of a fixed state).
 * This is what makes the pool reflect the range selected in the calendar.
 */
export function bookingsInRange(item: Item, orders: Order[], view: View, anchor: number): BookingRef[] {
  const r = rangeBoundsFor(view, anchor);
  const out: BookingRef[] = [];
  for (const o of orders) {
    for (const li of o.lineItems) {
      if (li.type !== item.type || li.refId !== item.id) continue;
      const start = lineStart(li, o);
      const end = lineEnd(li, o);
      const s = new Date(start + 'T00:00:00').getTime();
      const e = new Date(end + 'T00:00:00').getTime() + DAY_MS - 1;
      if (s <= r.end && r.start <= e) out.push({ orderId: o.orderId, start, end });
    }
  }
  return out;
}

/**
 * How many units of `item` are committed at once between two day bounds — every
 * booking of that resource, clipped to the window (so a booking that started
 * earlier still counts for the days inside it). This is the number the capacity
 * check measures: 24 jugs of hydraulic fluid on two orders is fine, until the two
 * windows overlap and together ask for more than the item owns.
 */
export function committedUnits(item: Item, orders: Order[], from: number, to: number): number {
  const spans: Span[] = [];
  for (const o of orders) {
    for (const li of o.lineItems) {
      if (li.type !== item.type || li.refId !== item.id) continue;
      const s = Date.parse(lineStart(li, o) + 'T00:00:00');
      const e = Date.parse(lineEnd(li, o) + 'T00:00:00');
      if (s > to || e < from) continue;
      spans.push({ start: Math.max(s, from), end: Math.min(e, to), qty: li.qty || 1 });
    }
  }
  return peakUnits(spans);
}

