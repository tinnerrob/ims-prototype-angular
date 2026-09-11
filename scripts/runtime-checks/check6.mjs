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
 *   history at all.
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

check('a move re-places the row and logs one transfer at the destination', () => {
  const part = d.getItem('part', 'PRT-004'); // Grease Fitting Kit, shelved at LOC-17
  const from = part.locationId;
  const before = moveCount();
  const rec = d.moveStock('part', 'PRT-004', 'LOC-03', 'kiosk restock for the shop');
  assert.ok(rec, 'the move was logged');
  assert.equal(rec.kind, 'transfer', 'a transfer, not an edit');
  assert.equal(rec.qty, 60, 'the count it moved');
  assert.equal(rec.locationId, 'LOC-03', 'logged at the destination');
  assert.equal(part.locationId, 'LOC-03', 'and the row agrees with the ledger');
  assert.equal(rec.note, 'kiosk restock for the shop');
  assert.equal(moveCount(), before + 1, 'one movement, no more');
  // Newest-first for this row, and readable as a place rather than a string.
  assert.equal(d.movementsFor('part', 'PRT-004')[0].id, rec.id);
  assert.equal(d.movementsAtLocation('LOC-03').some((m) => m.id === rec.id), true);
  assert.equal(d.movementsAtLocation(from, false).some((m) => m.id === rec.id), false, 'not at the old place');
});

check('a move with no note says where the stock came from', () => {
  const kit = d.getItem('kit', 'KT-002'); // shelved at Warehouse 1
  const fromPath = d.locationPath(kit.locationId);
  const rec = d.moveStock('kit', 'KT-002', 'LOC-03');
  assert.ok(rec);
  assert.equal(rec.note, `Moved from ${fromPath}`, 'the old place is the default note');
  assert.equal(kit.locationId, 'LOC-03');
});

check('moving an unplaced row places it, and says so', () => {
/* -------------------------------- adjust -------------------------------- */

check('a physical count corrects the row and logs one signed adjustment', () => {
  const before = onHandOf('part', 'PRT-005');
  const ledger = moveCount();
  const rec = d.adjustStock('part', 'PRT-005', before - 3);
  assert.ok(rec);
  assert.equal(rec.kind, 'adjust');
  assert.equal(rec.qty, -3, 'the difference, signed');
  assert.equal(rec.note, `Count corrected ${before} → ${before - 3}`);
  assert.equal(rec.locationId, d.getItem('part', 'PRT-005').locationId, 'logged where the stock sits');
  assert.equal(onHandOf('part', 'PRT-005'), before - 3);
  assert.equal(d.getItem('part', 'PRT-005').qty, before - 3, 'qty mirrors the count');
  assert.equal(moveCount(), ledger + 1);
});

check('a bulk count keeps owned = available + out', () => {
  const bulk = d.getItem('bulk', 'SCF-040'); // 120 owned, 78 available, 42 out
  const ownedBefore = bulk.totalOwned;
  const capacityBefore = d.capacity(bulk);
  d.adjustStock('bulk', 'SCF-040', 70, 'rack count');
  assert.equal(bulk.qtyAvailable, 70, 'the count is what is on the shelf');
  assert.equal(bulk.totalOwned, 70 + bulk.qtyOut, 'what we own is the shelf plus what is out');
  assert.equal(bulk.qty, 70);
  assert.equal(capacityBefore, ownedBefore, 'capacity was the owned count before');
  assert.equal(d.capacity(bulk), 70 + bulk.qtyOut, 'and still is — a count does not shrink the fleet');
});

check('status follows the count, in both directions', () => {
  const gloves = d.getItem('consumable', 'SG-LFT-001');
  d.adjustStock('consumable', 'SG-LFT-001', gloves.reorderPoint, 'cycle count');
  assert.equal(gloves.status, 'Low', 'at the reorder point is Low');
  assert.equal(gloves.qtyOnHand <= gloves.reorderPoint, true);
  d.adjustStock('consumable', 'SG-LFT-001', gloves.reorderPoint * 4, 'found a full pallet behind the rack');
  assert.equal(gloves.status, 'In Stock', 'back above the point');
});

check('what a move or a count refuses, it refuses without writing', () => {
  const ledger = moveCount();
  const gloves = d.getItem('consumable', 'SG-LFT-001');
  const onHand = onHandOf('consumable', 'SG-LFT-001');
  assert.equal(d.adjustStock('consumable', 'SG-LFT-001', onHand), null, 'a count that matches');
  assert.equal(d.adjustStock('consumable', 'SG-LFT-001', -1), null, 'a negative count');
  assert.equal(d.adjustStock('consumable', 'NOPE-001', 5), null, 'an unknown row');
  assert.equal(d.adjustStock('serialized', 'FL-402', 3), null, 'a unit is not counted, it is a row');
  assert.equal(d.adjustStock('kit', 'KT-001', 2), null, 'nor is a kit (an owned count)');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-03'), null, 'moving it where it already is');
  assert.equal(d.moveStock('part', 'PRT-004', 'LOC-999'), null, 'no such place');
  assert.equal(d.moveStock('part', 'NOPE-001', 'LOC-03'), null, 'no such row');
  assert.equal(d.moveStock('labor', 'EMP-001', 'LOC-03'), null, 'a person is not stock');
  assert.equal(d.moveStock('serialized', 'BL-119', 'LOC-03'), null, 'a unit that is out is not on a shelf');
  assert.equal(onHandOf('consumable', 'SG-LFT-001'), onHand);
  assert.equal(gloves.status, 'In Stock');
  assert.equal(moveCount(), ledger, 'nothing at all was written');
});

  d.updateItem('part', 'PRT-006', { locationId: undefined });
  const rec = d.moveStock('part', 'PRT-006', 'LOC-21');
  assert.ok(rec, 'placing an unplaced row is a move');
  assert.equal(rec.note, 'Placed', 'there is no "from" to name');
  assert.equal(d.getItem('part', 'PRT-006').locationId, 'LOC-21');
});

/* -------------------------- reorder as a document ------------------------ */

let raised = null;
check('a reorder raises a draft document, and moves no stock', () => {
  // Put a row below its point the only honest way there is — a count — then watch
  // what the dashboard's one click does with it.
  const part = d.getItem('part', 'PRT-001');
  d.adjustStock('part', 'PRT-001', part.reorderPoint, 'counted down to the point');
  const row = d.reorders().find((r) => r.ref === 'PRT-001');
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
