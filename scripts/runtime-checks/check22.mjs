import assert from 'node:assert/strict';

/* ============ C4: authoring the catalog ============
 *
 * The store invariants the *authoring* screen relies on (the screen itself is not
 * harness-testable, but the rules it depends on are):
 *  - a new category's spine `type` follows its `behaviour` (the UI never supplies it);
 *  - editing a category keeps its type unless the behaviour actually changes;
 *  - a *seeded* category keeps its exact type (a bulk row stays bulk, not generic);
 *  - a tenant-authored vertical can be made active;
 *  - the stock set and a category's fields both edit and persist.
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

check('a seeded category keeps its exact spine type', () => {
  const parts = d.categoriesForVertical(d.activeVertical().id).find((c) => c.name === 'Stock Inventory');
  assert.ok(parts, 'the heavy-equipment vertical has its parts tab');
  assert.equal(parts.type, 'part', 'seeded from the registry type, not flattened to a behaviour default');
  assert.equal(parts.behaviour, 'quantity', 'and its user-facing behaviour is quantity');
});

check('a new category takes its spine type from its behaviour', () => {
  const v = d.createVertical({ name: 'Marine', slug: 'marine', active: true, isDefault: false });
  const s = d.createCategory(v.id, { name: 'Vessels', icon: 'bi-water', behaviour: 'serialized', active: true, fields: [] });
  assert.equal(s.type, 'serialized');
  const q = d.createCategory(v.id, { name: 'Fuel', icon: 'bi-droplet', behaviour: 'quantity', active: true, fields: [] });
  assert.equal(q.type, 'consumable', 'a new quantity category is generic counted stock');
  const l = d.createCategory(v.id, { name: 'Crew', icon: 'bi-person', behaviour: 'labor', active: true, fields: [] });
  assert.equal(l.type, 'labor');
});

check('editing a category keeps its type unless the behaviour changes', () => {
  const marine = d.listVerticals().find((x) => x.slug === 'marine');
  const s = d.categoriesForVertical(marine.id).find((c) => c.name === 'Vessels');
  d.updateCategory(s.id, { name: 'Boats', behaviour: s.behaviour });
  assert.equal(d.getCategory(s.id).type, 'serialized', 'a rename does not move the type');
  d.updateCategory(s.id, { behaviour: 'quantity' });
  assert.equal(d.getCategory(s.id).type, 'consumable', 'a behaviour change moves it');
});

check('a tenant-authored vertical can be made active, and a bogus one is refused', () => {
  const marine = d.listVerticals().find((x) => x.slug === 'marine');
  d.setActiveVertical(marine.id);
  assert.equal(d.activeVertical().id, marine.id, 'the tenant-authored vertical is active');
  d.setActiveVertical('NOPE');
  assert.equal(d.activeVertical().id, marine.id, 'an unknown id leaves the choice alone');
});

check('the stock set and a category fields edit, both persisted', () => {
  d.updateStockSchema([{ key: 'assetTag', label: 'Asset Tag', kind: 'text' }]);
  const c = d.categoriesForVertical(d.activeVertical().id)[0];
  d.updateCategory(c.id, {
    fields: [{ key: 'colours', label: 'Colours', kind: 'multiselect', options: ['Red', 'Blue'] }],
  });
  const again = new DataService();
  assert.equal(again.stockSchema().fields[0].key, 'assetTag', 'the stock set persists');
  assert.deepEqual(again.getCategory(c.id).fields[0].options, ['Red', 'Blue'], 'category fields persist, options and all');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck22: ${n} checks`);
