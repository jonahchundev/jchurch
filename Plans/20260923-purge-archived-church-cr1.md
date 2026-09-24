## Plan: Permanently Delete an Archived Church (Purge)

Today `DELETE` only *archives* (soft-deletes, `Active=false`, no physical removal — see
[DirectoryService.Archive](../src/jchurchFunction/Services/DirectoryService.cs#L161-L170) and
[ChurchApi.cs:175-177](../src/jchurchFunction/Functions/ChurchApi.cs#L175-L177)). There is no
hard-delete anywhere in the codebase — `IRepository<T>` has no `Delete()`, and Cosmos
`DeleteItemAsync` is never called on a document (only used internally for scan-code lookup
cleanup, [CosmosRepository.cs:115](../src/jchurchFunction/Storage/CosmosRepository.cs#L115)). This
plan adds a new **purge** operation: given an *already-archived* church, physically remove the
Church document and everything scoped to it — Groups, Members, CustomFields, ChurchEvents,
Occurrences, Attendance, and internal ScanCodeLookup documents — from Cosmos (and InMemory).

**Key architectural fact driving the design:** all directory-type documents (Church, Group,
Member, CustomField, ChurchEvent, Occurrence, ScanCodeLookup) live in the single `directory`
Cosmos container, partitioned by `/churchId`
([CosmosRepository.cs:34-38](../src/jchurchFunction/Storage/CosmosRepository.cs#L34-L38)). Attendance
lives in a separate `attendance` container with a **hierarchical** partition key
`(churchId, occurrenceId)`. So a purge is really just two partition-wide deletes: "delete every
item in the `directory` container's `churchId` partition" (catches every kind, no need to
enumerate by type) and "delete every item across all `occurrenceId` sub-partitions under
`churchId`" in the `attendance` container (Cosmos hierarchical partition keys support querying by
a *partial/prefix* key — just `churchId` — routed efficiently without a full cross-partition
fan-out).

**Steps**

1. **Repository layer: add `Purge(churchId)` to `IRepository<T>`**
   ([IRepository.cs](../src/jchurchFunction/Storage/IRepository.cs)) — default-interface-method
   throwing `NotSupportedException`, matching the existing pattern for
   `ActiveCheckInCounts`/`ResolveScanCode`. Only meaningful when called through a repo backed by
   a real container, so callers use it via `repositories.Churches.Purge(...)` (covers the whole
   `directory` partition, all kinds) and `repositories.Attendance.Purge(...)` (covers the whole
   `attendance` partition across all occurrences) — **not** once per document type, since multiple
   `IRepository<T>` instances share the same physical container.
   - **Cosmos** ([CosmosRepository.cs](../src/jchurchFunction/Storage/CosmosRepository.cs)): query
     `SELECT c.id` (+ `c.occurrenceId` for the attendance container) `FROM c WHERE c.churchId = @churchId`
     using a partial partition key (`Partition(churchId)` for directory; a churchId-only
     `PartitionKeyBuilder` for attendance), page through results, and call
     `container.DeleteItemAsync` per id (exact partition key per item — `(churchId)` or
     `(churchId, occurrenceId)`). Batch deletes with bounded concurrency (e.g.
     `Parallel.ForEachAsync` with a small degree of parallelism) to keep RU usage predictable;
     tolerate/retry `TooManyRequests` the same way `CosmosClientOptions` already does for other
     calls ([Configuration.cs](../src/jchurchFunction/Configuration.cs)).
   - **InMemory** ([InMemoryRepository.cs](../src/jchurchFunction/Storage/InMemoryRepository.cs)):
     under the existing `gate` lock, remove every entry from the `documents` dictionary whose key
     matches `churchId` (and, for the scan-code index, clear matching `scanOwners` entries too —
     mirrors the cleanup already done in `AssignCode`).

2. **`DirectoryService.Purge(churchId, etag)`**
   ([DirectoryService.cs](../src/jchurchFunction/Services/DirectoryService.cs)) — new method:
   - Load the `Church` via `Get<Church>(churchId, churchId)`.
   - **Require `church.Active == false`** — if still active, throw
     `ApiException(409, "not_archived", "Archive the church before deleting it permanently.")`
     (matches the confirmed precondition).
   - **Require an exact ETag match** against the church's current `ETag` — same convention as
     `Archive()` today ([DirectoryService.cs:170](../src/jchurchFunction/Services/DirectoryService.cs#L170)),
     no new confirmation mechanism beyond what archive already uses.
   - Call `repositories.Attendance.Purge(churchId)` first, then `repositories.Churches.Purge(churchId)`
     (order doesn't matter for correctness — attendance and directory are independent containers —
     but doing attendance first means a mid-failure retry re-enters a well-defined next step).
   - This method is **not generic** over `T` (unlike `Archive<T>`) — it only ever applies to
     `Church`, since "purge" is inherently whole-church-scoped.

3. **API endpoint**
   ([ChurchApi.cs](../src/jchurchFunction/Functions/ChurchApi.cs)) — add a new route,
   `DELETE /churches/{churchId}/purge`, distinct from the existing
   `DELETE /churches/{churchId}` (archive). Reuses the existing `IfMatch(request)` helper for the
   ETag. Returns `204` on success; propagates `409`/`412`/`404` via the existing `ApiException`
   → `Problem()` pipeline (no new error-handling plumbing needed).
   - Deliberately a **separate route**, not an overload of the existing DELETE, so archiving a
     church can never accidentally purge it, and so purge is discoverable/auditable as its own
     documented operation.

4. **OpenAPI** ([openapi.json](../src/jchurchFunction/openapi.json)) — document the new
   `DELETE /churches/{churchId}/purge` operation: request (If-Match required), responses
   (`204`, `404 not_found`, `409 not_archived`, `412 stale_version`), and a clear description
   ("Permanently and irreversibly deletes the church and all associated groups, members, custom
   fields, events, occurrences, and attendance records. The church must already be archived.").

5. **Mobile UI**
   ([Churches.tsx](../src/JcChurchMobile/src/screens/Churches.tsx#L253-L275)) — extend the existing
   archive confirmation flow, which already follows: danger `Button` with `trash-outline` icon →
   two-stage confirm → error `Notice` → 412-reload handling. Add a **second, separate** action that
   only appears once `current.active === false`:
   - A "Permanently delete" danger button, shown only for archived churches.
   - Its own confirmation `Notice` with clearly different wording than the archive one (e.g.
     "This permanently deletes {name} and ALL its groups, members, events, and attendance history.
     This cannot be undone.").
   - New mutation calling `api.request(churchPath(churchId, "purge"), { method: "DELETE", ... })`
     (or equivalent helper) with the church's `_etag` as `If-Match`, following the same
     `save.isPending`/`archive.isPending`-style busy-state and cache-invalidation pattern already
     used for archive ([Churches.tsx:159-171](../src/JcChurchMobile/src/screens/Churches.tsx#L159-L171)).
   - On success, navigate away from the church (it no longer exists) back to the churches list.

6. **Tests**
   - `tests/JChurch.Tests/RepositoryTests.cs` / a new `PurgeTests.cs`: seed a church with groups,
     members (including one with a `ScanCode`), events, occurrences, and attendance; call
     `Purge`; assert every document is gone (`Get` returns `null` for each), and that a
     `ResolveScanCode` for the old scan code also returns `null` (proves `ScanCodeLookup` cleanup).
     Also seed a **second, untouched** church and assert its documents/attendance are unaffected
     (proves the partition-scoped delete doesn't leak across churches).
   - `tests/JChurch.Tests/SafetyTests.cs` or a new test: assert `Purge` on a still-active church
     throws `409 not_archived`; assert stale/missing ETag throws `412`/`404`, mirroring existing
     archive tests.
   - Extend `RepositoryContract.cs` if `Purge` should be part of the shared InMemory/Cosmos
     contract (recommended, since both backends must behave identically) — add a
     `CosmosFact`-gated assertion alongside the existing opt-in Cosmos integration test.
   - Manual verification: `dotnet test`, then `func start` + a manual HTTP purge against a
     synthetic church seeded via the CSV import flow, confirming `GET` on every child resource
     404s afterward and `GET /churches/{churchId}` also 404s.

**Relevant files**
- `src/jchurchFunction/Storage/IRepository.cs` — new `Purge` interface member
- `src/jchurchFunction/Storage/CosmosRepository.cs` — `Purge` implementation (partition query + delete loop)
- `src/jchurchFunction/Storage/InMemoryRepository.cs` — `Purge` implementation (dictionary/scan-index cleanup)
- `src/jchurchFunction/Services/DirectoryService.cs` — new `Purge(churchId, etag)` orchestration method
- `src/jchurchFunction/Functions/ChurchApi.cs` — new `DELETE /churches/{churchId}/purge` route
- `src/jchurchFunction/openapi.json` — document the new endpoint
- `src/JcChurchMobile/src/screens/Churches.tsx` — "Permanently delete" UI, shown only for archived churches
- `tests/JChurch.Tests/RepositoryContract.cs`, new `PurgeTests.cs`, `SafetyTests.cs` — coverage

**Decisions**
- Purge is only allowed once the church is already archived (`Active=false`); attempting it on an
  active church returns `409 not_archived`.
- No new confirmation mechanism beyond the existing ETag (`If-Match`) requirement — matches how
  `Archive()` already works today; the app remains unauthenticated by design during this
  development phase (per `Plans/church-management-api-plan.md`), so this is consistent with, not a
  regression from, the current security posture.
- Purge runs synchronously within a single HTTP call for now, matching the app's current
  small-synthetic-data dev/test scale (the API plan's own pilot benchmark is "three churches, 500
  members each").

**Further Considerations**
1. **Scale/timeout risk**: a very large church (many thousands of attendance records) could
   approach the Functions HTTP timeout during a synchronous purge. If this becomes a real problem,
   a follow-up plan should convert this into a queue-triggered background job (the app already has
   an unused/disabled timer-trigger pattern for occurrence generation that could serve as a
   template) — deliberately deferred per the "synchronous for now" decision.
2. **Partial failure recovery**: because deletes are idempotent (deleting an already-deleted item
   is a no-op success or a `404` swallowed inside `Purge`), retrying the whole `Purge` call after a
   partial failure (e.g. RU throttling mid-run) is always safe — worth stating explicitly in the
   OpenAPI description so operators know a failed purge can simply be retried.
3. **Irreversibility**: unlike archive, purge has *no* recovery path at all. Recommend the mobile
   confirmation text be unambiguous about this, and optionally recommend (not required by this
   plan) that operators export a Member/Group CSV backup first — the export endpoints already
   exist ([MemberCsvService](../src/jchurchFunction/Services/MemberCsvService.cs),
   [GroupCsvService](../src/jchurchFunction/Services/GroupCsvService.cs)).
