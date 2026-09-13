import assert from 'node:assert/strict';

/* ================ B6: one PO line, several destinations ================
 *
 * Receiving supports per-line **landings**: one PO line can be split across
 * places on a single receipt ("50 in Bay A-03, 100 in Bay B-01"), each landing
 * writing its own `stock_levels` row, its own `receipt_line` and its own
 * `receive` movement. What these checks hold to account:
 *  - a split posts one receipt with a line per landing, each naming its place;
 *  - the stock itself lands per place (the same SKU ends up in two bins);
 *  - a landing that names no place falls back to the receipt's header;
 *  - the whole-receipt shape (qty keyed by line) still lands at one place;
 *  - the *sum* of a line's landings can never exceed what is outstanding, and a
 *    refused post writes nothing at all (no receipt, no stock, no movement);
 *  - the ledger records the place each landing went to.
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

/** A fresh ordered PO with one countable line, ready to receive. */
function orderedPo(qty) {
  const supplier = d.supplierParties()[0];
  const po = d.createPurchaseOrder({
    supplierId: supplier.id,
    status: 'ordered',
    orderedAt: '2026-09-01',
    expectedAt: '2026-09-10',
    lines: [{ id: '', type: 'part', refId: 'PRT-001', description: 'Hydraulic Filter 40um', qty, unitCost: 10 }],
  });
  return { po, line: po.lines[0] };
}

check('a PO line splits across places on one receipt', () => {
  const { po, line } = orderedPo(300);
  const item = d.getItem('part', line.refId);
  const beforeA = d.stockAt(item, A);
  const beforeB = d.stockAt(item, B);
  const receiptsBefore = d.listReceipts().length;

  const rec = d.receiveAgainst({
    poId: po.id,
    locationId: A,
    lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 50 }, { locationId: B, qty: 100 }] }],
  });

  assert.ok(rec, 'the split receipt posts');
  assert.equal(rec.lines.length, 2, 'one receipt line per landing');
  assert.deepEqual(rec.lines.map((l) => l.locationId), [A, B], 'each line names its own place');
  assert.equal(rec.locationId, A, 'the header is the default put-away');
  assert.equal(d.stockAt(item, A), beforeA + 50, '50 landed in A');
  assert.equal(d.stockAt(item, B), beforeB + 100, '100 landed in B');
  assert.equal(d.listReceipts().length, receiptsBefore + 1, 'still exactly one receipt');
  const moves = d.listMovements().filter((m) => m.receiptId === rec.id);
  assert.equal(moves.length, 2, 'one receive movement per landing');
  assert.deepEqual(moves.map((m) => m.locationId).sort(), [A, B].sort(), 'the ledger records both places');
  assert.equal(d.poLineReceived(line.id), 150, 'the line knows what arrived');
  assert.equal(d.poLineOutstanding(line), 150, 'and what is still to come');
});

check('a landing that names no place falls back to the receipt header', () => {
  const { po, line } = orderedPo(10);
  const rec = d.receiveAgainst({
    poId: po.id,
    locationId: B,
    lines: [{ poLineId: line.id, landings: [{ qty: 10 }] }],
  });
  assert.ok(rec, 'a landings-only line posts');
  assert.equal(rec.lines[0].locationId, B, 'the header is the fallback place');
});

check('the whole-receipt shape still lands everything at one place', () => {
  const { po, line } = orderedPo(40);
  const rec = d.receiveAgainst({ poId: po.id, locationId: A, qty: { [line.id]: 40 } });
  assert.ok(rec, 'the qty shape still works');
  assert.equal(rec.lines.length, 1);
  assert.equal(rec.lines[0].locationId, A);
});

check('the sum of a split never exceeds what is outstanding — and a refusal writes nothing', () => {
  const { po, line } = orderedPo(30);
  assert.ok(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 10 }] }] }),
    'a partial lands first',
  );
  const receiptsNow = d.listReceipts().length;
  const movesNow = d.listMovements().length;

  // 15 + 10 = 25 > 20 outstanding: refused outright.
  assert.equal(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 15 }, { locationId: B, qty: 10 }] }] }),
    null,
    'an over-receipt across landings is refused',
  );
  // An unknown landing place is refused too.
  assert.equal(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: 'NOPE-999', qty: 5 }] }] }),
    null,
    'an unknown landing place is refused',
  );

  assert.equal(d.listReceipts().length, receiptsNow, 'no receipt was added by a refusal');
  assert.equal(d.listMovements().length, movesNow, 'and no movement was written');
  assert.equal(d.poLineReceived(line.id), 10, 'and nothing extra landed');
});

check('a split writes levels, not a re-placement (the SKU is now in two bins)', () => {
  const { po, line } = orderedPo(20);
  const rec = d.receiveAgainst({
    poId: po.id,
    locationId: A,
    lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 5 }, { locationId: B, qty: 15 }] }],
  });
  assert.ok(rec);
  const item = d.getItem('part', line.refId);
  const places = d.placements(item).map((p) => p.locationId);
  assert.ok(places.includes(A) && places.includes(B), 'the row holds stock in both places');
  const levels = d.listStockLevels(line.refId);
  assert.ok((levels.find((l) => l.locationId === A)?.qty ?? 0) >= 5, 'A holds its landing');
  assert.ok((levels.find((l) => l.locationId === B)?.qty ?? 0) >= 15, 'B holds its landing');
  assert.equal(
    rec.lines.reduce((sum, l) => sum + l.qty, 0),
    d.poLineReceived(line.id),
    'what the receipt landed is what the line counts',
  );
});

check("the over-receipt tolerance is the desk's, and 0 means exact", () => {
  const { po, line } = orderedPo(100);
  assert.equal(d.receivingSettings().overReceiptTolerancePct, 0, 'the seed is exact');
  assert.equal(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 101 }] }] }),
    null,
    'one over is refused at 0%',
  );
  d.updateReceivingSettings({ overReceiptTolerancePct: 10 });
  assert.equal(d.receivingSettings().overReceiptTolerancePct, 10, 'the setting is a tenant row');
  assert.ok(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 105 }] }] }),
    '5% over is inside a 10% tolerance',
  );
  assert.equal(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 20 }] }] }),
    null,
    '20% over exceeds it',
  );
  d.updateReceivingSettings({ overReceiptTolerancePct: 0 });
});

check('a supplier reference is required only when the desk says so', () => {
  const { po, line } = orderedPo(5);
  d.updateReceivingSettings({ requirePoReference: true });
  assert.equal(d.receiveAgainst({ poId: po.id, locationId: A, qty: { [line.id]: 5 } }), null, 'no reference: refused');
  assert.equal(d.updatePurchaseOrder(po.id, { reference: 'SUP-77' }), true);
  assert.ok(d.receiveAgainst({ poId: po.id, locationId: A, qty: { [line.id]: 5 } }), 'with a reference it posts');
  d.updateReceivingSettings({ requirePoReference: false });
});

check('a damaged landing is quarantined, and its line says so', () => {
  const { po, line } = orderedPo(20);
  const Q = 'LOC-13'; // Secure Cage C
  d.updateReceivingSettings({ quarantineLocationId: Q });
  const item = d.getItem('part', line.refId);
  const beforeQ = d.stockAt(item, Q);
  const rec = d.receiveAgainst({
    poId: po.id,
    locationId: A,
    lines: [
      {
        poLineId: line.id,
        landings: [
          { locationId: A, qty: 17 },
          { qty: 3, condition: 'damaged', reasonCode: 'CRUSHED' },
        ],
      },
    ],
  });
  assert.ok(rec, 'the split posts');
  const damaged = rec.lines.find((l) => l.condition === 'damaged');
  assert.ok(damaged, 'the damaged line is recorded');
  assert.equal(damaged.locationId, Q, 'it landed in quarantine, not the default place');
  assert.equal(damaged.damagedQty, 3, 'and says how much was damaged');
  assert.equal(damaged.reasonCode, 'CRUSHED', 'with the reason code');
  assert.equal(rec.lines.find((l) => l.condition === 'good').locationId, A, 'the good part went to its place');
  assert.equal(d.stockAt(item, Q), beforeQ + 3, 'quarantine holds it');
  d.updateReceivingSettings({ quarantineLocationId: null });
});

check('short-close says the rest is not coming, without inventing stock', () => {
  const { po, line } = orderedPo(50);
  assert.ok(
    d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 20 }] }] }),
    'the partial lands',
  );
  assert.equal(d.poProgress(po), 'partial');
  assert.equal(d.poLineOutstanding(line), 30, '30 still owed');
  assert.equal(d.closePurchaseOrderShort(po.id, line.id), true, 'the line is closed short');
  assert.equal(d.poLineOutstanding(line), 0, 'nothing is outstanding');
  assert.equal(d.poProgress(po), 'received', 'the order reads received without inventing stock');
  assert.equal(d.receivableLines(po).length, 0, 'it is no longer receivable');
  assert.equal(d.closePurchaseOrderShort(po.id, line.id), false, 'closing twice changes nothing');
});

check('return-to-vendor is a stock-out with a reason', () => {
  const { po, line } = orderedPo(30);
  d.receiveAgainst({ poId: po.id, locationId: A, lines: [{ poLineId: line.id, landings: [{ locationId: A, qty: 30 }] }] });
  const item = d.getItem('part', line.refId);
  const held = d.stockAt(item, A);
  assert.equal(d.returnToVendor('part', line.refId, A, held + 1), null, 'cannot send back more than is held');
  const mv = d.returnToVendor('part', line.refId, A, 5, 'crushed in transit');
  assert.ok(mv, 'the return posts');
  assert.equal(mv.kind, 'return-to-vendor');
  assert.equal(mv.qty, -5, 'a stock-out, negative');
  assert.equal(mv.locationId, A);
  assert.equal(d.stockAt(item, A), held - 5, 'the shelf dropped by five');
});


console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck17: ${n} checks`);
