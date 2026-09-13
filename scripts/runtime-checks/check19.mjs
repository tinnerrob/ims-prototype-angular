import assert from 'node:assert/strict';

/* ============ B8: follow-ups and evidence ============
 *
 * The close-out of the phase: a record's photos/papework become `documents` rows
 * (the count is derived, never stored), and **hold** is a first-class read that
 * keeps a unit out of the available pool without it being in custody. What these
 * checks hold to account:
 *  - evidence is scoped rows, and a record's photo count is derived from them;
 *  - evidence attaches and removes, and the scope/record filters hold;
 *  - a held unit leaves `availableItems()` but is not "out" (custody is the ledger's);
 *  - a critical failure runs end to end: inspect -> hold -> a linked work order.
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

check('evidence is rows on a record, and its count is derived', () => {
  assert.equal(d.documentsFor('inspection', 'INSP-003').length, 3, 'three photos on the check-in');
  assert.equal(d.photoCount('inspection', 'INSP-003'), 3);
  assert.equal(d.photoCount('inspection', 'INSP-001'), 0, 'a record with none reads zero');
  assert.equal(d.getInspection('INSP-003').photos, undefined, 'no stored photo count on the row');
  assert.equal(d.photoCount('receipt', 'RC-2026-001'), 0, 'a packing slip is not a photo');
  assert.equal(d.documentsFor('receipt', 'RC-2026-001').length, 1, 'but it is evidence');
});

check('evidence attaches and removes, and the filters hold', () => {
  const made = d.createDocument({ scope: 'inspection', refId: 'INSP-001', kind: 'photo', caption: 'Scratch on the arm' });
  assert.ok(made.id.startsWith('DOC-'), 'it gets an id');
  assert.equal(d.photoCount('inspection', 'INSP-001'), 1);
  assert.equal(d.listDocuments('item').every((x) => x.scope === 'item'), true, 'the scope filter holds');
  assert.equal(d.listDocuments(undefined, 'INSP-001').length, 1, 'and the record filter');
  d.removeDocument(made.id);
  assert.equal(d.photoCount('inspection', 'INSP-001'), 0, 'removing it drops the count');
});

check('a held unit leaves the pool but is not "out"', () => {
  const unit = d.availableItems().find((i) => i.type === 'serialized');
  assert.ok(unit, 'there is a free machine to hold');
  assert.equal(d.isHeld('serialized', unit.id), false);
  d.setHold('serialized', unit.id, true);
  assert.equal(d.isHeld('serialized', unit.id), true);
  assert.equal(d.availableItems().some((i) => i.id === unit.id), false, 'a held unit is not offered');
  assert.equal(d.isOut(unit.id), false, 'a hold is not custody');
  assert.equal(d.custodyItems().some((i) => i.id === unit.id), false, 'and it is not in custody either');
  d.setHold('serialized', unit.id, false);
  assert.equal(d.availableItems().some((i) => i.id === unit.id), true, 'releasing it returns it to the pool');
});

check('a critical failure runs end to end: inspect -> hold -> work order', () => {
  const r = d.getInspection('INSP-003');
  r.results.engine = { value: 'Fault', outcome: 'fail', severity: 'critical', note: 'Blown head gasket' };
  const wo = d.raiseWorkOrderForInspection(r.id);
  assert.ok(wo, 'the critical failure raised a job');
  assert.equal(wo.type, 'Repair', 'critical -> Repair');
  assert.equal(wo.itemId, r.itemId, 'for the inspected unit');
  assert.equal(d.getInspection(r.id).workOrderId, wo.id, 'cross-linked to the inspection');
  d.setHold('serialized', r.itemId, true);
  assert.equal(d.isHeld('serialized', r.itemId), true, 'the unit is held out of the pool');
  assert.equal(d.photoCount('inspection', r.id), 3, 'with its evidence intact');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck19: ${n} checks`);
