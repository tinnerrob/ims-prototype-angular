import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService, hmMin, periodLabel, periodPhrase } from '../../core/data.service';
import {
  CatalogType,
  CATALOG_TYPES,
  ITEM_STATUSES,
  Item,
  Order,
  OrderLine,
  ORDER_STATUS_LABEL,
  statusClass,
} from '../../core/models';
import {
  RecordViewComponent,
  ViewField,
  ViewModel,
  ViewSection,
} from '../../shared/record-view/record-view.component';
import { snapshotForm, formChanged } from '../../shared/confirm/unsaved-changes';
import { ConfirmService } from '../../shared/confirm/confirm.service';
import { ModalDismissDirective } from '../../shared/modal-dismiss/modal-dismiss.directive';
import { stampRange } from '../../shared/tip/tip-format';
import { assetTip, orderRecordTip, orderTip, tip } from '../../shared/tip/tip-builders';
import { Tip, TipLine } from '../../shared/tip/tip.service';
import { TipDirective } from '../../shared/tip/tip.directive';

const DAY_MS = 86400000;
/** Gap within which a second click counts as a double-click (ms). */
const DBLCLICK_MS = 250;
const DAY_W = 90;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type View = 'day' | 'week' | 'month';
interface DayCol { start: number; label: string; sub: string; }
interface BarGeom { left: number; width: number; }
interface BarModel {
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
interface OrderModel { order: Order; isExpanded: boolean; orderBar: BarModel | null; lines: BarModel[]; }
interface ResizeState { orderId: string; liId: string | null; edge: 'l' | 'r'; track: HTMLElement; }
/**
 * A whole-block drag (move, not resize). The origin geometry is snapshotted on
 * pointerdown so every move event re-derives the block window from the gesture
 * total, which keeps the drag from drifting on rounding.
 */
interface MoveState {
  orderId: string;
  liId: string | null;
  track: HTMLElement;
  /** Pointer x where the gesture started. */
  x0: number;
  /** Day view: origin minutes-of-day. Week/Month: origin ISO dates. */
  t0: number;
  t1: number;
  sISO: string;
  eISO: string;
  /** Day-view clamp in minutes (an order spans the whole day, a line its order). */
  loMin: number;
  hiMin: number;
  /** Week/Month clamp in ISO — a line stays inside its order; '' = unclamped. */
  loISO: string;
  hiISO: string;
  /** True once the pointer actually travelled, so a plain click still selects. */
  moved: boolean;
}
/** A booking (order line) of one pool item, with its effective window. */
interface BookingRef { orderId: string; start: string; end: string }
/** Pool-card availability state (prototype `resCard` `avail.key`).
 *  Evaluated against the **visible period**, so the badge follows the selected
 *  range; `blocked` only means "not schedulable at all" (a retired item).
 *
 *  `badge` is the one-word state used by the read-only asset viewer ("3 booked",
 *  "On site · ORD-1004", "In Shop"); the pool CARD no longer prints it — it
 *  highlights the whole card and spells the state out in `line`/`dates` instead. */
interface Availability {
  key: 'free' | 'partial' | 'busy' | 'inactive';
  blocked: boolean;
  badge: string;
  /** Card-row detail — "Booked on ORD-1001" / "Out now on ORD-1004" / "In the
   *  shop" / "Retired". Empty for a free item (the card stays 2 rows). */
  line: string;
  /** The booking's date span, right-justified on the same row as `line`, in the
   *  compact M/D/YY form (`8/20/26 → 8/24/26`): `data.fmtDate()`'s padded
   *  08/24/2026 needed a row of its own in the 340px pane. Empty when there is no
   *  booking to date. */
  dates: string;
  /** Tooltip: the same facts in one sentence (and the only place that says
   *  overbooking is allowed — it used to be printed on every booked card). */
  note: string;
}

/** Catalog-type icon for the read-only asset viewer (matches the Items tabs). */
const POOL_ICON: Record<string, string> = {
  serialized: 'bi-truck-front',
  bulk: 'bi-boxes',
  consumable: 'bi-capsule',
  part: 'bi-wrench-adjustable',
  labor: 'bi-person-badge',
  kit: 'bi-boxes',
  attachment: 'bi-puzzle',
};

/** Short type labels used by `.type-chip` / row gutters (prototype `TYPE_LABEL`). */
const TYPE_LABEL: Record<string, string> = {
  serialized: 'Serialized',
  bulk: 'Bulk',
  consumable: 'Consumable',
  labor: 'Labor',
  part: 'Part',
  kit: 'Kit',
  attachment: 'Attachment',
};

/** "New <resource>" button copy per pool tab (prototype `poolAddLabel`). */
const POOL_ADD_LABEL: Record<string, string> = {
  serialized: 'New Item (Serialized)',
  bulk: 'New Bulk Item',
  consumable: 'New Consumable',
  part: 'New Stock Part',
  labor: 'New Labor / Crew',
  kit: 'New Kit',
  attachment: 'New Attachment',
};
@Component({
  selector: 'ims-scheduler',
  standalone: true,
  imports: [FormsModule, ModalDismissDirective, RecordViewComponent, TipDirective],
  templateUrl: './scheduler.component.html',
  styleUrl: './scheduler.component.scss',
})
export class SchedulerComponent implements OnDestroy {
  /** Pool tabs. The plain catalog labels ("Bulk Resources", not
   *  "Items (Bulk Resources)") — the card is already titled Assets, so
   *  the "Items (…)" prefix was redundant and pushed the select to truncate. */
  readonly poolTypes = CATALOG_TYPES;
  /** Per-type status options, exposed for the New Resource modal. */
  readonly statuses = ITEM_STATUSES;
  view: View = 'week';
  anchor: number = this.startOfDay(new Date());
  poolType: CatalogType = 'serialized';
  selectedOrderId = '';
  expanded = new Set<string>();
  dragging: { type: CatalogType; refId: string } | null = null;
  resizing: ResizeState | null = null;
  /** In-flight whole-block drag (drag a bar to another day/hour). */
  moving: MoveState | null = null;

  /**
   * Lane click waiting out the double-click window (see `onRowClick`): the
   * select/expand only happens once the record viewer can no longer be the
   * intent.
   */
  private pendingRowClick: { orderId: string; timer: ReturnType<typeof setTimeout> } | null = null;

  /** Read-only record viewer (double-click a pool card / block). */
  viewer: ViewModel | null = null;

  /** Bound once so the window listeners can be added and removed reliably. */
  private readonly onMovePointer = (ev: PointerEvent) => this.onMoveMove(ev);
  private readonly endMovePointer = () => this.onMoveUp();

  /** "New Order" modal (prototype `orderModal` → `openOrderModal`). */
  orderOpen = false;
  orderForm = this.emptyOrder();
  /** Editor values as they were when it opened (drives the discard prompt). */
  private orderSnap = '';

  /** "New <resource>" modal (prototype `addPoolResource` → `openAddModal`). */
  resOpen = false;
  resForm = this.emptyRes();
  /** Editor values as they were when it opened (drives the discard prompt). */
  private resSnap = '';

  /**
   * Drop-to-book quantity prompt (prototype `bookQtyModal`), opened when a resource
   * we own more than one of is dropped on an order — see `onDropOrder()`.
   */
  bookPrompt: { type: CatalogType; refId: string; orderId: string; qty: number } | null = null;

  constructor(
    readonly data: DataService,
    private cdr: ChangeDetectorRef,
    private confirm: ConfirmService,
  ) {
    // Anchor the calendar on the first active order's start week (prototype
    // `renderScheduler`), so the seeded orders are on screen immediately.
    const starts = this.orders()
      .map((o) => Date.parse(o.startDate + 'T00:00:00'))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    this.anchor = this.view === 'month'
      ? this.startOfDay(new Date(new Date(starts[0] ?? Date.now()).getFullYear(), new Date(starts[0] ?? Date.now()).getMonth(), 1))
      : this.mondayOf(starts[0] ?? Date.now());
    this.selectedOrderId = this.orders()[0]?.orderId ?? '';
  }

  ngOnDestroy(): void {
    this.detachResize();
    this.detachMove();
    this.cancelRowClick();
  }

  columns(): DayCol[] {
    const out: DayCol[] = [];
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= n; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), i);
        out.push({ start: c.getTime(), label: String(i), sub: DAY_NAMES[c.getDay()] });
      }
    } else if (this.view === 'week') {
      const base = this.mondayOf(this.anchor);
      for (let i = 0; i < 7; i++) {
        const c = this.dayAt(base, i);
        out.push({ start: c, label: DAY_NAMES[new Date(c).getDay()], sub: MONTHS[new Date(c).getMonth()] + ' ' + new Date(c).getDate() });
      }
    } else {
      // Day view: 24 one-hour segments (00:00 .. 23:00)
      for (let h = 0; h < 24; h++) {
        out.push({ start: 0, label: this.pad2(h) + ':00', sub: '' });
      }
    }
    return out;
  }

  colCount(): number { return this.columns().length; }
  viewStart(): number { return this.columns()[0].start; }
  tlWidth(): number { return 170 + this.colCount() * DAY_W; }

  /** Pager label for the visible period ("Week of Sep 7" / "Month of September"). */
  rangeLabel(): string {
    return periodLabel(this.view, this.periodStart());
  }

  /** Sentence form of `rangeLabel()` for prose ("free for the week of Sep 7"). */
  rangePhrase(): string {
    return periodPhrase(this.view, this.periodStart());
  }

  /** First day of the visible period — the one the pager label is anchored on. */
  private periodStart(): Date {
    return this.view === 'day' ? new Date(this.anchor) : new Date(this.columns()[0].start);
  }

  shift(dir: number): void {
    if (this.view === 'month') {
      const d = new Date(this.anchor);
      this.anchor = this.startOfDay(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      this.anchor = this.startOfDay(new Date(this.dayAt(this.anchor, dir * (this.view === 'week' ? 7 : 1))));
    }
    this.expanded.clear();
    this.selectedOrderId = '';
  }

  /** Switch Day/Week/Month, re-anchoring so the new period contains the cursor
   *  date (prototype `setLabView` / `#viewToggle`). */
  setView(v: View): void {
    this.view = v;
    const a = new Date(this.anchor);
    if (v === 'month') this.anchor = this.startOfDay(new Date(a.getFullYear(), a.getMonth(), 1));
    else if (v === 'week') this.anchor = this.mondayOf(a.getTime());
    else this.anchor = this.startOfDay(a);
  }

  orders(): Order[] { return this.data.listOrders().filter((o) => o.status === 'active'); }
  lanes(): Item[] { return this.data.listItems(this.poolType); }
  selectOrder(id: string): void { this.selectedOrderId = this.selectedOrderId === id ? '' : id; }
  toggleExpand(orderId: string): void { if (this.expanded.has(orderId)) this.expanded.delete(orderId); else this.expanded.add(orderId); }
  onOrderClick(orderId: string): void { this.selectOrder(orderId); this.toggleExpand(orderId); }

  /**
   * Click on an order lane (bar body or gutter). A double-click also delivers
   * two `click`s before `dblclick`, which would expand the lane and contract it
   * again before the record viewer opened — so the select/expand is held back
   * for `DBLCLICK_MS` and dropped by the second click (`showOrderView` drops it
   * too). Clicking a different lane flushes the queued one immediately, so the
   * delay is never applied to the click that actually mattered.
   */
  onRowClick(orderId: string): void {
    const pending = this.pendingRowClick;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRowClick = null;
      if (pending.orderId === orderId) return;   // second click of a double-click
      this.onOrderClick(pending.orderId);
      this.cdr.detectChanges();
    }
    this.pendingRowClick = {
      orderId,
      timer: setTimeout(() => {
        this.pendingRowClick = null;
        this.onOrderClick(orderId);
        this.cdr.detectChanges();
      }, DBLCLICK_MS),
    };
  }

  /** Drop a queued lane click — the double-click (viewer) supersedes it. */
  private cancelRowClick(): void {
    if (!this.pendingRowClick) return;
    clearTimeout(this.pendingRowClick.timer);
    this.pendingRowClick = null;
  }
  lineStart(li: OrderLine, order: Order): string { return li.startDate ?? order.startDate; }
  lineEnd(li: OrderLine, order: Order): string { return li.endDate ?? order.endDate; }

  /** Units this line takes — never below 1 (a serialized unit / employee is 1). */
  lineQty(li: OrderLine): number { return li.qty || 1; }

  /**
   * ` · ×12` for a multi-unit line, '' when it takes one — appended to a timeline
   * bar's sub-line, which is otherwise the only place a booking's quantity is
   * invisible (the Order Details row is where it is edited).
   */
  private qtySuffix(li: OrderLine): string {
    const q = this.lineQty(li);
    return q > 1 ? ' · ×' + q : '';
  }

  /**
   * The line's item capacity (see `data.capacity`). Drives whether Order Details
   * offers a quantity box at all: a resource that owns more than one unit can take
   * a quantity, a serialized unit or an employee cannot.
   */
  lineCapacity(li: OrderLine): number {
    return this.itemCapacity(this.data.getItem(li.type, li.refId));
  }

  /** Capacity of an item, guarding the "item not in the catalog" case. */
  itemCapacity(item: Item | undefined): number {
    return item ? this.data.capacity(item) : 1;
  }

  /** Type a line's quantity from the Order Details inspector. */
  setLineQty(order: Order, li: OrderLine, qty: number): void {
    this.data.updateOrderLineQty(order.orderId, li.id, qty);
  }

  /**
   * The quantity box fires on `input`, so a conflict clears as you type. Bound with
   * `[value]`/`(input)` rather than `ngModel`: a rejected entry (0, blank, a
   * fraction) has to be echoed straight back into the box — with `ngModel` the model
   * stores the clamped 1 while the DOM keeps showing what was typed, because the
   * bound value never "changed".
   */
  onLineQtyInput(order: Order, li: OrderLine, e: Event): void {
    const el = e.target as HTMLInputElement;
    const qty = Math.max(1, Math.round(Number(el.value)) || 1);
    el.value = String(qty);
    if (qty !== this.lineQty(li)) this.setLineQty(order, li, qty);
  }

  /**
   * Unbook an item — the `×` on its Order Details row, the exact inverse of the
   * drag-to-book gesture (the item simply returns to the Assets pool). Asked, not
   * assumed: the row is a single click target and dropping a line is not undoable,
   * so the app-wide prompt (the same one that guards unsaved edits) names the item
   * and the order instead of a bare "are you sure?".
   */
  async removeBooking(order: Order, li: OrderLine): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Remove this booking?',
      message:
        this.itemName(li.type, li.refId) +
        ' will be unbooked from ' + order.orderId + ' and return to the Assets pool.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    this.data.removeOrderLine(order.orderId, li.id);
    // Order Details, the timeline rows and the conflicts pane all read
    // `order.lineItems` live, so dropping the line re-renders all three.
    this.cdr.detectChanges();
  }

  /**
   * What this booking bills — `data.lineTotal()` (the port of the prototype's
   * `computeLineTotal()`), the same figure `data.orderAmount()` sums for the Gross
   * above it, so a column of bookings adds up to the card's own total.
   */
  lineRevenue(li: OrderLine, order: Order): number {
    return this.data.lineTotal(li, order);
  }

  /**
   * The Order Details line's range in the compact form (`8/20/26 → 8/24/26`) — it
   * sits on its own row under `code · name`, where `data.fmtDate()`'s
   * 08/24/2026 form made the row as wide as the item label above it.
   */
  lineDates(li: OrderLine, order: Order): string {
    return this.fmtDay(this.lineStart(li, order)) + ' → ' + this.fmtDay(this.lineEnd(li, order));
  }

  itemName(type: CatalogType, refId: string): string { return this.data.itemLabel(type, refId); }

  /** Short type label for chips / row gutters (prototype `TYPE_LABEL`). */
  typeLabel(type: string): string { return TYPE_LABEL[type] ?? type; }

  /** Short item label used in a line row's gutter (prototype `shortItemLabel`). */
  shortItemLabel(li: OrderLine): string {
    const it = this.data.getItem(li.type, li.refId);
    return it ? this.data.mkName(it) || it.name : li.refId;
  }

  /* ---------------------------- type grouping ---------------------------- */

  /**
   * Rank of a catalog type in the canonical order (serialized, bulk,
   * consumable, part, labor, kit, attachment) — the sort key that keeps like
   * types together.
   */
  typeRank(type: CatalogType | 'order'): number {
    const i = CATALOG_TYPES.findIndex((c) => c.key === type);
    return i < 0 ? CATALOG_TYPES.length : i;
  }

  /**
   * An order's booked items grouped by catalog type (then by name, then by the
   * day the booking starts). Every list that shows mixed types — the expanded
   * timeline rows, the Order Details booked list and the conflicts pane — runs
   * through this, and all of them re-render from data, so the grouping is
   * re-applied the moment a conflict is resolved (a bar moved/resized, or a
   * booking dropped) and the like types fall back together.
   */
  sortedLines(order: Order): OrderLine[] {
    return [...order.lineItems].sort(
      (a, b) =>
        this.typeRank(a.type) - this.typeRank(b.type) ||
        this.itemName(a.type, a.refId).localeCompare(this.itemName(b.type, b.refId)) ||
        this.lineStart(a, order).localeCompare(this.lineStart(b, order)),
    );
  }

  /* ------------------------------- header ------------------------------- */

  /** Header grid template — all views shrink columns so the view fits the pane. */
  headColumns(): string {
    if (this.view === 'day') return '120px 1fr';
    if (this.view === 'month') return '120px repeat(' + this.colCount() + ',minmax(0,1fr))';
    return '120px repeat(' + this.colCount() + ',minmax(0,1fr))';
  }

  cornerLabel(): string {
    return this.view === 'day' ? 'Day' : this.view === 'month' ? 'Month' : 'Week';
  }

  /** Minimum timeline width — the calendar is fixed-width and never scrolls sideways. */
  minWidth(): number {
    return 120;
  }

  /** Order bar sub-line: gross · items · days (prototype). */
  orderSub(o: Order): string {
    return `${this.data.money(this.data.orderAmount(o))} · ${o.lineItems.length} items · ${this.data.orderDays(o)}d`;
  }

  /** Tooltip for an order bar: code - project, then the order's window. */
  tipOrder(o: Order): Tip {
    return orderTip(this.data, o);
  }

  /** Tooltip for a queue card — a whole record, so it carries more lines. */
  tipOrderRecord(o: Order): Tip {
    return orderRecordTip(this.data, o);
  }

  /** Tooltip for a booked-item bar: item, window, type and order. */
  tipLine(line: BarModel): Tip {
    const order = this.data.getOrder(line.orderId);
    const li = order?.lineItems.find((x) => x.id === line.liId) ?? null;
    const window =
      order && li
        ? stampRange(this.lineStart(li, order), this.lineT0(li, order), this.lineEnd(li, order), this.lineT1(li, order))
        : '';
    return tip(line.label, [
      window,
      line.sub,
      { label: 'Order', value: line.orderId },
      { label: 'Type', value: this.typeLabel(line.type) },
    ]);
  }

  /** Tooltip for an asset pool card: the asset, plus its standing in the range. */
  tipPool(item: Item, av: Availability): Tip {
    const extra: (TipLine | null)[] = [
      { label: 'Availability', value: av.badge },
      av.line ? { label: 'Booking', value: av.line } : null,
      av.dates ? { label: 'Window', value: av.dates } : null,
    ];
    return assetTip(this.data, item, extra);
  }

  /* ---------------------------- pool cards ------------------------------ */

  /**
   * The visible period as inclusive local-midnight millisecond bounds.
   * Day view = the anchor day; Week/Month = the first..last column.
   */
  private rangeBounds(): { start: number; end: number } {
    const cols = this.columns();
    const start = this.view === 'day' ? this.anchor : cols[0].start;
    const last = this.view === 'day' ? this.anchor : cols[cols.length - 1].start;
    return { start, end: this.dayAt(last, 1) - 1 };
  }

  /**
   * Active-order bookings of a pool item that **overlap the visible period**
   * (prototype's `capAvailUI` recomputed per render instead of a fixed state).
   * This is what makes the pool reflect the range selected in the calendar.
   */
  bookingsInRange(item: Item): BookingRef[] {
    const r = this.rangeBounds();
    const out: BookingRef[] = [];
    for (const o of this.orders()) {
      for (const li of o.lineItems) {
        if (li.type !== item.type || li.refId !== item.id) continue;
        const start = this.lineStart(li, o);
        const end = this.lineEnd(li, o);
        const s = new Date(start + 'T00:00:00').getTime();
        const e = new Date(end + 'T00:00:00').getTime() + DAY_MS - 1;
        if (s <= r.end && r.start <= e) out.push({ orderId: o.orderId, start, end });
      }
    }
    return out;
  }

  /**
   * Peak units committed at once across a set of windows. Each span is day-
   * inclusive; its end event lands on the day *after* the window, so a booking
   * that finishes the day another begins still counts as overlapping that day.
   */
  private peakUnits(spans: { start: number; end: number; qty: number }[]): number {
    const events: { at: number; delta: number }[] = [];
    for (const s of spans) {
      events.push({ at: s.start, delta: s.qty });
      events.push({ at: s.end + DAY_MS, delta: -s.qty });
    }
    // Ties end before they start, so a window closing as an identical one opens
    // doesn't read as a momentary clash it never had.
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
   * How many units of `item` are committed at once between two day bounds — every
   * booking of that resource, clipped to the window (so a booking that started
   * earlier still counts for the days inside it). This is the number the capacity
   * check measures: 24 jugs of hydraulic fluid on two orders is fine, until the two
   * windows overlap and together ask for more than the item owns.
   */
  private committedUnits(item: Item, from: number, to: number): number {
    const spans: { start: number; end: number; qty: number }[] = [];
    for (const o of this.orders()) {
      for (const li of o.lineItems) {
        if (li.type !== item.type || li.refId !== item.id) continue;
        const s = Date.parse(this.lineStart(li, o) + 'T00:00:00');
        const e = Date.parse(this.lineEnd(li, o) + 'T00:00:00');
        if (s > to || e < from) continue;
        spans.push({ start: Math.max(s, from), end: Math.min(e, to), qty: li.qty || 1 });
      }
    }
    return this.peakUnits(spans);
  }

  /**
   * M/D/YY — the compact date for the narrow panel rows: the pool cards' booking
   * row and the Order Details line items (via `lineDates()`). `data.fmtDate()`
   * prints leading zeros and a 4-digit year (08/24/2026), which is right for the
   * order headers but pushed those rows onto a second line.
   */
  private fmtDay(iso: string): string {
    const d = this.data.parseDT(iso);
    return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  }

  /**
   * Availability of a pool resource **for the visible period** — the badge/colour
   * update as the Day/Week/Month view, the period pager or the bookings change.
   * A booked item stays schedulable (overbooking is allowed and flagged in the
   * conflicts pane); only a retired unit is refused.
   */
  availability(item: Item): Availability {
    if (item.active === false) {
      return {
        key: 'inactive',
        blocked: true,
        badge: 'Inactive',
        line: 'Retired',
        dates: '',
        note: 'Retired — activate it to schedule.',
      };
    }
    const booked = this.bookingsInRange(item);
    if (booked.length) {
      const orders = [...new Set(booked.map((b) => b.orderId))];
      // Span every booking in range (ISO dates sort as strings), so a card with
      // two of them still gets one honest "first out → last back" range.
      const from = booked.reduce((a, b) => (b.start < a ? b.start : a), booked[0].start);
      const to = booked.reduce((a, b) => (b.end > a ? b.end : a), booked[0].end);
      // Compact form for the card row; the hover title keeps the full dates.
      const span = this.fmtDay(from) + ' → ' + this.fmtDay(to);
      const full = this.data.fmtDate(from) + ' → ' + this.data.fmtDate(to);
      // Multi-unit resources (consumables, bulk, stock, kits, attachments) can be
      // *partly* booked: only a period that commits more than the item owns is red.
      // A single-unit item peaks at 1 every time, so it keeps the old behaviour.
      const cap = this.data.capacity(item);
      const r = this.rangeBounds();
      const peak = this.committedUnits(item, r.start, r.end);
      if (cap > 1 && peak < cap) {
        return {
          key: 'partial',
          blocked: false,
          badge: peak + ' of ' + cap + ' out',
          line: 'Booked on ' + orders.join(', '),
          dates: span,
          note:
            'Booked on ' + orders.join(', ') + ' (' + full + ') — ' +
            peak + ' of ' + cap + ' out, ' + (cap - peak) + ' free; drop to book more.',
        };
      }
      return {
        key: 'busy',
        blocked: false,
        badge: booked.length + ' booked',
        line: 'Booked on ' + orders.join(', '),
        dates: span,
        note: 'Booked on ' + orders.join(', ') + ' (' + full + ') — drop to overbook.',
      };
    }
    const out = this.data.outInfo(item.id);
    if (out) {
      const where = out.orderId ?? out.party;
      return {
        key: 'partial',
        blocked: false,
        badge: ('On site · ' + (out.orderId ?? '')).trim(),
        line: 'Out now on ' + where,
        dates: '',
        note: 'Out now on ' + where + ' — free for ' + this.rangePhrase() + '.',
      };
    }
    if (item.status === 'In Shop') {
      return {
        key: 'partial',
        blocked: false,
        badge: 'In Shop',
        line: 'In the shop',
        dates: '',
        note: 'In the shop — free to schedule later.',
      };
    }
    return { key: 'free', blocked: false, badge: '', line: '', dates: '', note: '' };
  }

  /** Jump the calendar to an order's start period and expand it (prototype `focusOrder`). */
  focusOrder(id: string): void {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.selectedOrderId = id;
    const stDate = new Date(o.startDate + 'T00:00:00');
    const st = this.startOfDay(stDate);
    if (this.view === 'month') {
      this.anchor = this.startOfDay(new Date(stDate.getFullYear(), stDate.getMonth(), 1));
    } else if (this.view === 'week') {
      this.anchor = this.mondayOf(st);
    } else {
      this.anchor = st;
    }
    this.expanded.add(id);
  }

  /* ---------------------------- record viewer ---------------------------- */

  /** Double-click a pool card → read-only view of that inventory asset. */
  showAssetView(item: Item): void {
    this.viewer = this.assetModel(item);
  }

  /** Double-click a resource bar → the asset plus the order it is booked on. */
  showLineView(bar: BarModel): void {
    this.cancelRowClick();
    const order = this.data.getOrder(bar.orderId);
    const li = bar.liId ? order?.lineItems.find((l) => l.id === bar.liId) : undefined;
    const item = li ? this.data.getItem(li.type, li.refId) : undefined;
    if (!order || !li || !item) return;
    this.viewer = this.assetModel(item, order, li);
  }

  /** Open the asset viewer for a booking straight from a list row. */
  showBookingView(li: OrderLine, order: Order): void {
    const item = this.data.getItem(li.type, li.refId);
    if (item) this.viewer = this.assetModel(item, order, li);
  }

  /** Open the asset viewer for a row in the Scheduling Conflicts pane. */
  showConflictView(c: { type: CatalogType; refId: string; orderId: string }): void {
    const order = this.data.getOrder(c.orderId);
    const li = order?.lineItems.find((l) => l.type === c.type && l.refId === c.refId);
    const item = this.data.getItem(c.type, c.refId);
    if (item) this.viewer = this.assetModel(item, order, li);
  }

  /** Double-click an order bar / queue card → read-only order (contract) view. */
  showOrderView(order: Order): void {
    // The double-click also delivered two lane clicks; drop the queued one so
    // the lane does not expand and contract first.
    this.cancelRowClick();
    // Set the state explicitly rather than relying on those clicks.
    this.selectedOrderId = order.orderId;
    this.expanded.add(order.orderId);
    const booked = this.sortedLines(order);
    this.viewer = {
      title: order.orderId,
      subtitle: order.projectName,
      icon: 'bi-briefcase',
      badge: ORDER_STATUS_LABEL[order.status],
      badgeClass: order.status === 'active' ? 'st-active' : 'st-closed',
      sections: [
        {
          title: 'Customer & Job',
          fields: [
            { label: 'Customer', value: this.data.partyName(order.partyId) || order.party },
            { label: 'Project', value: order.projectName },
            { label: 'Job Site', value: order.jobSite || '—' },
            { label: 'Geofence', value: (order.geofenceRadius ?? 300) + ' m' },
            {
              label: 'Site Latitude',
              value: String(order.siteLat ?? this.data.yard.lat),
              mono: true,
            },
            {
              label: 'Site Longitude',
              value: String(order.siteLng ?? this.data.yard.lng),
              mono: true,
            },
          ],
        },
        {
          title: 'Rental Window',
          fields: [
            { label: 'Start', value: this.data.fmtDate(order.startDate) + ' ' + this.fmtMin(this.orderT0(order)), mono: true },
            { label: 'Expected Return', value: this.data.fmtDate(order.endDate) + ' ' + this.fmtMin(this.orderT1(order)), mono: true },
            { label: 'Days', value: String(this.data.orderDays(order)), mono: true },
          ],
        },
        {
          title: 'Commercials',
          fields: [
            { label: 'Gross', value: this.data.money(this.data.orderAmount(order)), mono: true },
            { label: 'Items booked', value: String(order.lineItems.length) },
          ],
        },
        {
          title: 'Booked Inventory',
          fields: booked.length
            ? booked.map((li) => ({
                label: this.typeLabel(li.type) + ' · ' + this.itemName(li.type, li.refId),
                value:
                  (this.lineQty(li) > 1 ? '×' + this.lineQty(li) + ' · ' : '') +
                  this.data.fmtDate(this.lineStart(li, order)) + ' → ' + this.data.fmtDate(this.lineEnd(li, order)) +
                  ' · ' + this.data.money(this.lineRevenue(li, order)),
                mono: true,
              }))
            : [{ label: 'Bookings', value: 'None — drag a pool item onto this order.' }],
        },
      ],
    };
  }

  closeViewer(): void {
    this.viewer = null;
  }

  /** Read-only model for one inventory asset (optionally the booking it sits on). */
  private assetModel(item: Item, order?: Order, li?: OrderLine): ViewModel {
    const avail = this.availability(item);
    const sections: ViewSection[] = [];

    if (order && li) {
      sections.push({
        title: 'Booked On',
        fields: [
          { label: 'Order', value: order.orderId, mono: true },
          { label: 'Project', value: order.projectName },
          { label: 'Customer', value: this.data.partyName(order.partyId) || order.party },
          {
            label: 'Window',
            value: this.data.fmtDate(this.lineStart(li, order)) + ' → ' + this.data.fmtDate(this.lineEnd(li, order)),
            mono: true,
          },
          { label: 'Billable days', value: String(this.data.billableDays(order, li)), mono: true },
        ],
      });
    }

    sections.push({
      title: 'Availability · ' + this.rangeLabel(),
      fields: [
        { label: 'State', value: avail.badge || 'Free' },
        { label: 'Note', value: avail.note || 'Free for this period.' },
        ...this.bookingsInRange(item).map((b) => ({
          label: b.orderId,
          value: this.data.fmtDate(b.start) + ' → ' + this.data.fmtDate(b.end),
          mono: true,
        })),
      ],
    });

    const record: ViewField[] = [
      { label: 'Item ID', value: item.id, mono: true },
      { label: 'Type', value: this.typeLabel(item.type) },
      { label: 'Name', value: item.name },
      { label: 'Category', value: item.category || '—' },
      { label: 'Status', value: item.status },
      { label: 'Quantity', value: this.data.int(item.qty), mono: true },
      { label: 'Daily rate', value: this.data.money(item.rateDaily), mono: true },
    ];
    // [value, label, mono] — only the fields this type actually carries.
    const optional: [unknown, string, boolean?][] = [
      [item.serial, 'Serial / VIN', true],
      [[item.make, item.model].filter(Boolean).join(' '), 'Make / Model'],
      [item.meterHours, 'Meter hours', true],
      [item.fuelType, 'Fuel'],
      [item.purchaseValue, 'Purchase value', true],
      [item.baseMonthly, 'Monthly rate', true],
      [item.totalOwned, 'Total owned', true],
      [item.qtyAvailable, 'Available', true],
      [item.qtyOut, 'Out', true],
      [item.qtyOnHand, 'On hand', true],
      [item.reorderPoint, 'Reorder point', true],
      [item.costPrice, 'Cost price', true],
      [item.retailPrice, 'Retail price', true],
      [item.bin, 'Bin', true],
      [item.role, 'Role'],
      [item.hourlyCost, 'Cost / hr', true],
      [item.hourlyBillable, 'Billable / hr', true],
    ];
    for (const [value, label, mono] of optional) {
      if (value === undefined || value === null || value === '' || value === 0) continue;
      record.push({ label, value: String(value), mono });
    }
    if (item.lat != null && item.lng != null) {
      record.push({ label: 'Coordinates', value: item.lat + ', ' + item.lng, mono: true });
    }
    sections.push({ title: 'Record', fields: record });

    return {
      title: item.name,
      subtitle: item.id + ' · ' + (item.category || this.typeLabel(item.type)),
      icon: POOL_ICON[item.type] ?? 'bi-box-seam',
      badge: item.status,
      badgeClass: 'st-' + statusClass(item.status),
      sections,
    };
  }

  /* ------------------------------- create ------------------------------- */

  /** Pool add-button copy, switching with the tab (prototype `poolAddLabel`). */
  poolAddLabel(): string {
    return POOL_ADD_LABEL[this.poolType] ?? 'New Resource';
  }

  /** First day of the visible period (ISO) — the new-order window default. */
  private periodStartISO(): string {
    return this.view === 'day' ? this.dateAt(this.anchor) : this.dateAt(this.viewStart());
  }

  private addDaysISO(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return this.dateAt(d.getTime());
  }

  /** Open the New Order editor (prototype `orderModal`). */
  openOrder(): void {
    const start = this.periodStartISO();
    const party = this.data.listParties()[0];
    this.orderForm = {
      active: true,
      partyId: party?.id ?? '',
      projectName: '',
      jobSite: party?.billingAddress ?? '',
      geofenceRadius: 300,
      siteLat: this.data.yard.lat,
      siteLng: this.data.yard.lng,
      startDate: start,
      startTime: '07:00',
      endDate: this.addDaysISO(start, 14),
      endTime: '17:00',
    };
    this.orderSnap = snapshotForm(this.orderForm);
    this.orderOpen = true;
  }

  /** Create the order and focus it on the timeline (prototype `c-save`). */
  saveOrder(): void {
    const f = this.orderForm;
    const party = this.data.getParty(f.partyId);
    if (!party || !f.projectName.trim()) return;
    const created = this.data.createOrder({
      partyId: party.id,
      party: party.name,
      projectName: f.projectName.trim(),
      jobSite: f.jobSite.trim() || party.billingAddress || '—',
      startDate: f.startDate,
      endDate: f.endDate,
      geofenceRadius: Number(f.geofenceRadius) || 300,
      siteLat: Number(f.siteLat) || this.data.yard.lat,
      siteLng: Number(f.siteLng) || this.data.yard.lng,
      t0: hmMin(f.startTime),
      t1: hmMin(f.endTime),
    });
    if (!f.active) this.data.updateOrderStatus(created.orderId, 'closed');
    this.closeOrder();
    this.focusOrder(created.orderId);
  }

  /** True when the New Order editor holds edits that Save has not written yet. */
  orderDirty(): boolean {
    return formChanged(this.orderForm, this.orderSnap);
  }

  closeOrder(): void {
    this.orderOpen = false;
    this.orderSnap = '';
  }

  /** Open the New <resource> editor for the active pool tab (prototype `addPoolResource`). */
  openRes(): void {
    this.resForm = {
      ...this.emptyRes(),
      category: this.data.categoriesFor(this.poolType)[0] ?? '',
      status: ITEM_STATUSES[this.poolType][0],
      lat: this.data.yard.lat,
      lng: this.data.yard.lng,
    };
    this.resSnap = snapshotForm(this.resForm);
    this.resOpen = true;
  }

  /** Create the resource so it lands in the pool immediately (prototype `itemWrite`). */
  saveRes(): void {
    const f = this.resForm;
    if (!f.name.trim()) return;
    const patch: Record<string, unknown> = {
      name: f.name.trim(),
      category: f.category,
      status: f.status,
      qty: Number(f.qty) || 0,
      rateDaily: Number(f.rateDaily) || 0,
    };
    if (this.poolType === 'serialized') {
      Object.assign(patch, {
        make: f.make,
        model: f.model,
        serial: f.serial,
        meterHours: Number(f.meterHours) || 0,
        fuelType: f.fuelType,
        purchaseValue: Number(f.purchaseValue) || 0,
        lat: Number(f.lat) || this.data.yard.lat,
        lng: Number(f.lng) || this.data.yard.lng,
      });
    }
    if (this.poolType === 'consumable' || this.poolType === 'part') {
      Object.assign(patch, {
        qtyOnHand: Number(f.qtyOnHand) || 0,
        reorderPoint: Number(f.reorderPoint) || 0,
        costPrice: Number(f.costPrice) || 0,
        retailPrice: Number(f.retailPrice) || 0,
        bin: f.bin,
      });
    }
    if (this.poolType === 'labor') {
      Object.assign(patch, {
        role: f.role,
        hourlyCost: Number(f.hourlyCost) || 0,
        hourlyBillable: Number(f.hourlyBillable) || 0,
      });
    }
    this.data.createItem(this.poolType, patch as unknown as Omit<Item, 'type' | 'id'>);
    this.closeRes();
  }

  /** True when the New Resource editor holds edits Save has not written yet. */
  resDirty(): boolean {
    return formChanged(this.resForm, this.resSnap);
  }

  closeRes(): void {
    this.resOpen = false;
    this.resSnap = '';
  }
  dateAt(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** Local midnight `i` days after the local midnight at `base` (DST-safe). */
  dayAt(base: number, i: number): number {
    const d = new Date(base);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime();
  }

  private pad2(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }
  orderT0(o: Order): number { return this.data.orderT0(o); }
  orderT1(o: Order): number { return this.data.orderT1(o); }
  lineT0(li: OrderLine, o: Order): number { return li.t0 ?? this.orderT0(o); }
  lineT1(li: OrderLine, o: Order): number { return li.t1 ?? this.orderT1(o); }

  /** Does this order's date window include the Day-view anchor? */
  private dateIncludes(o: Order): boolean {
    const day = new Date(this.anchor);
    day.setHours(0, 0, 0, 0);
    const d = day.getTime();
    const s = new Date(o.startDate + 'T00:00:00').getTime();
    const e = new Date(o.endDate + 'T00:00:00').getTime() + DAY_MS - 1;
    return d >= s && d <= e;
  }

  /** Percentage geometry across the 24-hour day (0..1440 minutes). */
  private geomMin(t0: number, t1: number): BarGeom | null {
    const l = Math.max(0, Math.min(1440, t0));
    const r = Math.max(0, Math.min(1440, t1));
    if (r <= l) return null;
    return { left: (l / 1440) * 100, width: ((r - l) / 1440) * 100 };
  }

  fmtMin(t: number): string {
    return this.pad2(Math.floor(t / 60)) + ':' + this.pad2(Math.round(t % 60));
  }

  geom(startISO: string, endISO: string): BarGeom | null {
    const N = this.colCount();
    const view = this.viewStart();
    // Day index from LOCAL midnights (never floor raw epoch — that is UTC and
    // would make indices fractional in non-UTC timezones, mis-sizing the bars).
    const dayIndex = (iso: string): number =>
      Math.round((new Date(iso + 'T00:00:00').getTime() - view) / DAY_MS);
    const sIdx = dayIndex(startISO);
    const eIdx = dayIndex(endISO);
    if (eIdx < 0 || sIdx >= N) return null;
    const cs = Math.max(0, sIdx);
    const ce = Math.min(N - 1, eIdx);
    return { left: (cs / N) * 100, width: ((ce - cs + 1) / N) * 100 };
  }

  lineDays(li: OrderLine, order: Order): number {
    const s = new Date(this.lineStart(li, order) + 'T00:00:00').getTime();
    const e = new Date(this.lineEnd(li, order) + 'T00:00:00').getTime();
    return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
  }

  /**
   * Capacity-aware conflict: a booking clashes only when the overlapping bookings
   * for the same resource need **more units than the item owns**. A serialized unit
   * (capacity 1) behaves exactly as before — any overlap is a clash — while 24 jugs
   * of hydraulic fluid can go out on two orders as long as their windows don't
   * overlap and together over-ask. `committedUnits()` walks every order, so the line
   * under test is counted in its own peak.
   */
  private isConflicted(li: OrderLine, order: Order): boolean {
    const item = this.data.getItem(li.type, li.refId);
    if (!item) return false;
    const s = Date.parse(this.lineStart(li, order) + 'T00:00:00');
    const e = Date.parse(this.lineEnd(li, order) + 'T00:00:00');
    return this.committedUnits(item, s, e) > this.data.capacity(item);
  }

  /** "30 needed · 24 owned" — why the conflicts pane flagged the row. */
  private conflictDetail(li: OrderLine, order: Order): string {
    const item = this.data.getItem(li.type, li.refId);
    if (!item) return '';
    const s = Date.parse(this.lineStart(li, order) + 'T00:00:00');
    const e = Date.parse(this.lineEnd(li, order) + 'T00:00:00');
    return this.committedUnits(item, s, e) + ' needed · ' + this.data.capacity(item) + ' owned';
  }

  models(): OrderModel[] {
    const isDay = this.view === 'day';
    return this.orders().map((o) => {
      let og: BarGeom | null = null;
      let oSub = o.lineItems.length + ' items';
      if (isDay) {
        if (this.dateIncludes(o)) {
          og = this.geomMin(this.orderT0(o), this.orderT1(o));
          oSub = this.fmtMin(this.orderT0(o)) + '–' + this.fmtMin(this.orderT1(o));
        }
      } else {
        og = this.geom(o.startDate, o.endDate);
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
      for (const li of this.sortedLines(o)) {
        let lg: BarGeom | null = null;
        let sub = '';
        if (isDay) {
          if (this.dateIncludes(o)) {
            const t0 = Math.max(this.orderT0(o), Math.min(this.orderT1(o), this.lineT0(li, o)));
            const t1 = Math.max(t0, Math.min(this.orderT1(o), this.lineT1(li, o)));
            lg = this.geomMin(t0, t1);
            sub = this.fmtMin(t0) + '–' + this.fmtMin(t1) + this.qtySuffix(li);
          }
        } else {
          lg = this.geom(this.lineStart(li, o), this.lineEnd(li, o));
          sub = this.lineDays(li, o) + 'd' + this.qtySuffix(li);
        }
        if (!lg) continue;
        const conflict = !isDay && this.isConflicted(li, o);
        lines.push({
          orderId: o.orderId,
          liId: li.id,
          type: li.type,
          label: this.itemName(li.type, li.refId),
          short: this.shortItemLabel(li),
          sub: sub + (conflict ? ' - CONFLICT' : ''),
          conflict,
          geom: lg,
        });
      }
      return { order: o, isExpanded: this.expanded.has(o.orderId), orderBar, lines };
    });
  }

  conflictCount(): number {
    let n = 0;
    for (const m of this.models()) for (const l of m.lines) if (l.conflict) n++;
    return n;
  }

  /** Flat conflict list for the inspector pane (prototype `renderInspector`).
   *  Re-sorted by catalog type so like types stay together, and recomputed on
   *  every render so resolving a conflict immediately re-groups the list. */
  conflicts(): { type: CatalogType; refId: string; orderId: string; label: string; detail: string }[] {
    const out: { type: CatalogType; refId: string; orderId: string; label: string; detail: string }[] = [];
    for (const m of this.models()) {
      for (const line of m.lines) {
        if (!line.conflict) continue;
        const li = m.order.lineItems.find((l) => l.id === line.liId);
        if (!li) continue;
        out.push({
          type: li.type,
          refId: li.refId,
          orderId: m.order.orderId,
          label: line.label,
          detail: this.conflictDetail(li, m.order),
        });
      }
    }
    return out.sort(
      (a, b) =>
        this.typeRank(a.type) - this.typeRank(b.type) ||
        a.label.localeCompare(b.label) ||
        a.orderId.localeCompare(b.orderId),
    );
  }

  onPoolStart(e: Event, item: Item): void {
    (e as DragEvent).dataTransfer?.setData('text/plain', item.type + '|' + item.id);
    this.dragging = { type: item.type, refId: item.id };
  }
  onDragEnd(): void { this.dragging = null; }
  allowDrop(e: Event): void { e.preventDefault(); }

  onDropOrder(e: Event, orderId: string): void {
    e.preventDefault();
    const raw = (e as DragEvent).dataTransfer?.getData('text/plain');
    this.dragging = null;
    if (!raw) return;
    const [type, refId] = raw.split('|');
    const t = type as CatalogType;
    const order = this.data.getOrder(orderId);
    if (!order) return;
    // Only a retired item is refused — an item that is already booked (or out on
    // custody) can still be scheduled; the conflicts pane flags the overbook.
    const item = this.data.getItem(t, refId);
    if (item && this.availability(item).blocked) return;
    this.selectedOrderId = order.orderId;
    this.expanded.add(order.orderId);
    // A resource we own more than one of is booked by quantity (prototype
    // `bookQtyModal`): 24 jugs of hydraulic fluid is not a booking of one, and the
    // count is what decides a conflict. Everything else books a single unit here.
    if (this.itemCapacity(item) > 1) {
      this.bookPrompt = { type: t, refId, orderId: order.orderId, qty: 1 };
      return;
    }
    this.data.addOrderLine(order.orderId, { type: t, refId, qty: 1 });
  }

  /**
   * Figures for the quantity prompt: what the resource owns, how many units are
   * already committed across the target order's window (peak, so staggered bookings
   * on other orders don't add up), and what is therefore free.
   */
  bookPromptInfo(): { label: string; orderId: string; owned: number; committed: number; free: number } | null {
    const p = this.bookPrompt;
    if (!p) return null;
    const item = this.data.getItem(p.type, p.refId);
    const order = this.data.getOrder(p.orderId);
    if (!item || !order) return null;
    const owned = this.data.capacity(item);
    const committed = this.committedUnits(
      item,
      Date.parse(order.startDate + 'T00:00:00'),
      Date.parse(order.endDate + 'T00:00:00'),
    );
    return {
      label: this.itemName(item.type, item.id),
      orderId: order.orderId,
      owned,
      committed,
      free: Math.max(0, owned - committed),
    };
  }

  /** Book the prompted quantity (prototype `doAllocate`). */
  commitBook(): void {
    const p = this.bookPrompt;
    if (!p) return;
    this.data.addOrderLine(p.orderId, {
      type: p.type,
      refId: p.refId,
      qty: Math.max(1, Math.round(p.qty) || 1),
    });
    this.bookPrompt = null;
  }

  closeBookPrompt(): void {
    this.bookPrompt = null;
  }

  startResize(e: PointerEvent, bar: BarModel, edge: 'l' | 'r'): void {
    e.preventDefault();
    e.stopPropagation();
    // The track carries the geometry for both the order bar and the line bars.
    const track = (e.target as Element).closest('.tl-row-track') as HTMLElement | null;
    if (!track) return;
    this.resizing = { orderId: bar.orderId, liId: bar.liId, edge, track };
    const move = (ev: PointerEvent) => this.onResizeMove(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.resizing = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private onResizeMove(ev: PointerEvent): void {
    const r = this.resizing;
    if (!r) return;
    const rect = r.track.getBoundingClientRect();
    const order = this.data.getOrder(r.orderId);
    if (!order) return;

    // Day view: 15-minute snapping across the 24-hour day.
    if (this.view === 'day') {
      const mins = Math.round((((ev.clientX - rect.left) / rect.width) * 1440) / 15) * 15;
      if (r.liId == null) {
        let a = this.data.orderT0(order);
        let b = this.data.orderT1(order);
        if (r.edge === 'l') { a = mins; if (b < a) b = a; }
        else { b = mins; if (a > b) a = b; }
        this.data.updateOrderTimes(order.orderId, a, b);
      } else {
        const li = order.lineItems.find((l) => l.id === r.liId);
        if (!li) return;
        const lo = this.data.orderT0(order);
        const hi = this.data.orderT1(order);
        const m = Math.max(lo, Math.min(hi, mins));
        let a = this.lineT0(li, order);
        let b = this.lineT1(li, order);
        if (r.edge === 'l') { a = m; if (b < a) b = a; }
        else { b = m; if (a > b) a = b; }
        this.data.updateOrderLineTimes(order.orderId, li.id, a, b);
      }
      this.cdr.detectChanges();
      return;
    }

    // Week / Month: day-granular date snapping.
    const idx = Math.min(this.colCount() - 1, Math.max(0, Math.floor(((ev.clientX - rect.left) / rect.width) * this.colCount())));
    const day = this.dateAt(this.dayAt(this.viewStart(), idx));
    if (r.liId == null) {
      let ns = order.startDate;
      let ne = order.endDate;
      if (r.edge === 'l') { ns = day; if (Date.parse(ns + 'T00:00:00') > Date.parse(ne + 'T00:00:00')) ne = ns; }
      else { ne = day; if (Date.parse(ne + 'T00:00:00') < Date.parse(ns + 'T00:00:00')) ns = ne; }
      this.data.updateOrderDates(order.orderId, ns, ne);
    } else {
      const li = order.lineItems.find((l) => l.id === r.liId);
      if (!li) return;
      let ns = this.lineStart(li, order);
      let ne = this.lineEnd(li, order);
      if (r.edge === 'l') { ns = day; if (Date.parse(ns + 'T00:00:00') > Date.parse(ne + 'T00:00:00')) ne = ns; }
      else { ne = day; if (Date.parse(ne + 'T00:00:00') < Date.parse(ns + 'T00:00:00')) ns = ne; }
      this.data.updateOrderLineDates(r.orderId, r.liId, ns, ne);
    }
    this.cdr.detectChanges();
  }

  detachResize(): void { this.resizing = null; }

  /* ------------------------- move a whole block -------------------------- */

  /** True while this exact bar is being dragged, so the block can show it. */
  isMoving(orderId: string, liId: string | null): boolean {
    const m = this.moving;
    return !!m && m.orderId === orderId && m.liId === liId;
  }

  /**
   * Drag the body of a block to another day (Week/Month) or another time
   * (Day view) — the window length is preserved, unlike the edge handles that
   * only move one end. Works on order bars and on expanded resource bars;
   * starting on a resize handle or the expand chevron is ignored so those keep
   * their own behaviour.
   */
  startMove(e: PointerEvent, bar: BarModel): void {
    if ((e.target as Element)?.closest('.tl-h, .tl-block-chev')) return;
    const track = (e.target as Element).closest('.tl-row-track') as HTMLElement | null;
    const order = this.data.getOrder(bar.orderId);
    if (!track || !order) return;
    const li = bar.liId ? order.lineItems.find((l) => l.id === bar.liId) ?? null : null;
    if (bar.liId && !li) return;
    const loMin = li ? this.orderT0(order) : 0;
    const hiMin = li ? this.orderT1(order) : 1440;
    this.moving = {
      orderId: bar.orderId,
      liId: bar.liId,
      track,
      x0: e.clientX,
      t0: li ? this.lineT0(li, order) : this.orderT0(order),
      t1: li ? this.lineT1(li, order) : this.orderT1(order),
      sISO: li ? this.lineStart(li, order) : order.startDate,
      eISO: li ? this.lineEnd(li, order) : order.endDate,
      loMin,
      hiMin,
      loISO: li ? order.startDate : '',
      hiISO: li ? order.endDate : '',
      moved: false,
    };
    window.addEventListener('pointermove', this.onMovePointer);
    window.addEventListener('pointerup', this.endMovePointer);
    window.addEventListener('pointercancel', this.endMovePointer);
  }

  private onMoveMove(ev: PointerEvent): void {
    const m = this.moving;
    if (!m) return;
    // Ignore the first few pixels so a plain click still selects the row.
    if (!m.moved) {
      if (Math.abs(ev.clientX - m.x0) <= 3) return;
      m.moved = true;
    }
    ev.preventDefault();
    const rect = m.track.getBoundingClientRect();
    if (!rect.width) return;

    // Day view: shift the time window in 15-minute steps.
    if (this.view === 'day') {
      const dur = m.t1 - m.t0;
      let delta = (Math.round((((ev.clientX - m.x0) / rect.width) * 1440) / 15) * 15);
      delta = Math.max(m.loMin - m.t0, Math.min(m.hiMin - dur - m.t0, delta));
      const a = m.t0 + delta;
      const b = m.t1 + delta;
      if (m.liId) this.data.updateOrderLineTimes(m.orderId, m.liId, a, b);
      else this.data.updateOrderTimes(m.orderId, a, b);
      this.cdr.detectChanges();
      return;
    }

    // Week / Month: shift whole days.
    const delta = Math.round(((ev.clientX - m.x0) / rect.width) * this.colCount());
    let ns = this.addDaysISO(m.sISO, delta);
    let ne = this.addDaysISO(m.eISO, delta);

    if (m.liId) {
      // A booking stays inside its order window: slide it back when either end
      // would cross, rather than collapsing it to the edge.
      const lo = Date.parse(m.loISO + 'T00:00:00');
      const hi = Date.parse(m.hiISO + 'T00:00:00');
      let s = Date.parse(ns + 'T00:00:00');
      let e = Date.parse(ne + 'T00:00:00');
      if (s < lo) { const d = lo - s; s += d; e += d; }
      if (e > hi) { const d = e - hi; e -= d; s -= d; }
      if (s < lo) s = lo;
      if (e < s) e = s;
      ns = this.dateAt(s);
      ne = this.dateAt(e);
      this.data.updateOrderLineDates(m.orderId, m.liId, ns, ne);
    } else {
      // Moving an order carries its bookings along (snapshot them first: the
      // service clamps lines to the new order window).
      const order = this.data.getOrder(m.orderId);
      if (!order) return;
      const carried = order.lineItems.map((l) => ({
        id: l.id,
        s: this.addDaysISO(this.lineStart(l, order), delta),
        e: this.addDaysISO(this.lineEnd(l, order), delta),
      }));
      this.data.updateOrderDates(m.orderId, ns, ne);
      for (const l of carried) this.data.updateOrderLineDates(m.orderId, l.id, l.s, l.e);
    }
    this.cdr.detectChanges();
  }

  private onMoveUp(): void {
    const m = this.moving;
    this.detachMove();
    // A real drag must not also fire the row's select/expand click.
    if (m?.moved) {
      const kill = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', kill, true);
      };
      window.addEventListener('click', kill, true);
      window.setTimeout(() => window.removeEventListener('click', kill, true), 400);
    }
    this.cdr.detectChanges();
  }

  private detachMove(): void {
    window.removeEventListener('pointermove', this.onMovePointer);
    window.removeEventListener('pointerup', this.endMovePointer);
    window.removeEventListener('pointercancel', this.endMovePointer);
    this.moving = null;
  }

  /** Blank New Order form (no service access — safe as a field initializer). */
  private emptyOrder() {
    return {
      active: true,
      partyId: '',
      projectName: '',
      jobSite: '',
      geofenceRadius: 300,
      siteLat: 33.749,
      siteLng: -84.388,
      startDate: '',
      startTime: '07:00',
      endDate: '',
      endTime: '17:00',
    };
  }

  /** Blank New Resource form (no service access — safe as a field initializer). */
  private emptyRes() {
    return {
      name: '',
      category: '',
      status: 'Available' as Item['status'],
      qty: 1,
      rateDaily: 0,
      make: '',
      model: '',
      serial: '',
      meterHours: 0,
      fuelType: 'Diesel',
      purchaseValue: 0,
      qtyOnHand: 0,
      reorderPoint: 0,
      costPrice: 0,
      retailPrice: 0,
      bin: '',
      role: '',
      hourlyCost: 0,
      hourlyBillable: 0,
      lat: 33.749,
      lng: -84.388,
    };
  }
  private startOfDay(d: Date): number {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }
  private mondayOf(ms: number): number {
    const x = new Date(ms);
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return this.startOfDay(x);
  }
}
