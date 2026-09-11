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

/* ============ A11: a negotiated rate is read, never copied ============
 *
 * Rates used to live in exactly two places: `items.rate_daily` (the catalog) and
 * the pricing settings (the rules engine). A customer's negotiated numbers were
 * neither, so a card table hangs off `parties` and the *order screens* read it —
 * `lineTotal()` and `rateBasis()` both go through `cardRateFor()`. That is the A10
 * argument (a stored copy of a name) applied to money, and it is what these checks
 * hold: the order row is never written when a card is repriced, the catalog keeps
 * its own list prices, and the card that applies is decided by the window, on the
 * day the booking starts.
 *
 * The other half is the buying side, and it is deliberately *not* symmetric: a
 * purchase order line stores the cost it was raised at, so a supplier's card is
 * the editor's default and the raised document keeps stating its own price.
 */

mem.clear();
const d = new DataService();
const round2 = (x) => Math.round(x * 100) / 100;

const cards = d.listPriceCards();
const order = (id) => d.getOrder(id);

check('every card names a real party and carries its stamps', () => {
  assert.ok(cards.length >= 4, `the fixture has cards (${cards.length})`);
  for (const c of cards) {
    assert.ok(d.getParty(c.partyId), `${c.id} names a party that exists`);
    assert.ok(c.tenantId && c.createdBy && c.updatedBy, `${c.id} is stamped like any other row`);
  }
  // One card per party in the fixture, so "which card" is a real question.
  const parties = new Set(cards.map((c) => c.partyId));
  assert.equal(parties.size, cards.length, 'no party has two cards in the fixture');
});


check('an order bills at the rate card in force when its booking starts', () => {
  // CT-2024-001 is Halstead's, and Halstead's card is in force from 2026-01-01.
  const o = order('CT-2024-001');
  const card = d.priceCardFor(o.partyId, o.startDate);
  assert.equal(card?.id, 'PC-001', `${o.orderId} prices at its customer's card`);

  const total = (refId, type) => {
    const li = o.lineItems.find((x) => x.refId === refId && x.type === type);
    const item = d.getItem(li.type, li.refId);
    return { li, total: d.lineTotal(li, o), basis: d.rateBasis(li, item, o) };
  };

  // 20 Aug → 10 Sep is 21 days, and the weekly basis steps in at 7 — so it is the
  // card's `baseWeekly` that bills: 2325 x ceil(21/7), not the catalog's 2600 x 3.
  assert.equal(d.orderDays(o), 21);
  const boom = total('BL-119', 'serialized');
  assert.equal(boom.basis.basis, 'Weekly');
  assert.equal(boom.basis.rate, 2325, 'the basis prints the card, not the catalog');
  assert.equal(boom.total, 6975, `${boom.total} = 2325 x 3 weeks`);
  assert.equal(total('FL-401', 'serialized').total, 2925, '975 x 3');

  // The one-time types read the negotiated unit price; the bulk line the card does
  // not mention bills exactly as it did before the card existed.
  assert.equal(total('SG-LFT-001', 'consumable').total, 92, '20 x the agreed $4.60');
  assert.equal(total('EMP-001', 'labor').total, 2480, '40 x the agreed $62');
  assert.equal(total('CN-018', 'bulk').total, 487.5, '50 x 3.25 x 3 — the catalog');

  assert.equal(d.orderAmount(o), round2(6975 + 2925 + 92 + 2480 + 487.5), 'and the Gross is the sum of them');
});

check('the card is read, not copied: the catalog keeps its own prices', () => {
  // A card that rewrote `items.rate_daily` would be a stored copy by another name.
  assert.equal(d.getItem('serialized', 'BL-119').rateDaily, 520, 'the boom lift still lists at 520');
  assert.equal(d.getItem('serialized', 'FL-401').rateDaily, 215, 'the forklift at 215');
  // …and a party with no card still bills the catalog rate.
  const other = order('CT-2024-004'); // Port Authority: no card on file
  assert.equal(d.priceCardFor(other.partyId, other.startDate), undefined, 'no card to read');
  const li = other.lineItems[0];
  const item = d.getItem(li.type, li.refId);
  assert.equal(d.cardRateFor(other.partyId, item, other.startDate).source, 'list');
  assert.equal(d.orderDays(other), 24);
  const premium = d.pricing.riskPremiums.coastal;
  assert.equal(
    d.lineTotal(li, other),
    round2(item.baseWeekly * 4 * (1 + premium)),
    'catalog weekly basis, the coastal premium and all',
  );

check('the window decides — an expired card prices nothing', () => {
  // Meridian's card ended 2025-12-31; CT-2024-002 starts 2026-09-01.
  const o = order('CT-2024-002');
  assert.equal(d.priceCardFor(o.partyId, o.startDate), undefined, 'the 2025 card is out of force');
  assert.equal(d.priceCardsForParty(o.partyId).length, 1, 'but it is still on file');
  const li = o.lineItems.find((x) => x.refId === 'SS-204');
  const catalogWeekly = d.getItem('serialized', 'SS-204').baseWeekly;
  assert.equal(d.lineTotal(li, o), catalogWeekly * 3, 'so the catalog rate bills (1325 x 3)');

  // The same line under a card that *is* in force: the test the fixture alone
  // could pass by coincidence — a new card moves it, and removing it puts it back.
  const live = d.createPriceCard({
    partyId: o.partyId,
    name: '2026 Renewal',
    active: true,
    effectiveFrom: '2026-01-01',
    lines: [{ type: 'serialized', refId: 'SS-204', baseWeekly: 995 }],
  });
  assert.equal(d.lineTotal(li, o), 2985, '995 x 3 under the renewal');
  const other = order('CT-2024-001');
  assert.equal(d.lineTotal(other.lineItems[0], other), 6975, 'another customer is untouched');
  d.removePriceCard(live.id);
  assert.equal(d.lineTotal(li, o), catalogWeekly * 3, 'and removing it puts the catalog back');
});

check('repricing a card moves the order without writing the order row', () => {
  // A10's test, in money: the copy that must not exist is a price on the order.
  const o = order('CT-2024-001');
  const before = d.orderAmount(o);
  const stamps = { updatedAt: o.updatedAt, updatedBy: o.updatedBy };
  const card = d.getPriceCard('PC-001');
  // The original array, held across the update: `Object.assign` replaces the card's
  // `lines` with the repriced array, so the old one has to be kept to put it back.
  const original = card.lines;
  const repriced = original.map((l) => (l.refId === 'BL-119' ? { ...l, baseWeekly: 2100 } : l));
  d.updatePriceCard(card.id, { lines: repriced });

  assert.equal(d.orderAmount(order('CT-2024-001')), round2(before - (2325 - 2100) * 3), 'the Gross follows the card');
  const after = order('CT-2024-001');
  assert.equal(after.updatedAt, stamps.updatedAt, 'the order row itself was not written');
  assert.equal(after.updatedBy, stamps.updatedBy);

  d.updatePriceCard(card.id, { lines: original });
  assert.equal(d.orderAmount(order('CT-2024-001')), before, 'and the card was put back');
});


check('the buying side takes the card as a default, and the document keeps its own price', () => {
  // A PO line stores the cost it was raised at — a supplier's quote is the
  // document's fact — so a card can only seed the editor, never rewrite history.
  assert.equal(d.supplierCardCost('PTY-007', 'part', 'PRT-001'), 16.1, 'the agreed filter price');
  assert.equal(d.supplierCardCost('PTY-007', 'part', 'PRT-005'), undefined, 'a row the card does not name');
  assert.equal(d.supplierCardCost('PTY-006', 'part', 'PRT-001'), undefined, 'a supplier with no card');

  const po = d.listPurchaseOrders().find((p) => p.supplierId === 'PTY-007');
  const line = po.lines.find((l) => l.refId === 'PRT-001');
  assert.equal(line.unitCost, 17.25, 'the raised PO still states the price it was ordered at');

  // A renegotiated card does not touch it either — only new lines see the new price.
  const live = d.createPriceCard({
    partyId: 'PTY-007',
    name: 'Renegotiated',
    active: true,
    effectiveFrom: '2026-01-01',
    lines: [{ type: 'part', refId: 'PRT-001', unitCost: 9.99 }],
  });
  const still = d.listPurchaseOrders().find((p) => p.id === po.id).lines.find((l) => l.refId === 'PRT-001');
  assert.equal(still.unitCost, 17.25, 'the document is not re-priced');
  assert.equal(d.supplierCardCost('PTY-007', 'part', 'PRT-001'), 9.99, 'but a new line would take the newer card');
  d.removePriceCard(live.id);
  assert.equal(d.supplierCardCost('PTY-007', 'part', 'PRT-001'), 16.1, 'and the agreement underneath is back');
});

check('a card is not referenced, so removal needs no guard — it re-prices', () => {
  // Nothing holds a `price_card_id`: the card is read. That is why the store has
  // no `priceCardRemovalBlockers` — the consequence shows on the order screens,
  // where a dangling FK cannot.
  const o = order('CT-2024-001');
  const item = d.getItem('serialized', 'BL-119');
  assert.equal(d.cardRateFor(o.partyId, item, o.startDate).source, 'card', 'the booking is on the card');

  d.removePriceCard('PC-001');
  assert.equal(d.getPriceCard('PC-001'), undefined, 'it is gone');
  assert.equal(d.cardRateFor(o.partyId, item, o.startDate).source, 'list', 'and the booking prices at the catalog');
  assert.equal(d.cardRateFor(o.partyId, item, o.startDate).rateDaily, 520, 'the list price, not the card');

  const restored = d.createPriceCard({
    partyId: 'PTY-001',
    name: '2026 Master Agreement',
    active: true,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    lines: [
      { type: 'serialized', refId: 'BL-119', rateDaily: 465, baseWeekly: 2325, baseMonthly: 6975 },
      { type: 'serialized', refId: 'FL-401', rateDaily: 195, baseWeekly: 975, baseMonthly: 2925 },
      { type: 'consumable', refId: 'SG-LFT-001', unitPrice: 4.6 },
      { type: 'labor', refId: 'EMP-001', unitPrice: 62 },
    ],
  });
  assert.equal(d.orderAmount(order('CT-2024-001')), 12959.5, 'and the fixture is back where it started');
  assert.equal(d.cardStatus(restored), 'in-force', 'the replacement is in force today');
});

check('a rate card is a row that names its party, so it blocks removal too', () => {
  // A11 added an FK into `parties`, so the A10 guard has to cover it: a party with
  // only a card would otherwise be removed and leave the card naming an id nothing
  // holds. The card itself is still unreferenced — only the party it names matters.
  const p = d.createParty({
    name: 'Card Only Co',
    kinds: ['customer'],
    contact: '',
    phone: '',
    email: '',
    billingAddress: '',
    billingCycle: 'net-30',
    notes: '',
  });
  const card = d.createPriceCard({
    partyId: p.id,
    name: 'Sole Agreement',
    active: true,
    effectiveFrom: '2026-01-01',
    lines: [{ type: 'serialized', refId: 'BL-120', rateDaily: 470 }],
  });
  assert.deepEqual(d.partyRemovalBlockers(p.id), ['1 rate card(s)'], 'the card is the only thing naming it');
  assert.equal(d.removeParty(p.id), false, 'so the party stays');
  assert.ok(d.getParty(p.id), 'still there');

  d.removePriceCard(card.id);
  assert.deepEqual(d.partyRemovalBlockers(p.id), [], 'the card goes first');
  assert.equal(d.removeParty(p.id), true, 'then the party removes');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck13: ${n} checks`);

});
