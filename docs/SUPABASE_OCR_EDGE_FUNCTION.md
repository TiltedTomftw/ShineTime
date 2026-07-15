# Supabase OCR Edge Function

This replaces the old Cloudflare-tunneled OCR endpoint with a Supabase Edge Function.

## What Changed
- Mobile OCR now calls `supabase.functions.invoke('ocr-vehicle')`.
- OCR no longer depends on `trycloudflare.com` or local server tunnel uptime.
- Function requires authenticated Supabase user session.

## Deploy Steps
Run from repo root:

```powershell
supabase login
supabase link --project-ref oktqajirertyifyfixfa
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY
supabase functions deploy ocr-vehicle --no-verify-jwt=false
```

## Local Test (Optional)
```powershell
supabase functions serve ocr-vehicle --env-file .env
```

## Client Requirements
Root `.env` must include:

```env
EXPO_PUBLIC_SUPABASE_URL=https://oktqajirertyifyfixfa.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Then restart Expo:

```powershell
npx expo start --tunnel -c
```

## Notes
- `server/.env` OCR key is no longer used by mobile OCR once this function is deployed.
- Keep `GEMINI_API_KEY` only in Supabase function secrets (server-side), not in app env.
