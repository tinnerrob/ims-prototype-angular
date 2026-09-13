import assert from 'node:assert/strict';

/* ============ Phase C cleanup: a catalog that is *in use* ============
 *
 * Two things the fixture needed before a workspace can use the category system:
 *  - its rows are **linked to categories** (the fixture predates categories, so an
 *    item with no `categoryId` was the visible "0 items" garbage in the authoring
 *    screen);
 *  - a workspace can **start clean** — drop the sample catalog and define its own —
 *    without losing what it *is* (locations, partners, settings, verticals).
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

check('the fixture is linked to the tenant categories', () => {
  const vertical = d.activeVertical();
  const ids = new Set(d.categoriesForVertical(vertical.id).map((c) => c.id));
  const items = d.allItems();
  assert.ok(items.length > 0, 'there are seeded rows');
  assert.equal(items.every((i) => i.categoryId), true, 'every row names a category');
  assert.equal(items.every((i) => ids.has(i.categoryId)), true, "and it is one of the active vertical's");
  assert.equal(
    items.every((i) => d.getCategory(i.categoryId).name === i.category),
    true,
    'the name it prints is the category row’s own name (denormalised, not a stale label)',
  );
  assert.ok(
    d.categoriesForVertical(vertical.id).some((c) => d.categoryItemCount(c.id) > 0),
    'so a category in the authoring screen shows real items, not 0',
  );
  // Idempotent: a second construction leaves the links alone.
  const again = new DataService();
  assert.equal(again.allItems().every((i) => !!i.categoryId), true, 'the links survive a reload');
});

check('a category picker offers the tenant rows for the type', () => {
  const vertical = d.activeVertical();
  const serialized = d.categoriesForVertical(vertical.id).filter((c) => c.type === 'serialized');
  assert.ok(serialized.length >= 1, 'the picker has a category for a serialized row');
  assert.equal(
    d.allItems().filter((i) => i.type === 'serialized').every((i) => serialized.some((c) => c.id === i.categoryId)),
    true,
    'and every serialized row points at one of them',
  );
});

check('start clean empties the catalog but keeps the workspace', () => {
  const verticals = d.listVerticals().length;
  const locations = d.listLocations().length;
  const parties = d.listParties().length;

  d.resetCatalog();

  assert.equal(d.allItems().length, 0, 'no assets');
  assert.equal(d.listStockLevels().length, 0, 'no shelves');
  assert.equal(d.listMovements().length, 0, 'no ledger');
  assert.equal(d.listReceipts().length, 0, 'no receipts');
  assert.deepEqual(d.categoriesForVertical(d.activeVertical().id), [], 'no categories');
  assert.deepEqual(d.stockSchema().fields, [], 'no stock fields');
  assert.equal(d.listFormSchemas('item').length, 0, 'the legacy item schemas go too');
  assert.equal(d.listFormSchemas('inspection').length, 1, 'the inspection template stays (another scope)');
  assert.equal(d.listVerticals().length, verticals, 'the verticals are kept — the tenant edits them');
  assert.equal(d.listLocations().length, locations, 'locations are kept');
  assert.equal(d.listParties().length, parties, 'partners are kept');

  const again = new DataService();
  assert.equal(again.allItems().length, 0, 'and the reset persists');
  assert.equal(again.listVerticals().length, verticals, 'with the verticals intact');
});

check('a business type removes with its categories — even the one in use', () => {
  // This file's "start clean" left the store empty, so the type in use holds
  // nothing: it removes, and the workspace moves off it.
  const w = new DataService();
  const def = w.listVerticals().find((v) => v.isDefault);
  const mine = w.activeVertical();
  assert.equal(mine.id, def.id, 'the fixture is on the default type');
  assert.deepEqual(w.verticalRemovalBlockers(mine.id), [], 'an empty type is not blocked for being in use');

  const custom = w.createVertical({ name: 'Marine', slug: 'marine', active: true, isDefault: false });
  w.createCategory(custom.id, { name: 'Vessels', icon: 'bi-box', behaviour: 'serialized', active: true, fields: [] });
  w.setActiveVertical(custom.id);
  assert.equal(w.activeVertical().id, custom.id, 'the workspace is on the authored type');
  assert.equal(w.removeVertical(custom.id), true, 'the type the workspace is on removes');
  assert.deepEqual(w.categoriesForVertical(custom.id), [], 'and its categories go with it');
  assert.equal(w.activeVertical().id, def.id, 'the workspace falls back to the default type');

  // A type holding rows is still refused — that guard is *data* (a row names the
  // category), not policy about being in use.
  const cat = w.createCategory(def.id, {
    name: 'Pumps',
    icon: 'bi-box',
    behaviour: 'serialized',
    active: true,
    fields: [],
  });
  w.createItem('serialized', {
    name: 'Pump',
    category: cat.name,
    categoryId: cat.id,
    status: 'Available',
    qty: 1,
    rateDaily: 0,
  });
  assert.deepEqual(w.verticalRemovalBlockers(def.id), ['1 item(s)'], 'a row in it is the reason');
  assert.equal(w.removeVertical(def.id), false, 'so it is refused');

  // And the last one left is kept, whatever it holds: a workspace has to be something.
  for (const v of w.listVerticals()) if (v.id !== def.id) w.removeVertical(v.id);
  assert.equal(w.listVerticals().length, 1, 'the unused types went');
  assert.deepEqual(
    w.verticalRemovalBlockers(def.id),
    ['the only business type left', '1 item(s)'],
    'both reasons, in order',
  );
  assert.equal(w.removeVertical(def.id), false, 'the last business type stays');
});

check('every type in the tab strip carries the title the add button reads', () => {
  // The Assets button and its empty state read `New <the open tab's title>`, and
  // the title is the tenant's **category name** — so a renamed category renames
  // its button, and the registry's fixed `addLabel` ("New Equipment") can only
  // ever be the fallback. That needs a category per type in the strip, named.
  //
  // A fresh store: the "start clean" check above wiped the one this file opened
  // with (and the reset persists, so nothing to read there).
  mem.clear();
  const w = new DataService();
  const cats = w.categoriesForVertical(w.activeVertical().id, true);
  assert.ok(cats.length >= 1, 'the strip is the tenant’s categories');
  for (const c of cats) {
    assert.ok(c.name.trim(), `${c.type}: the category carries its tab's title`);
    assert.ok(w.tabMeta(c.type).label, `${c.type}: and the registry still knows the type`);
  }
  // Renaming is the proof it is data, not wording compiled into the page.
  const first = cats[0];
  w.updateCategory(first.id, { name: 'Renamed Strip' });
  assert.equal(w.getCategory(first.id).name, 'Renamed Strip', 'the button would read "New Renamed Strip"');
  assert.equal(w.categoriesForVertical(w.activeVertical().id, true)[0].name, 'Renamed Strip');
});

check('two categories of one spine type hold their own rows, tab for tab', () => {
  // The bug this guards: the page used to be keyed on the *type*, so two categories
  // of one type were one tab — selecting either highlighted both and listed the
  // whole type. A category is the unit, so its rows are its own.
  mem.clear();
  const w = new DataService();
  const vertical = w.activeVertical();
  const a = w.createCategory(vertical.id, {
    name: 'Shop Pumps',
    icon: 'bi-tools',
    behaviour: 'quantity',
    active: true,
    fields: [],
  });
  const b = w.createCategory(vertical.id, {
    name: 'Shop Seals',
    icon: 'bi-nut',
    behaviour: 'quantity',
    active: true,
    fields: [],
  });
  assert.equal(a.type, b.type, 'two categories, one spine type');

  const row = w.createItem(a.type, {
    name: 'Pump Seal Kit',
    category: a.name,
    categoryId: a.id,
    status: 'In Stock',
    qty: 2,
    rateDaily: 0,
  });
  assert.equal(w.categoryItemCount(a.id), 1, 'the category it was filed in holds it');
  assert.equal(w.categoryItemCount(b.id), 0, 'and its sibling of the same type is not handed it');
  assert.equal(w.getCategory(row.categoryId).name, 'Shop Pumps');

  // The type's rows partition across its categories: that is what lets two tabs of
  // one type show different records, and what their pills count.
  const siblings = w.categoriesForVertical(vertical.id).filter((c) => c.type === a.type);
  assert.ok(siblings.length >= 3, 'the seeded category of that type plus the two new ones');
  const summed = siblings.reduce((n, c) => n + w.categoryItemCount(c.id), 0);
  assert.equal(summed, w.listItems(a.type).filter((i) => i.categoryId).length, 'no row lands in two tabs');
});

check('a snapshot from before the business type owned the industry keeps it', () => {
  // The shape a workspace persisted *before* the Feature Modules switch went away:
  // the registry key on the tenant, and no `vertical_id` at all.
  mem.clear();
  void new DataService(); // seeds + persists a snapshot
  const snap = JSON.parse(mem.get('ims-web.store'));
  snap.tenants[0].vertical = 'Warehouse';
  delete snap.tenants[0].verticalId;
  mem.set('ims-web.store', JSON.stringify(snap));

  const after = new DataService();
  assert.equal(after.vertical, 'Warehouse', 'the old key resolved onto the business type');
  assert.equal(after.activeVertical().slug, 'warehouse', 'and the workspace is on that row');
  assert.equal('vertical' in after.activeTenant, false, 'the stale field is dropped');
  assert.equal(after.activeTenant.verticalId, after.activeVertical().id, 'vertical_id is the one record');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck23: ${n} checks`);
