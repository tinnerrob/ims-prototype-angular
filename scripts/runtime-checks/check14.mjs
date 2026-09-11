import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { DataService, DEMO_PASSWORDS } = await import('./data.service.js');
const { SessionService } = await import('./session.service.js');
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

/* ============ B1: a credential, and the one place that checks it ============
 *
 * A1 made the app *act as* somebody — `SessionService` derives the person from the
 * store and every screen asks a capability — but nothing *proved* the person was who
 * the row said. `db.session.userId` was a value the client set, `users` had no
 * credential, and `activeUser` fell back to "whoever is listed first", so an empty
 * session acted as a real person. B1 gives the session an origin: a
 * `user_credentials` row (a per-person salt and a digest, never a password) and one
 * method that checks it, `signIn()`.
 *
 * These checks hold the shape rather than the mechanism:
 *
 *  - the credential is its own table (a `users` row carries no salt, digest or
 *    password — that row is read by every list, join and audit block in the app);
 *  - the fixture's digest *is* the documented rule, recomputed here with an
 *    independent implementation (`sha256(salt + ':' + password)`), so a literal that
 *    drifts from the rule fails loudly instead of quietly locking the demo out;
 *  - one refusal for an unknown address and a wrong password (no enumeration), and
 *    `'inactive'` only to somebody who has already proved the credential;
 *  - a session names a person or nobody — signing out is persisted, survives a
 *    reload, leaves no rights, and never falls back to another user.
 *
 * The store's own `credentials` table is read from the *snapshot* rather than through
 * an accessor: `signIn()` is the only reader in the client, and adding one for the
 * harness would be exactly the second reader this increment exists to prevent.
 */

mem.clear();
const data = new DataService();
const snapshot = () => JSON.parse(localStorage.getItem('ims-web.store'));
const credentials = () => snapshot().credentials;
const byId = (id) => data.listUsers().find((u) => u.id === id);
const hex = (s) => createHash('sha256').update(s).digest('hex');

await check('every seeded person has exactly one credential, and it names them', () => {
  const users = data.listUsers();
  const creds = credentials();
  assert.equal(creds.length, users.length, 'one credential per person');
  assert.deepEqual(
    creds.map((c) => c.userId).sort(),
    users.map((u) => u.id).sort(),
    'the credential table names exactly the people the workspace has',
  );
  assert.equal(new Set(creds.map((c) => c.userId)).size, creds.length, 'nobody has two rows');
  for (const c of creds) {
    assert.equal(c.salt.length > 0, true, `${c.userId}: a salt`);
    assert.equal(c.hash.length, 64, `${c.userId}: a SHA-256 digest, hex`);
  }
});

await check("the fixture's digest is the documented rule, recomputed not trusted", () => {
  for (const c of credentials()) {
    const password = DEMO_PASSWORDS[c.userId];
    assert.ok(password, `a demo password for ${c.userId}`);
    assert.equal(hex(`${c.salt}:${password}`), c.hash, `${c.userId}: sha256(salt + ':' + password)`);
  }
});

await check('the salt is per person: no two people share a salt or a digest', () => {
  const creds = credentials();
  assert.equal(creds.length > 1, true, 'more than one person to compare');
  assert.equal(new Set(creds.map((c) => c.salt)).size, creds.length, 'salts are distinct');
  assert.equal(new Set(creds.map((c) => c.hash)).size, creds.length, 'digests are distinct');
});

await check('a users row carries no credential at all', () => {
  const users = data.listUsers();
  const creds = credentials();
  const secrets = [...creds.map((c) => c.salt), ...creds.map((c) => c.hash)];
  const printed = JSON.stringify(users);
  for (const s of secrets) {
    assert.equal(printed.includes(s), false, 'no salt or digest travels with a users row');
  }
  for (const u of users) {
    for (const k of ['salt', 'hash', 'password', 'passwordHash', 'passwordSalt']) {
      assert.equal(k in u, false, `${u.id} has no \`${k}\``);
    }
  }
});

await check('signing in with a seeded credential makes that person the session', async () => {
  const result = await data.signIn('dana@northline.example', DEMO_PASSWORDS['USR-003']);
  assert.equal(result.ok, true);
  assert.equal(data.activeUser.id, 'USR-003');
  assert.equal(data.activeUser.name, 'Dana Reynolds');
  assert.equal(data.activeTenant.id, 'TNT-NORTHLINE', 'the session follows the person');
  assert.equal(can(data.activeUser, 'stock.adjust'), true, 'and their role travels with them');
  assert.equal(data.sessionUserId(), 'USR-003');
});

await check('the address is matched case-insensitively, and trimmed', async () => {
  const result = await data.signIn('  DANA@Northline.Example ', DEMO_PASSWORDS['USR-003']);
  assert.equal(result.ok, true, 'the same person, however the address is typed');
  assert.equal(data.activeUser.id, 'USR-003');
});

await check('a wrong password is refused, and the session does not move', async () => {
  const result = await data.signIn('dana@northline.example', 'not-the-password');
  assert.deepEqual(result, { ok: false, reason: 'invalid' });
  assert.equal(data.activeUser.id, 'USR-003', 'still the person who did sign in');
});

await check('an unknown address answers exactly like a wrong password', async () => {
  const unknown = await data.signIn('nobody@northline.example', 'whatever');
  const wrong = await data.signIn('dana@northline.example', 'whatever');
  assert.deepEqual(unknown, wrong, 'the form cannot be used to discover who works here');
  assert.deepEqual(unknown, { ok: false, reason: 'invalid' });
  assert.equal(data.activeUser.id, 'USR-003');
});

await check('a deactivated person is told so — but only once the credential proves', async () => {
  const row = byId('USR-006');
  row.active = false;
  assert.deepEqual(
    await data.signIn(row.email, 'not-the-password'),
    { ok: false, reason: 'invalid' },
    'a wrong password still learns nothing',
  );
  assert.deepEqual(
    await data.signIn(row.email, DEMO_PASSWORDS['USR-006']),
    { ok: false, reason: 'inactive' },
    'somebody who already knew the account existed is told',
  );
  assert.equal(data.activeUser.id, 'USR-003', 'and no session started');
  row.active = true;
});

await check('no answer a screen receives carries the credential', async () => {
  const result = await data.signIn('sandra@northline.example', DEMO_PASSWORDS['USR-006']);
  assert.equal(result.ok, true);
  const cred = credentials().find((c) => c.userId === 'USR-006');
  const printed = JSON.stringify(result);
  assert.equal(printed.includes(cred.hash), false, 'no digest in the answer');
  assert.equal(printed.includes(cred.salt), false, 'no salt in the answer');
  assert.equal(printed.includes(DEMO_PASSWORDS['USR-006']), false, 'and not the password');
  const session = JSON.stringify(snapshot().session);
  assert.equal(session.includes(cred.hash), false, 'nor in the persisted session');
  assert.equal(session.includes(cred.salt), false);
});

await check('signing out leaves nobody — no rights, no fallback to the first user', () => {
  const session = new SessionService(data);
  assert.equal(session.user().name, 'Sandra Patel');
  data.signOut();
  assert.equal(data.activeUser, undefined, 'not "whoever is listed first"');
  assert.equal(data.sessionUserId(), '');
  assert.equal(session.user(), undefined, 'the signal follows the store');
  assert.equal(session.can('items.view'), false, 'an empty session has no capabilities');
  assert.equal(can(data.activeUser, 'items.view'), false);
  assert.equal(data.listUsers().length, 6, 'and the people are still there');
});

await check('signing out survives a reload (a refresh does not sign back in)', () => {
  const reopened = new DataService();
  assert.equal(reopened.reseeded, false, 'the snapshot is still the current schema');
  assert.equal(reopened.sessionUserId(), '', 'still nobody');
  assert.equal(reopened.activeUser, undefined);
});

await check('a session that signed in survives a reload as the same person', async () => {
  await data.signIn('ray@northline.example', DEMO_PASSWORDS['USR-004']);
  const reopened = new DataService();
  assert.equal(reopened.activeUser.id, 'USR-004');
  assert.equal(reopened.activeTenant.id, 'TNT-NORTHLINE');
  assert.equal(can(reopened.activeUser, 'stock.move'), true, 'a warehouse role');
  assert.equal(can(reopened.activeUser, 'costs.view'), false, 'and nothing it does not hold');
});

await check('the workspace the sign-in screen names survives a sign-out', () => {
  data.signOut();
  assert.equal(data.activeTenant.slug, 'northline', 'the form can still name it');
  assert.equal(data.moduleFlags()['billing'], true, 'and the licence flags still read');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck14: ${n} checks`);

