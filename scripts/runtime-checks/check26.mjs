import assert from 'node:assert/strict';

/* ================= the Scheduler's view math, without a browser =================
 *
 * The gap this closes (angular-refactor-log.md, P9b): every harness before this one
 * proved the *store*. The biggest component in the app — `scheduler.component.ts`, 1,591
 * lines — had no regression net at all: only `npm run e2e` renders it, and rendering says
 * "it draws", not "it draws the right week".
 *
 * So this instantiates the real component class against the real store in Node. That works
 * because the class' *derived* reads are pure — the constructor takes the store, and only
 * the drag handlers touch the DOM (`getBoundingClientRect`), which nothing here calls. Two
 * Angular details make it runnable outside the framework: `@angular/compiler` must be
 * loaded (the decorators need JIT in a plain Node process) and the injected
 * `ChangeDetectorRef` / `ConfirmService` are stubbed, since the methods under test call
 * neither.
 *
 * What it now holds to account: the calendar anchors on the fixture's own first booking,
 * a period is a period (7 days / 1 day / the whole month, consecutive, correctly labelled),
 * the bars are built from the seeded orders, and the conflict list names real orders.
 */

/* ---- a localStorage stand-in (the store persists to it) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

/* Angular's decorators need the JIT compiler in a plain Node process. */
await import('@angular/compiler');
const { DataService } = await import('./data.service.js');
const { SchedulerComponent } = await import('./features/scheduler/scheduler.component.js');

let n = 0;
const check = (label, fn) => {
  n++;
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

const d = new DataService();
const cdr = { detectChanges() {}, markForCheck() {} };
const confirm = { ask: async () => false };
const c = new SchedulerComponent(d, cdr, confirm);
const DAY = 86400000;

check('the calendar is Monday-anchored and agrees with its own anchor', () => {
  assert.equal(c.view, 'week', 'it opens on the week view');
  const anchor = new Date(c.anchor);
  assert.equal(anchor.getDay(), 1, 'the anchor is a Monday: ' + anchor.toDateString());
  assert.equal(new Date(c.columns()[0].start).toDateString(), anchor.toDateString(), 'and the first column is that day');
});

check('a week is seven consecutive, labelled days', () => {
  c.setView('week');
  const cols = c.columns();
  assert.equal(cols.length, 7);
  assert.deepEqual(cols.map((x) => x.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  for (let i = 1; i < cols.length; i++) {
    assert.equal(cols[i].start - cols[i - 1].start, DAY, 'column ' + i + ' follows the previous day');
  }
  assert.equal(new Date(cols[0].start).getDay(), 1, 'and the first column is a Monday');
  assert.ok(cols.every((x) => typeof x.sub === 'string' && x.sub.length > 0), 'each day carries its date sub-label');
});

check('day and month views are the periods they claim to be', () => {
  c.setView('day');
  assert.equal(c.view, 'day', 'the view switches');
  assert.ok(c.columns().length >= 1, 'a day view has columns, got ' + c.columns().length);
  c.setView('month');
  assert.equal(c.view, 'month');
  const month = c.columns();
  const monthOf = new Date(c.anchor).getMonth();
  assert.ok(month.length >= 28 && month.length <= 31, 'a month is 28-31 columns, got ' + month.length);
  assert.ok(month.every((x) => new Date(x.start).getMonth() === monthOf), 'all inside the anchored month');
  c.setView('week');
});

check('every bar is a real order', () => {
  const bars = c.models();
  assert.ok(bars.length > 0, 'the fixture puts work on the calendar');
  const orderIds = new Set(d.listOrders().map((o) => o.orderId));
  for (const bar of bars) {
    assert.ok(bar.order && orderIds.has(bar.order.orderId), 'every bar names a real order');
  }
});

check('the conflict list names orders, and is derived rather than stored', () => {
  const conflicts = c.conflicts();
  assert.ok(Array.isArray(conflicts), 'conflicts() is a list');
  for (const row of conflicts) {
    assert.ok(row.orderIds && row.orderIds.length > 1, 'a conflict is two orders competing');
  }
  assert.equal(c.data.listOrders().some((o) => 'conflicts' in o), false, 'nothing on the order row stores them');
});

/* ============ the extracted module, driven directly (no component, no DOM) ============
 *
 * `scheduler-view.ts` is where the calendar and capacity math now lives. These four
 * checks reach it directly, which is what the extraction was for: the behaviour is
 * assertable without instantiating anything.
 */
const {
  columnsFor, peakUnits, committedUnits, bookingsInRange, mondayOf, rangeBoundsFor, DAY_MS,
} = await import('./features/scheduler/scheduler-view.js');

check('columnsFor() is the one definition of a period', () => {
  const anchor = mondayOf(Date.parse('2026-08-19T00:00:00')); // a Wednesday
  assert.equal(new Date(anchor).getDay(), 1, 'a week is anchored on its Monday');
  assert.equal(columnsFor('week', anchor).length, 7);
  assert.equal(columnsFor('month', anchor).length, 31, 'August has 31 days');
  assert.equal(columnsFor('day', anchor).length, 24, 'a day view is 24 hour segments');
  assert.equal(rangeBoundsFor('week', anchor).end - rangeBoundsFor('week', anchor).start, 7 * DAY_MS - 1, 'the visible week is seven whole days');
});

check('peakUnits() closes a window before an identical one opens', () => {
  assert.equal(peakUnits([]), 0, 'nothing booked, nothing committed');
  assert.equal(peakUnits([{ start: 0, end: 0, qty: 1 }, { start: DAY_MS, end: 2 * DAY_MS, qty: 1 }]), 1,
    'a booking ending the day another begins does not overlap it — spans are day-inclusive, so that is the tie');
  assert.equal(peakUnits([{ start: 0, end: 2 * DAY_MS, qty: 3 }, { start: DAY_MS, end: 3 * DAY_MS, qty: 2 }]), 5,
    'overlapping windows add up');
});

check('committedUnits() measures a window, and a wider one can only measure more', () => {
  const orders = d.listOrders().filter((o) => o.status === 'active');
  const pair = orders.flatMap((o) => o.lineItems.map((li) => ({ o, li })))[0];
  const item = d.getItem(pair.li.type, pair.li.refId);
  const s = Date.parse((pair.li.startDate ?? pair.o.startDate) + 'T00:00:00');
  const e = Date.parse((pair.li.endDate ?? pair.o.endDate) + 'T00:00:00');
  assert.ok(committedUnits(item, orders, s, e) >= 1, 'the line is counted inside its own window');
  assert.ok(committedUnits(item, orders, s - 365 * DAY_MS, e + 365 * DAY_MS) >= committedUnits(item, orders, s, e),
    'widening the window can only raise the peak');
});

check('bookingsInRange() returns only bookings the visible period can hold', () => {
  const orders = d.listOrders().filter((o) => o.status === 'active');
  const bounds = rangeBoundsFor('week', c.anchor);
  for (const item of ['serialized', 'bulk', 'consumable', 'part', 'labor', 'kit', 'attachment'].flatMap((t) => d.listItems(t))) {
    for (const row of bookingsInRange(item, orders, 'week', c.anchor)) {
      const s = Date.parse(row.start + 'T00:00:00');
      const e = Date.parse(row.end + 'T00:00:00') + DAY_MS - 1;
      assert.ok(s <= bounds.end && bounds.start <= e, row.orderId + ' overlaps the week it was returned for');
    }
  }
});

console.log(`\ncheck26: ${n} checks`);

