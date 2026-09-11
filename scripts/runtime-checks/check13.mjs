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
 *
 * A11.2 (the second block) follows the money one step further out: the invoice.
 * It bills the same rule in periods — whole weeks and months, on the line's own
 * days — and the period length is the *party's* cadence, so a booking's cycles
 * tile it and add up to the Gross.
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
});

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

check('a supplier picked after the lines still reaches them — the reorder draft', () => {
  // The flow the default has to survive. The dashboard raises a reorder warning as
  // a *draft naming no supplier* (`raiseReorder`), so its line already costs the
  // catalog's figure; the buyer then picks the supplier in the editor and the
  // agreed price has to land on that line. `poLineCostFor()` is the one rule both
  // fills read — the first by `syncLine`, the re-fill when the supplier changes —
  // so "what the editor supplies" and "what the draft stored" cannot drift apart.
  const at = d.getItem('part', 'PRT-001').locationId;
  d.adjustStock('part', 'PRT-001', at, 4, 'down to the last four');
  d.adjustStock('part', 'PRT-001', 'LOC-15', 0, 'bin emptied');

  const draft = d.raiseReorder('part', 'PRT-001');
  assert.ok(draft, 'the warning raises a document');
  const line = d.listPurchaseOrders().find((p) => p.id === draft.id).lines[0];
  assert.equal(draft.supplierId, '', 'the draft names no supplier yet');
  assert.equal(line.unitCost, 18.5, 'so its line costs the catalog figure');
  assert.equal(
    d.poLineCostFor(draft.supplierId, 'part', 'PRT-001'),
    line.unitCost,
    'which is exactly the default the editor would supply for it',
  );

  // Picking a supplier: the same rule answers with the card's price.
  assert.equal(d.poLineCostFor('PTY-007', 'part', 'PRT-001'), 16.1, "the supplier's agreed price");
  assert.equal(d.poLineCostFor('PTY-006', 'part', 'PRT-001'), 18.5, 'back to the catalog for a supplier with no card');
  // A row the card is silent about falls back too (its figure is the row's own —
  // a receipt has moved the fixture's cost, so the assertion reads it, not 34.00).
  const silent = d.getItem('part', 'PRT-005');
  assert.equal(d.poLineCostFor('PTY-007', 'part', 'PRT-005'), silent.costPrice, 'the catalog cost where the card says nothing');
  assert.notEqual(silent.costPrice, 16.1, 'which is not the price the card carries for another part');

  assert.equal(d.removePurchaseOrder(draft.id), true, 'the probe cleans up after itself');
  d.adjustStock('part', 'PRT-001', at, 24, 'put back');
  d.adjustStock('part', 'PRT-001', 'LOC-15', 6, 'bin back');
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

/* ========== A11.2: the invoice bills whole units, and the cycles add up ==========
 *
 * The Gross is a rule (`lineTotal()`, A11); an invoice is the same rule read in
 * periods. `lineAmountForPeriod()` used to multiply the *weekly* rate a card
 * prints by the *days* of the period — 2325 x 8 for one week of a boom lift —
 * which is not a price anyone agreed. The prototype's rule is whole units
 * (`wholeUnitsBilled`): a week bills as a week, and every unit lands in exactly
 * one cycle, so a booking's cycles sum to its Gross however they are cut. The
 * cut itself is a party term too (`partyCycleDays()`): the cycle length comes
 * from the counterparty, not from a figure copied onto the order.
 */

check('a cycle bills whole weeks and months, never the period\'s days', () => {
  // The fixture's own first cycle: Halstead bills weekly, so INV-001 is
  // [08-20, 08-27) — one week of a 21-day booking.
  const o = order('CT-2024-001');
  const inv = d.getInvoice('INV-001');
  const amount = (refId) =>
    d.lineAmountForPeriod(o, o.lineItems.find((li) => li.refId === refId), inv.cycleStart, inv.cycleEnd);

  // 2325 for the week, not 2325 x 8 — the day-multiplied figure this replaced.
  assert.equal(amount('BL-119'), 2325, 'one whole week of the boom lift');
  assert.notEqual(amount('BL-119'), 2325 * 8, 'not the weekly rate charged per day of the period');
  assert.equal(amount('FL-401'), 975, 'one week of the forklift');
  assert.equal(amount('CN-018'), 162.5, 'the bulk line bills its week too (50 x 3.25)');
  // One-time lines bill once, in the period holding the rental start.
  assert.equal(amount('SG-LFT-001'), 92, 'the consumable, once');
  assert.equal(amount('EMP-001'), 2480, 'the labor, once');
  assert.equal(d.invoiceTotals(inv).base, 6034.5, 'and the period base is the sum of them');

  // A monthly party, on a card: Coastal's 28 days is one monthly unit of the
  // agreed 2325 — with the line's hazmat premium applied once, on the amount.
  const coastal = order('CT-2024-003');
  const gn = coastal.lineItems.find((li) => li.refId === 'GN-511');
  const hazmat = d.pricing.riskPremiums.hazmat;
  const rates = d.rateBasis(gn, d.getItem('serialized', 'GN-511'), coastal);
  assert.equal(rates.basis, 'Monthly', 'the monthly basis steps in at 28 days');
  assert.equal(rates.rate, 2325, 'and prints the card\'s agreed monthly rate');
  const monthly = d.getInvoice('INV-003');
  assert.equal(
    d.lineAmountForPeriod(coastal, gn, monthly.cycleStart, monthly.cycleEnd),
    round2(2325 * (1 + hazmat)),
    'which bills once, premium and all (the premium is not folded into the rate twice)',
  );
});

check('an invoice\'s fees are the prototype\'s rates, on the period\'s own base', () => {
  // The fee chain the fixture's invoices carry: env fee from the invoice's own
  // snapshot, a flat 3% waiver when it has one, tax on the lot — all computed from
  // a base that is the *period*, not the order.
  const inv = d.getInvoice('INV-002'); // damageWaiver: true, envFeePct: 5
  const o = order(inv.orderId);
  const t = d.invoiceTotals(inv);
  const base = round2(
    o.lineItems.reduce((s, li) => s + d.lineAmountForPeriod(o, li, inv.cycleStart, inv.cycleEnd), 0),
  );

  assert.equal(t.base, base, 'the base is what this period bills, derived from the lines');
  assert.notEqual(t.base, d.orderAmount(o), 'not the whole order\'s Gross');
  assert.equal(t.envFee, round2(base * (inv.envFeePct / 100)), 'the env fee is the invoice\'s own percent');
  assert.equal(t.waiver, round2(base * 0.03), 'and the waiver 3% of the base, as the prototype computes it');
  assert.notEqual(t.waiver, round2(base * 0.05), 'not the 5% the port slipped in');
  assert.equal(t.tax, round2((base + t.envFee + t.waiver + t.fuel) * inv.taxRate), 'tax on the lot');
  assert.equal(t.total, round2(t.base + t.envFee + t.waiver + t.fuel + t.tax), 'and the total is the chain');
});

check('the cycle length is the party\'s term — read, never stored', () => {
  // Three parties, three cadences, and the fixture's own cycles are exactly
  // start + cadence: 7, 14 and 28 days. A cycle length stored on the order (or the
  // pricing default applied to everyone) could not produce all three.
  assert.equal(d.partyCycleDays(order('CT-2024-001')), 7, 'Halstead bills weekly');
  assert.equal(d.partyCycleDays(order('CT-2024-002')), 14, 'Meridian bi-weekly');
  assert.equal(d.partyCycleDays(order('CT-2024-003')), 28, 'Coastal monthly');
  assert.equal(d.getInvoice('INV-001').cycleEnd, '2026-08-27', 'Halstead: start + 7');
  assert.equal(d.getInvoice('INV-002').cycleEnd, '2026-09-15', 'Meridian: start + 14');
  assert.equal(d.getInvoice('INV-003').cycleEnd, '2026-09-30', 'Coastal: start + 28');
  assert.notEqual(d.partyCycleDays(order('CT-2024-001')), d.pricing.cycleDays, 'not the pricing default');

  // A cadence the store doesn't know — a supplier's `net-30` terms, an empty field
  // — falls back to the pricing setting rather than reading as a zero-day cycle.
  const p = d.getParty('PTY-004');
  const was = p.billingCycle;
  d.updateParty(p.id, { billingCycle: 'net-30' });
  assert.equal(d.partyCycleDays(order('CT-2024-004')), d.pricing.cycleDays, 'unknown cadence → the default');
  d.updateParty(p.id, { billingCycle: was });
  assert.equal(d.partyCycleDays(order('CT-2024-004')), 84, 'and back to the party\'s quarterly cadence');
});

check('a booking\'s cycles add up to its Gross — no unit and no day bills twice', () => {
  const o = order('CT-2024-001');
  const gross = d.orderAmount(o);
  assert.equal(gross, 12959.5, 'the Gross the order screens print');

  // A settled cycle must not stop the clock: the period that follows is a fact of
  // the calendar, not of the cheque (the prototype rolls only *unpaid* invoices).
  d.setInvoiceStatus('INV-001', 'paid');
  assert.equal(d.invoicesFor(o.orderId).length, 1, 'one cycle on file to begin with');

  d.runNextCycle();
  const raised = d.invoicesFor(o.orderId);
  assert.equal(raised.length, 2, 'a run raises the next period');
  assert.equal(raised[1].cycle, 2, 'numbered from 1 on the order, not on the ledger');
  assert.equal(raised[1].cycleStart, '2026-08-27', 'starting where the last period ended');
  assert.equal(raised[1].cycleEnd, '2026-09-03', 'and a week long: the party\'s cadence, not the default');
  assert.equal(raised[1].fuelCharge, raised[0].fuelCharge, 'keeping the terms the last one was raised at');
  assert.equal(raised[1].taxRate, raised[0].taxRate);

  d.runNextCycle();
  assert.equal(d.invoicesFor(o.orderId).length, 3, 'a second run covers the rest of the booking');
  // The windows tile [start, end): each begins where the last ended, and the last
  // ends at the order's own end — so the booking's days are covered exactly once.
  const cycles = d.invoicesFor(o.orderId);
  assert.deepEqual(
    cycles.map((c) => [c.cycle, c.cycleStart, c.cycleEnd]),
    [
      [1, '2026-08-20', '2026-08-27'],
      [2, '2026-08-27', '2026-09-03'],
      [3, '2026-09-03', '2026-09-10'],
    ],
  );

  // The invariant: each line's amounts across the cycles add up to its own total,
  // and the cycle bases add up to the Gross.
  const across = (li) => cycles.reduce((s, c) => s + d.lineAmountForPeriod(o, li, c.cycleStart, c.cycleEnd), 0);
  for (const li of o.lineItems) {
    assert.equal(across(li), d.lineTotal(li, o), `${li.id} adds up across the cycles`);
  }
  assert.equal(
    round2(cycles.reduce((s, c) => s + d.invoiceTotals(c).base, 0)),
    gross,
    'and the period bases add up to the Gross',
  );

  // Nothing left to bill: a run raises no cycle at all — not a $0 period carrying
  // the fuel charge forward, which is what rolling past the end would produce.
  assert.equal(d.runNextCycle(), 0, 'a booking with no days left raises nothing');

  d.setInvoiceStatus('INV-001', 'invoiced'); // put the fixture back as it was found
});

check('the basis steps on the line\'s own days, not the order\'s', () => {
  // CT-2024-004's excavator rides a 24-day order. Narrow the line to three days
  // and the *line* decides the basis: three days of the daily rate, not the four
  // weeks it would bill if the basis read the order's window.
  const o = order('CT-2024-004');
  const li = o.lineItems[0];
  const item = d.getItem('serialized', 'ET-310');
  const premium = d.pricing.riskPremiums.coastal;
  const weekly = round2(item.baseWeekly * 4 * (1 + premium));

  assert.equal(d.orderDays(o), 24, 'the order runs 24 days');
  assert.equal(d.rateBasis(li, item, o).basis, 'Weekly', 'so the booking bills weekly');
  assert.equal(d.lineTotal(li, o), weekly, 'four weeks, as the Gross above it');

  d.updateOrderLineDates(o.orderId, li.id, '2026-08-01', '2026-08-04');
  assert.equal(d.lineDays(li, o), 3, 'the line itself is only three days');
  assert.equal(d.rateBasis(li, item, o).basis, 'Daily', 'which is the daily basis');
  assert.equal(d.rateBasis(li, item, o).rate, item.rateDaily, 'at the catalog\'s daily rate');
  assert.equal(d.lineTotal(li, o), round2(item.rateDaily * 3 * (1 + premium)), 'three days of it, premium and all');
  // The invoice reads the same basis for the same window — one day source, two
  // readers, so the row and the bill cannot disagree.
  assert.equal(d.lineAmountForPeriod(o, li, o.startDate, o.endDate), d.lineTotal(li, o), 'and the bill agrees');

  d.updateOrderLineDates(o.orderId, li.id, '2026-08-01', '2026-08-25');
  assert.equal(d.lineDays(li, o), 24, 'put back');
  assert.equal(d.lineTotal(li, o), weekly, 'and the four weeks are back');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck13: ${n} checks`);
