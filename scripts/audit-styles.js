#!/usr/bin/env node
/**
 * Report (never fails the build): how much of `src/styles.scss` is redundant.
 *
 * The stylesheet is a base → refresh → polish cascade, loaded after Bootstrap, so
 * for one selector the LAST rule always wins. That makes two kinds of dead weight
 * visible, and this script lists both:
 *
 *   1. declarations a later rule for the same selector re-sets — they can never
 *      win, so dropping them is visually neutral (this is how the stylesheet was
 *      decluttered: 281 such declarations, 0 changed winners);
 *   2. rules whose classes no template or component mentions — prototype
 *      leftovers the Angular port dropped (98 rules removed: `.rn-*`, `.rw-*`,
 *      `.ho-*`, `.tc-*`, `.panel-head`, …).
 *
 * A class counts as used when it appears literally in any `.html`/`.ts` under
 * `src/app` (or `src/index.html`), or when its dash-prefix is concatenated at
 * runtime (`'tl-res-' + kind`). Beware runtime-only classes from libraries when
 * acting on category 2 — check before deleting.
 *
 * Usage: npm run lint:styles
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'src', 'styles.scss');

const src = fs.readFileSync(CSS, 'utf8');
// blank out comment bodies but keep the newlines, so line numbers stay true
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Split a stylesheet into rules: { sel: [selectors], props: Set, line }. */
function rules(text) {
  const out = [];
  const stack = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { line++; buf += ' '; continue; }
    if (ch === '{') {
      stack.push({ sels: buf.trim().replace(/\s+/g, ' ').split(',').map((s) => s.trim()).filter(Boolean), props: new Set(), line: startLine, nested: stack.length > 0 });
      buf = '';
    } else if (ch === '}') {
      const r = stack.pop();
      if (r && !r.nested) out.push(r);
      buf = '';
    } else {
      buf += ch;
      if (stack.length) {
        const k = buf.indexOf(':');
        if (k !== -1) stack[stack.length - 1].props.add(buf.slice(0, k).trim().replace(/^.*[;}]\s*/, ''));
      }
      if (!buf.trim()) startLine = line;
    }
  }
  return out;
}

const all = rules(code);
const bySel = new Map();
for (const r of all) for (const s of r.sels) (bySel.get(s) || bySel.set(s, []).get(s)).push(r);

let reSet = 0;
const layered = [];
for (const [sel, rs] of bySel) {
  if (rs.length < 2) continue;
  const seen = new Set();
  const dupes = [];
  for (const r of rs) for (const p of r.props) (seen.has(p) ? dupes.push(p) : seen.add(p));
  reSet += dupes.length;
  layered.push({ sel, fields: rs.map((r) => r.line), dupes: [...new Set(dupes)] });
}
layered.sort((a, b) => b.dupes.length - a.dupes.length);

const app = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|ts)$/.test(e.name)) app.push(fs.readFileSync(p, 'utf8'));
  }
})(path.join(ROOT, 'src', 'app'));
app.push(fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8'));
const corpus = app.join('\n');
const esc = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
const used = (c) =>
  new RegExp('[.\\s"\'`\\[{,>+~]' + esc(c) + '[\\s"\'`\\]}.,;:)]').test(corpus) ||
  c.split('-').some((_, i, parts) => i > 0 && new RegExp("['\"`]" + esc(parts.slice(0, i).join('-')) + '-').test(corpus));

const classes = new Set();
for (const m of code.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);
const dead = [...classes].filter((c) => !used(c)).sort();

console.log(`${all.length} rules, ${bySel.size} selectors`);
console.log(`\n${layered.length} selector(s) declared in 2+ rules, ${reSet} declaration(s) re-set by a later rule:`);
for (const l of layered.slice(0, 15)) {
  console.log(`  ${l.fields.length}x ${l.sel}  [lines ${l.fields.join(', ')}]  re-set: ${l.dupes.join(', ')}`);
}
if (layered.length > 15) console.log(`  … ${layered.length - 15} more`);
console.log(`\n${dead.length} class(es) no template mentions (check for runtime-added names before deleting):`);
console.log('  ' + dead.join(' '));
