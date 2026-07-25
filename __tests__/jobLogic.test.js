const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  mapSupabaseJobToLegacyShape,
  reconcileJobsWithRemote,
  isRemoteNewer,
  computeLiveElapsed,
  jobBelongsToOperator,
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

// --- reconcileJobsWithRemote (offline sync core + delete propagation) -----

const job = (id, updatedAt, createdAt, extra = {}) => ({
  jobId: id,
  updatedAt,
  createdAt,
  ...extra,
});

// Helper: ids of every job "alive" on the server.
const liveOf = (...jobs) => jobs.map((j) => j.jobId);

test('reconcile keeps the local copy when it is newer than remote', () => {
  const local = [job('a', 200, 100, { note: 'local' })];
  const remote = [job('a', 100, 100, { note: 'remote' })];
  const { jobs } = reconcileJobsWithRemote(local, remote, liveOf(...remote));
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].note, 'local');
});

test('reconcile takes the remote copy when it is newer than local', () => {
  const local = [job('a', 100, 100, { note: 'local' })];
  const remote = [job('a', 300, 100, { note: 'remote' })];
  const { jobs } = reconcileJobsWithRemote(local, remote, liveOf(...remote));
  assert.strictEqual(jobs[0].note, 'remote');
});

test('reconcile keeps remote when timestamps are equal (no clobber of synced)', () => {
  const local = [job('a', 100, 100, { note: 'local' })];
  const remote = [job('a', 100, 100, { note: 'remote' })];
  const { jobs } = reconcileJobsWithRemote(local, remote, liveOf(...remote));
  assert.strictEqual(jobs[0].note, 'remote');
});

test('reconcile preserves a never-synced local job (offline creation)', () => {
  const local = [job('local-only', 100, 500)]; // no syncedAt
  const remote = [job('a', 100, 100)];
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, remote, liveOf(...remote));
  assert.ok(jobs.map((j) => j.jobId).includes('local-only'));
  assert.deepStrictEqual(deletedJobIds, []);
});

test('reconcile DROPS a previously-synced job that is gone from the server', () => {
  const local = [job('gone', 100, 100, { syncedAt: 50 })];
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, [], []);
  assert.deepStrictEqual(jobs, []);
  assert.deepStrictEqual(deletedJobIds, ['gone']);
});

test('reconcile does NOT drop a synced job that is merely out of scope', () => {
  // Alive on the server (in liveJobIds) but absent from this detailer's slice.
  const local = [job('other-detailer', 100, 100, { syncedAt: 50 })];
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, [], ['other-detailer']);
  assert.deepStrictEqual(
    jobs.map((j) => j.jobId),
    ['other-detailer'],
  );
  assert.deepStrictEqual(deletedJobIds, []);
});

test('reconcile stamps syncedAt on jobs returned by the server', () => {
  const remote = [job('a', 100, 100)];
  const { jobs } = reconcileJobsWithRemote([], remote, liveOf(...remote), 999);
  assert.strictEqual(jobs[0].syncedAt, 999);
});

test('reconcile backfills syncedAt for a local job confirmed present remotely', () => {
  const local = [job('a', 500, 100, { note: 'local' })]; // newer, wins, no syncedAt
  const remote = [job('a', 100, 100)];
  const { jobs } = reconcileJobsWithRemote(local, remote, liveOf(...remote), 777);
  assert.strictEqual(jobs[0].note, 'local');
  assert.strictEqual(jobs[0].syncedAt, 777);
});

test('reconcile preserves remote-only jobs', () => {
  const remote = [job('r', 100, 100)];
  const { jobs } = reconcileJobsWithRemote([], remote, liveOf(...remote));
  assert.deepStrictEqual(
    jobs.map((j) => j.jobId),
    ['r'],
  );
});

test('reconcile sorts results newest-created first', () => {
  const remote = [job('old', 1, 100), job('new', 1, 300), job('mid', 1, 200)];
  const { jobs } = reconcileJobsWithRemote([], remote, liveOf(...remote));
  assert.deepStrictEqual(
    jobs.map((j) => j.jobId),
    ['new', 'mid', 'old'],
  );
});

test('reconcile tolerates non-array inputs', () => {
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(null, undefined, null);
  assert.deepStrictEqual(jobs, []);
  assert.deepStrictEqual(deletedJobIds, []);
});

test('reconcile treats a missing updatedAt as oldest', () => {
  const local = [job('a', undefined, 100, { note: 'local' })];
  const remote = [job('a', 50, 100, { note: 'remote' })];
  const { jobs } = reconcileJobsWithRemote(local, remote, liveOf(...remote));
  assert.strictEqual(jobs[0].note, 'remote');
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

// --- jobBelongsToOperator (stable id scoping) -----------------------------

test('jobBelongsToOperator matches on operational-user id when present', () => {
  const job = { operationalUserId: 'u1', detailerName: 'Mike' };
  assert.strictEqual(jobBelongsToOperator(job, 'u1', 'Someone Else'), true);
  assert.strictEqual(jobBelongsToOperator(job, 'u2', 'Mike'), false);
});

test('jobBelongsToOperator does NOT collide two same-named detailers by id', () => {
  const mikeA = { operationalUserId: 'a', detailerName: 'Mike' };
  const mikeB = { operationalUserId: 'b', detailerName: 'Mike' };
  assert.strictEqual(jobBelongsToOperator(mikeA, 'a', 'Mike'), true);
  assert.strictEqual(jobBelongsToOperator(mikeB, 'a', 'Mike'), false);
});

test('jobBelongsToOperator falls back to name for legacy jobs without an id', () => {
  const legacy = { detailerName: 'Mike' };
  assert.strictEqual(jobBelongsToOperator(legacy, 'u1', 'Mike'), true);
  assert.strictEqual(jobBelongsToOperator(legacy, 'u1', 'Dave'), false);
});

test('jobBelongsToOperator handles a null job', () => {
  assert.strictEqual(jobBelongsToOperator(null, 'u1', 'Mike'), false);
});
