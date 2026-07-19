const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  mapSupabaseJobToLegacyShape,
  mergeJobsPreferLocalIfNewer,
  isRemoteNewer,
  computeLiveElapsed,
} = require('../src/services/jobLogic');

// --- sanitizeInput (trim + clamp; no tag stripping) -----------------------

test('sanitizeInput trims surrounding whitespace', () => {
  assert.strictEqual(sanitizeInput('  hello  '), 'hello');
});

test('sanitizeInput preserves < and > (no tag stripping / data corruption)', () => {
  const note = 'scratch < 2in on door > inspect';
  assert.strictEqual(sanitizeInput(note), note);
});

test('sanitizeInput caps at the default 200 chars', () => {
  assert.strictEqual(sanitizeInput('a'.repeat(500)).length, 200);
});

test('sanitizeInput respects an explicit maxLength (fixes note truncation bug)', () => {
  assert.strictEqual(sanitizeInput('a'.repeat(500), 500).length, 500);
});

test('sanitizeInput passes non-strings through untouched', () => {
  assert.strictEqual(sanitizeInput(42), 42);
  assert.strictEqual(sanitizeInput(null), null);
  assert.strictEqual(sanitizeInput(undefined), undefined);
});

// --- ensureArray ----------------------------------------------------------

test('ensureArray returns arrays unchanged', () => {
  const a = [1, 2];
  assert.strictEqual(ensureArray(a), a);
});

test('ensureArray coerces non-arrays to []', () => {
  assert.deepStrictEqual(ensureArray(null), []);
  assert.deepStrictEqual(ensureArray(undefined), []);
  assert.deepStrictEqual(ensureArray('nope'), []);
  assert.deepStrictEqual(ensureArray({ length: 3 }), []);
});

// --- parseTimestamp -------------------------------------------------------

test('parseTimestamp converts an ISO string to epoch ms', () => {
  assert.strictEqual(parseTimestamp('2026-01-01T00:00:00.000Z'), Date.UTC(2026, 0, 1));
});

test('parseTimestamp returns null for falsy or invalid input', () => {
  assert.strictEqual(parseTimestamp(null), null);
  assert.strictEqual(parseTimestamp(''), null);
  assert.strictEqual(parseTimestamp('not-a-date'), null);
});

// --- mapSupabaseJobToLegacyShape ------------------------------------------

test('mapSupabaseJobToLegacyShape prefers payload values over row columns', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'row-id',
    legacy_job_id: 'legacy-1',
    status: 'queued',
    make: 'RowMake',
    payload: { jobId: 'payload-1', make: 'PayloadMake', status: 'in_progress' },
  });
  assert.strictEqual(job.jobId, 'payload-1');
  assert.strictEqual(job.make, 'PayloadMake');
  assert.strictEqual(job.status, 'in_progress');
});

test('mapSupabaseJobToLegacyShape falls back to row columns when payload is empty', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'row-id',
    legacy_job_id: 'legacy-9',
    status: 'paused',
    stock_number: 'STK-9',
    vin: 'VIN9',
    payload: null,
  });
  assert.strictEqual(job.jobId, 'legacy-9');
  assert.strictEqual(job.status, 'paused');
  assert.strictEqual(job.stockNumber, 'STK-9');
  assert.strictEqual(job.vin, 'VIN9');
});

test('mapSupabaseJobToLegacyShape derives detailerName from the last detailer', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'r',
    payload: { detailers: ['Alice', 'Bob'] },
  });
  assert.strictEqual(job.detailerName, 'Bob');
});

test('mapSupabaseJobToLegacyShape defaults detailerName to Unknown', () => {
  const job = mapSupabaseJobToLegacyShape({ id: 'r', payload: {} });
  assert.strictEqual(job.detailerName, 'Unknown');
});

test('mapSupabaseJobToLegacyShape guarantees array fields', () => {
  const job = mapSupabaseJobToLegacyShape({ id: 'r', payload: { notes: 'oops' } });
  assert.deepStrictEqual(job.notes, []);
  assert.deepStrictEqual(job.pauseEvents, []);
  assert.deepStrictEqual(job.custodyEvents, []);
  assert.deepStrictEqual(job.detailers, []);
});

test('mapSupabaseJobToLegacyShape coerces numeric totals', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'r',
    total_pause_ms: '1500',
    total_active_ms: '3000',
    payload: {},
  });
  assert.strictEqual(job.totalPauseTime, 1500);
  assert.strictEqual(job.totalActiveTime, 3000);
});

// --- mergeJobsPreferLocalIfNewer (offline sync core) ----------------------

const job = (id, updatedAt, createdAt, extra = {}) => ({
  jobId: id,
  updatedAt,
  createdAt,
  ...extra,
});

test('merge keeps the local copy when it is newer than remote', () => {
  const local = [job('a', 200, 100, { note: 'local' })];
  const remote = [job('a', 100, 100, { note: 'remote' })];
  const merged = mergeJobsPreferLocalIfNewer(local, remote);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].note, 'local');
});

test('merge takes the remote copy when it is newer than local', () => {
  const local = [job('a', 100, 100, { note: 'local' })];
  const remote = [job('a', 300, 100, { note: 'remote' })];
  const merged = mergeJobsPreferLocalIfNewer(local, remote);
  assert.strictEqual(merged[0].note, 'remote');
});

test('merge keeps remote when timestamps are equal (no clobber of synced)', () => {
  const local = [job('a', 100, 100, { note: 'local' })];
  const remote = [job('a', 100, 100, { note: 'remote' })];
  const merged = mergeJobsPreferLocalIfNewer(local, remote);
  assert.strictEqual(merged[0].note, 'remote');
});

test('merge preserves jobs that exist only locally (unsynced offline edits)', () => {
  const local = [job('local-only', 100, 500)];
  const remote = [job('a', 100, 100)];
  const merged = mergeJobsPreferLocalIfNewer(local, remote);
  const ids = merged.map((j) => j.jobId);
  assert.ok(ids.includes('local-only'));
  assert.ok(ids.includes('a'));
});

test('merge preserves remote-only jobs', () => {
  const merged = mergeJobsPreferLocalIfNewer([], [job('r', 100, 100)]);
  assert.deepStrictEqual(
    merged.map((j) => j.jobId),
    ['r'],
  );
});

test('merge sorts results newest-created first', () => {
  const remote = [job('old', 1, 100), job('new', 1, 300), job('mid', 1, 200)];
  const merged = mergeJobsPreferLocalIfNewer([], remote);
  assert.deepStrictEqual(
    merged.map((j) => j.jobId),
    ['new', 'mid', 'old'],
  );
});

test('merge tolerates non-array inputs', () => {
  assert.deepStrictEqual(mergeJobsPreferLocalIfNewer(null, undefined), []);
});

test('merge treats a missing updatedAt as oldest', () => {
  const local = [job('a', undefined, 100, { note: 'local' })];
  const remote = [job('a', 50, 100, { note: 'remote' })];
  const merged = mergeJobsPreferLocalIfNewer(local, remote);
  // local has no updatedAt (=> 0), remote is newer, so remote wins.
  assert.strictEqual(merged[0].note, 'remote');
});

// --- isRemoteNewer --------------------------------------------------------

test('isRemoteNewer is true when the remote timestamp is later', () => {
  assert.strictEqual(isRemoteNewer('2026-01-02T00:00:00Z', Date.UTC(2026, 0, 1)), true);
});

test('isRemoteNewer is false when the remote timestamp is earlier or equal', () => {
  assert.strictEqual(isRemoteNewer('2026-01-01T00:00:00Z', Date.UTC(2026, 0, 2)), false);
  assert.strictEqual(isRemoteNewer('2026-01-01T00:00:00Z', Date.UTC(2026, 0, 1)), false);
});

test('isRemoteNewer is false for missing or invalid remote timestamps', () => {
  assert.strictEqual(isRemoteNewer(null, 0), false);
  assert.strictEqual(isRemoteNewer('not-a-date', 0), false);
});

// --- computeLiveElapsed (shared live timer) -------------------------------

test('computeLiveElapsed returns wall time minus accumulated pauses (running)', () => {
  const job = { startTime: 1000, totalPauseTime: 2000, status: 'in_progress', pauseEvents: [] };
  assert.strictEqual(computeLiveElapsed(job, 11000), 8000);
});

test('computeLiveElapsed subtracts the in-progress pause span when paused', () => {
  const job = {
    startTime: 0,
    totalPauseTime: 0,
    status: 'paused',
    pauseEvents: [{ type: 'pause', timestamp: 5000 }],
  };
  // now=9000, paused since 5000 => 9000 - 4000 = 5000 active
  assert.strictEqual(computeLiveElapsed(job, 9000), 5000);
});

test('computeLiveElapsed clamps negative (clock skew) to 0', () => {
  const job = { startTime: 10000, totalPauseTime: 0, status: 'in_progress', pauseEvents: [] };
  assert.strictEqual(computeLiveElapsed(job, 5000), 0);
});

test('computeLiveElapsed handles a null job', () => {
  assert.strictEqual(computeLiveElapsed(null, 1000), 0);
});
