#!/usr/bin/env node
/**
 * Report (never fails the build): code nothing references.
 *
 * Two kinds, both mechanical:
 *
 *   1. an imported name a file never uses again — the import line is dead weight;
 *   2. an exported name no other file mentions — a symbol the app, the harnesses and
 *      the docs have all stopped reading. A *file-local* export (used inside the file
 *      that declares it — the shape of a method signature, say) is **not** dead, so it
 *      is counted and reported separately rather than listed as a finding.
 *
 * What counts as a reference: any other `.ts` under `src/app`, `src/main.ts` (the
 * bootstrap entry point, which is what makes `AppComponent`/`appConfig` alive), the
 * harnesses in `scripts/runtime-checks/`, and `docs/` — the data model is a document
 * that `check9` keeps in step with `models.ts`, and the harnesses import the compiled
 * core, so a symbol only they use must stay.
 *
 * Deliberately forgiving: a name mentioned in a comment counts as used, so the report
 * errs towards silence rather than towards deleting something a human wrote down.
 *
 * Usage: npm run lint:dead
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src', 'app');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && p.endsWith('.spec.ts') === false) out.push(p);
  }
  return out;
};

const appFiles = walk(APP);
const read = (p) => fs.readFileSync(p, 'utf8');
const others = [
  ...appFiles,
  path.join(ROOT, 'src', 'main.ts'),
  ...walk(path.join(ROOT, 'scripts', 'runtime-checks')).filter((p) => p.endsWith('.mjs')),
  ...walk(path.join(ROOT, 'docs')),
];
const otherText = new Map(others.map((p) => [p, read(p)]));

const escape = (s) => s.replace(/[$]/g, String.fromCharCode(92) + '$');
const mentions = (text, name) => new RegExp(String.fromCharCode(92) + 'b' + escape(name) + String.fromCharCode(92) + 'b').test(text);

/* Imported names, and the source with every import statement removed (so a name that
   only appears on its own import line counts as unused). */
function scanFile(src) {
  const imported = new Map();
  let body = src;
  const importRe = /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"];?/g;
  let m;
  while ((m = importRe.exec(src))) {
    for (let part of m[1].split(',')) {
      part = part.trim();
      if (!part) continue;
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name) imported.set(name, true);
    }
  }
  body = src.replace(importRe, '');

  const exported = [];
  const declRe = /^export\s+(?:abstract\s+)?(?:const|function|type|interface|class|enum|let|var)\s+([A-Za-z0-9_$]+)/gm;
  while ((m = declRe.exec(src))) exported.push({ name: m[1], index: m.index });
  const listRe = /^export\s*\{([^}]+)\}/gm;
  while ((m = listRe.exec(src))) {
    for (let part of m[1].split(',')) {
      part = part.trim();
      if (!part) continue;
      exported.push({ name: part.split(/\s+as\s+/).pop().trim(), index: m.index });
    }
  }
  return { imported, body, exported };
}

const unusedImports = [];
const deadExports = [];
const localExports = [];
let exportedTotal = 0;

for (const file of appFiles) {
  const src = read(file);
  const rel = path.relative(ROOT, file);
  const { imported, body, exported } = scanFile(src);

  for (const [name] of imported) {
    if (mentions(body, name) === false) unusedImports.push(rel + ': ' + name);
  }

  for (const { name, index } of exported) {
    if (!name) continue;
    exportedTotal++;
    const ownLine = src.slice(0, index).split(String.fromCharCode(10)).length;
    const ownUses = src
      .split(String.fromCharCode(10))
      .filter((l, i) => i + 1 !== ownLine && mentions(l, name)).length;
    const elsewhere = [...otherText.entries()].filter(([p, t]) => p !== file && mentions(t, name)).length;
    if (elsewhere > 0) continue;
    if (ownUses > 0) localExports.push(rel + ': ' + name + ' (used ' + ownUses + 'x in its own file)');
    else deadExports.push(rel + ': ' + name);
  }
}

const show = (list, cap) => {
  const head = list.slice(0, cap);
  console.log(head.length ? '  ' + head.join(String.fromCharCode(10) + '  ') : '  (none)');
  if (list.length > cap) console.log('  … ' + (list.length - cap) + ' more');
};

console.log(appFiles.length + ' file(s), ' + exportedTotal + ' export(s)');
console.log(String.fromCharCode(10) + unusedImports.length + ' imported name(s) no file uses again:');
show(unusedImports, 40);
console.log(String.fromCharCode(10) + deadExports.length + ' export(s) nothing else references:');
show(deadExports, 40);
console.log(String.fromCharCode(10) + localExports.length + ' export(s) used only inside their own file (kept: API shape, not dead):');
show(localExports, 40);
