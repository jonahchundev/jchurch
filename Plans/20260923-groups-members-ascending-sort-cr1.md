## Plan: Default Ascending Sort for Groups and Members Lists

Currently both the Groups and Members lists are returned/rendered in **document ID order**
(an implementation artifact, not a meaningful order): Cosmos uses `ORDER BY c.id`
([CosmosRepository.cs](../src/jchurchFunction/Storage/CosmosRepository.cs#L220)), InMemory uses
`.OrderBy(document => document.Id, StringComparer.Ordinal)`
([InMemoryRepository.cs](../src/jchurchFunction/Storage/InMemoryRepository.cs#L85)), and neither the
API ([ChurchApi.cs](../src/jchurchFunction/Functions/ChurchApi.cs#L266-L285) `ParseQuery`) nor the
mobile screens apply any additional sort. Goal: Groups ascending by name, Members ascending by
name, with correct order even across pagination.

**Steps**

1. **Groups — client-side sort only, no backend change** (*independent, low risk*)
   [Groups.tsx](../src/JcChurchMobile/src/screens/Groups.tsx#L54-L56) already fetches the *entire*
   group list via `useAll<Group>()` before building the parent/child hierarchy, so global order
   only needs a client-side sort — no pagination correctness concerns.
   - Sort top-level groups by `name` ascending (`localeCompare`, case-insensitive).
   - Within each parent's children, sort by `name` ascending the same way.
   - Mirrors the existing sort already used for CSV export
     ([GroupCsvService.cs:38-43](../src/jchurchFunction/Services/GroupCsvService.cs#L38-L43)) —
     reuse the same comparison convention (`OrdinalIgnoreCase`-equivalent) for consistency.
   - **Implemented (extended scope):** the same ascending order was also applied to the group
     Toggle lists in [Events.tsx](../src/JcChurchMobile/src/screens/Events.tsx) — the event page's
     "Check-in groups" selector and the session detail (`SessionEditor`) "Check-in groups"
     selector — via a shared `sortedGroups()`/`groupLabel()` helper that sorts by the same
     displayed `"Parent / Child"` label ascending, since those lists are flat (not
     hierarchically indented like the main Groups screen).

2. **Members — backend default sort (required for correct order across pages)** (*depends on
   design decision below; touches both repositories*)
   [Members.tsx](../src/JcChurchMobile/src/screens/Members.tsx#L60-L71) paginates via
   `useList<Member>()` (infinite scroll, pageSize 50) and simply concatenates pages as returned.
   Sorting only within each fetched page would give locally-sorted, globally-scrambled results,
   so the default order must come from the query itself:
   - **Cosmos**: in `CosmosRepository.BuildQuery`
     ([CosmosRepository.cs:220](../src/jchurchFunction/Storage/CosmosRepository.cs#L220)), change the
     order-by clause for `Member` to `ORDER BY c.lastName, c.firstName, c.id` (keep
     `ORDER BY c.id` for all other document types — Church/Group/Event/Occurrence/Attendance/
     CustomField are unaffected). Cosmos's own continuation token already tracks position
     correctly for multi-key `ORDER BY`, so no cursor-format change needed here.
   - **InMemory**: in `InMemoryRepository.Search`
     ([InMemoryRepository.cs:78-88](../src/jchurchFunction/Storage/InMemoryRepository.cs#L78-L88)),
     change the ordering to the same type-specific rule (`LastName, FirstName, Id` for `Member`,
     `Id` for everything else). This repository does **manual keyset pagination** — the `after`
     cutoff currently compares only `document.Id`
     (`string.CompareOrdinal(document.Id, after) > 0`). This must become a composite-key
     comparison (`(LastName, FirstName, Id)` tuple ordering) so pages don't skip/repeat items.
     `Cursor.Encode`/`Decode` (generic on `T`, [IRepository.cs:76-91](../src/jchurchFunction/Storage/IRepository.cs#L76-L91))
     already carries an opaque `Position` string per repository's own meaning — encode the
     composite key as a delimited string (e.g. `lastName\u001Ffirstname\u001Fid`) instead of the
     bare id; no change needed to the shared `Cursor`/`Query` types themselves.
   - Add a small internal helper (e.g. `static string SortKey(Member m)` /
     `static IComparable Key(T document)`) so both repositories express "what does ascending mean
     for this document type" in one place, reducing duplication.

3. **Update tests for the new default order**
   - [RepositoryContract.cs](../tests/JChurch.Tests/RepositoryContract.cs#L33) currently asserts
     `["member_a", "member_b"]`, which happens to match both id order and name order in that
     fixture — verify/extend the shared contract test (run against both InMemory and Cosmos) with
     names that sort differently by id vs by name, to prove the new order is real (e.g. member id
     `member_z` named "Aaron Smith" should appear before id `member_a` named "Zack Jones").
   - Add a pagination-correctness test: create enough members to span 2+ pages, confirm walking
     all continuation tokens yields every member exactly once, in ascending `LastName, FirstName`
     order (catches keyset-cursor regressions in the InMemory implementation specifically).
   - No test changes needed for Groups (client-side sort, not covered by backend contract tests).

4. **Manual verification**
   - `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
   - `func start` + `node tests/http-smoke.mjs` regression pass.
   - In the Expo app: seed members/groups with names that sort differently from their IDs, confirm
     both lists render alphabetically ascending, including across an infinite-scroll page boundary
     for Members.

**Relevant files**
- `src/jchurchFunction/Storage/CosmosRepository.cs` — `BuildQuery` ORDER BY clause (Member only)
- `src/jchurchFunction/Storage/InMemoryRepository.cs` — `Search` ordering + keyset cursor cutoff
- `src/jchurchFunction/Storage/IRepository.cs` — no signature change; `Cursor.Position` reused as
  an opaque composite string for Member
- `src/JcChurchMobile/src/screens/Groups.tsx` — client-side sort of top-level + child groups
- `tests/JChurch.Tests/RepositoryContract.cs` — updated/added ordering + pagination tests

**Decisions**
- Member sort key: `LastName` then `FirstName` (standard directory/phonebook order), `Id` as final
  tiebreaker for stable pagination.
- Group sort key: `Name` ascending, applied within each hierarchy level (top-level list, and each
  parent's children list) — not a flat alphabetical list that ignores the parent/child grouping,
  since the hierarchy display is the existing intended structure.
- Case-insensitive comparison (`localeCompare`/`OrdinalIgnoreCase`-equivalent) matching the
  existing CSV export convention, not raw ordinal/byte order.
- Only `Member` and `Group` document types get a new default order; `Church`, `ChurchEvent`,
  `Occurrence`, `Attendance`, `CustomField` keep `ORDER BY id` (no ordering requirement stated for
  them).
- Groups gets a pure client-side fix (no backend change, no risk to pagination) because it already
  fetches everything up front; Members requires a backend fix because it's paginated.

**Further Considerations**
1. Cosmos `ORDER BY c.lastName, c.firstName` is case-sensitive at the database level (unlike the
   existing `CONTAINS(..., true)` case-insensitive search). If names are stored with inconsistent
   casing, sort could group capitals before lowercase. Recommend either normalizing casing at
   write-time (not currently done) or accepting this as a known minor edge case for now — mirrors
   how the CSV export already does its case-insensitive sort only in C# memory, not at the DB
   level.
