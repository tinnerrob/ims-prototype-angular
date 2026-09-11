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

/* ==================== A4: the ledger's place is an FK ==================== */

mem.clear();
const d = new DataService();

check('no movement stores a display string — every place is a resolvable FK', () => {
  const moves = d.listMovements();
  // Five custody issues (A4) + the four rows the A5 receipts landed.
  assert.equal(moves.length, 9, 'seeded ledger rows');
  for (const m of moves) {
    assert.equal(m.location, undefined, `${m.id} no longer carries free text`);
    assert.equal(typeof m.locationId, 'string', `${m.id} has a location FK`);
    assert.ok(d.getLocation(m.locationId), `${m.id} -> ${m.locationId} resolves`);
  }
});

check('a seeded movement is logged where its own unit sits', () => {
  // The seed derives the place from the unit's placement rather than repeating a
  // label, so the shelf and the ledger agree from the first record.
  for (const m of d.listMovements()) {
    const item = d.getItem(m.type, m.refId);
    assert.ok(item, `${m.refId} (${m.type}) exists`);
    assert.equal(m.locationId, item.locationId, `${m.id} left from where ${m.refId} sits`);
  }
});

check("the ledger's place reads back as a path, built at read time", () => {
  const issue = d.listMovements().find((m) => m.refId === 'BL-119' && m.kind === 'issue');
  assert.equal(
    d.locationPath(issue.locationId),
    'Atlanta Main Campus › Main Yard › Yard A — Equipment Staging',
    'yard path through the hierarchy',
  );
  const arrived = d.listMovements().find((m) => m.kind === 'receive' && m.locationId === 'LOC-03');
  assert.equal(
    d.locationPath(arrived.locationId),
    'Atlanta Main Campus › Main Yard › Yard A — Equipment Staging',
    'and the receiving side reads back the same way',
  );
  const restock = d.listMovements().find((m) => m.kind === 'receive' && m.locationId === 'LOC-19');
  assert.equal(
    d.locationPath(restock.locationId),
    'Atlanta Main Campus › Warehouse 1 › Aisle 3 › Bay C-04',
    'a receipt into a bin reads back to the shelf it stocked',
  );
  assert.equal(d.locationPath(undefined), '—', 'an unplaced movement reads as a dash');
});

check('movementsAtLocation answers per node, and per subtree by default', () => {
  const atYard = d.movementsAtLocation('LOC-03');
  // Five issues left from the staging zone; the A5 receipt landed three rows there.
  assert.equal(atYard.length, 8, 'logged at the staging zone itself');
  assert.ok(atYard.every((m) => m.locationId === 'LOC-03'));
  // "What left Yard A this month?" means the whole yard, not the node row: the
  // zone sits under LOC-02, which holds none of the rows directly.
  assert.equal(d.locationMovementCount('LOC-02'), 0, 'nothing is logged at the yard node');
  assert.equal(d.movementsAtLocation('LOC-02').length, 8, 'its subtree has them');
  assert.equal(d.movementsAtLocation('LOC-02', false).length, 0, 'unless the caller asks narrowly');
  assert.equal(d.movementsAtLocation('LOC-10').length, 0, 'an unrelated site has no history');
  assert.equal(d.locationSubtreeMovementCount('LOC-01'), 9, 'the campus totals its yard and warehouse');
});

check('an issue is logged where the unit sits, without the caller saying so', () => {
  const rec = d.logMovement({
    type: 'serialized',
    refId: 'BL-118',
    kind: 'issue',
    qty: 1,
    orderId: 'CT-2024-001',
    party: 'M. Halstead',
  });
  assert.equal(rec.locationId, 'LOC-03', 'resolved from the unit, not from a default');
  assert.equal(rec.locationId, d.getItem('serialized', 'BL-118').locationId);
  assert.equal(rec.byUserId, 'USR-003', 'attributed to the acting user');
  assert.equal(rec.tenantId, 'TNT-NORTHLINE', 'and tenant-stamped by the one writer');
  assert.equal(d.isOut('BL-118'), true, 'the unit is out');
});

check('a return re-homes the unit, and the ledger records the new place', () => {
  const rec = d.logMovement({
    type: 'serialized',
    refId: 'BL-118',
    kind: 'return',
    qty: 1,
    party: 'M. Halstead',
    locationId: 'LOC-05', // back to the shop's own building, not the yard
  });
  assert.equal(rec.locationId, 'LOC-05', 'the chosen destination is what is logged');
  assert.equal(d.getItem('serialized', 'BL-118').locationId, 'LOC-05', 'and the unit is re-placed');
  assert.equal(d.isOut('BL-118'), false, 'it is available again');
  assert.equal(
    d.locationPath(d.getItem('serialized', 'BL-118').locationId),
    'Atlanta Main Campus › Warehouse 1',
  );
});

check('history never follows the unit — the earlier issue keeps its place', () => {
  const issue = d.listMovements().find((m) => m.refId === 'BL-118' && m.kind === 'issue');
  assert.equal(issue.locationId, 'LOC-03', 'the issue still says it left the yard');
  assert.equal(d.getItem('serialized', 'BL-118').locationId, 'LOC-05', 'while the unit is in the shop');
});

check('a caller-chosen place is kept, but only a return re-places the unit', () => {
  const rec = d.logMovement({
    type: 'part',
    refId: 'PRT-001',
    kind: 'adjust',
    qty: -1,
    locationId: 'LOC-08',
    note: 'Count correction at Bay A1-02.',
  });
  assert.equal(rec.locationId, 'LOC-08', 'an adjustment can happen elsewhere');
  assert.equal(d.getItem('part', 'PRT-001').locationId, 'LOC-14', 'which does not move the shelf');
  assert.equal(d.movementsAtLocation('LOC-08').length, 1, 'and the ledger counts it there');
});

check('a place the ledger mentions cannot be removed (history is append-only)', () => {
  d.createLocation({
    id: 'LOC-22',
    name: 'Dock 5',
    type: 'Dock',
    parentId: 'LOC-10',
    address: '',
    phone: '',
    tz: 'America/New_York',
  });
  d.logMovement({ type: 'part', refId: 'PRT-002', kind: 'transfer', qty: 1, locationId: 'LOC-22' });
  assert.deepEqual(d.locationRemovalBlockers('LOC-22'), ['1 movement(s) logged here']);
  assert.equal(d.removeLocation('LOC-22'), false, 'refused while the log points at it');
  assert.ok(d.getLocation('LOC-22'), 'and it is still there');
});

check('an empty, unreferenced node still removes (the guard is not a blanket refusal)', () => {
  d.createLocation({
    id: 'LOC-23',
    name: 'Dock 6',
    type: 'Dock',
    parentId: 'LOC-10',
    address: '',
    phone: '',
    tz: 'America/New_York',
  });
  assert.deepEqual(d.locationRemovalBlockers('LOC-23'), []);
  assert.equal(d.removeLocation('LOC-23'), true);
  assert.equal(d.getLocation('LOC-23'), undefined);
});

check('both blockers come from the one guard the grid and the button share', () => {
  // LOC-03 is the equipment staging zone: it holds the machines, the bulk stock
  // and the attachments — plus the units the A5 receipts landed there — *and* it
  // is where the seeded issues left from (plus BL-118's own issue above).
  assert.deepEqual(d.locationRemovalBlockers('LOC-03'), [
    '29 item(s) stored here',
    '9 movement(s) logged here',
  ]);
  assert.equal(d.removeLocation('LOC-03'), false);
  assert.equal(d.getItem('serialized', 'BL-119').locationId, 'LOC-03', 'stock stays put');
});

console.log(`\n${n} checks, ${process.exitCode ? 'FAILURES' : 'all green'}`);
