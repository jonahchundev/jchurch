# Plan: Cosmos attendance transfer serialization

## Report and hypothesis
Deployed merge reports `Merge stopped during attendance ... The check-in could
not be moved.` This is the fallback in CosmosRepository.Transfer, not archival.
Transfer stamps an Attendance into a Document variable and passes that base type
to generic Cosmos batch methods. The production serializer uses the inferred
type, potentially dropping occurrenceId and other derived attendance properties.
Missing occurrenceId conflicts with the attendance partition key. The deployed
HTTP/substatus has not been inspected; do not claim a confirmed production 400.

## Implementation
1. Capture the actual SDK batch payload using a test serializer that delegates to
   CosmosJsonSerializer and deliberately stops before execution/network access.
   Cover CreateItem and ReplaceItem and assert all attendance fields survive.
2. Preserve the concrete attendance type after timestamp stamping, matching the
   existing normal Create/Replace paths. No global serializer behavior change.
3. Add direct Transfer cases to the shared in-memory/opt-in Cosmos contract:
   absent/inactive keeper slots, source deletion, count preservation, history,
   conflicts, stale source/destination versions and rollback. Clean up fixtures.
4. Add privacy-safe failed-batch diagnostics: effective status, failed operation,
   Cosmos activity ID and opaque receipt/occurrence IDs, never document payloads
   or member contact details. Keep status semantics, version checks and archive-last.
5. Run focused and full backend suites. Cosmos data-plane tests require approved
   synthetic database access and remain opt-in. Do not deploy or edit real data.

## Recovery and limits
The failed per-occurrence transaction rolls back its own changes, but earlier
successful occurrence transactions may remain saved. After a separately approved
release, Reload and review the affected pair before confirming remaining work.
Never manually archive to conceal a failure or retry invalid payloads as contention.

## Verification
- Branch: `fix/cosmos-attendance-transfer`, based on the previously pushed merge
   and attendance-report changes. No commit or push was requested for this follow-up.
- Confirmed locally: both SDK batch branches serialized the destination as Document
   and omitted occurrenceId. Both new tests failed with `Transfer payload lost the
   attendance partition key` before the fix and passed after concrete Attendance
   typing. Tests call the real repository and SDK batch builder, delegating to the
   production serializer and stopping before batch execution; no network or data writes.
- Payload assertions retain occurrence/member/event IDs, checkedInAt, active state,
   group snapshots, audit, kind and server timestamps for create and inactive replace.
- Shared contract now covers successful create/replace, original history and
   headcount, active-slot conflict and stale source/destination rollback. Cosmos
   integration cleanup includes the additional synthetic transfer receipts.
- Added safe status/operation/activity-ID diagnostics for failed transfer batches.
   Existing archive-last, ETag and failure classification behavior is unchanged.
- Focused payload, contract and merge tests: 16 passed. Full backend suite:
   118 passed, one opt-in Cosmos test skipped. Build, editor diagnostics and
   `git diff --check` passed.
- Live Cosmos provider validation is still pending approved synthetic-data access.
   This reproduces and fixes the serialization defect, but the screenshot's actual
   server status/substatus has not been read. No infrastructure changes, deployment
   or changes to affected member data were performed.