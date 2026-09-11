import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService } = await import('./data.service.js');
const { VERTICAL_METADATA, verticalMetaFor } = await import('./vertical-metadata.js');
const { VERTICAL_KEYS, CATALOG_TYPE_KEYS, ITEM_STATUSES } = await import('./models.js');

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

/* ============ A7: the vertical metadata registry ============
 *
 * A vertical used to re-shape the catalog through conditionals inside a component
 * (`VERTICAL_TABS`, a `COLUMNS` map, label strings). It is now data on the tenant
 * (`core/vertical-metadata.ts`, read through `DataService.verticalMeta()`), and
 * these checks hold that data to account:
 *
 * - every vertical has an entry, and every tab it claims is a real catalog type;
 * - a tab's columns are all fields the *model actually has* (a label is a
 *   vertical's wording; a field is the schema's) — the guard that stops registry
 *   drift turning into a blank column;
 * - the store reads the *tenant's* vertical, live: switching it changes the tabs,
 *   the labels, the columns and a new record's defaults with no reload, and no
 *   component keeps a vertical map of its own.
 */

mem.clear();
const d = new DataService();

check('every vertical has an entry, and every entry is a real one', () => {
  for (const key of VERTICAL_KEYS) {
    const meta = VERTICAL_METADATA[key];
    assert.ok(meta, `${key} has metadata`);
    assert.equal(meta.key, key, 'and it knows which vertical it is');
    assert.ok(meta.label, 'with a human label');
    assert.ok(meta.noun, 'and the word it calls a catalog row');
    assert.ok(meta.tabs.length > 0, `${key} exposes at least one tab`);
    assert.equal(
      meta.tabs.some((t) => t.key === meta.defaultTab),
      true,
      'the tab the page opens on is one of its own tabs',
    );
  }
  assert.deepEqual(Object.keys(VERTICAL_METADATA).sort(), [...VERTICAL_KEYS].sort(), 'no vertical is missing');
  assert.equal(verticalMetaFor('Wormhole').key, 'HeavyEquipment', 'an unknown key falls back to the default catalog');
  assert.equal(verticalMetaFor(null).key, 'HeavyEquipment');
});

check('every tab names a real catalog type, once, with the fields a tab needs', () => {
  for (const [key, meta] of Object.entries(VERTICAL_METADATA)) {
    const seen = new Set();
    for (const tab of meta.tabs) {
      assert.equal(CATALOG_TYPE_KEYS.includes(tab.key), true, `${key}/${tab.key}: a real type`);
      assert.equal(seen.has(tab.key), false, `${key}/${tab.key}: listed once`);
      seen.add(tab.key);
      assert.ok(tab.label, `${key}/${tab.key}: has a label`);
      assert.ok(tab.icon.startsWith('bi-'), `${key}/${tab.key}: has an icon class`);
      assert.ok(tab.addLabel, `${key}/${tab.key}: says how to add one`);
      assert.ok(tab.columns.length > 0, `${key}/${tab.key}: prints at least one column`);
      assert.ok(tab.defaults.status, `${key}/${tab.key}: starts in a status`);
      assert.equal(
        ITEM_STATUSES[tab.key].includes(tab.defaults.status),
        true,
        `${key}/${tab.key}: its opening status is one the editor offers`,
      );
      assert.equal(Number.isFinite(tab.defaults.qty), true, `${key}/${tab.key}: starts at a count`);
    }
  }
});

check('a column names a field the model actually has', () => {
  // The registry may *choose* and *order* facts, never invent them: every column is
  // checked against a real row of that type (plus `spread`, which the page computes
  // from two fields the model does have).
  const virtual = ['spread'];
  for (const [key, meta] of Object.entries(VERTICAL_METADATA)) {
    for (const tab of meta.tabs) {
      const row = d.listItems(tab.key)[0];
      assert.ok(row, `${key}/${tab.key}: there is a seeded row to check against`);
      for (const [field, header] of tab.columns) {
        assert.ok(header, `${key}/${tab.key}/${field}: has a header`);
        assert.equal(
          virtual.includes(field) || field in row,
          true,
          `${key}/${tab.key}: "${field}" is a field the model has`,
        );
      }
    }
  }
});

check("the store reads the *tenant's* vertical, and follows it live", () => {
  assert.equal(d.vertical, 'HeavyEquipment', 'the fixture workspace is a heavy-equipment yard');
  assert.equal(d.verticalMeta().noun, 'Assets');
  assert.equal(d.verticalMeta().defaultTab, 'serialized');
  assert.equal(d.listItems('serialized').length > 0, true, 'and it has serialized stock');

  d.setVertical('Healthcare');
  assert.equal(d.vertical, 'Healthcare', 'the tenant carries the switch');
  assert.equal(d.verticalMeta().key, 'Healthcare', 'and the registry follows, with no reload and no cache');
});

check('flipping the vertical changes the tabs, their order and their labels', () => {
  const heavy = VERTICAL_METADATA.HeavyEquipment.tabs.map((t) => t.key);
  assert.deepEqual(
    heavy,
    ['serialized', 'bulk', 'consumable', 'part', 'labor', 'attachment', 'kit'],
    'the fleet catalog, in the prototype order',
  );
  const clinic = d.verticalMeta();
  assert.deepEqual(
    clinic.tabs.map((t) => t.key),
    ['consumable', 'part', 'bulk', 'labor'],
    'a clinic has supplies, parts, bulk and people — no machines, no kits, no attachments',
  );
  assert.equal(clinic.tabs.some((t) => t.key === 'serialized'), false, 'never an equipment tab');
  assert.equal(clinic.defaultTab, 'consumable', 'and it opens on supplies');
  assert.equal(clinic.tabs[0].label, 'Supplies', 'a clinic calls a consumable a supply');
  assert.equal(clinic.tabs[0].addLabel, 'New Supply');
  assert.equal(
    VERTICAL_METADATA.HeavyEquipment.tabs.find((t) => t.key === 'consumable').label,
    'Consumables',
    'while the yard calls the same tab by its own name',
  );
  // A warehouse is the third shape: no fleet, and its stock tabs lead with the place.
  d.setVertical('Warehouse');
  const wh = d.verticalMeta();
  assert.deepEqual(wh.tabs.map((t) => t.key), ['consumable', 'part', 'bulk', 'labor']);
  assert.equal(wh.noun, 'Stock Lines');
  assert.equal(wh.tabs.find((t) => t.key === 'bulk').label, 'Bulk Stock');
  assert.equal(d.listItems('serialized').length > 0, true, 'the machines are still in the store, just not tabbed');
});

check('the columns follow the vertical, not the type alone', () => {
  d.setVertical('HeavyEquipment');
  const heavyPart = d.verticalMeta().tabs.find((t) => t.key === 'part');
  assert.deepEqual(
    heavyPart.columns.map((c) => c[0]),
    ['id', 'name', 'category', 'locationId', 'qtyOnHand', 'reorderPoint', 'costPrice', 'status'],
    'a yard reads a part: where it is, then how many, then what it cost',
  );
  d.setVertical('Healthcare');
  const clinicPart = d.verticalMeta().tabs.find((t) => t.key === 'part');
  assert.deepEqual(
    clinicPart.columns.map((c) => c[0]),
    ['id', 'name', 'category', 'locationId', 'qtyOnHand', 'reorderPoint', 'status'],
    'a clinic does not price a part — cost is not a column it prints',
  );
  const heavyConsumable = VERTICAL_METADATA.HeavyEquipment.tabs.find((t) => t.key === 'consumable');
  const clinicConsumable = d.verticalMeta().tabs.find((t) => t.key === 'consumable');
  assert.notDeepEqual(
    heavyConsumable.columns.map((c) => c[0]),
    clinicConsumable.columns.map((c) => c[0]),
    'the same type, a different set of facts',
  );
  assert.equal(clinicConsumable.columns[3][1], 'Reorder Pt', 'and the clinic leads with the reorder point');
});

check("a new record starts as the vertical's default, not a constant", () => {
  d.setVertical('HeavyEquipment');
  const machine = d.verticalMeta().tabs.find((t) => t.key === 'serialized');
  assert.deepEqual(machine.defaults, { status: 'Available', qty: 1 }, 'a machine: available, one of it');
  d.setVertical('Healthcare');
  const supply = d.verticalMeta().tabs.find((t) => t.key === 'consumable');
  assert.deepEqual(supply.defaults, { status: 'In Stock', qty: 0 }, 'a supply: in stock with an empty shelf');
});

check('the terminology is data too: a lumberyard is not a rental yard', () => {
  d.setVertical('Lumberyard');
  const meta = d.verticalMeta();
  assert.equal(meta.noun, 'Stock Lines');
  assert.deepEqual(meta.tabs.map((t) => t.key), ['bulk', 'consumable', 'part', 'labor']);
  const bulk = meta.tabs.find((t) => t.key === 'bulk');
  assert.equal(bulk.addLabel, 'New Bulk Material');
  assert.equal(bulk.columns.some((c) => c[0] === 'rateDaily'), false, 'a yard does not rent it out by the day');
  assert.equal(bulk.columns.some((c) => c[0] === 'totalOwned'), true, 'it counts what it owns');
  // And back again: the registry is a lookup, not a mutation.
  d.setVertical('HeavyEquipment');
  assert.deepEqual(d.verticalMeta(), VERTICAL_METADATA.HeavyEquipment, 'the default catalog is unchanged');
  assert.equal(VERTICAL_METADATA.Lumberyard.tabs.length, 4, 'and the yard it left is too');
});

check('the verticals are distinct, and more than one shape exists', () => {
  const metas = VERTICAL_KEYS.map((k) => VERTICAL_METADATA[k]);
  const shapes = new Set(metas.map((m) => m.tabs.map((t) => t.key).join(',')));
  assert.ok(shapes.size >= 3, `the verticals differ in shape (${shapes.size} distinct tab sets)`);
  const labels = new Set(metas.map((m) => m.label));
  assert.equal(labels.size, VERTICAL_KEYS.length, 'each vertical carries its own label');
});

console.log(`\ncheck8: ${n} checks`);

