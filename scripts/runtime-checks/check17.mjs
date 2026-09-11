import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ============ C1: the contract, and the line through it ============
 *
 * The API seam is a file of *names*, split into the two things a call can be: a query
 * (it reads) or a command (it persists). Everything else is taken from the store, so
 * the only thing that can be wrong is membership — and membership is exactly what a
 * person gets wrong when they add a method at 5pm.
 *
 * So this harness re-derives the split from `data.service.ts` with an implementation of
 * the rule that shares no code with whatever wrote the file: a command is a method that
 * runs `save()`, or one that calls a method which does (a command built out of commands
 * is still a command — `punchIn()` is the example). A name on the wrong side, in either
 * direction, fails here; a name on *no* side fails the build instead, because the two
 * compile-time assertions in `api.ts` only see types.
 */

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const storeSource = read('./data.service.ts');
const apiSource = read('./api.ts');
const classBody = storeSource.slice(storeSource.indexOf('export class DataService')).split('\n');

/** Public members of the store: name -> body (brace-matched, skipping privates). */
function members() {
  const out = [];
  const lines = classBody;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^ {2}(?:async )?(?:get )?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (!m || m[1] === 'constructor' || /^ {2}(private|\/\*|\*)/.test(line)) continue;
    const name = m[1];
    let depth = 0;
    let opened = false;
    const buf = [];
    for (let j = i; j < lines.length && j - i < 250; j++) {
      depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
      buf.push(lines[j]);
      if (lines[j].includes('{')) opened = true;
      if (opened && depth <= 0) {
        i = j;
        break;
      }
    }
    out.push([name, buf.join('\n')]);
  }
  return out;
}

const found = members();
const names = new Set(found.map(([n]) => n));
/**
 * A public *field* is part of the surface too — `revision` (the signal a screen reads
 * to react to writes) and `reseeded` (the flag the shell uses to say the snapshot was
 * replaced). Neither persists, so both are reads. This is the pair the type assertion in
 * `api.ts` caught first: a list that only knows about methods is not the whole surface.
 */
const fields = classBody
  .filter((line) => !/^ {2}(private|\/\*|\*)/.test(line))
  .map((line) => /^ {2}(?:readonly )?([A-Za-z_]\w*)[?!]?\s*[:=]/.exec(line))
  .filter(Boolean)
  .map((m) => m[1]);
const surface = new Set([...names, ...fields]);
const calls = new Map(
  found.map(([n, body]) => [n, new Set([...body.matchAll(/this\.([A-Za-z_]\w*)\(/g)].map((m) => m[1]))]),
);
/** Directly persisting: the store's one writer is `save()`. */
const persists = new Set(found.filter(([, body]) => body.includes('this.save()')).map(([n]) => n));
/** ...and a command built out of commands is still a command. */
const derivedCommands = new Set(persists);
for (let changed = true; changed; ) {
  changed = false;
  for (const [name, called] of calls) {
    if (!derivedCommands.has(name) && [...called].some((c) => derivedCommands.has(c))) {
      derivedCommands.add(name);
      changed = true;
    }
  }
}

/** Every read: the methods that do not persist, plus the store's two public fields. */
const derivedQueries = new Set([...surface].filter((n) => !derivedCommands.has(n)));

/** The names `api.ts` declares, in the order it declares them. */
function declared(alias) {
  const at = apiSource.indexOf(`export type ${alias} =`);
  assert.ok(at > 0, `${alias} is declared in api.ts`);
  const end = apiSource.indexOf(';', at);
  assert.ok(end > at, `${alias} is terminated`);
  return [...apiSource.slice(at, end).matchAll(/'([A-Za-z_]\w*)'/g)].map((m) => m[1]);
}

const declaredQueries = declared('ApiQueryName');
const declaredCommands = declared('ApiCommandName');

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

check('the contract names the store s own members, and nothing invented', () => {
  assert.ok(found.length > 200, `${found.length} public members parsed from the store`);
  const unknown = [...new Set([...declaredQueries, ...declaredCommands])].filter((name) => !surface.has(name));
  assert.deepEqual(unknown, [], 'every declared name is a member of the store');
});

check('a command persists and a query does not — re-derived from the store, not trusted', () => {
  const wrong = [...derivedCommands].filter((c) => !declaredCommands.includes(c)).sort();
  assert.deepEqual(wrong, [], 'every method that saves is declared a command');
  const missing = declaredCommands.filter((c) => !derivedCommands.has(c)).sort();
  assert.deepEqual(missing, [], 'and every declared command saves');
  const reads = [...derivedQueries].filter((q) => !declaredQueries.includes(q)).sort();
  assert.deepEqual(reads, [], 'every method that only reads is declared a query');
});

check('the two halves are exhaustive and disjoint: one side each, never both', () => {
  const both = declaredQueries.filter((q) => declaredCommands.includes(q));
  assert.deepEqual(both, [], 'no name is on both sides');
  assert.deepEqual([...declaredQueries, ...declaredCommands].sort(), [...surface].sort(), 'every public member is classified exactly once');
});

check('a command composed of commands is a command (the case a rule-free list gets wrong)', () => {
  // These reach `save()` only through another method; a "does this body mention save()"
  // heuristic puts them on the read side, which is the mistake this check exists for.
  for (const name of ['raiseReorder', 'closeInspection', 'punchIn', 'punchOut', 'setWorkOrderStatus']) {
    assert.equal(calls.has(name), true, `${name} is a public method`);
    assert.equal(persists.has(name), false, `${name} does not call save() itself`);
    assert.ok(derivedCommands.has(name), `${name} is still a command`);
    assert.ok(declaredCommands.includes(name), 'and api.ts says so');
  }
});

check('the contract is types over the store, not copies of its signatures', () => {
  assert.match(apiSource, /export type ApiQueries = Pick<DataService, ApiQueryName>/, 'queries are picked');
  assert.match(apiSource, /export type ApiCommands = Pick<DataService, ApiCommandName>/, 'commands are picked');
  assert.match(apiSource, /export type ApiAdapter = ApiQueries & ApiCommands/, 'and the contract is both');
  // A copied signature drifts; a Pick of a method that moved is a compile error.
  assert.equal(/\):\s*(void|Promise<)/.test(apiSource), false, 'no hand-copied signature in the file');
});

check('the build holds the half a runtime check cannot: membership and implementation', () => {
  assert.match(apiSource, /NothingOutsideTheContract = Assert</, 'an unclassified member is a compile error');
  assert.match(apiSource, /keyof DataService, ApiQueryName \| ApiCommandName/, 'checked against the store s own keys');
  assert.match(apiSource, /TheStoreIsAnApi = Assert<DataService extends ApiAdapter/, 'and the store satisfies the contract');
});

check('the app is wired through the token, and the seam names one implementation', () => {
  assert.match(apiSource, /export const IMS_API = new InjectionToken<ApiAdapter>\('ims-api'\)/, 'the token is the contract');
  assert.match(apiSource, /useExisting: DataService/, 'the store answers it, as the *same* instance');
  assert.equal(/useClass/.test(apiSource), false, 'a second store is never minted');
  assert.match(apiSource, /export function provideImsApi\(\): EnvironmentProviders/, 'offered as a provider, not imported per call site');
  assert.match(read('./app.config.ts'), /provideImsApi\(\)/, 'the app provides the contract (C1)');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck17: ${n} checks`);
