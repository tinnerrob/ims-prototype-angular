import assert from 'node:assert/strict';

/*
 * Reading a command's answer (C2).
 *
 * A command used to say no with a sentinel — `null` for "no such row", `false` for a
 * refused removal — so a check asserted on `null` or `false` and, more often than not,
 * on nothing at all. The shape is one `CommandResult` now: `{ok:true, value?}` or
 * `{ok:false, reason}`. These two helpers are how the harnesses read it, and they are
 * deliberately narrower than `assert.ok(result)`: naming the *reason* is the part C2
 * added, and a check that stops naming it would let a refusal drift to the wrong
 * branch without failing.
 */

/** The command refused, with exactly this reason — and so persisted nothing. */
export function refuses(result, reason) {
  assert.equal(result.ok, false, `expected a refusal ('${reason}'), got a success`);
  assert.equal(result.reason, reason, `the refusal names '${reason}'`);
  return result;
}

/** The command persisted. Answers what it produced (`undefined` for a void command). */
export function persisted(result) {
  assert.equal(result.ok, true, `expected the command to persist, got '${result.reason}'`);
  return result.value;
}
