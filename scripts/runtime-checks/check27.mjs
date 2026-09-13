import assert from 'node:assert/strict';

/* ================= the gestures, the writes and the tooltips =================
 *
 * P10. The last uncovered surface in the Scheduler is the code that *acts*: drag-to-book,
 * resize, move, the quantity prompt, and the tooltip builders (shared by every page in the
 * app, and uncovered until now).
 *
 * None of it needed a browser. The gesture code touches exactly one browser global —
 * `window` add/removeEventListener — and one DOM call, `track.getBoundingClientRect()`.
 * Both are stubbed here, so the real handlers run against the real store and their real
 * writes are asserted. What is *not* simulated is the paint: whether a bar lands under the
 * cursor is the e2e suite's question (`npm run e2e` drives the grid for real), and this
 * check answers the other one — given this gesture, did the store change the way the rule
 * says it must?
 */

/* ---- the two stubs ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
const watched = [];
globalThis.window = {
  addEventListener: (t) => watched.push(t),
  removeEventListener: () => {},
  setTimeout: () => 0,
};

await import('@angular/compiler');
const { DataService } = await import('./data.service.js');
const { SchedulerComponent } = await import('./features/scheduler/scheduler.component.js');
const { orderTip, orderRecordTip, assetTip, partyTip, tip } = await import('./shared/tip/tip-builders.js');
const { stampDate, stampMinutes, stampHM, stampAt, stampRange, stampISO, stampDayRange } = await import('./shared/tip/tip-format.js');

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
const c = new SchedulerComponent(d, { detectChanges() {}, markForCheck() {} }, { ask: async () => false });

/* ============================ the tooltip builders ============================
 * Run first: the gesture checks below move real dates, and these read the fixture. */
const order = d.listOrders().filter((o) => o.status === 'active')[0];
const item = d.listItems('serialized')[0];

check('orderTip() is the identity, then the window — and nothing else', () => {
  const t = orderTip(d, order);
  assert.equal(t.title, order.orderId + ' - ' + order.projectName, 'title is CODE - project');
  assert.equal(t.lines.length, 1, 'the bar already prints its own sub-line');
  assert.match(t.lines[0], /^\d+\/\d+\/\d+ \d+:\d+[ap]m → \d+\/\d+\/\d+ \d+:\d+[ap]m$/, 'one range line: ' + t.lines[0]);
  assert.ok(t.lines[0].startsWith(stampDate(order.startDate)), "starting on the order's own start date");
});

check('orderRecordTip() adds the record facts and the status badge', () => {
  const t = orderRecordTip(d, order);
  const labels = t.lines.filter((l) => typeof l !== 'string').map((l) => l.label);
  assert.deepEqual(labels, ['Customer', 'Site', 'Items', 'Value'], 'one fact per line, in a fixed order');
  assert.equal(t.badge, order.status, 'the badge is the order status');
  assert.ok(t.badgeClass.startsWith('st-'), 'and carries a status class');
});

check('assetTip() prints exactly the facts the item has', () => {
  for (const it of d.listItems('serialized').slice(0, 20).concat(d.listItems('bulk').slice(0, 20))) {
    const labels = assetTip(d, it).lines.filter((l) => typeof l !== 'string').map((l) => l.label);
    assert.ok(labels.includes('Type') && labels.includes('Category'), it.id + ' always names type and category');
    assert.equal(labels.includes('Serial'), !!it.serial, it.id + ': a serial line iff it has a serial');
    assert.equal(labels.includes('Notes'), !!it.notes, it.id + ': a notes line iff it has notes');
  }
});

check('tip() drops the empty lines, and partyTip() marks an inactive party', () => {
  assert.deepEqual(tip('T', ['a', '   ', null, '', { label: 'L', value: '' }, { label: 'L2', value: 'v' }]).lines, ['a', { label: 'L2', value: 'v' }]);
  const p = d.listParties()[0];
  const t = partyTip(d, p);
  assert.equal(t.title, p.name);
  assert.equal(t.badge, p.active === false ? 'Inactive' : 'Active', 'the badge tells a live account from a closed one');
});

check('the stamp helpers format the shapes the tips promise', () => {
  assert.equal(stampDate('2026-08-01'), '8/1/26');
  assert.equal(stampDate(null), '—', 'no date prints as an em dash, never as NaN');
  assert.equal(stampDate('nonsense'), '—');
  assert.equal(stampMinutes(600), '10:00am', 'minutes past midnight');
  assert.equal(stampMinutes(990), '4:30pm', 'no leading zero on the hour');
  assert.equal(stampMinutes(0), '12:00am', 'midnight prints 12, not 0');
  assert.equal(stampMinutes(1505), '1:05am', 'past midnight wraps');
  assert.equal(stampHM('08:05'), '8:05am', 'HH:mm accepts a leading zero and prints none');
  assert.equal(stampHM(''), '', 'no time prints as nothing');
  assert.equal(stampAt('2026-08-01', 600), '8/1/26 10:00am');
  assert.equal(stampRange('2026-08-01', 600, '2026-08-05', 990), '8/1/26 10:00am → 8/5/26 4:30pm', 'the shared range line');
  assert.equal(stampRange('2026-08-01', null), '8/1/26 → 8/1/26', 'a range with no times repeats the date');
  assert.equal(stampISO('2026-08-01T16:30'), '8/1/26 4:30pm', 'a full ISO stamp');
  assert.equal(stampDayRange('2026-08-01', '2026-08-05'), '8/1/26 → 8/5/26');
});

/* ============================ the gestures ============================ */
const track = { getBoundingClientRect: () => ({ left: 0, width: 700 }) };
track.closest = (sel) => (sel === '.tl-row-track' ? track : null);
const dropOf = (type, id) => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { getData: () => type + '|' + id } });
const at = (x) => ({ preventDefault() {}, stopPropagation() {}, clientX: x, target: track });

check('dropping a single-unit asset books one unit onto the order', () => {
  const before = d.getOrder(order.orderId).lineItems.length;
  c.onDropOrder(dropOf('serialized', item.id), order.orderId);
  const lines = d.getOrder(order.orderId).lineItems;
  assert.equal(lines.length, before + 1, 'one line added');
  const added = lines[lines.length - 1];
  assert.equal(added.type, 'serialized');
  assert.equal(added.refId, item.id);
  assert.equal(added.qty, 1, 'a single unit books as one');
  assert.equal(c.bookPrompt, null, 'no quantity prompt for a resource we own one of');
  assert.equal(c.selectedOrderId, order.orderId, 'the row it landed on stays selected');
  assert.ok(c.expanded.has(order.orderId), 'and expanded, so the new booking is visible');
});

check('dropping a multi-unit resource asks for a quantity first — and writes nothing', () => {
  const bulk = d.listItems('bulk').find((i) => d.capacity(i) > 1);
  const before = d.getOrder(order.orderId).lineItems.length;
  c.onDropOrder(dropOf('bulk', bulk.id), order.orderId);
  assert.equal(d.getOrder(order.orderId).lineItems.length, before, 'the prompt comes before any write');
  assert.equal(c.bookPrompt && c.bookPrompt.refId, bulk.id, 'and names the resource');
  assert.equal(c.bookPrompt.qty, 1, 'with a quantity to edit, starting at one');
  c.bookPrompt = { type: 'bulk', refId: bulk.id, orderId: order.orderId, qty: 3 };
  c.commitBook();
  const added = d.getOrder(order.orderId).lineItems.filter((l) => l.refId === bulk.id);
  assert.equal(added.length, 1, 'committing writes once');
  assert.equal(added[0].qty, 3, 'with the quantity that was asked for');
  assert.equal(c.bookPrompt, null, 'and the prompt closes');
});

check('a retired asset is refused, and nothing else is', () => {
  for (const it of d.listItems('serialized')) {
    assert.equal(c.availability(it).blocked, it.status === 'retired', it.id + ': only a retired asset is unschedulable');
  }
  const retired = d.listItems('serialized').concat(d.listItems('bulk'), d.listItems('consumable')).find((i) => i.status === 'retired');
  if (retired) {
    const before = d.getOrder(order.orderId).lineItems.length;
    c.onDropOrder(dropOf(retired.type, retired.id), order.orderId);
    assert.equal(d.getOrder(order.orderId).lineItems.length, before, 'the drop is refused');
    assert.equal(c.bookPrompt, null, 'and does not even open the prompt');
  }
});

check('dragging an order bar moves its whole window, and carries its bookings', () => {
  c.view = 'week';
  const before = d.getOrder(order.orderId);
  const beforeStart = before.startDate;
  /* Bookings that carry no window of their own follow the order; either way each one
     must land two days on, resolved the same way before and after. */
  const beforeLineStarts = before.lineItems.map((l) => c.addDaysISO(l.startDate ?? before.startDate, 2)).join(',');
  /* 200px of a 700px week is 2 days. */
  c.startMove(at(100), { orderId: order.orderId, liId: null });
  assert.deepEqual(watched.slice(-3), ['pointermove', 'pointerup', 'pointercancel'], 'a live drag listens for the move, the up and the cancel');
  c.onMoveMove(at(300));
  const after = d.getOrder(order.orderId);
  assert.equal(after.startDate, c.addDaysISO(beforeStart, 2), 'the start moved two days');
  assert.equal(after.lineItems.map((l) => l.startDate ?? after.startDate).join(','), beforeLineStarts, 'and every booking came with it');
  c.onMoveUp();
  assert.equal(c.moving, null, 'the drag ends detached');
});

check('a 2px wobble is not a drag — a plain click still selects the row', () => {
  const before = d.getOrder(order.orderId).startDate;
  c.startMove(at(100), { orderId: order.orderId, liId: null });
  c.onMoveMove(at(102));
  assert.equal(c.moving.moved, false, 'under the threshold nothing is claimed');
  assert.equal(d.getOrder(order.orderId).startDate, before, 'and nothing is written');
  c.onMoveUp();
});

check('dragging a bar edge resizes it, and never past the other end', () => {
  c.view = 'week';
  const o = d.getOrder(order.orderId);
  const line = o.lineItems[0];
  c.startResize(at(100), { orderId: order.orderId, liId: line.id }, 'r');
  assert.equal(c.resizing.edge, 'r');
  assert.equal(c.resizing.liId, line.id);
  c.onResizeMove(at(600));
  const grown = d.getOrder(order.orderId).lineItems.find((l) => l.id === line.id);
  assert.ok((grown.endDate ?? o.endDate) >= (grown.startDate ?? o.startDate), 'a booking keeps a non-negative length');
  /* drag the same edge back to the far left: it clamps rather than inverting */
  c.onResizeMove(at(0));
  const clamped = d.getOrder(order.orderId).lineItems.find((l) => l.id === line.id);
  assert.ok((clamped.endDate ?? o.endDate) >= (clamped.startDate ?? o.startDate), 'start never passes end');
  assert.equal(clamped.startDate ?? o.startDate, o.startDate, 'and a booking cannot leave its order window');
});

check("day-view drags snap to a quarter hour, inside the order's own window", () => {
  c.view = 'day';
  const o = d.getOrder(order.orderId);
  const t0 = c.orderT0(o);
  const t1 = c.orderT1(o);
  c.startMove(at(100), { orderId: order.orderId, liId: null });
  c.onMoveMove(at(100 + 700 / 24)); // one hour across a 24-hour track
  const moved = d.getOrder(order.orderId);
  const delta = c.orderT0(moved) - t0;
  assert.equal(delta % 15, 0, 'snapped to a quarter hour, got ' + delta);
  assert.equal(c.orderT1(moved) - c.orderT0(moved), t1 - t0, 'and the window keeps its length');
  c.onMoveUp();
  c.view = 'week';
});

console.log(`\ncheck27: ${n} checks`);


