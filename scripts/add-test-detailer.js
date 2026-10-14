// Dev helper: add a detailer login to a dealership in one command, for testing.
//
// It goes through the real `employee-access` function (the same path as the
// app's "I'm new here"), so the account is exactly what a real detailer gets.
// A one-use invite code is minted for the purpose and turned off afterwards.
//
// Usage:
//   node scripts/add-test-detailer.js "Alex" 1234
//   node scripts/add-test-detailer.js "Alex" 1234 <dealership id or name>
//
// With no dealership given and only one in the project, that one is used.
// Reads Supabase credentials from repo-root .env (service-role key required).

const fs = require('fs');
const path = require('path');

const [, , name, pin, dealershipArg] = process.argv;
if (!name || !/^\d{4,6}$/.test(pin || '')) {
  console.error(
    'Usage: node scripts/add-test-detailer.js "<Name>" <4-6 digit PIN> [dealership id or name]',
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
const svcHeaders = {
  apikey: SVC,
  Authorization: `Bearer ${SVC}`,
  'Content-Type': 'application/json',
};

const rest = async (query, opts = {}) => {
  const res = await fetch(`${BASE}/rest/v1/${query}`, { headers: svcHeaders, ...opts });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
};

const pickDealership = async () => {
  const all = await rest('dealerships?select=id,name&order=created_at');
  if (dealershipArg) {
    const want = dealershipArg.toLowerCase();
    const hit = all.find((d) => d.id === dealershipArg || d.name.toLowerCase() === want);
    if (!hit)
      throw new Error(
        `No dealership "${dealershipArg}". Have: ${all.map((d) => d.name).join(', ')}`,
      );
    return hit;
  }
  if (all.length !== 1) {
    throw new Error(`Several dealerships; name one: ${all.map((d) => `"${d.name}"`).join(', ')}`);
  }
  return all[0];
};

(async () => {
  const dealership = await pickDealership();
  const code = `T${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()
    .replace(/[01OIL]/g, 'K')}`;
  const [invite] = await rest('dealership_invite_codes', {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      dealership_id: dealership.id,
      code,
      role: 'detailer',
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      max_uses: 1,
      is_active: true,
    }),
  });

  try {
    const res = await fetch(`${BASE}/functions/v1/employee-access`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, name, pin, mode: 'join', confirmNew: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(body.error || `HTTP ${res.status}`);
    console.log(`Added ${name} to ${dealership.name}.`);
    console.log(
      `In the app: "I've signed in before", any ${dealership.name} invite code (e.g. ${code}), name "${name}", PIN ${pin}.`,
    );
  } finally {
    await rest(`dealership_invite_codes?id=eq.${invite.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    }).catch(() => {});
  }
})().catch((e) => {
  console.error(`Could not add the detailer: ${e.message}`);
  process.exit(1);
});
