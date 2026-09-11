import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService } = await import('./data.service.js');
const { can } = await import('./models.js');

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

/* ============================= A2: audit ============================= */
mem.clear();
const d = new DataService();

check('every seeded row carries tenant + author stamps', () => {
  const rows = [
    ...d.allItems(),
    ...d.listParties(),
    ...d.listOrders(),
    ...d.listMovements(),
    ...d.listLocations(),
  ];
  assert.equal(rows.length > 20, true, 'a real sample');
  for (const r of rows) {
    assert.equal(r.tenantId, 'TNT-NORTHLINE', `tenantId on ${r.id ?? r.orderId}`);
    assert.ok(r.createdAt, `createdAt on ${r.id ?? r.orderId}`);
    assert.ok(r.createdBy, `createdBy on ${r.id ?? r.orderId}`);
    assert.ok(r.updatedAt, `updatedAt on ${r.id ?? r.orderId}`);
    assert.ok(r.updatedBy, `updatedBy on ${r.id ?? r.orderId}`);
  }
});

check('the ledger names a user, and its author is that user', () => {
  const ms = d.listMovements();
  // Five custody issues (A4) + the four rows the seeded receipts landed (A5:
  // two new loader units, the buckets they topped up, and the hose restock).
  assert.equal(ms.length, 9);
  for (const m of ms) {
    assert.match(m.byUserId, /^USR-\d+$/);
    assert.equal(m.createdBy, m.byUserId);
    assert.equal(m.createdAt, m.at);
  }
  assert.equal(d.userName('USR-004'), 'Ray Chen');
  assert.equal(d.userName(null), '—');
});

check('a new record is attributed to the acting user', () => {
  const item = d.createItem('part', { name: 'Test Widget', category: d.categoriesFor('part')[0], status: 'In Stock', qty: 4, rateDaily: 0 });
  assert.equal(item.createdBy, 'USR-003');
  assert.equal(item.updatedBy, 'USR-003');
  assert.equal(item.tenantId, 'TNT-NORTHLINE');
  assert.ok(item.createdAt);
});

check('an edit re-stamps updatedBy without touching the create stamps', () => {
  const item = d.listItems('part').find((i) => i.name === 'Test Widget');
  const created = { at: item.createdAt, by: item.createdBy };
  d.setSessionUser('USR-004');
  d.updateItem('part', item.id, { qtyOnHand: 9 });
  const after = d.getItem('part', item.id);
  assert.equal(after.updatedBy, 'USR-004', 'last writer wins');
  assert.equal(after.createdBy, created.by, 'author is history');
  assert.equal(after.createdAt, created.at);
  assert.notEqual(after.updatedAt, after.createdAt, 'updated moved');
  d.setSessionUser('USR-003');
});

check('a nested edit attributes the parent row', () => {
  const order = d.listOrders()[0];
  d.setSessionUser('USR-005');
  d.updateOrderLineQty(order.orderId, order.lineItems[0].id, 3);
  const after = d.getOrder(order.orderId);
  assert.equal(after.updatedBy, 'USR-005');
  assert.equal(after.createdBy, order.createdBy, 'create stamps untouched');
  d.setSessionUser('USR-003');
});

check('an untouched row is not re-stamped', () => {
  const order = d.getOrder(d.listOrders()[1].orderId);
  const stamp = order.updatedAt;
  d.createItem('part', { name: 'Another', category: d.categoriesFor('part')[0], status: 'In Stock', qty: 1, rateDaily: 0 });
  assert.equal(d.getOrder(order.orderId).updatedAt, stamp, 'writes do not smear across rows');
});

check('a movement logged now is attributed to the session user', () => {
  d.setSessionUser('USR-004');
  const mv = d.logMovement({ type: 'consumable', refId: 'SG-LFT-001', kind: 'adjust', qty: -2, note: 'Count correction' });
  assert.equal(mv.byUserId, 'USR-004');
  assert.equal(d.userName(mv.byUserId), 'Ray Chen');
  assert.equal(mv.createdBy, 'USR-004');
  d.setSessionUser('USR-003');
});

check('a deleted row stops being tracked', () => {
  const item = d.listItems('part').find((i) => i.name === 'Another');
  d.removeItem('part', item.id);
  assert.equal(d.getItem('part', item.id), undefined);
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\nall ${n} checks passed`);
