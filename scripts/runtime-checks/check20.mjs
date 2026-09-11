import assert from 'node:assert/strict';

import { persisted, refuses } from './command-result.mjs';
import { signInAs } from './sign-in.mjs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService } = await import('./data.service.js');

let n = 0;
const check = async (label, fn) => {
  n++;
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

/* ============================ C2: one shape for "no" ============================
 *
 * A command used to answer a *sentinel* — `null` for "no such row", `false` for a
 * refused removal — and neither says which rule held or whether anything was written.
 * This file is the runtime half of the rule `api.ts` asserts at compile time: no
 * command answers a sentinel, every refusal names a reason from a *named* union, and a
 * refusal **persists nothing** — a command that half-wrote and then said no would be
 * worse than the sentinel it replaced.
 *
 * The reasons are asserted by name, one per answerable branch, because that is what C2
 * added: `assert.ok(result)` would pass on a `{ok, reason}` object in exactly the way
 * the screens used to pass on a truthy sentinel. `check6` covers these same branches
 * from the stock side (what a move or a count *leaves behind*); this file covers the
 * answer itself, for every command that has one.
 */

mem.clear();
const d = new DataService();
await signInAs(d, 'USR-003');
const snapshot = () => localStorage.getItem('ims-web.store');

/* --------------------------------- setup --------------------------------- */

const party = d.listOrders()[0].partyId; // a partner an order names
const stocked = d.getLocation('LOC-07'); // a place holding stock
const inUseType = stocked.type; // a type a location uses
const withReceipt = d.listPurchaseOrders().find((p) => d.listReceipts().some((r) => r.poId === p.id));
const live = d.listPurchaseOrders().find((p) => p.status === 'ordered' && d.receivableLines(p).length > 0);
const line = live.lines.find((l) => d.receivableLines(live).some((r) => r.line.id === l.id));
const outstanding = d.poLineOutstanding(line);
const place = d.getItem(line.type, line.refId).locationId;
const out = d.listItems('serialized').find((i) => d.isOut(i.id)); // a unit currently out
const kit = d.listItems('kit').find((k) => k.qty > 1); // a unit-held row holding more than one
const movable = d.listItems('part').find((i) => i.locationId && d.stockAt(i, i.locationId) > 0);

/** A PO to refuse against in a pre-ordered state, made the honest way. */
const makePo = (status) =>
  d.createPurchaseOrder({
    supplierId: d.supplierParties()[0].id,
    status,
    orderedAt: '2026-09-09',
    expectedAt: '2026-09-20',
    lines: [{ id: '', type: 'consumable', refId: 'SG-LFT-001', description: '', qty: 3, unitCost: 2.1 }],
  });
const draftPo = makePo('draft');
const cancelledPo = makePo('cancelled');

for (const [label, value] of [
  ['a partner an order names', party],
  ['a place holding stock', stocked],
  ['a PO with a receipt against it', withReceipt],
  ['an ordered PO with something outstanding', live],
  ['a unit that is out', out],
  ['a kit holding more than one', kit],
  ['a part with stock at a place', movable],
]) {
  assert.ok(value, `the fixture must hold ${label} for these refusals to be reachable`);
}

/* ---------------------- every refusal, and only that one ----------------------
 *
 * One row per *answerable* refusal, and the reason is the whole point: a call that
 * refused for the wrong branch is a bug the old `false` could not show.
 */
const refusals = [
  ['removeParty: an id nothing holds', () => d.removeParty('PTY-999'), 'missing'],
  ['removeParty: a document names it', () => d.removeParty(party), 'in-use'],
  ['removeLocation: an id nothing holds', () => d.removeLocation('LOC-999'), 'missing'],
  ['removeLocation: stock or history points at it', () => d.removeLocation('LOC-07'), 'in-use'],
  ['removeLocationType: not there', () => d.removeLocationType('No Such Type'), 'missing'],
  ['removeLocationType: a location uses it', () => d.removeLocationType(inUseType), 'in-use'],
  ['removePurchaseOrder: an id nothing holds', () => d.removePurchaseOrder('PO-9999-999'), 'missing'],
  ['removePurchaseOrder: a receipt points at it', () => d.removePurchaseOrder(withReceipt.id), 'in-use'],
  ['updatePurchaseOrder: the row is gone', () => d.updatePurchaseOrder('PO-9999-999', { notes: 'x' }), 'missing'],
  ['raiseReorder: an id nothing holds', () => d.raiseReorder('part', 'NOPE-001'), 'missing'],
  ['raiseReorder: a person is not purchased', () => d.raiseReorder('labor', 'EMP-001'), 'not-purchasable'],
  ['receiveAgainst: an id nothing holds', () => d.receiveAgainst({ poId: 'PO-9999-999', locationId: 'LOC-07', qty: {} }), 'missing'],
  ['receiveAgainst: the order is a draft', () => d.receiveAgainst({ poId: draftPo.id, locationId: 'LOC-07', qty: { [draftPo.lines[0].id]: 1 } }), 'draft'],
  ['receiveAgainst: the order was cancelled', () => d.receiveAgainst({ poId: cancelledPo.id, locationId: 'LOC-07', qty: { [cancelledPo.lines[0].id]: 1 } }), 'cancelled'],
  ['receiveAgainst: nowhere to put it', () => d.receiveAgainst({ poId: live.id, locationId: 'LOC-999', qty: { [line.id]: 1 } }), 'unknown-place'],
  ['receiveAgainst: more than is outstanding', () => d.receiveAgainst({ poId: live.id, locationId: place, qty: { [line.id]: outstanding + 1 } }), 'over-receipt'],
  ['receiveAgainst: nothing positive asked for', () => d.receiveAgainst({ poId: live.id, locationId: place, qty: { [line.id]: 0 } }), 'nothing-to-receive'],
  ['createRental: no vendor named', () => d.createRental({ itemId: null, assetName: 'X', orderId: null, supplierId: '', vendorCost: 1, retailRate: 2, qty: 1 }), 'no-vendor'],
  ['createRental: a vendor nobody knows', () => d.createRental({ itemId: null, assetName: 'X', orderId: null, supplierId: 'PTY-999', vendorCost: 1, retailRate: 2, qty: 1 }), 'unknown-vendor'],
  ['moveStock: an id nothing holds', () => d.moveStock('part', 'NOPE-001', 'LOC-03', 'LOC-01', 1), 'missing'],
  ['moveStock: a person is not stock', () => d.moveStock('labor', 'EMP-001', 'LOC-03', 'LOC-01', 1), 'not-stock'],
  ['moveStock: nowhere to move it from', () => d.moveStock('part', movable.id, 'LOC-999', 'LOC-01', 1), 'unknown-place'],
  ['moveStock: to where it already is', () => d.moveStock('part', movable.id, movable.locationId, movable.locationId, 1), 'same-place'],
  ['moveStock: a unit that is out is not on a shelf', () => d.moveStock('serialized', out.id, out.locationId, 'LOC-01', 1), 'out-on-rent'],
  ['moveStock: not a positive whole number', () => d.moveStock('part', movable.id, movable.locationId, 'LOC-01', 0), 'bad-quantity'],
  ['moveStock: the source does not hold that much', () => d.moveStock('part', movable.id, movable.locationId, 'LOC-01', d.stockAt(movable, movable.locationId) + 1), 'not-held'],
  ['moveStock: half a unit-held row', () => d.moveStock('kit', kit.id, kit.locationId, 'LOC-01', 1), 'partial-unit'],
  ['adjustStock: an id nothing holds', () => d.adjustStock('part', 'NOPE-001', 'LOC-15', 1), 'missing'],
  ['adjustStock: a unit is a row, not a count', () => d.adjustStock('serialized', out.id, 'LOC-15', 1), 'not-counted'],
  ['adjustStock: counting at a place that is not one', () => d.adjustStock('part', movable.id, 'LOC-999', 1), 'unknown-place'],
  ['adjustStock: a negative count', () => d.adjustStock('part', movable.id, movable.locationId, -1), 'bad-quantity'],
  ['adjustStock: the count matched', () => d.adjustStock('part', movable.id, movable.locationId, d.stockAt(movable, movable.locationId)), 'no-change'],
  ['signIn: an address and password that match nobody', () => d.signIn('nobody@northline.example', 'not-a-password'), 'invalid'],
];

for (const [label, call, reason] of refusals) {
  await check(label, async () => {
    const before = snapshot();
    refuses(await call(), reason);
    assert.equal(snapshot(), before, 'a refusal persists nothing');
  });
}

/* --------------------------- and the other branch -----------------------------
 *
 * The same commands, succeeding: the answer is `{ ok: true }`, and one that produced a
 * row hands it back rather than making the caller re-read the store for it.
 */
await check('a successful command answers ok, and hands back the row it made', () => {
  const before = snapshot();
  const raised = persisted(d.raiseReorder('part', movable.id));
  assert.equal(raised.status, 'draft', 'the document it raised');
  assert.equal(d.getPurchaseOrder(raised.id).id, raised.id, 'and it is the stored row');
  assert.notEqual(snapshot(), before, 'what persisted is what changed the snapshot');

  // A draft is not receivable (one of the refusals above), so the buyer picks a
  // supplier and sends it first — the same two steps the page takes.
  persisted(d.updatePurchaseOrder(raised.id, { supplierId: d.supplierParties()[0].id, status: 'ordered' }));
  const posted = persisted(d.receiveAgainst({ poId: raised.id, locationId: place, qty: { [raised.lines[0].id]: 1 } }));
  assert.equal(posted.poId, raised.id, 'the receipt it posted');
  assert.equal(posted.byUserId, undefined, 'still attributed by the writer, not by hand');

  // The receipt it just posted is what now blocks removing the order — the same rule
  // as `'in-use'` above, reached by succeeding rather than by being refused.
  refuses(d.removePurchaseOrder(raised.id), 'in-use');
});

await check('a successful removal answers ok and hands nothing back', () => {
  const p = d.createParty({ name: 'C2 Probe Partner', kinds: ['customer'], contact: '', phone: '', email: '', billingAddress: '', billingCycle: 'net-30', notes: '' });
  const removed = d.removeParty(p.id);
  assert.equal(removed.ok, true);
  assert.equal('value' in removed, false, 'a removal has nothing to hand back');
  assert.equal(d.getParty(p.id), undefined, 'and it is gone');
});

await check('signIn answers the same shape as every command (B1, one vocabulary)', async () => {
  const account = d.demoAccounts().find((a) => a.userId === 'USR-003');
  const good = await d.signIn(account.email, account.password);
  assert.equal(good.ok, true);
  assert.equal(good.value.id, 'USR-003', 'the person, under the one shape');
});

console.log(`\ncheck20: ${n} checks`);

