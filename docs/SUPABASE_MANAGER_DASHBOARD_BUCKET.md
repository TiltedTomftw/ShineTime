# Manager Dashboard via Supabase Storage Bucket

Use this file:
- `server/public/manager.html`

## One-time setup (Supabase Dashboard)
1. Go to **Storage** -> **Create bucket**
2. Name: `web`
3. Access: **Public**
4. Upload `server/public/manager.html` as `manager.html`
5. Ensure file content type is `text/html`

## Link format
```
https://oktqajirertyifyfixfa.supabase.co/storage/v1/object/public/web/manager.html?d=DEALERSHIP_UUID&name=Dealer%20Name
```

## First open behavior
- Page reads `d` from URL and locks to that dealership.
- If anon/publishable key is not cached yet, it prompts once and saves it in browser local storage.
- Manager signs in with email/password, then jobs load from Supabase directly.

