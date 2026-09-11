import assert from 'node:assert/strict';

/* ---- a localStorage stand-in (the store persists to it) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

import { signInAs } from './sign-in.mjs';

const { DataService, DEMO_PASSWORDS } = await import('./data.service.js');
const { SessionService } = await import('./session.service.js');
const { ModulesService } = await import('./modules.service.js');
const { can } = await import('./models.js');

let n = 0;
const check = async (label, fn) => {
  n++;
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

/* ============================ A1: tenancy ============================ */
mem.clear();
const data = new DataService();

await check('a fresh fixture ships no session (B2) — and signing in starts one', async () => {
  assert.equal(data.activeUser, undefined, 'nobody is signed in');
  assert.equal(can(data.activeUser, 'items.view'), false, 'so nobody holds a capability');
  assert.equal(data.activeTenant.name, 'Northline Equipment Co.', 'the workspace still reads');
  assert.equal(data.activeTenant.plan, 'professional');
  const dana = await signInAs(data, 'USR-003');
  assert.equal(dana.name, 'Dana Reynolds');
  assert.equal(data.activeUser.role, 'manager');
  assert.equal(data.sessionUserId(), 'USR-003');
});

await check('one seeded user per role', () => {
  const roles = data.listUsers().map((u) => u.role).sort();
  assert.deepEqual(roles, ['admin', 'field', 'manager', 'owner', 'viewer', 'warehouse']);
});

await check('vertical is tenant data', () => {
  assert.equal(data.vertical, 'HeavyEquipment');
  data.setVertical('Warehouse');
  assert.equal(data.vertical, 'Warehouse');
  assert.equal(data.activeTenant.vertical, 'Warehouse');
});

await check('module flags default ON and are stored on the tenant', () => {
  assert.equal(data.moduleFlags()['billing'], true);
  data.setTenantModule('billing', false);
  assert.equal(data.moduleFlags()['billing'], false);
  const snap = JSON.parse(localStorage.getItem('ims-web.store'));
  assert.deepEqual(snap.tenants[0].disabledModules, ['billing']);
  data.setTenantModule('billing', true);
  assert.equal(data.moduleFlags()['billing'], true);
});

await check('the pre-tenancy module key is folded in once, then dropped', () => {
  mem.clear();
  mem.set('ims-web.modules', JSON.stringify({ telemetry: false, billing: false }));
  const d2 = new DataService();
  assert.deepEqual(d2.activeTenant.disabledModules, ['telemetry', 'billing']);
  assert.equal(mem.has('ims-web.modules'), false);
  assert.equal(d2.moduleFlags()['scheduling'], true);
});

await check('signing in as another person follows them and their tenant (B2)', async () => {
  await signInAs(data, 'USR-006');
  assert.equal(data.activeUser.name, 'Sandra Patel');
  assert.equal(can(data.activeUser, 'stock.move'), false);
  assert.equal(can(data.activeUser, 'items.view'), true);
  await signInAs(data, 'USR-003');
  assert.equal(data.activeUser.role, 'manager');
});

await check('SessionService derives from the store (signals stay in step)', async () => {
  await signInAs(data, 'USR-003');
  const session = new SessionService(data);
  assert.equal(session.user().name, 'Dana Reynolds');
  assert.equal(session.tenant().slug, 'northline');
  assert.equal(session.role().label, 'Manager');
  assert.equal(session.signedIn(), true, 'the guard asks exactly this');
  assert.equal(session.can('stock.adjust'), true);
  // The service's own path in — a credential, not an assertion about who we are.
  assert.equal((await session.signIn('sandra@northline.example', DEMO_PASSWORDS['USR-006'])).ok, true);
  assert.equal(session.user().name, 'Sandra Patel', 'the signal follows the sign-in');
  assert.equal(session.can('stock.adjust'), false);
  assert.equal(session.role().label, 'Viewer');
  session.signOut();
  assert.equal(session.signedIn(), false, 'and Sign out ends it');
  assert.equal(session.can('items.view'), false);
  await signInAs(data, 'USR-003');
});

await check('ModulesService reads the tenant licence flags', () => {
  const mods = new ModulesService(data);
  assert.equal(mods.isEnabled('dispatch'), true);
  mods.setEnabled('dispatch', false);
  assert.equal(mods.isEnabled('dispatch'), false, 'flag flips');
  assert.equal(data.activeTenant.disabledModules.includes('dispatch'), true, 'persisted on the tenant');
  mods.setEnabled('dispatch', true);
  assert.equal(mods.isEnabled('dispatch'), true);
});

await check('a schema bump reseeds and says so', () => {
  const stale = JSON.parse(localStorage.getItem('ims-web.store'));
  stale._v = 4;
  stale.parties = [];
  mem.set('ims-web.store', JSON.stringify(stale));
  const d3 = new DataService();
  assert.equal(d3.reseeded, true, 'flagged, not silent');
  assert.equal(d3.listParties().length > 0, true, 'seed restored');
});
