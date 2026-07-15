# Supabase Quick Test

## 1) Set app env vars (Expo)
Create `.env` in repo root:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

## 2) Apply SQL migrations in Supabase SQL editor
Run in order:
- `supabase/migrations/001_phase1_foundation.sql`
- `supabase/migrations/002_phase1_storage.sql`

## 3) Create a test login + membership
PowerShell example:

```powershell
$env:SUPABASE_URL='https://YOUR_PROJECT_REF.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='YOUR_SERVICE_ROLE_KEY'
cmd /c npm --prefix server run supabase:create-test-user -- --email test@shinetime.dev --password Password123! --name "Test Detailer" --dealership "Demo Dealer" --role detailer
```

## 4) Start app
```powershell
npm start -- --web
```

## 5) Sign in
Use credentials from step 3.

Expected result:
- You can sign in.
- If one dealership membership exists, it auto-selects.
- You land in app navigation.

Note:
- Job screens still use legacy API/local storage until Slice 3/4 cutover.