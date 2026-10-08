// Pure, dependency-free job logic. CommonJS so Node's built-in test runner can
// require() it directly without loading React Native / Supabase.
//
// Supabase is the single source of truth for jobs. The phone never keeps its
// own copy of the job list; it only holds a short-lived outbox of *actions*
// ("paused #P4521 at 10:42") that haven't been confirmed yet. Every action is
// applied to the job by `applyJobAction` — on the phone (for an instant UI)
// and again against the latest server copy when the outbox sends it — so both
// sides always agree on how a job's state and times change.

const { computePauseDuration, computeActiveTime, accumulateDetailerTime } = require('./timeMath');

// Trim and length-cap free text. We deliberately do NOT strip HTML: React
// Native <Text> never interprets markup, React escapes on web, and the manager
// dashboard escapes on render — so tag stripping would only corrupt legitimate
// input (e.g. a note like "scratch < 2in").
const sanitizeInput = (input, maxLength = 200) => {
  if (typeof input !== 'string') return input;
  return input.trim().slice(0, maxLength);
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const parseTimestamp = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

// Statuses a detailer can still act on. `needs_rework` is a manager sending a
// finished car back; it counts as open everywhere (lists, counts, the
// one-active-job-per-stock rule in the database).
const OPEN_STATUSES = ['in_progress', 'paused', 'needs_rework'];
const isOpenStatus = (status) => OPEN_STATUSES.includes(status);

const mapSupabaseJobToLegacyShape = (row) => {
  const payload = row && typeof row.payload === 'object' && row.payload !== null ? row.payload : {};
  const createdAtMs = parseTimestamp(row.created_at);
  const updatedAtMs = parseTimestamp(row.client_updated_at) || parseTimestamp(row.updated_at);
  const startedAtMs = parseTimestamp(row.started_at);
  const endedAtMs = parseTimestamp(row.ended_at);

  const detailerFromList =
    Array.isArray(payload.detailers) && payload.detailers.length > 0
      ? payload.detailers[payload.detailers.length - 1]
      : null;

  return {
    ...payload,
    remoteId: row.id || null,
    jobId: payload.jobId || row.legacy_job_id || row.id,
    status: payload.status || row.status || 'queued',
    deviceId: payload.deviceId || row.device_id || null,
    stockNumber: payload.stockNumber || row.stock_number || null,
    vin: payload.vin || row.vin || null,
    make: payload.make || row.make || null,
    model: payload.model || row.model || null,
    year: payload.year || row.year || null,
    color: payload.color || row.color || null,
    detailerName: payload.detailerName || detailerFromList || 'Unknown',
    startTime: payload.startTime || startedAtMs || createdAtMs || Date.now(),
    endTime: payload.endTime || endedAtMs || null,
    createdAt: payload.createdAt || createdAtMs || Date.now(),
    updatedAt: payload.updatedAt || updatedAtMs || Date.now(),
    totalPauseTime: Number(payload.totalPauseTime || row.total_pause_ms || 0),
    totalActiveTime: Number(payload.totalActiveTime || row.total_active_ms || 0),
    pauseEvents: ensureArray(payload.pauseEvents),
    notes: ensureArray(payload.notes),
    photos: ensureArray(payload.photos),
    custodyEvents: ensureArray(payload.custodyEvents),
    detailers: ensureArray(payload.detailers),
    createdByUserId: payload.createdByUserId || row.created_by_user_id || null,
    assignedDetailerId: payload.assignedDetailerId || row.assigned_detailer_id || null,
    detailerTimeTracking:
      payload.detailerTimeTracking && typeof payload.detailerTimeTracking === 'object'
        ? payload.detailerTimeTracking
        : {},
  };
};

// When the current pause (or rework hold) began. A manager's "reopen for
// rework" records a pause starting at the original completion time, so the gap
// between finishing and starting rework never counts as work. Jobs reopened by
// older dashboards lack that event, so fall back to the completion custody
// event.
const currentHoldStart = (job) => {
  const events = ensureArray(job.pauseEvents);
  const last = events[events.length - 1];
  if (last && last.type === 'pause') return Number(last.timestamp) || null;
  if (job.status === 'needs_rework') {
    const completes = ensureArray(job.custodyEvents).filter((e) => e.type === 'complete');
    const lastComplete = completes[completes.length - 1];
    if (lastComplete) return Number(lastComplete.timestamp) || null;
  }
  return null;
};

// Active elapsed time for an open job (ms), clamped against clock skew.
const computeLiveElapsed = (job, now = Date.now()) => {
  if (!job) return 0;
  const onHold = job.status === 'paused' || job.status === 'needs_rework';
  const holdStart = onHold ? currentHoldStart(job) : null;
  const currentPause = holdStart ? Math.max(0, now - holdStart) : 0;
  const elapsed = now - Number(job.startTime || 0) - Number(job.totalPauseTime || 0) - currentPause;
  return elapsed > 0 ? elapsed : 0;
};

// The time a job's card should show: final time once completed, live otherwise.
const displayDuration = (job, now = Date.now()) =>
  job && job.status === 'completed'
    ? Number(job.totalActiveTime || 0)
    : computeLiveElapsed(job, now);

// --- Actions --------------------------------------------------------------

class JobActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobActionError';
    this.code = code;
    // The outbox drops permanent failures (after telling the detailer) rather
    // than retrying something that can never succeed.
    this.permanent = true;
  }
}

const MAX_APPLIED_IDS = 200;
// What usually interrupts a detail at a dealership: breaks, shift end, or
// sales/service pulling the car mid-detail. Anything else goes under Other.
const PAUSE_REASONS = ['Lunch / break', 'End of shift', 'Taken by sales', 'Taken by a tech'];

const clone = (job) => JSON.parse(JSON.stringify(job));

const custody = (job, type, at, actorName, note) => {
  job.custodyEvents = ensureArray(job.custodyEvents).concat({
    type,
    timestamp: at,
    detailerName: actorName || 'Unknown',
    note: note || '',
  });
};

const bankDetailerTime = (job, at) => {
  const key = job.detailerName || 'Unknown';
  job.detailerTimeTracking =
    job.detailerTimeTracking && typeof job.detailerTimeTracking === 'object'
      ? job.detailerTimeTracking
      : {};
  job.detailerTimeTracking[key] = accumulateDetailerTime(
    job.detailerTimeTracking[key] || 0,
    job.currentDetailerStartTime || job.startTime,
    at,
  );
};

const describeVehicle = (job) => (job && job.stockNumber ? `#${job.stockNumber}` : 'This car');

// Apply one action to a job and return the NEW job (the input is never
// mutated). `job` is null only for 'create'. Actions are idempotent: each
// carries an id, and an action already applied to this job is a no-op, so a
// retry after a send that actually landed can't double-pause or double-note.
//
// action: { id, type, jobId, at, actor: { id, name }, data }
const applyJobAction = (job, action) => {
  if (!action || !action.type) throw new JobActionError('invalid', 'Unknown action.');
  const at =
    Number.isFinite(Number(action.at)) && action.at !== null ? Number(action.at) : Date.now();
  const actorName = (action.actor && action.actor.name) || 'Unknown';
  const data = action.data || {};

  if (action.type === 'create') {
    if (job) return job; // already on the server: a retried create is a no-op
    const vehicle = {
      stockNumber: sanitizeInput(data.stockNumber || '', 50).toUpperCase(),
      year: sanitizeInput(data.year || '', 4),
      make: sanitizeInput(data.make || '', 50),
      model: sanitizeInput(data.model || '', 50),
      color: sanitizeInput(data.color || '', 30),
      vin: sanitizeInput(data.vin || '', 17).toUpperCase(),
    };
    const created = {
      jobId: action.jobId,
      deviceId: data.deviceId || null,
      detailerName: actorName,
      operationalUserId: (action.actor && action.actor.id) || null,
      assignedDetailerId: (action.actor && action.actor.id) || null,
      createdByUserId: (action.actor && action.actor.id) || null,
      detailers: [actorName],
      startTime: at,
      currentDetailerStartTime: at,
      endTime: null,
      totalPauseTime: 0,
      totalActiveTime: 0,
      status: 'in_progress',
      pauseEvents: [],
      notes: [],
      photos: [],
      latestNote: '',
      custodyEvents: [],
      detailerTimeTracking: {},
      appliedActionIds: [action.id].filter(Boolean),
      createdAt: at,
      updatedAt: at,
      ...vehicle,
    };
    custody(created, 'start', at, actorName, '');
    return created;
  }

  if (!job) throw new JobActionError('not_found', 'That job no longer exists.');
  if (action.id && ensureArray(job.appliedActionIds).includes(action.id)) return job;

  const next = clone(job);
  next.pauseEvents = ensureArray(next.pauseEvents);
  next.notes = ensureArray(next.notes);
  next.photos = ensureArray(next.photos);

  switch (action.type) {
    case 'pause': {
      if (next.status !== 'in_progress') {
        throw new JobActionError(
          'invalid_state',
          `${describeVehicle(job)} isn't running, so it can't be paused.`,
        );
      }
      const reason = sanitizeInput(data.reason || '', 60);
      const note = sanitizeInput(data.note || '', 500);
      bankDetailerTime(next, at);
      next.pauseEvents.push({ type: 'pause', timestamp: at, detailerName: actorName, reason });
      next.status = 'paused';
      const text = [reason, note].filter(Boolean).join(' — ');
      if (text) {
        next.notes.unshift({ timestamp: at, detailerName: actorName, text: `Paused: ${text}` });
        next.latestNote = text;
      }
      custody(next, 'pause', at, actorName, text);
      break;
    }
    case 'resume': {
      if (next.status !== 'paused' && next.status !== 'needs_rework') {
        throw new JobActionError('invalid_state', `${describeVehicle(job)} isn't paused.`);
      }
      const wasRework = next.status === 'needs_rework';
      const holdStart = currentHoldStart(next);
      if (holdStart) {
        next.totalPauseTime =
          Number(next.totalPauseTime || 0) + computePauseDuration(holdStart, at);
      }
      next.pauseEvents.push({ type: 'resume', timestamp: at, detailerName: actorName });
      next.status = 'in_progress';
      next.endTime = null;
      next.currentDetailerStartTime = at;
      custody(next, wasRework ? 'rework_start' : 'resume', at, actorName, '');
      break;
    }
    case 'complete': {
      if (next.status !== 'in_progress' && next.status !== 'paused') {
        throw new JobActionError(
          'invalid_state',
          next.status === 'completed'
            ? `${describeVehicle(job)} is already complete.`
            : `Start the rework on ${describeVehicle(job)} before completing it.`,
        );
      }
      if (next.status === 'paused') {
        const holdStart = currentHoldStart(next);
        if (holdStart) {
          next.totalPauseTime =
            Number(next.totalPauseTime || 0) + computePauseDuration(holdStart, at);
        }
      } else {
        bankDetailerTime(next, at);
      }
      next.endTime = at;
      next.totalActiveTime = computeActiveTime(next.startTime, at, next.totalPauseTime);
      next.status = 'completed';
      custody(next, 'complete', at, actorName, '');
      break;
    }
    case 'note': {
      if (next.status === 'completed') {
        throw new JobActionError(
          'invalid_state',
          `${describeVehicle(job)} is complete, so notes are locked.`,
        );
      }
      const text = sanitizeInput(data.text || '', 500);
      if (!text) throw new JobActionError('invalid', 'A note needs some text.');
      next.notes.unshift({ timestamp: at, detailerName: actorName, text });
      next.latestNote = text;
      break;
    }
    case 'photo': {
      // Photos are recorded even after completion: a picture taken just before
      // finishing may only upload later, and losing it would be worse.
      if (!data.storagePath) throw new JobActionError('invalid', 'Photo is missing its file.');
      if (!next.photos.some((p) => p.storagePath === data.storagePath)) {
        next.photos.unshift({
          storagePath: data.storagePath,
          timestamp: at,
          detailerName: actorName,
        });
      }
      break;
    }
    default:
      throw new JobActionError('invalid', `Unknown action "${action.type}".`);
  }

  next.updatedAt = Math.max(Number(next.updatedAt || 0), at);
  next.appliedActionIds = ensureArray(next.appliedActionIds)
    .concat(action.id ? [action.id] : [])
    .slice(-MAX_APPLIED_IDS);
  return next;
};

// Apply a list of actions in order, skipping (not throwing on) any that don't
// fit. Used to show a job "as it will be" with unsent outbox actions on top.
const applyPendingActions = (job, actions) => {
  let current = job;
  for (const action of ensureArray(actions)) {
    try {
      current = applyJobAction(current, action);
    } catch {
      // An action that no longer applies is reported when the outbox sends it.
    }
  }
  return current;
};

// The database row for a job. Structured columns mirror the payload so the
// dashboard and SQL reports can filter without parsing JSON.
const toJobRow = (job, dealershipId) => ({
  dealership_id: dealershipId,
  legacy_job_id: job.jobId,
  status: job.status,
  created_by_user_id: job.createdByUserId || null,
  assigned_detailer_id: job.assignedDetailerId || null,
  device_id: job.deviceId || null,
  stock_number: job.stockNumber || null,
  vin: job.vin || null,
  make: job.make || null,
  model: job.model || null,
  year: job.year || null,
  color: job.color || null,
  started_at: job.startTime ? new Date(job.startTime).toISOString() : null,
  ended_at: job.endTime ? new Date(job.endTime).toISOString() : null,
  total_pause_ms: Math.round(Number(job.totalPauseTime || 0)),
  total_active_ms: Math.round(Number(job.totalActiveTime || 0)),
  client_updated_at: new Date(Number(job.updatedAt) || Date.now()).toISOString(),
  payload: job,
});

// --- Outbox status for the banner -----------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Turn outbox state into something worth showing a detailer, or null.
const describeOutbox = ({ pending = 0, failures = [], online = true } = {}) => {
  const count = Math.max(0, Number(pending) || 0);
  const failed = ensureArray(failures);
  if (failed.length > 0) {
    return {
      tone: 'error',
      message: `Couldn't save: ${failed[0].message}`,
      action: 'Dismiss',
    };
  }
  if (count === 0) return null;
  if (!online) {
    return {
      tone: 'warning',
      message: `Offline. ${plural(count, 'change')} saved on this phone will send when you're back online.`,
      action: null,
    };
  }
  return { tone: 'info', message: `Sending ${plural(count, 'change')}…`, action: 'Retry now' };
};

// Which errors are worth retrying. Network trouble, timeouts, auth refreshes
// and server hiccups resolve on their own; everything else (constraint
// violations, permission denials, invalid state) never will.
const isTransientError = (error) => {
  if (!error) return false;
  if (error.permanent === true) return false;
  if (error.permanent === false) return true;
  const status = Number(error.status || (error.context && error.context.status) || 0);
  if (status === 401 || status === 408 || status === 429 || status >= 500) return true;
  const message = String(error.message || '').toLowerCase();
  if (/network|fetch|timeout|timed out|aborted|offline|jwt|socket|connection/.test(message)) {
    return true;
  }
  // PostgREST / Postgres errors carry a code: those are definitive answers.
  if (error.code) return false;
  return true;
};

// Plain-language version of a database error for a detailer.
const friendlyErrorMessage = (error, job) => {
  if (!error) return 'Something went wrong.';
  if (error.name === 'JobActionError') return error.message;
  if (error.code === '23505') {
    return `${describeVehicle(job)} is already open on another job. Open that job instead.`;
  }
  if (error.code === '42501' || /row-level security|permission/i.test(error.message || '')) {
    return "You don't have permission to change this job.";
  }
  if (/completed and can only be modified/i.test(error.message || '')) {
    return `${describeVehicle(job)} is complete. Ask a manager to reopen it.`;
  }
  return error.message || 'Something went wrong.';
};

module.exports = {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  OPEN_STATUSES,
  isOpenStatus,
  PAUSE_REASONS,
  mapSupabaseJobToLegacyShape,
  computeLiveElapsed,
  displayDuration,
  JobActionError,
  applyJobAction,
  applyPendingActions,
  toJobRow,
  describeOutbox,
  isTransientError,
  friendlyErrorMessage,
};
