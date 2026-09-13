import assert from 'node:assert/strict';

/* ============ C1: the catalog is tenant data ============
 *
 * Phase C's foundation: a workspace's verticals and asset categories are its own
 * rows, seeded from the compiled registry and then owned. A vertical groups
 * categories and orders them; a category is a tab, carries its own fields and says
 * how it is stocked (behaviour); the tenant's `stock_schema` holds the fields every
 * asset shares.
 *
 * Still additive in C1 — nothing else reads these yet — so these checks cover the
 * rows, the accessors and the guards.
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

check('a workspace starts with the registry seeded as tenant rows', () => {
  assert.equal(d.listVerticals().length, 5, 'the five default verticals');
  assert.equal(d.activeVertical().slug, 'heavyequipment', "the tenant's choice maps to a row");
  assert.ok(d.listVerticals().some((v) => v.isDefault), 'one is the default');
  assert.ok(d.listVerticals().every((v) => v.id.startsWith('VT-')), 'readable ids');
});

check('a vertical owns its categories, in order, typed by behaviour', () => {
  const v = d.activeVertical();
  const cats = d.categoriesForVertical(v.id);
  assert.deepEqual(
    cats.map((c) => c.name),
    d.verticalMeta().tabs.map((t) => t.label),
    'its tabs are its categories, named by the tab',
  );
  assert.deepEqual(cats.map((c) => c.sort), cats.map((_, i) => i), 'in the tenant order');
  assert.equal(cats.find((c) => c.name.includes('Serialized'))?.behaviour, 'serialized');
  assert.equal(cats.find((c) => c.behaviour === 'labor')?.behaviour, 'labor', 'a person stays its own behaviour');
  assert.ok(cats.filter((c) => c.behaviour === 'quantity').length >= 2, 'counted stock is `quantity`');
  assert.ok(cats.every((c) => c.active), 'all active');
});

check('a category carries its own fields, seeded from its type', () => {
  const cats = d.categoriesForVertical(d.activeVertical().id);
  const equipment = cats.find((c) => c.behaviour === 'serialized');
  assert.ok(equipment.fields.length > 0, 'the equipment category has fields');
  assert.ok(equipment.fields.some((f) => f.key === 'emissionsTier'), 'and they are its type defaults');
  // The fields are its own copy, not a shared reference into the registry defaults.
  equipment.fields.push({ key: 'demo', label: 'Demo', kind: 'text' });
  const other = cats.find((c) => c.id !== equipment.id && c.behaviour === 'serialized');
  if (other) assert.equal(other.fields.some((f) => f.key === 'demo'), false, 'no shared array');
});

check('a tenant can add a vertical and a category, and reorder it', () => {
  const before = d.listVerticals().length;
  const v = d.createVertical({ name: 'Marine', slug: 'marine', active: true, isDefault: false });
  assert.ok(v.id.startsWith('VT-'), 'it gets an id');
  assert.equal(d.listVerticals().length, before + 1);
  assert.equal(d.verticalBySlug('MARINE')?.id, v.id, 'the slug resolves, case-insensitively');

  const c1 = d.createCategory(v.id, { name: 'Vessels', behaviour: 'serialized', active: true, fields: [] });
  const c2 = d.createCategory(v.id, { name: 'Fuel', behaviour: 'quantity', active: true, fields: [] });
  assert.deepEqual(d.categoriesForVertical(v.id).map((c) => c.name), ['Vessels', 'Fuel'], 'added in order');
  d.moveCategory(c2.id, 0);
  assert.deepEqual(d.categoriesForVertical(v.id).map((c) => c.name), ['Fuel', 'Vessels'], 'reordered');
  assert.deepEqual(d.categoriesForVertical(v.id).map((c) => c.sort), [0, 1], 'sorts renumbered');

  // Renaming a type (the pencil in the UI) keeps its categories: they hang off the
  // row's id, not its name, so nothing else moves.
  d.updateVertical(v.id, { name: 'Marine & Docks', slug: 'marine-docks' });
  assert.equal(d.getVertical(v.id).name, 'Marine & Docks', 'renamed');
  assert.equal(d.verticalBySlug('marine-docks')?.id, v.id, 'and re-handled');
  assert.deepEqual(d.categoriesForVertical(v.id).map((c) => c.name), ['Fuel', 'Vessels'], 'its categories stayed');

  // A type the tenant authored has no entry in the compiled registry, so while the
  // workspace is on it the grid falls back to the default catalog's shape — the
  // registry is a seed now, not a gate (its own key is derived from the row slug).
  d.setActiveVertical(v.id);
  assert.equal(d.activeVertical().id, v.id, 'the workspace is on the authored type');
  assert.equal(d.vertical, 'HeavyEquipment', 'whose registry key falls back to the default');
  const heavy = d.listVerticals().find((x) => x.isDefault);
  d.setActiveVertical(heavy.id);
  assert.equal(d.vertical, 'HeavyEquipment', 'and back on the seeded one');

  assert.equal(d.removeVertical(v.id), true, 'an unused vertical removes with its categories');
  assert.equal(d.getVertical(v.id), undefined);
  assert.equal(d.getCategory(c1.id), undefined, 'and its categories went with it');
});

check('the stock set is a tenant row that applies to every asset', () => {
  assert.deepEqual(d.stockSchema().fields, [], 'empty to start — the core columns carry the rest');
  d.updateStockSchema([{ key: 'serialNumber', label: 'Serial Number', kind: 'text', required: true }]);
  assert.equal(d.stockSchema().fields.length, 1);
  const again = new DataService();
  assert.equal(again.stockSchema().fields[0].key, 'serialNumber', 'and it persists');
});

check('a category in use cannot be removed, and neither can its vertical', () => {
  const v = d.activeVertical();
  const c = d.categoriesForVertical(v.id)[0];
  const before = d.categoryItemCount(c.id);
  const made = d.createItem('part', {
    name: 'Category-bound row',
    category: c.name,
    categoryId: c.id,
    status: 'In Stock',
    qty: 0,
    rateDaily: 0,
    active: true,
  });
  assert.equal(made.categoryId, c.id, 'the item names the category row');
  assert.equal(d.categoryItemCount(c.id), before + 1, 'and the category counts it');
  assert.equal(d.removeAssetCategory(c.id), false, 'in use: refused');
  assert.ok(d.verticalRemovalBlockers(v.id).length > 0, 'and its vertical is blocked');
  assert.equal(d.removeVertical(v.id), false, 'so the vertical is refused too');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck20: ${n} checks`);
