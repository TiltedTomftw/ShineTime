# Manager Dashboard via Supabase Edge Function

Deploy:

```powershell
& "C:\Program Files\nodejs\npx.cmd" supabase functions deploy manager-dashboard --project-ref oktqajirertyifyfixfa --no-verify-jwt
```

Open:

```text
https://oktqajirertyifyfixfa.supabase.co/functions/v1/manager-dashboard
```

Per-dealership link format:

```text
https://oktqajirertyifyfixfa.supabase.co/functions/v1/manager-dashboard?d=DEALERSHIP_UUID
```

Notes:
- The page prompts for manager email/password sign-in.
- It reads jobs directly from Supabase `jobs` for the dealership UUID in `d`.
- No separate hosting required.
