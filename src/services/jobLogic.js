// Pure, dependency-free job helpers extracted from storage.js so the sync-critical
// logic (input sanitizing, Supabase row mapping, offline merge, timestamp parsing)
// can be unit-tested without loading React Native / Supabase. storage.js imports
// these; behavior is unchanged. CommonJS so Node's built-in test runner can
// require() it directly (same pattern as timeMath.js).

// Sanitize input to prevent XSS and injection attacks.
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  // Remove any HTML tags, scripts, and dangerous characters
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 200); // Max 200 characters
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

// Offline-safe merge: keep the local copy of a job when its updatedAt is newer
// than the server's (so unsynced local edits are not clobbered), otherwise take
// the remote copy. Jobs present only locally are preserved. Result is sorted
// newest-created first.
const mergeJobsPreferLocalIfNewer = (localJobs, remoteJobs) => {
  const remoteById = new Map(ensureArray(remoteJobs).map((job) => [job.jobId, job]));

  for (const localJob of ensureArray(localJobs)) {
    const remoteJob = remoteById.get(localJob.jobId);
    if (!remoteJob) {
      remoteById.set(localJob.jobId, localJob);
      continue;
    }

    const localUpdated = Number(localJob.updatedAt || 0);
    const remoteUpdated = Number(remoteJob.updatedAt || 0);
    if (localUpdated > remoteUpdated) {
      remoteById.set(localJob.jobId, localJob);
    }
  }

  return Array.from(remoteById.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
};

const isRemoteNewer = (remoteClientUpdatedAt, localUpdatedAtMs) => {
  if (!remoteClientUpdatedAt) return false;
  const remoteMs = new Date(remoteClientUpdatedAt).getTime();
  if (!Number.isFinite(remoteMs)) return false;
  const localMs = Number(localUpdatedAtMs || 0);
  return remoteMs > localMs;
};

module.exports = {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  mapSupabaseJobToLegacyShape,
  mergeJobsPreferLocalIfNewer,
  isRemoteNewer,
};
