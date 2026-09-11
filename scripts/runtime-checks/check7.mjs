import assert from 'node:assert/strict';

import { persisted, refuses } from './command-result.mjs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

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

/* ============ A6: one SKU, many places (stock_levels) ============
 *
 * A3 gave an item a *place* (one FK). Real stores put the same part in two bins,
 * with a count in each, and that is a table rather than a column: `stock_levels`
 * (one row per item + place, only while it holds something). These checks keep
 * the two halves of that honest:
 *
 * - the levels are the **truth**: a counted row's `qtyOnHand` is their sum and its
 *   `locationId` is their busiest holding, and nothing can write either by hand;
 * - every path that moves stock pays the same two writers (`writeLevel` +
 *   `syncStockTotals`): a receipt landing it, a move taking part of a place away,
 *   a count correcting one place, a new row's opening balance.
 *
 * A unit (serialized, kit, attachment) is the other half of the rule — one thing,
 * one place — so its FK *is* its placement and a move is all-or-nothing.
 */

const COUNTED = ['bulk', 'consumable', 'part'];
const isCounted = (t) => COUNTED.includes(t);

mem.clear();
const d = new DataService();
const sumLevels = (type, id) =>
  d.listStockLevels(id).filter((l) => l.type === type).reduce((s, l) => s + l.qty, 0);

check('the fixture places every counted quantity, and only while it holds stock', () => {
  const levels = d.listStockLevels();
  assert.ok(levels.length > 0, 'the workspace starts with shelves, not just counts');
  for (const l of levels) {
    assert.ok(l.qty > 0, `${l.id} holds something`);
    assert.equal(l.id, `${l.refId}@${l.locationId}`, 'the composite key is written out');
    assert.ok(d.getLocation(l.locationId), `${l.refId} sits at a real place`);
    assert.ok(d.getItem(l.type, l.refId), 'and its item exists');
    assert.equal(isCounted(l.type), true, 'only counted stock is held in levels');
  }
  // Every counted row's total is its shelves, summed — the invariant the whole
  // increment turns on, checked row by row across the fixture.
  for (const type of COUNTED) {
    for (const row of d.listItems(type)) {
      assert.equal(row.qtyOnHand ?? row.qty, sumLevels(type, row.id), `${row.id}: qtyOnHand is its levels' sum`);
    }
  }
  // No unit is in the table: a machine is a thing, not a quantity.
  assert.equal(levels.some((l) => !isCounted(l.type)), false, 'no units or kits among the levels');
});

check('the fixture keeps one part in two bins, and its total is both bins', () => {
  const part = d.getItem('part', 'PRT-001'); // 24 @ LOC-14 + 6 @ LOC-15
  assert.deepEqual(
    d.placements(part).map((p) => [p.locationId, p.qty]),
    [['LOC-14', 24], ['LOC-15', 6]],
    'two places, biggest holding first',
  );
  assert.equal(part.qtyOnHand, 30, '30 in all — the sum, not either bin');
  assert.equal(part.qty, 30, 'and `qty` mirrors it');
  assert.equal(part.locationId, 'LOC-14', 'the row homes at the place holding the most');
  assert.equal(d.stockTotal(part), 30);
  assert.equal(d.stockAt(part, 'LOC-15'), 6);
  assert.equal(d.stockAt(part, 'LOC-17'), 0, 'a place with none of it reads zero, not missing');
});

check('placements() answers for a unit row too, and for labour not at all', () => {
  const unit = d.getItem('kit', 'KT-001'); // a kit: one place, one count
  assert.deepEqual(d.placements(unit), [{ locationId: unit.locationId, qty: unit.qty }], 'its FK *is* its placement');
  assert.equal(d.stockAt(unit, unit.locationId), unit.qty);
  assert.deepEqual(d.placements(d.getItem('labor', 'EMP-001')), [], 'a person is not stock in a place');
});

check('a move takes a quantity out of one place and leaves the rest', () => {
  const part = d.getItem('part', 'PRT-001');
  const ledger = d.listMovements().length;
  const rec = persisted(d.moveStock('part', 'PRT-001', 'LOC-14', 'LOC-19', 20, 'picked for CT-2024-001'));
  assert.equal(rec.kind, 'transfer');
  assert.equal(rec.qty, 20, 'the quantity it moved, not the whole row');
  assert.equal(rec.locationId, 'LOC-19', 'logged at the destination');
  assert.equal(d.stockAt(part, 'LOC-14'), 4, 'the source keeps what it did not send');
  assert.equal(d.stockAt(part, 'LOC-19'), 20, 'the destination gains it');
  assert.equal(d.stockAt(part, 'LOC-15'), 6, 'and the bin nobody touched is untouched');
  assert.equal(part.qtyOnHand, 30, 'the total is unchanged — a move is not a count');
  assert.equal(part.locationId, 'LOC-19', 'but the home follows the biggest holding');
  assert.equal(d.listMovements().length, ledger + 1, 'one movement, not three');

  // Emptying a place *removes* its row: a level exists only while it holds stock.
  persisted(d.moveStock('part', 'PRT-001', 'LOC-14', 'LOC-15', 4));
  assert.equal(d.listStockLevels('PRT-001', 'LOC-14').length, 0, 'the emptied bin left the table');
  assert.equal(d.stockAt(part, 'LOC-15'), 10);
  assert.equal(part.qtyOnHand, 30);
});

check('a move into a place that already holds the row adds to it', () => {
  const part = d.getItem('part', 'PRT-003'); // 30 @ LOC-16
  persisted(d.moveStock('part', 'PRT-003', 'LOC-16', 'LOC-17', 30));
  persisted(d.moveStock('part', 'PRT-003', 'LOC-17', 'LOC-16', 12)); // and back again
  assert.equal(d.stockAt(part, 'LOC-16'), 12);
  assert.equal(d.stockAt(part, 'LOC-17'), 18);
  assert.equal(d.listStockLevels('PRT-003').length, 2, 'two places, not two rows for one place');
  assert.equal(part.qtyOnHand, 30, 'nothing was created or lost');
});

check('a receipt lands as a level: a second place for the same SKU', () => {
  // A delivery into a bin the SKU does not sit in yet *adds a place* — the same
  // part, two bins, which is the fact a single FK could not hold.
  const hose = d.getItem('part', 'PRT-005'); // 12 @ LOC-19 from the seed, +4 received
  assert.deepEqual(d.placements(hose), [{ locationId: 'LOC-19', qty: 16 }], 'one place so far');
  const po = d.listPurchaseOrders().find((p) => p.status === 'ordered' && p.lines.some((l) => l.type === 'part'));
  const line = po.lines.find((l) => l.type === 'part' && l.refId);
  const before = d.listStockLevels(line.refId).length;
  const rec = persisted(d.receiveAgainst({ poId: po.id, locationId: 'LOC-12', qty: { [line.id]: 1 } }));
  const row = d.getItem(line.type, line.refId);
  assert.equal(d.listStockLevels(row.id).length > before, true, 'the delivery added a place');
  assert.equal(d.stockAt(row, 'LOC-12') > 0, true, 'and the new place holds what landed');
  assert.equal(row.qtyOnHand, sumLevels(row.type, row.id), 'the total is still its shelves');
  assert.deepEqual(d.placements(hose), [{ locationId: 'LOC-19', qty: 16 }], 'untouched by an unrelated line');
  assert.equal(d.listStockLevels(hose.id).length, 1, 'the composite key is the same key');
});

check('the place readers join the shelves, not the row', () => {
  // A row split across two bins is *here* in both — the question a location-scoped
  // grid asks — and the token units (not rows) are what a stock count needs.
  const part = d.getItem('part', 'PRT-001'); // 10 @ LOC-15 + 20 @ LOC-19 by now
  assert.equal(d.itemsAtLocation('LOC-15').some((i) => i.id === 'PRT-001'), true);
  assert.equal(d.itemsAtLocation('LOC-15', true).some((i) => i.id === 'PRT-001'), true);
  assert.equal(d.stockAt(part, 'LOC-15') > 0, true);
  // The bay's *units* are its level rows, summed — PRT-001's share plus whatever
  // else is shelved here (PRT-002), which is why the reader sums levels and not
  // rows: one row can hold hundreds of units and a bay can hold several rows.
  const inBay = d.listStockLevels(undefined, 'LOC-15').reduce((s, l) => s + l.qty, 0);
  assert.equal(d.locationStockQty('LOC-15'), inBay, 'the bay holds its levels, summed');
  assert.equal(inBay > d.stockAt(part, 'LOC-15'), true, 'and more than this one row\'s share');
  assert.equal(
    d.locationStockQty('LOC-05', true) >= d.locationStockQty('LOC-05'),
    true,
    'a subtree holds at least what its node does',
  );
  assert.equal(d.locationStockQty('LOC-04'), 0, 'an empty zone holds nothing');
  assert.equal(d.itemsAtLocation('LOC-04').length, 0);
});

check('a place holding only counted stock cannot be removed until it is emptied', () => {
  // LOC-21 holds PRT-006's level row (8 units) and has no history yet: the stock
  // points at it, so the guard blocks the removal.
  refuses(d.removeLocation('LOC-21'), 'in-use'); // the level row is stock: the bin holds units
  // Moving it out logs the movement at the *destination*, so this bin ends up
  // empty with nothing at all pointing at it — and then it can go.
  const part = d.getItem('part', 'PRT-006'); // 8 @ LOC-21
  persisted(d.moveStock('part', 'PRT-006', 'LOC-21', 'LOC-19', 8, 'rack consolidated'));
  assert.equal(d.listStockLevels(undefined, 'LOC-21').length, 0, 'the emptied bin left the table');
  assert.equal(part.qtyOnHand, 8, 'the units are elsewhere, not gone');
  persisted(d.removeLocation('LOC-21'));
});

check('emptying a place by counting it leaves history that still blocks it', () => {
  // The other way to clear a shelf is a *count*, and a count logs a movement at
  // the place it was taken — so the shelf is clear while the ledger is not, and
  // the second blocker is what stops the removal (history is append-only).
  const bin = d.createLocation({ name: 'Test Bin Z', type: 'Bin', parentId: 'LOC-05', address: '', phone: '', tz: 'America/New_York' });
  const rec = d.createItem('part', {
    name: 'Test Shim Pack',
    category: d.categoriesFor('part')[0],
    status: 'In Stock',
    qty: 6,
    qtyOnHand: 6,
    rateDaily: 0,
    locationId: bin.id,
  });
  refuses(d.removeLocation(bin.id), 'in-use'); // the stock blocks it
  persisted(d.adjustStock('part', rec.id, bin.id, 0, 'bin emptied'));
  assert.deepEqual(d.placements(rec), [], 'the shelf is clear');
  refuses(d.removeLocation(bin.id), 'in-use'); // the ledger still mentions the place
  assert.deepEqual(d.locationRemovalBlockers(bin.id), ['1 movement(s) logged here']);
});


check('a counted row ignores an edit, a unit row obeys one', () => {
  const part = d.getItem('part', 'PRT-002'); // 18 @ LOC-15
  const stamp = part.updatedAt;
  d.updateItem('part', 'PRT-002', { locationId: 'LOC-03', qtyOnHand: 99, qty: 99 });
  assert.equal(part.locationId, 'LOC-15', 'the place did not move');
  assert.equal(part.qtyOnHand, 18, 'the count did not change');
  assert.equal(part.updatedAt, stamp, 'and nothing was written at all');
  // The fields the editor *may* set still land (attribution and all).
  d.updateItem('part', 'PRT-002', { reorderPoint: 7 });
  assert.equal(part.reorderPoint, 7);
  assert.notEqual(part.updatedAt, stamp, 'a real edit is stamped');
  // A unit row's place is its own FK, so the editor still moves it there.
  const kit = d.getItem('kit', 'KT-001');
  d.updateItem('kit', 'KT-001', { locationId: 'LOC-12' });
  assert.equal(kit.locationId, 'LOC-12');
});

check('a new counted row opens with a balance at its opening place', () => {
  const ledger = d.listMovements().length;
  const rec = d.createItem('part', {
    name: 'Test Bearing Set',
    category: d.categoriesFor('part')[0],
    status: 'In Stock',
    qty: 40,
    qtyOnHand: 40,
    rateDaily: 0,
    reorderPoint: 5,
    costPrice: 12,
    retailPrice: 0,
    locationId: 'LOC-17',
  });
  assert.equal(d.listStockLevels(rec.id).length, 1, 'one opening place');
  assert.deepEqual(d.placements(rec), [{ locationId: 'LOC-17', qty: 40 }]);
  assert.equal(rec.qtyOnHand, 40, 'and the total is that place');
  assert.equal(rec.locationId, 'LOC-17');
  assert.equal(d.listMovements().length, ledger, 'an opening balance is not an event — no movement');
  // With no place, or a zero count, the row simply holds nothing yet.
  const bare = d.createItem('part', {
    name: 'Test Unplaced Part',
    category: d.categoriesFor('part')[0],
    status: 'In Stock',
    qty: 0,
    qtyOnHand: 0,
    rateDaily: 0,
  });
  assert.deepEqual(d.placements(bare), []);
  assert.equal(bare.qtyOnHand, 0);
});

check('removing a row takes its levels with it (nothing is left holding a shelf)', () => {
  const rec = d.listItems('part').find((i) => i.name === 'Test Bearing Set');
  assert.equal(d.listStockLevels(rec.id).length, 1);
  d.removeItem('part', rec.id);
  assert.equal(d.listStockLevels(rec.id).length, 0, 'the FK cascaded');
  assert.equal(d.getItem('part', rec.id), undefined);
});

check('the shelf and its totals survive a reload', () => {
  const before = d.listStockLevels().map((l) => `${l.id}:${l.qty}`).sort();
  const totals = COUNTED.flatMap((t) => d.listItems(t).map((i) => [i.id, i.qtyOnHand ?? i.qty]));
  const again = new DataService(); // same storage, new store: hydrate()
  assert.deepEqual(again.listStockLevels().map((l) => `${l.id}:${l.qty}`).sort(), before, 'the levels came back');
  for (const [id, qty] of totals) {
    const type = COUNTED.find((t) => again.getItem(t, id));
    assert.equal(again.getItem(type, id).qtyOnHand ?? again.getItem(type, id).qty, qty, `${id} kept its total`);
  }
});

check('a stock report reads the table directly', () => {
  const inBin = d.listStockLevels(undefined, 'LOC-15');
  assert.equal(inBin.length > 0, true, 'what is in this bay?');
  for (const l of inBin) assert.equal(l.locationId, 'LOC-15');
  const row = d.listStockLevels('PRT-001');
  assert.equal(row.length >= 1, true, 'where is this part?');
  for (const l of row) assert.equal(l.refId, 'PRT-001');
});

console.log(`\ncheck7: ${n} checks`);

