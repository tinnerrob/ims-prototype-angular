import assert from 'node:assert/strict';

import { DEMO_PASSWORDS } from './data.service.js';

/**
 * The harnesses' one shared helper (B2).
 *
 * The fixture used to *ship* a session — it started acting as the seeded manager —
 * so a check could write a row and then assert who wrote it. It now ships signed
 * out, because that is what makes the sign-in form the thing a visitor actually
 * meets, which means a harness that cares about the actor signs in first, exactly as
 * a client does. `DEMO_PASSWORDS` is the fixture's published list; nothing here is a
 * secret, and this helper is deliberately the *only* thing the checks share.
 */
export async function signInAs(data, userId) {
  const user = data.getUser(userId);
  assert.ok(user, `no such seeded person: ${userId}`);
  const result = await data.signIn(user.email, DEMO_PASSWORDS[userId]);
  assert.equal(result.ok, true, `signed in as ${user.email}`);
  return result.user;
}
