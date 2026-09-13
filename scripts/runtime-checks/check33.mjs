import assert from 'node:assert/strict';

/* ======= the shared period-filter vocabulary (cleanup pass) =======
 *
 * The inspection log, the work-order grid and both purchasing lists each used to
 * declare their own `'all' | 'day' | 'week' | 'month'` type, chip array, label map
 * and two cursor methods (`setX` / `shiftX`). The three copies were byte-identical,
 * so they were replaced by one definition in `core/period.ts`.
 *
 * A refactor like that is only safe if it is *neutral*, so the headline assertion
 * here is not "the helper looks right" — it is that the helper reproduces, exactly,
 * the branch logic that was deleted, swept across calendar shapes that break naive
 * date arithmetic: a year boundary, the 29th of February, a month that starts on a
 * Sunday, and every filter state including `all`.
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

/* The helpers are read through `data.service.js`, because its re-export is the
   surface the three pages import them from. */
const {
  RANGE_FILTERS,
  RANGE_FILTER_LABEL,
  rangeView,
  alignPeriod,
  shiftPeriod,
  periodBounds,
  periodLabel,
  mondayOf,
  dayAt,
} = await import('./data.service.js');

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

/* ---------- the branch logic exactly as the three pages ran it ---------- */
const legacyAlign = (range, anchor) => {
  if (range === 'month') return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (range === 'week') return mondayOf(anchor);
  return anchor;
};
const legacyShift = (range, anchor, dir) => {
  if (range === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return dayAt(anchor, dir * (range === 'week' ? 7 : 1));
};

/** Anchors worth sweeping: a year boundary, a leap February, and a month opening. */
const anchors = [];
const sweep = (start, days, step) => {
  for (let i = 0; i < days; i += step) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    anchors.push(d);
  }
};
sweep(new Date(2025, 11, 18), 40, 3); // Dec 2025 → Jan 2026
sweep(new Date(2028, 1, 20), 20, 2); // Feb 2028 (29 days)
sweep(new Date(2026, 8, 1), 33, 4); // Sep 2026, a month opening on a Tuesday

check('the chips are one ordered list, with a label for every value', () => {
  assert.deepEqual(RANGE_FILTERS, ['all', 'day', 'week', 'month'], 'All leads, then the three periods');
  assert.deepEqual(Object.keys(RANGE_FILTER_LABEL).sort(), ['all', 'day', 'month', 'week'], 'every filter is named');
  for (const f of RANGE_FILTERS) assert.equal(typeof RANGE_FILTER_LABEL[f], 'string', `${f} has a label`);
});

check("rangeView() reads 'all' as a day and passes the three periods through", () => {
  assert.equal(rangeView('all'), 'day', 'All has no pager of its own, so it pages as a day');
  assert.equal(rangeView('day'), 'day');
  assert.equal(rangeView('week'), 'week');
  assert.equal(rangeView('month'), 'month');
});


check('alignPeriod() anchors a month on its 1st and a week on its Monday', () => {
  // Wed 9 Sep 2026 -> month opens 1 Sep, week opens Mon 7 Sep.
  const wed = new Date(2026, 8, 9);
  assert.equal(alignPeriod('month', wed).getTime(), new Date(2026, 8, 1).getTime(), 'month -> the 1st');
  assert.equal(alignPeriod('week', wed).getTime(), new Date(2026, 8, 7).getTime(), 'week -> its Monday');
  assert.equal(alignPeriod('day', wed).getTime(), wed.getTime(), 'a day is already anchored');
  assert.equal(alignPeriod('week', wed).getDay(), 1, 'and the Monday is genuinely a Monday');
});

check('alignPeriod() + shiftPeriod() reproduce the paging the pages ran inline', () => {
  for (const anchor of anchors) {
    for (const range of RANGE_FILTERS) {
      const view = rangeView(range);
      assert.equal(
        alignPeriod(view, anchor).getTime(),
        legacyAlign(range, anchor).getTime(),
        `align ${range} @ ${anchor.toDateString()}`,
      );
      for (const dir of [-2, -1, 1, 2]) {
        assert.equal(
          shiftPeriod(view, anchor, dir).getTime(),
          legacyShift(range, anchor, dir).getTime(),
          `shift ${range} ${dir} @ ${anchor.toDateString()}`,
        );
      }
    }
  }
});

check('shiftPeriod() steps a month by calendar month across a year boundary', () => {
  const dec = new Date(2025, 11, 15);
  const jan = shiftPeriod('month', alignPeriod('month', dec), 1);
  assert.equal(jan.getMonth(), 0, 'December -> January');
  assert.equal(jan.getFullYear(), 2026, 'in the next year');
  assert.equal(shiftPeriod('month', alignPeriod('month', dec), -1).getMonth(), 10, 'and back into November');
});

check('shiftPeriod() steps a week by seven days and a day by one', () => {
  const wed = new Date(2026, 8, 9);
  const monday = alignPeriod('week', wed);
  const next = shiftPeriod('week', monday, 1);
  assert.equal(next.getDay(), 1, 'still a Monday');
  assert.equal(Math.round((next - monday) / 86_400_000), 7, 'seven days on');
  assert.equal(shiftPeriod('day', wed, 1).getDate(), 10, 'a day moves one day');
  assert.equal(shiftPeriod('day', wed, 0).getTime(), wed.getTime(), 'and a zero step is the same day');
});

check('the window a filter shows is the one its label names', () => {
  const wed = new Date(2026, 8, 9);
  assert.deepEqual(
    periodBounds(rangeView('week'), wed),
    { start: '2026-09-07', end: '2026-09-13' },
    'a week runs Monday..Sunday',
  );
  assert.deepEqual(
    periodBounds(rangeView('month'), wed),
    { start: '2026-09-01', end: '2026-09-30' },
    'a month runs 1st..last',
  );
  assert.deepEqual(
    periodBounds(rangeView('all'), wed),
    { start: '2026-09-09', end: '2026-09-09' },
    'All reads as the cursor’s day',
  );
  assert.equal(periodLabel(rangeView('week'), alignPeriod('week', wed)), 'Week of Sep 7, 2026', 'label matches the bounds');
  assert.equal(periodLabel(rangeView('month'), alignPeriod('month', wed)), 'Month of September 2026', 'so does the month');
});

check('an aligned cursor is idempotent — aligning it again does not move it', () => {
  for (const anchor of anchors) {
    const monday = alignPeriod('week', anchor);
    assert.equal(alignPeriod('week', monday).getTime(), monday.getTime(), `week @ ${anchor.toDateString()}`);
    const first = alignPeriod('month', anchor);
    assert.equal(alignPeriod('month', first).getTime(), first.getTime(), `month @ ${anchor.toDateString()}`);
  }
});

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : `\ncheck33: ${n} checks`);
