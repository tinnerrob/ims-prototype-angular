import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

import { signInAs } from './sign-in.mjs';

const { DataService, DEMO_PASSWORDS } = await import('./data.service.js');
const { can } = await import('./models.js');

let n = 0;
const check = async (label, fn) => {
  n++;
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    console.log(`FAIL  ${label}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/**
 * The `children: [...]` block of a route literal, by bracket matching (the routes
 * file is read as text — importing it would pull Angular components into Node).
 */
function childrenBlock(src, from) {
  const open = src.indexOf('children: [', from);
  assert.ok(open > 0, 'the guarded parent declares children');
  let depth = 0;
  for (let i = src.indexOf('[', open); i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('the children array is unbalanced');
}

/* ============ B2: sign in as a screen, and a session that is required ============
 *
 * B1 gave the session an origin in the store; nothing in the UI used it. B2 is the
 * other half: the fixture no longer ships a session, every screen is a child of a
 * route parent that carries `requireAuth`, and the shell's switcher — the thing that
 * let the client *assert* who it was — is a Sign out.
 *
 * A browser is not available to this repo (see "Verification recipe"), so what is
 * held here is the part that can be: the store's shape (no method may set a session
 * without a credential), the *fixture's* honesty (every published demo pair really
 * signs in, with the role its row prints), and the wiring that no component would
 * otherwise prove — the routes' parent guard, the guard's redirect and the shell's
 * Sign out — read as source text, the way check9 reads the model.
 */

mem.clear();
const data = new DataService();

await check('no store method can assert a session — a credential is the only way in', () => {
  for (const gone of ['setSessionUser', 'setSessionTenant']) {
    assert.equal(gone in data, false, `DataService.${gone}() is gone`);
  }
  assert.equal(typeof data.signIn, 'function', 'signIn() is how a session starts');
  assert.equal(typeof data.signOut, 'function', 'signOut() is how it ends');
});


await check('the demo pick-list names every seeded person, and holds no secret but that password', () => {
  const accounts = data.demoAccounts();
  const creds = JSON.parse(localStorage.getItem('ims-web.store')).credentials;
  assert.deepEqual(
    accounts.map((a) => a.userId).sort(),
    data.listUsers().map((u) => u.id).sort(),
    'every person, and nobody invented',
  );
  for (const a of accounts) {
    const user = data.getUser(a.userId);
    assert.equal(a.email, user.email, 'the address that signs in');
    assert.equal(a.name, user.name);
    assert.equal(a.role, user.role, 'the bundle its row names');
    assert.equal(a.password, DEMO_PASSWORDS[a.userId], 'the password this build publishes');
    // The pick-list is a demo affordance, not the credential: the digest never travels.
    const printed = JSON.stringify(a);
    const cred = creds.find((c) => c.userId === a.userId);
    assert.equal(printed.includes(cred.hash), false, `no digest for ${a.userId}`);
    assert.equal(printed.includes(cred.salt), false, `no salt for ${a.userId}`);
  }
});

await check('every published pair really signs in as that person (the demo stays enterable)', async () => {
  for (const a of data.demoAccounts()) {
    data.signOut();
    const result = await data.signIn(a.email, a.password);
    assert.equal(result.ok, true, `${a.email} signs in`);
    assert.equal(data.activeUser.id, a.userId, `and it is ${a.name}`);
    assert.equal(data.activeUser.role, a.role, 'with the role the list printed');
  }
  data.signOut();
  assert.equal(data.activeUser, undefined);
});


await check("the pick-list names what each role grants — a viewer holds a viewer's rights", async () => {
  const viewer = data.demoAccounts().find((a) => a.role === 'viewer');
  assert.ok(viewer, 'a viewer is seeded');
  assert.equal((await data.signIn(viewer.email, viewer.password)).ok, true);
  assert.equal(can(data.activeUser, 'items.view'), true, 'read');
  assert.equal(can(data.activeUser, 'stock.adjust'), false, 'not count');
  assert.equal(can(data.activeUser, 'users.manage'), false, 'not administer people');
  data.signOut();
});

await check('every screen is a child of the guarded parent, and the form is the only route outside it', () => {
  const src = read('./app.routes.ts');
  assert.match(src, /import \{ requireAuth \}/, 'the guard is imported');
  const start = src.indexOf('canActivateChild: [requireAuth]');
  assert.ok(start > 0, 'a route parent carries requireAuth');
  const guarded = childrenBlock(src, start);
  const screens = [...src.matchAll(/path: '([\w*-]+)', component: (\w+)/g)];
  assert.ok(screens.length > 15, `${screens.length} screen routes to check`);
  const outside = screens.filter((m) => !guarded.includes(`component: ${m[2]}`)).map((m) => m[1]);
  assert.deepEqual(outside, ['signin'], 'only the sign-in form renders without a session');
  assert.match(src, /path: 'signin', component: SignInComponent/, 'and it is a route, not a hidden screen');
});

await check('the guard asks the session, and carries the URL the visitor wanted', () => {
  const src = read('./auth.guard.ts');
  assert.match(src, /CanActivateChildFn/, 'it guards every child route, not one screen');
  assert.match(src, /session\.signedIn\(\)/, 'it asks whether anybody is signed in');
  assert.match(src, /createUrlTree\(\['\/signin'\]/, 'a stranger is sent to the form');
  assert.match(
    src,
    /queryParams: \{ next: state\.url \}/,
    'naming where they were going, so a deep link survives the sign-in',
  );
});

await check('the shell ends a session instead of switching one', () => {
  const html = read('./app.component.html');
  assert.match(html, /\(click\)="signOut\(\)"/, 'the account panel offers Sign out');
  assert.match(html, />Sign out</, 'and says what it does');
  assert.equal(/switchUser|Switch user|session\.users\(\)/.test(html), false, 'nothing impersonates a person');
  const ts = read('./app.component.ts');
  assert.match(ts, /signOut\(\): void \{[^}]*this\.session\.signOut\(\)/, 'the shell calls the session');
  assert.match(ts, /navigateByUrl\('\/signin'\)/, 'and lands on the form (a guard only runs on navigation)');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck15: ${n} checks`);
