import assert from 'node:assert/strict';

/* ============ C2: one field engine ============
 *
 * The consolidation: an asset's fields are the tenant's **stock set** (what every
 * asset carries) *union* its **category's own fields**, resolved by one engine
 * (`FormsService`) that the dynamic form, `coerce()` and `validate()` already use.
 * What these checks hold to account:
 *  - the union (stock set leads, the category's fields join in);
 *  - a category field overrides a stock key of the same name, once;
 *  - the ephemeral schema feeds the same coerce/validate the editor uses;
 *  - a category resolves from its spine type within a vertical.
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
const vertical = d.activeVertical();
const parts = d.categoriesForVertical(vertical.id).find((c) => c.type === 'part');

check("a category's fields are the stock set union its own", () => {
  assert.ok(parts, 'the vertical has a parts category');
  assert.ok(parts.fields.some((f) => f.key === 'torqueSpec'), 'it carries its own fields');
  d.updateStockSchema([{ key: 'assetTag', label: 'Asset Tag', kind: 'text', required: true }]);
  const keys = forms.fieldsFor(parts.id).map((f) => f.key);
  assert.equal(keys[0], 'assetTag', 'the stock set leads');
  assert.ok(keys.includes('torqueSpec'), 'and the category fields are still there');
  assert.equal(keys.length, 3, 'one stock field + the category’s two');
});

check('a category field overrides a stock key of the same name, once', () => {
  d.updateStockSchema([{ key: 'torqueSpec', label: 'Torque (shared)', kind: 'text' }]);
  const hits = forms.fieldsFor(parts.id).filter((f) => f.key === 'torqueSpec');
  assert.equal(hits.length, 1, 'it appears once');
  assert.equal(hits[0].label, 'Torque Spec', 'and the more specific (category) one wins');
});

check('the engine feeds the same coerce/validate the editor uses', () => {
  d.updateStockSchema([{ key: 'assetTag', label: 'Asset Tag', kind: 'text', required: true }]);
  const schema = forms.schemaForCategory(parts.id);
  assert.ok(schema, 'an ephemeral schema for the category');
  assert.equal(schema.scope, 'item');
  assert.equal(schema.type, 'part', 'carrying the spine type');
  assert.equal(forms.coerce(schema, { assetTag: 'A-1', rogue: 'x' }).rogue, undefined, 'an undeclared key is dropped');
  assert.equal(forms.coerce(schema, { assetTag: 'A-1' }).assetTag, 'A-1', 'a declared one is kept');
  assert.equal(
    forms.validate(schema, { torqueSpec: 10 }).some((e) => e.key === 'assetTag'),
    true,
    'the stock set is required',
  );
  assert.deepEqual(forms.validate(schema, { assetTag: 'A-1', torqueSpec: 10 }), [], 'and a complete form validates');
});

check('a category resolves from its spine type within a vertical', () => {
  assert.equal(forms.categoryForType(vertical.id, 'serialized')?.type, 'serialized');
  assert.equal(forms.categoryForType(vertical.id, 'part')?.behaviour, 'quantity', 'a part is a quantity behaviour');
  assert.equal(forms.categoryForType(vertical.id, 'labor')?.behaviour, 'labor');
  assert.equal(forms.schemaForCategory('CAT-999'), null, 'an unknown category has no schema');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck21: ${n} checks`);
