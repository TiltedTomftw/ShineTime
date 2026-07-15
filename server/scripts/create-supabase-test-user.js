/*
  Create a Supabase test user + profile + dealership membership

  Usage:
    node server/scripts/create-supabase-test-user.js --email test@shinetime.dev --password Password123! --name "Test Detailer" --dealership "Demo Dealer" --role detailer

  Required env:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
*/

const { createClient } = require('@supabase/supabase-js');

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function run() {
  const email = getArg('email');
  const password = getArg('password');
  const fullName = getArg('name', 'Test User');
  const dealershipName = getArg('dealership', 'Demo Dealer');
  const role = getArg('role', 'detailer');

  if (!email || !password) {
    throw new Error('Usage requires --email and --password');
  }

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // 1) Create or fetch dealership
  const dealershipSlug = slugify(dealershipName);
  let dealershipId;

  const { data: existingDealer, error: dealerLookupError } = await supabase
    .from('dealerships')
    .select('id,name,slug')
    .eq('slug', dealershipSlug)
    .maybeSingle();

  if (dealerLookupError) throw dealerLookupError;

  if (existingDealer) {
    dealershipId = existingDealer.id;
  } else {
    const { data: createdDealer, error: createDealerError } = await supabase
      .from('dealerships')
      .insert({ name: dealershipName, slug: dealershipSlug })
      .select('id,name,slug')
      .single();

    if (createDealerError) throw createDealerError;
    dealershipId = createdDealer.id;
  }

  // 2) Create auth user (or fetch existing)
  let userId;
  const listResp = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listResp.error) throw listResp.error;

  const existingUser = (listResp.data?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());

  if (existingUser) {
    userId = existingUser.id;
  } else {
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (createUserError) throw createUserError;
    userId = createdUser.user.id;
  }

  // 3) Upsert profile
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, full_name: fullName }, { onConflict: 'user_id' });

  if (profileError) throw profileError;

  // 4) Upsert membership
  const { error: membershipError } = await supabase
    .from('dealership_memberships')
    .upsert(
      {
        dealership_id: dealershipId,
        user_id: userId,
        role,
        is_active: true,
      },
      { onConflict: 'dealership_id,user_id' }
    );

  if (membershipError) throw membershipError;

  console.log('Test login ready');
  console.log(`email: ${email}`);
  console.log(`password: ${password}`);
  console.log(`dealership_id: ${dealershipId}`);
  console.log(`role: ${role}`);
}

run().catch((error) => {
  console.error('Failed to create test login:', error.message || error);
  process.exit(1);
});