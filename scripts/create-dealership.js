// Provision a new dealership and its manager account, in that order.
//
//   dealership  ->  manager (owner)  ->  detailers (via invite codes, in-app)
//
// This is the vendor-side step: you run it once per customer and hand the
// manager their login. Detailers are never created here — the manager mints an
// invite code in the app and each detailer enrols themselves with their own PIN.
//
// Usage:
//   node scripts/create-dealership.js "Ford Motors" manager@fordmotors.com
//   node scripts/create-dealership.js "Ford Motors" manager@fordmotors.com MyPassw0rd
//
// A password is generated if you don't supply one. Reads Supabase credentials
// from repo-root .env (service-role key required).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , dealershipName, managerEmail, providedPassword] = process.argv;

if (!dealershipName || !managerEmail) {
  console.error(
    'Usage: node scripts/create-dealership.js "<Dealership Name>" <manager email> [password]',
  );
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !ANON || !SVC) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const password = providedPassword || `Sh-${crypto.randomBytes(6).toString('base64url')}`;

(async () => {
  // 1. The manager's account. create_dealership() makes its CALLER the owner, so
  //    the account has to exist first — but the dealership is still what we're
  //    provisioning, with the manager created underneath it.
  const createRes = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcH,
    body: JSON.stringify({
      email: managerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: `${dealershipName} Manager` },
    }),
  });
  const user = await createRes.json();
  if (!user.id) {
    console.error(
      `Could not create the manager account: ${user.msg || user.message || JSON.stringify(user)}`,
    );
    process.exit(1);
  }

  await fetch(`${BASE}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...svcH, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, full_name: `${dealershipName} Manager` }),
  });

  // 2. Create the dealership AS that manager, so the existing (tested) RPC does
  //    the slug generation and owner membership in one transaction.
  const tokenRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: managerEmail, password }),
  });
  const { access_token: token } = await tokenRes.json();
  if (!token) {
    console.error('Created the account but could not sign in as it.');
    process.exit(1);
  }

  const dealerRes = await fetch(`${BASE}/rest/v1/rpc/create_dealership`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: dealershipName }),
  });
  const dealership = await dealerRes.json();
  if (!dealership?.id) {
    console.error(`Could not create the dealership: ${JSON.stringify(dealership)}`);
    // Don't leave a stranded account behind.
    await fetch(`${BASE}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: svcH });
    process.exit(1);
  }

  const membership = await (
    await fetch(`${BASE}/rest/v1/dealership_memberships?user_id=eq.${user.id}&select=role`, {
      headers: svcH,
    })
  ).json();

  console.log(`
✅ Dealership provisioned

   Dealership : ${dealership.name}
   UUID       : ${dealership.id}
   Manager    : ${managerEmail}
   Password   : ${password}
   Role       : ${membership[0]?.role || 'unknown'}

   Dashboard  : https://tiltedtomftw.github.io/shinetime-dashboard/?d=${dealership.id}

   Next: the manager signs into the app (Manager sign-in), opens
   "+ Invite Team Member" to mint a code, and each detailer enters that code
   with their own name and PIN. Detailers never see this password.
`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
