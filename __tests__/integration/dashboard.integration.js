// Tests the manager dashboard's REAL shipped code (dashboard/index.html) by
// loading it in a DOM with a controllable fake Supabase client.
//
// The dashboard is a single self-contained HTML file with its logic inline, so
// it had zero automated coverage despite being what managers actually use. This
// executes the genuine script — not a copy — so the assertions track production.
//
// Run with:  npm run test:integration

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.resolve(__dirname, '../../dashboard/index.html'), 'utf8');
const DEALERSHIP = '00000000-0000-0000-0000-000000000123';

// A thenable query builder: every PostgREST-ish method returns itself, and
// awaiting it resolves to { data, error }.
const makeQuery = (result) => {
  const q = {};
  const methods = ['select', 'eq', 'is', 'order', 'limit', 'gte', 'lte', 'in', 'neq', 'single'];
  for (const m of methods) q[m] = () => q;
  q.then = (resolve) => resolve(result);
  q.update = () => q;
  q.insert = () => q;
  return q;
};

// Build a live dashboard DOM preloaded with `rows` as the jobs table contents.
async function mountDashboard(rows = []) {
  const updates = [];
  const dom = new JSDOM(HTML, {
    url: `https://example.test/?d=${DEALERSHIP}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      // The page installs a periodic auto-refresh (setInterval). Across many
      // mounted DOMs those timers keep the event loop alive forever and the
      // test run never exits — stub them out.
      window.setInterval = () => 0;
      window.clearInterval = () => {};
      // The page loads supabase-js from a CDN; jsdom doesn't fetch it, so
      // provide the shape the page expects before its inline script runs.
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: { user: { id: 'mgr' } } }, error: null }),
            signInWithPassword: async () => ({ data: { user: { id: 'mgr' } }, error: null }),
            signOut: async () => ({ error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          },
          from: () => {
            const q = makeQuery({ data: rows, error: null });
            const origUpdate = q.update;
            q.update = (patch) => {
              updates.push(patch);
              return origUpdate();
            };
            return q;
          },
          storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
        }),
      };
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
    },
  });

  // Let the page's async bootstrap (initializeDashboardApp -> loadDashboard) settle.
  await new Promise((r) => setTimeout(r, 60));
  await dom.window.loadDashboard?.();
  await new Promise((r) => setTimeout(r, 20));
  return { dom, window: dom.window, doc: dom.window.document, updates };
}

const jobRow = (over = {}) => ({
  id: over.id || `row-${Math.random().toString(36).slice(2, 7)}`,
  legacy_job_id: over.legacy_job_id || 'job_1',
  status: over.status || 'in_progress',
  stock_number: over.stock_number ?? 'S-1',
  make: over.make ?? 'Ford',
  model: over.model ?? 'F-150',
  year: '2024',
  color: 'Blue',
  created_at: new Date(over.createdAt || Date.now()).toISOString(),
  updated_at: new Date().toISOString(),
  client_updated_at: new Date().toISOString(),
  started_at: new Date(over.startTime || Date.now() - 3600000).toISOString(),
  ended_at: over.endTime ? new Date(over.endTime).toISOString() : null,
  total_active_ms: over.totalActiveTime || 0,
  total_pause_ms: 0,
  payload: {
    jobId: over.legacy_job_id || 'job_1',
    stockNumber: over.stock_number ?? 'S-1',
    make: over.make ?? 'Ford',
    model: over.model ?? 'F-150',
    status: over.status || 'in_progress',
    detailerName: over.detailerName || 'Alex',
    detailers: [over.detailerName || 'Alex'],
    startTime: over.startTime || Date.now() - 3600000,
    endTime: over.endTime ?? null,
    totalActiveTime: over.totalActiveTime || 0,
    totalPauseTime: 0,
    createdAt: over.createdAt || Date.now(),
    updatedAt: Date.now(),
    notes: over.notes || [],
    photos: over.photos || [],
    custodyEvents: over.custodyEvents || [],
    pauseEvents: [],
    ...(over.payloadExtra || {}),
  },
});

// --- pure helpers shipped in the page ------------------------------------

test('dashboard: escapeHtml neutralises injected markup (XSS guard)', async () => {
  const { window, dom } = await mountDashboard();
  const out = window.escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'), 'raw tag must not survive');
  assert.ok(out.includes('&lt;'), 'angle brackets must be entity-encoded');
  dom.window.close();
});

test('dashboard: mapSupabaseJobToLegacyShape prefers payload values over row columns', async () => {
  const { window, dom } = await mountDashboard();
  const mapped = window.mapSupabaseJobToLegacyShape(
    jobRow({ make: 'RowMake', payloadExtra: { make: 'PayloadMake' } }),
  );
  assert.strictEqual(mapped.make, 'PayloadMake');
  dom.window.close();
});

test('dashboard: mapSupabaseJobToLegacyShape keeps the DB row id for manager write-backs', async () => {
  const { window, dom } = await mountDashboard();
  const row = jobRow({ id: 'row-abc' });
  assert.strictEqual(window.mapSupabaseJobToLegacyShape(row).remoteId, 'row-abc');
  dom.window.close();
});

test('dashboard: elapsed time excludes accumulated pause time', async () => {
  const { window, dom } = await mountDashboard();
  const now = Date.now();
  const elapsed = window.getElapsedTime({
    startTime: now - 3600000,
    totalPauseTime: 600000,
    status: 'in_progress',
    pauseEvents: [],
  });
  assert.ok(elapsed > 0 && elapsed <= 3000000 + 5000, `expected ~50m, got ${elapsed}`);
  dom.window.close();
});

// --- rendering + stats ----------------------------------------------------

test('dashboard: stat tiles reflect the job mix', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({
      legacy_job_id: 'a',
      status: 'completed',
      totalActiveTime: 3600000,
      endTime: Date.now(),
    }),
    jobRow({
      legacy_job_id: 'b',
      status: 'completed',
      totalActiveTime: 1800000,
      endTime: Date.now(),
    }),
    jobRow({ legacy_job_id: 'c', status: 'in_progress' }),
    jobRow({ legacy_job_id: 'd', status: 'paused' }),
  ]);
  assert.strictEqual(doc.getElementById('statCompleted').textContent, '2');
  assert.strictEqual(doc.getElementById('statActive').textContent, '2', 'in_progress + paused');
  assert.strictEqual(doc.getElementById('statPaused').textContent, '1');
  assert.strictEqual(doc.getElementById('statAvg').textContent, '45m', 'avg of 60m and 30m');
  dom.window.close();
});

test('dashboard: coverage counts notes, photos and custody events', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({
      legacy_job_id: 'a',
      notes: [{ text: 'n1' }, { text: 'n2' }],
      photos: [{ url: 'p' }],
      custodyEvents: [{ type: 'start' }, { type: 'pause' }, { type: 'resume' }],
    }),
  ]);
  assert.strictEqual(doc.getElementById('notesCount').textContent, '2');
  assert.strictEqual(doc.getElementById('photosCount').textContent, '1');
  assert.strictEqual(doc.getElementById('custodyCount').textContent, '3');
  dom.window.close();
});

test('dashboard: a malicious stock number is rendered inert, not executed', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'x', stock_number: '<img src=x onerror=alert(1)>' }),
  ]);
  const injected = doc.querySelector('#jobsContainer img[onerror]');
  assert.strictEqual(injected, null, 'no live element may be injected from job data');
  assert.ok(
    doc.getElementById('jobsContainer').textContent.includes('<img'),
    'it should appear as literal text instead',
  );
  dom.window.close();
});

test('dashboard: job count reflects what is rendered', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a' }),
    jobRow({ legacy_job_id: 'b' }),
    jobRow({ legacy_job_id: 'c' }),
  ]);
  assert.strictEqual(doc.getElementById('jobCount').textContent, '3 jobs');
  dom.window.close();
});

// --- filters --------------------------------------------------------------

test('dashboard: free-text search narrows the job list', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', make: 'Ford', model: 'F-150' }),
    jobRow({ legacy_job_id: 'b', make: 'Tesla', model: 'Model 3' }),
  ]);
  doc.getElementById('searchFilter').value = 'Tesla';
  await window.loadDashboard();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 jobs');
  assert.ok(doc.getElementById('jobsContainer').textContent.includes('Tesla'));
  dom.window.close();
});

test('dashboard: search also matches note text', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', notes: [{ text: 'curb rash on rear wheel' }] }),
    jobRow({ legacy_job_id: 'b' }),
  ]);
  doc.getElementById('searchFilter').value = 'curb';
  await window.loadDashboard();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 jobs');
  dom.window.close();
});

test('dashboard: the detailer filter is populated and narrows results', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', detailerName: 'Alex' }),
    jobRow({ legacy_job_id: 'b', detailerName: 'Jordan' }),
  ]);
  const options = [...doc.getElementById('detailerFilter').options].map((o) => o.value);
  assert.ok(options.includes('Alex') && options.includes('Jordan'), 'both detailers listed');

  doc.getElementById('detailerFilter').value = 'Jordan';
  await window.loadDashboard();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 jobs');
  dom.window.close();
});

test('dashboard: clearFilters restores the full list', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', make: 'Ford' }),
    jobRow({ legacy_job_id: 'b', make: 'Tesla' }),
  ]);
  doc.getElementById('searchFilter').value = 'Tesla';
  await window.loadDashboard();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 jobs');

  window.clearFilters();
  await window.loadDashboard();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '2 jobs');
  dom.window.close();
});

// --- insights + drill-downs ----------------------------------------------

test('dashboard: Top Detailers ranks by completed jobs and is clickable', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({
      legacy_job_id: 'a',
      detailerName: 'Alex',
      status: 'completed',
      totalActiveTime: 60000,
      endTime: Date.now(),
    }),
    jobRow({
      legacy_job_id: 'b',
      detailerName: 'Alex',
      status: 'completed',
      totalActiveTime: 60000,
      endTime: Date.now(),
    }),
    jobRow({
      legacy_job_id: 'c',
      detailerName: 'Jordan',
      status: 'completed',
      totalActiveTime: 60000,
      endTime: Date.now(),
    }),
  ]);
  const items = [...doc.querySelectorAll('#topDetailers li')];
  assert.ok(items[0].textContent.includes('Alex'), 'Alex (2 jobs) should rank first');
  assert.ok(items[0].getAttribute('onclick'), 'entries must drill down');
  dom.window.close();
});

test('dashboard: Longest Active Jobs is ordered oldest-first and clickable', async () => {
  const now = Date.now();
  const { doc, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'new', stock_number: 'NEW-1', startTime: now - 600000 }),
    jobRow({ legacy_job_id: 'old', stock_number: 'OLD-1', startTime: now - 18000000 }),
  ]);
  const items = [...doc.querySelectorAll('#slowJobs li')];
  assert.ok(items[0].textContent.includes('OLD-1'), 'oldest active job first');
  assert.ok(items[0].getAttribute('onclick'), 'entries must drill down');
  dom.window.close();
});

test('dashboard: the detailer drill-down shows that detailer metrics and jobs', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({
      legacy_job_id: 'a',
      detailerName: 'Alex',
      status: 'completed',
      totalActiveTime: 1200000,
      endTime: Date.now(),
    }),
    jobRow({ legacy_job_id: 'b', detailerName: 'Alex', status: 'in_progress' }),
    jobRow({
      legacy_job_id: 'c',
      detailerName: 'Jordan',
      status: 'completed',
      totalActiveTime: 60000,
      endTime: Date.now(),
    }),
  ]);
  window.showDetailerDetails('Alex');
  const body = doc.getElementById('modalBody').textContent;
  assert.ok(body.includes('Alex'));
  assert.ok(!body.includes('Jordan'), "another detailer's jobs must not leak in");
  assert.ok(doc.getElementById('jobModal').classList.contains('show'), 'modal opens');
  dom.window.close();
});

test('dashboard: the job modal opens with the vehicle and time tracking', async () => {
  const { doc, window, dom } = await mountDashboard([jobRow({ legacy_job_id: 'a' })]);
  window.showJobDetails(window.mapSupabaseJobToLegacyShape(jobRow({ legacy_job_id: 'a' })));
  const body = doc.getElementById('modalBody').textContent;
  assert.ok(body.includes('F-150'));
  assert.ok(body.includes('Time Tracking'));
  dom.window.close();
});

test('dashboard: closeModal returns the manager to the dashboard', async () => {
  const { doc, window, dom } = await mountDashboard([jobRow({ legacy_job_id: 'a' })]);
  window.showDetailerDetails('Alex');
  assert.ok(doc.getElementById('jobModal').classList.contains('show'));
  window.closeModal(null, 'jobModal');
  assert.ok(!doc.getElementById('jobModal').classList.contains('show'), 'modal closes');
  dom.window.close();
});

// --- manager actions + destructive guard ---------------------------------

test('dashboard: a completed job offers Reopen for Rework; an active one does not', async () => {
  const { doc, window, dom } = await mountDashboard();
  window.showJobDetails(
    window.mapSupabaseJobToLegacyShape(
      jobRow({ legacy_job_id: 'a', status: 'completed', endTime: Date.now() }),
    ),
  );
  assert.ok(
    doc.getElementById('modalBody').innerHTML.includes('Reopen for Rework'),
    'completed job should offer rework',
  );

  window.showJobDetails(
    window.mapSupabaseJobToLegacyShape(jobRow({ legacy_job_id: 'b', status: 'in_progress' })),
  );
  assert.ok(
    !doc.getElementById('modalBody').innerHTML.includes('Reopen for Rework'),
    'an active job must not offer rework',
  );
  assert.ok(
    doc.getElementById('modalBody').innerHTML.includes('Reassign Detailer'),
    'reassign is always available',
  );
  dom.window.close();
});

test('dashboard: Wipe Database does NOTHING unless DELETE is typed', async () => {
  const { window, updates, dom } = await mountDashboard([jobRow({ legacy_job_id: 'a' })]);
  window.prompt = () => 'yes'; // wrong confirmation
  await window.wipeDatabase();
  assert.strictEqual(updates.length, 0, 'no write may be issued without the exact word');

  window.prompt = () => 'delete'; // case-insensitive match IS accepted
  await window.wipeDatabase();
  assert.ok(updates.length > 0, 'typing DELETE proceeds');
  assert.ok(updates[0].deleted_at, 'wipe is a soft delete');
  // wipeDatabase kicks off an un-awaited loadDashboard(); let it settle before
  // tearing the window down, or it touches a closed DOM after the test ends.
  await new Promise((r) => setTimeout(r, 50));
  dom.window.close();
});
