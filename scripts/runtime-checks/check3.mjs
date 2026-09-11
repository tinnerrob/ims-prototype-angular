import assert from 'node:assert/strict';

import { persisted, refuses } from './command-result.mjs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

import { signInAs } from './sign-in.mjs';

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

/* B2: the fixture ships signed out, so these checks — which assert who authored
   an in-session write — sign in as the seeded manager first. */
await signInAs(d, 'USR-003');

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

check('every stock row is placed, and labour is deliberately not', () => {
  for (const i of d.allItems()) {
    if (i.type === 'labor') {
      assert.equal(i.locationId, undefined, `labor ${i.id} has no place`);
      continue;
    }
    assert.equal(typeof i.locationId, 'string', `${i.id} has a location FK`);
    assert.ok(d.getLocation(i.locationId), `${i.id} -> ${i.locationId} resolves`);
  }
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
  assert.equal(d.itemsAtLocation('LOC-05').length, 4, 'at the warehouse: three kits + the unit in the shop');
  assert.equal(
    d.itemsAtLocation('LOC-05', true).length,
    18,
    'the subtree adds 8 consumables + 6 parts shelved at the bays',
  );
  assert.equal(d.itemsAtLocation('LOC-04').length, 0, 'an empty zone holds nothing');
});

check('the removal guard blocks a node that holds stock', () => {
  refuses(d.removeLocation('LOC-07'), 'in-use'); // the safety bay holds items
  assert.ok(d.getLocation('LOC-07'), 'and it is still there');
  refuses(d.removeLocation('LOC-99'), 'missing'); // an unknown id removes nothing
  // LOC-18 (Aisle 3) is empty, and its child LOC-19 (Bay C-04) holds PRT-005:
  // removing the rack moves the bay up, so the item keeps a valid FK.
  persisted(d.removeLocation('LOC-18')); // an empty rack can go
  assert.equal(d.getLocation('LOC-19').parentId, 'LOC-05', 'its child moved up one level');
  assert.equal(
    d.locationPath(d.getItem('part', 'PRT-005').locationId),
    'Atlanta Main Campus › Warehouse 1 › Bay C-04',
  );
});

check('an edit re-places a *unit* row, and the read-time path follows it', () => {
  const before = d.locationSubtreeItemCount('LOC-08');
  // A kit is a unit-held row: one place, one count, so its FK *is* its placement
  // and an edit moves it. (Counted stock is the opposite — see the next check.)
  d.updateItem('kit', 'KT-003', { locationId: 'LOC-08' });
  assert.equal(d.getItem('kit', 'KT-003').locationId, 'LOC-08');
  assert.equal(d.locationPath('LOC-08'), 'Atlanta Main Campus › Warehouse 1 › Aisle 1 › Bay A1-02');
  assert.equal(d.locationSubtreeItemCount('LOC-08'), before + 1);
  assert.equal(d.getItem('kit', 'KT-003').updatedBy, 'USR-003', 'still attributed');
});

check('a counted row ignores an edit that would move its stock', () => {
  // Counted stock's quantities are its stock levels' rows, and its `locationId`
  // is their busiest holding (see check7): a patch carrying either is stripped,
  // so a field edit cannot move stock that only a `transfer` may move.
  const part = d.getItem('part', 'PRT-002');
  assert.equal(part.locationId, 'LOC-15', 'seeded in Bay A-07');
  d.updateItem('part', 'PRT-002', { locationId: 'LOC-08', qtyOnHand: 99 });
  assert.equal(d.getItem('part', 'PRT-002').locationId, 'LOC-15', 'the place did not move');
  assert.equal(d.getItem('part', 'PRT-002').qtyOnHand, 18, 'and the count did not change');
});

console.log(`\n${n} checks, ${process.exitCode ? 'FAILURES' : 'all green'}`);
