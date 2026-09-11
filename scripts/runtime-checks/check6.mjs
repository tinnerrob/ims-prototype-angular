import assert from 'node:assert/strict';

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

/* ============= A5.1: the holes A5 exposed =============
 *
 * A5 gave stock exactly one way in (a receipt posted against an order). Three
 * holes it left open are closed here, and every check states what the fixture
 * must *not* do as well as what it does:
 *
 * - `moveStock` / `adjustStock` are the write paths for the `transfer` and
 *   `adjust` movement kinds, which had none: a row's place and its count had no
 *   history at all. Both are **per place** (A6 gave a counted row several): a
 *   move says what leaves one shelf for another, a count corrects the one it was
 *   taken at.
 * - `raiseReorder` raises a *document*. The prototype's one-click restock set
 *   `qtyOnHand` directly — stock from nowhere — which is the bug the buying spine
 *   exists to prevent.
 * - a sub-rental names a supplier *party*, not a typed vendor name.
 */

mem.clear();
const seed = new DataService();
check('the fixture ledger uses only the kinds the fixture can produce', () => {
  const kinds = new Set(seed.listMovements().map((m) => m.kind));
  for (const k of ['issue', 'receive']) assert.equal(kinds.has(k), true, `seeded ${k}`);
  // No seeded padding: a transfer / adjust in the fixture would be a movement
  // nothing in the fixture did. The checks below are what make them. (A return
  // is the third kind the fixture's own operations can produce, and it happens
  // the moment a unit comes back — check4 drives one.)
  assert.equal(kinds.has('transfer'), false, 'no hand-written transfer');
  assert.equal(kinds.has('adjust'), false, 'no hand-written adjust');
});

mem.clear();
const d = new DataService();
const moveCount = () => d.listMovements().length;
const onHandOf = (type, id) => {
  const it = d.getItem(type, id);
  return it.type === 'bulk' ? it.qtyAvailable ?? it.qty : it.qtyOnHand ?? it.qty;
};

/* ------------------------------- transfer ------------------------------- */

check('a move re-places the stock and logs one transfer at the destination', () => {
  const part = d.getItem('part', 'PRT-004'); // Grease Fitting Kit, 60 shelved at LOC-17
  const from = part.locationId;
  const before = moveCount();
  const rec = d.moveStock('part', 'PRT-004', from, 'LOC-03', 60, 'kiosk restock for the shop');
  assert.ok(rec, 'the move was logged');
  assert.equal(rec.kind, 'transfer', 'a transfer, not an edit');
  assert.equal(rec.qty, 60, 'the count it moved');
  assert.equal(rec.locationId, 'LOC-03', 'logged at the destination');
  assert.equal(part.locationId, 'LOC-03', 'and the row agrees with the ledger');
  assert.equal(d.stockAt(part, 'LOC-03'), 60, 'the destination holds it');
  assert.equal(d.stockAt(part, from), 0, 'and the old place holds none of it');
  assert.equal(
    d.listMovements().some((m) => m.id === rec.id && m.locationId === from),
    false,
    'the source level is gone, not standing at zero',
  );
  assert.equal(rec.note, 'kiosk restock for the shop');
  assert.equal(moveCount(), before + 1, 'one movement, no more');
  // Newest-first for this row, and readable as a place rather than a string.
  assert.equal(d.movementsFor('part', 'PRT-004')[0].id, rec.id);
  assert.equal(d.movementsAtLocation('LOC-03').some((m) => m.id === rec.id), true);
  assert.equal(d.movementsAtLocation(from, false).some((m) => m.id === rec.id), false, 'not at the old place');
});

check('a move with no note says where the stock came from', () => {
  const kit = d.getItem('kit', 'KT-002'); // a unit-held row, shelved at Warehouse 1
  const from = kit.locationId;
  const fromPath = d.locationPath(from);
  const rec = d.moveStock('kit', 'KT-002', from, 'LOC-03', kit.qty);
  assert.ok(rec);
  assert.equal(rec.note, `Moved from ${fromPath}`, 'the old place is the default note');
  assert.equal(kit.locationId, 'LOC-03');
});

check('moving an unplaced row places it, and says so', () => {
  // A unit-held row that sits nowhere can be placed by re-pointing its FK — its
  // `locationId` *is* its placement, so there is nothing to transfer from and no
  // shelf for the ledger to have seen it leave.
  const unit = d.getItem('attachment', 'ACC-005'); // 2 @ Yard A staging
  d.updateItem('attachment', 'ACC-005', { locationId: undefined });
  assert.deepEqual(d.placements(unit), [], 'it holds nothing anywhere');
  assert.equal(d.moveStock('attachment', 'ACC-005', 'LOC-03', 'LOC-01', 2), null, 'nowhere to move it from');
  d.updateItem('attachment', 'ACC-005', { locationId: 'LOC-21' });
  assert.equal(unit.locationId, 'LOC-21', 'the edit places it');
  assert.equal(d.stockAt(unit, 'LOC-21'), 2, 'and the place holds its count');
});

check('stock found where none was recorded is a count, not a transfer', () => {
  // Counted stock arrives on a shelf through a *count*: nothing moved from a place
  // the app knows about, so an `adjust` at that place is the honest movement — a
  // transfer would have to name a source holding stock that was never there.
  const part = d.getItem('part', 'PRT-006'); // 8 @ LOC-21
  d.adjustStock('part', 'PRT-006', 'LOC-21', 0, 'rack emptied');
  assert.deepEqual(d.placements(part), [], 'the row now holds nothing, anywhere');
  assert.equal(d.moveStock('part', 'PRT-006', 'LOC-21', 'LOC-19', 8), null, 'so there is nothing to move');

  const ledger = moveCount();
  const rec = d.adjustStock('part', 'PRT-006', 'LOC-19', 5, 'found behind the hose rack');
  assert.ok(rec, 'the count is what puts stock on a shelf');
  assert.equal(rec.kind, 'adjust');
  assert.equal(rec.qty, 5, 'the whole quantity is the difference from zero');
  assert.equal(rec.locationId, 'LOC-19', 'logged where it was found');
  assert.equal(part.qtyOnHand, 5);
  assert.equal(part.locationId, 'LOC-19', 'and the row now sits there');
  assert.equal(moveCount(), ledger + 1);
});

/* -------------------------------- adjust -------------------------------- */

check('a physical count corrects the place it was taken at, and says so', () => {
  const part = d.getItem('part', 'PRT-005');
  const at = part.locationId; // the bin it is shelved in
  const before = d.stockAt(part, at);
  const ledger = moveCount();
  const rec = d.adjustStock('part', 'PRT-005', at, before - 3);
  assert.ok(rec);
  assert.equal(rec.kind, 'adjust');
  assert.equal(rec.qty, -3, 'the difference, signed');
  assert.equal(rec.note, `Count corrected ${before} → ${before - 3} at ${d.locationPath(at)}`);
  assert.equal(rec.locationId, at, 'logged at the place that was counted');
  assert.equal(d.stockAt(part, at), before - 3);
  assert.equal(onHandOf('part', 'PRT-005'), before - 3, 'the total is its places, summed');
  assert.equal(d.getItem('part', 'PRT-005').qty, before - 3, 'qty mirrors the count');
  assert.equal(moveCount(), ledger + 1);
});

check('counting one place leaves the same stock in another alone', () => {
  // PRT-001 is the fixture's split row: 24 in one bin and 6 in the next, 30 in all.
  const part = d.getItem('part', 'PRT-001');
  assert.deepEqual(
    d.placements(part).map((p) => [p.locationId, p.qty]),
    [['LOC-14', 24], ['LOC-15', 6]],
    'seeded in two places, busiest first',
  );
  assert.equal(part.qtyOnHand, 30, 'and its total is their sum');
  assert.equal(part.locationId, 'LOC-14', 'its home is the busiest place');

  const rec = d.adjustStock('part', 'PRT-001', 'LOC-15', 9, 'cycle count');
  assert.ok(rec);
  assert.equal(rec.qty, 3, 'the *difference at that place* — 6 → 9');
  assert.equal(d.stockAt(part, 'LOC-15'), 9);
  assert.equal(d.stockAt(part, 'LOC-14'), 24, 'the other bin is untouched');
  assert.equal(part.qtyOnHand, 33, 'and the total follows');

  // Counting the other place down past the first re-homes the row: the home is
  // whichever place holds the most, so the FK follows the shelves.
  d.adjustStock('part', 'PRT-001', 'LOC-14', 5, 'down to the last pallet');
  assert.equal(part.locationId, 'LOC-15', 'the busiest place is now the home');
  assert.equal(d.stockAt(part, 'LOC-14'), 5, 'the count landed there');
  assert.equal(d.stockAt(part, 'LOC-15'), 9, 'and the other place kept its stock');
  assert.equal(part.qtyOnHand, 14);
});

check('a bulk count keeps owned = available + out', () => {
  const bulk = d.getItem('bulk', 'SCF-040'); // 120 owned, 78 available, 42 out
  const ownedBefore = bulk.totalOwned;
  const capacityBefore = d.capacity(bulk);
  d.adjustStock('bulk', 'SCF-040', bulk.locationId, 70, 'rack count');
  assert.equal(bulk.qtyAvailable, 70, 'the count is what is on the shelf');
  assert.equal(bulk.totalOwned, 70 + bulk.qtyOut, 'what we own is the shelf plus what is out');
  assert.equal(bulk.qty, 70);
  assert.equal(capacityBefore, ownedBefore, 'capacity was the owned count before');
  assert.equal(d.capacity(bulk), 70 + bulk.qtyOut, 'and still is — a count does not shrink the fleet');
});

check('status follows the count, in both directions', () => {
  const gloves = d.getItem('consumable', 'SG-LFT-001');
  const at = gloves.locationId;
  d.adjustStock('consumable', 'SG-LFT-001', at, gloves.reorderPoint, 'cycle count');
  assert.equal(gloves.status, 'Low', 'at the reorder point is Low');
  assert.equal(gloves.qtyOnHand <= gloves.reorderPoint, true);
  d.adjustStock('consumable', 'SG-LFT-001', at, gloves.reorderPoint * 4, 'found a full pallet behind the rack');
  assert.equal(gloves.status, 'In Stock', 'back above the point');
});

check('what a move or a count refuses, it refuses without writing', () => {
  const ledger = moveCount();
  const gloves = d.getItem('consumable', 'SG-LFT-001');
  const at = gloves.locationId;
  const onHand = d.stockAt(gloves, at);
  assert.equal(d.adjustStock('consumable', 'SG-LFT-001', at, onHand), null, 'a count that matches');
  assert.equal(d.adjustStock('consumable', 'SG-LFT-001', at, -1), null, 'a negative count');
  assert.equal(d.adjustStock('consumable', 'SG-LFT-001', 'LOC-999', 5), null, 'no such place to count');
  assert.equal(d.adjustStock('consumable', 'NOPE-001', at, 5), null, 'an unknown row');
  assert.equal(d.adjustStock('serialized', 'FL-402', at, 3), null, 'a unit is not counted, it is a row');
  assert.equal(d.adjustStock('kit', 'KT-001', at, 2), null, 'nor is a kit (an owned count)');
  const moved = d.getItem('part', 'PRT-004'); // 60 @ LOC-03 since the first check
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-03', 'LOC-03', 60), null, 'moving it where it already is');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-03', 'LOC-999', 60), null, 'no such destination');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-999', 'LOC-03', 60), null, 'no such source');
  assert.equal(d.moveStock('part', 'NOPE-001', 'LOC-03', 'LOC-01', 5), null, 'no such row');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-03', 'LOC-01', 0), null, 'a zero move');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-03', 'LOC-01', 61), null, 'more than the place holds');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-18', 'LOC-01', 1), null, 'from a place holding none of it');
  assert.equal(d.moveStock('kit', 'KT-002', 'LOC-03', 'LOC-01', 2), null, 'half a unit-held row is not a thing');
  assert.equal(d.moveStock('labor', 'EMP-001', 'LOC-03', 'LOC-01', 1), null, 'a person is not stock');
  assert.equal(d.moveStock('serialized', 'BL-119', 'LOC-03', 'LOC-01', 1), null, 'a unit that is out is not on a shelf');
  assert.equal(d.stockAt(gloves, at), onHand);
  assert.equal(gloves.status, 'In Stock');
  assert.equal(d.stockAt(moved, 'LOC-03'), 60, 'and the row it aimed at is where it was');
  assert.equal(moveCount(), ledger, 'nothing at all was written');
});

/* -------------------------- reorder as a document ------------------------ */

let raised = null;
check('a reorder raises a draft document, and moves no stock', () => {
  // Put a row below its point the only honest way there is — a count at its place
  // — then watch what the dashboard's one click does with it.
  const part = d.getItem('part', 'PRT-002');
  d.adjustStock('part', 'PRT-002', part.locationId, part.reorderPoint, 'counted down to the point');
  const row = d.reorders().find((r) => r.ref === 'PRT-002');
  assert.ok(row, 'the row now reads as low (no fixture row was low before)');
  const before = onHandOf(row.type, row.ref);
  const pos = d.listPurchaseOrders().length;
  raised = d.raiseReorder(row.type, row.ref);
  assert.ok(raised, 'the reorder was raised');
  assert.equal(d.listPurchaseOrders().length, pos + 1, 'it is a new row, not a quantity edit');
  assert.equal(raised.status, 'draft', 'a draft for the buyer to finish');
  assert.equal(raised.supplierId, '', 'no supplier is invented for us');
  assert.equal(raised.lines.length, 1);
  assert.equal(raised.lines[0].id, `${raised.id}-1`, 'the store numbered the line');
  assert.equal(raised.lines[0].type, row.type);
  assert.equal(raised.lines[0].refId, row.ref);
  assert.equal(raised.lines[0].qty, Math.max(row.reorderPoint * 2 - before, 1), 'the shortfall to 2x the point');
  assert.equal(raised.lines[0].unitCost, d.getItem(row.type, row.ref).costPrice, 'at the row own cost');
  assert.equal(onHandOf(row.type, row.ref), before, 'THE POINT: on-hand did not move');
  assert.equal(d.poLineReceived(raised.lines[0].id), 0, 'and nothing has arrived');
  assert.equal(d.reorders().some((r) => r.ref === row.ref), true, 'so the row is still low');
  assert.equal(d.raiseReorder('consumable', 'NOPE-001'), null, 'an unknown row raises nothing');
});

check('a draft buys nothing — a supplier and a receipt land the stock', () => {
  const line = raised.lines[0];
  const place = d.getItem(line.type, line.refId).locationId;
  const before = onHandOf(line.type, line.refId);
  assert.equal(
    d.receiveAgainst({ poId: raised.id, locationId: place, qty: { [line.id]: 1 } }),
    null,
    'a draft is not receivable',
  );
  const supplier = d.supplierParties()[0];
  assert.equal(d.updatePurchaseOrder(raised.id, { supplierId: supplier.id, status: 'ordered' }), true);
  const receipt = d.receiveAgainst({ poId: raised.id, locationId: place, qty: { [line.id]: line.qty } });
  assert.ok(receipt, 'the ordered stock arrives');
  assert.equal(receipt.supplierId, supplier.id, 'against the supplier the buyer chose');
  assert.equal(onHandOf(line.type, line.refId), before + line.qty, 'and only the receipt moved it');
  const logged = d.listMovements().filter((m) => m.receiptId === receipt.id);
  assert.equal(logged.length, 1, 'one landed row, one movement — the SKU was topped up');
  assert.equal(logged[0].kind, 'receive');
  assert.equal(logged[0].qty, line.qty);
  assert.equal(d.poProgress(d.getPurchaseOrder(raised.id)), 'received', 'its only line is complete');
});



/* --------------------------- sub-rental vendors -------------------------- */

check('every sub-rental names a supplier party, not a typed vendor', () => {
  const rentals = d.listRentals();
  assert.equal(rentals.length, 3, 'the fixture sub-rentals');
  for (const r of rentals) {
    assert.equal('vendor' in r, false, `${r.id} carries no free-text vendor`);
    const p = d.getParty(r.supplierId);
    assert.ok(p, `${r.id} points at a real partner`);
    assert.equal(p.kinds.includes('supplier'), true, 'and one we can buy from');
    assert.equal(d.rentalSupplier(r), p.name);
  }
  assert.equal(d.rentalSupplier(rentals[0]), 'PowerGen Rentals', 'the old names are rows now');
  assert.equal(d.rentalSupplier(rentals[2]), 'Meridian Tools Supply');
  assert.deepEqual(d.rentalsFromSupplier('PTY-011').map((r) => r.id), ['RR-002'], 'the FK is queryable');
  assert.equal(d.partyKindLabel(d.getParty('PTY-010')), 'Supplier');
});

check('a sub-rental with no partner is refused outright', () => {
  const before = d.listRentals().length;
  const base = { itemId: null, assetName: 'Test Roller 3T', orderId: null, vendorCost: 100, retailRate: 210, qty: 1 };
  assert.equal(d.createRental({ ...base, supplierId: '' }), null, 'no vendor');
  assert.equal(d.createRental({ ...base, supplierId: 'PTY-999' }), null, 'an unknown vendor');
  assert.equal(d.listRentals().length, before, 'nothing was written');
  const rec = d.createRental({ ...base, supplierId: 'PTY-012' });
  assert.ok(rec, 'a real vendor is accepted');
  assert.equal(d.listRentals().length, before + 1);
  assert.equal(d.rentalsFromSupplier('PTY-012').some((r) => r.id === rec.id), true);
  assert.equal(d.rentalSpread(rec), 110, '(210 - 100) x 1');
});

console.log(`\ncheck6: ${n} checks`);
