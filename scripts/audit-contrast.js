#!/usr/bin/env node
/**
 * Phase D (docs/CODE-REVIEW.md) — a WCAG contrast audit for the design tokens.
 *
 * The design system's colours are all custom properties in `src/styles.scss`
 * (`--ink`, `--muted`, `--faint`, the semantic hues, the sidebar ramp). Nothing
 * checked that the *muted* end of that scale is still readable on the surfaces it
 * sits on — this does: it parses the tokens out of the sheet, computes the WCAG
 * 2.1 contrast ratio for every pair the app actually renders (body text on a
 * card, muted text on the page tint, a `st-*` badge hue on its own soft tint,
 * white on a solid brand fill, a sidebar item on the rail) and reports AA / AAA.
 *
 * Report-only, like the other audits (`lint:ctor`, `lint:styles`, `lint:dead`):
 * it prints a table and never fails the build. A failing pair is a *finding to
 * read*, not a mechanical edit — the fix is a design decision (darken a token),
 * and `npm run css:equiv` is how you prove what that moved.
 *
 * Usage:  npm run lint:contrast
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCSS = path.join(ROOT, 'src', 'styles.scss');
const LABEL = path.relative(ROOT, SCSS);

/* ------------------------------- the tokens ------------------------------- */

/** Every `--token: value;` declaration, last one wins (later `:root` overrides). */
function parseTokens(css) {
  const tokens = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/g;
  for (const m of css.matchAll(re)) tokens.set(m[1], m[2]);
  return tokens;
}

const css = fs.readFileSync(SCSS, 'utf8');
const TOKENS = parseTokens(css);

/* --------------------------------- colour --------------------------------- */

/** `#rgb` / `#rrggbb` -> [r, g, b] (0-255). */
function rgb(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio (1..21), order-independent. */
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolve a token name, or pass a literal `#hex` through. */
function colour(name) {
  if (name.startsWith('#')) return name;
  const v = TOKENS.get(name);
  if (!v) throw new Error(`unknown token ${name}`);
  return v.startsWith('#') ? v : '#ffffff'; // an rgba() token: only used as a fill
}

/* -------------------------- the pairs that matter -------------------------- */

/*
 * Every pair the app actually renders, with the threshold that applies:
 *
 *   'text' — normal-size text: WCAG AA is 4.5:1
 *   'ui'   — icons, dots, borders, solid fills with white glyphs: 3:1
 *
 * The semantic hues (`--success`, `--warning`, `--info`) are only ever used as
 * *icons and fills* in this app — there is no `.text-success` — so they are
 * checked at the UI threshold. The `st-*` chips are the opposite: they are
 * 10.5px text, and each one sets a hand-picked darker foreground on its soft
 * tint, so those exact pairs are what is measured.
 */
const PAIRS = [
  // --- text on the two surfaces ---
  ['Body text on a card', '--ink', '--card', 'text'],
  ['Secondary text on a card', '--ink-2', '--card', 'text'],
  ['Muted text on a card', '--muted', '--card', 'text'],
  ['Body text on the page', '--ink', '--bg', 'text'],
  ['Secondary text on the page', '--ink-2', '--bg', 'text'],
  ['Muted text on the page', '--muted', '--bg', 'text'],
  // --- links (the three hues links are painted in) ---
  ['Brand link on a card', '--brand', '--card', 'text'],
  ['Brand-deep link on a card', '--brand-deep', '--card', 'text'],
  ['Accent link on a card', '--accent', '--card', 'text'],
  // --- the one semantic hue used as text ---
  ['Danger text on a card', '--danger', '--card', 'text'],
  // --- the `st-*` status chips: 10.5px text on a soft tint ---
  ['Chip Available / Active', '#15803d', '--success-soft', 'text'],
  ['Chip Active (green)', '#15803d', '#dcfce7', 'text'],
  ['Chip On Rent (blue)', '#1d4ed8', '#dbeafe', 'text'],
  ['Chip In Shop (amber)', '#b45309', '#fef3c7', 'text'],
  ['Chip Staged (purple)', '#6d28d9', '#ede9fe', 'text'],
  ['Chip Reorder', '#b45309', '--warning-soft', 'text'],
  ['Chip Out', '#b91c1c', '--danger-soft', 'text'],
  ['Chip On (info)', '#0e7490', '--info-soft', 'text'],
  // --- white glyphs on a solid / gradient fill ---
  ['White on a brand fill', '#ffffff', '--brand', 'text'],
  ['KPI blue icon (gradient end)', '#ffffff', '--brand-2', 'ui'],
  ['KPI green icon (gradient end)', '#ffffff', '#15803d', 'ui'],
  ['KPI red icon (gradient end)', '#ffffff', '#ef4444', 'ui'],
  ['KPI purple icon (gradient end)', '#ffffff', '#a855f7', 'ui'],
  // --- the sidebar rail ---
  ['Sidebar item on the rail', '--sidebar-ink', '--sidebar-bg', 'text'],
  ['Sidebar item at the rail foot', '--sidebar-ink', '--sidebar-bg-2', 'text'],
  ['Sidebar dim on the rail', '--sidebar-ink-dim', '--sidebar-bg', 'text'],
  ['Sidebar dim at the rail foot', '--sidebar-ink-dim', '--sidebar-bg-2', 'text'],
  ['Sidebar strong on the rail', '--sidebar-ink-strong', '--sidebar-bg', 'text'],
  // --- icons / decorative glyphs (non-text: 3:1) ---
  ['Faint icon on a card', '--faint', '--card', 'ui'],
  ['Faint icon on the page', '--faint', '--bg', 'ui'],
  ['Success glyph on a card', '--success', '--card', 'ui'],
  ['Warning glyph on a card', '--warning', '--card', 'ui'],
  ['Info glyph on a card', '--info', '--card', 'ui'],
  ['Danger glyph on a card', '--danger', '--card', 'ui'],
  ['Purple glyph on a card', '--purple', '--card', 'ui'],
  /* NOT checked: `--line` and friends are decorative hairlines (card borders,
     dividers, table rules), and WCAG 1.4.11's 3:1 applies to graphical objects
     *required to understand* the content — a divider that merely separates two
     already-distinguishable blocks is exempt. Reporting them would be noise. */
];

/* --------------------------------- report --------------------------------- */

const AA = 4.5; // normal-size text
const UI = 3; // non-text / large text
const AAA = 7;

const rows = PAIRS.map(([label, fg, bg, kind]) => {
  const bar = kind === 'ui' ? UI : AA;
  return {
    label,
    fg,
    bg,
    kind,
    bar,
    bgValue: colour(bg),
    ratio: contrast(colour(fg), colour(bg)),
  };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nWCAG contrast — ${rows.length} pair(s) from ${LABEL}\n`);
console.log(`  ${pad('ratio', 7)}${pad('need', 6)}${pad('AA', 5)}pair  ·  foreground on background`);
for (const r of rows) {
  console.log(
    `  ${pad(r.ratio.toFixed(2), 7)}${pad(r.bar.toFixed(1), 6)}${pad(r.ratio >= r.bar ? 'ok' : 'FAIL', 5)}${r.label}  ·  ${r.fg} on ${r.bg} (${r.bgValue})`,
  );
}

const failures = rows.filter((r) => r.ratio < r.bar);
const aaaFails = rows.filter((r) => r.kind === 'text' && r.ratio < AAA);
console.log(
  `\n${failures.length === 0
    ? `all ${rows.length} pairs meet their threshold (text 4.5:1 · UI 3:1)`
    : `${failures.length} pair(s) below threshold: ${failures.map((f) => `${f.label} (${f.ratio.toFixed(2)} < ${f.bar})`).join('; ')}`}`,
);
console.log(`${aaaFails.length} text pair(s) below AAA (7:1) — informational.`);
