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

const { DataService } = await import('./data.service.js');
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
/** The persisted snapshot, as the store wrote it. */
const persisted = () => JSON.parse(mem.get('ims-web.store'));
/**
 * Re-open the store on a snapshot with one field of its session replaced — the only
 * way to hand the client a stamp it did not write (a clock cannot be waited on, and
 * an expiry that has to be *lived* is an expiry no check can hold).
 */
function reopenWithSession(patch) {
  const snap = persisted();
  mem.set('ims-web.store', JSON.stringify({ ...snap, session: { ...snap.session, ...patch } }));
  return new DataService();
}

/* ============ B3: a session that ends ============
 *
 * B1 gave a session an origin and B2 made one required; neither gave it an *end*, so
 * a tab left open stayed somebody for ever. B3's claim is small and testable in data:
 * signing in stamps an expiry, activity rolls it, and a stamp that has run out — or
 * one this client cannot read at all — is refused *and cleared*, so what is left is a
 * sign-in form rather than a screen rendering for nobody.
 *
 * Two things are proven here that a browser could not settle faster. The rule, by
 * handing the store snapshots whose `expiresAt` is in the past, a minute ahead, or
 * absent (a clock cannot be waited on, and no check should have to sleep). And the
 * *shape*: the client never chooses its own window — `touchSession()` takes no
 * argument and `signIn()` takes a credential, so there is nowhere to pass "an hour,
 * please", which is what makes the window the server's term, not a preference.
 */

mem.clear();
const data = new DataService();

await check('a fresh fixture still ships signed out, and that is not the same as a lapse', () => {
  assert.equal(data.touchSession(), 'none', 'nobody was signed in — not a session that ended');
  assert.equal(data.sessionUserId(), '', 'the session names nobody');
  assert.equal(persisted().session.expiresAt, '', 'and carries no expiry');
});

await check('signing in stamps an end the client did not choose', async () => {
  await signInAs(data, 'USR-003');
  const { expiresAt } = persisted().session;
  const ends = Date.parse(expiresAt);
  assert.ok(Number.isFinite(ends), `the session carries a readable expiry, got ${JSON.stringify(expiresAt)}`);
  const minutes = (ends - Date.now()) / 60_000;
  assert.ok(minutes > 0, `it is ahead of now, got ${minutes}`);
  assert.ok(minutes < 24 * 60, `and it is a window rather than forever, got ${minutes}`);
  assert.equal(data.touchSession(), 'active', 'a session it just stamped is live');
});

await check('activity rolls the window — a session with time left is re-stamped', async () => {
  // Hand it a stamp that is real, ahead of now, and *shorter* than the one sign-in
  // writes: if the touch rolls the window at all, the new stamp has to be later.
  const short = new Date(Date.now() + 60_000).toISOString();
  const store = reopenWithSession({ expiresAt: short });
  assert.equal(store.activeUser.name, 'Dana Reynolds', 'still signed in, on a stamp it can read');
  assert.equal(store.touchSession(), 'active');
  const rolled = Date.parse(persisted().session.expiresAt);
  assert.ok(rolled > Date.parse(short), 'the expiry moved out, rather than being left where it was');
  // ...and by the same window sign-in writes, not some second number.
  const window = rolled - Date.now();
  assert.ok(window > 29 * 60_000 && window <= 30 * 60_000 + 1_000, `same window as sign-in, got ${window / 60_000}min`);
  assert.equal(new DataService().touchSession(), 'active', 'and the rolled stamp survives a reload');
});

await check('an idle session is refused, and cleared rather than left lapsed', async () => {
  const store = reopenWithSession({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  // The stamp is enforced where identity is read, not only where routes are checked:
  // a server refuses a request carrying a dead token, and these readers *are* that
  // request — so the store has stopped acting as the person before anything clears it.
  assert.equal(store.activeUser, undefined, 'a lapsed session acts as nobody');
  assert.equal(store.sessionUserId(), '', 'and authors nothing');
  assert.equal(can(store.activeUser, 'items.view'), false, 'so nothing it looks at has rights');
  assert.equal(persisted().session.userId, 'USR-003', 'though the snapshot still carries it (hydrate does not judge)');
  assert.equal(store.touchSession(), 'lapsed', 'and the guard is told the session ended');
  assert.equal(persisted().session.userId, '', 'the session was cleared, not left lapsed');
  assert.equal(persisted().session.expiresAt, '', 'the expiry went with it');
  assert.equal(store.touchSession(), 'none', 'and asking again is a first visit, not a second lapse');
});

await check('a lapsed session authors nothing: the write path reads the same rule', async () => {
  const store = reopenWithSession({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const row = store.createLocation({
    id: 'LOC-90',
    name: 'Lapsed Dock',
    type: 'Dock',
    parentId: 'LOC-10',
    address: '',
    phone: '',
    tz: 'America/New_York',
  });
  // `actor()` is the store's request context and it reads `sessionUserId()`, so the
  // expiry follows through to attribution: the row lands with no author. (The store
  // still does not *refuse* such a write — DATA-MODEL names that gap — but B3 means it
  // can no longer be stamped with somebody who stopped being signed in.)
  assert.equal(store.sessionUserId(), '', 'no actor to attribute a write to');
  assert.equal(row.createdBy, '', 'so the row carries none');
  assert.equal(store.activeUser, undefined, 'and the store is acting as nobody');
});

await check('a stamp this client cannot read is a lapse, not an unlimited session', async () => {
  // A hand-edited snapshot must not buy itself a session that never ends: an expiry
  // missing or unparseable is refused, which is the case a `!expiresAt → ok` shortcut
  // would have got exactly backwards.
  for (const expiresAt of ['', 'whenever']) {
    mem.clear();
    const fresh = new DataService();
    await signInAs(fresh, 'USR-003');
    // Strip the stamp off a session that is otherwise perfectly valid.
    const store = reopenWithSession({ expiresAt });
    assert.equal(persisted().session.userId, 'USR-003', 'the person is still in the snapshot');
    assert.equal(store.activeUser, undefined, 'but the store will not act as them');
    assert.equal(store.touchSession(), 'lapsed', `${JSON.stringify(expiresAt)} is refused`);
    assert.equal(persisted().session.userId, '', 'and cleared');
    assert.equal(persisted().session.expiresAt, '', 'including the stamp it could not read');
  }
});

await check('signing out takes the expiry with it', async () => {
  const store = reopenWithSession({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  await signInAs(store, 'USR-003');
  assert.notEqual(persisted().session.expiresAt, '', 'signed in, so there is a stamp');
  store.signOut();
  assert.equal(persisted().session.expiresAt, '', 'and signing out does not leave one behind');
  assert.equal(persisted().session.userId, '');
});

await check('the guard distinguishes a lapse from a first visit, and reads it as activity', () => {
  const src = read('./auth.guard.ts');
  assert.match(src, /const touch = session\.touch\(\)/, 'the guard asks the session to continue (B3)');
  assert.match(src, /if \(touch === 'active'\) return true/, 'a live session goes through');
  assert.match(
    src,
    /touch === 'lapsed' \? \{ next: state\.url, expired: 1 \}/,
    'only a session that *ended* is explained — a first visit is not told it timed out',
  );
});

await check('the form says why it is on screen, and takes no part in deciding it', () => {
  const html = read('./sign-in.component.html');
  const ts = read('./sign-in.component.ts');
  assert.match(ts, /queryParamMap\.get\('expired'\) === '1'/, 'the mark the guard left is read once, from the URL');
  assert.match(html, /@if \(endedSession\)/, 'and rendered');
  assert.match(html, /ended after a period of inactivity/, 'with a reason a person can act on');
  // The screen still decides nothing: the store answers, this prints.
  assert.equal(/expiresAt|Date\.now/.test(ts), false, 'no expiry logic in the form');
});

await check('nothing but sign-in and the touch may stamp a session', () => {
  const src = read('./data.service.ts');
  const stamps = [...src.matchAll(/expiryFrom\(SESSION_MINUTES\)/g)];
  assert.equal(stamps.length, 2, 'a session is stamped where it starts and where it is rolled — nowhere else');
  assert.match(src, /touchSession\(\): SessionTouch/, 'the touch takes no argument: it cannot be told how long to live');
  assert.match(
    src,
    /signIn\(email: string, password: string\): Promise<SignInResult>/,
    'and sign-in takes a credential, never a lifetime',
  );
  assert.match(src, /const SESSION_MINUTES = \d+/, 'the window is stated once, in one place');
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck16: ${n} checks`);
