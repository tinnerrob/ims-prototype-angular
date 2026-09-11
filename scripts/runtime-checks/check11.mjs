import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService, dISO, dayAt, mondayOf, periodBounds, periodLabel } = await import('./data.service.js');

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

/* ============ the period filter behind the two purchasing lists ============
 *
 * Both document lists on Purchasing & Receiving narrow to a day / week / month
 * through the inspection log's chips and `‹ range ›` pager, and the window they
 * filter by comes from `periodBounds()` in `core/data.service.ts` — one
 * definition of "this week" for every navigator in the app. These checks hold
 * that window to what its own label says (`periodLabel`), and hold the fixture
 * to the dates those lists read each document by: a purchase order is dated by
 * the *day* it was raised, a receipt by the instant it was posted (so the list
 * reads the day off the timestamp). A seed whose dates stopped matching the
 * filter would silently empty a list rather than fail a build.
 *
 * Month indices below are 0-based: `new Date(2026, 8, 8)` is 8 Sep 2026.
 */

check('a day window is the one day its label names', () => {
  const b = periodBounds('day', new Date(2026, 8, 8)); // Tue 8 Sep 2026
  assert.equal(b.start, '2026-09-08');
  assert.equal(b.end, '2026-09-08');
  assert.equal(periodLabel('day', new Date(2026, 8, 8)), 'Tuesday, Sep 8, 2026');
});

check('a week window runs Monday to Sunday, wherever in the week the cursor is', () => {
  // Mon 7 Sep .. Sun 13 Sep 2026 — every cursor in that week names one window,
  // Sunday included (its `getDay()` of 0 is the case a naive offset gets wrong).
  for (let i = 0; i < 7; i++) {
    const d = dayAt(new Date(2026, 8, 7), i);
    const b = periodBounds('week', d);
    assert.equal(b.start, '2026-09-07', `start for ${dISO(d)} (day ${d.getDay()})`);
    assert.equal(b.end, '2026-09-13', `end for ${dISO(d)}`);
  }
  assert.equal(dISO(mondayOf(new Date(2026, 8, 13))), '2026-09-07', 'the Sunday belongs to it');
  assert.equal(dISO(mondayOf(new Date(2026, 8, 14))), '2026-09-14', 'and the next day starts a new one');
});

check('a month window is the 1st to its last day, leap years included', () => {
  const sep = periodBounds('month', new Date(2026, 8, 11));
  assert.equal(sep.start, '2026-09-01');
  assert.equal(sep.end, '2026-09-30');
  const feb = periodBounds('month', new Date(2028, 1, 10)); // Feb 2028 is a leap month
  assert.equal(feb.start, '2028-02-01');
  assert.equal(feb.end, '2028-02-29');
});

check('the pager label names the window the filter selects', () => {
  // `periodLabel()` words the day it is handed, so the cursor must be the
  // period's own first day — the day itself, its Monday, the 1st — for the label
  // to name the window the rows were filtered by, and `setRange()` snaps it there.
  for (const [view, anchor, label] of [
    ['day', new Date(2026, 8, 11), 'Friday, Sep 11, 2026'],
    ['week', mondayOf(new Date(2026, 8, 11)), 'Week of Sep 7, 2026'],
    ['month', new Date(2026, 8, 1), 'Month of September 2026'],
  ]) {
    assert.equal(periodLabel(view, anchor), label, `${view} label`);
    assert.equal(periodBounds(view, anchor).start, dISO(anchor), `${view} window starts where the label does`);
  }
  // An unsnapped cursor is exactly what the snap is for: the label would name the
  // cursor's own day while the window it filters still starts on the Monday.
  assert.equal(periodLabel('week', new Date(2026, 8, 11)), 'Week of Sep 11, 2026');
  assert.equal(periodBounds('week', new Date(2026, 8, 11)).start, '2026-09-07');
});

mem.clear();
const d = new DataService();
const pos = d.listPurchaseOrders();
const receipts = d.listReceipts();

check('a purchase order is dated by the day, so the list compares it as it stands', () => {
  assert.ok(pos.length >= 3, `the fixture has POs (${pos.length})`);
  for (const po of pos) {
    assert.match(po.orderedAt, /^\d{4}-\d{2}-\d{2}$/, `orderedAt on ${po.id}`);
    assert.ok(!Number.isNaN(Date.parse(po.orderedAt + 'T00:00:00')), `${po.id} orderedAt parses`);
  }
});

check('a receipt is dated by its posting instant, so the list reads the day off it', () => {
  assert.ok(receipts.length >= 2, `the fixture has receipts (${receipts.length})`);
  for (const r of receipts) {
    assert.match(r.at.slice(0, 10), /^\d{4}-\d{2}-\d{2}$/, `the day of ${r.id}`);
    assert.notEqual(r.at, r.at.slice(0, 10), `${r.id} carries a time as well as a day`);
  }
});

check('the fixture lands where the day / week / month windows say it does', () => {
  const ids = (rows, key, view, y, m, day) => {
    const b = periodBounds(view, new Date(y, m, day));
    return rows.filter((r) => key(r) >= b.start && key(r) <= b.end).map((r) => r.poId ?? r.id);
  };
  const poDay = (p) => p.orderedAt;
  const recDay = (r) => r.at.slice(0, 10);

  // Sep 2026: two orders were raised (the 2nd and the 4th) and one receipt posted.
  assert.deepEqual(ids(pos, poDay, 'month', 2026, 8, 11), ['PO-2026-001', 'PO-2026-003'], 'September orders');
  assert.deepEqual(ids(receipts, recDay, 'month', 2026, 8, 11), ['PO-2026-003'], 'September receipts');
  // A week that straddles the month end (Mon 31 Aug – Sun 6 Sep) still holds both.
  assert.deepEqual(ids(pos, poDay, 'week', 2026, 8, 2), ['PO-2026-001', 'PO-2026-003'], 'orders in the week of Aug 31');
  assert.equal(ids(receipts, recDay, 'week', 2026, 8, 2).length, 0, 'nothing arrived that week');
  // August: the loaders' order and its delivery, and nothing from September.
  assert.deepEqual(ids(pos, poDay, 'month', 2026, 7, 20), ['PO-2026-002'], 'August orders');
  assert.deepEqual(ids(receipts, recDay, 'month', 2026, 7, 20), ['PO-2026-002'], 'August receipts');
  // One day out: the partial hose delivery, and no order raised that day.
  assert.deepEqual(ids(receipts, recDay, 'day', 2026, 8, 8), ['PO-2026-003'], 'receipts on Sep 8');
  assert.equal(ids(pos, poDay, 'day', 2026, 8, 8).length, 0, 'no order was raised on Sep 8');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck11: ${n} checks`);
