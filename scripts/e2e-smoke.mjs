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

  writeFileSync(SHOTS + '/console-errors.txt', consoleErrors.join('\n'));
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0
  ? '\ne2e smoke: all checks passed (' + ROUTES.length + ' routes + the field editor)'
  : '\ne2e smoke: ' + failures + ' check(s) FAILED');
process.exit(failures === 0 ? 0 : 1);
