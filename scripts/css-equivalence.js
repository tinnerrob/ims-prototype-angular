#!/usr/bin/env node
/**
 * Prove a stylesheet change is **neutral**: compare the effective styles of two builds.
 *
 * It reads two compiled CSS files and, for every selector, the winning value of every
 * property (the last declaration in document order, which is what the browser applies for
 * rules of equal specificity), then prints what differs. Selector lists are expanded, so a
 * grouped rule (`.a, .b { x }`) feeds each selector it names — without that, a deletion
 * looks like a change when it is not.
 *
 * This is how a `styles.scss` edit is verified without a browser. Workflow:
 *
 *   npm run build                                  # before
 *   cp dist/ims-web/browser/styles-*.css /tmp/before.css
 *   ...edit src/styles.scss...
 *   npm run build                                  # after
 *   node scripts/css-equivalence.js /tmp/before.css dist/ims-web/browser/styles-*.css
 *
 * Exit code 0 when the effective stylesheet is identical (the emitted text usually is
 * not — dead declarations disappearing is the point), 1 when it differs.
 *
 * Scope, honestly: this compares rules **per selector**. Reordering rules *between*
 * selectors can flip which of two equal-specificity rules wins for one element, and that
 * needs a DOM to see, so a restructure that moves rules across selectors is not provable
 * with this tool — only additions, deletions and merges *within* a selector are.
 *
 * Usage: node scripts/css-equivalence.js <before.css> <after.css>
 */
const fs = require('fs');

const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const isWs = (c) => c === ' ' || c === TAB || c === LF || c === CR;
const squash = (s) => {
  const parts = [];
  let cur = '';
  for (const ch of s) {
    if (isWs(ch)) { if (cur) { parts.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.join(' ');
};
const blankComments = (s) => {
  let out = '', i = 0;
  while (i < s.length) {
    const open = s.indexOf('/*', i);
    if (open === -1) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const close = s.indexOf('*/', open + 2);
    const blink = close === -1 ? s.length : close + 2;
    for (const ch of s.slice(open, blink)) out += ch === LF ? LF : ' ';
    i = blink;
  }
  return out;
};

/** Compiled CSS -> { "context|single selector": { property: winning value } }. */
function collect(src, at, out) {
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const header = squash(src.slice(i, open));
    const body = src.slice(open + 1, j - 1);
    if (header.startsWith('@')) {
      collect(body, at + header + ' ', out);
    } else {
      const decls = [];
      for (const d of body.split(';')) {
        const colon = d.indexOf(':');
        if (colon === -1) continue;
        const name = squash(d.slice(0, colon));
        if (name) decls.push([name, squash(d.slice(colon + 1))]);
      }
      for (const single of header.split(',').map(squash).filter(Boolean)) {
        const key = at + single;
        if (out.has(key) === false) out.set(key, new Map());
        const props = out.get(key);
        for (const [name, value] of decls) props.set(name, value);
      }
    }
    i = j;
  }
  return out;
}

const load = (file) => collect(blankComments(fs.readFileSync(file, 'utf8')), '', new Map());
const count = (map) => {
  let n = 0;
  for (const props of map.values()) n += props.size;
  return n;
};

const [, , beforePath, afterPath] = process.argv;
if (!beforePath || !afterPath) {
  console.error('usage: node scripts/css-equivalence.js <before.css> <after.css>');
  process.exit(2);
}
const before = load(beforePath);
const after = load(afterPath);
const diff = [];
const keys = new Set([...before.keys(), ...after.keys()]);
for (const key of [...keys].sort()) {
  const a = before.get(key) || new Map();
  const b = after.get(key) || new Map();
  for (const prop of new Set([...a.keys(), ...b.keys()])) {
    const va = a.get(prop);
    const vb = b.get(prop);
    if (va !== vb) diff.push(key + ' || ' + prop + ' :: ' + (va === undefined ? '(absent)' : va) + '  ->  ' + (vb === undefined ? '(absent)' : vb));
  }
}

console.log(beforePath + ': ' + before.size + ' selectors, ' + count(before) + ' winning declarations');
console.log(afterPath + ': ' + after.size + ' selectors, ' + count(after) + ' winning declarations');
if (diff.length === 0) {
  console.log(LF + 'IDENTICAL — every selector keeps every winning value.');
  process.exit(0);
}
console.log(LF + diff.length + ' winning value(s) differ:');
console.log('  ' + diff.slice(0, 40).join(LF + '  '));
if (diff.length > 40) console.log('  … ' + (diff.length - 40) + ' more');
process.exit(1);
