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

/* ====================== A3: the item ↔ location spine ====================== */

mem.clear();
const d = new DataService();

check('the seeded hierarchy is deeper than one level (a real tree)', () => {
  const locs = d.listLocations();
  assert.equal(locs.length, 21, 'seeded nodes');
  // LOC-07 (Bay A1-01) -> LOC-06 (Aisle 1) -> LOC-05 (Warehouse 1) -> LOC-01
  assert.ok(locs.every((l) => typeof l.parentId === 'string' || l.parentId === null), 'parentId typed');
  assert.equal(d.locationChildren(null).length, 2, 'two top-level sites');
  assert.equal(d.locationChildren('LOC-06').length, 4, 'Aisle 1 hosts four bins');
});

check('a location path is built at read time from the parent links', () => {
  assert.equal(d.locationPath('LOC-07'), 'Atlanta Main Campus › Warehouse 1 › Aisle 1 › Bay A1-01');
  assert.equal(d.locationPath('LOC-01'), 'Atlanta Main Campus');
  assert.equal(d.locationPath(null), '—', 'no location reads as a dash');
  assert.equal(d.locationPath('LOC-99'), 'LOC-99', 'a dangling FK still renders');
});

check('a location label is the node name, and only the name', () => {
  assert.equal(d.locationLabel('LOC-07'), 'Bay A1-01');
  assert.equal(d.locationLabel(''), '—');
});

check('the tree walker returns indented, depth-first options', () => {
  const opts = d.locationOptions();
  assert.equal(opts.length, 21);
  assert.equal(opts[0].id, 'LOC-01', 'top level first');
  const bay = opts.find((o) => o.id === 'LOC-07');
  assert.equal(bay.label, '— — — Bay A1-01 (LOC-07)', 'indented by depth');
  assert.deepEqual(opts.map((o) => o.id).slice(0, 3), ['LOC-01', 'LOC-02', 'LOC-03']);
});

check('the walker prunes a node and its whole subtree (cycle guard)', () => {
  const opts = d.locationOptions('LOC-06');
  assert.equal(opts.some((o) => o.id === 'LOC-06'), false, 'the node itself');
  assert.equal(opts.some((o) => o.id === 'LOC-14'), false, 'its descendant');
  assert.equal(opts.some((o) => o.id === 'LOC-09'), true, 'its sibling rack stays');
});

check('every stock row is placed, and so is every crew member', () => {
  let basedPeople = 0;
  for (const i of d.allItems()) {
    // Since Phase C a person carries a place too — their home base — set from the
    // department they work in. (Stock rows are all placed; a *new* row may be
    // created "— Not placed —", which is the editor's choice, not the fixture's.)
    assert.equal(typeof i.locationId, 'string', `${i.id} has a location FK`);
    assert.ok(d.getLocation(i.locationId), `${i.id} -> ${i.locationId} resolves`);
    if (i.type === 'labor') {
      basedPeople++;
      assert.equal(['LOC-03', 'LOC-04', 'LOC-05'].includes(i.locationId), true, `${i.id} is based at one of the crew's bases`);
    }
  }
  assert.equal(basedPeople, 6, 'all six seeded people are based somewhere');
});

check('the prototype bin string became a node, not a second column', () => {
  // PRT-001 was seeded `bin: 'A-03'`; LOC-14 is the row that label now names.
  assert.equal(d.getItem('part', 'PRT-001').locationId, 'LOC-14');
  assert.equal(d.getLocation('LOC-14').name, 'Bay A-03');
  assert.equal(d.getItem('part', 'PRT-001').bin, undefined, 'the string is gone');
});

check('a unit in the shop sits in the warehouse, not the yard', () => {
  assert.equal(d.getItem('serialized', 'SS-205').locationId, 'LOC-05', 'In Shop');
  assert.equal(d.getItem('serialized', 'BL-118').locationId, 'LOC-03', 'Available');
});

check('itemsAtLocation answers for a node and for its subtree', () => {
  const atBay = d.itemsAtLocation('LOC-07');
  assert.equal(atBay.length, 4, 'the safety bay: four PPE SKUs');
  assert.ok(atBay.every((i) => i.locationId === 'LOC-07'));
  assert.equal(
    d.itemsAtLocation('LOC-05').length,
    6,
    'at the warehouse: three kits + the unit in the shop + the two technicians based there',
  );
  assert.equal(
    d.itemsAtLocation('LOC-05', true).length,
    20,
    'the subtree adds 8 consumables + 6 parts shelved at the bays',
  );
  // The yard itself holds nothing *directly* — its zones do (a node and its
  // subtree are different questions, which is the pair this check is about).
  assert.equal(d.itemsAtLocation('LOC-02').length, 0, 'an empty node holds nothing');
  assert.ok(d.itemsAtLocation('LOC-02', true).length > 0, 'but its zones hold the fleet');
  // Drivers park up in Yard B, so that zone is no longer empty either.
  assert.deepEqual(d.itemsAtLocation('LOC-04').map((i) => i.id), ['EMP-003'], 'the driver based there');
});

check('the removal guard blocks a node that holds stock', () => {
  assert.equal(d.removeLocation('LOC-07'), false, 'the safety bay holds items');
  assert.ok(d.getLocation('LOC-07'), 'and it is still there');
  assert.equal(d.removeLocation('LOC-99'), false, 'an unknown id removes nothing');
  // LOC-18 (Aisle 3) is empty, and its child LOC-19 (Bay C-04) holds PRT-005:
  // removing the rack moves the bay up, so the item keeps a valid FK.
  assert.equal(d.removeLocation('LOC-18'), true, 'an empty rack can go');
  assert.equal(d.getLocation('LOC-19').parentId, 'LOC-05', 'its child moved up one level');
  assert.equal(
    d.locationPath(d.getItem('part', 'PRT-005').locationId),
    'Atlanta Main Campus › Warehouse 1 › Bay C-04',
  );
});

check('an edit re-places a *unit* row, and the read-time path follows it', () => {
  const before = d.locationSubtreeItemCount('LOC-08');
  // A *serialized* unit is unit-held: one place, one count, so its FK *is* its
  // placement and an edit moves it. (Counted stock — and, since B4, a kit or an
  // attachment — is the opposite: its place is a level, moved by a movement.)
  const unit = d.listItems('serialized').find((i) => i.locationId === 'LOC-03');
  assert.ok(unit, 'a seeded machine staged in the yard');
  d.updateItem('serialized', unit.id, { locationId: 'LOC-08' });
  assert.equal(d.getItem('serialized', unit.id).locationId, 'LOC-08');
  assert.equal(d.locationPath('LOC-08'), 'Atlanta Main Campus › Warehouse 1 › Aisle 1 › Bay A1-02');
  assert.equal(d.locationSubtreeItemCount('LOC-08'), before + 1);
  assert.equal(d.getItem('serialized', unit.id).updatedBy, 'USR-003', 'still attributed');
});

check('a level-tracked row ignores an edit that would move its stock', () => {
  // Counted stock's quantities are its stock levels' rows, and its `locationId`
  // is their busiest holding (see check7): a patch carrying either is stripped,
  // so a field edit cannot move stock that only a `transfer` may move. Since B4 a
  // kit and an attachment behave exactly the same way.
  const part = d.getItem('part', 'PRT-002');
  assert.equal(part.locationId, 'LOC-15', 'seeded in Bay A-07');
  d.updateItem('part', 'PRT-002', { locationId: 'LOC-08', qtyOnHand: 99 });
  assert.equal(d.getItem('part', 'PRT-002').locationId, 'LOC-15', 'the place did not move');
  assert.equal(d.getItem('part', 'PRT-002').qtyOnHand, 18, 'and the count did not change');

  const kit = d.getItem('kit', 'KT-003');
  const kitPlace = kit.locationId;
  const kitQty = kit.qty;
  d.updateItem('kit', 'KT-003', { locationId: 'LOC-08', qty: 99 });
  assert.equal(d.getItem('kit', 'KT-003').locationId, kitPlace, 'a kit place is a level now');
  assert.equal(d.getItem('kit', 'KT-003').qty, kitQty, 'and its qty is the levels sum');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck3: ${n} checks`);
