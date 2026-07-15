# Supabase Migration Plan (Incremental Slices)

## Goal
Migrate DetailTracker from local Node + SQLite to Supabase with minimal breakage, strong tenant isolation, and production-safe auth + RLS.

## Ground Rules
- Preserve current app behavior first; improve model depth later.
- Security and tenant isolation are non-negotiable.
- Keep legacy JSON payload during Phase 1 for compatibility.
- Move in small slices with verification gates and rollback points.

## Phase 0 - Preflight (1 day)
Status: Planned

### Deliverables
- Supabase project created (staging first).
- Environment variables strategy agreed (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
- Dealer test accounts created.
- Baseline backup of SQLite DB file.

### Verification Gate
- Team can sign into Supabase dashboard.
- SQLite backup restorable.

## Phase 1 - Compatibility Migration (Primary)

### Slice 1 - Database Foundation
Status: Completed

#### Scope
- Create Phase 1 schema in Postgres.
- Add tenancy tables (`dealerships`, `profiles`, `dealership_memberships`).
- Add `jobs` table with structured columns + `payload jsonb` compatibility.
- Add `job_work_logs`, `job_notes`, `job_issue_flags`, `job_photos`.
- Add constraints/indexes including one-active-job-per-vehicle.
- Add RLS helper functions and policies.
- Add `updated_at` triggers.
- Add RPCs for:
  - `create_or_get_active_job`
  - `transfer_job_ownership`
  - `sync_jobs_batch`

#### Exit Criteria
- SQL migration runs cleanly on empty database.
- RLS blocks cross-tenant reads/writes in manual SQL tests.

### Slice 2 - Auth + Membership Bootstrap
Status: Completed

#### Scope
- Add app auth flow (Supabase Auth).
- Ensure profile row creation on first login.
- Load membership list and choose active dealership.

#### Exit Criteria
- User can log in and fetch only allowed dealership rows.

### Slice 3 - Jobs Read Path Cutover
Status: Completed

#### Scope
- Replace old GET jobs endpoints in mobile app with Supabase `select`.
- Keep AsyncStorage local cache behavior.

#### Exit Criteria
- Home/History/InProgress render from Supabase data with existing UX intact.

### Slice 4 - Jobs Write/Sync Cutover
Status: In Progress

#### Scope
- Replace POST `/api/jobs` with upsert/RPC.
- Replace POST `/api/jobs/sync` with `sync_jobs_batch` RPC.
- Enforce stale update protection using `client_updated_at`.

#### Exit Criteria
- New jobs, pause/resume, complete, notes all persist without local API server.

### Slice 5 - Photos to Supabase Storage
Status: In Progress

#### Scope
- Upload photos to private Storage bucket.
- Persist storage metadata in `job_photos`.
- Use signed URLs for reads.

#### Exit Criteria
- Photos upload/view works across networks; tenant access isolation verified.

### Slice 6 - Data Backfill Script
Status: Planned

#### Scope
- Script reads SQLite rows and maps to Supabase jobs + child rows.
- Idempotent upsert by `(dealership_id, legacy_job_id)`.

#### Exit Criteria
- Backfill run report includes migrated counts and mismatch checks.

### Slice 7 - Dealership-First Onboarding + Detailer Quick Login
Status: Planned

#### Scope
- Replace email-first mobile onboarding with dealership-first access.
- Add `Dealership Access` step:
  - enter dealership code (or manager-provided invite code)
  - validate membership context before entering app
- Add `Detailer Identity` step in dealership context:
  - select existing detailer profile and unlock with PIN/passkey
  - or create new detailer profile (name + PIN/passkey) if allowed
- Persist remembered dealership + detailer identity on-device for auto-entry.
- Keep hidden manager/admin email login path for account management and recovery.
- Enforce tenant-safe lookup:
  - detailer discovery and sign-in must be dealership-scoped only
  - no cross-dealership identity enumeration
- Add migration compatibility layer:
  - map selected detailer identity to existing Supabase auth/profile membership model
  - keep current session persistence behavior

#### Security/Policy Requirements
- PIN/passkey verification must be server-validated (no client-only trust).
- Rate-limit identity unlock attempts.
- Support manager reset flow for locked-out detailers.
- Log identity handoff/login events to `job_work_logs` or dedicated auth audit table.

#### Exit Criteria
- New detailer can access app without email/password UX.
- Returning detailer can re-enter app with dealership + PIN/passkey in under 10 seconds.
- Manager/admin can still use full email auth path.
- No cross-dealership identity visibility in API responses.
- Existing users can migrate into new flow without data loss.

## Phase 2 - Normalization Roadmap
Status: Planned

### Scope
- Make structured columns authoritative.
- Reduce payload dependence to non-critical extras.
- Optionally split detailed events/time tracking further for analytics.

### Exit Criteria
- Reporting and workflow queries do not depend on payload JSON.

## Rollback Plan
- Keep old Node+SQLite server available in parallel until Phase 1 Slice 5 passes.
- Keep feature flag to switch mobile data source between local API and Supabase.
- Preserve SQLite snapshot before each migration/backfill run.

## Immediate Next Step
Implement Manager and Sales Supabase cutover first, then continue onboarding hardening.

## Priority Queue (Next Session)
1. Manager Dashboard Supabase Cutover
2. Sales View Supabase Cutover
3. Slice 7 onboarding polish (dealership -> role -> user+PIN)
4. Remaining write-path hardening and migration backfill validation
