import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

import { signInAs } from './sign-in.mjs';

const { DataService } = await import('./data.service.js');

/** The counted types, whose stock lives in `stock_levels` (see check7). */
const COUNTED_TYPES = ['bulk', 'consumable', 'part'];
const isCounted = (type) => COUNTED_TYPES.includes(type);

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

/* ================ A5: purchasing (supplier → PO → receipt → stock) ================ */

mem.clear();
const d = new DataService();
/* B2: the fixture ships signed out, so these checks — which assert who authored
   an in-session write — sign in as the seeded manager first. */
await signInAs(d, 'USR-003');
const poOf = (id) => d.getPurchaseOrder(id);
const receiptOf = (poId) => d.listReceipts().find((r) => r.poId === poId);
/** The seed's own rows, captured before any check edits the fixture. */
const seededPos = d.listPurchaseOrders().map((p) => ({ ...p }));

check('suppliers are parties carrying the supplier role', () => {
  const suppliers = d.supplierParties();
  assert.equal(suppliers.length, 7, 'the seeded suppliers (4 buying + 3 sub-rental vendors)');
  for (const s of suppliers) {
    assert.equal(s.kinds.includes('supplier'), true, `${s.id} is a supplier`);
    assert.equal(typeof s.name, 'string');
  }
  // Orders keep picking customers: the roles partition the one partner table.
  assert.equal(d.customerParties().some((p) => p.id === 'PTY-006'), false);
  assert.equal(d.customerParties().some((p) => p.id === 'PTY-001'), true);
  assert.equal(d.partyKindLabel(d.getParty('PTY-001')), 'Customer', 'no kinds = a customer');
  assert.equal(d.partyKindLabel(d.getParty('PTY-006')), 'Supplier');
  assert.equal(d.partyName(poOf('PO-2026-002').supplierId), 'United Rentals — Southeast');
});

check('the seeded POs cover the states the page must render', () => {
  const pos = d.listPurchaseOrders();
  assert.equal(pos.length, 3);
  assert.equal(d.poStatusLabel(poOf('PO-2026-001')), 'Awaiting delivery');
  assert.equal(d.poStatusLabel(poOf('PO-2026-002')), 'Received');
  assert.equal(d.poStatusLabel(poOf('PO-2026-003')), 'Partially received');
  // Every PO was authored to be 'ordered': the delivered/partial reading comes
  // from the receipts, so nothing in the row says "received".
  for (const po of pos) {
    assert.equal(po.status, 'ordered', `${po.id} lifecycle status`);
    assert.equal(po.lines.some((l) => 'receivedQty' in l), false, 'no stored received copy');
  }
});

check('progress is derived from receipts: outstanding agrees with the lines', () => {
  const full = poOf('PO-2026-002');
  assert.equal(d.poProgress(full), 'received');
  assert.ok(full.lines.every((l) => d.poLineOutstanding(l) === 0));
  const partial = poOf('PO-2026-003');
  assert.equal(d.poProgress(partial), 'partial');
  assert.equal(d.poLineOutstanding(partial.lines[0]), 1, 'the excavator has not landed');
  assert.equal(d.poLineOutstanding(partial.lines[1]), 8, '8 of 12 hoses still to come');
  assert.equal(d.receivableLines(partial).length, 2, 'both lines still have stock to come');
  assert.equal(d.poValue(full), 157082, '2 loaders + 2 buckets');
  assert.equal(d.poReceivedValue(partial), 4 * 33.5, 'only what actually arrived');
});

check('a receipt lands real stock: units created, SKUs topped up', () => {
  // Serialized: the ordered quantity became rows of its own, at the ordered cost
  // and billable rate, placed where the receipt put them.
  const loaders = d.listItems('serialized').filter((i) => i.name === 'CAT 259D3 Compact Track Loader');
  assert.equal(loaders.length, 2, 'one row per ordered unit');
  for (const u of loaders) {
    assert.equal(u.status, 'Available', 'a delivered machine is not out on rent');
    assert.equal(u.purchaseValue, 78500, 'bought at the ordered cost');
    assert.equal(u.rateDaily, 385, 'and billed at the ordered rate');
    assert.equal(u.locationId, 'LOC-03', 'put away where the receipt said');
    assert.equal(u.qty, 1, 'a unit is one row');
  }
  // Serialized lines that have not arrived have no row at all: an ordered but
  // undelivered machine must not appear in the pool.
  assert.equal(
    d.listItems('serialized').some((i) => i.name === 'Wacker Neuson ET42 Mini Excavator'),
    false,
    'the undelivered excavator does not exist yet',
  );
  // Quantity stock: the existing row is topped up and re-placed by the receipt.
  const buckets = d.getItem('attachment', 'ACC-002');
  assert.equal(buckets.qty, 5, '3 on hand + 2 received');
  assert.equal(buckets.locationId, 'LOC-03');
});

check('a topped-up SKU costs a moving average, not the last price', () => {
  // PRT-005: 12 @ 34.00 on hand, then 4 @ 33.50 received.
  const hose = d.getItem('part', 'PRT-005');
  assert.equal(hose.qtyOnHand, 16, '12 + 4');
  assert.equal(hose.costPrice, 33.88, '(12×34 + 4×33.5) / 16');
  assert.equal(hose.locationId, 'LOC-19', 'restocked into the bin it already lives in');
});

check('every receipt line points at a row that is at the receipt location', () => {
  const receipts = d.listReceipts();
  assert.equal(receipts.length, 2);
  for (const r of receipts) {
    for (const l of r.lines) {
      const row = d.getItem(l.type, l.refId);
      assert.ok(row, `${r.id} line ${l.refId} resolves`);
      // "Where the receipt put it" is a *level* for counted stock (the row can be
      // holding stock elsewhere too) and the row's own FK for a unit: either way
      // the row holds at least what the line landed, at the receipt's place.
      assert.ok(
        d.stockAt(row, r.locationId) >= l.qty,
        `${l.refId} holds what ${r.id} landed, at its location`,
      );
      if (!isCounted(l.type)) assert.equal(row.locationId, r.locationId, 'a unit sits where it landed');
      assert.equal(typeof r.at, 'string');
      assert.ok(d.getLocation(r.locationId), 'the destination is a real place');
      assert.ok(d.getPurchaseOrder(r.poId), 'and the PO it was posted against');
    }
  }
  assert.equal(d.receiptsAtLocation('LOC-03').length, 1, 'the yard delivery');
  assert.equal(d.receiptsAtLocation('LOC-05', true).length, 1, 'the warehouse bin one, via its subtree');
});

check('a receipt logs one movement per landed row, carrying the receipt id', () => {
  const r = receiptOf('PO-2026-002');
  const moves = d.listMovements().filter((m) => m.receiptId === r.id);
  assert.equal(moves.length, r.lines.length, 'one movement per landed row');
  for (const m of moves) {
    assert.equal(m.kind, 'receive');
    assert.equal(m.locationId, r.locationId);
    assert.equal(m.orderId, null, 'a receipt is not a customer order');
    assert.equal(m.party, 'United Rentals — Southeast', 'the supplier is the counterparty');
    assert.equal(m.byUserId, 'USR-001', 'the seeded receipt is the owner working the fixture');
    assert.equal(m.at, r.at, 'and the ledger clock is the receipt clock');
  }
  assert.equal(d.receiptQty(r), 4, '2 units + 2 buckets');
  assert.equal(d.receiptValue(r), 2 * 78500 + 2 * 41);
});

check('receiving the rest of a partial PO is a second receipt', () => {
  const before = d.listReceipts().length;
  const rec = d.receiveAgainst({
    poId: 'PO-2026-003',
    locationId: 'LOC-19',
    qty: { 'PO-2026-003-2': 8 },
    note: 'Balance of the hose order.',
  });
  assert.ok(rec, 'posted');
  assert.equal(d.listReceipts().length, before + 1);
  assert.equal(rec.id.startsWith('RC-'), true, 'a receipt id from the store');
  assert.equal(d.poLineOutstanding(poOf('PO-2026-003').lines[1]), 0, 'that line is complete');
  assert.equal(d.poProgress(poOf('PO-2026-003')), 'partial', 'the excavator is still missing');
  assert.equal(d.receiptQty(rec), 8);
  assert.equal(d.receiptValue(rec), 8 * 33.5);
  assert.equal(rec.lines.length, 1, 'one landed row, one line');
  assert.equal(rec.lines[0].refId, 'PRT-005', 'the line names the row it stocked');
  assert.equal(rec.byUserId, undefined, 'the row is attributed by the writer, not by hand');
  assert.equal(rec.createdBy, 'USR-003', 'posted by the session user, through save()');
});

check('a delivery cannot exceed what was ordered (and writes nothing when it tries)', () => {
  const receipts = d.listReceipts().length;
  const hose = d.getItem('part', 'PRT-005').qtyOnHand;
  // PO-2026-001 is untouched: ask for more filters than were ordered.
  assert.equal(
    d.receiveAgainst({ poId: 'PO-2026-001', locationId: 'LOC-14', qty: { 'PO-2026-001-1': 13 } }),
    null,
  );
  assert.equal(d.listReceipts().length, receipts, 'no receipt was written');
  assert.equal(d.poLineReceived('PO-2026-001-1'), 0, 'and no stock moved');
  assert.equal(d.getItem('part', 'PRT-005').qtyOnHand, hose);
});

check('a draft, cancelled, unknown or mis-located receipt is refused', () => {
  const before = d.listReceipts().length;
  const draft = d.createPurchaseOrder({
    supplierId: 'PTY-009',
    status: 'draft',
    orderedAt: '2026-09-09',
    expectedAt: '2026-09-20',
    lines: [{ id: '', type: 'consumable', refId: 'SG-LFT-001', description: '', qty: 6, unitCost: 2.1 }],
  });
  const line = draft.lines[0].id;
  assert.equal(d.receiveAgainst({ poId: draft.id, locationId: 'LOC-07', qty: { [line]: 6 } }), null);
  d.updatePurchaseOrder(draft.id, { status: 'cancelled' });
  assert.equal(d.receiveAgainst({ poId: draft.id, locationId: 'LOC-07', qty: { [line]: 6 } }), null);
  const live = poOf('PO-2026-001');
  const ordered = live.lines[0].id;
  assert.equal(d.receiveAgainst({ poId: live.id, locationId: 'LOC-99', qty: { [ordered]: 1 } }), null);
  assert.equal(d.receiveAgainst({ poId: 'PO-9999-999', locationId: 'LOC-07', qty: { [ordered]: 1 } }), null);
  assert.equal(d.receiveAgainst({ poId: live.id, locationId: 'LOC-14', qty: { [ordered]: 0 } }), null);
  assert.equal(d.receiveAgainst({ poId: live.id, locationId: 'LOC-14', qty: {} }), null);
  assert.equal(d.listReceipts().length, before, 'nothing was posted by any of them');
});

check('an edit cannot contradict stock that already arrived', () => {
  const po = poOf('PO-2026-002'); // fully delivered
  const delivered = po.lines[0];
  // Try to drop the delivered line and shrink it: both are refused in favour of
  // the receipts, which are the record of that stock.
  d.updatePurchaseOrder(po.id, { lines: [po.lines[1]] });
  assert.equal(d.getPurchaseOrder(po.id).lines.length, 2, 'the delivered line came back');
  d.updatePurchaseOrder(po.id, { lines: [{ ...delivered, qty: 1 }, po.lines[1]] });
  assert.equal(d.getPurchaseOrder(po.id).lines[0].qty, 2, 'and its quantity cannot fall below what arrived');
  // A PO that delivered cannot be cancelled — that is what a receipt means.
  d.updatePurchaseOrder(po.id, { status: 'cancelled' });
  assert.equal(d.getPurchaseOrder(po.id).status, 'ordered');
  assert.equal(d.poStatusLabel(poOf(po.id)), 'Received', 'still read as delivered');
});

check('a PO with receipts cannot be removed; one without can', () => {
  assert.deepEqual(d.purchaseOrderRemovalBlockers('PO-2026-002'), ['1 receipt(s) posted against it']);
  assert.equal(d.removePurchaseOrder('PO-2026-002'), false);
  assert.ok(d.getPurchaseOrder('PO-2026-002'), 'still there');
  assert.deepEqual(d.purchaseOrderRemovalBlockers('PO-2026-001'), []);
  const spare = d.createPurchaseOrder({
    supplierId: 'PTY-009',
    status: 'draft',
    orderedAt: '2026-09-10',
    expectedAt: '2026-09-18',
    lines: [{ id: '', type: 'consumable', refId: 'SG-LFT-001', description: '', qty: 2, unitCost: 2.1 }],
  });
  assert.equal(d.previewPurchaseOrderId().startsWith(`${spare.id.slice(0, 3)}`), true, 'ids come from a sequence');
  assert.equal(d.removePurchaseOrder(spare.id), true);
  assert.equal(d.getPurchaseOrder(spare.id), undefined);
});

check('the new tables are attributed, and a posted receipt is immutable', () => {
  // The seed's own rows (captured before this file edited any of them): a new
  // table is written by the same one writer, so it arrives tenant-stamped and
  // authored, and backfilled by the migration that runs at construction.
  assert.equal(seededPos.length, 3);
  for (const po of seededPos) {
    assert.equal(po.tenantId, 'TNT-NORTHLINE', `${po.id} is tenant-scoped`);
    assert.match(po.createdBy, /^USR-\d+$/, `${po.id} has an author`);
    assert.equal(po.updatedBy, po.createdBy, 'seeded rows were not edited after the fact');
    assert.equal(po.createdAt, po.updatedAt);
  }
  for (const r of d.listReceipts()) {
    assert.equal(r.tenantId, 'TNT-NORTHLINE', `${r.id} is tenant-scoped`);
    assert.match(r.createdBy, /^USR-\d+$/, `${r.id} has an author`);
  }
  // A receipt moved quantities and placed rows: there is no edit and no delete,
  // exactly as the ledger has none.
  assert.equal(typeof d.updateReceipt, 'undefined');
  assert.equal(typeof d.removeReceipt, 'undefined');
});

check('line ids are the store\'s, and a PO keeps them across an edit', () => {
  const po = poOf('PO-2026-001');
  assert.deepEqual(
    po.lines.map((l) => l.id),
    ['PO-2026-001-1', 'PO-2026-001-2'],
  );
  d.updatePurchaseOrder(po.id, {
    lines: [...po.lines, { id: '', type: 'consumable', refId: 'SG-LFT-001', description: '', qty: 3, unitCost: 2.05 }],
  });
  const after = d.getPurchaseOrder(po.id);
  assert.equal(after.lines.length, 3);
  assert.deepEqual(
    after.lines.map((l) => l.id),
    ['PO-2026-001-1', 'PO-2026-001-2', 'PO-2026-001-3'],
    'a new line gets a fresh id and the old ones keep theirs',
  );
  assert.equal(after.lines[2].description, 'Lifting Gloves (pair)', 'the catalog name filled the blank');
});

check('a reload restores the posted receipts instead of posting them again', () => {
  // Same hand-rolled localStorage: this is the app being opened a second time.
  const reloaded = new DataService();
  assert.equal(reloaded.reseeded, false, 'the same schema — no reseed banner');
  assert.equal(reloaded.listReceipts().length, d.listReceipts().length, 'receipts came from the snapshot');
  assert.equal(reloaded.listMovements().length, d.listMovements().length, 'and so did the ledger');
  assert.equal(
    reloaded.listItems('serialized').filter((i) => i.name === 'CAT 259D3 Compact Track Loader').length,
    2,
    'the delivered units were not created a second time',
  );
  assert.equal(
    reloaded.getItem('part', 'PRT-005').qtyOnHand,
    d.getItem('part', 'PRT-005').qtyOnHand,
    'and stock was not landed twice',
  );
  // The persisted snapshot carries the stamps the writer put on it, so a
  // restart does not lose tenant/author attribution.
  const snap = JSON.parse(mem.get('ims-web.store'));
  assert.equal(snap.receipts.length, d.listReceipts().length);
  for (const r of snap.receipts) assert.match(r.createdBy, /^USR-\d+$/, `${r.id} kept its author`);
  for (const po of snap.purchaseOrders) assert.equal(po.tenantId, 'TNT-NORTHLINE', `${po.id} kept its tenant`);
  // The rows written after the seed (the receipts posted in this file) are
  // attributed to whoever was acting, not to the fixture.
  const later = snap.receipts.find((r) => r.id !== 'RC-2026-001' && r.id !== 'RC-2026-002');
  assert.equal(later.createdBy, 'USR-003', 'a receipt posted in-session is attributed to the session user');
});

check('a supplier created in-session is a party row with the supplier role', () => {
  const rec = d.createParty({
    name: 'Test Rigging Supply',
    contact: 'A. Tester',
    phone: '',
    email: '',
    billingAddress: '',
    billingCycle: 'net-30',
    notes: '',
    kinds: ['supplier'],
    active: false,
  });
  assert.equal(rec.id.startsWith('PTY-'), true, 'the store assigns the partner id');
  assert.equal(rec.kinds.includes('supplier'), true);
  assert.equal(rec.active, false, 'the editor\'s Inactive switch is honoured, not overridden');
  assert.equal(d.supplierParties().some((p) => p.id === rec.id), true);
  assert.equal(d.customerParties().some((p) => p.id === rec.id), false, 'and it is not offered to orders');
  assert.equal(rec.createdBy, 'USR-003', 'attributed to the acting user');
  d.removeParty(rec.id);
  assert.equal(d.supplierParties().some((p) => p.id === rec.id), false, 'and it can go again');
});

console.log(`\n${n} checks, ${process.exitCode ? 'FAILURES' : 'all green'}`);
