import assert from 'node:assert/strict';

/* ================= the pure helpers the pages lean on =================
 *
 * The gap this closes (angular-refactor-log.md, P9): 24 harnesses prove the *store* —
 * tables, mutators, guards, the fixture — and none of them touched the small pure
 * functions every page prints through. `statusClass()` colours every status badge,
 * `needsReorder()` decides the dashboard's reorder list, the type predicates decide
 * whether a row shape is even possible, `verticalLabel`/`roleLabel`/`periodPhrase` are
 * display strings, and `fmtDate` is the store's own date format. A wrong answer in any
 * of them is a wrong screen, and until now nothing checked them.
 *
 * They are pure (or take only the store as a reader), so they need no DOM — which is
 * the whole point: with no browser on this box, this is the layer that *can* be tested.
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
const {
  CATALOG_TYPES,
  ROLES,
  behaviourOfType,
  isCountedStock,
  isLevelTracked,
  isPurchasable,
  isUnitStock,
  needsReorder,
  roleLabel,
  statusClass,
  typeForBehaviour,
  verticalLabel,
} = await import('./models.js');
/* `periodPhrase`/`periodLabel`/`mondayOf` live in `period.ts` (the store re-exports them). */
const { mondayOf, periodLabel, periodPhrase } = await import('./period.js');

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

const d = new DataService();
const types = CATALOG_TYPES.map((t) => t.key);

check('statusClass maps the statuses the pages print, and falls back rather than throwing', () => {
  assert.equal(statusClass('Available'), 'available');
  assert.equal(statusClass('On Rent'), 'onrent');
  assert.equal(statusClass('Inactive'), 'out');
  assert.equal(statusClass('Completed'), 'closed');
  assert.equal(statusClass('Nonsense'), 'available', 'an unknown status still gets a badge class');
  for (const s of ['Available', 'On Rent', 'In Shop', 'Staged', 'In Use', 'Inactive', 'Active', 'Completed', 'In Progress', 'Pending']) {
    assert.ok(/^[a-z]+$/.test(statusClass(s)), `${s} -> a CSS-safe suffix`);
  }
});

check('needsReorder is a threshold with a boundary and a "no point set" case', () => {
  assert.equal(needsReorder({ qtyOnHand: 4, reorderPoint: 5 }), true);
  assert.equal(needsReorder({ qtyOnHand: 5, reorderPoint: 5 }), true, 'at the point is due');
  assert.equal(needsReorder({ qtyOnHand: 6, reorderPoint: 5 }), false);
  assert.equal(needsReorder({ qtyOnHand: 0, reorderPoint: 0 }), false, 'no point set: never due');
  assert.equal(needsReorder({ qty: 2, reorderPoint: 3 }), true, 'a unit row reads `qty` when it has no explicit on-hand');
});

check('the type predicates agree with each other about what a row can be', () => {
  assert.deepEqual(types.filter(isUnitStock), ['serialized']);
  assert.deepEqual(types.filter(isCountedStock), ['bulk', 'consumable', 'part']);
  assert.deepEqual(types.filter(isLevelTracked), ['bulk', 'consumable', 'part', 'kit', 'attachment']);
  assert.deepEqual(types.filter(isPurchasable), types.filter((t) => t !== 'labor'));
  for (const t of types.filter(isCountedStock)) {
    assert.equal(isLevelTracked(t), true, `${t} is counted, so it must be level-tracked`);
    assert.equal(isUnitStock(t), false, `${t} is not a unit row`);
  }
  assert.equal(isLevelTracked('serialized'), false, 'a unit row lives in `items`, not `stock_levels`');
  assert.equal(isUnitStock('labor'), false, 'a person is not a unit of stock');
});

check('behaviour is a two-way street: every behaviour names a type that names it back', () => {
  for (const t of types) {
    const b = behaviourOfType(t);
    assert.equal(behaviourOfType(typeForBehaviour(b)), b, `${t} -> ${b} -> back`);
  }
  assert.equal(behaviourOfType('serialized'), 'serialized');
  assert.equal(behaviourOfType('labor'), 'labor');
  assert.equal(behaviourOfType('part'), 'quantity');
  assert.equal(typeForBehaviour('quantity'), 'consumable', 'the quantity spine lands on consumable');
});

check('the display strings fall back to the key they were asked about', () => {
  assert.equal(verticalLabel('HeavyEquipment'), 'Heavy Equipment Rental');
  assert.equal(verticalLabel('Warehouse'), 'Warehouse / 3PL');
  assert.equal(verticalLabel('not-a-vertical'), 'not-a-vertical', 'an unknown key prints itself, not "undefined"');
  for (const r of ROLES) assert.ok(roleLabel(r.key).length > 0, `${r.key} has a label`);
  assert.ok(roleLabel('not-a-role').length > 0, 'an unknown role still prints something');
  assert.notEqual(roleLabel('not-a-role'), roleLabel('owner'), 'and it is not the most privileged label');
});

check('periodPhrase reads as a sentence for week/month and stays the label for a day', () => {
  const monday = new Date(2026, 7, 3); // Mon 3 Aug 2026
  assert.equal(periodPhrase('day', monday), periodLabel('day', monday));
  assert.ok(periodPhrase('week', monday).startsWith('the week of '), periodPhrase('week', monday));
  assert.ok(periodPhrase('month', monday).startsWith('the month of '), periodPhrase('month', monday));
  for (const day of [3, 4, 5, 6, 9]) {
    assert.equal(
      periodPhrase('week', mondayOf(new Date(2026, 7, day))),
      'the week of Aug 3, 2026',
      'once the date is the first day of the period, any day in that week reads the same',
    );
  }
  /* The contract, pinned so a change is noticed: these two format the date they are
     *given* — the per-period anchoring is the pager's job (it keeps the cursor on the
     period's first day; see `docs/HANDOFF.md`). A caller passing a mid-week date gets a
     mid-week label, which is why every pager normalises first. */
  assert.equal(periodPhrase('week', new Date(2026, 7, 6)), 'the week of Aug 6, 2026');
  assert.equal(periodPhrase('month', new Date(2026, 7, 20)), 'the month of August 2026', 'a month reads the same all month');
});

check('the store\'s own date format is MM/DD/YYYY with an em dash for nothing', () => {
  assert.equal(d.fmtDate('2026-08-01'), '08/01/2026');
  assert.equal(d.fmtDate('2026-12-31'), '12/31/2026');
  assert.equal(d.fmtDate(null), '—');
  assert.equal(d.fmtDate(''), '—');
});

console.log(`\ncheck25: ${n} checks`);
