# Shinetime Manager Dashboard

Standalone, self-contained web page (`index.html`) — the **manager**-facing view,
separate from the React Native detailer app in `../src`. It reads Supabase directly
(publishable key + RLS).

Previously lived in its own repo (`TiltedTomftw/shinetime-dashboard`); consolidated
here so app + dashboard version together.

## Usage

Open the page and sign in with a manager or owner account. The dealership comes
from that account's memberships; managers of several stores get a switcher. Old
links with `?d=DEALERSHIP_UUID` still open that dealership first.

Features:

- Filters: date range (default **Today**), status (incl. Rework), detailer, search.
  Detailer and search filter in the browser, so typing never refetches.
- Cards and Table views, stat tiles, Top detailers, Longest open jobs, Coverage.
- Job details with photos signed fresh from `job_photos` (links never expire on
  screen), notes and history.
- **Reopen for Rework** with a note the detailer sees; the clock holds from the
  original completion time.
- **Reassign** to someone from the team.
- **Team**: staff list with last activity, **Reset PIN**, turn people off/on,
  and new invite codes. These call the `employee-access` Edge Function.

## Deploy

Auto-deploys to GitHub Pages on push to `main` via
[`.github/workflows/deploy-dashboard.yml`](../.github/workflows/deploy-dashboard.yml).
One-time: set **Settings → Pages → Source → GitHub Actions** in the GitHub repo.

It's a single static file — no build step. Edit `index.html` directly.

Tests: `node --test __tests__/integration/dashboard.integration.js` runs the real
page in jsdom with a fake Supabase client (no network).
