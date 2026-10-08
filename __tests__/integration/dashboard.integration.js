// Tests the manager dashboard's REAL shipped code (dashboard/index.html) by
// loading it in jsdom with a controllable fake Supabase client. No network.
//
// Run with:  node --test __tests__/integration/dashboard.integration.js
//       or:  npm run test:integration

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.resolve(__dirname, '../../dashboard/index.html'), 'utf8');
const DEALERSHIP = '00000000-0000-0000-0000-000000000123';

// A thenable query builder: chain methods return itself; awaiting resolves to
// { data, error }. single()/maybeSingle() resolve to the first row.
const makeQuery = (table, world) => {
  const q = { table, ops: [] };
  const chain = ['select', 'eq', 'is', 'order', 'limit', 'gte', 'lte', 'in', 'neq', 'gt', 'lt'];
  for (const m of chain) {
    q[m] = (...args) => {
      q.ops.push([m, ...args]);
      return q;
    };
  }
  const rows = () => world.tables[table] || [];
  q.update = (patch) => {
    world.updates.push({ table, patch });
    return q;
  };
  q.single = () => Promise.resolve({ data: rows()[0] || null, error: null });
  q.maybeSingle = () => Promise.resolve({ data: rows()[0] || null, error: null });
  q.then = (resolve) => {
    if (table === 'jobs' && q.ops.some(([m]) => m === 'select')) world.jobFetches += 1;
    resolve({ data: rows(), error: null });
  };
  return q;
};

async function mountDashboard(rows = [], { signedIn = true, photos = [], employees = [] } = {}) {
  const world = {
    tables: {
      jobs: rows,
      job_photos: photos,
      dealership_memberships: [
        {
          dealership_id: DEALERSHIP,
          role: 'owner',
          dealerships: { id: DEALERSHIP, name: 'Alpha Ford' },
        },
      ],
      profiles: [{ full_name: 'Dana Manager' }],
    },
    updates: [],
    invokes: [],
    rpcs: [],
    passwordUpdates: [],
    jobFetches: 0,
  };
  const dom = new JSDOM(HTML, {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.setInterval = () => 0;
      window.clearInterval = () => {};
      window.supabase = {
        createClient: () => ({
          auth: {
            getSession: async () => ({
              data: {
                session: signedIn ? { user: { id: 'mgr', email: 'dana@alpha.test' } } : null,
              },
              error: null,
            }),
            signInWithPassword: async () => ({
              data: { user: { id: 'mgr', email: 'dana@alpha.test' } },
              error: null,
            }),
            signOut: async () => ({ error: null }),
            updateUser: async (attrs) => {
              world.passwordUpdates.push(attrs);
              return { data: { user: { id: 'mgr' } }, error: null };
            },
          },
          from: (table) => makeQuery(table, world),
          rpc: async (name, args) => {
            world.rpcs.push({ name, args });
            return { data: 'K7M3QPX', error: null };
          },
          functions: {
            invoke: async (name, { body }) => {
              world.invokes.push(body);
              if (body.action === 'list_employees') return { data: { employees }, error: null };
              return { data: { ok: true }, error: null };
            },
          },
          storage: {
            from: () => ({
              createSignedUrls: async (paths) => ({
                data: paths.map((p) => ({
                  path: p,
                  signedUrl: `https://signed.test/${p}?fresh=1`,
                })),
                error: null,
              }),
            }),
          },
        }),
      };
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => null;
    },
  });
  await new Promise((r) => setTimeout(r, 60));
  return { dom, window: dom.window, doc: dom.window.document, world };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

const jobRow = (over = {}) => ({
  id: over.id || `row-${over.legacy_job_id || 'job_1'}`,
  legacy_job_id: over.legacy_job_id || 'job_1',
  status: over.status || 'in_progress',
  stock_number: over.stock_number ?? 'S-1',
  make: over.make ?? 'Ford',
  model: over.model ?? 'F-150',
  year: '2024',
  color: 'Blue',
  created_at: new Date(over.createdAt || Date.now()).toISOString(),
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
    detailers: over.detailers || [over.detailerName || 'Alex'],
    startTime: over.startTime || Date.now() - 3600000,
    endTime: over.endTime ?? null,
    totalActiveTime: over.totalActiveTime || 0,
    totalPauseTime: 0,
    createdAt: over.createdAt || Date.now(),
    updatedAt: Date.now(),
    notes: over.notes || [],
    photos: over.photos || [],
    custodyEvents: over.custodyEvents || [],
    pauseEvents: over.pauseEvents || [],
    ...(over.payloadExtra || {}),
  },
});

const done = (id, ms, extra = {}) =>
  jobRow({
    legacy_job_id: id,
    status: 'completed',
    totalActiveTime: ms,
    endTime: Date.now(),
    ...extra,
  });

// --- sign-in -----------------------------------------------------------------

test('dashboard: signed out shows a real sign-in form with a masked password', async () => {
  const { doc, dom } = await mountDashboard([], { signedIn: false });
  assert.strictEqual(doc.getElementById('signin').hidden, false);
  assert.strictEqual(doc.getElementById('app').hidden, true);
  assert.strictEqual(doc.getElementById('signinPassword').type, 'password');
  dom.window.close();
});

test('dashboard: no dealership UUID is needed — it comes from the manager account', async () => {
  const { doc, dom } = await mountDashboard([jobRow()]);
  assert.strictEqual(doc.getElementById('dealershipTitle').textContent, 'Alpha Ford');
  assert.strictEqual(doc.getElementById('whoEmail').textContent, 'dana@alpha.test');
  dom.window.close();
});

test('dashboard: the Wipe Database control is gone', async () => {
  const { window, doc, dom } = await mountDashboard([jobRow()]);
  assert.strictEqual(typeof window.wipeDatabase, 'undefined');
  assert.ok(!doc.body.textContent.includes('Wipe Database'));
  dom.window.close();
});

// --- pure helpers ----------------------------------------------------------

test('dashboard: escapeHtml neutralises injected markup', async () => {
  const { window, dom } = await mountDashboard();
  const out = window.escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img') && out.includes('&lt;'));
  dom.window.close();
});

test('dashboard: mapSupabaseJobToLegacyShape prefers payload values and keeps the row id', async () => {
  const { window, dom } = await mountDashboard();
  const mapped = window.mapSupabaseJobToLegacyShape(
    jobRow({ id: 'row-abc', make: 'RowMake', payloadExtra: { make: 'PayloadMake' } }),
  );
  assert.strictEqual(mapped.make, 'PayloadMake');
  assert.strictEqual(mapped.remoteId, 'row-abc');
  dom.window.close();
});

test('dashboard: elapsed time excludes pauses and holds still while waiting for rework', async () => {
  const { window, dom } = await mountDashboard();
  const now = Date.now();
  const running = window.getElapsedTime({
    startTime: now - 3600000,
    totalPauseTime: 600000,
    status: 'in_progress',
  });
  assert.ok(running > 2990000 && running <= 3005000);
  const rework = window.getElapsedTime({
    startTime: now - 3600000,
    totalPauseTime: 0,
    status: 'needs_rework',
    pauseEvents: [{ type: 'pause', timestamp: now - 1800000 }],
  });
  assert.ok(rework > 1790000 && rework <= 1805000, `got ${rework}`);
  dom.window.close();
});

// --- rendering + stats -------------------------------------------------------

test('dashboard: stat tiles reflect the job mix, including rework', async () => {
  const { doc, dom } = await mountDashboard([
    done('a', 3600000),
    done('b', 1800000),
    jobRow({ legacy_job_id: 'c', status: 'in_progress' }),
    jobRow({ legacy_job_id: 'd', status: 'paused' }),
    jobRow({ legacy_job_id: 'e', status: 'needs_rework' }),
  ]);
  assert.strictEqual(doc.getElementById('statCompleted').textContent, '2');
  assert.strictEqual(doc.getElementById('statActive').textContent, '3');
  assert.strictEqual(doc.getElementById('statPaused').textContent, '1');
  assert.strictEqual(doc.getElementById('statRework').textContent, '1');
  assert.strictEqual(doc.getElementById('statAvg').textContent, '45m');
  dom.window.close();
});

test('dashboard: defaults to Today and says which period the numbers cover', async () => {
  const { doc, dom } = await mountDashboard([jobRow()]);
  assert.strictEqual(doc.getElementById('dateFilter').value, 'today');
  assert.strictEqual(doc.getElementById('periodLabel').textContent, 'today');
  dom.window.close();
});

test('dashboard: cards lead with the stock number, never "? ?"', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({ stock_number: 'P4521', make: '', model: '' }),
  ]);
  const card = doc.querySelector('.job-card');
  assert.strictEqual(card.querySelector('.job-title').textContent, '#P4521');
  assert.ok(!card.textContent.includes('? ?'));
  assert.ok(!card.textContent.includes('Standard'), 'meaningless "Standard" tag removed');
  dom.window.close();
});

test('dashboard: multi-detailer jobs show a real arrow (no mojibake)', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({ detailers: ['Mike', 'Ana'], detailerName: 'Ana' }),
  ]);
  const text = doc.getElementById('jobsContainer').textContent;
  assert.ok(text.includes('Mike → Ana'), text);
  assert.ok(!/â†/.test(doc.documentElement.innerHTML));
  dom.window.close();
});

test('dashboard: counts are pluralised properly', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a' }),
    jobRow({ legacy_job_id: 'b' }),
  ]);
  assert.strictEqual(doc.getElementById('jobCount').textContent, '2 jobs');
  doc.getElementById('searchFilter').value = 'zzz-no-match';
  window.renderJobs();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '0 jobs');
  dom.window.close();
});

test('dashboard: coverage counts notes, photos and custody events', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({
      notes: [{ text: 'n1' }, { text: 'n2' }],
      photos: [{ storagePath: 'p' }],
      custodyEvents: [{ type: 'start' }, { type: 'pause' }, { type: 'resume' }],
    }),
  ]);
  assert.strictEqual(doc.getElementById('notesCount').textContent, '2');
  assert.strictEqual(doc.getElementById('photosCount').textContent, '1');
  assert.strictEqual(doc.getElementById('custodyCount').textContent, '3');
  dom.window.close();
});

test('dashboard: a malicious stock number is rendered inert', async () => {
  const { doc, dom } = await mountDashboard([
    jobRow({ stock_number: '<img src=x onerror=alert(1)>' }),
  ]);
  assert.strictEqual(doc.querySelector('#jobsContainer img[onerror]'), null);
  assert.ok(doc.getElementById('jobsContainer').textContent.includes('<img'));
  dom.window.close();
});

// --- filters -------------------------------------------------------------------

test('dashboard: search narrows the list in the browser without refetching', async () => {
  const { doc, window, world, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', make: 'Ford', model: 'F-150' }),
    jobRow({ legacy_job_id: 'b', make: 'Tesla', model: 'Model 3' }),
  ]);
  const fetchesBefore = world.jobFetches;
  doc.getElementById('searchFilter').value = 'Tesla';
  window.renderJobs();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 job');
  assert.strictEqual(world.jobFetches, fetchesBefore, 'typing must not hit the database');
  dom.window.close();
});

test('dashboard: search also matches note text', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', notes: [{ text: 'curb rash on rear wheel' }] }),
    jobRow({ legacy_job_id: 'b' }),
  ]);
  doc.getElementById('searchFilter').value = 'curb';
  window.renderJobs();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 job');
  dom.window.close();
});

test('dashboard: the detailer filter is populated and narrows results', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', detailerName: 'Alex' }),
    jobRow({ legacy_job_id: 'b', detailerName: 'Jordan' }),
  ]);
  const options = [...doc.getElementById('detailerFilter').options].map((o) => o.value);
  assert.ok(options.includes('Alex') && options.includes('Jordan'));
  doc.getElementById('detailerFilter').value = 'Jordan';
  window.renderJobs();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '1 job');
  dom.window.close();
});

test('dashboard: the status filter offers Rework', async () => {
  const { doc, dom } = await mountDashboard();
  const options = [...doc.getElementById('statusFilter').options].map((o) => o.value);
  assert.ok(options.includes('needs_rework'));
  dom.window.close();
});

test('dashboard: clearFilters restores the full list and Today', async () => {
  const { doc, window, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'a', make: 'Ford' }),
    jobRow({ legacy_job_id: 'b', make: 'Tesla' }),
  ]);
  doc.getElementById('searchFilter').value = 'Tesla';
  doc.getElementById('dateFilter').value = 'all';
  window.renderJobs();
  window.clearFilters();
  await settle();
  assert.strictEqual(doc.getElementById('jobCount').textContent, '2 jobs');
  assert.strictEqual(doc.getElementById('dateFilter').value, 'today');
  dom.window.close();
});

// --- insights + drill-downs -------------------------------------------------------

test('dashboard: Top Detailers ranks by completed cars and entries are buttons', async () => {
  const { doc, dom } = await mountDashboard([
    done('a', 60000, { detailerName: 'Alex' }),
    done('b', 60000, { detailerName: 'Alex' }),
    done('c', 60000, { detailerName: 'Jordan' }),
  ]);
  const first = doc.querySelector('#topDetailers li button');
  assert.ok(first.textContent.includes('Alex'));
  assert.strictEqual(first.dataset.detailer, 'Alex');
  dom.window.close();
});

test('dashboard: Longest Open Jobs is ordered oldest-first and includes rework', async () => {
  const now = Date.now();
  const { doc, dom } = await mountDashboard([
    jobRow({ legacy_job_id: 'new', stock_number: 'NEW-1', startTime: now - 600000 }),
    jobRow({ legacy_job_id: 'old', stock_number: 'OLD-1', startTime: now - 18000000 }),
  ]);
  const items = [...doc.querySelectorAll('#slowJobs li button')];
  assert.ok(items[0].textContent.includes('OLD-1'));
  assert.strictEqual(items[0].dataset.job, 'old');
  dom.window.close();
});

test('dashboard: the detailer drill-down shows only that detailer', async () => {
  const { doc, window, dom } = await mountDashboard([
    done('a', 1200000, { detailerName: 'Alex' }),
    jobRow({ legacy_job_id: 'b', detailerName: 'Alex' }),
    done('c', 60000, { detailerName: 'Jordan', stock_number: 'JORDAN-1' }),
  ]);
  window.showDetailerDetails('Alex');
  const body = doc.getElementById('modalBody').textContent;
  assert.ok(body.includes('Alex'));
  assert.ok(!body.includes('JORDAN-1'));
  assert.ok(doc.getElementById('jobModal').classList.contains('show'));
  dom.window.close();
});

test('dashboard: the job modal opens with vehicle and time tracking, and closes', async () => {
  const { doc, window, dom } = await mountDashboard([jobRow()]);
  window.openJob('job_1');
  const body = doc.getElementById('modalBody').textContent;
  assert.ok(body.includes('F-150'));
  assert.ok(body.includes('Time Tracking'));
  assert.strictEqual(
    doc.querySelector('#jobModal [role="dialog"]').getAttribute('aria-modal'),
    'true',
  );
  window.closeModal(null, 'jobModal');
  assert.ok(!doc.getElementById('jobModal').classList.contains('show'));
  dom.window.close();
});

test('dashboard: photos are signed fresh from job_photos, not old payload URLs', async () => {
  const { doc, window, dom } = await mountDashboard(
    [jobRow({ photos: [{ url: 'https://expired.test/old.jpg' }] })],
    {
      photos: [
        {
          storage_path: 'd/row/p1.jpg',
          uploaded_by_name: 'Alex',
          created_at: new Date().toISOString(),
        },
      ],
    },
  );
  window.openJob('job_1');
  await settle();
  const img = doc.querySelector('#photoGrid img');
  assert.ok(img, 'photo rendered');
  assert.strictEqual(img.getAttribute('src'), 'https://signed.test/d/row/p1.jpg?fresh=1');
  assert.ok(!doc.getElementById('modalBody').innerHTML.includes('expired.test'));
  dom.window.close();
});

// --- manager actions -----------------------------------------------------------

test('dashboard: only completed jobs offer Reopen for Rework; reassign is available', async () => {
  const { doc, window, dom } = await mountDashboard([
    done('a', 60000),
    jobRow({ legacy_job_id: 'b', status: 'in_progress' }),
  ]);
  window.openJob('a');
  assert.ok(doc.getElementById('modalBody').innerHTML.includes('Reopen for Rework'));
  window.openJob('b');
  assert.ok(!doc.getElementById('modalBody').innerHTML.includes('Reopen for Rework'));
  assert.ok(doc.getElementById('modalBody').innerHTML.includes('Reassign Detailer'));
  dom.window.close();
});

test('dashboard: sending back for rework records the note and holds the clock from completion', async () => {
  const endTime = Date.now() - 7200000;
  const row = done('a', 3600000, { payloadExtra: { endTime } });
  const { doc, window, world, dom } = await mountDashboard([row]);
  window.openJob('a');
  window.toggleForm('reworkForm');
  doc.getElementById('reworkNote').value = 'Swirl marks on hood';
  await window.submitRework({ preventDefault() {} }, 'a');
  const update = world.updates.find((u) => u.table === 'jobs');
  assert.ok(update, 'a write was issued');
  assert.strictEqual(update.patch.status, 'needs_rework');
  const { payload } = update.patch;
  assert.strictEqual(payload.endTime, null);
  assert.deepStrictEqual(payload.pauseEvents[payload.pauseEvents.length - 1].timestamp, endTime);
  const rework = payload.custodyEvents[payload.custodyEvents.length - 1];
  assert.strictEqual(rework.type, 'rework');
  assert.strictEqual(rework.note, 'Swirl marks on hood');
  assert.strictEqual(rework.detailerName, 'Dana Manager');
  dom.window.close();
});

test('dashboard: reassigning picks from the team and moves the job to that person', async () => {
  const { doc, window, world, dom } = await mountDashboard([jobRow({ legacy_job_id: 'a' })], {
    employees: [
      { userId: 'u-ana', name: 'Ana', role: 'detailer', isActive: true },
      { userId: 'u-bo', name: 'Bo', role: 'detailer', isActive: false },
    ],
  });
  window.openJob('a');
  await window.openReassign();
  const options = [...doc.getElementById('reassignSelect').options].map((o) => o.value);
  assert.ok(options.includes('u-ana'));
  assert.ok(!options.includes('u-bo'), 'turned-off staff are not offered');
  doc.getElementById('reassignSelect').value = 'u-ana';
  await window.submitReassign({ preventDefault() {} }, 'a');
  const update = world.updates.find((u) => u.table === 'jobs');
  assert.strictEqual(update.patch.assigned_detailer_id, 'u-ana');
  assert.strictEqual(update.patch.payload.detailerName, 'Ana');
  assert.strictEqual(update.patch.payload.operationalUserId, 'u-ana');
  dom.window.close();
});

test('dashboard: the Team page lists staff and resets a PIN', async () => {
  const { doc, window, world, dom } = await mountDashboard([], {
    employees: [
      { userId: 'u-ana', name: 'Ana', role: 'detailer', isActive: true, lastActiveAt: null },
    ],
  });
  await window.showTeam();
  assert.ok(doc.getElementById('modalBody').textContent.includes('Ana'));
  window.startPinReset('u-ana');
  doc.getElementById('newPin').value = '4321';
  await window.submitPinReset({ preventDefault() {} });
  const reset = world.invokes.find((b) => b.action === 'reset_pin');
  assert.deepStrictEqual(
    { id: reset.employeeUserId, pin: reset.newPin, d: reset.dealershipId },
    { id: 'u-ana', pin: '4321', d: DEALERSHIP },
  );
  dom.window.close();
});

test('dashboard: the shared manager login can change its password', async () => {
  const { doc, window, world, dom } = await mountDashboard([jobRow()]);
  window.showPasswordForm();
  assert.strictEqual(doc.getElementById('passwordForm').hidden, false);
  doc.getElementById('newPassword').value = 'short';
  doc.getElementById('confirmPassword').value = 'short';
  await window.handlePasswordChange({ preventDefault() {} });
  assert.strictEqual(world.passwordUpdates.length, 0, 'too short is refused');
  doc.getElementById('newPassword').value = 'detail-shop-2026';
  doc.getElementById('confirmPassword').value = 'detail-shop-2026';
  await window.handlePasswordChange({ preventDefault() {} });
  assert.strictEqual(world.passwordUpdates.length, 1);
  assert.strictEqual(world.passwordUpdates[0].password, 'detail-shop-2026');
  assert.strictEqual(doc.getElementById('app').hidden, false, 'back to the dashboard');
  dom.window.close();
});

test('dashboard: invite codes are detailer-only (no manager codes)', async () => {
  const { doc, window, world, dom } = await mountDashboard([], { employees: [] });
  await window.showTeam();
  assert.ok(!doc.getElementById('modalBody').textContent.includes('manager code'));
  await window.makeInvite();
  assert.strictEqual(world.rpcs[0].args.p_role, 'detailer');
  dom.window.close();
});
