// Clears ALL jobs for the test dealership (default: Ford Motors) so you can
// re-test from a clean slate. Hard-deletes the jobs, which cascades their
// notes / work-logs / photos. Reads Supabase creds from repo-root .env.
//
// Usage:
//   node scripts/clear-test-jobs.js            (clears Ford Motors)
//   node scripts/clear-test-jobs.js <UUID>     (clears a specific dealership)
//
// NOTE: server-side only. If a detailer's phone still has jobs cached, close
// the app (or log out) so its offline copy doesn't re-sync them back.

const fs = require('fs');
const path = require('path');

const FORD_MOTORS = '73110a24-5c56-4cf2-911f-3a68e4b4246b';
const dealershipId = process.argv[2] || FORD_MOTORS;

const env = {};
for (const line of fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const base = env.EXPO_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !svc) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const H = { apikey: svc, Authorization: `Bearer ${svc}` };
const get = async (q) => (await fetch(`${base}/rest/v1/${q}`, { headers: H })).json();

(async () => {
  const dealer = await get(`dealerships?id=eq.${dealershipId}&select=name`);
  const name = dealer[0] ? dealer[0].name : '(unknown dealership)';
  const before = await get(`jobs?dealership_id=eq.${dealershipId}&select=id`);
  console.log(`Dealership : ${name}`);
  console.log(`UUID       : ${dealershipId}`);
  console.log(`Jobs found : ${before.length}`);
  if (before.length === 0) {
    console.log('Already clean — nothing to delete.');
    return;
  }
  const res = await fetch(`${base}/rest/v1/jobs?dealership_id=eq.${dealershipId}`, {
    method: 'DELETE',
    headers: H,
  });
  const after = await get(`jobs?dealership_id=eq.${dealershipId}&select=id`);
  console.log(
    res.status < 300
      ? `\n✅ Cleared ${before.length} job(s) -> ${after.length} remaining.`
      : `\n❌ Delete failed (HTTP ${res.status}).`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
