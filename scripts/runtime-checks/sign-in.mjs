import assert from 'node:assert/strict';

import { DEMO_PASSWORDS } from './data.service.js';

/**
 * The harnesses' shared helpers (B2, C2).
 *
 * The fixture used to *ship* a session — it started acting as the seeded manager —
 * so a check could write a row and then assert who wrote it. It now ships signed
 * out, because that is what makes the sign-in form the thing a visitor actually
 * meets, which means a harness that cares about the actor signs in first, exactly as
 * a client does. `DEMO_PASSWORDS` is the fixture's published list; nothing here is a
 * secret.
 *
 * This is one of two shared files, and both are about *reading an answer* rather than
 * about the store: this one is how a harness signs in, and `command-result.mjs` is how
 * it reads a command's `{ok, value|reason}` (C2). Everything else a check needs it
 * builds for itself.
 */
export async function signInAs(data, userId) {
  const user = data.getUser(userId);
  assert.ok(user, `no such seeded person: ${userId}`);
  const result = await data.signIn(user.email, DEMO_PASSWORDS[userId]);
  assert.equal(result.ok, true, `signed in as ${user.email}`);
  return result.value;
}
