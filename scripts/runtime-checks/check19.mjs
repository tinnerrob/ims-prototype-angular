import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

/* ============ C1: the wiring, resolved ============
 *
 * `check17` holds the contract's *shape* and `check18` holds the sweep; neither can
 * prove the thing the seam is for — that the app is handed the store when it asks for
 * `IMS_API`, and that it is handed *the* store rather than a second one. That is a
 * question for an injector, and an injector does not need a browser: `@angular/core`'s
 * standalone `EnvironmentInjector` runs in Node, which is the same trick the rest of
 * these harnesses use on `localStorage` (hand-roll the environment, drive the real
 * thing).
 *
 * So this is the only check here that runs Angular's DI rather than reading about it:
 * it builds one injector with exactly the provider `app.config.ts` registers, asks it
 * for the contract, and asks it for the class.
 */

// The injector compiles the store's `@Injectable` at runtime here, which is JIT — and
// JIT needs the compiler loaded first (the browser never does this: `ng build` is AOT).
await import('@angular/compiler');
const { createEnvironmentInjector } = await import('@angular/core');
const { DataService } = await import('./data.service.js');
const { IMS_API, provideImsApi } = await import('./api.js');

/*
 * Two injectors, because that is what the app has: the store is `providedIn: 'root'`,
 * so the root injector hosts it, and `app.config.ts` adds `provideImsApi()` on top. A
 * parentless injector cannot resolve a root-scoped service at all (the first version of
 * this check proved that, by failing with "No provider for DataService!"), so the root
 * is built the way Angular builds it — a provider for the class — and the app's
 * providers hang off it.
 */
const rootInjector = createEnvironmentInjector([DataService]);
const appInjector = createEnvironmentInjector([provideImsApi()], rootInjector);

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

check('the contract resolves, and the store is what answers it', () => {
  const api = appInjector.get(IMS_API);
  assert.ok(api, 'IMS_API is provided');
  assert.equal(api instanceof DataService, true, 'and the first implementation answers');
});

check('asking twice is the same workspace, not a second copy', () => {
  const api = appInjector.get(IMS_API);
  const store = rootInjector.get(DataService);
  assert.equal(api === store, true, 'useExisting aliases the store, rather than instantiating one');
  // The proof that it is one store and not two views of one: a write through the
  // contract is visible through the class.
  store.setTenantModule('rentals', false);
  assert.equal(api.moduleFlags()['rentals'], false, 'a write through one is read through the other');
  store.setTenantModule('rentals', true);
});

check('a signed-out contract acts as nobody, through the seam (B1 + C1 together)', async () => {
  const api = appInjector.get(IMS_API);
  assert.equal(api.activeUser, undefined, 'a fresh fixture carries no session');
  const result = await api.signIn(api.getUser('USR-003').email, 'dana-northline');
  assert.equal(result.ok, true, 'a credential still signs in through the contract');
  assert.equal(api.activeUser.id, 'USR-003');
  api.signOut();
  assert.equal(api.activeUser, undefined, 'and sign-out still ends it');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck19: ${n} checks`);
