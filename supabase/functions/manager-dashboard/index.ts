const html = (supabaseUrl: string, supabaseAnonKey: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Manager Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f7f7fb; color: #111; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    input, button, select { padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
    .muted { color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 13px; }
    .ok { color: #0a7d35; } .err { color: #b42318; }
  </style>
</head>
<body>
  <h2>Manager Dashboard</h2>
  <div class="muted">Supabase Edge Function hosted page</div>

  <div class="card">
    <div class="row">
      <input id="dealershipId" placeholder="Dealership UUID" style="min-width:320px;" />
      <button onclick="saveDealer()">Use Dealership</button>
    </div>
    <div class="row">
      <input id="email" placeholder="Manager email" />
      <input id="password" placeholder="Password" type="password" />
      <button onclick="signIn()">Sign In</button>
      <button onclick="signOut()">Sign Out</button>
      <button onclick="loadJobs()">Refresh</button>
    </div>
    <div id="status" class="muted"></div>
  </div>

  <div class="card">
    <div id="stats">No data yet</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Stock</th><th>Vehicle</th><th>Status</th><th>Detailer</th><th>Created</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <script>
    const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
    const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const params = new URLSearchParams(location.search);
    const dealerFromQuery = params.get('d') || '';
    const dealerFromStorage = localStorage.getItem('manager_dealership_id') || '';
    const dealershipInput = document.getElementById('dealershipId');
    dealershipInput.value = dealerFromQuery || dealerFromStorage;
    if (dealerFromQuery) dealershipInput.readOnly = true;

    function setStatus(msg, ok = true) {
      const el = document.getElementById('status');
      el.className = ok ? 'ok' : 'err';
      el.textContent = msg;
    }

    function saveDealer() {
      const id = dealershipInput.value.trim();
      if (!id) return setStatus('Enter dealership UUID', false);
      localStorage.setItem('manager_dealership_id', id);
      setStatus('Dealership set');
    }

    async function signIn() {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      if (!email || !password) return setStatus('Email and password required', false);
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return setStatus(error.message, false);
      setStatus('Signed in');
      await loadJobs();
    }

    async function signOut() {
      await sb.auth.signOut();
      setStatus('Signed out');
    }

    function mapJob(row) {
      const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
      return {
        stock: p.stockNumber || row.stock_number || '',
        make: p.make || row.make || '',
        model: p.model || row.model || '',
        status: p.status || row.status || 'queued',
        detailer: p.detailerName || (Array.isArray(p.detailers) && p.detailers.length ? p.detailers[p.detailers.length - 1] : 'Unknown'),
        created: p.createdAt ? new Date(p.createdAt).toLocaleString() : new Date(row.created_at).toLocaleString(),
      };
    }

    async function loadJobs() {
      const dealershipId = dealershipInput.value.trim();
      if (!dealershipId) return setStatus('Set dealership UUID first', false);

      const { data: sessData } = await sb.auth.getSession();
      if (!sessData?.session?.user) return setStatus('Sign in first', false);

      const { data, error } = await sb
        .from('jobs')
        .select('status,stock_number,make,model,created_at,payload')
        .eq('dealership_id', dealershipId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) return setStatus(error.message, false);

      const jobs = (data || []).map(mapJob);
      const completed = jobs.filter(j => j.status === 'completed').length;
      const active = jobs.filter(j => j.status === 'in_progress' || j.status === 'paused').length;
      document.getElementById('stats').textContent = 'Total: ' + jobs.length + ' | Completed: ' + completed + ' | Active: ' + active;
      document.getElementById('rows').innerHTML = jobs.map(j =>
        '<tr><td>' + esc(j.stock) + '</td><td>' + esc((j.make + ' ' + j.model).trim()) + '</td><td>' + esc(j.status) + '</td><td>' + esc(j.detailer) + '</td><td>' + esc(j.created) + '</td></tr>'
      ).join('');
      setStatus('Loaded ' + jobs.length + ' jobs');
    }

    function esc(v) {
      const d = document.createElement('div');
      d.textContent = String(v || '');
      return d.innerHTML;
    }

    sb.auth.onAuthStateChange((_e, session) => {
      if (session?.user) setStatus('Signed in as ' + session.user.email);
    });

    loadJobs().catch(() => {});
  </script>
</body>
</html>`;

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response("Missing SUPABASE_URL/SUPABASE_ANON_KEY in function env", { status: 500 });
  }
  return new Response(html(supabaseUrl, supabaseAnonKey), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});

