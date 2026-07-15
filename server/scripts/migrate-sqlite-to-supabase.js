/*
  SQLite -> Supabase Phase 1 migration script

  Usage (from repo root):
    node server/scripts/migrate-sqlite-to-supabase.js

  Required env vars:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_DEALERSHIP_ID

  Optional env vars:
    SQLITE_PATH (default: ./server/shinetime-detail-tracker.db)
    DRY_RUN=true
*/

const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'shinetime-detail-tracker.db');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_DEALERSHIP_ID = process.env.SUPABASE_DEALERSHIP_ID;
const DRY_RUN = process.env.DRY_RUN === 'true';

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

function msToIso(msValue) {
  const n = Number(msValue);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

function mapStatus(input) {
  const value = String(input || '').toLowerCase();
  switch (value) {
    case 'queued':
    case 'in_progress':
    case 'paused':
    case 'completed':
    case 'needs_rework':
    case 'cancelled':
      return value;
    default:
      if (value === 'rework') return 'needs_rework';
      return 'queued';
  }
}

function safeJsonParse(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mapJobRecord(row) {
  const payload = safeJsonParse(row.data);

  return {
    dealership_id: SUPABASE_DEALERSHIP_ID,
    legacy_job_id: row.jobId || null,
    status: mapStatus(payload.status || row.status),
    device_id: payload.deviceId || row.deviceId || null,
    stock_number: payload.stockNumber || null,
    vin: payload.vin || null,
    make: payload.make || null,
    model: payload.model || null,
    year: payload.year || null,
    color: payload.color || null,
    started_at: msToIso(payload.startTime || row.createdAt),
    ended_at: msToIso(payload.endTime),
    total_pause_ms: Number(payload.totalPauseTime || 0),
    total_active_ms: Number(payload.totalActiveTime || 0),
    client_updated_at: msToIso(payload.updatedAt || row.updatedAt || Date.now()),
    payload,
  };
}

async function insertChildRows(supabase, parentJobId, dealershipId, payload) {
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const custodyEvents = Array.isArray(payload.custodyEvents) ? payload.custodyEvents : [];
  const photos = Array.isArray(payload.photos) ? payload.photos : [];

  if (notes.length > 0) {
    const noteRows = notes.map((n) => ({
      job_id: parentJobId,
      dealership_id: dealershipId,
      author_name: n.detailerName || null,
      note: String(n.text || ''),
      created_at: msToIso(n.timestamp) || new Date().toISOString(),
      metadata: n,
    }));

    const { error } = await supabase.from('job_notes').insert(noteRows);
    if (error) throw error;
  }

  if (custodyEvents.length > 0) {
    const eventRows = custodyEvents.map((e) => ({
      job_id: parentJobId,
      dealership_id: dealershipId,
      event_type: String(e.type || 'event'),
      actor_name: e.detailerName || null,
      note: e.note || null,
      event_at: msToIso(e.timestamp) || new Date().toISOString(),
      metadata: e,
    }));

    const { error } = await supabase.from('job_work_logs').insert(eventRows);
    if (error) throw error;
  }

  if (photos.length > 0) {
    const photoRows = photos
      .filter((p) => p && p.url)
      .map((p) => ({
        job_id: parentJobId,
        dealership_id: dealershipId,
        uploaded_by_name: p.detailerName || null,
        storage_path: String(p.url),
        photo_type: p.type || null,
        created_at: msToIso(p.timestamp) || new Date().toISOString(),
        metadata: p,
      }));

    if (photoRows.length > 0) {
      const { error } = await supabase.from('job_photos').insert(photoRows);
      if (error) throw error;
    }
  }
}

async function run() {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);
  requireEnv('SUPABASE_DEALERSHIP_ID', SUPABASE_DEALERSHIP_ID);

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite
    .prepare('SELECT jobId, status, deviceId, createdAt, updatedAt, data FROM jobs ORDER BY createdAt ASC')
    .all();

  console.log(`Found ${rows.length} SQLite jobs at ${SQLITE_PATH}`);

  if (DRY_RUN) {
    console.log('DRY_RUN=true, exiting before writes.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let migrated = 0;
  for (const row of rows) {
    const mapped = mapJobRecord(row);

    const { data, error } = await supabase
      .from('jobs')
      .upsert(mapped, { onConflict: 'dealership_id,legacy_job_id' })
      .select('id,payload')
      .single();

    if (error) throw error;

    await insertChildRows(supabase, data.id, SUPABASE_DEALERSHIP_ID, data.payload || {});
    migrated += 1;

    if (migrated % 50 === 0) {
      console.log(`Migrated ${migrated}/${rows.length} jobs...`);
    }
  }

  console.log(`Migration complete: ${migrated} jobs migrated.`);
}

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});