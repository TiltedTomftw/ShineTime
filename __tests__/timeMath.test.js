const test = require('node:test');
const assert = require('node:assert');
const {
  computePauseDuration,
  computeActiveTime,
  accumulateDetailerTime,
  formatDuration,
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

test('formatDuration renders hours and minutes', () => {
  assert.strictEqual(formatDuration(3720000), '1h 2m');
});

test('formatDuration renders minutes only', () => {
  assert.strictEqual(formatDuration(120000), '2m');
});
