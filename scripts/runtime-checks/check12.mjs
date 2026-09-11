import assert from 'node:assert/strict';

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

/* ============ A10: the order's party is a join, not a copy ============
 *
 * A8's document ended by naming the hole that A9 did not close: `orders.party`
 * was a stored copy of the counterparty's name, a column the API would have to
 * keep in step with `parties` by hand. The fix is to stop storing it — the name
 * is resolved through `orders.party_id` at read time, like every other display
 * string in the app — and a derived name is only safe while the FK cannot
 * dangle, so this increment also gives `parties` a removal guard (orders, POs,
 * receipts, sub-rentals) the way locations and POs already have one.
 *
 * These checks hold both halves: no order carries a name, the store resolves one
 * for it, a rename flows through without touching the order, and a party a
 * document names cannot be removed (while an unreferenced one still can).
 */

mem.clear();
const d = new DataService();

/* B2: the fixture ships signed out, so these checks — which assert who authored
   an in-session write — sign in as the seeded manager first. */
await signInAs(d, 'USR-003');

const orders = d.listOrders();
const parties = d.listParties();

check('no order stores its customer — the name is not on the row', () => {
  assert.ok(orders.length >= 4, `the fixture has orders (${orders.length})`);
  for (const o of orders) {
    assert.equal('party' in o, false, `${o.orderId} carries no party column`);
    assert.match(o.partyId, /^PTY-\d+$/, `${o.orderId} names a party`);
  }
});

check('the store resolves the customer for every order', () => {
  for (const o of orders) {
    const name = d.partyName(o.partyId);
    assert.notEqual(name, o.partyId, `${o.orderId} resolves its customer`);
    assert.equal(name, d.getParty(o.partyId).name, `${o.orderId} reads the party row`);
  }
});

check('renaming a partner renames it on every contract at once', () => {
  // The test a stored copy cannot pass: the order rows are never written, and
  // they still read the new name.
  const id = orders[0].partyId;
  const before = d.partyName(id);
  const stamps = { ...d.getOrder(orders[0].orderId) };
  d.updateParty(id, { name: before + ' (Holdings)' });
  assert.equal(d.partyName(id), before + ' (Holdings)');
  assert.equal(d.partyName(d.listOrders()[0].partyId), before + ' (Holdings)', 'the grid row follows');
  const after = d.getOrder(orders[0].orderId);
  assert.equal(after.updatedAt, stamps.updatedAt, 'the order row itself was not written');
  assert.equal(after.updatedBy, stamps.updatedBy);
  d.updateParty(id, { name: before });
});

check('a party a document names cannot be removed', () => {
  for (const o of orders) {
    const blockers = d.partyRemovalBlockers(o.partyId);
    assert.ok(blockers.some((b) => b.includes('order(s)')), `${o.partyId}: ${blockers.join(', ')}`);
    assert.equal(d.removeParty(o.partyId), false, `${o.partyId} is refused`);
    assert.ok(d.getParty(o.partyId), `${o.partyId} is still there`);
  }
});

check('the guard reads the buying side and the sub-rentals too', () => {
  const po = d.listPurchaseOrders()[0];
  assert.equal(d.removeParty(po.supplierId), false, 'a supplier with a PO is refused');
  assert.ok(
    d.partyRemovalBlockers(po.supplierId).some((b) => b.includes('purchase order(s)')),
    'and says why',
  );
  const receipts = d.listReceipts();
  assert.ok(receipts.length > 0);
  for (const r of receipts) assert.equal(d.removeParty(r.supplierId), false, `${r.id}'s supplier stays`);
  const sub = d.listRentals()[0];
  assert.ok(d.partyRemovalBlockers(sub.supplierId).some((b) => b.includes('sub-rental(s)')), 'a sub-rental vendor too');
  assert.equal(d.removeParty(sub.supplierId), false);
});

check('a party nothing points at still removes', () => {
  // The guard has to be a guard, not a freeze: a partner that was entered by
  // mistake must still be removable, or the only way out of a typo is a reseed.
  const rec = d.createParty({ name: 'Transient Partner', kinds: ['customer'], contact: '', phone: '', email: '', billingAddress: '', billingCycle: 'net-30', notes: '' });
  assert.equal(d.partyRemovalBlockers(rec.id).length, 0, 'nothing names it');
  assert.equal(d.removeParty(rec.id), true, 'so it removes');
  assert.equal(d.getParty(rec.id), undefined, 'and it is gone');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck12: ${n} checks`);
