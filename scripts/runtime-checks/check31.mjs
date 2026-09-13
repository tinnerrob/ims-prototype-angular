import assert from 'node:assert/strict';

/* ================ a sub-rental's window, and its return ======================
 *
 * Phase F (docs/CODE-REVIEW.md). A sub-rental is a unit taken *in* from a supplier
 * to be *re-let* on a customer order, so its two ends are the whole point
 * (`RentalSub.rentFrom` / `rentTo`), and the return is a **date** rather than a
 * status flag. This drives the store's own mutators and readers against the seed.
 */

/* ---- a localStorage stand-in (the store persists to it) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

await import('@angular/compiler');
const { DataService } = await import('./data.service.js');

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

check('the seed carries a hold window on every sub-rental', () => {
  for (const r of d.listRentals()) {
    assert.ok(r.rentFrom && /^\d{4}-\d{2}-\d{2}$/.test(r.rentFrom), `${r.id}: rentFrom is an ISO date`);
    assert.ok(r.rentTo && /^\d{4}-\d{2}-\d{2}$/.test(r.rentTo), `${r.id}: rentTo is an ISO date`);
    assert.ok(r.rentFrom <= r.rentTo, `${r.id}: the window runs forwards`);
  }
});

check('a sub-rental can be created with its window', () => {
  const rec = d.createRental({
    itemId: null,
    assetName: 'Test Mast Climber',
    orderId: d.listOrders()[0]?.orderId ?? null,
    supplierId: d.supplierParties()[0].id,
    vendorCost: 60,
    retailRate: 130,
    qty: 2,
    rentFrom: '2026-09-01',
    rentTo: '2026-09-30',
  });
  assert.ok(rec, 'the store took it');
  const back = d.listRentals().find((r) => r.id === rec.id);
  assert.equal(back.rentFrom, '2026-09-01');
  assert.equal(back.rentTo, '2026-09-30');
  assert.ok(d.rentalOut(back), 'and it is out (no return yet)');
});

check('an open end is allowed — a window missing a date is not an error', () => {
  const rec = d.createRental({
    itemId: null,
    assetName: 'Open Ended Pump',
    orderId: null,
    supplierId: d.supplierParties()[0].id,
    vendorCost: 20,
    retailRate: 45,
    qty: 1,
    rentTo: '2026-10-31',
  });
  assert.ok(rec, 'the store took it without a rentFrom');
  assert.equal(rec.rentFrom, undefined);
  assert.equal(rec.rentTo, '2026-10-31');
});

check('a return stamps the date, and does not touch the window', () => {
  const live = d.listRentals().find((r) => d.rentalOut(r) && r.rentTo);
  const from = live.rentFrom;
  const to = live.rentTo;
  const back = d.returnRental(live.id, '2026-09-15');
  assert.equal(back.returnedAt, '2026-09-15', 'the day it went back');
  assert.equal(back.rentFrom, from, 'the window is untouched');
  assert.equal(back.rentTo, to, 'both ends');
  assert.equal(d.rentalOut(back), false, 'and it is no longer out');
});

check('the return defaults to today, so the button needs no date picker', () => {
  const live = d.listRentals().find((r) => d.rentalOut(r));
  const back = d.returnRental(live.id);
  assert.equal(back.returnedAt, new Date().toISOString().slice(0, 10));
});

check('overdue reads the two dates, and stops being overdue once returned', () => {
  const rec = d.createRental({
    itemId: null,
    assetName: 'Late Loader',
    orderId: null,
    supplierId: d.supplierParties()[0].id,
    vendorCost: 10,
    retailRate: 25,
    qty: 1,
    rentFrom: '2026-01-01',
    rentTo: '2026-01-10',
  });
  assert.equal(d.rentalOverdue(rec, '2026-02-01'), true, 'past its due-back date while out');
  assert.equal(d.rentalOverdue(rec, '2026-01-05'), false, 'not yet due');
  d.returnRental(rec.id, '2026-01-09');
  assert.equal(d.rentalOverdue(rec, '2026-02-01'), false, 'a returned row is never overdue');
});

check('an unknown id is refused, not invented', () => {
  assert.equal(d.returnRental('RR-999', '2026-09-15'), null);
});

console.log(`\ncheck31: ${n} checks`);
