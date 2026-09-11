import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ============ A8: docs/DATA-MODEL.md against the model ============
 *
 * The data-model document is the spec the API is built from, so it has to be
 * *checked against the code*, not trusted. check-store.sh copies the three files
 * this needs (`models.ts`, `data.service.ts`, `DATA-MODEL.md`) next to this
 * script; the checks below parse them as text — TypeScript types do not survive
 * compilation, and that is exactly what is being compared.
 *
 * What they hold to account:
 *  - every model has a table, and every table is a model (no invented names);
 *  - every column is a field of that model (snake_case, with the audit columns
 *    and a declared map key as the only allowances for a column the model cannot
 *    have — the API's columns, not the front end's);
 *  - `NOT NULL` agrees with the type's optionality, so a nullable field is never
 *    documented as required (the class of bug that made a fixture unloadable);
 *  - every table in the store's `auditedRows()` is in the map, with a section;
 *  - every enum matches its union member for member, and every column type is a
 *    documented enum or a scalar;
 *  - every foreign key points at a documented table;
 *  - the columns the app *derives* are the columns the doc calls derived;
 *  - the statuses offered per catalog type match `ITEM_STATUSES`.
 */

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

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const MODELS = read('./models.ts');
const STORE = read('./data.service.ts');
const DOC = read('./DATA-MODEL.md');

/** A file with its comments removed, so a brace in prose cannot move the parse. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const MODELS_SRC = strip(MODELS);

/* -------------------------- models.ts as data ------------------------- */

/** Every `export interface X [extends Y] { … }` with its fields and optionality. */
function parseInterfaces(src) {
  const out = new Map();
  const re = /export interface (\w+)(?:\s+extends\s+([\w, ]+))?\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    const fields = new Map();
    for (const f of body.matchAll(/^\s*(\w+)(\?)?\s*:\s*([^;]+);/gm)) {
      fields.set(f[1], { optional: !!f[2], nullable: /\bnull\b/.test(f[3]) });
    }
    out.set(m[1], { extends: m[2] ?? null, fields });
  }
  return out;
}

/** Every `export type X = …` whose body is string literals — a named enum. */
function parseUnions(src) {
  const out = new Map();
  for (const m of src.matchAll(/export type (\w+)\s*=\s*([^;]*);/g)) {
    const members = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    if (members.length) out.set(m[1], members);
  }
  return out;
}

/** Fields of an interface, inheriting `extends` (so `AuditFields` counts). */
function fieldsOf(ifaces, name) {
  const seen = new Map();
  for (let cur = ifaces.get(name); cur; cur = cur.extends ? ifaces.get(cur.extends.trim()) : null) {
    for (const [k, v] of cur.fields) if (!seen.has(k)) seen.set(k, v);
  }
  return seen;
}

const IFACES = parseInterfaces(MODELS_SRC);
const UNIONS = parseUnions(MODELS_SRC);

/* ------------------------ DATA-MODEL.md as data ----------------------- */

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** The columns the store stamps on every table (`AuditFields` + tenant scoping). */
const AUDIT_COLS = new Set(['tenant_id', 'created_at', 'created_by', 'updated_at', 'updated_by']);
const SCALARS = new Set(['text', 'uuid', 'numeric', 'integer', 'boolean', 'date', 'timestamptz', 'time', 'jsonb']);

/** Table sections: `### \`table\` — \`Type\``, with the columns in the sql block.
 *  A heading may carry annotations in parentheses — a column that renames a model
 *  field (`\`item_id\` for \`refId\``), a child's parent key that only the API can
 *  have (`\`order_id\` is the parent key`) or a key the store keeps as a map
 *  (`\`type\` as the key`). Anything else must be a field of the model.
 */
function parseTables(doc) {
  const tables = new Map();
  let cur = null;
  let inSql = false;
  for (const line of doc.split('\n')) {
    const h = line.match(/^### `(\w+)` — `(\w+)`(?: \(([^)]*)\))?\s*$/);
    if (h) {
      cur = { name: h[1], type: h[2], cols: [], renamed: new Map(), structural: new Set() };
      // A backticked parenthetical is annotations (and must parse); a prose one
      // ("one row per tenant") is for the reader and carries no claim.
      const ann = (h[3] ?? '').includes('`') ? (h[3] ?? '').split(', ').filter(Boolean) : [];
      for (const a of ann) {
        const r = a.match(/^`(\w+)` for `(\w+)`$/);
        const p = a.match(/^`(\w+)` is the parent key$/);
        const k = a.match(/^`(\w+)` as the key$/);
        if (r) cur.renamed.set(r[1], r[2]);
        else if (p || k) cur.structural.add((p ?? k)[1]);
        else assert.fail(`unparsed heading annotation on \`${cur.name}\`: "${a}"`);
      }
      tables.set(h[1], cur);
      continue;
    }
    if (/^#{2,3} /.test(line)) cur = null;
    if (/^```sql/.test(line)) {
      inSql = true;
    } else if (/^```/.test(line)) {
      inSql = false;
    } else if (cur && inSql) {
      const c = line.match(/^ {2}([a-z_]+)\s+(\S+)(.*)$/);
      if (c) cur.cols.push({ name: c[1], type: c[2], rest: c[3] });
    }
  }
  return tables;
}

/** `name AS ENUM ('a', 'b')` lines, with the `-- TypeName` comment above them. */
function parseEnums(doc) {
  const out = new Map();
  let comment = null;
  for (const line of doc.split('\n')) {
    const c = line.match(/^--\s+`?(\w+)`?\s*$/);
    if (c) comment = c[1];
    const e = line.match(/^(\w+) AS ENUM \((.*)\)\s*$/);
    if (e) {
      out.set(e[1], { type: comment, members: [...e[2].matchAll(/'([^']*)'/g)].map((x) => x[1]) });
      comment = null;
    }
  }
  return out;
}

/** The map at the end: `| \`table\` | \`model\` | \`store key\` | resource |`. */
function parseMap(doc) {
  const start = doc.indexOf('## Table ↔ model ↔ resource map');
  assert.ok(start > 0, 'the document has a table ↔ model ↔ resource map');
  const out = [];
  for (const line of doc.slice(start).split('\n')) {
    const r = line.match(/^\| `(\w+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
    if (r) out.push({ table: r[1], model: r[2].trim(), storeKey: r[3].replace(/`/g, '').trim(), resource: r[4].trim() });
  }
  return out;
}

/** The statuses-per-type table (`| \`type\` | Status A, Status B |`). */
function parseStatuses(doc) {
  const lines = doc.split('\n');
  const out = new Map();
  const at = lines.findIndex((l) => /^\| type \| statuses offered \|$/.test(l));
  assert.ok(at > 0, 'the document lists the statuses offered per type');
  for (const line of lines.slice(at + 2)) {
    const r = line.match(/^\| `(\w+)` \| (.+) \|$/);
    if (!r) break;
    out.set(r[1], r[2].split(',').map((s) => s.trim()));
  }
  return out;
}

const TABLES = parseTables(DOC);
const ENUMS = parseEnums(DOC);
const MAP = parseMap(DOC);
const STATUSES = parseStatuses(DOC);


/* ------------------------------- checks ------------------------------- */

check('every model is a table: each interface in models.ts is named in the doc', () => {
  const missing = [...IFACES.keys()].filter((name) => !DOC.includes('`' + name + '`'));
  assert.deepEqual(missing, [], `documented types missing: ${missing.join(', ')}`);
});

check('every table is a model: no heading invents a type', () => {
  for (const [table, t] of TABLES) {
    assert.ok(IFACES.has(t.type), `\`${table}\` claims model \`${t.type}\`, which models.ts does not have`);
    assert.ok(t.cols.length > 0, `\`${table}\` documents its columns`);
  }
  assert.ok(TABLES.size >= 20, `${TABLES.size} tables documented`);
});

check('every documented column is a field of its model (or a declared structural column)', () => {
  const bad = [];
  for (const [table, t] of TABLES) {
    const fields = fieldsOf(IFACES, t.type);
    for (const c of t.cols) {
      if (AUDIT_COLS.has(c.name) || t.structural.has(c.name)) continue;
      const field = t.renamed.get(c.name) ?? camel(c.name);
      if (!fields.has(field)) bad.push(`${table}.${c.name} (no \`${field}\` on ${t.type})`);
    }
  }
  assert.deepEqual(bad, [], `columns that are not fields:\n      ${bad.join('\n      ')}`);
});

check('NOT NULL agrees with the model: a nullable field is never documented as required', () => {
  const bad = [];
  for (const [table, t] of TABLES) {
    const fields = fieldsOf(IFACES, t.type);
    for (const c of t.cols) {
      if (AUDIT_COLS.has(c.name) || t.structural.has(c.name)) continue; // stamped by the writer, or the API's own key
      const field = t.renamed.get(c.name) ?? camel(c.name);
      const f = fields.get(field);
      if (!f) continue; // reported by the column check above
      const required = /NOT NULL|PRIMARY KEY/.test(c.rest);
      if (required && f.optional) bad.push(`${table}.${c.name} says NOT NULL but \`${field}?\` is optional`);
      else if (!required && !f.optional && !f.nullable) {
        bad.push(`${table}.${c.name} is required and not nullable in the model but written nullable`);
      }
    }
  }
  assert.deepEqual(bad, [], `required/nullable disagreements:\n      ${bad.join('\n      ')}`);
});

check('every table the store audits is documented, and every documented table is mapped', () => {
  const storeKeys = [...STORE.matchAll(/add\((['"`])([\w$:{}]+)\1,/g)].map((m) => m[2].split(':')[0]);
  assert.ok(storeKeys.length >= 15, `${storeKeys.length} audited tables found in auditedRows()`);
  const mapped = new Set(MAP.map((r) => r.storeKey));
  const missing = storeKeys.filter((k) => !mapped.has(k));
  assert.deepEqual(missing, [], `audited but unmapped: ${missing.join(', ')}`);
  for (const r of MAP) {
    if (r.storeKey === '—') {
      // A table the store keeps as a column or a snapshot (see `store`): named in
      // the doc, with no section of its own.
      assert.ok(DOC.includes('`' + r.table + '`'), `map names \`${r.table}\`, which the doc never mentions`);
      continue;
    }
    assert.ok(TABLES.has(r.table), `map names \`${r.table}\`, which has no section`);
    const model = r.model.replace(/`/g, '').split(/[.[]/)[0];
    assert.ok(IFACES.has(model), `map row \`${r.table}\` names model \`${model}\`, which models.ts does not have`);
  }
  for (const table of TABLES.keys()) {
    assert.ok(MAP.some((r) => r.table === table), `\`${table}\` has a section but is not in the map`);
  }
});


check('every enum matches its union, member for member', () => {
  const bad = [];
  for (const [name, e] of ENUMS) {
    if (!e.type || !UNIONS.has(e.type)) continue; // an inline union: nothing in the model to compare
    const want = [...UNIONS.get(e.type)].sort();
    const got = [...e.members].sort();
    if (want.join('|') !== got.join('|')) bad.push(`${name} vs ${e.type}: doc [${got.join(', ')}] model [${want.join(', ')}]`);
  }
  for (const name of UNIONS.keys()) {
    if (!DOC.includes('`' + name + '`') && !DOC.includes('-- ' + name)) {
      bad.push(`\`${name}\` is a named union the doc never mentions`);
    }
  }
  assert.deepEqual(bad, [], `enum drift:\n      ${bad.join('\n      ')}`);
});

check('every column type is a documented enum or a scalar', () => {
  const bad = [];
  for (const [table, t] of TABLES) {
    for (const c of t.cols) {
      const base = c.type.replace(/\(.*\)$/, '').replace(/\[\]$/, '');
      if (SCALARS.has(base) || ENUMS.has(base)) continue;
      bad.push(`${table}.${c.name} is typed ${c.type}`);
    }
  }
  assert.deepEqual(bad, [], `unknown column types:\n      ${bad.join('\n      ')}`);
});

check('every foreign key points at a documented table', () => {
  const bad = [];
  for (const [table, t] of TABLES) {
    for (const c of t.cols) {
      for (const r of c.rest.matchAll(/REFERENCES (\w+)\(/g)) {
        if (!TABLES.has(r[1])) bad.push(`${table}.${c.name} → ${r[1]} (no such table)`);
      }
    }
  }
  assert.deepEqual(bad, [], `dangling references:\n      ${bad.join('\n      ')}`);
});

check('the columns the doc calls derived are the ones the store derives', () => {
  const src = STORE.match(/DERIVED_STOCK_KEYS[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(src, 'the store still names its derived stock keys');
  const storeKeys = [...src[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  const docKeys = TABLES.get('items')
    .cols.filter((c) => /-- derived/.test(c.rest))
    .map((c) => camel(c.name))
    .sort();
  assert.deepEqual(docKeys, storeKeys, `derived columns: doc [${docKeys.join(', ')}] store [${storeKeys.join(', ')}]`);
});

check('the statuses offered per type match ITEM_STATUSES', () => {
  const src = MODELS_SRC.match(/export const ITEM_STATUSES[^{]*\{([^}]*)\}/);
  assert.ok(src, 'models.ts still defines ITEM_STATUSES');
  const want = new Map();
  for (const m of src[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    want.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
  }
  assert.deepEqual([...STATUSES.keys()].sort(), [...want.keys()].sort(), 'one row per catalog type');
  for (const [type, list] of want) {
    assert.deepEqual(STATUSES.get(type), list, `${type} statuses: doc [${STATUSES.get(type)}] model [${list}]`);
  }
});

console.log(`  --  check9: ${n} checks`);

