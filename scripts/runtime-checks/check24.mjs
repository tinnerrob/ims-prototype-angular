import assert from 'node:assert/strict';

/* ============ Phase C: a key identifies a field *in its list* ============
 *
 * A `FormField.key` is what a record's `attributes` is read and written by, so
 * within one list it has to be stated once. Two **categories** may both declare
 * `rate` — they are different lists — but one category (or the stock set, or a
 * schema) may not declare it twice: a schema with two definitions of one key is a
 * contract that contradicts itself, and the `jsonb` has room for one value.
 *
 * `duplicateFieldKeys()` is the rule as one function (the authoring editor uses it
 * to mark the row and hold the save), and the store normalises every field-list
 * write through `uniqueFields()` — first definition wins — so no path can leave a
 * list that names one key twice.
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
const { duplicateFieldKeys } = await import('./models.js');

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

const f = (key, label = key, kind = 'number') => ({ key, label, kind });

mem.clear();
const d = new DataService();
const forms = new FormsService(d);
const vertical = d.activeVertical().id;

check('two categories may both declare a key; one may not declare it twice', () => {
  const a = d.createCategory(vertical, {
    name: 'Cat A',
    icon: 'bi-box',
    behaviour: 'quantity',
    active: true,
    fields: [f('rate')],
  });
  const b = d.createCategory(vertical, {
    name: 'Cat B',
    icon: 'bi-box',
    behaviour: 'quantity',
    active: true,
    fields: [f('rate')],
  });
  assert.equal(a.fields[0].key, 'rate');
  assert.equal(b.fields[0].key, 'rate', 'the same key on another category is fine');
  assert.deepEqual(duplicateFieldKeys(a.fields), [], 'neither list repeats one');
  assert.deepEqual(duplicateFieldKeys(b.fields), []);
});

check('duplicates are reported by key, and a blank key is not a duplicate', () => {
  assert.deepEqual(
    duplicateFieldKeys([f('rate'), f('note', 'Note', 'text'), f('rate'), f(''), f('')]),
    ['rate'],
    'one key named twice; two fields still waiting for a name are not a repeat',
  );
});

check('the store never keeps a list with two fields for one key', () => {
  const cat = d
    .categoriesForVertical(vertical)
    .find((c) => c.name === 'Cat A');
  d.updateCategory(cat.id, { fields: [f('rate'), f('rate', 'Rate again'), f('note', 'Note', 'text')] });
  assert.deepEqual(
    d.getCategory(cat.id).fields.map((x) => x.key),
    ['rate', 'note'],
    'the first definition wins',
  );

  d.updateStockSchema([f('assetTag', 'Asset Tag', 'text'), f('assetTag', 'Asset tag again', 'text')]);
  assert.deepEqual(d.stockSchema().fields.map((x) => x.key), ['assetTag'], 'the stock set is normalised too');

  const made = d.createCategory(vertical, {
    name: 'Cat C',
    icon: 'bi-box',
    behaviour: 'quantity',
    active: true,
    fields: [f('rate'), f('rate')],
  });
  assert.equal(made.fields.length, 1, 'so is a new category');

  const schema = d.createFormSchema({
    name: 'Probe',
    scope: 'inspection',
    type: 'serialized',
    active: true,
    version: 1,
    fields: [f('lot', 'Lot', 'text'), f('lot', 'Lot again', 'text')],
  });
  assert.equal(schema.fields.length, 1, 'and a schema’s own fields');
});

check('a key may still shadow the stock set — once, and the category wins', () => {
  // The list rule is *within* a list: a category redefining a stock field is an
  // override (the more specific wins), not a duplicate, so the merged schema the
  // editor renders still holds exactly one entry for the key.
  const cat = d.categoriesForVertical(vertical).find((c) => c.name === 'Cat A');
  d.updateStockSchema([f('rate', 'Stock rate')]);
  d.updateCategory(cat.id, { fields: [f('rate', 'Category rate')] });
  const merged = forms.fieldsFor(cat.id).filter((x) => x.key === 'rate');
  assert.equal(merged.length, 1, 'one entry for the key');
  assert.equal(merged[0].label, 'Category rate', 'and the category’s definition is the one');

  const schema = forms.schemaForCategory(cat.id);
  assert.equal(schema.fields.filter((x) => x.key === 'rate').length, 1, 'the editor’s schema agrees');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck24: ${n} checks`);
