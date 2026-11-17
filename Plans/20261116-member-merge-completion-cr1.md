# Plan: Reliable member merge completion

## Goal
Complete duplicate-member merges reliably when both members have attendance, and
distinguish an archive failure from a completed merge followed by a slow UI refresh.

## Evidence
- Attendance is processed before the duplicate member is archived. An exception can
  leave earlier attendance changes committed while the duplicate remains active.
- The submitted duplicate ETag is currently checked only at final archive.
- Taking the duplicate's scan code changes its ETag, but archive uses the old ETag.
- The UI waits for member and attendance refetches before showing merge success.
- The API client times out after 15 seconds; a timeout does not prove rollback.

## Implementation
1. Add regression tests for stale versions, scan-code takeover, mixed attendance,
   partial failure and retry, and delayed refresh after confirmed success.
2. Validate member versions before writes; retain the updated duplicate version
   after service-owned changes. Keep archive last and await it before success.
3. Reconcile each occurrence using fresh receipts, bounded conflict retries, and
   atomic move/dedupe operations guarded by both receipt versions. Preserve original
   check-in timestamps, group snapshots, audit history, and headcount semantics.
4. Verify no active duplicate attendance remains before archive. Add stage-level
   diagnostics without names, contact details, or scan codes.
5. Show confirmed success without awaiting list refetches, update cached member
   lists, and invalidate attendance, summaries, and occurrence counts in background.
6. Add reload/review recovery for conflicts and check-status recovery for uncertain
   outcomes. Refresh both member snapshots and preview; do not blindly retry POSTs.
7. Test focused and full backend suites, frontend unit/type checks, and desktop/mobile
   merge workflows. Run Cosmos integration only with approved synthetic-data access.

## Invariants and limits
- Unique attendance moves preserve session headcount; same-session overlaps reduce
  headcount by exactly one. Keeper stays active; removed member becomes inactive.
- Stale initial member versions must fail before writes. Do not ignore ETags or
  archive first. Previously committed occurrence work must remain retryable.
- Cosmos transactions cover one occurrence partition, not all attendance plus the
  member directory. This is not a globally atomic merge or a distributed lock.
- A final remaining-attendance check narrows but cannot eliminate concurrent new
  check-ins at the archive boundary. Durable coordination is separate future work.
- No infrastructure, deployment, duplicate-matching, photo, or authorization changes.

## Verification
- Backend: merge service regression tests and shared repository contract, then full
  `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
- Frontend: `npm test`, `npm run typecheck`, and merge workflow Playwright tests on
  desktop and mobile, including delayed refresh, stale versions, and unknown outcomes.
- Opt-in Cosmos contract requires `JCHURCH_RUN_COSMOS_TESTS=true`, endpoint/database
  settings and data-plane access. In-memory tests cannot establish Cosmos behavior.
- Smoke/manual: retrieve both members after merge; keeper active, duplicate inactive;
  verify preserved historical attendance and correct session/report totals.

## Results
- Branch: `fix/member-merge-completion`.
- Implemented early version validation, updated archive ETag after scan-code release,
  fresh receipt classification, three bounded conflict attempts, four-way bounded
  occurrence processing, two-version atomic overlap dedupe, remaining-attendance
  verification, and completion/failure stage diagnostics.
- Implemented immediate confirmed-success UI/cache updates, background invalidation,
  refreshed member/preview recovery, unknown-outcome status checks, preview cancellation,
  and a 60-second merge-only timeout (global default remains 15 seconds).
- Backend: 116 passed, 1 opt-in Cosmos integration test skipped. Focused merge and
  repository checks: 14 passed, including final archive failure/resume, concurrent
  edit/undo, bounded contention, late attendance and 205 historical sessions.
- Browser: all 6 new merge scenarios passed across desktop/mobile, including stalled
  refetch, archive-version recovery and uncertain response recovery without replay.
- HTTP smoke passed against the local in-memory host: overlap, unique moves,
  explicit archived-member reads, scan-code takeover and stale-version rejection.
- Focused API unit tests: 18 passed. Full frontend unit run: 63 passed, 4 failed in
  pre-existing guardian/registration fixtures missing required gender; left unchanged.
- Frontend typecheck passed. Cosmos data-plane tests were not run; no cloud changes.
- Remaining limitations: no global transaction/distributed lock. Optional keeper
  field/scan-code edits can be partially committed if a later write fails; recovery
  reloads current state rather than automatically replaying stale field selections.