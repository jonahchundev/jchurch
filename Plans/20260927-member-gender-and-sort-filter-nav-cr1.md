# Plan: Member gender field + sort/filter consolidation + navigation cleanup

## Goal
Part 1: Add an optional `Gender` field (Male/Female) to Member, required by client-side
validation on the admin MemberEditor (create + edit) and the public registration/self-update
form, optional in the domain model/API/CSV import. Placed directly below "Last name" on every
member form, and directly after the `LastName` column in CSV import/export.

Part 2: Consolidate the Members list's standalone "Group or subgroup" dropdown into the
existing "Sort members" Sheet (renamed "Member sort and filter") on both the Members list and
Check-in screens, and add the same group filter to Check-in (which currently has no
user-selectable group filter). Also simplify navigation: drop "Manage groups" from Settings
(redundant with Home), drop "Search members" from Home (redundant with "Manage members"), and
move "Manage groups" directly below "Manage members" on Home.

Part 3: Replace the single-select "Group or subgroup" dropdown inside the "Member sort and
filter" Sheet (both screens) with a checkbox list, so admins can filter by more than one
group/subgroup at once. Reuses the existing `Toggle` multi-select pattern already used for a
member's own `groupIds` in MemberEditor. No backend changes needed.

## Decisions
- Gender UI control: reuse existing `Select` dropdown (same pattern as `memberType`), options
  `Male` / `Female`. No new radio-button component.
- Gender required scope: required whenever the admin MemberEditor form is used (create + edit),
  and required on the public registration/self-update form (`PublicMemberForm`, shared by
  `PublicRegister` and `PublicUpdate`). Optional in the domain model, API, and CSV bulk import.
- CSV column position: `Gender` directly after `LastName`, before `BirthDate`.
- Check-in's new group filter is combined (AND) with the occurrence's existing default
  `groupIds` scoping, not a replacement.
- Fixing a discovered `CosmosRepository` bug (nested `GroupIds` filter clause, only applied when
  `GroupId` is also set) is in scope because it directly blocks the Check-in group-filter feature
  from working correctly against real Cosmos DB.
- Settings' "Manage custom fields" row is kept; only "Manage groups" is removed from Settings.
- Part 3's group filter checkboxes reuse the existing `Toggle` component (no new checkbox
  primitive). Check-in's occurrence-group scoping becomes a *default checkbox selection* rather
  than an always-on hard filter, since `CheckInService` never enforces it server-side.

## Steps

### Phase 1 — Backend domain + validation (Gender)
1. `src/jchurchFunction/Domain/Documents.cs` — add `public string? Gender { get; init; }` to the
   `Member` record, placed after `LastName`.
2. `src/jchurchFunction/Services/DirectoryService.cs` — in the `Member` validation block, add
   `Require(member.Gender is null or "Male" or "Female", "gender must be Male or Female.")`.

### Phase 2 — Backend CSV import/export (Gender)
3. `src/jchurchFunction/Services/MemberCsvService.cs`:
   - Add `string? Gender` to `MemberImportRow`, positioned after `LastName`.
   - Add `"Gender"` to `FixedColumns`, positioned after `"LastName"`.
   - Export mapping: add `["Gender"] = member.Gender ?? ""` after `LastName`.
   - Import `BuildMember`: add `Gender = string.IsNullOrWhiteSpace(row.Gender) ? null : row.Gender`
     after `LastName` (stays lenient; invalid non-blank values surface the same validation error
     as the UI via `DirectoryService.Save`).

### Phase 3 — Backend tests (Gender)
4. `tests/JChurch.Tests/MemberCsvServiceTests.cs` — update positional `MemberImportRow(...)`
   constructor calls to include the new `Gender` argument; add/extend a test asserting the
   `Gender` column appears directly after `LastName`, and a roundtrip test exporting/importing a
   member with `Gender = "Female"`.
5. Run full test suite to confirm no other tests construct `MemberImportRow` positionally.

### Phase 4 — OpenAPI + generated types (Gender)
6. Rebuild the Functions project so `openapi.json` regenerates with `gender` on `MemberInput`/
   `MemberImportRow`.
7. Regenerate `src/JcChurchMobile/src/api/generated.ts` from the updated OpenAPI doc.

### Phase 5 — Frontend schema (Gender)
8. `src/JcChurchMobile/src/domain.ts`:
   - `memberSchema`: add required `gender: z.enum(["Male", "Female"])`.
   - `publicRegistrationSchema`: add the same required `gender` enum field.
   - `memberInput()` / `publicMemberInput()`: include `gender` in the returned object.
   - `publicRegistrationDefaults()`: accept `gender` in the member param type, default from
     `member?.gender`.
   - MemberEditor's default-values builder in `Members.tsx` needs `gender: member?.gender`.

### Phase 6 — Frontend forms (Gender)
9. `src/JcChurchMobile/src/screens/Members.tsx` — insert a `Select` `Controller` for `gender`
   (same pattern as `memberType`), `label="Gender"`, `required`, options Male/Female, directly
   after `lastName` and before `phone`.
10. `src/JcChurchMobile/src/screens/PublicMemberForm.tsx` — same insertion, directly after the
    `lastName` field and before `birthDate`.

### Phase 7 — Members list + Check-in sort/filter consolidation
11. `src/JcChurchMobile/src/screens/Members.tsx` — remove the standalone "Group or subgroup"
    `Select` block; rename the Sheet title `"Sort members"` → `"Member sort and filter"` and the
    triggering `IconButton` label to `"Sort and filter members"`; add the "Group or subgroup"
    `Select` inside that Sheet, wired to the existing `groupId`/`setGroupId` state.
12. `src/JcChurchMobile/src/screens/CheckIn.tsx` — add new `groupId`/`setGroupId` state; pass
    `groupId: groupId || undefined` into the `useList<Member>` query alongside the existing
    `groupIds: occurrence.groupIds?.join(",")`; rename the Sheet title and trigger label to match
    Members.tsx; add the same "Group or subgroup" `Select` inside the Sheet.

### Phase 8 — Backend group-filter bug fix
13. `src/jchurchFunction/Storage/CosmosRepository.cs` — un-nest the `if (query.GroupIds.Length >
    0)` union clause from inside `if (query.GroupId is not null)` into an independent top-level
    `if`, matching the correct logic in `IRepository.cs`'s `Query.Matches()`.
14. Add/extend a repository contract test asserting a `Query` with only `GroupIds` set (no
    `GroupId`) correctly filters members.

### Phase 9 — Navigation cleanup
15. `src/JcChurchMobile/src/screens/Churches.tsx` — remove the "Manage groups" `Row` from the
    `manage && selected` section.
16. `app/church/[churchId]/index.tsx` — remove the "Search members" `Row`; reorder so "Manage
    groups" sits directly below "Manage members" (final order: Manage members → Manage groups →
    Manage events → Start check-in).

### Phase 10 — Verification
17. Run `test` task (dotnet test).
18. Run `build functions` and manually verify CSV export/import with the `Gender` column.
19. Manually verify in the running app: MemberEditor and public forms require Gender below Last
    name; Members list and Check-in both show "Member sort and filter" with a working group
    filter and no standalone dropdown; Settings no longer shows "Manage groups"; Home page order
    is Manage members, Manage groups, Manage events, Start check-in (no Search members).

### Phase 11 — Group filter checkboxes (multi-select)
20. `src/JcChurchMobile/src/screens/Members.tsx` — change `groupId: string` state to
    `groupIds: string[]`; query param becomes `groupIds: groupIds.length ? groupIds.join(",") :
    undefined`; replace the `Select` "Group or subgroup" control inside the sort/filter Sheet
    with a `Toggle` checklist (same pattern as the member's own group-assignment checkboxes),
    OR-matching any checked group; add a short caption noting unchecked = all groups.
21. `src/JcChurchMobile/src/screens/CheckIn.tsx` — change `groupId: string` state to
    `groupIds: string[]`, defaulted to `occurrence.groupIds ?? []`; collapse the occurrence-scoped
    `groupIds` param and the old single `groupId` param into one `groupIds` param driven by the
    checkboxes; replace the Sheet's `Select` with the same `Toggle` checklist. Unchecking all
    boxes now shows every member (a deliberate loosening since `CheckInService` never
    server-enforces occurrence group scoping).
22. No backend/OpenAPI/generated-type changes required for Phase 11.

## Relevant files
- `src/jchurchFunction/Domain/Documents.cs`
- `src/jchurchFunction/Services/DirectoryService.cs`
- `src/jchurchFunction/Services/MemberCsvService.cs`
- `src/jchurchFunction/Storage/CosmosRepository.cs`
- `src/jchurchFunction/Storage/IRepository.cs`
- `tests/JChurch.Tests/MemberCsvServiceTests.cs`
- `src/jchurchFunction/openapi.json` (auto-generated)
- `src/JcChurchMobile/src/api/generated.ts` / `types.ts` (auto-generated)
- `src/JcChurchMobile/src/domain.ts`
- `src/JcChurchMobile/src/screens/Members.tsx`
- `src/JcChurchMobile/src/screens/PublicMemberForm.tsx`
- `src/JcChurchMobile/src/screens/CheckIn.tsx`
- `src/JcChurchMobile/src/screens/Churches.tsx`
- `app/church/[churchId]/index.tsx`

## Scope boundaries
- No new UI primitive (no radio button, no new checkbox component); reusing existing `Select`
  and `Toggle`.
- No migration/backfill for existing members lacking gender.
- No changes to reporting/attendance screens.
