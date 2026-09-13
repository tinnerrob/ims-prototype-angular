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
import { CATALOG_TYPES, CatalogType, Item, Order, OrderLine } from '../../core/models';

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

/* ======================================================================================
 * The geometry layer (P6/4) — turning those windows into pixels.
 *
 * This is the layer above the calendar math, and it is the one that needs the store:
 * names come from the catalog (`itemLabel`), quantity from the item (`capacity`), and
 * the Day view's minute windows from the order (`orderT0`/`orderT1`). Rather than take
 * the whole `DataService`, these functions take a `ScheduleReader` — the six reads they
 * actually perform — so the contract is visible in the signature and a check can drive
 * them with a stub. Nothing here writes.
 * ==================================================================================== */

/** A conflict row, as the inspector pane prints it. */
export interface ConflictRow { type: CatalogType; refId: string; orderId: string; label: string; detail: string }

/** The visible state a render was derived from. */
export interface ViewState { view: View; anchor: number; expanded: ReadonlySet<string> }

/**
 * The slice of the store the geometry layer reads. Declared structurally so a stub can
 * stand in (a check does exactly that) and so it is obvious from the signatures that
 * nothing here mutates.
 */
export interface ScheduleReader {
  orderT0(o: Order): number;
  orderT1(o: Order): number;
  getItem(type: CatalogType, refId: string): Item | undefined;
  itemLabel(type: CatalogType, refId: string): string;
  mkName(item: Item | undefined): string;
  capacity(item: Item): number;
}

/** Units this line takes — never below 1 (a serialized unit / employee is 1). */
export function lineQty(li: OrderLine): number { return li.qty || 1; }

/**
 * ` · ×12` for a multi-unit line, '' when it takes one — appended to a timeline
 * bar's sub-line, which is otherwise the only place a booking's quantity is
 * invisible (the Order Details row is where it is edited).
 */
export function qtySuffix(li: OrderLine): string {
  const q = lineQty(li);
  return q > 1 ? ' · ×' + q : '';
}

export function orderT0(data: ScheduleReader, o: Order): number { return data.orderT0(o); }
export function orderT1(data: ScheduleReader, o: Order): number { return data.orderT1(o); }
export function lineT0(data: ScheduleReader, li: OrderLine, o: Order): number { return li.t0 ?? orderT0(data, o); }
export function lineT1(data: ScheduleReader, li: OrderLine, o: Order): number { return li.t1 ?? orderT1(data, o); }

/** Does this order's date window include the Day-view anchor? */
export function dateIncludes(o: Order, anchor: number): boolean {
  const day = new Date(anchor);
  day.setHours(0, 0, 0, 0);
  const d = day.getTime();
  const s = new Date(o.startDate + 'T00:00:00').getTime();
  const e = new Date(o.endDate + 'T00:00:00').getTime() + DAY_MS - 1;
  return d >= s && d <= e;
}

/** Percentage geometry across the 24-hour day (0..1440 minutes). */
export function geomMin(t0: number, t1: number): BarGeom | null {
  const l = Math.max(0, Math.min(1440, t0));
  const r = Math.max(0, Math.min(1440, t1));
  if (r <= l) return null;
  return { left: (l / 1440) * 100, width: ((r - l) / 1440) * 100 };
}

/** `HH:MM` from minutes-of-day. */
export function fmtMin(t: number): string {
  return pad2(Math.floor(t / 60)) + ':' + pad2(Math.round(t % 60));
}

/**
 * Where a day-inclusive ISO window sits across the current columns, as percentages.
 * Day indices come from LOCAL midnights — never floor raw epoch, which is UTC and
 * would make indices fractional in non-UTC timezones, mis-sizing the bars.
 */
export function geom(isoStart: string, endISO: string, view: View, anchor: number): BarGeom | null {
  const cols = columnsFor(view, anchor);
  const N = cols.length;
  const first = cols[0].start;
  const dayIndex = (iso: string): number => Math.round((new Date(iso + 'T00:00:00').getTime() - first) / DAY_MS);
  const sIdx = dayIndex(isoStart);
  const eIdx = dayIndex(endISO);
  if (eIdx < 0 || sIdx >= N) return null;
  const cs = Math.max(0, sIdx);
  const ce = Math.min(N - 1, eIdx);
  return { left: (cs / N) * 100, width: ((ce - cs + 1) / N) * 100 };
}

/** Day-inclusive length of a booking, in days (never below 1). */
export function lineDays(li: OrderLine, order: Order): number {
  const s = new Date(lineStart(li, order) + 'T00:00:00').getTime();
  const e = new Date(lineEnd(li, order) + 'T00:00:00').getTime();
  return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
}

/**
 * Rank of a catalog type in the canonical order (serialized, bulk, consumable, part,
 * labor, kit, attachment) — the sort key that keeps like types together. Unknown types
 * (including the pseudo-type `'order'`) rank last.
 */
export function typeRank(type: CatalogType | 'order'): number {
  const i = CATALOG_TYPES.findIndex((c) => c.key === type);
  return i < 0 ? CATALOG_TYPES.length : i;
}

export function itemName(data: ScheduleReader, type: CatalogType, refId: string): string {
  return data.itemLabel(type, refId);
}

/** Short item label used in a line row's gutter (prototype `shortItemLabel`). */
export function shortItemLabel(data: ScheduleReader, li: OrderLine): string {
  const it = data.getItem(li.type, li.refId);
  return it ? data.mkName(it) || it.name : li.refId;
}

/**
 * An order's booked items grouped by catalog type (then by name, then by the day the
 * booking starts). Every list that shows mixed types — the expanded timeline rows, the
 * Order Details booked list and the conflicts pane — runs through this, and all of them
 * re-render from data, so the grouping is re-applied the moment a conflict is resolved
 * (a bar moved/resized, or a booking dropped) and the like types fall back together.
 */
export function sortedLines(data: ScheduleReader, order: Order): OrderLine[] {
  return [...order.lineItems].sort(
    (a, b) =>
      typeRank(a.type) - typeRank(b.type) ||
      itemName(data, a.type, a.refId).localeCompare(itemName(data, b.type, b.refId)) ||
      lineStart(a, order).localeCompare(lineStart(b, order)),
  );
}

/**
 * Capacity-aware conflict: a booking clashes only when the overlapping bookings for the
 * same resource need **more units than the item owns**. A serialized unit (capacity 1)
 * behaves exactly as before — any overlap is a clash — while 24 jugs of hydraulic fluid
 * can go out on two orders as long as their windows don't overlap and together over-ask.
 * `committedUnits()` walks every order, so the line under test is counted in its own peak.
 */
export function isConflicted(data: ScheduleReader, orders: Order[], li: OrderLine, order: Order): boolean {
  const item = data.getItem(li.type, li.refId);
  if (!item) return false;
  const s = Date.parse(lineStart(li, order) + 'T00:00:00');
  const e = Date.parse(lineEnd(li, order) + 'T00:00:00');
  return committedUnits(item, orders, s, e) > data.capacity(item);
}

/** "30 needed · 24 owned" — why the conflicts pane flagged the row. */
export function conflictDetail(data: ScheduleReader, orders: Order[], li: OrderLine, order: Order): string {
  const item = data.getItem(li.type, li.refId);
  if (!item) return '';
  const s = Date.parse(lineStart(li, order) + 'T00:00:00');
  const e = Date.parse(lineEnd(li, order) + 'T00:00:00');
  return committedUnits(item, orders, s, e) + ' needed · ' + data.capacity(item) + ' owned';
}

/**
 * One row per active order: its own bar (null when the order is off-screen) and the bars
 * of its bookings. Day view measures a row in minutes-of-day, Week/Month in days — the two
 * branches differ only in which geometry helper they call.
 */
export function models(data: ScheduleReader, orders: Order[], st: ViewState): OrderModel[] {
  const isDay = st.view === 'day';
  return orders.map((o) => {
    let og: BarGeom | null = null;
    let oSub = o.lineItems.length + ' items';
    if (isDay) {
      if (dateIncludes(o, st.anchor)) {
        og = geomMin(orderT0(data, o), orderT1(data, o));
        oSub = fmtMin(orderT0(data, o)) + '–' + fmtMin(orderT1(data, o));
      }
    } else {
      og = geom(o.startDate, o.endDate, st.view, st.anchor);
    }
    const orderBar: BarModel | null = og
      ? {
          orderId: o.orderId,
          liId: null,
          type: 'order',
          label: o.orderId,
          short: o.orderId,
          sub: oSub,
          conflict: false,
          geom: og,
        }
      : null;
    const lines: BarModel[] = [];
    for (const li of sortedLines(data, o)) {
      let lg: BarGeom | null = null;
      let sub = '';
      if (isDay) {
        if (dateIncludes(o, st.anchor)) {
          const t0 = Math.max(orderT0(data, o), Math.min(orderT1(data, o), lineT0(data, li, o)));
          const t1 = Math.max(t0, Math.min(orderT1(data, o), lineT1(data, li, o)));
          lg = geomMin(t0, t1);
          sub = fmtMin(t0) + '–' + fmtMin(t1) + qtySuffix(li);
        }
      } else {
        lg = geom(lineStart(li, o), lineEnd(li, o), st.view, st.anchor);
        sub = lineDays(li, o) + 'd' + qtySuffix(li);
      }
      if (!lg) continue;
      const conflict = !isDay && isConflicted(data, orders, li, o);
      lines.push({
        orderId: o.orderId,
        liId: li.id,
        type: li.type,
        label: itemName(data, li.type, li.refId),
        short: shortItemLabel(data, li),
        sub: sub + (conflict ? ' - CONFLICT' : ''),
        conflict,
        geom: lg,
      });
    }
    return { order: o, isExpanded: st.expanded.has(o.orderId), orderBar, lines };
  });
}

export function conflictCount(data: ScheduleReader, orders: Order[], st: ViewState): number {
  let n = 0;
  for (const m of models(data, orders, st)) for (const l of m.lines) if (l.conflict) n++;
  return n;
}

/**
 * Flat conflict list for the inspector pane (prototype `renderInspector`). Re-sorted by
 * catalog type so like types stay together, and recomputed on every render so resolving
 * a conflict immediately re-groups the list.
 */
export function conflicts(data: ScheduleReader, orders: Order[], st: ViewState): ConflictRow[] {
  const out: ConflictRow[] = [];
  for (const m of models(data, orders, st)) {
    for (const line of m.lines) {
      if (!line.conflict) continue;
      const li = m.order.lineItems.find((l) => l.id === line.liId);
      if (!li) continue;
      out.push({
        type: li.type,
        refId: li.refId,
        orderId: m.order.orderId,
        label: line.label,
        detail: conflictDetail(data, orders, li, m.order),
      });
    }
  }
  return out.sort(
    (a, b) =>
      typeRank(a.type) - typeRank(b.type) ||
      a.label.localeCompare(b.label) ||
      a.orderId.localeCompare(b.orderId),
  );
}

