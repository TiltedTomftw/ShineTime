// Job reads and actions for the screens.
//
// Supabase is the source of truth: every list and job screen reads from it.
// The phone keeps no job list of its own — only the outbox of unsent actions
// (outbox.js), which is overlaid on what Supabase returns so a detailer always
// sees their latest taps, even before they've been sent.
//
// A small in-memory cache (never written to the phone) keeps screens usable if
// the signal drops mid-shift; it's cleared on sign-out and on app restart.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import {
  OPEN_STATUSES,
  applyJobAction,
  applyPendingActions,
  mapSupabaseJobToLegacyShape,
  toJobRow,
  isTransientError,
} from './jobLogic';
import { startOfDay } from './timeMath';
import { outbox, flushOutbox } from './outbox';
import { getSessionContext, requireSessionContext } from './session';

const DEVICE_ID_KEY = '@detailtracker_device_id';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_PHOTO_EDGE = 1600;

const memory = { open: null, jobs: new Map() };
export const clearJobsMemory = () => {
  memory.open = null;
  memory.jobs.clear();
};

const randomId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

let deviceIdPromise = null;
const getDeviceId = () => {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = randomId('device');
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    })();
  }
  return deviceIdPromise;
};

const actor = () => {
  const ctx = requireSessionContext();
  return { id: ctx.userId, name: ctx.userName || 'Unknown' };
};

// --- Overlaying unsent actions ------------------------------------------------

const pendingActionsFor = (jobId) =>
  outbox
    .pendingFor(jobId)
    .filter((e) => e.type !== 'photo')
    .map((e) => e.action);

const withPending = (job, jobId) => {
  const id = jobId || job?.jobId;
  const entries = outbox.pendingFor(id);
  if (entries.length === 0) return job ? { ...job, pendingCount: 0 } : null;
  const merged = applyPendingActions(job, pendingActionsFor(id));
  return merged ? { ...merged, pendingCount: entries.length } : null;
};

// Jobs created on this phone that haven't reached Supabase yet.
const outboxOnlyJobs = (knownIds) => {
  const ids = new Set();
  for (const entry of outbox.getState().entries) {
    if (entry.type === 'create' && !knownIds.has(entry.jobId)) ids.add(entry.jobId);
  }
  return Array.from(ids)
    .map((id) => withPending(null, id))
    .filter(Boolean);
};

// --- Reads --------------------------------------------------------------------

const LIST_COLUMNS =
  'id, legacy_job_id, status, stock_number, year, make, model, color, vin, started_at, ended_at, total_pause_ms, total_active_ms, created_at, client_updated_at, assigned_detailer_id, payload';

const mineFilter = (query, userId) =>
  query.or(`assigned_detailer_id.eq.${userId},payload->>operationalUserId.eq.${userId}`);

// The app only ever shows the signed-in person's own cars, managers included:
// every manager tool (oversight, rework, team) lives on the web dashboard.

// My open jobs (running, paused, sent back for rework).
export const fetchOpenJobs = async () => {
  const ctx = requireSessionContext();
  try {
    let query = supabase
      .from('jobs')
      .select(LIST_COLUMNS)
      .eq('dealership_id', ctx.dealershipId)
      .is('deleted_at', null)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(100);
    query = mineFilter(query, ctx.userId);
    const { data, error } = await query;
    if (error) throw error;
    const jobs = (data || []).map(mapSupabaseJobToLegacyShape);
    memory.open = jobs;
    jobs.forEach((j) => memory.jobs.set(j.jobId, j));
    return { jobs: overlayOpen(jobs), offline: false };
  } catch (error) {
    if (!isTransientError(error)) throw error;
    return { jobs: overlayOpen(memory.open || []), offline: true };
  }
};

const overlayOpen = (jobs) => {
  const known = new Set(jobs.map((j) => j.jobId));
  return outboxOnlyJobs(known)
    .concat(jobs.map((j) => withPending(j)))
    .filter((j) => j && OPEN_STATUSES.includes(j.status));
};

// My completed cars today: count, total and average active time.
export const fetchTodayStats = async () => {
  const ctx = requireSessionContext();
  let query = supabase
    .from('jobs')
    .select('total_active_ms')
    .eq('dealership_id', ctx.dealershipId)
    .is('deleted_at', null)
    .eq('status', 'completed')
    .gte('ended_at', new Date(startOfDay(Date.now())).toISOString());
  query = mineFilter(query, ctx.userId);
  const { data, error } = await query;
  if (error) throw error;
  const times = (data || []).map((r) => Number(r.total_active_ms) || 0);
  const total = times.reduce((a, b) => a + b, 0);
  return {
    completed: times.length,
    totalMs: total,
    avgMs: times.length ? total / times.length : 0,
  };
};

const HISTORY_COLUMNS =
  'id, legacy_job_id, status, stock_number, year, make, model, color, started_at, ended_at, total_active_ms, total_pause_ms, created_at, detailerName:payload->>detailerName';

// One page of job history, newest first. `cursor` is the created_at of the
// last row already shown; `search` matches stock number, make or model.
export const fetchHistory = async ({ search = '', cursor = null, limit = 30 } = {}) => {
  const ctx = requireSessionContext();
  let query = supabase
    .from('jobs')
    .select(HISTORY_COLUMNS)
    .eq('dealership_id', ctx.dealershipId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  query = mineFilter(query, ctx.userId);
  if (cursor) query = query.lt('created_at', cursor);
  const term = search.replace(/[^a-zA-Z0-9 -]/g, '').trim();
  if (term) {
    query = query.or(`stock_number.ilike.*${term}*,make.ilike.*${term}*,model.ilike.*${term}*`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    jobId: r.legacy_job_id || r.id,
    status: r.status,
    stockNumber: r.stock_number,
    year: r.year,
    make: r.make,
    model: r.model,
    color: r.color,
    detailerName: r.detailerName || 'Unknown',
    startTime: Date.parse(r.started_at || r.created_at),
    endTime: r.ended_at ? Date.parse(r.ended_at) : null,
    totalActiveTime: Number(r.total_active_ms) || 0,
    createdAtIso: r.created_at,
  }));
  return {
    jobs: rows,
    nextCursor: rows.length === limit ? data[data.length - 1].created_at : null,
  };
};

// A job with fresh photo links. Falls back to the in-memory copy if offline.
export const fetchJob = async (jobId) => {
  const ctx = requireSessionContext();
  let job = null;
  let photos = [];
  let offline = false;
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select(LIST_COLUMNS)
      .eq('dealership_id', ctx.dealershipId)
      .eq('legacy_job_id', jobId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      job = mapSupabaseJobToLegacyShape(data);
      memory.jobs.set(jobId, job);
      photos = await fetchPhotos(ctx.dealershipId, data.id);
    }
  } catch (error) {
    if (!isTransientError(error)) throw error;
    offline = true;
    job = memory.jobs.get(jobId) || null;
  }
  const merged = withPending(job, jobId);
  return { job: merged, photos: photos.concat(pendingPhotos(jobId)), offline };
};

const fetchPhotos = async (dealershipId, remoteJobId) => {
  const { data, error } = await supabase
    .from('job_photos')
    .select('storage_path, uploaded_by_name, created_at')
    .eq('dealership_id', dealershipId)
    .eq('job_id', remoteJobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return [];
  // One request for every link instead of one per photo.
  const { data: signed } = await supabase.storage.from('job-photos').createSignedUrls(
    rows.map((r) => r.storage_path),
    SIGNED_URL_TTL_SECONDS,
  );
  const urlFor = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
  return rows
    .map((r) => ({
      key: r.storage_path,
      url: urlFor.get(r.storage_path) || '',
      timestamp: Date.parse(r.created_at),
      detailerName: r.uploaded_by_name || 'Unknown',
      pending: false,
    }))
    .filter((p) => p.url);
};

const pendingPhotos = (jobId) =>
  outbox
    .pendingFor(jobId)
    .filter((e) => e.type === 'photo')
    .map((e) => ({
      key: e.id,
      url: e.fileUri || `data:${e.mimeType || 'image/jpeg'};base64,${e.base64}`,
      timestamp: e.action.at,
      detailerName: e.action.actor?.name || 'Unknown',
      pending: true,
    }));

// Is this stock number already open (on the server or waiting in the outbox)?
export const findOpenJobByStock = async (stockNumber) => {
  const ctx = requireSessionContext();
  const stock = (stockNumber || '').trim().toUpperCase();
  if (!stock) return null;
  for (const entry of outbox.getState().entries) {
    if (entry.type === 'create' && entry.stockNumber === stock) {
      return { jobId: entry.jobId, detailerName: entry.action.actor?.name, status: 'in_progress' };
    }
  }
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('legacy_job_id, status, detailerName:payload->>detailerName')
      .eq('dealership_id', ctx.dealershipId)
      .eq('stock_number', stock)
      .is('deleted_at', null)
      .in('status', OPEN_STATUSES)
      .limit(1);
    if (error) throw error;
    const row = data && data[0];
    return row
      ? { jobId: row.legacy_job_id, detailerName: row.detailerName, status: row.status }
      : null;
  } catch {
    return null; // can't check offline; the server still enforces it on send
  }
};

// --- Actions --------------------------------------------------------------------

const newAction = (type, jobId, data) => ({
  id: randomId('act'),
  type,
  jobId,
  at: Date.now(),
  actor: actor(),
  data: data || {},
});

const enqueueAndSend = async (entry) => {
  await outbox.enqueue(entry);
  flushOutbox().catch(() => {});
};

export const createJob = async (vehicle) => {
  const ctx = requireSessionContext();
  const jobId = randomId('job');
  const action = newAction('create', jobId, { ...vehicle, deviceId: await getDeviceId() });
  const job = applyJobAction(null, action);
  await enqueueAndSend({
    type: 'create',
    jobId,
    dealershipId: ctx.dealershipId,
    stockNumber: job.stockNumber,
    action,
  });
  memory.jobs.set(jobId, job);
  return job;
};

// pause | resume | complete | note. Applies locally first (throws a friendly
// JobActionError if it doesn't fit), then queues it to send right away.
export const performJobAction = async (job, type, data) => {
  const ctx = requireSessionContext();
  const action = newAction(type, job.jobId, data);
  const next = applyJobAction(job, action);
  await enqueueAndSend({
    type,
    jobId: job.jobId,
    dealershipId: ctx.dealershipId,
    stockNumber: job.stockNumber,
    action,
  });
  return { ...next, pendingCount: (job.pendingCount || 0) + 1 };
};

// Shrink a camera image to at most 1600px on its long edge. Full-resolution
// photos are several MB of base64 — slow on cell data and in OCR.
export const prepareImage = async (asset) => {
  const longEdge = Math.max(asset.width || 0, asset.height || 0);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_PHOTO_EDGE) {
    context.resize(
      (asset.width || 0) >= (asset.height || 0)
        ? { width: MAX_PHOTO_EDGE }
        : { height: MAX_PHOTO_EDGE },
    );
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  return { uri: result.uri, base64: result.base64, mimeType: 'image/jpeg' };
};

// Keep the photo in the app's private storage (never the camera roll) until
// it uploads; the outbox deletes the file once Supabase confirms it.
export const addJobPhoto = async (job, asset) => {
  const ctx = requireSessionContext();
  const image = await prepareImage(asset);
  const action = newAction('photo', job.jobId);
  const entry = {
    type: 'photo',
    jobId: job.jobId,
    dealershipId: ctx.dealershipId,
    stockNumber: job.stockNumber,
    mimeType: image.mimeType,
    action,
  };
  if (Platform.OS === 'web') {
    entry.base64 = image.base64;
  } else {
    const dir = new Directory(Paths.document, 'outbox');
    dir.create({ idempotent: true, intermediates: true });
    const target = new File(dir, `${action.id}.jpg`);
    new File(image.uri).copy(target);
    entry.fileUri = target.uri;
  }
  await enqueueAndSend(entry);
};

// --- One-time cleanup of the old on-phone job cache -----------------------------

const LEGACY_KEYS = {
  JOBS: '@detailtracker_jobs',
  PENDING: '@detailtracker_pending_jobs',
  OTHER: [
    '@detailtracker_detailer_name',
    '@detailtracker_active_operational_role',
    '@detailtracker_active_operational_user_id',
  ],
};

const normalizeLegacyStatus = (status) =>
  ['in_progress', 'paused', 'completed', 'needs_rework', 'cancelled', 'queued'].includes(status)
    ? status
    : 'queued';

// Older versions kept every job on the phone. Send anything that never
// reached Supabase (only this person's own jobs, so nothing can land in the
// wrong account or dealership), then delete the old copies for good.
export const migrateLegacyStorage = async () => {
  const ctx = getSessionContext();
  if (!ctx.userId || !ctx.dealershipId) return;
  const [rawJobs, rawPending] = await Promise.all([
    AsyncStorage.getItem(LEGACY_KEYS.JOBS),
    AsyncStorage.getItem(LEGACY_KEYS.PENDING),
  ]);
  if (!rawJobs && !rawPending) {
    await AsyncStorage.multiRemove(LEGACY_KEYS.OTHER);
    return;
  }

  const parse = (raw) => {
    try {
      const v = JSON.parse(raw || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const unsent = new Map();
  for (const job of parse(rawJobs))
    if (job && job.jobId && !job.syncedAt) unsent.set(job.jobId, job);
  for (const job of parse(rawPending)) if (job && job.jobId) unsent.set(job.jobId, job);

  for (const job of unsent.values()) {
    if (job.operationalUserId !== ctx.userId) continue; // someone else's or pre-accounts data
    try {
      const { photos, ...payload } = job; // old photo URLs expire; job_photos holds the real records
      payload.status = normalizeLegacyStatus(payload.status);
      payload.assignedDetailerId = payload.assignedDetailerId || ctx.userId;
      payload.createdByUserId = payload.createdByUserId || ctx.userId;
      const { data: existing, error } = await supabase
        .from('jobs')
        .select('id, client_updated_at')
        .eq('dealership_id', ctx.dealershipId)
        .eq('legacy_job_id', job.jobId)
        .maybeSingle();
      if (error) throw error;
      const row = toJobRow(payload, ctx.dealershipId);
      if (!existing) {
        const { error: insertError } = await supabase.from('jobs').insert(row);
        if (insertError) throw insertError;
      } else if (Date.parse(existing.client_updated_at) < Number(payload.updatedAt || 0)) {
        delete row.dealership_id;
        delete row.legacy_job_id;
        const { error: updateError } = await supabase
          .from('jobs')
          .update(row)
          .eq('id', existing.id);
        if (updateError) throw updateError;
      }
    } catch (error) {
      if (isTransientError(error)) return; // offline: keep the old data and try next launch
      // A permanent rejection (e.g. duplicate stock) can never be sent; drop it.
    }
  }
  await AsyncStorage.multiRemove([LEGACY_KEYS.JOBS, LEGACY_KEYS.PENDING, ...LEGACY_KEYS.OTHER]);
};
