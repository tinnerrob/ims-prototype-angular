import assert from 'node:assert/strict';

/* ============ B7: inspections from templates ============
 *
 * The checklist used to be a fixed five-key union (`InspectionCheckKey`). It is now
 * the fields of an `inspection`-scope `FormSchema`, and a record's `results` is one
 * entry per field key carrying the value captured and how it came out. What these
 * checks hold to account:
 *  - the default checklist is a template (data), and `FormsService` resolves it;
 *  - a seeded inspection carries `results`, not a boolean map;
 *  - a failure raises a linked work order (once), `Repair` only when critical;
 *  - a clean checklist raises nothing;
 *  - editing the template does not mutate a record's own results.
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

check('the default checklist is a template, not a union', () => {
  const t = d.inspectionTemplate();
  assert.ok(t, 'there is an inspection template');
  assert.equal(t.scope, 'inspection');
  assert.deepEqual(
    t.fields.map((f) => f.key),
    ['tires', 'fluids', 'guards', 'lights', 'engine'],
    'the five condition checks, as data',
  );
  assert.equal(forms.schemaFor('inspection')?.id, t.id, 'FormsService resolves it for the scope');
});

check('a seeded inspection carries results keyed by the template', () => {
  const r = d.getInspection('INSP-002');
  assert.equal(r.templateId, 'FS-inspection-default');
  assert.equal(r.checks, undefined, 'no fixed boolean map on the row');
  assert.equal(r.results.lights.outcome, 'fail', 'the lamp fault is a result');
  assert.equal(r.results.lights.severity, 'major');
  assert.equal(r.results.tires.outcome, 'pass');
  const s = d.inspectionSummary(r);
  assert.equal(s.fail, 1);
  assert.equal(s.pass, 4);
  assert.equal(s.worst, 'major');
});

check('raiseWorkOrderForInspection links a job to a failed unit, once', () => {
  const before = d.listWorkOrders().length;
  const wo = d.raiseWorkOrderForInspection('INSP-002');
  assert.ok(wo, 'the failure raised a job');
  assert.equal(d.listWorkOrders().length, before + 1);
  assert.equal(wo.itemId, 'SS-204', 'for the inspected unit');
  assert.equal(wo.type, 'Inspection', 'a major failure is not a repair');
  assert.equal(d.getInspection('INSP-002').workOrderId, wo.id, 'linked back to the inspection');
  assert.equal(d.raiseWorkOrderForInspection('INSP-002'), null, 'and not raised twice');
});

check('a critical failure raises a repair; a clean checklist raises nothing', () => {
  const r = d.getInspection('INSP-001');
  r.results.guards = { value: 'Missing', outcome: 'fail', severity: 'critical' };
  const wo = d.raiseWorkOrderForInspection(r.id);
  assert.ok(wo, 'a critical failure raises a job');
  assert.equal(wo.type, 'Repair', 'critical -> Repair');
  assert.equal(d.raiseWorkOrderForInspection('INSP-003'), null, 'a clean checklist raises nothing');
});

check('a record whose template changed still renders its own results', () => {
  d.updateFormSchema('FS-inspection-default', { fields: [{ key: 'body', label: 'Body', kind: 'text' }] });
  const r = d.getInspection('INSP-003');
  assert.ok(d.getFormSchema(r.templateId), 'the template it names still exists');
  assert.deepEqual(
    Object.keys(r.results).sort(),
    ['engine', 'fluids', 'guards', 'lights', 'tires'],
    'the record keeps its own results — editing a template never rewrites history',
  );
  // Put the template back for the checks that follow.
  d.updateFormSchema('FS-inspection-default', {
    fields: [
      { key: 'tires', label: 'Tires / Tracks', kind: 'select', options: ['Good', 'Worn', 'Damaged'] },
      { key: 'fluids', label: 'Fluids', kind: 'select', options: ['Full', 'Low', 'Leaking'] },
      { key: 'guards', label: 'Safety Guards', kind: 'select', options: ['In place', 'Loose', 'Missing'] },
      { key: 'lights', label: 'Lights', kind: 'select', options: ['Working', 'Faulty'] },
      { key: 'engine', label: 'Engine', kind: 'select', options: ['Normal', 'Noisy', 'Fault'] },
    ],
  });
});

check('a new inspection is created from the template', () => {
  const t = d.inspectionTemplate();
  const rec = d.createInspection({
    itemId: 'BL-119',
    orderId: null,
    direction: 'Check-In',
    date: '2026-09-10',
    meterOut: 100,
    meterIn: 110,
    fuelOut: 50,
    fuelIn: 40,
    templateId: t.id,
    results: Object.fromEntries(t.fields.map((f) => [f.key, { outcome: 'pass', value: f.options?.[0] }])),
    photos: 0,
    status: 'Open',
  });
  assert.ok(rec.id.startsWith('INSP-'), 'it gets an id');
  assert.deepEqual(Object.keys(rec.results).sort(), ['engine', 'fluids', 'guards', 'lights', 'tires']);
  assert.equal(d.inspectionSummary(rec).worst, null, 'and reads clean');
  d.removeInspection(rec.id);
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck18: ${n} checks`);
