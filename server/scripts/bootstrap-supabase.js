/*
  One-command Supabase bootstrap:
  1) Apply SQL migrations from /supabase/migrations
  2) Create test user + dealership membership

  Required env:
    SUPABASE_DB_URL                (postgres://... connection string)
    SUPABASE_URL                   (https://<ref>.supabase.co)
    SUPABASE_SERVICE_ROLE_KEY

  Optional env:
    TEST_EMAIL (default testdealer001@shinetime.dev)
    TEST_PASSWORD (default TestDealer001!)
    TEST_NAME (default TestDealer001)
    TEST_DEALERSHIP (default TestDealer001)
    TEST_ROLE (default detailer)
*/

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function runMigrations() {
  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const migrationsDir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsDir}`);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying migration: ${file}`);
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function createTestUser() {
  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = process.env.TEST_EMAIL || 'testdealer001@shinetime.dev';
  const password = process.env.TEST_PASSWORD || 'TestDealer001!';
  const fullName = process.env.TEST_NAME || 'TestDealer001';
  const dealershipName = process.env.TEST_DEALERSHIP || 'TestDealer001';
  const role = process.env.TEST_ROLE || 'detailer';

  const dealershipSlug = slugify(dealershipName);

  let dealershipId;
  const { data: existingDealer, error: lookupDealerError } = await supabase
    .from('dealerships')
    .select('id,slug')
    .eq('slug', dealershipSlug)
    .maybeSingle();

  if (lookupDealerError) throw lookupDealerError;

  if (existingDealer) {
    dealershipId = existingDealer.id;
  } else {
    const { data: createdDealer, error: createDealerError } = await supabase
      .from('dealerships')
      .insert({ name: dealershipName, slug: dealershipSlug })
      .select('id')
      .single();

    if (createDealerError) throw createDealerError;
    dealershipId = createdDealer.id;
  }

  const listResp = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listResp.error) throw listResp.error;

  const existingUser = (listResp.data?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
  let userId;

  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createUserError) throw createUserError;
    userId = createdUser.user.id;
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, full_name: fullName }, { onConflict: 'user_id' });
  if (profileError) throw profileError;

  const { error: membershipError } = await supabase
    .from('dealership_memberships')
    .upsert(
      { dealership_id: dealershipId, user_id: userId, role, is_active: true },
      { onConflict: 'dealership_id,user_id' }
    );
  if (membershipError) throw membershipError;

  console.log('Bootstrap complete');
  console.log(`email: ${email}`);
  console.log(`password: ${password}`);
  console.log(`dealership: ${dealershipName}`);
  console.log(`role: ${role}`);
}

(async () => {
  await runMigrations();
  await createTestUser();
})().catch((error) => {
  console.error('Bootstrap failed:', error.message || error);
  process.exit(1);
});