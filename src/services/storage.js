import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Sanitize input to prevent XSS and injection attacks
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

const STORAGE_KEYS = {
  JOBS: '@detailtracker_jobs',
  DEVICE_ID: '@detailtracker_device_id',
  DETAILER_NAME: '@detailtracker_detailer_name',
  ACTIVE_DEALERSHIP_ID: '@detailtracker_active_dealership_id',
  ACTIVE_OPERATIONAL_ROLE: '@detailtracker_active_operational_role',
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
      ].join(',')
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

const signedUrlFromStoragePath = async (storagePath, expiresInSeconds = 60 * 60 * 24 * 30) => {
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

  const { error } = await supabase
    .from('job_notes')
    .insert({
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

const insertSupabaseWorkLog = async ({ job, eventType, actorName, noteText = '', eventTimestamp = Date.now() }) => {
  const context = await getSupabaseSyncContext();
  const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, job.jobId);
  if (!remoteJobId) return false;

  const { error } = await supabase
    .from('job_work_logs')
    .insert({
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
      custodyEvents: normalizedCustody.length > 0 ? normalizedCustody : ensureArray(job.custodyEvents),
      photos: normalizedPhotos.length > 0 ? normalizedPhotos : ensureArray(job.photos),
    };
  } catch (error) {
    console.log('Could not enrich job from normalized tables:', error.message);
    return job;
  }
};

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
  const role = (await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_OPERATIONAL_ROLE) || '').toLowerCase();
  // Safe default: if role is missing, keep detailer-level scoping.
  if (!role) return true;
  return role === 'detailer';
};

// Sync jobs from server
export const syncJobsFromServer = async () => {
  try {
    const supabaseJobs = await fetchSupabaseJobs();
    if (supabaseJobs) {
      const scopeToCurrentDetailer = await shouldScopeJobsToCurrentDetailer();
      const detailerName = await getDetailerName();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id || null;
      const roleFilteredJobs = scopeToCurrentDetailer
        ? supabaseJobs.filter((job) => {
            if (currentUserId && (job.assignedDetailerId === currentUserId || job.createdByUserId === currentUserId)) {
              return true;
            }
            return !!detailerName && job.detailerName === detailerName;
          })
        : supabaseJobs;

      // Supabase is authoritative when online/signed-in for this tenant/role scope.
      // This prevents stale local rows from appearing when they do not exist remotely.
      await saveLocalJobs(roleFilteredJobs);
      console.log(`Synced ${roleFilteredJobs.length} jobs from Supabase`);
      return roleFilteredJobs;
    }
  } catch (error) {
    console.log('Could not sync from Supabase:', error.message);
  }

  // Return local jobs as final fallback
  return await getLocalJobs();
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

// Create new job
export const createJob = async (vehicleData) => {
  const deviceId = await getDeviceId();
  const detailerName = await getDetailerName();
  const now = Date.now();
  
  // Sanitize all vehicle data inputs
  const sanitizedVehicleData = {
    stockNumber: sanitizeInput(vehicleData.stockNumber),
    make: sanitizeInput(vehicleData.make),
    model: sanitizeInput(vehicleData.model),
    year: sanitizeInput(vehicleData.year),
    color: sanitizeInput(vehicleData.color),
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

  const jobs = await getLocalJobs();
  jobs.unshift(newJob);
  await saveLocalJobs(jobs);
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
  return jobs.filter(j => j.status === 'in_progress');
};

// Get completed jobs - syncs from server first
export const getCompletedJobs = async (filterDate = null) => {
  const jobs = await syncJobsFromServer();
  let completed = jobs.filter(j => j.status === 'completed');
  
  if (filterDate) {
    completed = completed.filter(j => {
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
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);
  
  if (job && job.status === 'in_progress') {
    // Track current detailer's time before pausing
    if (!job.detailerTimeTracking) job.detailerTimeTracking = {};
    const detailerTime = job.detailerTimeTracking[job.detailerName] || 0;
    const sessionTime = pauseTime - (job.currentDetailerStartTime || job.startTime);
    job.detailerTimeTracking[job.detailerName] = detailerTime + sessionTime;
    
    job.pauseEvents.push({ 
      type: 'pause', 
      timestamp: pauseTime,
      detailerName: job.detailerName 
    });
    job.status = 'paused';
    const detailerName = await getDetailerName();
    const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);
    if (sanitizedNote) {
      const notes = ensureArray(job.notes);
      notes.unshift({
        timestamp: Date.now(),
        detailerName: detailerName || 'Unknown',
        text: sanitizedNote,
      });
      job.notes = notes;
      job.latestNote = sanitizedNote;
    }
    job.updatedAt = pauseTime;
    addCustodyEvent(job, 'pause', detailerName, sanitizedNote);
    await saveLocalJobs(jobs);
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
  }
  
  return null;
};

// Resume job
export const resumeJob = async (jobId) => {
  const resumeTime = Date.now();
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);
  
  if (job && job.status === 'paused') {
    const lastPause = job.pauseEvents[job.pauseEvents.length - 1];
    if (lastPause && lastPause.type === 'pause') {
      const pauseDuration = resumeTime - lastPause.timestamp;
      job.totalPauseTime += pauseDuration;
    }
    
    job.pauseEvents.push({ 
      type: 'resume', 
      timestamp: resumeTime,
      detailerName: job.detailerName 
    });
    job.status = 'in_progress';
    job.currentDetailerStartTime = resumeTime; // Reset start time for current detailer
    job.updatedAt = resumeTime;
    addCustodyEvent(job, 'resume', job.detailerName, '');
    await saveLocalJobs(jobs);
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
  }
  
  return null;
};

// Complete job
export const completeJob = async (jobId) => {
  console.log('Completing job:', jobId);
  const endTime = Date.now();
  const jobs = await getLocalJobs();
  let job = jobs.find(j => j.jobId === jobId);
  let workingJobs = jobs;
  
  if (!job) {
    // Local cache may have been refreshed from remote; recover before failing.
    const remoteJobs = await syncJobsFromServer();
    job = remoteJobs.find(j => j.jobId === jobId);
    if (!job) {
      console.error('Job not found:', jobId);
      throw new Error('Job not found');
    }
    workingJobs = remoteJobs;
  }
  
  console.log('Found job:', job);
  
  // If job was paused, calculate final pause time
  if (job.status === 'paused') {
    const lastPause = job.pauseEvents[job.pauseEvents.length - 1];
    if (lastPause && lastPause.type === 'pause') {
      const pauseDuration = endTime - lastPause.timestamp;
      job.totalPauseTime += pauseDuration;
    }
  }
  
  // Track final detailer's time
  if (!job.detailerTimeTracking) job.detailerTimeTracking = {};
  const detailerTime = job.detailerTimeTracking[job.detailerName] || 0;
  const sessionTime = endTime - (job.currentDetailerStartTime || job.startTime);
  job.detailerTimeTracking[job.detailerName] = detailerTime + sessionTime;
  
  job.endTime = endTime;
  job.totalActiveTime = endTime - job.startTime - job.totalPauseTime;
  job.status = 'completed';
  job.updatedAt = endTime;
  addCustodyEvent(job, 'complete', job.detailerName, '');
  
  console.log('Saving completed job:', job);
  console.log('Detailer time breakdown:', job.detailerTimeTracking);
  await saveLocalJobs(workingJobs);
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
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status === 'completed') {
    throw new Error('Cannot add notes to a completed job');
  }

  const detailerName = await getDetailerName();
  const sanitizedNote = sanitizeInput(noteText || '').slice(0, 500);

  if (!sanitizedNote) {
    throw new Error('Note cannot be empty');
  }

  const notes = ensureArray(job.notes);
  const noteTimestamp = Date.now();
  notes.unshift({
    timestamp: noteTimestamp,
    detailerName: detailerName || 'Unknown',
    text: sanitizedNote,
  });

  job.notes = notes;
  job.latestNote = sanitizedNote;
  job.updatedAt = noteTimestamp;

  await saveLocalJobs(jobs);
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
  const jobs = await getLocalJobs();
  const job = jobs.find(j => j.jobId === jobId);

  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status === 'completed') {
    throw new Error('Cannot add photos to a completed job');
  }

  const context = await getSupabaseSyncContext();
  const synced = await syncJobToServer(job);
  if (!synced) {
    throw new Error('Could not sync job before photo upload');
  }

  const remoteJobId = await getRemoteJobIdByLegacyId(context.dealershipId, job.jobId);
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

  const { data: signedData, error: signedError } = await supabase.storage
    .from('job-photos')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

  if (signedError) {
    throw signedError;
  }

  const detailerName = await getDetailerName();
  const timestamp = Date.now();
  const photo = {
    url: signedData?.signedUrl || '',
    timestamp,
    detailerName: detailerName || 'Unknown',
    note: sanitizeInput(image.note || '').slice(0, 500),
    storagePath,
  };

  const photos = ensureArray(job.photos);
  photos.unshift(photo);
  job.photos = photos;
  job.updatedAt = timestamp;

  await saveLocalJobs(jobs);
  await syncJobToServer(job);

  const { error: photoRowError } = await supabase
    .from('job_photos')
    .insert({
      job_id: remoteJobId,
      dealership_id: context.dealershipId,
      uploaded_by_user_id: context.userId,
      uploaded_by_name: detailerName || 'Unknown',
      storage_path: storagePath,
      photo_type: image.photoType || null,
      created_at: toIsoOrNull(timestamp) || new Date().toISOString(),
      metadata: {
        mimeType,
        note: photo.note || '',
        source: 'mobile',
        legacy_job_id: job.jobId,
      },
    });

  if (photoRowError) {
    console.log('Could not insert job_photos row:', photoRowError.message);
  }

  return { job };
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

    const { error: insertError } = await supabase
      .from('jobs')
      .insert(row);

    if (insertError) throw insertError;
    console.log(`[sync] inserted job ${job.jobId}`);
    return true;
  } catch (error) {
    console.log(`[sync] failed for ${job?.jobId || 'unknown'}:`, error.message);
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
      // eslint-disable-next-line no-await-in-loop
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
  } catch (error) {
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
  const localMatch = localJobs.find(j => j.jobId === jobId);
  if (localMatch) {
    // Keep this view snappy; sync in background but return local immediately.
    syncJobsFromServer().catch((error) => {
      console.log('Background sync failed in getJobById:', error?.message || error);
    });
    return await enrichJobFromNormalizedTables(localMatch);
  }

  const jobs = await syncJobsFromServer();
  const match = jobs.find(j => j.jobId === jobId);
  if (!match) return null;
  return await enrichJobFromNormalizedTables(match);
};

// Get today's stats - syncs from server first
export const getOverallStats = async () => {
  const jobs = await syncJobsFromServer();

  const completed = jobs.filter(j => j.status === 'completed');
  const inProgress = jobs.filter(j => j.status === 'in_progress' || j.status === 'paused');

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
