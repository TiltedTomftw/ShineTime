# Shinetime Manager Dashboard

Standalone, self-contained web page (`index.html`) — the **manager**-facing view,
separate from the React Native detailer app in `../src`. It reads Supabase directly
(anon/publishable key + RLS) and is scoped to one dealership.

Previously lived in its own repo (`TiltedTomftw/shinetime-dashboard`); consolidated
here so app + dashboard version together.

## Usage

Open per-dealership:

```
https://<pages-host>/ShineTime/?d=DEALERSHIP_UUID
```

The manager signs in with email/password; the publishable anon key is baked in (and
can be overridden once via a prompt, cached in `localStorage`). Features: STATUS /
DATE-RANGE / DETAILER / free-text SEARCH filters, Cards + Compact-Table views, stat
tiles (Completed / Active / Paused / Avg), Top Detailers, Longest Active Jobs, and
Coverage (notes / photos / custody).

## Deploy

Auto-deploys to GitHub Pages on push to `main` via
[`.github/workflows/deploy-dashboard.yml`](../.github/workflows/deploy-dashboard.yml).
One-time: set **Settings → Pages → Source → GitHub Actions** in the GitHub repo.

It's a single static file — no build step. Edit `index.html` directly.
