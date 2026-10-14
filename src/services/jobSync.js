// Sends one outbox entry to Supabase. Called only by the outbox, which deletes
// the entry from the phone the moment this resolves.
//
// Every write re-reads the job from Supabase and applies the action to that
// fresh copy (see applyJobAction), then saves with an optimistic-concurrency
// check, so a manager's dashboard change and a detailer's tap can't overwrite
// each other.

import { File } from 'expo-file-system';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { applyJobAction, mapSupabaseJobToLegacyShape, toJobRow, JobActionError } from './jobLogic';

const ROW_COLUMNS =
  'id, legacy_job_id, status, client_updated_at, created_by_user_id, assigned_detailer_id, payload';

export const fetchJobRow = async (dealershipId, jobId) => {
  const { data, error } = await supabase
    .from('jobs')
    .select(ROW_COLUMNS)
    .eq('dealership_id', dealershipId)
    .eq('legacy_job_id', jobId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const iso = (ms) => new Date(Number(ms) || Date.now()).toISOString();

// Patch for an existing row. Never blank out who created/is assigned the job
// when an older payload simply doesn't carry those ids.
const updatePatch = (job, dealershipId) => {
  const row = toJobRow(job, dealershipId);
  delete row.dealership_id;
  delete row.legacy_job_id;
  if (!row.created_by_user_id) delete row.created_by_user_id;
  if (!row.assigned_detailer_id) delete row.assigned_detailer_id;
  return row;
};

// Audit trail rows. Screens read the job payload; these are an append-only
// server-side record, so a failure here never fails the action itself.
const recordAudit = async (entry, rowId) => {
  const { action } = entry;
  const actorName = action.actor?.name || 'Unknown';
  try {
    if (action.type === 'note') {
      await supabase.from('job_notes').insert({
        job_id: rowId,
        dealership_id: entry.dealershipId,
        author_user_id: action.actor?.id || null,
        author_name: actorName,
        note: action.data?.text || '',
        created_at: iso(action.at),
        metadata: { source: 'mobile', legacy_job_id: entry.jobId, action_id: action.id },
      });
      return;
    }
    const eventType = action.type === 'create' ? 'start' : action.type;
    if (!['start', 'pause', 'resume', 'complete'].includes(eventType)) return;
    const note = [action.data?.reason, action.data?.note].filter(Boolean).join(' — ');
    await supabase.from('job_work_logs').insert({
      job_id: rowId,
      dealership_id: entry.dealershipId,
      event_type: eventType,
      actor_user_id: action.actor?.id || null,
      actor_name: actorName,
      note: note || null,
      event_at: iso(action.at),
      metadata: { source: 'mobile', legacy_job_id: entry.jobId, action_id: action.id },
    });
  } catch {
    // Best effort only.
  }
};

const sendCreate = async (entry) => {
  if (await fetchJobRow(entry.dealershipId, entry.jobId)) return; // landed on an earlier try
  const job = applyJobAction(null, entry.action);
  const { data, error } = await supabase
    .from('jobs')
    .insert(toJobRow(job, entry.dealershipId))
    .select('id')
    .single();
  if (error) {
    // A timed-out insert may have landed after all; that's success, not a duplicate.
    if (error.code === '23505' && (await fetchJobRow(entry.dealershipId, entry.jobId))) return;
    throw error;
  }
  await recordAudit(entry, data.id);
};

// Apply an action to the latest server copy and save it. Retries a few times
// if someone else changed the job between our read and write.
const applyRemote = async (entry, action) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await fetchJobRow(entry.dealershipId, entry.jobId);
    if (!row)
      throw new JobActionError('not_found', `#${entry.stockNumber || 'This job'} was removed.`);
    const current = mapSupabaseJobToLegacyShape(row);
    const next = applyJobAction(current, action);
    if (next === current) return row; // already applied on an earlier try

    const { data, error } = await supabase
      .from('jobs')
      .update(updatePatch(next, entry.dealershipId))
      .eq('id', row.id)
      .eq('client_updated_at', row.client_updated_at)
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) return row;
    // Zero rows: the job changed underneath us. Re-read and try again.
  }
  throw Object.assign(new Error('The job is busy, will retry.'), { permanent: false });
};

const sendAction = async (entry) => {
  const row = await applyRemote(entry, entry.action);
  await recordAudit(entry, row.id);
};

const readPhotoBase64 = async (entry) => {
  if (entry.base64) return entry.base64; // web
  return new File(entry.fileUri).base64();
};

const sendPhoto = async (entry) => {
  const row = await fetchJobRow(entry.dealershipId, entry.jobId);
  if (!row)
    throw new JobActionError('not_found', `#${entry.stockNumber || 'This job'} was removed.`);

  // Deterministic path: a retry re-uses the same object instead of uploading twice.
  const storagePath = `${entry.dealershipId}/${row.id}/${entry.id}.jpg`;
  const base64 = await readPhotoBase64(entry);
  const { error: uploadError } = await supabase.storage
    .from('job-photos')
    .upload(storagePath, decodeBase64(base64), {
      contentType: entry.mimeType || 'image/jpeg',
      upsert: false,
    });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message || '')) {
    throw uploadError;
  }

  const { data: existing, error: lookupError } = await supabase
    .from('job_photos')
    .select('id')
    .eq('dealership_id', entry.dealershipId)
    .eq('storage_path', storagePath)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) {
    const { error: rowError } = await supabase.from('job_photos').insert({
      job_id: row.id,
      dealership_id: entry.dealershipId,
      uploaded_by_user_id: entry.action.actor?.id || null,
      uploaded_by_name: entry.action.actor?.name || 'Unknown',
      storage_path: storagePath,
      created_at: iso(entry.action.at),
      metadata: {
        mimeType: entry.mimeType || 'image/jpeg',
        source: 'mobile',
        legacy_job_id: entry.jobId,
      },
    });
    if (rowError) throw rowError;
  }

  // The job_photos row is the record of truth for photos; mirroring the path
  // into the payload is a convenience, and a completed (locked) job may refuse it.
  try {
    await applyRemote(entry, { ...entry.action, data: { storagePath } });
  } catch (error) {
    if (!/completed and can only be modified/i.test(error?.message || '')) throw error;
  }
};

export const sendEntry = async (entry) => {
  switch (entry.type) {
    case 'create':
      return sendCreate(entry);
    case 'photo':
      return sendPhoto(entry);
    default:
      return sendAction(entry);
  }
};
