import assert from 'node:assert/strict';

/* ================= B2: the form schema is data =================
 *
 * The form builder's backend: `form_schemas` rows (a tenant's extra fields) and
 * the `attributes` jsonb they validate. What these checks hold to account:
 *  - a seeded schema per catalog type, attributed like any configuration row;
 *  - (scope, type) resolution, with an exact type beating a wildcard;
 *  - defaults, coercion (typing + dropping every undeclared key) and validation;
 *  - an item's `attributes` round-tripping, and surviving a reload;
 *  - a schema edit taking the acting user's stamp without losing its create stamps.
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
const { FormsService } = await import('./forms.service.js');

/**
 * A category **name** of the workspace's business type for a catalog type (Phase
 * C): categories are the tenant's rows now, so a fixture asks for one instead of
 * naming a string that no longer exists anywhere.
 */
const catName = (d, type) =>
  d.categoriesForVertical(d.activeVertical().id).find((c) => c.type === type)?.name ?? '';

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
const forms = new FormsService(d);

check('the seeded schemas are tenant rows, one per catalog type', () => {
  const items = d.listFormSchemas('item');
  assert.equal(items.length, 8, 'one item schema per catalog type, plus the clinic supply schema (B3)');
  assert.ok(items.every((s) => s.scope === 'item' && s.active), 'scope + active');
  assert.ok(items.every((s) => s.id && s.name && Array.isArray(s.fields)), 'shaped');
  assert.ok(d.listFormSchemas().every((s) => s.createdBy), 'attributed like configuration');
});

check('a schema resolves for its type; an exact match beats a wildcard', () => {
  assert.equal(forms.schemaFor('item', 'consumable')?.id, 'FS-item-consumable');
  d.setSessionUser('USR-004');
  d.createFormSchema({ name: 'Any item', scope: 'item', type: '*', active: true, version: 1, fields: [{ key: 'x', label: 'X', kind: 'text' }] });
  assert.equal(forms.schemaFor('item', 'consumable')?.id, 'FS-item-consumable', 'the exact type still wins');
  assert.equal(forms.schemaFor('item', 'kit')?.id, 'FS-item-kit', 'a type with an empty schema still resolves');
  d.removeFormSchema('FS-001');
  d.setSessionUser('USR-003');
});

check('defaults come from the schema', () => {
  const schema = {
    id: 'FS-x', name: 'x', scope: 'item', active: true, version: 1,
    fields: [
      { key: 'a', label: 'A', kind: 'text', defaultValue: 'ready' },
      { key: 'b', label: 'B', kind: 'integer' },
    ],
  };
  assert.deepEqual(forms.defaults(schema), { a: 'ready' });
});

check('coerce types the values and drops every undeclared key', () => {
  const schema = {
    id: 'FS-x', name: 'x', scope: 'item', active: true, version: 1,
    fields: [
      { key: 'qty', label: 'Qty', kind: 'integer' },
      { key: 'temp', label: 'Temp', kind: 'measurement' },
      { key: 'live', label: 'Live', kind: 'boolean' },
      { key: 'lot', label: 'Lot', kind: 'text' },
    ],
  };
  const out = forms.coerce(schema, { qty: '12.9', temp: '4.5', live: 'true', lot: '', rogue: 'nope' });
  assert.deepEqual(out, { qty: 12, temp: 4.5, live: true });
  assert.equal('rogue' in out, false, 'an unknown key is dropped');
});

check('validate names a missing required key and a bad enum', () => {
  const schema = {
    id: 'FS-x', name: 'x', scope: 'item', active: true, version: 1,
    fields: [
      { key: 'lot', label: 'Lot', kind: 'text', required: true },
      { key: 'tier', label: 'Tier', kind: 'select', options: ['A', 'B'] },
      { key: 'pct', label: 'Pct', kind: 'measurement', min: 0, max: 100 },
    ],
  };
  const keys = forms.validate(schema, { tier: 'Z', pct: 140 }).map((e) => e.key).sort();
  assert.deepEqual(keys, ['lot', 'pct', 'tier']);
  assert.deepEqual(forms.validate(schema, { lot: 'L1', tier: 'A', pct: 50 }), []);
});

check('an item round-trips its attributes, and both survive a reload', () => {
  const made = d.createItem('consumable', {
    name: 'Nitrile Gloves',
    category: catName(d, 'consumable') || 'Supplies',
    status: 'In Stock',
    qty: 0,
    rateDaily: 0,
    qtyOnHand: 0,
    active: true,
    attributes: { manufacturerPartNo: 'MPN-9', lot: 'L-77', expiry: '2027-01-31', storageTemp: 21 },
  });
  // The clinic's supply schema (B3) declares these fields; a schema that does not
  // declare them drops them — which is the whole point of `coerce()`.
  assert.deepEqual(
    forms.coerce(forms.schema('FS-item-consumable-clinic'), made.attributes),
    { manufacturerPartNo: 'MPN-9', lot: 'L-77', expiry: '2027-01-31', storageTemp: 21 },
    'the clinic schema keeps every field it declares',
  );
  assert.deepEqual(
    forms.coerce(forms.schema('FS-item-consumable'), made.attributes),
    { manufacturerPartNo: 'MPN-9' },
    'the generic schema keeps only its own field',
  );
  d.updateItem('consumable', made.id, { attributes: { lot: 'L-78' } });
  assert.deepEqual(d.getItem('consumable', made.id).attributes, { lot: 'L-78' });
  const again = new DataService();
  assert.deepEqual(again.getItem('consumable', made.id)?.attributes, { lot: 'L-78' }, 'the reload restores it, not reseeds it');
});

check('a schema edit is attributed to the acting user', () => {
  const born = d.getFormSchema('FS-item-part').createdBy;
  d.setSessionUser('USR-004');
  d.updateFormSchema('FS-item-part', { version: 2 });
  const s = d.getFormSchema('FS-item-part');
  assert.equal(s.version, 2);
  assert.equal(s.updatedBy, 'USR-004');
  assert.equal(s.createdBy, born, 'the create stamps survive the edit');
  d.setSessionUser('USR-003');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck14: ${n} checks`);
