import assert from 'node:assert/strict';

/* ============ B5: per-place facts, and a count is a document ============
 *
 * Two halves of the same gap (the A6/A8 "not modelled yet" close-out):
 *  - a `StockLevel` can carry its own facts (a lot, an expiry) — a `jsonb` payload
 *    like `items.attributes`, governed by a schema;
 *  - a **cycle count** is a document: open a sheet on a place (or its subtree), it
 *    freezes the levels, the counter enters what was found, and posting writes one
 *    `adjust` per difference.
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
const A = 'LOC-14'; // Bay A-03
const B = 'LOC-15'; // Bay A-07

check('a receipt can carry per-place facts onto the level', () => {
  const supplier = d.supplierParties()[0];
  const po = d.createPurchaseOrder({
    supplierId: supplier.id,
    status: 'ordered',
    orderedAt: '2026-09-01',
    expectedAt: '2026-09-05',
    lines: [{ id: '', type: 'part', refId: 'PRT-001', description: 'Hydraulic Filter 40um', qty: 5, unitCost: 10 }],
  });
  const line = po.lines[0];
  const rec = d.receiveAgainst({
    poId: po.id,
    locationId: B,
    lines: [{ poLineId: line.id, landings: [{ locationId: B, qty: 5, attributes: { lot: 'L-9', expiry: '2027-05-01' } }] }],
  });
  assert.ok(rec, 'the receipt posts');
  assert.deepEqual(d.levelAt('part', 'PRT-001', B).attributes, { lot: 'L-9', expiry: '2027-05-01' }, 'the level carries the lot');
  assert.deepEqual(rec.lines[0].attributes, { lot: 'L-9', expiry: '2027-05-01' }, 'and the receipt line records it too');
});

check('an attributed level moves whole; a partial move of it is refused', () => {
  const item = d.getItem('part', 'PRT-001');
  const held = d.stockAt(item, B);
  assert.ok(held > 1, 'the place holds more than one');
  assert.equal(d.moveStock('part', 'PRT-001', B, A, held - 1), null, 'half a lot is not a fact the model can state');
  assert.ok(d.moveStock('part', 'PRT-001', B, A, held), 'the whole level moves');
  assert.equal(d.levelAt('part', 'PRT-001', B), undefined, 'the source place is empty');
  assert.deepEqual(d.levelAt('part', 'PRT-001', A).attributes, { lot: 'L-9', expiry: '2027-05-01' }, 'and its facts moved with it');
});

check('a count sheet freezes a place, and posting writes one adjust per difference', () => {
  const session = d.openCountSession(A);
  assert.ok(session, 'the place has levels to count');
  assert.equal(session.status, 'draft');
  assert.ok(session.lines.length > 0, 'it froze the levels');
  const line = session.lines.find((l) => l.itemId === 'PRT-001');
  assert.ok(line, 'including the part we moved in');
  const item = d.getItem(line.itemType, line.itemId);
  assert.equal(line.expected, d.stockAt(item, A), 'expected is the shelf as it stands');

  const before = d.stockAt(item, A);
  // Every other row is left as found, so only one difference is posted.
  for (const other of session.lines) if (other.id !== line.id) d.setCountLine(session.id, other.id, other.expected);
  assert.equal(d.setCountLine(session.id, line.id, before + 3), true, 'the counter found three more');

  const moves = d.postCountSession(session.id);
  assert.ok(moves, 'the sheet posts');
  assert.equal(moves.length, 1, 'exactly one difference (a matching row writes nothing)');
  assert.equal(moves[0].kind, 'adjust');
  assert.equal(moves[0].qty, 3);
  assert.equal(moves[0].locationId, A);
  assert.equal(d.stockAt(item, A), before + 3, 'the shelf followed the count');
  assert.equal(d.getCountSession(session.id).status, 'posted');
  assert.equal(d.postCountSession(session.id), null, 'a posted sheet cannot be posted twice');
  d.removeCountSession(session.id);
  assert.ok(d.getCountSession(session.id), 'a posted sheet is a document: it is not removed');
});

check('a draft sheet is discardable, and a subtree sheet reaches the bins below', () => {
  const node = 'LOC-05'; // Warehouse 1 — the bins under it hold the stock
  const sub = d.openCountSession(node, true);
  assert.ok(sub, 'the warehouse subtree has levels');
  assert.equal(sub.subtree, true);
  assert.ok(sub.lines.some((l) => l.locationId !== node), 'a subtree sheet reaches the bins under the node');
  d.removeCountSession(sub.id);
  assert.equal(d.getCountSession(sub.id), undefined, 'a draft is discarded');

  const direct = d.openCountSession(node);
  if (direct) {
    assert.ok(direct.lines.every((l) => l.locationId === node), 'a node sheet counts only the node itself');
    d.removeCountSession(direct.id);
  }
  assert.equal(d.openCountSession('LOC-999'), null, 'an unknown place opens nothing');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck16: ${n} checks`);
