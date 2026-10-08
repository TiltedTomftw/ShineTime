const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  isOpenStatus,
  mapSupabaseJobToLegacyShape,
  computeLiveElapsed,
  displayDuration,
  applyJobAction,
  applyPendingActions,
  toJobRow,
  describeOutbox,
  isTransientError,
  friendlyErrorMessage,
} = require('../src/services/jobLogic');

// --- sanitizeInput (trim + clamp; no tag stripping) -----------------------

test('sanitizeInput trims surrounding whitespace', () => {
  assert.strictEqual(sanitizeInput('  hello  '), 'hello');
});

test('sanitizeInput preserves < and > (no tag stripping / data corruption)', () => {
  const note = 'scratch < 2in on door > inspect';
  assert.strictEqual(sanitizeInput(note), note);
});

test('sanitizeInput caps at the default 200 chars or an explicit max', () => {
  assert.strictEqual(sanitizeInput('a'.repeat(500)).length, 200);
  assert.strictEqual(sanitizeInput('a'.repeat(500), 500).length, 500);
});

test('sanitizeInput passes non-strings through untouched', () => {
  assert.strictEqual(sanitizeInput(42), 42);
  assert.strictEqual(sanitizeInput(null), null);
});

test('ensureArray coerces non-arrays to []', () => {
  const a = [1];
  assert.strictEqual(ensureArray(a), a);
  assert.deepStrictEqual(ensureArray(null), []);
  assert.deepStrictEqual(ensureArray({ length: 3 }), []);
});

test('parseTimestamp converts ISO strings and rejects junk', () => {
  assert.strictEqual(parseTimestamp('2026-01-01T00:00:00.000Z'), Date.UTC(2026, 0, 1));
  assert.strictEqual(parseTimestamp(''), null);
  assert.strictEqual(parseTimestamp('not-a-date'), null);
});

test('isOpenStatus counts rework as open', () => {
  assert.ok(isOpenStatus('in_progress'));
  assert.ok(isOpenStatus('paused'));
  assert.ok(isOpenStatus('needs_rework'));
  assert.ok(!isOpenStatus('completed'));
});

// --- mapSupabaseJobToLegacyShape ------------------------------------------

test('mapSupabaseJobToLegacyShape prefers payload values and keeps the row id', () => {
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
  assert.strictEqual(job.remoteId, 'row-id');
});

test('mapSupabaseJobToLegacyShape falls back to row columns when payload is empty', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'row-id',
    legacy_job_id: 'legacy-9',
    status: 'paused',
    stock_number: 'STK-9',
    payload: null,
  });
  assert.strictEqual(job.jobId, 'legacy-9');
  assert.strictEqual(job.status, 'paused');
  assert.strictEqual(job.stockNumber, 'STK-9');
});

test('mapSupabaseJobToLegacyShape guarantees array fields and numeric totals', () => {
  const job = mapSupabaseJobToLegacyShape({
    id: 'r',
    total_active_ms: '3000',
    payload: { notes: 'oops' },
  });
  assert.deepStrictEqual(job.notes, []);
  assert.deepStrictEqual(job.photos, []);
  assert.strictEqual(job.totalActiveTime, 3000);
  assert.strictEqual(job.detailerName, 'Unknown');
});

// --- applyJobAction: the one place job state changes ----------------------

const actor = { id: 'u1', name: 'Mike' };
let seq = 0;
const act = (type, at, data = {}, extra = {}) => ({
  id: `a${(seq += 1)}`,
  type,
  jobId: 'job_1',
  at,
  actor,
  data,
  ...extra,
});
const created = (at = 1000, data = { stockNumber: 'p4521', make: 'Ford' }) =>
  applyJobAction(null, act('create', at, data));

test('create builds a running job attributed to the actor', () => {
  const job = created(1000);
  assert.strictEqual(job.status, 'in_progress');
  assert.strictEqual(job.stockNumber, 'P4521');
  assert.strictEqual(job.startTime, 1000);
  assert.strictEqual(job.assignedDetailerId, 'u1');
  assert.strictEqual(job.operationalUserId, 'u1');
  assert.strictEqual(job.custodyEvents[0].type, 'start');
});

test('a retried create for a job already on the server is a no-op', () => {
  const job = created(1000);
  assert.strictEqual(applyJobAction(job, act('create', 5000)), job);
});

test('actions never mutate the job passed in', () => {
  const job = created(1000);
  const before = JSON.stringify(job);
  applyJobAction(job, act('pause', 2000));
  assert.strictEqual(JSON.stringify(job), before);
});

test('pause -> resume -> complete times use when the detailer TAPPED, not when it sent', () => {
  let job = created(0);
  job = applyJobAction(job, act('pause', 60000, { reason: 'Lunch / break' }));
  job = applyJobAction(job, act('resume', 90000));
  job = applyJobAction(job, act('complete', 150000));
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.totalPauseTime, 30000);
  assert.strictEqual(job.totalActiveTime, 120000);
  assert.strictEqual(job.endTime, 150000);
  assert.deepStrictEqual(
    job.custodyEvents.map((e) => e.type),
    ['start', 'pause', 'resume', 'complete'],
  );
});

test('a pause reason and note land in Notes so they never disappear', () => {
  const job = applyJobAction(
    created(0),
    act('pause', 1000, { reason: 'Taken by sales', note: 'test drive' }),
  );
  assert.strictEqual(job.notes[0].text, 'Paused: Taken by sales — test drive');
  assert.strictEqual(job.pauseEvents[0].reason, 'Taken by sales');
});

test('completing a paused job folds in the final pause', () => {
  let job = created(0);
  job = applyJobAction(job, act('pause', 10000));
  job = applyJobAction(job, act('complete', 40000));
  assert.strictEqual(job.totalPauseTime, 30000);
  assert.strictEqual(job.totalActiveTime, 10000);
});

test('the same action applied twice only counts once (safe retries)', () => {
  const pause = act('pause', 1000);
  const once = applyJobAction(created(0), pause);
  const twice = applyJobAction(once, pause);
  assert.strictEqual(twice, once);
  assert.strictEqual(twice.pauseEvents.length, 1);
});

test('invalid transitions throw a permanent, plain-language error', () => {
  const job = created(0);
  assert.throws(
    () => applyJobAction(job, act('resume', 1000)),
    (e) => e.permanent === true && /isn't paused/.test(e.message),
  );
  const done = applyJobAction(job, act('complete', 1000));
  assert.throws(() => applyJobAction(done, act('note', 2000, { text: 'x' })), /locked/);
  assert.throws(() => applyJobAction(done, act('complete', 2000)), /already complete/);
  assert.throws(() => applyJobAction(null, act('pause', 1)), /no longer exists/);
});

test('notes go newest-first and empty notes are rejected', () => {
  let job = applyJobAction(created(0), act('note', 1000, { text: 'first' }));
  job = applyJobAction(job, act('note', 2000, { text: 'second' }));
  assert.deepStrictEqual(
    job.notes.map((n) => n.text),
    ['second', 'first'],
  );
  assert.throws(() => applyJobAction(job, act('note', 3000, { text: '   ' })), /needs some text/);
});

test('photos are recorded by storage path, even after completion, without duplicates', () => {
  let job = applyJobAction(created(0), act('complete', 1000));
  job = applyJobAction(job, act('photo', 2000, { storagePath: 'd/j/p1.jpg' }));
  job = applyJobAction(job, act('photo', 2500, { storagePath: 'd/j/p1.jpg' }));
  assert.strictEqual(job.photos.length, 1);
  assert.strictEqual(job.photos[0].url, undefined, 'no expiring URL is stored');
});

// --- Rework: the manager sends a finished car back ------------------------

const reworked = (completedAt, viaNewDashboard = true) => {
  const done = applyJobAction(created(0), act('complete', completedAt));
  const job = JSON.parse(JSON.stringify(done));
  job.status = 'needs_rework';
  job.endTime = null;
  if (viaNewDashboard) {
    job.pauseEvents.push({ type: 'pause', timestamp: completedAt, reason: 'rework' });
  }
  return job;
};

test('starting rework resumes the clock without billing the time it sat finished', () => {
  let job = reworked(60000);
  job = applyJobAction(job, act('resume', 600000));
  assert.strictEqual(job.status, 'in_progress');
  assert.strictEqual(job.custodyEvents[job.custodyEvents.length - 1].type, 'rework_start');
  job = applyJobAction(job, act('complete', 660000));
  assert.strictEqual(job.totalActiveTime, 120000, '60s first pass + 60s rework');
});

test('rework jobs reopened by the old dashboard (no pause event) are handled too', () => {
  let job = reworked(60000, false);
  job = applyJobAction(job, act('resume', 600000));
  job = applyJobAction(job, act('complete', 660000));
  assert.strictEqual(job.totalActiveTime, 120000);
});

test('a rework job must be started before it can be completed or paused', () => {
  const job = reworked(60000);
  assert.throws(() => applyJobAction(job, act('complete', 70000)), /Start the rework/);
  assert.throws(() => applyJobAction(job, act('pause', 70000)), /isn't running/);
});

test('the live timer holds still while a car waits for rework', () => {
  const job = reworked(60000);
  assert.strictEqual(computeLiveElapsed(job, 600000), 60000);
  assert.strictEqual(computeLiveElapsed(reworked(60000, false), 600000), 60000);
});

// --- applyPendingActions ---------------------------------------------------

test('applyPendingActions shows unsent actions on top and skips ones that no longer fit', () => {
  const job = applyPendingActions(created(0), [
    act('pause', 1000),
    act('pause', 2000), // already paused: skipped, not thrown
    act('resume', 3000),
  ]);
  assert.strictEqual(job.status, 'in_progress');
  assert.strictEqual(job.pauseEvents.length, 2);
});

test('applyPendingActions can build a job that only exists in the outbox', () => {
  const job = applyPendingActions(null, [act('create', 0, { stockNumber: 'X1' }), act('pause', 5)]);
  assert.strictEqual(job.stockNumber, 'X1');
  assert.strictEqual(job.status, 'paused');
});

// --- computeLiveElapsed / displayDuration ---------------------------------

test('computeLiveElapsed returns wall time minus accumulated pauses (running)', () => {
  const job = { startTime: 1000, totalPauseTime: 2000, status: 'in_progress', pauseEvents: [] };
  assert.strictEqual(computeLiveElapsed(job, 11000), 8000);
});

test('computeLiveElapsed subtracts the current pause span when paused', () => {
  const job = { startTime: 0, status: 'paused', pauseEvents: [{ type: 'pause', timestamp: 5000 }] };
  assert.strictEqual(computeLiveElapsed(job, 9000), 5000);
});

test('computeLiveElapsed clamps clock skew to 0 and handles null', () => {
  assert.strictEqual(computeLiveElapsed({ startTime: 10000, status: 'in_progress' }, 5000), 0);
  assert.strictEqual(computeLiveElapsed(null, 1000), 0);
});

test('displayDuration uses the final time for completed jobs', () => {
  assert.strictEqual(displayDuration({ status: 'completed', totalActiveTime: 42 }, 1e12), 42);
});

// --- toJobRow ---------------------------------------------------------------

test('toJobRow mirrors payload into structured columns', () => {
  const job = applyJobAction(created(0, { stockNumber: 'abc' }), act('complete', 120000));
  const row = toJobRow(job, 'dealer-1');
  assert.strictEqual(row.dealership_id, 'dealer-1');
  assert.strictEqual(row.legacy_job_id, 'job_1');
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.stock_number, 'ABC');
  assert.strictEqual(row.assigned_detailer_id, 'u1');
  assert.strictEqual(row.total_active_ms, 120000);
  assert.strictEqual(row.payload, job);
});

// --- Outbox messaging + error classification ------------------------------

test('describeOutbox is silent when nothing is pending', () => {
  assert.strictEqual(describeOutbox({ pending: 0 }), null);
  assert.strictEqual(describeOutbox(), null);
});

test('describeOutbox explains offline saves in plain language', () => {
  const info = describeOutbox({ pending: 2, online: false });
  assert.strictEqual(info.tone, 'warning');
  assert.match(info.message, /^Offline\. 2 changes saved on this phone/);
  assert.match(describeOutbox({ pending: 1, online: true }).message, /Sending 1 change/);
});

test('describeOutbox puts a failure first so it is seen', () => {
  const info = describeOutbox({ pending: 3, failures: [{ message: '#P1 is complete.' }] });
  assert.strictEqual(info.tone, 'error');
  assert.strictEqual(info.message, "Couldn't save: #P1 is complete.");
});

test('isTransientError retries network/server trouble but not definitive answers', () => {
  assert.ok(isTransientError(new TypeError('Network request failed')));
  assert.ok(isTransientError({ status: 503, message: 'x' }));
  assert.ok(isTransientError({ message: 'JWT expired' }));
  assert.ok(!isTransientError({ code: '23505', message: 'duplicate key value' }));
  assert.ok(!isTransientError({ permanent: true, message: 'x' }));
});

test('friendlyErrorMessage turns database errors into something a detailer understands', () => {
  const job = { stockNumber: 'P1' };
  assert.match(friendlyErrorMessage({ code: '23505', message: 'dup' }, job), /#P1 is already open/);
  assert.match(
    friendlyErrorMessage({ message: 'job is completed and can only be modified by an owner' }, job),
    /Ask a manager to reopen/,
  );
});
