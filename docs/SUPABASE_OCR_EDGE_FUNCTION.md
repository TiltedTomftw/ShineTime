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
# JWT verification stays ON for this function (it requires a signed-in user):
supabase functions deploy ocr-vehicle
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
- The old local server has been removed; mobile OCR runs entirely through this function.
- Keep `GEMINI_API_KEY` only in Supabase function secrets (server-side), not in app env.
- The function also caps image size and validates the mime type before calling Gemini.
