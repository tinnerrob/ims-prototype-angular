import assert from 'node:assert/strict';

/* ---- a localStorage stand-in (the store persists to it) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService } = await import('./data.service.js');
const { SessionService } = await import('./session.service.js');
const { ModulesService } = await import('./modules.service.js');
const { can } = await import('./models.js');

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

/* ============================ A1: tenancy ============================ */
mem.clear();
const data = new DataService();

check('session starts as the seeded manager', () => {
  assert.equal(data.activeUser.name, 'Dana Reynolds');
  assert.equal(data.activeUser.role, 'manager');
  assert.equal(data.activeTenant.name, 'Northline Equipment Co.');
  assert.equal(data.activeTenant.plan, 'professional');
});

check('one seeded user per role', () => {
  const roles = data.listUsers().map((u) => u.role).sort();
  assert.deepEqual(roles, ['admin', 'field', 'manager', 'owner', 'viewer', 'warehouse']);
});

check('vertical is tenant data', () => {
  assert.equal(data.vertical, 'HeavyEquipment');
  data.setVertical('Warehouse');
  assert.equal(data.vertical, 'Warehouse');
  assert.equal(data.activeTenant.vertical, 'Warehouse');
});

check('module flags default ON and are stored on the tenant', () => {
  assert.equal(data.moduleFlags()['billing'], true);
  data.setTenantModule('billing', false);
  assert.equal(data.moduleFlags()['billing'], false);
  const snap = JSON.parse(localStorage.getItem('ims-web.store'));
  assert.deepEqual(snap.tenants[0].disabledModules, ['billing']);
  data.setTenantModule('billing', true);
  assert.equal(data.moduleFlags()['billing'], true);
});

check('the pre-tenancy module key is folded in once, then dropped', () => {
  mem.clear();
  mem.set('ims-web.modules', JSON.stringify({ telemetry: false, billing: false }));
  const d2 = new DataService();
  assert.deepEqual(d2.activeTenant.disabledModules, ['telemetry', 'billing']);
  assert.equal(mem.has('ims-web.modules'), false);
  assert.equal(d2.moduleFlags()['scheduling'], true);
});

check('session switching follows the user and their tenant', () => {
  data.setSessionUser('USR-006');
  assert.equal(data.activeUser.name, 'Sandra Patel');
  assert.equal(can(data.activeUser, 'stock.move'), false);
  assert.equal(can(data.activeUser, 'items.view'), true);
  data.setSessionUser('USR-003');
  assert.equal(data.activeUser.role, 'manager');
});

check('SessionService derives from the store (signals stay in step)', () => {
  const session = new SessionService(data);
  assert.equal(session.user().name, 'Dana Reynolds');
  assert.equal(session.tenant().slug, 'northline');
  assert.equal(session.role().label, 'Manager');
  assert.equal(session.users().length, 6);
  assert.equal(session.can('stock.adjust'), true);
  assert.equal(session.isCurrent('USR-003'), true);
  session.switchUser('USR-006');
  assert.equal(session.user().name, 'Sandra Patel', 'signal follows the switch');
  assert.equal(session.can('stock.adjust'), false);
  assert.equal(session.role().label, 'Viewer');
  session.switchUser('USR-003');
});

check('ModulesService reads the tenant licence flags', () => {
  const mods = new ModulesService(data);
  assert.equal(mods.isEnabled('dispatch'), true);
  mods.setEnabled('dispatch', false);
  assert.equal(mods.isEnabled('dispatch'), false, 'flag flips');
  assert.equal(data.activeTenant.disabledModules.includes('dispatch'), true, 'persisted on the tenant');
  mods.setEnabled('dispatch', true);
  assert.equal(mods.isEnabled('dispatch'), true);
});

check('a schema bump reseeds and says so', () => {
  const stale = JSON.parse(localStorage.getItem('ims-web.store'));
  stale._v = 4;
  stale.parties = [];
  mem.set('ims-web.store', JSON.stringify(stale));
  const d3 = new DataService();
  assert.equal(d3.reseeded, true, 'flagged, not silent');
  assert.equal(d3.listParties().length > 0, true, 'seed restored');
});
