import assert from 'node:assert/strict';

/* ============ B4: kits and attachments are level-tracked ============
 *
 * Until B4 only counted stock (bulk / consumable / part) held `stock_levels`; a
 * kit or attachment with a quantity above one was one place and one number. This
 * extends the level model to them, so "an asset with more than one on hand can be
 * in more than one place" is true of every quantity row, not just stock.
 *
 * What these checks hold to account:
 *  - every level-tracked row reads its quantity from its levels (the A6 invariant,
 *    now across five types);
 *  - a kit moves *part* of itself between places, like counted stock;
 *  - a count corrects one place of a kit, and a field patch cannot move its stock;
 *  - a receipt lands a kit as a level, and return-to-vendor draws it back down.
 */

/* ---- a localStorage stand-in (the store persists to it) ---- */
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

mem.clear();
const d = new DataService();
const LEVEL_TRACKED = ['bulk', 'consumable', 'part', 'kit', 'attachment'];

check('every level-tracked row reads its quantity from its levels', () => {
  for (const type of LEVEL_TRACKED) {
    for (const row of d.listItems(type)) {
      const sum = d.placements(row).reduce((s, p) => s + p.qty, 0);
      assert.equal(d.stockTotal(row), sum, `${row.id}: its total is its levels`);
      assert.equal(row.qty ?? 0, sum, `${row.id}: qty mirrors the levels`);
    }
  }
  assert.ok(d.listStockLevels().some((l) => l.type === 'kit'), 'kits hold levels (B4)');
  assert.equal(d.listStockLevels().some((l) => l.type === 'serialized'), false, 'a machine does not');
  assert.equal(d.listStockLevels().some((l) => l.type === 'labor'), false, 'and neither does a person');
});

check('a kit moves part of itself to another place, like counted stock', () => {
  const kit = d.createItem('kit', {
    name: 'Test Kit', category: 'Kits', status: 'Available', qty: 10, rateDaily: 0, locationId: 'LOC-16', active: true,
  });
  assert.equal(d.stockTotal(kit), 10, 'the opening balance is a level');
  const rec = d.moveStock('kit', kit.id, 'LOC-16', 'LOC-17', 4);
  assert.ok(rec, 'a partial move of a kit is legal now');
  assert.equal(rec.kind, 'transfer');
  assert.equal(d.stockAt(kit, 'LOC-16'), 6, 'the source keeps the rest');
  assert.equal(d.stockAt(kit, 'LOC-17'), 4, 'the destination gains it');
  assert.equal(d.stockTotal(kit), 10, 'the total did not move');
});

check("a count corrects one place of a kit, and a patch cannot move its stock", () => {
  const kit = d.createItem('kit', {
    name: 'Count Kit', category: 'Kits', status: 'Available', qty: 5, rateDaily: 0, locationId: 'LOC-16', active: true,
  });
  const rec = d.adjustStock('kit', kit.id, 'LOC-16', 7, 'found two more');
  assert.ok(rec, 'a kit is countable at a place');
  assert.equal(rec.kind, 'adjust');
  assert.equal(d.stockAt(kit, 'LOC-16'), 7);
  d.updateItem('kit', kit.id, { qty: 999, locationId: 'LOC-01' });
  assert.equal(d.getItem('kit', kit.id).qty, 7, 'a patch is stripped: stock moves by movement');
  assert.equal(d.getItem('kit', kit.id).locationId, 'LOC-16', 'and so is its place');
});

check('a receipt lands a kit as a level, and return-to-vendor draws it back down', () => {
  const kit = d.createItem('kit', {
    name: 'Receipt Kit', category: 'Kits', status: 'Available', qty: 0, rateDaily: 0, costPrice: 10, locationId: 'LOC-16', active: true,
  });
  const supplier = d.supplierParties()[0];
  const po = d.createPurchaseOrder({
    supplierId: supplier.id,
    status: 'ordered',
    orderedAt: '2026-09-01',
    expectedAt: '2026-09-05',
    lines: [{ id: '', type: 'kit', refId: kit.id, description: kit.name, qty: 3, unitCost: 12 }],
  });
  const line = po.lines[0];
  const rec = d.receiveAgainst({ poId: po.id, locationId: 'LOC-16', qty: { [line.id]: 3 } });
  assert.ok(rec, 'the kit receipt posts');
  assert.equal(d.stockTotal(kit), 3, 'the kit is topped up');
  assert.equal(d.stockAt(kit, 'LOC-16'), 3, 'and lands where it was put away');
  assert.equal(rec.lines[0].locationId, 'LOC-16', 'the receipt line names the place');

  const mv = d.returnToVendor('kit', kit.id, 'LOC-16', 2, 'wrong kit');
  assert.ok(mv, 'a kit can be returned to vendor now');
  assert.equal(mv.kind, 'return-to-vendor');
  assert.equal(mv.qty, -2);
  assert.equal(d.stockAt(kit, 'LOC-16'), 1, 'and the shelf drops');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck15: ${n} checks`);
