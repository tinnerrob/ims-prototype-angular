import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* ============ C1b: the screens depend on the contract ============
 *
 * C1a named the contract; this increment is the sweep that makes it true of the
 * *screens*: every component, service and helper that used to take the `DataService`
 * class now takes `IMS_API` (typed `ApiAdapter`), so which implementation answers is a
 * provider decision in one file rather than a class name repeated in thirty.
 *
 * The claim is mechanical, so the check is too: walk `src/app` and assert that the only
 * files which name the store class at all are the store's own file and the contract that
 * declares it. A component that reaches for `DataService` again fails here — which is the
 * behaviour that rots, because injecting the class is what every Angular example shows.
 */

const APP = './src/app';

function sources(dir = APP, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const isComment = (line) => /^\s*(\*|\/\/|\/\*|<!--)/.test(line);

/** The lines of a file that *use* a name: code only, not prose and not imports. */
function codeLines(src, name) {
  return src
    .split('\n')
    .filter((l) => !isComment(l) && !/^\s*import\b/.test(l) && new RegExp(`\\b${name}\\b`).test(l));
}

const files = sources();
assert.ok(files.length > 35, `${files.length} source files walked (the sweep needs the whole app)`);

const THE_STORE = join(APP, 'core/data.service.ts');
const THE_CONTRACT = join(APP, 'core/api.ts');
const all = files.map((path) => ({ path, src: read(path) }));

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

check('the store class is named in exactly two files: itself and the contract', () => {
  const naming = all.filter(({ src }) => codeLines(src, 'DataService').length);
  const strays = naming.map(({ path }) => path).filter((p) => p !== THE_STORE && p !== THE_CONTRACT);
  assert.deepEqual(strays, [], 'nothing outside the store and its contract uses the class');
});

check('every call site injects the contract, and types it as the contract', () => {
  const injecting = all.filter(({ src }) => /@Inject\(IMS_API\)/.test(src));
  assert.ok(injecting.length >= 20, `${injecting.length} injection sites on IMS_API`);
  for (const { path, src } of injecting) {
    assert.match(src, /from '((?:\.\.\/)*|\.\/)core\/api'|from '\.\/api'/, `${path} imports the contract`);
    assert.equal(/\bdata\s*:\s*DataService\b/.test(src), false, `${path} does not name the class`);
  }
  // ...and the ones that take the store as an argument (the tooltip builders) do too.
  const passers = all.filter(({ src }) => /\(data: ApiAdapter/.test(src));
  assert.ok(passers.length >= 1, `${passers.length} helper files take the contract`);
});

check('no call site asks Angular for the class as a token', () => {
  const asked = all.filter(({ path, src }) => path !== THE_CONTRACT && /inject\(DataService\)|provide:\s*DataService/.test(src));
  assert.deepEqual(asked.map(({ path }) => path), [], 'the class is never a token outside the seam');
  // The one place it is named as a token is the provider that wires the contract.
  assert.match(read(THE_CONTRACT), /useExisting: DataService/, 'and that place is provideImsApi()');
});

check('the class is a value in the seam only: nowhere constructs a second store', () => {
  const built = all.filter(({ path, src }) => path !== THE_CONTRACT && /new DataService\(/.test(src));
  assert.deepEqual(built.map(({ path }) => path), [], 'one store, and the app does not mint another');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck18: ${n} checks`);
