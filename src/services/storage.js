import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { computeActiveTime, computePauseDuration, accumulateDetailerTime } from './timeMath';
import {
  sanitizeInput,
  ensureArray,
  parseTimestamp,
  mapSupabaseJobToLegacyShape,
  mergeJobsPreferLocalIfNewer,
  isRemoteNewer,
} from './jobLogic';

const STORAGE_KEYS = {
  JOBS: '@detailtracker_jobs',
  DEVICE_ID: '@detailtracker_device_id',
  DETAILER_NAME: '@detailtracker_detailer_name',
  ACTIVE_DEALERSHIP_ID: '@detailtracker_active_dealership_id',
  ACTIVE_OPERATIONAL_ROLE: '@detailtracker_active_operational_role',
  PENDING_JOBS: '@detailtracker_pending_jobs',
};

// Photo signed URLs are minted fresh at read time; keep expiry short so a URL
// that leaks or gets cached in a payload cannot be replayed for long.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const fetchSupabaseJobs = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return null;

  const dealershipId = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_DEALERSHIP_ID);
  if (!dealershipId) return null;

  const { data, error } = await supabase
    .from('jobs')
    .select(
      [
        'id',
        'legacy_job_id',
        'status',
        'created_by_user_id',
        'assigned_detailer_id',
        'device_id',
        'stock_number',
        'vin',
        'make',
        'model',
        'year',
        'color',
        'started_at',
        'ended_at',
        'total_pause_ms',
        'total_active_ms',
        'client_updated_at',
        'created_at',
        'updated_at',
        'payload',
      ].join(','),
    )
    .eq('dealership_id', dealershipId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ensureArray(data).map(mapSupabaseJobToLegacyShape);
};

const getSupabaseSyncContext = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    throw new Error('Not signed in');
  }

  const dealershipId = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_DEALERSHIP_ID);
  if (!dealershipId) {
    throw new Error('No active dealership selected');
  }

  return { userId: session.user.id, dealershipId };
};

const normalizeJobStatusForSupabase = (status) => {
  switch (status) {
    case 'queued':
    case 'in_progress':
    case 'paused':
    case 'completed':
    case 'needs_rework':
    case 'cancelled':
      return status;
    case 'rework':
      return 'needs_rework';
    default:
      return 'queued';
  }
};

const toIsoOrNull = (ms) => {
  const numeric = Number(ms);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric).toISOString();
};

const getFileExtensionFromMime = (mimeType) => {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'jpg';
  }
};

const base64ToBlob = async (base64, mimeType) => {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
  const response = await fetch(dataUrl);
  return response.blob();
};

const signedUrlFromStoragePath = async (storagePath, expiresInSeconds = SIGNED_URL_TTL_SECONDS) => {
  if (!storagePath) return '';
  const { data, error } = await supabase.storage
    .from('job-photos')
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) {
    console.log('Could not create signed URL for photo path:', error.message);
    return '';
  }
  return data?.signedUrl || '';
};

const mapLegacyJobToSupabaseRow = (job, { userId, dealershipId }) => ({
  dealership_id: dealershipId,
  legacy_job_id: job.jobId || null,
  status: normalizeJobStatusForSupabase(job.status),
  created_by_user_id: job.createdByUserId || userId,
  assigned_detailer_id: job.assignedDetailerId || userId,
  device_id: job.deviceId || null,
  stock_number: job.stockNumber || null,
  vin: job.vin || null,
  make: job.make || null,
  model: job.model || null,
  year: job.year || null,
  color: job.color || null,
  started_at: toIsoOrNull(job.startTime || job.createdAt),
  ended_at: toIsoOrNull(job.endTime),
  total_pause_ms: Number(job.totalPauseTime || 0),
  total_active_ms: Number(job.totalActiveTime || 0),
  client_updated_at: toIsoOrNull(job.updatedAt || Date.now()) || new Date().toISOString(),
  payload: job,
});

const getRemoteJobIdByLegacyId = async (dealershipId, legacyJobId) => {
  if (!dealershipId || !legacyJobId) return null;
  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .eq('dealership_id', dealershipId)
    .eq('legacy_job_id', legacyJobId)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
};

const insertSupabaseNote = async ({ job, detailerName, noteText, noteTimestamp }) => {
  const context = await getSupabaseSyncContext();
  const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, job.jobId);
  if (!remoteJobId) return false;

  const { error } = await supabase.from('job_notes').insert({
    job_id: remoteJobId,
    dealership_id: context.dealershipId,
    author_user_id: context.userId,
    author_name: detailerName || 'Unknown',
    note: noteText,
    created_at: toIsoOrNull(noteTimestamp) || new Date().toISOString(),
    metadata: {
      source: 'mobile',
      legacy_job_id: job.jobId,
      source_timestamp: noteTimestamp || Date.now(),
    },
  });

  if (error) throw error;
  return true;
};

const insertSupabaseWorkLog = async ({
  job,
  eventType,
  actorName,
  noteText = '',
  eventTimestamp = Date.now(),
}) => {
  const context = await getSupabaseSyncContext();
  const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, job.jobId);
  if (!remoteJobId) return false;

  const { error } = await supabase.from('job_work_logs').insert({
    job_id: remoteJobId,
    dealership_id: context.dealershipId,
    event_type: eventType,
    actor_user_id: context.userId,
    actor_name: actorName || 'Unknown',
    note: noteText || null,
    event_at: toIsoOrNull(eventTimestamp) || new Date().toISOString(),
    metadata: {
      source: 'mobile',
      legacy_job_id: job.jobId,
      source_timestamp: eventTimestamp,
    },
  });

  if (error) throw error;
  return true;
};

const enrichJobFromNormalizedTables = async (job) => {
  try {
    const context = await getSupabaseSyncContext();
    const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, job.jobId);
    if (!remoteJobId) return job;

    const [notesResp, workLogsResp, photosResp] = await Promise.all([
      supabase
        .from('job_notes')
        .select('author_name,note,created_at')
        .eq('dealership_id', context.dealershipId)
        .eq('job_id', remoteJobId)
        .order('created_at', { ascending: false }),
      supabase
        .from('job_work_logs')
        .select('event_type,actor_name,note,event_at')
        .eq('dealership_id', context.dealershipId)
        .eq('job_id', remoteJobId)
        .order('event_at', { ascending: false }),
      supabase
        .from('job_photos')
        .select('storage_path,uploaded_by_name,created_at,metadata')
        .eq('dealership_id', context.dealershipId)
        .eq('job_id', remoteJobId)
        .order('created_at', { ascending: false }),
    ]);

    if (notesResp.error) throw notesResp.error;
    if (workLogsResp.error) throw workLogsResp.error;
    if (photosResp.error) throw photosResp.error;

    const normalizedNotes = ensureArray(notesResp.data).map((n) => ({
      timestamp: parseTimestamp(n.created_at) || Date.now(),
      detailerName: n.author_name || 'Unknown',
      text: n.note || '',
    }));

    const normalizedCustody = ensureArray(workLogsResp.data).map((w) => ({
      type: w.event_type || 'event',
      timestamp: parseTimestamp(w.event_at) || Date.now(),
      detailerName: w.actor_name || 'Unknown',
      note: w.note || '',
    }));

    const normalizedPhotos = [];
    for (const photoRow of ensureArray(photosResp.data)) {
      const signedUrl = await signedUrlFromStoragePath(photoRow.storage_path);
      if (!signedUrl) continue;
      normalizedPhotos.push({
        url: signedUrl,
        storagePath: photoRow.storage_path,
        timestamp: parseTimestamp(photoRow.created_at) || Date.now(),
        detailerName: photoRow.uploaded_by_name || 'Unknown',
        note: photoRow?.metadata?.note || '',
      });
    }

    return {
      ...job,
      notes: normalizedNotes.length > 0 ? normalizedNotes : ensureArray(job.notes),
      custodyEvents:
        normalizedCustody.length > 0 ? normalizedCustody : ensureArray(job.custodyEvents),
      photos: normalizedPhotos.length > 0 ? normalizedPhotos : ensureArray(job.photos),
    };
  } catch (error) {
    console.log('Could not enrich job from normalized tables:', error.message);
    return job;
  }
};

const addCustodyEvent = (job, type, detailerName, note) => {
  const custodyEvents = ensureArray(job.custodyEvents);
  custodyEvents.push({
    type,
    timestamp: Date.now(),
    detailerName: detailerName || 'Unknown',
    note: note || '',
  });
  job.custodyEvents = custodyEvents;
};

// Generate unique device ID
export const getDeviceId = async () => {
  let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  return deviceId;
};

// Store detailer name
export const setDetailerName = async (name) => {
  await AsyncStorage.setItem(STORAGE_KEYS.DETAILER_NAME, name);
};

export const getDetailerName = async () => {
  return await AsyncStorage.getItem(STORAGE_KEYS.DETAILER_NAME);
};

const shouldScopeJobsToCurrentDetailer = async () => {
  const role = (
    (await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_OPERATIONAL_ROLE)) || ''
  ).toLowerCase();
  // Safe default: if role is missing, keep detailer-level scoping.
  if (!role) return true;
  return role === 'detailer';
};

// Pending-write queue: jobs whose server sync failed (e.g. offline) are held
// here and retried on the next sync so an edit is never lost. All additive and
// guarded — an empty queue is a no-op and existing flows are unchanged.
let isReplayingQueue = false;

export const getPendingQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_JOBS);
    return raw ? ensureArray(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

const savePendingQueue = async (queue) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_JOBS, JSON.stringify(ensureArray(queue)));
  } catch (error) {
    console.log('Could not persist pending queue:', error.message);
  }
};

export const enqueuePendingJob = async (job) => {
  if (!job?.jobId) return;
  const queue = await getPendingQueue();
  // De-dupe by jobId, keeping the latest copy of the job.
  const next = queue.filter((j) => j.jobId !== job.jobId);
  next.push(job);
  await savePendingQueue(next);
};

export const replayPendingQueue = async () => {
  const queue = await getPendingQueue();
  if (queue.length === 0) return { replayed: 0, remaining: 0 };

  isReplayingQueue = true;
  const stillPending = [];
  let replayed = 0;
  try {
    for (const job of queue) {
      const ok = await syncJobToServer(job);
      if (ok) replayed += 1;
      else stillPending.push(job);
    }
  } finally {
    isReplayingQueue = false;
  }
  await savePendingQueue(stillPending);
  if (replayed > 0)
    console.log(`[queue] replayed ${replayed}, ${stillPending.length} still pending`);
  return { replayed, remaining: stillPending.length };
};

const runSyncFromServer = async () => {
  try {
    // Retry any writes that failed while offline before pulling remote state.
    await replayPendingQueue();

    const supabaseJobs = await fetchSupabaseJobs();
    if (supabaseJobs) {
      const scopeToCurrentDetailer = await shouldScopeJobsToCurrentDetailer();
      const detailerName = await getDetailerName();
      // Operational detailers currently share ONE Supabase account, so the auth
      // user id identifies the shared account, not the person. Scope a detailer's
      // view by their operational name — otherwise a brand-new detailer sees
      // every job on the account. (Server-side per-user identity, migration 003,
      // will make id-based scoping correct and replace this.)
      const inCurrentScope = (job) => {
        if (!scopeToCurrentDetailer) return true;
        if (!detailerName) return false;
        return job.detailerName === detailerName;
      };

      const roleFilteredJobs = supabaseJobs.filter(inCurrentScope);

      // Merge remote with local under the write lock so an unsynced offline edit
      // is never overwritten and concurrent mutations aren't lost. The device
      // cache may hold jobs outside the current scope (other detailers who used
      // this device); we filter the RETURNED view so callers only ever see the
      // current detailer's jobs.
      const merged = await withJobsLock(async () => {
        const localJobs = await getLocalJobs();
        const next = mergeJobsPreferLocalIfNewer(localJobs, roleFilteredJobs);
        await saveLocalJobs(next);
        return next;
      });
      const scopedView = merged.filter(inCurrentScope);
      console.log(
        `Synced ${roleFilteredJobs.length} in-scope remote jobs; returning ${scopedView.length}`,
      );
      return scopedView;
    }
  } catch (error) {
    console.log('Could not sync from Supabase:', error.message);
  }

  // Return local jobs as final fallback
  return await getLocalJobs();
};

// Sync jobs from server. Concurrent callers share one in-flight request so a
// single screen focus (which calls several getters) doesn't trigger a stampede
// of full table pulls.
let inFlightServerSync = null;
export const syncJobsFromServer = async () => {
  if (inFlightServerSync) return inFlightServerSync;
  inFlightServerSync = runSyncFromServer();
  try {
    return await inFlightServerSync;
  } finally {
    inFlightServerSync = null;
  }
};

// Get all jobs from local storage
export const getLocalJobs = async () => {
  try {
    const jobsJson = await AsyncStorage.getItem(STORAGE_KEYS.JOBS);
    return jobsJson ? JSON.parse(jobsJson) : [];
  } catch (error) {
    console.error('Error getting local jobs:', error);
    return [];
  }
};

// Save jobs to local storage
export const saveLocalJobs = async (jobs) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(jobs));
  } catch (error) {
    console.error('Error saving local jobs:', error);
  }
};

// Serialize local read-modify-write so two concurrent mutations (or a
// background sync racing a user action) cannot clobber each other via
// last-write-wins on the whole jobs array.
let jobsMutex = Promise.resolve();
const withJobsLock = (fn) => {
  const run = jobsMutex.then(fn, fn);
  // Keep the chain alive even if this operation rejects.
  jobsMutex = run.then(
    () => {},
    () => {},
  );
  return run;
};

// Atomically read local jobs, let `mutator(jobs)` mutate the array in place,
// then persist — all under the lock. Network I/O must stay OUTSIDE the mutator
// to avoid holding the lock across slow calls (and to avoid re-entrant locks).
const mutateLocalJobs = async (mutator) =>
  withJobsLock(async () => {
    const jobs = await getLocalJobs();
    const result = await mutator(jobs);
    await saveLocalJobs(jobs);
    return result;
  });

// Find a job in the local cache; if it's missing (e.g. the cache was just
// replaced by a role-filtered remote sync) pull from the server and retry so
// note/photo/pause/resume don't spuriously fail on a job that exists remotely.
const findJobWithRecovery = async (jobId) => {
  const local = await getLocalJobs();
  const found = local.find((j) => j.jobId === jobId);
  if (found) return found;
  const remote = await syncJobsFromServer();
  return remote.find((j) => j.jobId === jobId) || null;
};

// Create new job
export const createJob = async (vehicleData) => {
  const deviceId = await getDeviceId();
  const detailerName = await getDetailerName();
  const now = Date.now();

  // Sanitize all vehicle data inputs
  const sanitizedVehicleData = {
    stockNumber: sanitizeInput(vehicleData.stockNumber),
    year: sanitizeInput(vehicleData.year),
    make: sanitizeInput(vehicleData.make),
    model: sanitizeInput(vehicleData.model),
    color: sanitizeInput(vehicleData.color),
    vin: sanitizeInput(vehicleData.vin),
  };

  const jobId = `job_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const detailers = detailerName ? [detailerName] : [];

  const newJob = {
    jobId,
    deviceId,
    detailerName: detailerName || 'Unknown',
    detailers,
    startTime: now,
    currentDetailerStartTime: now,
    totalPauseTime: 0,
    totalActiveTime: 0,
    status: 'in_progress',
    pauseEvents: [],
    notes: [],
    latestNote: '',
    custodyEvents: [],
    detailerTimeTracking: {},
    createdAt: now,
    updatedAt: now,
    ...sanitizedVehicleData,
  };

  addCustodyEvent(newJob, 'start', detailerName, '');

  await mutateLocalJobs((jobs) => {
    jobs.unshift(newJob);
  });
  // Do not block UI on network sync; persist locally first and sync in background.
  syncJobToServer(newJob)
    .then((ok) => {
      if (!ok) return;
      return insertSupabaseWorkLog({
        job: newJob,
        eventType: 'start',
        actorName: newJob.detailerName,
        eventTimestamp: newJob.startTime,
      });
    })
    .catch((error) => {
      console.log('Background sync failed for createJob:', error?.message || error);
    });
  return newJob;
};

// Get active jobs - syncs from server first
export const getActiveJobs = async () => {
  const jobs = await syncJobsFromServer();
  return jobs.filter((j) => j.status === 'in_progress');
};

// Get completed jobs - syncs from server first
export const getCompletedJobs = async (filterDate = null) => {
  const jobs = await syncJobsFromServer();
  let completed = jobs.filter((j) => j.status === 'completed');

  if (filterDate) {
    completed = completed.filter((j) => {
      const jobDate = new Date(j.createdAt);
      const filterDateObj = new Date(filterDate);
      return jobDate.toDateString() === filterDateObj.toDateString();
    });
  }

  return completed.sort((a, b) => b.createdAt - a.createdAt);
};

// Pause job
export const pauseJob = async (jobId, noteText = '') => {
  const pauseTime = Date.now();
  const detailerName = await getDetailerName();
  const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);

  await findJobWithRecovery(jobId);

  const job = await mutateLocalJobs((jobs) => {
    const target = jobs.find((j) => j.jobId === jobId);
    if (!target || target.status !== 'in_progress') return null;

    // Track current detailer's time before pausing (clamped against clock skew).
    if (!target.detailerTimeTracking) target.detailerTimeTracking = {};
    target.detailerTimeTracking[target.detailerName] = accumulateDetailerTime(
      target.detailerTimeTracking[target.detailerName] || 0,
      target.currentDetailerStartTime || target.startTime,
      pauseTime,
    );

    target.pauseEvents = ensureArray(target.pauseEvents);
    target.pauseEvents.push({
      type: 'pause',
      timestamp: pauseTime,
      detailerName: target.detailerName,
    });
    target.status = 'paused';
    if (sanitizedNote) {
      const notes = ensureArray(target.notes);
      notes.unshift({
        timestamp: pauseTime,
        detailerName: detailerName || 'Unknown',
        text: sanitizedNote,
      });
      target.notes = notes;
      target.latestNote = sanitizedNote;
    }
    target.updatedAt = pauseTime;
    addCustodyEvent(target, 'pause', detailerName, sanitizedNote);
    return target;
  });

  if (!job) return null;

  const synced = await syncJobToServer(job);
  if (synced) {
    try {
      await insertSupabaseWorkLog({
        job,
        eventType: 'pause',
        actorName: detailerName,
        noteText: sanitizedNote,
        eventTimestamp: pauseTime,
      });
    } catch (error) {
      console.log('Could not sync pause work log to Supabase:', error.message);
    }
  }
  return job;
};

// Resume job
export const resumeJob = async (jobId) => {
  const resumeTime = Date.now();
  await findJobWithRecovery(jobId);

  const job = await mutateLocalJobs((jobs) => {
    const target = jobs.find((j) => j.jobId === jobId);
    if (!target || target.status !== 'paused') return null;

    const events = ensureArray(target.pauseEvents);
    const lastPause = events[events.length - 1];
    if (lastPause && lastPause.type === 'pause') {
      target.totalPauseTime =
        Number(target.totalPauseTime || 0) + computePauseDuration(lastPause.timestamp, resumeTime);
    }

    events.push({ type: 'resume', timestamp: resumeTime, detailerName: target.detailerName });
    target.pauseEvents = events;
    target.status = 'in_progress';
    target.currentDetailerStartTime = resumeTime; // Reset start time for current detailer
    target.updatedAt = resumeTime;
    addCustodyEvent(target, 'resume', target.detailerName, '');
    return target;
  });

  if (!job) return null;

  const synced = await syncJobToServer(job);
  if (synced) {
    try {
      await insertSupabaseWorkLog({
        job,
        eventType: 'resume',
        actorName: job.detailerName,
        eventTimestamp: resumeTime,
      });
    } catch (error) {
      console.log('Could not sync resume work log to Supabase:', error.message);
    }
  }
  return job;
};

// Complete job
export const completeJob = async (jobId) => {
  console.log('Completing job:', jobId);
  const endTime = Date.now();

  // Recover from remote before failing, then mutate atomically under the lock.
  const recovered = await findJobWithRecovery(jobId);
  if (!recovered) {
    console.error('Job not found:', jobId);
    throw new Error('Job not found');
  }

  const job = await mutateLocalJobs((jobs) => {
    const target = jobs.find((j) => j.jobId === jobId);
    if (!target) return null;

    // If job was paused, fold in the final pause span (clamped).
    if (target.status === 'paused') {
      const events = ensureArray(target.pauseEvents);
      const lastPause = events[events.length - 1];
      if (lastPause && lastPause.type === 'pause') {
        target.totalPauseTime =
          Number(target.totalPauseTime || 0) + computePauseDuration(lastPause.timestamp, endTime);
      }
    }

    // Track final detailer's time (clamped against clock skew).
    if (!target.detailerTimeTracking) target.detailerTimeTracking = {};
    target.detailerTimeTracking[target.detailerName] = accumulateDetailerTime(
      target.detailerTimeTracking[target.detailerName] || 0,
      target.currentDetailerStartTime || target.startTime,
      endTime,
    );

    target.endTime = endTime;
    target.totalActiveTime = computeActiveTime(target.startTime, endTime, target.totalPauseTime);
    target.status = 'completed';
    target.updatedAt = endTime;
    addCustodyEvent(target, 'complete', target.detailerName, '');
    return target;
  });

  if (!job) throw new Error('Job not found');

  const synced = await syncJobToServer(job);
  if (synced) {
    try {
      await insertSupabaseWorkLog({
        job,
        eventType: 'complete',
        actorName: job.detailerName,
        eventTimestamp: endTime,
      });
    } catch (error) {
      console.log('Could not sync complete work log to Supabase:', error.message);
    }
  }
  console.log('Job completed successfully');
  return job;
};

// Add a note to an in-progress job
export const addJobNote = async (jobId, noteText) => {
  const detailerName = await getDetailerName();
  const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);

  if (!sanitizedNote) {
    throw new Error('Note cannot be empty');
  }

  const existing = await findJobWithRecovery(jobId);
  if (!existing) {
    throw new Error('Job not found');
  }
  if (existing.status === 'completed') {
    throw new Error('Cannot add notes to a completed job');
  }

  const noteTimestamp = Date.now();
  const job = await mutateLocalJobs((jobs) => {
    const target = jobs.find((j) => j.jobId === jobId);
    if (!target || target.status === 'completed') return null;
    const notes = ensureArray(target.notes);
    notes.unshift({
      timestamp: noteTimestamp,
      detailerName: detailerName || 'Unknown',
      text: sanitizedNote,
    });
    target.notes = notes;
    target.latestNote = sanitizedNote;
    target.updatedAt = noteTimestamp;
    return target;
  });

  if (!job) {
    throw new Error('Cannot add notes to a completed job');
  }

  const synced = await syncJobToServer(job);
  if (synced) {
    try {
      await insertSupabaseNote({
        job,
        detailerName,
        noteText: sanitizedNote,
        noteTimestamp,
      });
    } catch (error) {
      console.log('Could not sync note row to Supabase:', error.message);
    }
  }
  return job;
};

// Add a photo to a job (stored on server)
export const addJobPhoto = async (jobId, image) => {
  const existing = await findJobWithRecovery(jobId);
  if (!existing) {
    throw new Error('Job not found');
  }
  if (existing.status === 'completed') {
    throw new Error('Cannot add photos to a completed job');
  }

  const context = await getSupabaseSyncContext();
  const synced = await syncJobToServer(existing);
  if (!synced) {
    throw new Error('Could not sync job before photo upload');
  }

  const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, existing.jobId);
  if (!remoteJobId) {
    throw new Error('Remote job not found for photo upload');
  }

  const mimeType = image.mimeType || 'image/jpeg';
  const base64 = image.base64 || (image.dataUrl ? String(image.dataUrl).split(',')[1] : null);
  if (!base64) {
    throw new Error('Image data missing');
  }

  const extension = getFileExtensionFromMime(mimeType);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const storagePath = `${context.dealershipId}/${remoteJobId}/${fileName}`;
  const blob = await base64ToBlob(base64, mimeType);

  const { error: uploadError } = await supabase.storage
    .from('job-photos')
    .upload(storagePath, blob, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const detailerName = await getDetailerName();
  const timestamp = Date.now();
  const note = sanitizeInput(image.note || '').slice(0, 500);

  // Persist the metadata row FIRST. If it fails, delete the orphaned storage
  // object and surface the error — otherwise the object leaks and the photo
  // disappears once its short-lived signed URL expires (there'd be no row for
  // enrichJobFromNormalizedTables to re-sign from).
  const { error: photoRowError } = await supabase.from('job_photos').insert({
    job_id: remoteJobId,
    dealership_id: context.dealershipId,
    uploaded_by_user_id: context.userId,
    uploaded_by_name: detailerName || 'Unknown',
    storage_path: storagePath,
    photo_type: image.photoType || null,
    created_at: toIsoOrNull(timestamp) || new Date().toISOString(),
    metadata: {
      mimeType,
      note,
      source: 'mobile',
      legacy_job_id: existing.jobId,
    },
  });

  if (photoRowError) {
    await supabase.storage
      .from('job-photos')
      .remove([storagePath])
      .catch(() => {});
    throw new Error('Could not save photo record: ' + photoRowError.message);
  }

  const { data: signedData } = await supabase.storage
    .from('job-photos')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  const photo = {
    url: signedData?.signedUrl || '',
    timestamp,
    detailerName: detailerName || 'Unknown',
    note,
    storagePath,
  };

  const job = await mutateLocalJobs((jobs) => {
    const target = jobs.find((j) => j.jobId === jobId);
    if (!target) return null;
    target.photos = [photo, ...ensureArray(target.photos)];
    target.updatedAt = timestamp;
    return target;
  });

  if (job) {
    await syncJobToServer(job);
  }

  return { job: job || existing };
};

// Sync single job to server
export const syncJobToServer = async (job) => {
  try {
    const context = await getSupabaseSyncContext();
    const row = mapLegacyJobToSupabaseRow(job, context);

    const { data: existing, error: lookupError } = await supabase
      .from('jobs')
      .select('id, client_updated_at')
      .eq('dealership_id', context.dealershipId)
      .eq('legacy_job_id', row.legacy_job_id)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing?.id) {
      if (isRemoteNewer(existing.client_updated_at, job.updatedAt)) {
        console.log(`[sync] skipped stale local update for ${job.jobId}`);
        return true;
      }

      const { error: updateError } = await supabase
        .from('jobs')
        .update(row)
        .eq('id', existing.id)
        .eq('dealership_id', context.dealershipId);

      if (updateError) throw updateError;
      console.log(`[sync] updated job ${job.jobId}`);
      return true;
    }

    const { error: insertError } = await supabase.from('jobs').insert(row);

    if (insertError) throw insertError;
    console.log(`[sync] inserted job ${job.jobId}`);
    return true;
  } catch (error) {
    // Postgres unique_violation (e.g. one-active-job-per-stock) will never
    // succeed on retry — don't poison the pending queue with an endless retry.
    const isPermanentConflict = error?.code === '23505';
    console.log(
      `[sync] failed for ${job?.jobId || 'unknown'}:`,
      error.message,
      isPermanentConflict ? '(permanent conflict; not retrying)' : '',
    );
    // Queue for retry on next sync — unless we're already draining the queue
    // (replayPendingQueue tracks that itself) or the failure is permanent.
    if (!isReplayingQueue && !isPermanentConflict) {
      await enqueuePendingJob(job);
    }
    return false;
  }
};

// Sync all local jobs to server
export const syncAllJobs = async () => {
  try {
    await getSupabaseSyncContext();
    const jobs = await getLocalJobs();
    if (jobs.length === 0) return { success: true, synced: 0 };

    let synced = 0;
    for (const job of jobs) {
      const ok = await syncJobToServer(job);
      if (ok) synced += 1;
    }
    return {
      success: synced === jobs.length,
      synced,
      processed: jobs.length,
      skipped: jobs.length - synced,
    };
  } catch (error) {
    console.log('Could not sync all jobs to Supabase:', error.message);
    return { success: false, synced: 0, error: error.message };
  }
};

// Check server connection
export const checkServerConnection = async () => {
  try {
    const context = await getSupabaseSyncContext();
    const { error } = await supabase
      .from('dealership_memberships')
      .select('id')
      .eq('dealership_id', context.dealershipId)
      .limit(1);
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
};

// Get all jobs (for history) - syncs from server first
export const getAllJobs = async () => {
  const jobs = await syncJobsFromServer();
  // Sort by most recent first
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
};

// Get job by ID
export const getJobById = async (jobId) => {
  const localJobs = await getLocalJobs();
  const localMatch = localJobs.find((j) => j.jobId === jobId);
  if (localMatch) {
    // Keep this view snappy; sync in background but return local immediately.
    syncJobsFromServer().catch((error) => {
      console.log('Background sync failed in getJobById:', error?.message || error);
    });
    return await enrichJobFromNormalizedTables(localMatch);
  }

  const jobs = await syncJobsFromServer();
  const match = jobs.find((j) => j.jobId === jobId);
  if (!match) return null;
  return await enrichJobFromNormalizedTables(match);
};

// Get today's stats - syncs from server first
export const getOverallStats = async () => {
  const jobs = await syncJobsFromServer();

  const completed = jobs.filter((j) => j.status === 'completed');
  const inProgress = jobs.filter((j) => j.status === 'in_progress' || j.status === 'paused');

  const totalTime = completed.reduce((sum, j) => sum + (j.totalActiveTime || 0), 0);
  const avgTime = completed.length > 0 ? totalTime / completed.length : 0;

  return {
    total: jobs.length,
    completed: completed.length,
    inProgress: inProgress.length,
    avgTime,
    totalTime,
  };
};
