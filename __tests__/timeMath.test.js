const test = require('node:test');
const assert = require('node:assert');
const {
  computePauseDuration,
  computeActiveTime,
  accumulateDetailerTime,
  formatDuration,
  formatClock,
  formatWhen,
  groupByDay,
  startOfDay,
} = require('../src/services/timeMath');

test('computeActiveTime subtracts pause from elapsed', () => {
  assert.strictEqual(computeActiveTime(0, 10000, 3000), 7000);
});

test('computeActiveTime with zero pause', () => {
  assert.strictEqual(computeActiveTime(1000, 5000, 0), 4000);
});

test('computeActiveTime clamps negative (clock skew) to 0', () => {
  assert.strictEqual(computeActiveTime(10000, 5000, 0), 0);
});

test('computeActiveTime clamps when pause exceeds elapsed', () => {
  assert.strictEqual(computeActiveTime(0, 5000, 9000), 0);
});

test('computePauseDuration returns positive span', () => {
  assert.strictEqual(computePauseDuration(1000, 4000), 3000);
});

test('computePauseDuration clamps non-positive span to 0', () => {
  assert.strictEqual(computePauseDuration(4000, 1000), 0);
});

test('accumulateDetailerTime adds session to existing total', () => {
  assert.strictEqual(accumulateDetailerTime(5000, 1000, 3000), 7000);
});

test('accumulateDetailerTime ignores a negative session', () => {
  assert.strictEqual(accumulateDetailerTime(5000, 3000, 1000), 5000);
});

test('formatDuration renders hours and zero-padded minutes', () => {
  assert.strictEqual(formatDuration(3720000), '1h 02m');
});

test('formatDuration renders minutes only', () => {
  assert.strictEqual(formatDuration(120000), '2 min');
});

test('formatDuration renders seconds under a minute and clamps negatives', () => {
  assert.strictEqual(formatDuration(45000), '45s');
  assert.strictEqual(formatDuration(-5), '0s');
});

// --- formatClock (live timers must visibly tick) --------------------------

test('formatClock shows seconds so a running timer visibly moves', () => {
  assert.strictEqual(formatClock(47 * 60000 + 3000), '47:03');
  assert.strictEqual(formatClock(47 * 60000 + 4000), '47:04');
});

test('formatClock adds hours with zero-padded minutes', () => {
  assert.strictEqual(formatClock(3600000 + 24 * 60000 + 7000), '1:24:07');
});

test('formatClock clamps junk and negatives to 0:00', () => {
  assert.strictEqual(formatClock(-1), '0:00');
  assert.strictEqual(formatClock('nope'), '0:00');
});

// --- formatWhen / groupByDay ----------------------------------------------

const NOON = new Date(2026, 9, 7, 12, 0, 0).getTime(); // Wed Oct 7 2026, local noon

test('formatWhen shows only a time for today', () => {
  const label = formatWhen(NOON - 3600000, NOON);
  assert.ok(!/Yesterday|Mon|Tue/.test(label), label);
  assert.match(label, /\d/);
});

test('formatWhen prefixes Yesterday for the previous day', () => {
  assert.match(formatWhen(NOON - 24 * 3600000, NOON), /^Yesterday /);
});

test('formatWhen returns a dash for missing timestamps', () => {
  assert.strictEqual(formatWhen(null, NOON), '—');
});

test('groupByDay buckets by local day, newest first, with friendly titles', () => {
  const items = [
    { id: 'a', t: NOON - 1000 },
    { id: 'b', t: NOON - 24 * 3600000 },
    { id: 'c', t: NOON - 2000 },
  ];
  const groups = groupByDay(items, (i) => i.t, NOON);
  assert.deepStrictEqual(
    groups.map((g) => g.title),
    ['Today', 'Yesterday'],
  );
  assert.deepStrictEqual(
    groups[0].data.map((i) => i.id),
    ['a', 'c'],
  );
  assert.strictEqual(groups[0].key, startOfDay(NOON));
});
