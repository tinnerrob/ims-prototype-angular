import assert from 'node:assert/strict';

/* ============ the Operations Dashboard's arrangement, without a browser ========
 *
 * Phase C (docs/CODE-REVIEW.md). The dashboard stopped being a fixed page: each
 * panel is a widget in `core/dashboard.ts` (a compile-time registry), the workspace
 * stores their ORDER and which are ON (`Tenant.dashboard`, tenant data), and
 * `DashboardService` joins the two. This drives that join against the real store:
 * the default is "every widget, registry order"; a switch persists on the tenant; a
 * move reorders only what shows; a widget added to the registry after a layout was
 * saved still appears; and a widget whose industry module is off never renders —
 * without that being a layout change.
 */

/* ---- a localStorage stand-in (the store persists to it) ---- */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

/* Angular's decorators need the JIT compiler in a plain Node process. */
await import('@angular/compiler');
const { DataService } = await import('./data.service.js');
const { ModulesService } = await import('./modules.service.js');
const { DashboardService } = await import('./dashboard.service.js');
const { DASHBOARD_WIDGETS } = await import('./dashboard.js');

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

const d = new DataService();
const mods = new ModulesService(d);
const dash = new DashboardService(d, mods);
const keys = (ws) => ws.map((w) => w.key);
const registry = DASHBOARD_WIDGETS.map((w) => w.key);

check('the default layout is every registry widget, in registry order', () => {
  assert.equal(d.dashboardLayout(), undefined, 'nothing is stored until the workspace edits it');
  assert.deepEqual(keys(dash.widgets()), registry);
});

check("the dashboard obeys the workspace's order, not the registry's", () => {
  d.setDashboardLayout({ order: ['reorders', 'book-value', 'active-orders'] });
  const shown = keys(dash.widgets());
  assert.equal(shown[0], 'reorders', 'the stored order leads');
  assert.equal(new Set(shown).size, shown.length, 'no widget is drawn twice');
  assert.equal(shown.length, registry.length, 'a widget the order never named is still shown (appended)');
});

check('an unknown key in a stored order is ignored', () => {
  d.setDashboardLayout({ order: ['ghost-widget', 'book-value'] });
  const shown = keys(dash.widgets());
  assert.ok(!shown.includes('ghost-widget'), 'the ghost key is dropped');
  assert.equal(shown[0], 'book-value', 'and the real key keeps its stored lead');
});

check('switching a widget off removes only that widget', () => {
  d.setDashboardLayout(undefined);
  const before = keys(dash.widgets()).length;
  dash.toggle('revenue', false);
  assert.equal(dash.widgets().length, before - 1, 'one fewer panel');
  assert.ok(!keys(dash.widgets()).includes('revenue'), 'revenue is off');
  assert.deepEqual(dash.adminHidden().map((w) => w.key), ['revenue'], 'and it is the hidden one');
});

check('switching it back on returns it to its place', () => {
  const wanted = keys(dash.widgets()); // visible now, revenue off
  const was = registry.filter((k) => k !== 'revenue'); // nothing else is off
  assert.deepEqual(wanted, was, 'sanity: only revenue is hidden');
  dash.toggle('revenue', true);
  const back = keys(dash.widgets());
  assert.deepEqual(back, registry, 'the widget returns exactly where it was');
  assert.equal(dash.adminHidden().length, 0, 'and nothing is hidden');
});

check('a move swaps two visible widgets and leaves a hidden one off', () => {
  d.setDashboardLayout({ order: ['book-value', 'utilization', 'revenue', 'active-orders'], hidden: ['revenue'] });
  assert.deepEqual(keys(dash.widgets()).slice(0, 2), ['book-value', 'utilization']);
  dash.move('utilization', -1);
  assert.deepEqual(keys(dash.widgets()).slice(0, 2), ['utilization', 'book-value'], 'the two swapped');
  assert.equal(dash.visible('revenue'), false, 'the hidden widget stayed hidden');
});

check('the arrows stop at the ends of the visible list', () => {
  const shown = keys(dash.widgets());
  assert.equal(dash.canMove(shown[0], -1), false, 'nothing above the first');
  assert.equal(dash.canMove(shown[0], 1), true, 'but it can move down');
  assert.equal(dash.canMove(shown[shown.length - 1], 1), false, 'nothing below the last');
});

check('a widget whose module is off is not rendered, and is not a layout change', () => {
  d.setDashboardLayout(undefined);
  d.setTenantModule('telemetry', false);
  const shown = keys(dash.widgets());
  assert.ok(!shown.includes('geo-alerts') && !shown.includes('geo-feed'), 'the telemetry widgets are gone');
  assert.equal(dash.adminVisible().length, registry.length, 'but the layout still lists them');
  d.setTenantModule('telemetry', true);
  assert.ok(keys(dash.widgets()).includes('geo-alerts'), 'and they come back when the module does');
});

check('reset restores the registry default', () => {
  dash.toggle('book-value', false);
  dash.move('reorders', -1);
  dash.reset();
  assert.equal(d.dashboardLayout(), undefined, 'nothing is stored again');
  assert.deepEqual(keys(dash.widgets()), registry);
});

check('the arrangement persists on the workspace row', () => {
  dash.toggle('bulk-out', false);
  const stored = d.activeTenant.dashboard;
  assert.ok(stored && stored.hidden.includes('bulk-out'), 'the tenant row carries the hidden key');
  assert.ok(stored.order.length >= registry.length, 'and the full order');
});

console.log(`\ncheck29: ${n} checks`);
