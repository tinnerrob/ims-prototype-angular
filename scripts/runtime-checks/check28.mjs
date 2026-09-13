import assert from 'node:assert/strict';

/* ================= the modal editors, opened and saved =================
 *
 * P11 — the last uncovered surface. `openOrder()` / `saveOrder()` and `openRes()` /
 * `saveRes()` are the app's only *creation* paths: they seed a form, validate it, coerce
 * its numbers, and write through to the store with a handful of documented fallbacks
 * ("an unnamed site falls back to the customer's address", "an unplaced resource stores no
 * location", "the category name is derived from the category row so the two cannot
 * disagree"). None of that had a check.
 *
 * Like P10, this needs no browser: the component touches `document` nowhere, and `window`
 * only for drag listeners. So the editors run for real, on the real store, with the same
 * two stubs.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, setTimeout: () => 0 };

await import('@angular/compiler');
const { DataService } = await import('./data.service.js');
const { ITEM_STATUSES } = await import('./models.js');
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
const c = new SchedulerComponent(d, { detectChanges() {}, markForCheck() {} }, { ask: async () => false }, { print() {} });
const orderIds = () => d.listOrders().map((o) => o.orderId);

check('opening the New Order editor seeds a complete form and is not an edit', () => {
  c.openOrder();
  const f = c.orderForm;
  const party = d.customerParties()[0];
  assert.equal(c.orderOpen, true, 'the editor is open');
  assert.equal(f.partyId, party.id, 'the first customer is preselected');
  assert.equal(f.jobSite, party.billingAddress, "and its address prefills the site");
  assert.equal(f.projectName, '', 'the name is left for the user');
  assert.equal(f.active, true, 'a new order starts live');
  assert.equal(f.startDate, c.dateAt(c.viewStart()), 'starting on the first day on screen');
  assert.equal(f.endDate, c.addDaysISO(f.startDate, 14), 'and running two weeks');
  assert.deepEqual([f.startTime, f.endTime], ['07:00', '17:00'], 'with the default working day');
  assert.deepEqual([f.siteLat, f.siteLng], [d.yard.lat, d.yard.lng], 'sited at the yard');
  assert.equal(c.orderDirty(), false, 'a freshly opened form has nothing unsaved');
});

check('editing a field makes the form dirty, and reopening starts clean', () => {
  c.orderForm.projectName = 'Roof replacement';
  assert.equal(c.orderDirty(), true, 'that is what the close-confirm reads');
  c.closeOrder();
  assert.equal(c.orderOpen, false);
  assert.equal(c.orderSnap, '', 'the snapshot is dropped with the editor');
  c.openOrder();
  assert.equal(c.orderDirty(), false, 'and the next open is clean again');
});

check('saving is refused without a customer or a name — and writes nothing', () => {
  const before = orderIds();
  c.openOrder();
  c.orderForm.projectName = '   ';
  c.saveOrder();
  assert.deepEqual(orderIds(), before, 'whitespace is not a name');
  assert.equal(c.orderOpen, true, 'so the editor stays open for the user to fix');
  c.orderForm.projectName = 'Real job';
  c.orderForm.partyId = 'NO-SUCH-PARTY';
  c.saveOrder();
  assert.deepEqual(orderIds(), before, 'and an unknown customer cannot own an order');
  assert.equal(c.orderOpen, true);
});

check('saving trims, coerces numbers, and falls back rather than writing junk', () => {
  const before = orderIds();
  c.openOrder();
  c.orderForm = {
    ...c.orderForm,
    projectName: '  Roof replacement  ',
    jobSite: '  42 Test Road ',
    startDate: '2026-09-01',
    endDate: '2026-09-12',
    startTime: '07:00',
    endTime: '17:00',
    geofenceRadius: 'not a number',
    siteLat: 'also not a number',
    siteLng: '123',
  };
  c.saveOrder();
  const created = d.listOrders().find((o) => !before.includes(o.orderId));
  assert.ok(created, 'the order was created');
  assert.equal(created.projectName, 'Roof replacement', 'the name is trimmed');
  assert.equal(created.jobSite, '42 Test Road', 'and so is the site');
  assert.equal(created.startDate, '2026-09-01', 'the dates are stored as given');
  assert.equal(created.endDate, '2026-09-12');
  assert.equal(c.orderT0(created), 420, '07:00 stores as 420 minutes past midnight');
  assert.equal(c.orderT1(created), 1020, '5:00pm as 1020');
  assert.equal(created.geofenceRadius, 300, 'an unparseable radius falls back to 300 m');
  assert.equal(created.siteLat, d.yard.lat, 'and an unparseable latitude to the yard');
  assert.equal(created.siteLng, 123, 'while a parseable one is used');
  assert.equal(c.orderOpen, false, 'the editor closes on save');
  assert.equal(c.selectedOrderId, created.orderId, 'and the new order is selected');
  assert.ok(c.expanded.has(created.orderId), 'expanded, so its (empty) rows show');
});

check('an order saved as inactive is created closed', () => {
  const before = orderIds();
  c.openOrder();
  c.orderForm = { ...c.orderForm, projectName: 'Historical job', active: false };
  c.saveOrder();
  const created = d.listOrders().find((o) => !before.includes(o.orderId));
  assert.equal(created.status, 'closed', 'unticked "active" lands as a closed order');
});

check('opening the New Resource editor seeds the pool tab, and is not an edit', () => {
  for (const type of ['bulk', 'serialized', 'consumable']) {
    c.poolType = type;
    c.openRes();
    const f = c.resForm;
    assert.equal(c.resOpen, true, type + ': the editor is open');
    assert.equal(f.name, '', type + ': the name is left for the user');
    assert.equal(f.categoryId, c.categoryOptions()[0]?.id ?? '', type + ': filed under the first category of the tab');
    assert.equal(f.status, ITEM_STATUSES[type][0], type + ": opens in the tab's first status");
    assert.deepEqual([f.lat, f.lng], [d.yard.lat, d.yard.lng], type + ': placed at the yard by default');
    assert.equal(c.resDirty(), false, type + ': a freshly opened form has nothing unsaved');
    c.closeRes();
  }
});

check('a resource with no name is refused', () => {
  const before = d.listItems('bulk').length;
  c.poolType = 'bulk';
  c.openRes();
  c.resForm.name = '   ';
  c.saveRes();
  assert.equal(d.listItems('bulk').length, before, 'whitespace is not a name');
  assert.equal(c.resOpen, true, 'and the editor stays open');
});

check('a saved resource takes its category from the row, so the two cannot disagree', () => {
  c.poolType = 'bulk';
  c.openRes();
  const chosen = c.categoryOptions()[0];
  const before = d.listItems('bulk').length;
  c.resForm = { ...c.resForm, name: '  Hydraulic fluid  ', qty: '24', rateDaily: '12.5', locationId: '' };
  c.saveRes();
  const created = d.listItems('bulk').find((i) => i.name === 'Hydraulic fluid');
  assert.equal(d.listItems('bulk').length, before + 1, 'it lands in the pool');
  assert.ok(created, 'under its trimmed name');
  assert.equal(created.categoryId, chosen.id, 'filed under the chosen row');
  assert.equal(created.category, chosen.name, 'whose name is copied onto the row');
  assert.equal(created.rateDaily, 12.5, 'a numeric string became a number');
  assert.equal(created.locationId, undefined, 'an unplaced resource stores no location at all');
  assert.equal(c.resOpen, false, 'and the editor closes');
});

check('an opening count only lands when the resource has a place to sit in', () => {
  const place = d.listItems('consumable').find((i) => i.locationId)?.locationId;
  assert.ok(place, 'the fixture has a placed consumable to borrow a place from');
  c.poolType = 'consumable';
  c.openRes();
  c.resForm = { ...c.resForm, name: 'Rags (placed)', qtyOnHand: '50', locationId: place };
  c.saveRes();
  const placed = d.listItems('consumable').find((i) => i.name === 'Rags (placed)');
  assert.equal(placed.qtyOnHand, 50, 'the opening balance becomes the row\'s first level at that place');

  c.openRes();
  c.resForm = { ...c.resForm, name: 'Rags (nowhere)', qtyOnHand: '50', locationId: '' };
  c.saveRes();
  const nowhere = d.listItems('consumable').find((i) => i.name === 'Rags (nowhere)');
  assert.equal(nowhere.qtyOnHand, 0, 'and a row with no place simply holds nothing yet');
});

check('the per-type fields follow the pool tab', () => {
  c.poolType = 'serialized';
  c.openRes();
  c.resForm = { ...c.resForm, name: 'Boom lift', serial: 'SN-9', make: 'JLG', model: '450AJ', meterHours: '12', purchaseValue: '50000' };
  c.saveRes();
  const machine = d.listItems('serialized').find((i) => i.name === 'Boom lift');
  assert.equal(machine.serial, 'SN-9', 'a serialized item keeps its identity');
  assert.equal(machine.make, 'JLG');
  assert.equal(machine.model, '450AJ');
  assert.equal(machine.meterHours, 12);
  assert.equal(machine.purchaseValue, 50000);

  c.poolType = 'consumable';
  c.openRes();
  c.resForm = { ...c.resForm, name: 'Shop rags', qtyOnHand: '50', reorderPoint: '10', costPrice: '2', retailPrice: '4' };
  c.saveRes();
  const rags = d.listItems('consumable').find((i) => i.name === 'Shop rags');
  assert.equal(rags.qtyOnHand, 0, 'a counted row with no place holds nothing yet (see the next check)');
  assert.equal(rags.reorderPoint, 10, 'but its reorder point is its own');
  assert.equal(rags.costPrice, 2);
  assert.equal(rags.retailPrice, 4);
  assert.equal(rags.serial, undefined, 'and it is not given a serial');
});

console.log(`\ncheck28: ${n} checks`);
