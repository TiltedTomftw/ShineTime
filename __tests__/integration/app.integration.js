// End-to-end integration tests against the REAL Supabase project.
//
// These cover what the unit tests can't: Row-Level Security / tenant isolation,
// the job lifecycle as it actually lands in Postgres, the completed-job lock,
// the offline sync engine's reconcile semantics, and the manager write-backs.
//
// Run with:  npm run test:integration        (NOT part of `npm test` / CI —
//                                             it needs .env + network)
//
// Safety: every test builds its own throwaway dealerships + auth users with a
// unique run id and deletes them afterwards. It never touches real dealerships.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  reconcileJobsWithRemote,
  jobBelongsToOperator,
  describeSyncStatus,
} = require('../../src/services/jobLogic');
const { computeActiveTime } = require('../../src/services/timeMath');

// --- config ---------------------------------------------------------------

const env = {};
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !ANON || !SVC) {
  console.error(
    'Integration tests need EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env',
  );
  process.exit(1);
}

const RUN = `it${Date.now().toString(36)}`;
const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

const svc = async (q, opts = {}) => {
  const res = await fetch(`${BASE}/rest/v1/${q}`, { headers: svcH, ...opts });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const signIn = async (email, password) => {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).access_token || null;
};

// Query as a real signed-in user, so RLS is genuinely exercised.
const asUser = async (token, q, opts = {}) => {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/rest/v1/${q}`, { headers, ...opts });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const iso = (ms) => new Date(ms).toISOString();

// --- fixtures -------------------------------------------------------------

const world = { alpha: {}, beta: {}, users: [] };

const createDealership = async (name, slug) => {
  const { body } = await svc('dealerships', {
    method: 'POST',
    headers: { ...svcH, Prefer: 'return=representation' },
    body: JSON.stringify({ name, slug, is_active: true }),
  });
  return body[0].id;
};

const createUser = async (email, password, role, dealershipId) => {
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcH,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await res.json();
  world.users.push(user.id);
  await svc('profiles', {
    method: 'POST',
    headers: { ...svcH, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, full_name: email.split('@')[0] }),
  });
  await svc('dealership_memberships', {
    method: 'POST',
    body: JSON.stringify({ dealership_id: dealershipId, user_id: user.id, role, is_active: true }),
  });
  return user.id;
};

const seedJob = async (dealershipId, overrides = {}) => {
  const now = Date.now();
  const jobId = overrides.jobId || `${RUN}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    jobId,
    stockNumber: overrides.stockNumber || jobId.toUpperCase(),
    make: 'Ford',
    model: 'F-150',
    status: overrides.status || 'in_progress',
    detailerName: overrides.detailerName || 'Alex',
    operationalUserId: overrides.operationalUserId,
    detailers: [overrides.detailerName || 'Alex'],
    startTime: overrides.startTime || now,
    endTime: overrides.endTime ?? null,
    totalActiveTime: overrides.totalActiveTime || 0,
    totalPauseTime: 0,
    createdAt: now,
    updatedAt: overrides.updatedAt || now,
    notes: [],
    photos: [],
    custodyEvents: [],
    pauseEvents: [],
  };
  const { body } = await svc('jobs', {
    method: 'POST',
    headers: { ...svcH, Prefer: 'return=representation' },
    body: JSON.stringify({
      dealership_id: dealershipId,
      legacy_job_id: jobId,
      status: payload.status,
      stock_number: payload.stockNumber,
      make: payload.make,
      model: payload.model,
      started_at: iso(payload.startTime),
      ended_at: payload.endTime ? iso(payload.endTime) : null,
      total_active_ms: payload.totalActiveTime,
      client_updated_at: iso(payload.updatedAt),
      payload,
    }),
  });
  return { id: body?.[0]?.id, jobId, payload, status: body?.[0] ? 201 : 400 };
};

test.before(async () => {
  world.alpha.id = await createDealership(`IT Alpha ${RUN}`, `it-alpha-${RUN}`);
  world.beta.id = await createDealership(`IT Beta ${RUN}`, `it-beta-${RUN}`);

  world.alpha.detailerEmail = `${RUN}-a-det@shinetime.test`;
  world.alpha.managerEmail = `${RUN}-a-mgr@shinetime.test`;
  world.beta.detailerEmail = `${RUN}-b-det@shinetime.test`;

  await createUser(world.alpha.detailerEmail, 'Passw0rd!23', 'detailer', world.alpha.id);
  await createUser(world.alpha.managerEmail, 'Passw0rd!23', 'owner', world.alpha.id);
  await createUser(world.beta.detailerEmail, 'Passw0rd!23', 'detailer', world.beta.id);

  world.alpha.detailerToken = await signIn(world.alpha.detailerEmail, 'Passw0rd!23');
  world.alpha.managerToken = await signIn(world.alpha.managerEmail, 'Passw0rd!23');
  world.beta.detailerToken = await signIn(world.beta.detailerEmail, 'Passw0rd!23');
});

test.after(async () => {
  await svc(`dealerships?slug=like.it-*-${RUN}`, { method: 'DELETE' });
  await svc(`dealerships?id=eq.${world.alpha.id}`, { method: 'DELETE' });
  await svc(`dealerships?id=eq.${world.beta.id}`, { method: 'DELETE' });
  for (const id of world.users) {
    await fetch(`${BASE}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcH });
  }
});

// =========================================================================
// A. Authentication & tenant isolation — the real security boundary
// =========================================================================

test('auth: a valid dealership login succeeds', async () => {
  assert.ok(world.alpha.detailerToken, 'detailer should get a token');
  assert.ok(world.alpha.managerToken, 'manager should get a token');
});

test('auth: a wrong password is rejected', async () => {
  const token = await signIn(world.alpha.detailerEmail, 'wrong-password');
  assert.strictEqual(token, null);
});

test('RLS: an anonymous caller cannot read any jobs', async () => {
  await seedJob(world.alpha.id);
  const { body } = await asUser(null, `jobs?select=id`);
  assert.ok(Array.isArray(body) ? body.length === 0 : true, 'anon must not see jobs');
});

test('RLS: a member can read their own dealership jobs', async () => {
  await seedJob(world.alpha.id, { stockNumber: `${RUN}-OWN` });
  const { body } = await asUser(world.alpha.detailerToken, `jobs?select=id,stock_number`);
  assert.ok(Array.isArray(body) && body.length > 0, 'member should see own jobs');
});

test('RLS: TENANT ISOLATION — dealership B cannot read dealership A jobs', async () => {
  await seedJob(world.alpha.id, { stockNumber: `${RUN}-SECRET` });
  const { body } = await asUser(
    world.beta.detailerToken,
    `jobs?dealership_id=eq.${world.alpha.id}&select=id,stock_number`,
  );
  assert.deepStrictEqual(body, [], 'cross-tenant read must return nothing');
});

test('RLS: a member cannot insert a job into another dealership', async () => {
  const res = await asUser(world.beta.detailerToken, 'jobs', {
    method: 'POST',
    body: JSON.stringify({
      dealership_id: world.alpha.id,
      legacy_job_id: `${RUN}_cross`,
      status: 'in_progress',
      stock_number: `${RUN}-CROSS`,
      payload: {},
    }),
  });
  assert.ok(res.status >= 400, `cross-tenant insert must fail, got ${res.status}`);
});

// =========================================================================
// B. Job lifecycle as it lands in Postgres
// =========================================================================

test('lifecycle: a job is created with its vehicle fields intact', async () => {
  const { id, jobId } = await seedJob(world.alpha.id, { stockNumber: `${RUN}-LIFE` });
  const { body } = await svc(`jobs?id=eq.${id}&select=stock_number,make,model,status,payload`);
  assert.strictEqual(body[0].stock_number, `${RUN}-LIFE`);
  assert.strictEqual(body[0].status, 'in_progress');
  assert.strictEqual(body[0].payload.jobId, jobId);
});

test('lifecycle: pause/resume/complete durations are consistent', async () => {
  const start = Date.now() - 3600000;
  const pausedFor = 600000;
  const end = Date.now();
  const active = computeActiveTime(start, end, pausedFor);
  const { id } = await seedJob(world.alpha.id, {
    stockNumber: `${RUN}-DUR`,
    status: 'completed',
    startTime: start,
    endTime: end,
    totalActiveTime: active,
  });
  const { body } = await svc(`jobs?id=eq.${id}&select=total_active_ms,payload`);
  assert.strictEqual(Number(body[0].total_active_ms), active);
  assert.ok(active > 0 && active < end - start, 'active time excludes the pause');
});

test('lifecycle: work logs record the full start->complete sequence', async () => {
  const { id } = await seedJob(world.alpha.id, { stockNumber: `${RUN}-LOGS` });
  for (const [i, type] of ['start', 'pause', 'resume', 'complete'].entries()) {
    await svc('job_work_logs', {
      method: 'POST',
      body: JSON.stringify({
        job_id: id,
        dealership_id: world.alpha.id,
        event_type: type,
        actor_name: 'Alex',
        event_at: iso(Date.now() + i * 1000),
      }),
    });
  }
  const { body } = await svc(`job_work_logs?job_id=eq.${id}&select=event_type&order=event_at.asc`);
  assert.deepStrictEqual(
    body.map((r) => r.event_type),
    ['start', 'pause', 'resume', 'complete'],
  );
});

test('lifecycle: notes persist and are readable by the dealership', async () => {
  const { id } = await seedJob(world.alpha.id, { stockNumber: `${RUN}-NOTE` });
  await svc('job_notes', {
    method: 'POST',
    body: JSON.stringify({
      job_id: id,
      dealership_id: world.alpha.id,
      author_name: 'Alex',
      note: 'scratch < 2in on door',
    }),
  });
  const { body } = await asUser(world.alpha.detailerToken, `job_notes?job_id=eq.${id}&select=note`);
  assert.strictEqual(body[0].note, 'scratch < 2in on door', 'note must survive verbatim');
});

test('integrity: a second ACTIVE job on the same stock number is rejected', async () => {
  const stock = `${RUN}-DUPE`;
  const first = await seedJob(world.alpha.id, { stockNumber: stock });
  assert.ok(first.id, 'first job should be created');
  const res = await svc('jobs', {
    method: 'POST',
    body: JSON.stringify({
      dealership_id: world.alpha.id,
      legacy_job_id: `${RUN}_dupe2`,
      status: 'in_progress',
      stock_number: stock,
      payload: {},
    }),
  });
  assert.strictEqual(res.status, 409, 'unique active-stock index must reject the duplicate');
});

// =========================================================================
// C. Sync engine — offline reconcile semantics
// =========================================================================

test('sync: a server-deleted job is dropped locally (zombie fix)', async () => {
  const { id, jobId, payload } = await seedJob(world.alpha.id, { stockNumber: `${RUN}-ZOMB` });
  const local = [{ ...payload, syncedAt: Date.now() - 1000 }];
  await svc(`jobs?id=eq.${id}`, { method: 'DELETE' });

  const { body } = await svc(
    `jobs?dealership_id=eq.${world.alpha.id}&deleted_at=is.null&select=legacy_job_id`,
  );
  const liveIds = body.map((r) => r.legacy_job_id);
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, [], liveIds);
  assert.deepStrictEqual(deletedJobIds, [jobId]);
  assert.strictEqual(jobs.length, 0);
});

test('sync: a never-synced offline creation survives reconcile', async () => {
  const local = [{ jobId: `${RUN}_offline`, updatedAt: 5, createdAt: 5 }]; // no syncedAt
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, [], []);
  assert.strictEqual(jobs.length, 1);
  assert.deepStrictEqual(deletedJobIds, []);
});

test('sync: an out-of-scope job alive on the server is not treated as deleted', async () => {
  const local = [{ jobId: 'other_detailer_job', updatedAt: 1, createdAt: 1, syncedAt: 1 }];
  const { jobs, deletedJobIds } = reconcileJobsWithRemote(local, [], ['other_detailer_job']);
  assert.strictEqual(jobs.length, 1);
  assert.deepStrictEqual(deletedJobIds, []);
});

test('sync: conflict resolution keeps whichever side is newer', async () => {
  const base = { jobId: 'c1', createdAt: 1, syncedAt: 1 };
  const localNewer = reconcileJobsWithRemote(
    [{ ...base, updatedAt: 900, v: 'local' }],
    [{ ...base, updatedAt: 100, v: 'remote' }],
    ['c1'],
  );
  assert.strictEqual(localNewer.jobs[0].v, 'local');

  const remoteNewer = reconcileJobsWithRemote(
    [{ ...base, updatedAt: 100, v: 'local' }],
    [{ ...base, updatedAt: 900, v: 'remote' }],
    ['c1'],
  );
  assert.strictEqual(remoteNewer.jobs[0].v, 'remote');
});

test('sync: pending writes are surfaced to the detailer', () => {
  assert.strictEqual(describeSyncStatus({ pendingCount: 0, lastError: null }), null);
  assert.strictEqual(describeSyncStatus({ pendingCount: 2 }).tone, 'warning');
  assert.strictEqual(describeSyncStatus({ lastError: 'offline' }).tone, 'error');
});

// =========================================================================
// D. Manager actions & the completed-job lock
// =========================================================================

test('manager: a COMPLETED job is locked against a detailer', async () => {
  const { id } = await seedJob(world.alpha.id, {
    stockNumber: `${RUN}-LOCK`,
    status: 'completed',
    endTime: Date.now(),
  });
  const res = await asUser(world.alpha.detailerToken, `jobs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress' }),
  });
  assert.ok(res.status >= 400, `detailer must not edit a completed job (got ${res.status})`);
});

test('manager: reopen-for-rework flips a completed job to needs_rework', async () => {
  const { id, payload } = await seedJob(world.alpha.id, {
    stockNumber: `${RUN}-RWRK`,
    status: 'completed',
    endTime: Date.now(),
  });
  const next = { ...payload, status: 'needs_rework', endTime: null, updatedAt: Date.now() };
  const res = await asUser(world.alpha.managerToken, `jobs?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'needs_rework',
      payload: next,
      ended_at: null,
      client_updated_at: iso(Date.now()),
    }),
  });
  assert.ok(res.status < 300, `manager should pass the lock (got ${res.status})`);
  const { body } = await svc(`jobs?id=eq.${id}&select=status,payload`);
  assert.strictEqual(body[0].status, 'needs_rework');
  assert.strictEqual(body[0].payload.endTime, null);
});

test('manager: reassigning moves job visibility to the new detailer', async () => {
  const payload = {
    jobId: 'r1',
    detailerName: 'Alex',
    operationalUserId: 'du_alex',
    detailers: ['Alex'],
  };
  const reassigned = { ...payload, detailerName: 'Jordan', detailers: ['Alex', 'Jordan'] };
  delete reassigned.operationalUserId;

  assert.strictEqual(jobBelongsToOperator(payload, 'du_alex', 'Alex'), true);
  assert.strictEqual(jobBelongsToOperator(reassigned, 'du_jordan', 'Jordan'), true);
  assert.strictEqual(jobBelongsToOperator(reassigned, 'du_alex', 'Alex'), false);
});

test("manager: a manager's change is newer, so the device accepts it", async () => {
  const startedAt = Date.now() - 60000;
  const local = [
    { jobId: 'm1', status: 'completed', updatedAt: startedAt, createdAt: startedAt, syncedAt: 1 },
  ];
  const remote = [
    { jobId: 'm1', status: 'needs_rework', updatedAt: Date.now(), createdAt: startedAt },
  ];
  const { jobs } = reconcileJobsWithRemote(local, remote, ['m1']);
  assert.strictEqual(jobs[0].status, 'needs_rework');
});

// =========================================================================
// E. Photo upload — the ArrayBuffer path the app actually uses
// =========================================================================

test('photos: base64 decodes to the exact original bytes', () => {
  const { decode } = require('base64-arraybuffer');
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const roundTripped = Buffer.from(decode(original.toString('base64')));
  assert.deepStrictEqual(roundTripped, original, 'decode must be byte-exact');
});

test('photos: a decoded ArrayBuffer uploads to the job-photos bucket and reads back', async () => {
  const { decode } = require('base64-arraybuffer');
  // 1x1 transparent PNG.
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const bytes = decode(b64); // exactly what addJobPhoto does — NOT fetch(data:)
  const objectPath = `${world.alpha.id}/${RUN}/upload-test.png`;

  const put = await fetch(`${BASE}/storage/v1/object/job-photos/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: Buffer.from(bytes),
  });
  assert.ok(put.status < 300, `upload should succeed, got ${put.status} ${await put.text()}`);

  // A signed URL must be mintable and serve back the identical bytes.
  const signed = await fetch(`${BASE}/storage/v1/object/sign/job-photos/${objectPath}`, {
    method: 'POST',
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  assert.strictEqual(signed.status, 200, 'signed URL should be issued');
  const { signedURL } = await signed.json();
  const fetched = await fetch(`${BASE}/storage/v1${signedURL}`);
  const downloaded = Buffer.from(await fetched.arrayBuffer());
  assert.deepStrictEqual(downloaded, Buffer.from(bytes), 'downloaded bytes must match the upload');

  await fetch(`${BASE}/storage/v1/object/job-photos/${objectPath}`, {
    method: 'DELETE',
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
  });
});

test('photos: the photo row is written so the image survives signed-URL expiry', async () => {
  const { id } = await seedJob(world.alpha.id, { stockNumber: `${RUN}-PHOTO` });
  const storagePath = `${world.alpha.id}/${id}/x.png`;
  const res = await svc('job_photos', {
    method: 'POST',
    body: JSON.stringify({
      job_id: id,
      dealership_id: world.alpha.id,
      uploaded_by_name: 'Alex',
      storage_path: storagePath,
      metadata: { mimeType: 'image/png' },
    }),
  });
  assert.ok(res.status < 300, 'photo metadata row must persist');
  const { body } = await svc(`job_photos?job_id=eq.${id}&select=storage_path`);
  assert.strictEqual(body[0].storage_path, storagePath, 'path is recoverable for re-signing');
});

// =========================================================================
// F. Invite-code onboarding (employees never see the dealership login)
// =========================================================================

// Mint a code the way ManageInviteCodesScreen does — as a real manager.
const mintCode = async (token, dealershipId, opts = {}) => {
  const res = await asUser(token, 'rpc/generate_invite_code', {
    method: 'POST',
    body: JSON.stringify({
      p_dealership_id: dealershipId,
      p_role: opts.role || 'detailer',
      p_expires_in_hours: opts.expiresInHours === undefined ? 168 : opts.expiresInHours,
      p_max_uses: opts.maxUses === undefined ? null : opts.maxUses,
    }),
  });
  return typeof res.body === 'string' ? res.body.replace(/"/g, '') : res.body;
};

// Reproduces what the employee-access Edge Function does server-side, so the
// chain it depends on is proven even before the function is deployed.
const enrollEmployee = async (code, name, dealershipSlug) => {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@${dealershipSlug}.employees.shinetime.invalid`;
  const created = await (
    await fetch(`${BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcH,
      body: JSON.stringify({
        email,
        password: `pw-${RUN}-${name}`,
        email_confirm: true,
        user_metadata: { full_name: name },
      }),
    })
  ).json();
  if (created.id) world.users.push(created.id);
  const token = await signIn(email, `pw-${RUN}-${name}`);
  const redeem = await asUser(token, 'rpc/redeem_invite_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: code }),
  });
  return { userId: created.id, email, token, redeem };
};

test('invite: a manager can mint a code for their own dealership', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id);
  assert.match(code, /^[A-Z0-9]{7}$/, `expected a 7-char code, got ${code}`);
});

test('invite: a DETAILER cannot mint codes (manager/owner only)', async () => {
  const res = await asUser(world.alpha.detailerToken, 'rpc/generate_invite_code', {
    method: 'POST',
    body: JSON.stringify({ p_dealership_id: world.alpha.id, p_role: 'detailer' }),
  });
  assert.ok(res.status >= 400, `detailer must not mint codes, got ${res.status}`);
});

test('invite: redeeming enrolls the employee into the code dealership with its role', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id);
  const { userId, redeem } = await enrollEmployee(code, `Ana ${RUN}`, `it-alpha-${RUN}`);
  assert.ok(redeem.status < 300, `redeem should succeed, got ${redeem.status}`);

  const { body } = await svc(
    `dealership_memberships?user_id=eq.${userId}&select=dealership_id,role,is_active`,
  );
  assert.strictEqual(body.length, 1, 'exactly one membership');
  assert.strictEqual(body[0].dealership_id, world.alpha.id);
  assert.strictEqual(body[0].role, 'detailer');
  assert.strictEqual(body[0].is_active, true);
});

test('invite: the enrolled employee gets their OWN user id, not a shared one', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id);
  const a = await enrollEmployee(code, `Bo ${RUN}`, `it-alpha-${RUN}`);
  const b = await enrollEmployee(code, `Cy ${RUN}`, `it-alpha-${RUN}`);
  assert.notStrictEqual(a.userId, b.userId, 'two employees must be distinct accounts');
  assert.notStrictEqual(a.userId, undefined);
});

test('invite: an unknown code is rejected', async () => {
  const { token } = await enrollEmployee(
    await mintCode(world.alpha.managerToken, world.alpha.id),
    `Dee ${RUN}`,
    `it-alpha-${RUN}`,
  );
  const res = await asUser(token, 'rpc/redeem_invite_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: 'ZZZZZZZ' }),
  });
  assert.ok(res.status >= 400, 'unknown code must fail');
});

test('invite: an EXPIRED code is rejected', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id, { expiresInHours: -1 });
  const { redeem } = await enrollEmployee(code, `Eli ${RUN}`, `it-alpha-${RUN}`);
  assert.ok(redeem.status >= 400, 'expired code must fail');
});

test('invite: an EXHAUSTED code is rejected once max_uses is spent', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id, { maxUses: 1 });
  const first = await enrollEmployee(code, `Fay ${RUN}`, `it-alpha-${RUN}`);
  assert.ok(first.redeem.status < 300, 'first use should succeed');
  const second = await enrollEmployee(code, `Gus ${RUN}`, `it-alpha-${RUN}`);
  assert.ok(second.redeem.status >= 400, 'second use must be refused');
});

test('invite: re-redeeming as an existing member does not consume another use', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id, { maxUses: 2 });
  const { token } = await enrollEmployee(code, `Hal ${RUN}`, `it-alpha-${RUN}`);
  const again = await asUser(token, 'rpc/redeem_invite_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: code }),
  });
  assert.ok(again.status < 300, 'idempotent for an existing member');
  const { body } = await svc(`dealership_invite_codes?code=eq.${code}&select=used_count`);
  assert.strictEqual(body[0].used_count, 1, 'used_count must not double-count');
});

test("invite: a code for dealership A never grants access to dealership B's jobs", async () => {
  await seedJob(world.beta.id, { stockNumber: `${RUN}-BETA-SECRET` });
  const code = await mintCode(world.alpha.managerToken, world.alpha.id);
  const { token } = await enrollEmployee(code, `Ivy ${RUN}`, `it-alpha-${RUN}`);
  const { body } = await asUser(token, `jobs?dealership_id=eq.${world.beta.id}&select=id`);
  assert.deepStrictEqual(body, [], 'must not see another tenant');
});

test('invite: jobs created after enrolling are attributed to that employee', async () => {
  const code = await mintCode(world.alpha.managerToken, world.alpha.id);
  const { userId, token } = await enrollEmployee(code, `Jo ${RUN}`, `it-alpha-${RUN}`);
  const res = await asUser(token, 'jobs', {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dealership_id: world.alpha.id,
      legacy_job_id: `${RUN}_attrib`,
      status: 'in_progress',
      stock_number: `${RUN}-ATTRIB`,
      created_by_user_id: userId,
      assigned_detailer_id: userId,
      payload: { jobId: `${RUN}_attrib`, operationalUserId: userId },
    }),
  });
  assert.ok(res.status < 300, `employee should be able to create a job, got ${res.status}`);
  const { body } = await svc(
    `jobs?legacy_job_id=eq.${RUN}_attrib&select=created_by_user_id,assigned_detailer_id`,
  );
  assert.strictEqual(body[0].created_by_user_id, userId, 'real per-person attribution');
  assert.strictEqual(body[0].assigned_detailer_id, userId);
});

test('invite: employee-access Edge Function (skipped until deployed)', async (t) => {
  const res = await fetch(`${BASE}/functions/v1/employee-access`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 404) {
    t.skip(
      'employee-access is not deployed yet — run: npx supabase functions deploy employee-access',
    );
    return;
  }
  // Deployed: an empty body must be rejected by its own validation, not crash.
  assert.ok(
    res.status === 400 || res.status === 500,
    `expected a handled error, got ${res.status}`,
  );
  const body = await res.json();
  assert.ok(body.error, 'function should return a JSON error message');
});

// =========================================================================
// G. Detailer scoping
// =========================================================================

test('scoping: two detailers with the SAME NAME do not see each other jobs', () => {
  const mikeA = { jobId: 'a', detailerName: 'Mike', operationalUserId: 'm1' };
  const mikeB = { jobId: 'b', detailerName: 'Mike', operationalUserId: 'm2' };
  assert.strictEqual(jobBelongsToOperator(mikeA, 'm1', 'Mike'), true);
  assert.strictEqual(jobBelongsToOperator(mikeB, 'm1', 'Mike'), false);
});

test('scoping: legacy jobs without an operator id still match by name', () => {
  const legacy = { jobId: 'l', detailerName: 'Alex' };
  assert.strictEqual(jobBelongsToOperator(legacy, 'du_alex', 'Alex'), true);
  assert.strictEqual(jobBelongsToOperator(legacy, 'du_alex', 'Jordan'), false);
});
