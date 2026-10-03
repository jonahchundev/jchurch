# Plan: Duplicate member cleanup (detect → compare → merge)

## Goal
Admin-gated "Duplicate members" screen: find candidate duplicate pairs, compare a pair side by side
with key info, choose which member to keep (with optional per-field picks from the loser), then merge —
the loser's check-ins move to the keeper (original `checkedInAt` preserved) and the loser is archived.

## Confirmed decisions (2026-10-03)
- **Server-side merge endpoint** (new Azure Function) — NOT client-side re-check-in (would lose timestamps).
- **Per-field pick**: keeper kept exactly as-is by default; user can optionally pick individual loser fields.
- **Entry points: both** — Members screen header action + Settings (manage mode) Row.
- **Admins only** — gate with existing `canManageUsers(roleInfo)` (global-admin / church-admin).
- **Occurrence check-in count must stay identical** for every moved check-in (only-loser-checked-in case).
- **Overlap case (both duplicates checked into the SAME occurrence) → drop by 1** (dedupe to real headcount;
  keeper gets 1 receipt, loser's copy archived).

## Count-preserving transfer (CORE CONSTRAINT)
The occurrence/session count = `ActiveCheckInCounts` counts only `active=true` receipts grouped by occurrence
(CosmosRepository.cs L182, InMemoryRepository.cs L155). Attendance ID embeds memberId (`{occurrenceId}_{memberId}`)
and is immutable. A naive create-new + archive-old drops the count in the overlap case AND risks drift on failure.

**Design: per active loser receipt, atomically DELETE `{occId}_{loserId}` + CREATE `{occId}_{keepId}`** in one Cosmos
`TransactionalBatch` (both receipts share partition `/churchId+/occurrenceId` — MultiHash, so batch is supported).
The new receipt preserves `checkedInAt`, EventId, GroupIds/InclusiveGroupIds snapshots; Audit += `merged-from {loserId}`.
Because it's 1-for-1 in the same partition, the active count per occurrence is preserved exactly and atomically.

**Overlap** (keeper already has a receipt for that occurrence): do NOT delete+recreate. Keep the keeper's receipt;
soft-archive the loser's copy (Active=false, Audit += `merged-to {keepId} (duplicate)`). Count drops by 1 = real
dedupe. This is the ONLY case the count changes.

**Requires a NEW per-item delete** on the attendance repository — `IRepository<T>` today has only church-wide
`Purge`, no per-item Delete (IRepository.cs L63-75). Add `Delete`/`Transfer` supporting Cosmos (TransactionalBatch)
and InMemory.

## Matching rule (client-side)
Candidate pair = same normalized first+last name (trim/lowercase) AND ≥1 shared contact point:
- emails: member.email + guardian1.email + guardian2.email (lowercased, trimmed)
- phones: member.phone + guardian phones (digits-only)
Members/pairs with no contact info never match (per the stated rule).
Sort pairs: more match reasons first, then name.

## Backend (Phase A)

### A0. NEW per-item delete on the attendance repository (PREREQUISITE — does not exist today)
- Add attendance-only `Delete(churchId, id, occurrenceId, etag, ct)` to `IRepository<T>` (mirrors the opt-in
  pattern of `ActiveCheckInCounts`/`ResolveScanCode` at IRepository.cs L69-75).
- Cosmos impl: a `TransactionalBatch` in partition `/churchId+/occurrenceId` doing `Delete(loserId, IfMatchEtag)`
  + `Create(keeperReceipt)` atomically. InMemory impl: ETag-checked remove from the `documents` dictionary.

### A1. New `src/jchurchFunction/Services/MemberMergeService.cs` *(depends on A0)*
- `Preview(churchId, keepId, loserId)` → `{ keeperCheckIns, loserCheckIns, movable, skipped }`
  (movable = loser receipts whose occurrence has no keeper receipt; skipped = overlap count).
- `Merge(churchId, keepId, loserId, loserEtag, keeperUpdate?)`:
  1. Load keeper + loser; 404 missing, 400 same-id or either inactive.
  2. `keeperUpdate` = full MemberInput-shaped body built client-side from field picks; validate exactly like
     the `DirectoryService.Save` member path; Replace keeper with its ETag.
     - Scan-code ordering: if update takes the loser's current scan code, first Replace loser with
       `ScanCode=null` (releases `ScanCodeLookup` — archive alone does NOT release it), then update keeper.
  3. Transfer attendance (count-preserving): paged `Search(Query{ ChurchId, MemberId=loserId })`, active only,
     NO date window (service-level search; the 30-day default is AttendanceApi query parsing — VERIFY at impl).
     Per loser receipt:
       - **Non-overlap** (no keeper receipt for that occurrence): ONE TransactionalBatch = Delete
         `{occId}_{loserId}` + Create `{occId}_{keepId}` preserving CheckedInAt/EventId/GroupIds/InclusiveGroupIds,
         Audit += `merged-from {loserId}`. Atomic → occurrence count unchanged even on crash.
       - **Overlap** (keeper receipt exists): keep keeper's; Replace loser receipt Active=false, Audit +=
         `merged-to {keepId} (duplicate)`; skipped++. (Only case the count changes −1 = real dedupe.)
  4. Archive loser (Active=false Replace, `loserEtag`).
  5. Return `{ kept, archived, checkInsMoved, checkInsSkipped }`.
- Idempotency: batch is atomic; rerun after partial failure → moved receipts already gone, overlaps already
  archived → safe to re-Preview + re-Merge. Loser already archived → 409.

### A2. New `src/jchurchFunction/Functions/MemberMergeApi.cs`
- Model on `MemberImageApi.cs`: Route `v1/churches/{churchId}/members/{id}/merge`, POST only,
  `?dryRun=true` → Preview. Body: `{ loserId, loserEtag, keeperUpdate? }`.
- Through `ApiExecutor.Execute`; register service singleton in `Configuration.AddChurchServices` (Configuration.cs L20-57).

### A3. `src/jchurchFunction/openapi.json` (hand-maintained)
- Add merge path + request/response schemas.

### A4. Backend tests
- `tests/JChurch.Tests/ServiceTests.cs`: **occurrence active-check-in count is UNCHANGED when only the loser
  was checked in (moved)**; count drops by exactly 1 when BOTH were checked in (overlap dedupe);
  moves preserve `CheckedInAt` + group snapshots; loser archived; scan-code takeover ordering;
  keeperUpdate validation (bad email → 400); idempotent replay; audit entries appended.
- `tests/JChurch.Tests/RepositoryContract.cs`: attendance `Delete` (ETag-gated, 412 stale, 404 missing).
- `tests/http-smoke.mjs`: end-to-end merge scenario asserting occurrence count before == after for a
  moved check-in.

## Mobile app (Phase B)

### B1. New `src/JcChurchMobile/src/duplicates.ts` (pure, vitest-safe)
- `contactPoints(member)` → `{ emails: Set<string>, phones: Set<string> }` (member + guardians).
- `findDuplicateCandidates(members)` → `CandidatePair[]` `{ a, b, reasons: ("email"|"phone")[] }` sorted.
- Unit tests `src/duplicates.test.ts` (vitest, mirroring roles.ts test approach).

### B2. New `src/JcChurchMobile/src/screens/Duplicates.tsx`
- Gate: `canManageUsers(roleInfo)` else Notice + "Go back" (Users.tsx L67 pattern).
- Data: `useAll<Member>(churchPath(churchId,"members"))` (active only) → `useMemo(findDuplicateCandidates)`.
- **Pair list**: Page + SearchBox; each pair a card: both avatars+names, type·age, match-reason line
  ("Same name · matching guardian phone"), chevron. Empty state "No duplicate candidates found."
- **Compare view**: tap pair → Sheet `ResolveDuplicate`:
  - Two member cards (side-by-side wide, stacked narrow): Avatar (memberImageUrl), memberName,
    memberType·age, gender, email, phone, guardians (name + phone/email), school, groupNames,
    scan-code yes/no, "Joined {createdOn}", check-in count (from preview).
  - Keeper selection: "Keep" control per card; selected card highlighted (primary border), other
    labeled "Will be archived".
  - Per-field picks (default = keeper's): email, phone, birthDate, gender, school, allergyDetail,
    scanCode; groupIds tri-state (keeper's / loser's / combine); guardians whole-set (keeper's / loser's).
  - Preview via `api.save(`${path}/merge?dryRun=true`, { loserId })` in a useQuery keyed (keepId, loserId):
    "5 check-ins will move · 1 skipped (already checked in)".
  - Two-step confirm (MemberEditor archive precedent) → POST merge via `api.save` (POST when no etag).
  - Success: Notice "Merged — N check-ins moved"; invalidate `[churchPath(churchId,"members")]` +
    `[churchPath(churchId,"attendance")]`; close sheet; pair disappears on recompute.
  - Errors via `message(error)`; uncertain → advise refresh + re-preview.

### B3. Routing & entries
- New `app/church/[churchId]/duplicates.tsx` — `export { default } from "../../../src/screens/Duplicates"`.
- `app/church/[churchId]/_layout.tsx` — hidden `Tabs.Screen` `options={{ href: null }}` (groups L138 /
  custom-fields L143 pattern).
- `src/screens/Members.tsx` — Page actions IconButton ("copy-outline"), `canManageUsers`-gated,
  `router.push(`/church/${churchId}/duplicates`)`.
- `src/screens/Churches.tsx` — manage-mode Row gated `manage && selected && canManageUsers(roleInfo)`
  (mirrors "Manage custom fields" Row) → `router.navigate(`/church/${selected}/duplicates`)`.

## Excluded scope
- Photo transfer (blobs keyed by member id; keeper keeps own photo; photos shown for identification only).
- customFields per-field picking (keeper retains its own; values shown on cards).
- Name-only matches (no contact overlap) — not candidates per the rule.
- Fuzzy/nickname matching.

## Verification
1. `dotnet test` (task "test") — new ServiceTests pass.
2. Tasks "func: host start" + "HTTP smoke test" — merge scenario green.
3. `npx vitest run` in src/JcChurchMobile — duplicates.ts matcher tests.
4. Manual: seed a duplicate pair (same name + shared guardian phone), check both into an event,
   open Duplicates from Members header and Settings, compare, flip keeper, merge; verify keeper's
   check-in history (attendance?memberId=keeper), loser archived, pair gone from list.

## Key references (verified)
- Member/Guardian/Attendance shapes: src/jchurchFunction/Domain/Documents.cs L35-59, L61-70, L99-108;
  attendance Id `{occurrenceId}_{memberId}` (CheckInService.cs L14).
- Count-preserving transfer: occurrence count = `ActiveCheckInCounts` counts active=true grouped by occurrence
  (CosmosRepository.cs L182, InMemoryRepository.cs L155). Attendance ID `{occurrenceId}_{memberId}` immutable;
  transfer = atomic TransactionalBatch Delete(loser)+Create(keeper) in partition `/churchId+/occurrenceId`
  (Partition helper CosmosRepository.cs L37-41). Per-item Delete does NOT exist yet (IRepository.cs L63-75) —
  must be added (A0). Cross-partition memberId search works (L150-173).
- Route pattern: MembersApi.cs L13-45; sub-action model MemberImageApi.cs; ApiExecutor.cs L14.
- Archive gotcha: scan-code lookup NOT released on archive (CosmosRepository.SaveMember L103-139).
- App patterns: memberName/groupNames (Members.tsx L38/L42); invalidation `[path]` (L180);
  api.save POST-without-etag (client.ts L108); useAll queryKey `[path,"all",filters]` (hooks.ts L42);
  Sheet dirty-confirm (ui.tsx L830); colors/styles (ui.tsx L32/L907).
