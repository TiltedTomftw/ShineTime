// Pure, dependency-free job helpers extracted from storage.js so the sync-critical
// logic (input sanitizing, Supabase row mapping, offline merge, timestamp parsing)
// can be unit-tested without loading React Native / Supabase. storage.js imports
// these; behavior is unchanged. CommonJS so Node's built-in test runner can
// require() it directly (same pattern as timeMath.js).

// Trim and length-cap free text. We deliberately do NOT strip HTML: React
// Native <Text> never interprets markup, React escapes on web, and the manager
// dashboard escapes via textContent — so there is no XSS vector here. Tag
// stripping only corrupted legitimate input (e.g. a note like "scratch < 2in").
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

// Offline-safe reconcile of the local cache against the server.
//
// Merge rule: keep the local copy when its updatedAt is newer than the server's
// (so unsynced local edits are never clobbered), else take the remote copy.
//
// Delete rule (fixes "zombie jobs"): a local job that is absent from the server
// is ambiguous — it's either an offline creation that hasn't pushed yet, or a
// job that WAS on the server and has since been deleted. We disambiguate with
// `syncedAt`, stamped once a job is confirmed present on the server:
//   - absent + never synced   -> keep (pending local creation)
//   - absent + previously synced -> DELETED remotely, drop it locally
//
// `liveJobIds` must be the FULL set of live job ids on the server, while
// `remoteJobs` may be a narrower, role-scoped slice. Without that distinction a
// job belonging to another detailer on a shared device (absent from the scoped
// slice but alive on the server) would be mistaken for a deletion.
//
// Returns { jobs, deletedJobIds }; jobs are sorted newest-created first.
const reconcileJobsWithRemote = (localJobs, remoteJobs, liveJobIds, now = Date.now()) => {
  const remoteById = new Map(ensureArray(remoteJobs).map((job) => [job.jobId, job]));
  const liveIds = new Set(ensureArray(liveJobIds));
  const deletedJobIds = [];
  const result = new Map();

  // Anything the server returned is by definition synced.
  for (const [id, job] of remoteById) {
    result.set(id, { ...job, syncedAt: job.syncedAt || now });
  }

  for (const localJob of ensureArray(localJobs)) {
    const id = localJob.jobId;
    const remoteJob = remoteById.get(id);

    if (remoteJob) {
      const localUpdated = Number(localJob.updatedAt || 0);
      const remoteUpdated = Number(remoteJob.updatedAt || 0);
      if (localUpdated > remoteUpdated) {
        result.set(id, { ...localJob, syncedAt: localJob.syncedAt || now });
      }
      continue;
    }

    if (liveIds.has(id)) {
      // Alive on the server, just outside this scoped view — keep untouched.
      result.set(id, { ...localJob, syncedAt: localJob.syncedAt || now });
      continue;
    }

    if (localJob.syncedAt) {
      deletedJobIds.push(id); // was on the server, now gone => deleted
      continue;
    }

    result.set(id, localJob); // never synced => offline creation, keep
  }

  const jobs = Array.from(result.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { jobs, deletedJobIds };
};

const isRemoteNewer = (remoteClientUpdatedAt, localUpdatedAtMs) => {
  if (!remoteClientUpdatedAt) return false;
  const remoteMs = new Date(remoteClientUpdatedAt).getTime();
  if (!Number.isFinite(remoteMs)) return false;
  const localMs = Number(localUpdatedAtMs || 0);
  return remoteMs > localMs;
};

// Active elapsed time for a running/paused job (ms), clamped against clock skew.
// Subtracts accumulated pause time plus, when currently paused, the in-progress
// pause span. Single source of truth for the live timer across all screens
// (previously copy-pasted as getElapsedTime in three places). `now` is injectable
// so it stays pure and unit-testable.
const computeLiveElapsed = (job, now = Date.now()) => {
  if (!job) return 0;
  const events = ensureArray(job.pauseEvents);
  const lastPause = events[events.length - 1];
  const currentPause =
    job.status === 'paused' && lastPause && lastPause.type === 'pause'
      ? Math.max(0, now - Number(lastPause.timestamp || 0))
      : 0;
  const elapsed = now - Number(job.startTime || 0) - Number(job.totalPauseTime || 0) - currentPause;
  return elapsed > 0 ? elapsed : 0;
};

// Whether a job belongs to the given operator. Prefers a stable operational-user
// id match; falls back to detailer-name equality only for legacy jobs created
// before ids were stamped. Fixes the "two detailers named Mike collide" bug for
// all new jobs.
const jobBelongsToOperator = (job, operatorId, operatorName) => {
  if (!job) return false;
  if (operatorId && job.operationalUserId) {
    return job.operationalUserId === operatorId;
  }
  return (job.detailerName || '') === (operatorName || '');
};

module.exports = {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  mapSupabaseJobToLegacyShape,
  reconcileJobsWithRemote,
  isRemoteNewer,
  computeLiveElapsed,
  jobBelongsToOperator,
};
