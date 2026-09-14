#!/usr/bin/env node
/**
 * The app's first *rendering* check (P9, see `angular-refactor-log.md`).
 *
 * Until this existed, nothing here could look at a screen: no Chrome on the box meant Karma
 * could never run, so the 25 Node harnesses prove the store and **nothing** proved that a
 * page renders. This drives the *built* app in headless Chromium instead: it serves
 * `dist/ims-web/browser` (with SPA fallback), walks the routes, fails on any console error,
 * screenshots each page, and exercises the one `OnPush` component (P8's pilot) through the
 * category editor — the check no gate could make.
 *
 * It also covers something the harnesses cannot: **the lazy chunks.** Every route below is a
 * `loadComponent` page (P7), so a broken chunk boundary shows up here as a blank page and a
 * console error rather than as a silent regression.
 *
 * Usage:  npm run build && npm run e2e
 * Shots:  dist/e2e/*.png  (a baseline you can eyeball after a stylesheet change)
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { serve } from './serve-dist.mjs';

const PORT = 4173;
const SHOTS = 'dist/e2e';
const ROUTES = [
  ['/', 'Operations Dashboard'],
  ['/assets', 'Assets'],
  ['/inspections', 'Receiving / Inspections'],
  ['/purchasing', 'Purchasing & Receiving'],
  ['/scheduler', 'Scheduling'],
  ['/admin/verticals', 'Your business type'],
];

/* The whole route map. Phase H walks it a second time with the workspace *emptied* —
   the state that finds a page quietly assuming the seed (a `[0]`, a `.find(...)`, a
   vertical that is not there). A clean console on every one of these is the claim. */
const ALL_ROUTES = [
  '/',
  '/assets',
  '/orders',
  '/pricing',
  '/purchasing',
  '/inspections',
  '/handoff',
  '/logistics',
  '/maintenance',
  '/rentals',
  '/scheduler',
  '/timesheet',
  '/telemetry',
  '/invoicing',
  '/admin/locations',
  '/admin/verticals',
  '/admin/dashboard',
  '/admin/modules',
  '/admin/sample-data',
];

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log('  ok  ' + label);
  else {
    failures++;
    console.log('FAIL  ' + label + (detail ? '\n      ' + detail : ''));
  }
};

/* Angular updates the DOM a microtask *after* the click Playwright dispatches, so a bare
   `count()` straight after `click()` reads the old DOM. Every DOM assertion below settles
   through this instead: poll the predicate until it holds or the budget runs out. (The
   first version of this file did the bare count and reported three failures that were all
   its own — the app was fine. Worth keeping in mind when adding checks here.) */
const settle = async (fn, ms = 2500) => {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > ms) return false;
    await page.waitForTimeout(50);
  }
};

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  for (const [path, expected] of ROUTES) {
    consoleErrors.length = 0;
    await page.goto('http://localhost:' + PORT + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar', { timeout: 5000 }).catch(() => {});
    const text = (await page.textContent('body')) ?? '';
    check('renders ' + path + ' (lazy chunk loaded, shell present)', text.includes(expected) && text.includes('IMS'), text.slice(0, 120));
    check('no console errors on ' + path, consoleErrors.length === 0, consoleErrors.join(' | '));
    await page.screenshot({ path: SHOTS + '/' + (path === '/' ? 'dashboard' : path.replace(/\W+/g, '-').replace(/^-|-$/g, '')) + '.png', fullPage: false });
  }

  /* ---- The stylesheet actually applied — not merely "text rendered".
     Text renders with NO CSS at all, so a stale hashed bundle or a 404'd sheet
     gives a page that reads fine and *looks* broken (a bare, unstyled sidebar).
     Nothing above would catch that, so this asserts the shell's pixels: the rail
     is painted matte slate at its pinned width, the shell is a flex box, the
     topbar is frosted, and the design tokens resolve. ---- */
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('.sidebar', { timeout: 5000 });
  const chrome = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      stylesheets: [...document.styleSheets].length,
      sidebarBgImage: cs('.sidebar')?.backgroundImage ?? '',
      sidebarBgColor: cs('.sidebar')?.backgroundColor ?? '',
      sidebarWidth: cs('.sidebar')?.width ?? '',
      topbarFilter: cs('.topbar')?.backdropFilter ?? '',
      shellDisplay: cs('.app-shell')?.display ?? '',
      brand: root.getPropertyValue('--brand').trim(),
      muted: root.getPropertyValue('--muted').trim(),
      ink: root.getPropertyValue('--ink').trim(),
      sidebarBgVar: root.getPropertyValue('--sidebar-bg').trim(),
      sidebarBg2Var: root.getPropertyValue('--sidebar-bg-2').trim(),
    };
  });
  check(
    'the stylesheet is applied (the sidebar rail is painted, not a bare list)',
    chrome.sidebarBgColor === 'rgb(30, 41, 59)' && chrome.sidebarWidth === '248px' && chrome.shellDisplay === 'flex',
    JSON.stringify(chrome),
  );
  check(
    'the rail is one matte slate fill (no gradient, not the light page tint showing through)',
    chrome.sidebarBgImage === 'none' && chrome.sidebarBgVar === '#1e293b' && chrome.sidebarBg2Var === '#0f172a',
    JSON.stringify(chrome),
  );
  check(
    'the design tokens resolve',
    chrome.brand === '#4f46e5' && chrome.muted === '#5a6a7f' && chrome.ink === '#0b1120',
    JSON.stringify(chrome),
  );

  /* ---- The P8 pilot: `OnPush` on `<ims-field-editor>`, exercised from the category editor.
     What it must prove: the child re-renders on its *own* events (add / type / remove), and
     the *parent* still re-renders from them (the Save button flipping is the parent's
     `fieldsValid()` running) — the two things a wrong `OnPush` breaks. ---- */
  consoleErrors.length = 0;
  await page.goto('http://localhost:' + PORT + '/admin/verticals', { waitUntil: 'load' });
  const categoriesCard = page.locator('.card', { hasText: '— categories' });
  await categoriesCard.waitFor({ timeout: 5000 });
  await categoriesCard.locator('tbody tr.row-open').first().click();
  await page.waitForSelector('ims-field-editor', { timeout: 5000 });
  const modalTitle = await page.locator('.modal-content .modal-title').textContent();
  check('the category editor opens with the field editor', (modalTitle ?? '').includes('Edit category'), modalTitle ?? '(no modal title)');

  const keyInputs = () => page.locator('ims-field-editor tbody input[placeholder="lotNumber"]');
  const rows = () => page.locator('ims-field-editor tbody tr');
  const saveButton = page.locator('.modal-content button', { hasText: 'Save' });
  const before = await keyInputs().count();
  await page.getByRole('button', { name: 'Add field' }).click();
  check('the grid adds a row on the child\'s own event (OnPush re-render)', await settle(async () => (await keyInputs().count()) === before + 1), 'before=' + before + ' after=' + (await keyInputs().count()));

  await keyInputs().last().fill('pilotProbe');
  await rows().last().locator('input').nth(1).fill('Pilot Probe');
  check('the parent re-renders from the child\'s event (Save enabled once keys are valid)', await settle(async () => (await saveButton.isDisabled()) === false));
  await rows().last().locator('button[title="Move up"]').click();
  check(
    'the typed key survives a child re-render (the row moved, the value travelled)',
    await settle(async () => (await keyInputs().evaluateAll((els) => els.map((e) => e.value))).includes('pilotProbe')),
    'live key values: ' + JSON.stringify(await keyInputs().evaluateAll((els) => els.map((e) => e.value))),
  );

  await page.locator('ims-field-editor tbody button[title="Remove"]').last().click();
  check('the grid removes a row on the child\'s own event', await settle(async () => (await keyInputs().count()) === before));

  await page.screenshot({ path: SHOTS + '/verticals-field-editor.png' });
  await page.locator('.modal .btn-close').click();
  check('no console errors through the editor', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Printable documents (Phase B): a page builds a `PrintDocument`, the one
     `<ims-print-document>` host renders it, and `@media print` shows it alone.
     `window.print` is stubbed before the navigation so headless Chromium does not
     block on a print dialog — the check is that the document *renders*. ---- */
  consoleErrors.length = 0;
  await page.addInitScript(() => {
    window.print = () => { window.__printCalls = (window.__printCalls ?? 0) + 1; };
  });
  await page.goto('http://localhost:' + PORT + '/purchasing', { waitUntil: 'load' });
  await page.waitForSelector('#sidebar', { timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: /Purchase Orders/ }).click();
  await page.waitForSelector('table tbody tr.row-open', { timeout: 5000 });
  /* The print action is a menu now: the printer icon (with its chevron) opens it
     and the menu picks the mode. It is drawn from the app root, so it must land
     on screen rather than being clipped by the table pane it hangs from. */
  const openPrintMenu = async (selector) => {
    await page.locator(selector).first().click();
    const panel = page.locator('.print-menu.ready');
    await panel.waitFor({ timeout: 5000 });
    return panel;
  };
  const printVia = async (selector, item = 0) => {
    await openPrintMenu(selector);
    await page.locator('.print-menu-item').nth(item).click();
  };

  const panel = await openPrintMenu('button[title="Print purchase order"]');
  const panelBox = await panel.boundingBox();
  const vp = page.viewportSize();
  check(
    'the print menu opens on screen with Print and Save to PDF',
    !!panelBox && panelBox.x >= 0 && panelBox.y >= 0 &&
      panelBox.x + panelBox.width <= vp.width + 1 && panelBox.y + panelBox.height <= vp.height + 1 &&
      (await page.locator('.print-menu-item').count()) === 2,
    JSON.stringify({ panelBox, vp }),
  );
  await page.locator('.print-menu-item').first().click();
  check(
    'a printable document renders into the print host',
    await settle(async () => (await page.locator('ims-print-document .print-doc').count()) === 1),
  );
  const printText = (await page.locator('ims-print-document .print-doc').textContent()) ?? '';
  check(
    'the printed document carries a heading and its lines',
    printText.toUpperCase().includes('PURCHASE ORDER') && printText.includes('Ordered Total'),
    printText.replace(/\s+/g, ' ').slice(0, 140),
  );
  check('the print dialog was opened once', await settle(async () => (await page.evaluate(() => window.__printCalls)) === 1));

  /* The second item runs the same builder; only the destination differs. */
  await printVia('button[title="Print purchase order"]', 1);
  check(
    'Save to PDF runs the same builder (the dialog opens again)',
    await settle(async () => (await page.evaluate(() => window.__printCalls)) === 2),
  );
  await page.screenshot({ path: SHOTS + '/print-purchase-order.png' });
  check('no console errors through printing', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Phase B stretch: the remaining documents render through the same host —
     a goods receipt, a dispatch note, a work order and a rate card. ---- */
  const printDoc = async (path, title, heading, tab) => {
    await page.goto('http://localhost:' + PORT + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar', { timeout: 5000 }).catch(() => {});
    if (tab) await page.getByRole('button', { name: tab }).click();
    await page.waitForSelector('table tbody tr.row-open', { timeout: 5000 });
    await printVia('button[title="' + title + '"]');
    return settle(async () => {
      const t = ((await page.locator('ims-print-document .print-doc').textContent()) ?? '').toUpperCase();
      return t.includes(heading.toUpperCase());
    });
  };

  check('a goods receipt prints', await printDoc('/purchasing', 'Print goods receipt', 'Goods Receipt', /Receipts/));
  check('a dispatch note prints', await printDoc('/logistics', 'Print dispatch note', 'Dispatch Note'));
  check('a work order prints', await printDoc('/maintenance', 'Print work order', 'Work Order'));
  check('a rate card prints', await printDoc('/pricing', 'Print rate card', 'Rate Card'));
  check('no console errors through the other documents', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- The rest of the print surface: the custody log, the inspection log, a
     schedule and a timesheet. The two calendars also offer the expanded detail
     level, so their menus carry four items instead of two. ---- */
  check('the custody log prints', await printDoc('/handoff', 'Print the custody log', 'Custody Log', /Custody Log/));
  check('the inspection log prints', await printDoc('/inspections', 'Print the inspection log', 'Inspection Log'));

  const printTimeline = async (path, title, word, item = 0) => {
    await page.goto('http://localhost:' + PORT + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar', { timeout: 5000 }).catch(() => {});
    await openPrintMenu('button[title="' + title + '"]');
    const items = await page.locator('.print-menu-item').count();
    await page.locator('.print-menu-item').nth(item).click();
    const ok = await settle(async () => {
      const t = ((await page.locator('ims-print-document .print-doc').textContent()) ?? '').toUpperCase();
      return t.includes(word.toUpperCase());
    });
    const doc = page.locator('ims-print-document .print-doc');
    const groups = await doc.locator('.print-group-title').count();
    const subtotals = await doc.locator('.print-group-totals').count();
    const subgroups = await doc.locator('.print-subgroup-title').count();
    return { ok, items, groups, subtotals, subgroups };
  };
  /* The two reports are grouped: a schedule by order (then asset), a timesheet by
     employee (then order) — and each *primary* carries its own subtotal. */
  const sched = await printTimeline('/scheduler', 'Print this schedule', 'Schedule');
  check(
    'a schedule prints, grouped by order with a subtotal under each',
    sched.ok && sched.items === 4 && sched.groups > 0 && sched.subtotals === sched.groups,
    JSON.stringify(sched),
  );
  const sheet = await printTimeline('/timesheet', 'Print this timesheet', 'Timesheet');
  check(
    'a timesheet prints, grouped by employee with a subtotal under each',
    sheet.ok && sheet.items === 4 && sheet.groups > 0 && sheet.subtotals === sheet.groups,
    JSON.stringify(sheet),
  );
  /* Item 3 is the expanded save-to-PDF: the second level (the asset inside the
     order, the order inside the employee) renders as a label row per group. */
  const schedX = await printTimeline('/scheduler', 'Print this schedule', 'Schedule', 3);
  check('the expanded schedule renders the asset level inside each order', schedX.ok && schedX.subgroups > 0, JSON.stringify(schedX));
  const sheetX = await printTimeline('/timesheet', 'Print this timesheet', 'Timesheet', 3);
  check('the expanded timesheet renders the order level inside each employee', sheetX.ok && sheetX.subgroups > 0, JSON.stringify(sheetX));

  /* ---- Field Service: the grid now carries the shared period filter. ---- */
  await page.goto('http://localhost:' + PORT + '/maintenance', { waitUntil: 'load' });
  await page.waitForSelector('table tbody tr.row-open', { timeout: 5000 });
  check(
    'the work-order grid has the All / Day / Week / Month period filter',
    (await page.getByRole('button', { name: 'Month', exact: true }).count()) === 1 &&
      (await page.locator('.log-filter .btn-group button').count()) === 4,
  );
  check('no console errors through the new documents', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Sub-rentals: the hold window, the return, and the register print. ---- */
  const returns = () => page.locator('button[title="Record the return to the supplier"]');
  check('the sub-rental register prints', await printDoc('/rentals', 'Print the sub-rental register', 'Sub-Rental Register'));
  check(
    'the ledger carries the window and a status column (and one row is already back)',
    (await page.locator('table tbody tr.row-open').first().locator('td').count()) === 10 &&
      (await page.locator('table tbody tr.row-open', { hasText: 'Returned' }).count()) >= 1,
  );
  const outBefore = await returns().count();
  await returns().first().click();
  check(
    'recording a return takes the row out of the "out" set',
    await settle(async () => (await returns().count()) === outBefore - 1),
    'returns before=' + outBefore + ' after=' + (await returns().count()),
  );
  await page.screenshot({ path: SHOTS + '/rentals.png' });
  check('no console errors through the sub-rental register', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Phase C: the dashboard's widget arrangement, edited on Admin → Dashboard.
     What it proves: the admin lists every registry widget, a switch moves one to
     the hidden list, and the dashboard itself honours the arrangement. ---- */
  consoleErrors.length = 0;
  await page.goto('http://localhost:' + PORT + '/admin/dashboard', { waitUntil: 'load' });
  const widgetsCard = page.locator('.card', { hasText: 'Operations Dashboard' });
  await widgetsCard.waitFor({ timeout: 5000 });
  const switches = page.locator('input.form-check-input');
  check('Admin → Dashboard lists every registered widget', (await switches.count()) === 9, 'switch count: ' + (await switches.count()));

  await page.locator('input#dw-book-value').uncheck();
  check(
    'switching a widget off moves it to the hidden list',
    await settle(async () => (await page.locator('input#dwh-book-value').count()) === 1),
  );
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('.dash-bento', { timeout: 5000 });
  check(
    'the dashboard honours the arrangement (the hidden widget is gone)',
    await settle(async () => !((await page.locator('.dash-bento').textContent()) ?? '').includes('Total Fleet Book Value')),
  );
  await page.screenshot({ path: SHOTS + '/admin-dashboard.png' });

  await page.goto('http://localhost:' + PORT + '/admin/dashboard', { waitUntil: 'load' });
  await page.getByRole('button', { name: /Reset Order/ }).click();
  check(
    'Reset Order restores the registry default',
    await settle(async () => (await page.locator('input#dw-book-value').count()) === 1),
  );
  check('no console errors through the dashboard layout', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Phase H: the two workspace-wide buttons, on Admin → Sample data. Emptying
     the store is the one action that can leave *every* page reading nothing, so this
     wipes it, walks the whole route map, and insists on a clean console — then loads
     the fixture back and checks the tally returns to where it started. ---- */
  consoleErrors.length = 0;
  await page.goto('http://localhost:' + PORT + '/admin/sample-data', { waitUntil: 'load' });
  await page.waitForSelector('.samp-grid', { timeout: 5000 });
  /** The "Holding now · N rows" line — the page's own read of the store. */
  const holding = async () => {
    const text = (await page.locator('div.strong', { hasText: 'Holding now' }).textContent()) ?? '';
    return Number(text.replace(/[^0-9]/g, '') || '0');
  };
  const cells = page.locator('.samp-cell');
  const heldBefore = await holding();
  check('Admin → Sample data tallies the workspace table by table', heldBefore > 0 && (await cells.count()) >= 20, 'rows: ' + heldBefore + ', cells: ' + (await cells.count()));
  await page.screenshot({ path: SHOTS + '/admin-sample-data.png' });

  await page.getByRole('button', { name: /Remove all sample data/ }).click();
  await page.locator('.confirm-dialog .modal-footer .btn-ims').click();
  check('Remove all sample data empties the workspace', await settle(async () => (await holding()) === 0), 'rows: ' + (await holding()));
  check(
    'the tally shows every table at zero (a wipe, not a missing table)',
    (await page.locator('.samp-cell.samp-zero').count()) === (await cells.count()),
    'zeroed ' + (await page.locator('.samp-cell.samp-zero').count()) + ' of ' + (await cells.count()),
  );

  /* Every page now reads nothing — and must still render, with a clean console. */
  for (const path of ALL_ROUTES) {
    consoleErrors.length = 0;
    await page.goto('http://localhost:' + PORT + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar', { timeout: 5000 }).catch(() => {});
    const text = (await page.textContent('body')) ?? '';
    check(
      'a page with an empty workspace renders clean: ' + path,
      text.includes('IMS') && consoleErrors.length === 0,
      consoleErrors.join(' | '),
    );
  }

  /* And back again. */
  consoleErrors.length = 0;
  await page.goto('http://localhost:' + PORT + '/admin/sample-data', { waitUntil: 'load' });
  await page.waitForSelector('.samp-grid', { timeout: 5000 });
  await page.getByRole('button', { name: /Load sample data/ }).click();
  await page.locator('.confirm-dialog .modal-footer .btn-ims').click();
  check('Load sample data puts the fixture back, row for row', await settle(async () => (await holding()) === heldBefore), 'rows: ' + (await holding()));
  check('no console errors through the sample-data buttons', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---- Phase I: the table footer — record count, page size, pager. What it proves:
     the footer is under the table, the count matches the rows, a page size slices them,
     the pager moves, and the choice is remembered across a reload. ---- */
  consoleErrors.length = 0;
  await page.goto('http://localhost:' + PORT + '/assets', { waitUntil: 'load' });
  await page.waitForSelector('.tbl-foot[data-table="assets"]', { timeout: 5000 });
  const foot = page.locator('.tbl-foot[data-table="assets"]');
  const shownRows = () => page.locator('table[imspaged="assets"] tbody tr:visible').count();
  const total = await shownRows();
  const footText = async () => (await foot.locator('.tbl-foot-page').textContent()) ?? '';
  check(
    'the footer states the record range beside the pager',
    (await footText()).startsWith('Records 1–') && (await footText()).includes(`of ${total}`),
    `${await footText()} / rows ${total}`,
  );
  check(
    'the far-left of the footer is free (the range replaced the separate count)',
    (await foot.locator('.tbl-foot-count').count()) === 0 && (await foot.locator('.tbl-foot-tools').count()) === 1,
  );
  await foot.screenshot({ path: SHOTS + '/table-footer.png' });

  // The chevron is drawn at the box's right edge, so the value needs room on its left and
  // the arrow needs its own clearance — measured, because "it looked fine" is not a test.
  const sizing = await foot.locator('select').evaluate((el) => {
    const cs = getComputedStyle(el);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = `${cs.fontSize} ${cs.fontFamily}`;
    const widest = Math.max(...[...el.options].map((o) => canvas.measureText(o.text).width));
    return {
      room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      widest,
      padRight: parseFloat(cs.paddingRight),
    };
  });
  check(
    'the page-size box leaves the value clear of its chevron',
    sizing.room > sizing.widest + 10 && sizing.padRight >= 24,
    JSON.stringify(sizing),
  );

  await foot.locator('select').selectOption('10');
  check(
    'picking a page size shows that many rows',
    await settle(async () => (await shownRows()) === Math.min(10, total)),
    'rows: ' + (await shownRows()),
  );
  await foot.locator('.tbl-foot-pager button').nth(1).click();
  check(
    'the pager moves to the next page',
    await settle(async () => !(await footText()).startsWith('Records 1–')),
    await footText(),
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tbl-foot[data-table="assets"]', { timeout: 5000 });
  check(
    'the page size is remembered across a reload',
    (await page.locator('.tbl-foot[data-table="assets"] select').inputValue()) === '10',
  );
  check('the count sits below the table, not in the header', (await page.locator('.card-header .tbl-foot').count()) === 0);

  /* ---- Every table footer lines up with its table, on every page that has one.
     The bug this encodes (2026-09-13): three views put `card-body table-wrap` on a
     single element, so the footer — inserted *after* the wrapper — landed outside the
     card body's padding and sat 14px wider than the table on each side, while Item
     Hand-Off (the reference) aligned. The invariant is the one a reader sees: the
     footer must span the **content box** of the `.table-wrap` it was inserted after —
     the box the table is laid out in. Comparing border boxes is not enough: a wrapper
     that carries padding (the buggy shape) has a border box the footer can match
     exactly while the table inside it sits 14px further in. ---- */
  const FOOTER_ROUTES = [
    '/orders', '/purchasing', '/inspections', '/handoff', '/logistics', '/maintenance',
    '/rentals', '/telemetry', '/invoicing', '/admin/locations', '/admin/verticals',
  ];
  for (const route of FOOTER_ROUTES) {
    await page.goto('http://localhost:' + PORT + route, { waitUntil: 'load' });
    await page.waitForSelector('.tbl-foot', { timeout: 5000 }).catch(() => {});
    const misaligned = await page.evaluate(() => {
      const out = [];
      for (const foot of document.querySelectorAll('.tbl-foot')) {
        const wrap = foot.previousElementSibling;
        if (!wrap || !wrap.classList.contains('table-wrap')) {
          out.push((foot.dataset.table ?? '?') + ': not directly after a .table-wrap');
          continue;
        }
        const a = foot.getBoundingClientRect();
        const b = wrap.getBoundingClientRect();
        const cs = getComputedStyle(wrap);
        const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
        const dl = Math.round((a.left - (b.left + padL)) * 10) / 10;
        const dr = Math.round((b.right - padR - a.right) * 10) / 10;
        if (Math.abs(dl) > 1 || Math.abs(dr) > 1) out.push(`${foot.dataset.table}: left off ${dl}, right off ${dr} (wrapper padding ${cs.padding})`);
      }
      return out;
    });
    check('every table footer lines up with its table: ' + route, misaligned.length === 0, misaligned.join(' | '));
  }
  /* ---- Phase L: the flat row actions. What it proves: a row action is a bare
     glyph (no border, no fill, a 6px box), it stays at 35% until its own row is
     pointed at (or reached by keyboard), and the glyph then takes the action's
     colour — add green, edit blue, remove red. Measured, because "it looks flat"
     is not a test. ---- */
  await page.goto('http://localhost:' + PORT + '/admin/locations', { waitUntil: 'load' });
  await page.waitForSelector('.action-btn', { timeout: 5000 });
  const actionStyle = await page.locator('.action-btn').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      border: cs.borderTopWidth,
      radius: cs.borderRadius,
      padding: cs.padding,
      background: cs.backgroundColor,
      colour: cs.color,
      // a flex *item* is blockified, so `inline-flex` computes to `flex` here
      display: cs.display,
    };
  });
  check(
    'a row action is a bare glyph (no border, no fill, 6px box)',
    actionStyle.border === '0px' &&
      actionStyle.radius === '6px' &&
      actionStyle.padding === '6px' &&
      actionStyle.background === 'rgba(0, 0, 0, 0)' &&
      actionStyle.display === 'flex' &&
      actionStyle.colour === 'rgb(122, 138, 161)',
    JSON.stringify(actionStyle),
  );

  const firstRow = page.locator('table tbody tr').first();
  const firstAction = firstRow.locator('.action-btn').first();
  const quiet = await firstAction.evaluate((el) => getComputedStyle(el).opacity);
  await firstRow.hover();
  // opacity is transitioned (`--t-fast`), so wait for it to arrive
  const lit = await settle(async () => Number(await firstAction.evaluate((el) => getComputedStyle(el).opacity)) === 1);
  check('row actions stay quiet until their row is pointed at', Number(quiet) < 0.5 && lit, `${quiet} -> ${lit}`);

  const hoverColour = async (icon, expected) => {
    const btn = page.locator(`.action-btn:has(${icon})`).first();
    await btn.hover();
    // the colour is transitioned (`--t-fast`): wait for the *final* tone, not the
    // first frame — a predicate that only asks "has it left the resting tone?" reads
    // a mid-transition colour.
    await settle(async () => (await btn.evaluate((el) => getComputedStyle(el).color)) === expected);
    return btn.evaluate((el) => getComputedStyle(el).color);
  };
  const addColour = await hoverColour('.bi-plus-lg', 'rgb(22, 163, 74)');
  const editColour = await hoverColour('.bi-pencil', 'rgb(37, 99, 235)');
  const removeColour = await hoverColour('.bi-x-lg', 'rgb(220, 38, 38)');
  check('an add action turns green on hover', addColour === 'rgb(22, 163, 74)', addColour);
  check('an edit action turns blue on hover', editColour === 'rgb(37, 99, 235)', editColour);
  check('a remove action turns red on hover', removeColour === 'rgb(220, 38, 38)', removeColour);

  const actionGap = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.action-cell')].find((c) => c.querySelectorAll('.action-btn').length > 1);
    return cell ? getComputedStyle(cell).gap : null;
  });
  check('two actions in one cell sit 12px apart', actionGap === '12px', String(actionGap));

  // The print menu renders its own button and keeps `.btn` for the reset, so its
  // cascade is the one place `.action-btn` has to out-specify another class.
  // (Maintenance's work-order rows are on the page's default view; Orders' print
  // action sits behind its second tab.)
  await page.goto('http://localhost:' + PORT + '/maintenance', { waitUntil: 'load' });
  await page.waitForSelector('.action-btn.print-menu-btn', { timeout: 5000 });
  const printAction = await page.locator('.action-btn.print-menu-btn').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, padding: cs.padding, radius: cs.borderRadius, background: cs.backgroundColor };
  });
  check(
    'the print action in a row is flat too (it keeps .btn for the reset)',
    printAction.border === '0px' &&
      printAction.padding === '6px' &&
      printAction.radius === '6px' &&
      printAction.background === 'rgba(0, 0, 0, 0)',
    JSON.stringify(printAction),
  );

  /* ---- Phase M–P: the board's glyphs, the party switch, the work-order modal
     and the action columns. What it proves: (M) Item Hand-Off checks a unit in
     and returns one from custody with the same flat glyph the rest of the grid
     uses; (N) a party's Active is a switch and the parties tab filters; (O) a
     work order's parts left the grid for its modal, which itemises and totals
     them the way the invoice modal does; (P) an action never moves sideways
     because a *sibling* action is unavailable, every action is the same 27px box
     (the print menu's own included), and a pointed-at row is darker. ---- */

  /* M: the board actions. Outbound keeps its labelled primary button, so only the
     two the change covers are measured here. */
  await page.goto('http://localhost:' + PORT + '/handoff', { waitUntil: 'load' });
  await page.waitForSelector('.subtab', { timeout: 5000 });
  const boardAction = async (tab) => {
    await page.locator('.subtab', { hasText: tab }).first().click();
    await page.waitForSelector('table tbody tr .action-btn', { timeout: 5000 });
    return page.locator('table tbody tr .action-btn').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        label: el.textContent.trim(),
        border: cs.borderTopWidth,
        background: cs.backgroundColor,
        icon: (el.querySelector('i')?.className.match(/bi-[\w-]+/) ?? [''])[0],
      };
    });
  };
  const flatBoardGlyph = (a) =>
    a.label === '' && a.border === '0px' && a.background === 'rgba(0, 0, 0, 0)' && a.icon === 'bi-box-arrow-in-down';
  const boardCheckIn = await boardAction('Incoming');
  check('Hand-Off checks a unit in with a flat glyph, not a filled button', flatBoardGlyph(boardCheckIn), JSON.stringify(boardCheckIn));
  const boardReturn = await boardAction('In Custody');
  check('Hand-Off returns a unit from custody with the same glyph', flatBoardGlyph(boardReturn), JSON.stringify(boardReturn));

  /* N: a party's Active is a switch, and the tab filters on it. The fixture ships
     every partner active, so the check flips one off and filters for it — which is
     also the only way a reader sees the switch move. It flips it back: the rest of
     the run shares this workspace. */
  await page.goto('http://localhost:' + PORT + '/orders', { waitUntil: 'load' });
  await page.waitForSelector('table tbody .form-check-input', { timeout: 5000 });
  const partyRows = await page.locator('table tbody tr.row-open').count();
  const partySwitches = page.locator('table tbody .form-check-input');
  const switchBox = await partySwitches.first().evaluate((el) => ({
    role: el.getAttribute('role'),
    width: Math.round(el.getBoundingClientRect().width),
    radius: getComputedStyle(el).borderRadius,
  }));
  check(
    "a party's Active is a switch, on by default",
    switchBox.role === 'switch' && (await partySwitches.count()) === partyRows && (await partySwitches.first().isChecked()),
    JSON.stringify(switchBox) + ' rows: ' + partyRows,
  );
  await partySwitches.first().click();
  const flippedOff = await settle(async () => !(await partySwitches.first().isChecked()));
  /* A deactivated partner must not stand its row taller than its neighbours. The
     chip that used to ride beside the name was an `inline-flex` badge (padding,
     border, `line-height: 1.3`), so the deck stepped out of rhythm — 48px against
     51px — the moment one party was switched off. */
  const partyHeights = await page.evaluate(() => [
    ...new Set([...document.querySelectorAll('table tbody tr.row-open')].map((r) => Math.round(r.getBoundingClientRect().height))),
  ]);
  check(
    'switching a party off does not change the row height',
    partyHeights.length === 1,
    'row heights: ' + partyHeights.join('/'),
  );
  /* Every row reads its own party, so the row whose switch is off must be the row
     whose Status chip says Inactive — whichever row that turns out to be. The chip
     can land one change-detection cycle *after* the flip when the workspace was
     re-seeded (a persisted snapshot loads after the first render), so this waits
     for the value: reading the first frame after a click is how Phase L's colour
     checks lied too. */
  await settle(async () => (await page.evaluate(() => {
    const r = document.querySelector('table tbody tr.row-open');
    return r?.children[5]?.querySelector('.badge-status')?.textContent.trim();
  })) === 'Inactive');
  const partyRowsState = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr.row-open')].map((r) => {
      const chip = r.children[5]?.querySelector('.badge-status');
      return {
        name: (r.children[0]?.textContent ?? '').trim(),
        cells: r.children.length,
        on: r.querySelector('.form-check-input')?.checked,
        status: chip?.textContent.trim(),
        cls: chip?.className,
      };
    }),
  );
  const offRow = partyRowsState.find((r) => r.on === false);
  check(
    'the Status column names the state the switch is in',
    !!offRow && offRow.status === 'Inactive' && (offRow.cls ?? '').includes('st-out'),
    JSON.stringify(partyRowsState),
  );
  await page.getByRole('button', { name: 'Inactive', exact: true }).click();
  const filtered = await settle(async () => (await page.locator('table tbody tr.row-open').count()) < partyRows);
  const partyState = await page.evaluate(() => ({
    showing: (document.querySelector('.card-body .text-muted2')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    groups: [...document.querySelectorAll('.btn-group')]
      .map((g) => [...g.querySelectorAll('button')].map((b) => b.innerText.trim() + (b.classList.contains('btn-ims') ? '*' : '')).join(',')),
    rows: document.querySelectorAll('table tbody tr.row-open').length,
    on: [...document.querySelectorAll('table tbody .form-check-input')].filter((b) => b.checked).length,
  }));
  const inactiveOnly = { rows: partyState.rows, allOff: partyState.on === 0 };
  check(
    'the parties tab filters to inactive partners only',
    filtered && flippedOff && /showing inactive/i.test(partyState.showing) && inactiveOnly.rows === 1 && inactiveOnly.allOff,
    `rows ${partyRows} -> ${inactiveOnly.rows}, flipped: ${flippedOff}, all off: ${inactiveOnly.allOff} · ${JSON.stringify(partyState)}`,
  );
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(150);
  const offSwitch = page.locator('table tbody .form-check-input:not(:checked)').first();
  if (await offSwitch.count()) await offSwitch.click();
  const restored = await settle(async () => (await page.locator('table tbody .form-check-input:not(:checked)').count()) === 0);
  check('switching a party back on restores it', restored, 'still checked off: ' + (await page.locator('table tbody .form-check-input:not(:checked)').count()));

  /* O: a work order's parts left the grid for its modal — which now reads like the
     invoice modal: facts, an itemised priced table, then the totals. */
  await page.goto('http://localhost:' + PORT + '/maintenance', { waitUntil: 'load' });
  await page.waitForSelector('table tbody tr.row-open', { timeout: 5000 });
  const woHeads = await page.locator('table thead th').allInnerTexts();
  check('the work-order grid no longer carries a Parts Used column', !woHeads.some((h) => /parts used/i.test(h)), woHeads.join(' | '));
  await page.locator('table tbody tr.row-open').first().click();
  await page.waitForSelector('.modal.show .table tbody tr', { timeout: 5000 });
  const woViewer = await page.evaluate(() => {
    const m = document.querySelector('.modal.show');
    const t = m.querySelector('.table');
    return {
      columns: [...t.querySelectorAll('thead th')].map((x) => x.innerText.trim().toLowerCase()).join('|'),
      rowCells: [...t.querySelectorAll('tbody tr')].map((r) => r.children.length),
      totals: [...m.querySelectorAll('.list-line')]
        .map((l) => l.innerText.replace(/\s+/g, ' ').trim())
        .filter((x) => /^(Parts|Labor|Total Cost) /.test(x)),
    };
  });
  check(
    'a work order opens with its parts and labor itemised like an invoice',
    woViewer.columns === 'part / labor|kind|qty|rate|amount' &&
      woViewer.rowCells.length >= 2 &&
      woViewer.rowCells.every((n) => n === 5) &&
      woViewer.totals.length === 3 &&
      woViewer.totals[2].startsWith('Total Cost '),
    JSON.stringify(woViewer),
  );
  await page.keyboard.press('Escape');

  /* P: an action keeps its column on every row of its table. The bug this encodes
     (2026-09-13, Invoicing): "Mark paid" was rendered only while the invoice was
     unpaid, so on the paid rows every button after it slid one column to the right
     — Print and Details moved out from under their own column. It renders disabled
     now, and this walks every table in the app looking for drift. Rows the pager
     has paged out keep their DOM but lose their box, so they are skipped: the
     invariant a reader sees is about the rows on screen. ---- */
  const ACTION_ICONS = ['bi-eye', 'bi-printer', 'bi-check2', 'bi-box-arrow-in-down', 'bi-box-arrow-up-right', 'bi-plus-lg', 'bi-arrows-move', 'bi-clipboard2-check', 'bi-arrow-up', 'bi-arrow-down', 'bi-pencil', 'bi-x-lg'];
  const columnDrift = () => page.evaluate((icons) => {
    const out = [];
    for (const table of document.querySelectorAll('table.table')) {
      const rows = [...table.querySelectorAll('tbody tr')];
      for (const icon of icons) {
        const xs = rows
          .map((r) => r.querySelector('.action-btn:has(.' + icon + ')'))
          .filter((el) => el && el.getClientRects().length)
          .map((el) => Math.round(el.getBoundingClientRect().left));
        if (xs.length > 1 && new Set(xs).size > 1) out.push(icon + ' at ' + xs.join('/'));
      }
    }
    return out;
  }, ACTION_ICONS);
  const ACTION_ROUTES = ['/assets', '/orders', '/invoicing', '/purchasing', '/rentals', '/maintenance', '/inspections', '/pricing', '/admin/locations', '/admin/verticals', '/handoff', '/logistics'];
  for (const route of ACTION_ROUTES) {
    await page.goto('http://localhost:' + PORT + route, { waitUntil: 'load' });
    await page.waitForSelector('table tbody', { timeout: 5000 }).catch(() => {});
    const drift = await columnDrift();
    check('every action keeps its column across rows: ' + route, drift.length === 0, drift.join(' | '));
  }
  await page.goto('http://localhost:' + PORT + '/invoicing', { waitUntil: 'load' });
  await page.waitForSelector('table tbody tr .action-btn', { timeout: 5000 });
  const actionBoxes = await page.evaluate(() => [
    ...new Set([...document.querySelectorAll('table tbody tr .action-btn')].map((el) => {
      const r = el.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    })),
  ]);
  check('every row action is the same 27px box, the print menu included', actionBoxes.join() === '27x27', actionBoxes.join(' | '));
  const payStates = await page.evaluate(() => [...document.querySelectorAll('.action-btn:has(.bi-check2)')].map((b) => b.disabled));
  check('a paid invoice keeps its action in place, disabled', payStates.includes(true) && payStates.includes(false), JSON.stringify(payStates));

  /* P: the pointed-at row is darker than its band (the wash stepped up to .09). */
  const hoverRow = page.locator('table tbody tr.row-open').first();
  const bandTone = await hoverRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  await hoverRow.hover();
  const hoverArrived = await settle(async () => (await hoverRow.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(37, 99, 235, 0.09)');
  const hoverTone = await hoverRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('a pointed-at row is darker than its band', hoverArrived && hoverTone === 'rgba(37, 99, 235, 0.09)', `${bandTone} -> ${hoverTone}`);

  check('no console errors through the table footer', consoleErrors.length === 0, consoleErrors.join(' | '));

  writeFileSync(SHOTS + '/console-errors.txt', consoleErrors.join('\n'));
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0
  ? '\ne2e smoke: all checks passed (' + ROUTES.length + ' routes + applied stylesheet + the field editor + 5 printable documents + the dashboard layout + the sample-data buttons + the unified row actions over all ' + ALL_ROUTES.length + ' routes)'
  : '\ne2e smoke: ' + failures + ' check(s) FAILED');
process.exit(failures === 0 ? 0 : 1);
