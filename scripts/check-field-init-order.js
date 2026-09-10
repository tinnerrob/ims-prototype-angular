#!/usr/bin/env node
/**
 * Guard: class-field initializers must not read injected services.
 *
 * With `target: ES2022` (and `useDefineForClassFields` defaulting to true),
 * TypeScript emits parameter properties *after* class-field initializers:
 *
 *     export class Foo {
 *       form = this.emptyForm();                 // ← runs first
 *       constructor(private readonly data: Svc) {} // ← assigned after
 *       private emptyForm() { return { ...this.data.list() }; }  // throws
 *     }
 *
 * The compiler does not flag the indirect case (it only reports TS2729 for a
 * direct `this.data` reference), so the failure is a runtime TypeError that
 * blanks the whole view. This script catches it.
 *
 * Usage: npm run lint:ctor
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src', 'app');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Brace-match a method body starting at the opening brace index. */
function bodyOf(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex);
}

let failures = 0;
let checked = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const classStart = src.indexOf('export class');
  if (classStart === -1) continue;
  const body = src.slice(classStart);
  const rel = path.relative(path.resolve(__dirname, '..'), file);

  // field initializers that call a method, e.g. `form = this.emptyForm();`
  const fieldRe = /^\s{2}(?!constructor)[A-Za-z_]\w*\s*(?::[^=]+)?=\s*this\.([A-Za-z_]\w*)\s*\(/gm;
  let m;
  while ((m = fieldRe.exec(body))) {
    const method = m[1];
    checked++;
    const loc = src.slice(0, classStart + m.index).split('\n').length;

    const defRe = new RegExp('(?:^|\\n)\\s{2}(?:private\\s+|protected\\s+)?' + method + '\\s*\\(([^)]*)\\)', 'm');
    const def = defRe.exec(body);
    if (!def) continue; // inherited / external helper — nothing to inspect

    const brace = body.indexOf('{', def.index + def[0].length);
    if (brace === -1) continue;
    if (/this\.data|this\.[a-zA-Z]\w*Service\b/.test(bodyOf(body, brace))) {
      failures++;
      console.error(
        `${rel}:${loc}  field initializer calls ${method}() which reads injected data — ` +
          `it will run before the constructor assigns it. Use a data-free default.`,
      );
    }
  }

  // direct references in a field initializer (belt and braces)
  const directRe = /^\s{2}(?!constructor)[A-Za-z_]\w*\s*(?::[^=]+)?=\s*[^;]*this\.data\b/gm;
  let d;
  while ((d = directRe.exec(body))) {
    failures++;
    const loc = src.slice(0, classStart + d.index).split('\n').length;
    console.error(`${rel}:${loc}  field initializer reads this.data directly.`);
  }
}

if (failures) {
  console.error(`\n✖ ${failures} problem(s) found.`);
  process.exit(1);
}
console.log(`✓ field-initializer order OK (${checked} method-based initializer(s) inspected).`);
