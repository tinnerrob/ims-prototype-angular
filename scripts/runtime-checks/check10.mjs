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

/* ============ A9: configuration is a tenant's data too ============
 *
 * A8's document closed with a hole it named out loud: the settings tables
 * (`location_types`, `tax_schedules`, `overheads`, `pricing`, `yard`) were the
 * only rows a screen writes that `auditedRows()` did not cover, so Admin could add
 * a location type and nothing recorded who did. These checks hold the other side
 * of that: every configuration row is stamped, a write through any settings
 * mutator is attributed to the acting user, an edit re-stamps without touching the
 * create stamps, and a *rename* — which moves a settings row's natural key, or
 * cascades into the rows that print a category's name — keeps the row's history
 * instead of reading as a delete + create.
 *
 * Phase C folded the prototype's per-type category list into the tenant's
 * `asset_categories`, so the category half of this file now exercises *those* rows
 * — the same surface, one table.
 */

mem.clear();
const d = new DataService();

const TENANT = 'TNT-NORTHLINE';

/** The workspace's business type (a workspace is one). */
const MY_VERTICAL = d.activeVertical().id;

/** A category **name** of a catalog type — the derived label items carry. */
const catName = (type) => d.categoriesForVertical(MY_VERTICAL).find((c) => c.type === type)?.name ?? '';

/** Every configuration row in the store, labelled for the failure messages. */
function configRows() {
  const out = [];
  for (const t of d.locationTypeRecords()) out.push([`location type ${t.name}`, t]);
  for (const v of d.listVerticals()) {
    for (const c of d.categoriesForVertical(v.id)) out.push([`category ${c.name}`, c]);
  }
  for (const t of d.listTaxSchedules()) out.push([`tax schedule ${t.code}`, t]);
  for (const o of d.listOverheads()) out.push([`overhead ${o.id}`, o]);
  out.push(['pricing', d.pricing]);
  out.push(['yard', d.yard]);
  return out;
}

check('every seeded configuration row carries tenant + author stamps', () => {
  const rows = configRows();
  assert.ok(rows.length > 20, `a real sample (${rows.length} rows)`);
  for (const [label, r] of rows) {
    assert.equal(r.tenantId, TENANT, `tenantId on ${label}`);
    assert.ok(r.createdAt, `createdAt on ${label}`);
    assert.ok(r.createdBy, `createdBy on ${label}`);
    assert.equal(r.updatedAt, r.createdAt, `updatedAt mirrors the create on ${label}`);
    assert.equal(r.updatedBy, r.createdBy, `updatedBy mirrors the create on ${label}`);
  }
});

check('a workspace row is authored by a user the store knows', () => {
  for (const [label, r] of configRows()) {
    assert.match(r.createdBy, /^USR-\d+$/, `createdBy on ${label}`);
    assert.notEqual(d.userName(r.createdBy), r.createdBy, `createdBy resolves on ${label}`);
  }
});


check('a new category is attributed to the acting user', () => {
  d.setSessionUser('USR-004');
  d.createCategory(MY_VERTICAL, {
    name: 'Bench Consumables',
    icon: 'bi-box',
    behaviour: 'quantity',
    active: true,
    fields: [],
  });
  const rec = d.categoriesForVertical(MY_VERTICAL).find((c) => c.name === 'Bench Consumables');
  assert.ok(rec, 'the category was added');
  assert.equal(rec.tenantId, TENANT);
  assert.equal(rec.createdBy, 'USR-004');
  assert.equal(rec.updatedBy, 'USR-004');
  assert.ok(rec.createdAt);
});

check('an edit re-stamps the settings row without touching its create stamps', () => {
  const before = d.listTaxSchedules().find((t) => t.code === 'GA');
  const created = { at: before.createdAt, by: before.createdBy };
  d.setSessionUser('USR-005');
  d.updateTaxSchedule('GA', { rate: 0.0725 });
  const after = d.listTaxSchedules().find((t) => t.code === 'GA');
  assert.equal(after.rate, 0.0725, 'the field it may set');
  assert.equal(after.createdBy, created.by, 'author is history');
  assert.equal(after.createdAt, created.at);
  assert.equal(after.updatedBy, 'USR-005', 'last writer wins');
  d.setSessionUser('USR-003');
});

check('a rename keeps the row it renamed, not a new one', () => {
  d.setSessionUser('USR-004');
  d.addLocationType('Staging Lane');
  const created = d.locationTypeRecords().find((t) => t.name === 'Staging Lane');
  const born = { at: created.createdAt, by: created.createdBy };
  // A settings row is keyed by its natural key, so the rename moves the key while
  // the row object stays: the stamps must follow the row, not the key.
  d.setSessionUser('USR-005');
  d.renameLocationType('Staging Lane', 'Staging Row');
  const after = d.locationTypeRecords().find((t) => t.name === 'Staging Row');
  assert.ok(after, 'the type is under its new name');
  assert.equal(after.createdAt, born.at, 'a rename is not a re-create');
  assert.equal(after.createdBy, born.by, 'the original author survives the rename');
  assert.equal(after.updatedBy, 'USR-005', 'and the rename has an author of its own');
  // `>=`, not `!=`: a create and a rename inside the same millisecond are
  // legitimate, and the created-at/created-by checks above already prove the row
  // was not re-created. The flaky `!=` form failed intermittently in CI.
  assert.ok(after.updatedAt >= after.createdAt, 'the rename is stamped at or after the row was created');
  d.setSessionUser('USR-003');
});

check('a renamed category keeps its history — and carries its rows with it', () => {
  const born = d.categoriesForVertical(MY_VERTICAL).find((c) => c.name === 'Bench Consumables');
  const at = born.createdAt;
  // A row filed under it: the name it prints is denormalised, so the rename has to
  // cascade (the prototype's `renameCategory` did the same for its list).
  d.setSessionUser('USR-004');
  const filed = d.createItem('part', {
    name: 'Filing Probe',
    category: born.name,
    categoryId: born.id,
    status: 'In Stock',
    qty: 1,
    rateDaily: 0,
  });
  assert.equal(filed.category, 'Bench Consumables');

  d.setSessionUser('USR-005');
  d.updateCategory(born.id, { name: 'Bench Stock' });
  const after = d.categoriesForVertical(MY_VERTICAL).find((c) => c.id === born.id);
  assert.equal(after.name, 'Bench Stock', 'the category is under its new name');
  assert.equal(after.createdAt, at, 'the rename moved the key, not the row');
  assert.equal(after.createdBy, 'USR-004');
  assert.equal(after.updatedBy, 'USR-005', 'and the rename has an author of its own');
  const moved = d.allItems().find((i) => i.id === filed.id);
  assert.equal(moved.category, 'Bench Stock', 'the row it was filed under followed the name');
  assert.equal(moved.categoryId, born.id, 'and still points at the same category');
  d.setSessionUser('USR-003');
});


check('a singleton settings row (pricing) is stamped and re-stamped', () => {
  const created = { at: d.pricing.createdAt, by: d.pricing.createdBy };
  assert.equal(d.pricing.tenantId, TENANT);
  assert.ok(created.at && created.by, 'the seeded row is backfilled');
  d.setSessionUser('USR-005');
  d.updatePricing({ dailyMinHours: 5 });
  assert.equal(d.pricing.dailyMinHours, 5);
  assert.equal(d.pricing.createdBy, created.by, 'create stamps untouched');
  assert.equal(d.pricing.createdAt, created.at);
  assert.equal(d.pricing.updatedBy, 'USR-005');
  d.setSessionUser('USR-003');
});

check('a configuration write does not smear its neighbours', () => {
  const yard = { at: d.yard.updatedAt, by: d.yard.updatedBy };
  const overhead = d.listOverheads()[0];
  const untouched = { at: overhead.updatedAt, by: overhead.updatedBy };
  d.createCategory(MY_VERTICAL, { name: 'Another One', icon: 'bi-box', behaviour: 'quantity', active: true, fields: [] });
  assert.equal(d.yard.updatedAt, yard.at, 'the yard row was not written');
  assert.equal(d.yard.updatedBy, yard.by);
  const after = d.listOverheads()[0];
  assert.equal(after.updatedAt, untouched.at, 'nor was the first overhead');
  assert.equal(after.updatedBy, untouched.by);
});

check('the whole settings surface is stamped after an unrelated write', () => {
  // The hole A8 named was "a table the writer does not cover", so the sweep is the
  // point: a settings table added later has to be reachable through a mutator and
  // listed in `auditedRows()` for this to pass.
  d.createItem('part', {
    name: 'Sweep Probe',
    category: catName('part'),
    status: 'In Stock',
    qty: 1,
    rateDaily: 0,
  });
  for (const [label, r] of configRows()) {
    assert.ok(r.tenantId, `tenantId on ${label}`);
    assert.ok(r.createdAt && r.createdBy, `create stamps on ${label}`);
    assert.ok(r.updatedAt && r.updatedBy, `update stamps on ${label}`);
  }
});

check('the user the stamps name is the acting user', () => {
  d.setSessionUser('USR-002');
  const made = d.createCategory(MY_VERTICAL, {
    name: 'Session Probe',
    icon: 'bi-box',
    behaviour: 'quantity',
    active: true,
    fields: [],
  });
  assert.equal(made.createdBy, 'USR-002');
  assert.equal(d.userName(made.createdBy), 'Priya Raman');
  d.setSessionUser('USR-003');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck10: ${n} checks`);
