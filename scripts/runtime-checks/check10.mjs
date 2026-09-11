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

/* ============ A9: configuration is a tenant's data too ============
 *
 * A8's document closed with a hole it named out loud: the settings tables
 * (`location_types`, `categories`, `tax_schedules`, `overheads`, `pricing`,
 * `yard`) were the only rows a screen writes that `auditedRows()` did not cover,
 * so Admin could add a category and nothing recorded who did. These checks hold
 * the other side of that: every configuration row is stamped, a write through any
 * settings mutator is attributed to the acting user, an edit re-stamps without
 * touching the create stamps, and a *rename* — which moves a settings row's
 * natural key — keeps the row's history instead of reading as a delete + create.
 */

mem.clear();
const d = new DataService();

/* B2: the fixture ships signed out, so a check that asserts who authored a write
   signs in first (the switcher it used to call is gone). */
await signInAs(d, 'USR-003');

const TENANT = 'TNT-NORTHLINE';

/** Every configuration row in the store, labelled for the failure messages. */
function configRows() {
  const out = [];
  for (const t of d.locationTypeRecords()) out.push([`location type ${t.name}`, t]);
  for (const [type, rows] of Object.entries(d.categories)) {
    for (const c of rows) out.push([`category ${type}/${c.name}`, c]);
  }
  for (const t of d.listTaxSchedules()) out.push([`tax schedule ${t.code}`, t]);
  for (const o of d.listOverheads()) out.push([`overhead ${o.id}`, o]);
  out.push(['pricing', d.pricing]);
  out.push(['yard', d.yard]);
  return out;
}

await check('every seeded configuration row carries tenant + author stamps', async () => {
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

await check('a workspace row is authored by a user the store knows', async () => {
  for (const [label, r] of configRows()) {
    assert.match(r.createdBy, /^USR-\d+$/, `createdBy on ${label}`);
    assert.notEqual(d.userName(r.createdBy), r.createdBy, `createdBy resolves on ${label}`);
  }
});


await check('a new category is attributed to the acting user', async () => {
  await signInAs(d, 'USR-004');
  d.addCategory('part', 'Bench Consumables');
  const rec = d.categoryRecordsFor('part').find((c) => c.name === 'Bench Consumables');
  assert.ok(rec, 'the category was added');
  assert.equal(rec.tenantId, TENANT);
  assert.equal(rec.createdBy, 'USR-004');
  assert.equal(rec.updatedBy, 'USR-004');
  assert.ok(rec.createdAt);
});

await check('an edit re-stamps the settings row without touching its create stamps', async () => {
  const before = d.listTaxSchedules().find((t) => t.code === 'GA');
  const created = { at: before.createdAt, by: before.createdBy };
  await signInAs(d, 'USR-005');
  d.updateTaxSchedule('GA', { rate: 0.0725 });
  const after = d.listTaxSchedules().find((t) => t.code === 'GA');
  assert.equal(after.rate, 0.0725, 'the field it may set');
  assert.equal(after.createdBy, created.by, 'author is history');
  assert.equal(after.createdAt, created.at);
  assert.equal(after.updatedBy, 'USR-005', 'last writer wins');
  await signInAs(d, 'USR-003');
});

await check('a rename keeps the row it renamed, not a new one', async () => {
  await signInAs(d, 'USR-004');
  d.addLocationType('Staging Lane');
  const created = d.locationTypeRecords().find((t) => t.name === 'Staging Lane');
  const born = { at: created.createdAt, by: created.createdBy };
  // A settings row is keyed by its natural key, so the rename moves the key while
  // the row object stays: the stamps must follow the row, not the key.
  await signInAs(d, 'USR-005');
  d.renameLocationType('Staging Lane', 'Staging Row');
  const after = d.locationTypeRecords().find((t) => t.name === 'Staging Row');
  assert.ok(after, 'the type is under its new name');
  assert.equal(after.createdAt, born.at, 'a rename is not a re-create');
  assert.equal(after.createdBy, born.by, 'the original author survives the rename');
  assert.equal(after.updatedBy, 'USR-005', 'and the rename has an author of its own');
  assert.notEqual(after.updatedAt, after.createdAt);
  await signInAs(d, 'USR-003');
});

await check('a renamed category keeps its history too', async () => {
  const born = d.categoryRecordsFor('part').find((c) => c.name === 'Bench Consumables');
  const at = born.createdAt;
  await signInAs(d, 'USR-004');
  d.renameCategory('part', 'Bench Consumables', 'Bench Stock');
  const after = d.categoryRecordsFor('part').find((c) => c.name === 'Bench Stock');
  assert.ok(after, 'the category is under its new name');
  assert.equal(after.createdAt, at, 'the rename moved the key, not the row');
  assert.equal(after.createdBy, 'USR-004');
  assert.equal(after.updatedBy, 'USR-004');
});


await check('a singleton settings row (pricing) is stamped and re-stamped', async () => {
  const created = { at: d.pricing.createdAt, by: d.pricing.createdBy };
  assert.equal(d.pricing.tenantId, TENANT);
  assert.ok(created.at && created.by, 'the seeded row is backfilled');
  await signInAs(d, 'USR-005');
  d.updatePricing({ dailyMinHours: 5 });
  assert.equal(d.pricing.dailyMinHours, 5);
  assert.equal(d.pricing.createdBy, created.by, 'create stamps untouched');
  assert.equal(d.pricing.createdAt, created.at);
  assert.equal(d.pricing.updatedBy, 'USR-005');
  await signInAs(d, 'USR-003');
});

await check('a configuration write does not smear its neighbours', async () => {
  const yard = { at: d.yard.updatedAt, by: d.yard.updatedBy };
  const overhead = d.listOverheads()[0];
  const untouched = { at: overhead.updatedAt, by: overhead.updatedBy };
  d.addCategory('part', 'Another One');
  assert.equal(d.yard.updatedAt, yard.at, 'the yard row was not written');
  assert.equal(d.yard.updatedBy, yard.by);
  const after = d.listOverheads()[0];
  assert.equal(after.updatedAt, untouched.at, 'nor was the first overhead');
  assert.equal(after.updatedBy, untouched.by);
});

await check('the whole settings surface is stamped after an unrelated write', async () => {
  // The hole A8 named was "a table the writer does not cover", so the sweep is the
  // point: a settings table added later has to be reachable through a mutator and
  // listed in `auditedRows()` for this to pass.
  d.createItem('part', {
    name: 'Sweep Probe',
    category: d.categoriesFor('part')[0],
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

await check('the user the stamps name is the acting user', async () => {
  await signInAs(d, 'USR-002');
  d.addCategory('bulk', 'Session Probe');
  const rec = d.categoryRecordsFor('bulk').find((c) => c.name === 'Session Probe');
  assert.equal(rec.createdBy, 'USR-002');
  assert.equal(d.userName(rec.createdBy), 'Priya Raman');
  await signInAs(d, 'USR-003');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck10: ${n} checks`);
