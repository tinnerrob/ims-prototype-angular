import assert from 'node:assert/strict';

/* ============ the two workspace-wide buttons (Phase H) ============
 *
 * **Load sample data** and **Remove all sample data** each replace the whole store,
 * which makes them the two easiest things in the app to get subtly wrong: a wipe that
 * forgets a table, or a reload that re-seeds *almost* the fixture.
 *
 * So the headline assertion here is not "the counts came back" — it is the strongest
 * one available without a browser: a store that has been **wiped and re-loaded
 * persists the same bytes** as a store that has never been touched. Same rows, same
 * ids, same totals, same attribution stamps; `cmp`-clean, the same proof P6/2 used
 * when the seed left the store. Everything else in this file defends a way that could
 * break: a table nobody cleared, a dropped baseline that would stamp every seeded row
 * with today's date and the session's user, an id sequence that restarts and collides.
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
const KEY = 'ims-web.store';

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

/** Where two snapshots first differ, with a little context — a diff you can read. */
const firstDiff = (a, b) => {
  if (a === b) return '';
  let i = 0;
  const len = Math.min(a.length, b.length);
  while (i < len && a[i] === b[i]) i++;
  return (
    `\n      first difference at char ${i} of ${a.length} vs ${b.length}` +
    `\n      A: …${a.slice(Math.max(0, i - 40), i + 40)}…` +
    `\n      B: …${b.slice(Math.max(0, i - 40), i + 40)}…`
  );
};

/** A store nobody has touched, and the snapshot it persists — the baseline. */
mem.clear();
const fresh = new DataService();
const fixture = mem.get(KEY);
assert.ok(fixture && fixture.length > 10_000, 'the fixture persisted a snapshot to compare against');

/** A store wiped and then re-loaded — what the two buttons produce together. */
const reloaded = () => {
  mem.clear();
  const d = new DataService();
  d.clearAllData();
  d.loadSampleData();
  return d;
};

/** Every row the workspace holds, by table — the harness's own tally, built from the
 *  store's accessors (the page that shows it owns the wording, see `sample-data`). */
const tally = (d) => [
  ['Business types', d.listVerticals().length],
  ['Categories', d.listCategories().length],
  ['Parties & suppliers', d.listParties().length],
  ['Price cards', d.listPriceCards().length],
  ['Assets', d.allItems().length],
  ['Stock levels', d.listStockLevels().length],
  ['Movements', d.listMovements().length],
  ['Orders', d.listOrders().length],
  ['Purchase orders', d.listPurchaseOrders().length],
  ['Receipts', d.listReceipts().length],
  ['Inspections', d.listInspections().length],
  ['Work orders', d.listWorkOrders().length],
  ['Timesheets', d.listTimesheets().length],
  ['Sub-rentals', d.listRentals().length],
  ['Fleet', d.listVehicles().length],
  ['Dispatches', d.listDispatches().length],
  ['Invoices', d.listInvoices().length],
  ['Documents', d.listDocuments().length],
  ['Count sheets', d.listCountSessions().length],
  ['Locations', d.listLocations().length],
  ['Form schemas', d.listFormSchemas().length],
];

check('the fixture is a full workspace — every table those buttons touch has rows', () => {
  const counts = tally(fresh);
  assert.equal(counts.length, 21, `the tally covers the store (${counts.length} tables)`);
  assert.equal(new Set(counts.map(([label]) => label)).size, counts.length, 'no table is named twice');
  const empty = counts.filter(([, count]) => count === 0).map(([label]) => label);
  assert.deepEqual(empty, ['Count sheets'], 'the table the fixture leaves empty is the only one: ' + empty.join(', '));
});

check('remove all sample data empties every table and keeps the workspace', () => {
  mem.clear();
  const d = new DataService();
  d.clearAllData();

  const held = tally(d).filter(([, count]) => count > 0);
  assert.deepEqual(held, [], 'nothing is left: ' + JSON.stringify(held));
  assert.equal(d.allItems().length, 0, 'no assets');
  assert.equal(d.listParties().length, 0, 'no parties or suppliers');
  assert.equal(d.listOrders().length, 0, 'no orders');
  assert.equal(d.listPurchaseOrders().length, 0, 'no purchase orders');
  assert.equal(d.listTimesheets().length, 0, 'no timesheets');
  assert.equal(d.listRentals().length, 0, 'no sub-rentals');
  assert.equal(d.listVehicles().length, 0, 'no fleet');
  assert.deepEqual(d.listVerticals(), [], 'no business types');
  assert.deepEqual(d.listFormSchemas(), [], 'no form schemas');
  assert.deepEqual(d.stockSchema().fields, [], 'no stock set');
  assert.deepEqual(d.categoriesForVertical('anything'), [], 'and no categories to hang on one');

  // The workspace itself survives, or the app could not render at all.
  assert.ok(d.activeTenant, 'the tenant is still there');
  assert.ok(d.listUsers().length > 0, 'and its people');
  assert.equal(d.activeUser?.id, d.sessionUserId(), 'with the session still acting as one of them');
  assert.equal(d.activeTenant.verticalId, '', 'its business type is cleared with the row it named');
  assert.equal(d.activeVertical(), undefined, 'so there is no type to fall back to');
});

check('a wiped workspace, reloaded, persists the same bytes as a fresh one', () => {
  const d = reloaded();
  assert.ok(d.allItems().length > 0, 'the fixture is back');
  assert.equal(mem.get(KEY), fixture, 'the two snapshots differ' + firstDiff(fixture, mem.get(KEY)));
});

check('the loaded rows keep the fixture’s own stamps — the button is not their author', () => {
  const d = reloaded();
  const stamp = (rows) => rows.map((r) => `${r.createdBy}@${r.createdAt}`);
  assert.deepEqual(
    stamp(d.listOrders()),
    stamp(fresh.listOrders()),
    'the same author and clock a first load gives them',
  );
  assert.deepEqual(stamp(d.listTimesheets()), stamp(fresh.listTimesheets()));
  // The failure this guards: without dropping the diff baseline *before* the seed
  // re-posts its receipts, `save()` reads 92 kB of brand-new rows and stamps them all
  // with today's date and the signed-in user.
  const today = new Date().toISOString().slice(0, 10);
  const rows = [...d.listOrders(), ...d.listPurchaseOrders(), ...d.listParties(), ...d.listTimesheets()];
  assert.equal(rows.some((r) => String(r.createdAt).startsWith(today)), false, `none is stamped ${today}`);
});

check('a row written after a reload belongs to the session that wrote it', () => {
  const d = reloaded();
  const row = d.createParty({ name: 'Written After Reload', kinds: ['customer'] });
  assert.equal(row.createdBy, d.sessionUserId(), 'the session wrote it');
  assert.equal(row.tenantId, d.sessionTenantId(), 'in the workspace it belongs to');
  assert.ok(row.createdAt > d.listOrders()[0].createdAt, 'dated now, not with the seed clock');
  // …and one write does not drag the fixture along with it.
  assert.equal(d.listOrders()[0].createdBy, fresh.listOrders()[0].createdBy, 'the seeded rows keep their author');
  assert.equal(d.listOrders()[0].updatedBy, fresh.listOrders()[0].updatedBy, 'and are not marked as edited');
});

check('the id sequences keep their place across a reload', () => {
  mem.clear();
  const d = new DataService();
  const before = d.listPurchaseOrders().map((p) => p.id);
  d.clearAllData();
  d.loadSampleData();
  assert.deepEqual(d.listPurchaseOrders().map((p) => p.id), before, 'the same ids, in the same order');
  const ids = d.listParties().map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no id appears twice');
  const added = d.createParty({ name: 'Next One', kinds: ['customer'] });
  assert.equal(d.listParties().filter((p) => p.id === added.id).length, 1, 'a new row still gets a free id');
  assert.equal(ids.includes(added.id), false, 'not one the fixture had already used');
});

check('both buttons are idempotent — a second press changes nothing', () => {
  mem.clear();
  const d = new DataService();
  d.loadSampleData();
  const once = mem.get(KEY);
  d.loadSampleData();
  assert.equal(mem.get(KEY), once, 'loading twice stores the same snapshot' + firstDiff(once, mem.get(KEY)));
  d.clearAllData();
  const wiped = mem.get(KEY);
  d.clearAllData();
  assert.equal(mem.get(KEY), wiped, 'and wiping twice does too' + firstDiff(wiped, mem.get(KEY)));
  assert.notEqual(wiped, once, 'the two end states are genuinely different');
  assert.ok(wiped.length < once.length, 'the empty one is the smaller snapshot');
});

check('an emptied workspace is still a workspace — it can be built up from nothing', () => {
  mem.clear();
  const d = new DataService();
  d.clearAllData();
  const vertical = d.createVertical({ name: 'Marine', slug: 'marine', active: true, isDefault: true });
  d.setActiveVertical(vertical.id);
  assert.equal(d.activeVertical().id, vertical.id, 'a business type can be defined and chosen');
  const cat = d.createCategory(vertical.id, {
    name: 'Vessels',
    icon: 'bi-water',
    behaviour: 'serialized',
    active: true,
    fields: [],
  });
  const row = d.createItem(cat.type, {
    name: 'Hull No. 1',
    category: cat.name,
    categoryId: cat.id,
    status: 'Available',
    qty: 1,
    rateDaily: 40,
  });
  assert.equal(d.listItems(cat.type).length, 1, 'an asset can be filed in it');
  assert.equal(d.categoryItemCount(cat.id), 1, 'and counted under its tab');
  assert.equal(d.getCategory(row.categoryId).name, 'Vessels', 'with the name the tab shows');
  // The page's tally is built from these same reads — it has to follow, not remember.
  assert.equal(tally(d).find(([label]) => label === 'Business types')[1], 1);
  assert.equal(tally(d).find(([label]) => label === 'Assets')[1], 1);
  // And the demo can come back on top of a workspace someone has started.
  d.loadSampleData();
  assert.ok(d.listParties().length > 0, 'loading the sample data over it works');
  assert.equal(d.activeVertical().isDefault, true, 'and the workspace is back on the fixture’s type');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck32: ${n} checks`);
