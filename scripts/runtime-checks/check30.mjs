import assert from 'node:assert/strict';

/* ============ the printable documents' *content*, without a browser ============
 *
 * Phase E (docs/CODE-REVIEW.md). `npm run e2e` proves a document *renders*; this
 * proves it says the right thing. The eight builders live on seven components, so
 * each is instantiated here against the real store with a stub `PageSearchService`
 * (only its constructor needs one) and a capturing printer — the same "instantiate
 * the real class" move as check26.
 *
 * What it holds to account: every document is well-formed (a heading, a number,
 * columns, every row as wide as the header), the money a document prints is the
 * *store's own* figure (the invoice total is `invoiceTotals().total`, the PO's is
 * `poValue()`, the work order's is `workOrderCost()`), and the paper names the same
 * lines the screen does — which is the whole claim the print layer makes.
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
const { InvoicingComponent } = await import('./features/invoicing/invoicing.component.js');
const { PurchasingComponent } = await import('./features/purchasing/purchasing.component.js');
const { OrdersComponent } = await import('./features/orders/orders.component.js');
const { HandoffComponent } = await import('./features/handoff/handoff.component.js');
const { MaintenanceComponent } = await import('./features/maintenance/maintenance.component.js');
const { PricingComponent } = await import('./features/pricing/pricing.component.js');
const { LogisticsComponent } = await import('./features/logistics/logistics.component.js');
const { SchedulerComponent } = await import('./features/scheduler/scheduler.component.js');
const { TimesheetComponent } = await import('./features/timesheet/timesheet.component.js');

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
/* The pages report their search counts from the constructor; nothing else is read. */
const search = { report() {}, matches: () => true, isBlank: () => true };
let captured = null;
const printer = { print: (doc) => { captured = doc; } };
/** Run a builder and return the document it handed the printer. */
const made = (fn) => {
  captured = null;
  fn();
  assert.ok(captured, 'the builder called PrintService.print()');
  return captured;
};

const invoicing = new InvoicingComponent(d, search, printer);
const purchasing = new PurchasingComponent(d, search, printer);
const orders = new OrdersComponent(d, search, printer);
const handoff = new HandoffComponent(d, search, printer);
const maintenance = new MaintenanceComponent(d, search, printer);
const pricing = new PricingComponent(d, printer);
const logistics = new LogisticsComponent(d, printer);

/** All eight documents, one per builder. */
const allDocs = () => [
  ['Invoice', made(() => invoicing.printInvoice(d.listInvoices()[0]))],
  ['Purchase Order', made(() => purchasing.printPo(d.listPurchaseOrders()[0]))],
  ['Goods Receipt', made(() => purchasing.printReceipt(d.listReceipts()[0]))],
  ['Order', made(() => orders.printOrder(d.listOrders()[0]))],
  ['Work Order', made(() => maintenance.printWorkOrder(d.listWorkOrders()[0]))],
  ['Rate Card', made(() => pricing.printCard(d.listPriceCards()[0]))],
  ['Dispatch Note', made(() => logistics.printDispatch(d.listDispatches()[0]))],
  ['Pick List', made(() => handoff.printPickList())],
];

/** Every row a document holds — a flat table's, or a grouped report's two levels. */
const rowsOf = (doc) => {
  if (doc.groups) {
    return doc.groups.flatMap((g) => [...(g.rows ?? []), ...(g.subgroups ?? []).flatMap((s) => s.rows ?? [])]);
  }
  return doc.rows ?? [];
};

check('every builder builds a document with a heading, a number, columns and rows', () => {
  const seen = [];
  for (const [name, doc] of allDocs()) {
    seen.push(doc.heading);
    assert.ok(doc.heading && doc.heading.length, name + ': a heading');
    assert.ok(doc.number && doc.number.length, name + ': a number');
    assert.ok(Array.isArray(doc.columns) && doc.columns.length > 0, name + ': columns');
    assert.ok(Array.isArray(doc.rows) || Array.isArray(doc.groups), name + ': rows or groups');
  }
  assert.equal(new Set(seen).size, 8, 'eight distinct headings: ' + seen.join(', '));
});

check('every row — flat or grouped — is as wide as its header (and `align` parallels it)', () => {
  for (const [name, doc] of allDocs()) {
    for (const row of rowsOf(doc)) {
      assert.equal(row.length, doc.columns.length, `${name}: a row has ${row.length} cells for ${doc.columns.length} columns`);
    }
    if (doc.align) assert.equal(doc.align.length, doc.columns.length, `${name}: align parallels columns`);
  }
});

check('no document leaks an undefined fact into its meta grid', () => {
  for (const [name, doc] of allDocs()) {
    for (const m of doc.meta) {
      assert.ok(typeof m.label === 'string' && m.label.length, `${name}: a meta label`);
      assert.ok(m.value !== undefined && m.value !== null, `${name}: meta “${m.label}” has no value`);
    }
  }
});

check("the invoice prints the store's own total", () => {
  const i = d.listInvoices()[0];
  const doc = made(() => invoicing.printInvoice(i));
  assert.equal(doc.number, i.id);
  assert.equal(doc.rows.length, d.getOrder(i.orderId).lineItems.length, 'one row per order line');
  assert.equal(doc.totals.at(-1).value, d.money(d.invoiceTotals(i).total), 'the strong row is invoiceTotals().total');
});

check("the purchase order prints the store's own value", () => {
  const p = d.listPurchaseOrders()[0];
  const doc = made(() => purchasing.printPo(p));
  assert.equal(doc.number, p.id);
  assert.equal(doc.rows.length, p.lines.length, 'one row per PO line');
  assert.equal(doc.totals.at(-1).value, d.money(d.poValue(p)), 'the strong row is poValue()');
});

check('the receipt prints one row per landed line, totalling their value', () => {
  const r = d.listReceipts()[0];
  const doc = made(() => purchasing.printReceipt(r));
  assert.equal(doc.number, r.id);
  assert.equal(doc.rows.length, r.lines.length, 'one row per landing (a line may split across bins)');
  const value = r.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  assert.equal(doc.totals.at(-1).value, d.money(value), 'the landings add up');
});

check("the order prints the store's own Gross", () => {
  const o = d.listOrders()[0];
  const doc = made(() => orders.printOrder(o));
  assert.equal(doc.number, o.orderId);
  assert.equal(doc.rows.length, o.lineItems.length, 'one row per line');
  assert.equal(doc.totals.at(-1).value, d.money(d.orderAmount(o)), 'the strong row is orderAmount()');
});

check('the work order prices parts and labour to the store total', () => {
  const w = d.listWorkOrders()[0];
  const doc = made(() => maintenance.printWorkOrder(w));
  const c = d.workOrderCost(w);
  const byLabel = Object.fromEntries(doc.totals.map((t) => [t.label, t.value]));
  assert.equal(byLabel.Parts, d.money(c.partsCost));
  assert.equal(byLabel.Labor, d.money(c.laborCost));
  assert.equal(byLabel['Total Cost'], d.money(c.total), 'parts + labour = the grid’s Cost column');
  assert.equal(doc.rows.length, w.parts.length + 1, 'one row per part, plus the labour row');
});

check('the rate card prints every negotiated rate beside the catalog’s own', () => {
  const c = d.listPriceCards()[0];
  const doc = made(() => pricing.printCard(c));
  assert.equal(doc.number, c.id);
  assert.deepEqual(doc.columns, ['Item', 'Type', 'Negotiated', 'Catalog']);
  assert.equal(doc.rows.length, c.lines.length, 'one row per negotiated rate');
  assert.ok(!doc.totals, 'a card is rates, not money owed — no totals block');
});

check('the dispatch note carries the order it delivers, with its trip', () => {
  const dis = d.listDispatches()[0];
  const order = d.getOrder(dis.orderId);
  const doc = made(() => logistics.printDispatch(dis));
  assert.equal(doc.number, dis.id);
  assert.equal(doc.rows.length, order.lineItems.length, "the cargo is the carried order's lines");
  const labels = doc.meta.map((m) => m.label);
  assert.ok(labels.includes('Driver (CDL)'), 'the trip names the driver');
  assert.ok(labels.includes('Truck'), 'and the truck');
});

check('the pick list is the board day it was asked for', () => {
  assert.equal(handoff.tab, 'outbound', 'the board opens on Outbound');
  const out = made(() => handoff.printPickList());
  assert.equal(out.heading, 'Pick List');
  assert.equal(out.number, handoff.dayLabel(), 'the document is the day on screen');
  assert.equal(out.rows.length, handoff.outbound().length, 'one row per outbound unit');
  handoff.tab = 'incoming';
  const back = made(() => handoff.printPickList());
  assert.equal(back.heading, 'Return Pick List', 'the incoming board is a return');
  assert.equal(back.rows.length, handoff.incoming().length, 'one row per incoming unit');
  handoff.tab = 'outbound';
});

/* ---- The grouped reports: a schedule is orders of assets, a timesheet is
   employees of orders — and each *primary* prints its own total before the detail
   that makes it up. ---- */
const scheduler = new SchedulerComponent(d, { detectChanges() {}, markForCheck() {} }, { ask: async () => false }, printer);
const timesheet = new TimesheetComponent(d, { detectChanges() {}, markForCheck() {} }, search, printer);
/* The timesheet anchors *itself* on the week its segments sit in (the component
   constructor), so nothing here moves the calendar by hand — the checks below fail
   if that stops working. */

check('the schedule groups by order, and each order carries its own total', () => {
  const doc = made(() => scheduler.printSchedule('print'));
  assert.ok(Array.isArray(doc.groups) && doc.groups.length > 0, 'grouped, not a flat table');
  assert.equal(doc.rows, undefined, 'and not also a flat table');
  for (const g of doc.groups) {
    assert.ok(g.title.includes(' · '), 'the group names its order: ' + g.title);
    assert.ok((g.rows ?? []).length > 0, 'and lists its assets');
    assert.ok((g.subtotals ?? []).some((t) => t.strong), 'with the order total emphasised');
  }
});

check('the expanded schedule adds the asset level under each order', () => {
  const expanded = made(() => scheduler.printSchedule('print-expanded'));
  const flat = made(() => scheduler.printSchedule('pdf'));
  assert.equal(expanded.groups.length, flat.groups.length, 'same orders, more detail');
  for (const g of expanded.groups) {
    assert.ok((g.subgroups ?? []).length > 0, 'every order breaks into its assets: ' + g.title);
    assert.equal(g.rows, undefined, 'the order level holds subgroups, not rows');
    for (const sg of g.subgroups) {
      assert.ok(sg.title, 'the asset names itself');
      assert.ok((sg.rows ?? []).length > 0, 'and lists its bookings');
      assert.ok((sg.subtotals ?? []).length > 0, 'with the asset subtotal');
    }
  }
});

check('the timesheet groups by employee, and each employee carries their own total', () => {
  const doc = made(() => timesheet.printTimesheet('print'));
  assert.ok(Array.isArray(doc.groups) && doc.groups.length > 0, 'grouped by employee');
  assert.equal(doc.rows, undefined, 'not a flat table');
  for (const g of doc.groups) {
    assert.ok(g.title.includes(' · '), 'the group names its employee: ' + g.title);
    assert.ok((g.subtotals ?? []).some((t) => t.strong), 'with the employee total emphasised');
    assert.ok((g.rows ?? []).length > 0, 'and lists the orders they clocked into');
  }
});

check('the expanded timesheet adds the order level under each employee', () => {
  const doc = made(() => timesheet.printTimesheet('pdf-expanded'));
  for (const g of doc.groups) {
    assert.ok((g.subgroups ?? []).length > 0, 'each employee breaks into orders: ' + g.title);
    assert.equal(g.rows, undefined, 'the employee level holds subgroups, not rows');
    for (const sg of g.subgroups) assert.ok((sg.rows ?? []).length > 0, 'orders list their segments');
  }
});

console.log(`\ncheck30: ${n} checks`);
