# RLS Verification Checklist (Detailer + Manager)

Run these checks in staging before production rollout.

## Preconditions
- At least 2 dealerships: `dealer_a`, `dealer_b`
- Test users:
  - `detailer_a` (member of dealer_a, role detailer)
  - `manager_a` (member of dealer_a, role manager)
  - `detailer_b` (member of dealer_b, role detailer)

## 1) Jobs isolation
- Sign in as `detailer_a`
- Query `jobs` for `dealer_a`: should return only dealer_a rows
- Query `jobs` without dealership filter: should still never return dealer_b rows
- Attempt read of known dealer_b row id: should return empty / denied

## 2) Notes/logs/photos isolation
- As `detailer_a`, add note/photo/log to dealer_a job
- Confirm rows appear in `job_notes`, `job_work_logs`, `job_photos`
- Attempt fetch rows tied to dealer_b job: blocked by RLS

## 3) Role behavior
- As `detailer_a`, attempt delete a job/photo row: should fail
- As `manager_a`, delete should succeed where policy allows

## 4) Membership enforcement
- Remove or deactivate `detailer_a` membership (`is_active=false`)
- Re-test reads/writes: should fail immediately

## 5) Cross-tenant object storage
- Upload path using dealer_a prefix as `detailer_a`: allowed
- Attempt upload/delete with dealer_b prefix as `detailer_a`: blocked

## 6) App-level smoke
- Sign in as detailer
- Create job, add note, pause/resume, add photo
- Confirm:
  - `jobs.payload` updated
  - normalized rows created in tables
  - job detail screen shows normalized notes/work logs/photos