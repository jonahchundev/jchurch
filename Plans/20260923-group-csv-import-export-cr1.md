# Plan: Group CSV Import/Export

Mirrors the already-implemented Member CSV feature ([Plans/20260923-member-csv-import-export-cr1.md](../Plans/20260923-member-csv-import-export-cr1.md)) — same conventions (create-or-update by `Id`, backend-owned CSV logic, best-effort per-row import, `Parent / Child` naming), applied to `Group`.

## Domain recap
`Group` ([Domain/Documents.cs](../src/jchurchFunction/Domain/Documents.cs)): `Name` (required, 1-200 chars), `ParentGroupId` (optional, immutable after creation, max one subgroup level — a parent cannot itself have a parent).

## Decisions (proposed, following the Member CSV precedent — confirm before implementing)
- Import create-or-update: row with a filled `Id` matching an existing group updates it; blank or non-matching `Id` creates a new group (client-supplied id if given).
- CSV logic lives in the backend (new `GroupCsvService`, same pattern as `MemberCsvService`), not client-side loops.
- Parent is referenced by **Name**, not ID, since IDs aren't human-editable in a spreadsheet. Only top-level groups can be a parent (matches the one-subgroup-level constraint), so `ParentName` is unambiguous without needing "Parent / Child" notation.
- Row order matters for creating a new hierarchy in one file: a parent row must appear before its children's rows in the same CSV so the parent's name can resolve to an id within the same import call.
- Changing `ParentGroupId` on an existing group via CSV re-import is rejected (existing immutability rule in `DirectoryService.Save` — parent is immutable after creation), surfaced as a normal per-row error.

## CSV Column Schema (fixed order, no dynamic columns — Group has no custom fields)
`Id, Name, ParentName`

- `Id` blank → create; filled & matches existing group → update; filled & no match → create with that id.
- `ParentName` blank → top-level group. Filled → must exactly match the `Name` of an active top-level group (a group whose own `ParentGroupId` is null); ambiguous match (two top-level groups share the name) is a row error.
- Export orders top-level groups before their children so a re-imported file is already parent-before-child.

## Backend (src/jchurchFunction)

**New service: `Services/GroupCsvService.cs`** (singleton, registered in `Configuration.cs`, DI'd into `ChurchApi`), structurally parallel to `MemberCsvService`:
- `BuildColumns() -> string[]`: fixed `["Id", "Name", "ParentName"]` (no per-church dynamic columns, unlike Members).
- `ExportCsv(churchId, cancellationToken) -> string`: loads all active groups, emits top-level groups first (sorted by name) followed by their children (also sorted by name) so the file is naturally parent-before-child; `ParentName` column set from the parent's `Name`.
- `ImportTemplate(churchId, cancellationToken) -> string`: header row only.
- `Import(churchId, rows: List<GroupImportRow>, cancellationToken) -> GroupImportResult`: max 500 rows per call (same cap/rationale as Member import). Maintains a running `Name -> id` map for **top-level groups only**, seeded from existing active top-level groups and updated after each successful create/update in row order (so a parent created earlier in the same batch resolves for later child rows). For each row:
  1. Resolve `ParentName` (blank → null; non-blank → look up in the running top-level map; not found → `unknown_parent_group` error; ambiguous → `ambiguous_parent_group` error).
  2. Build a `Group { Name, ParentGroupId }`.
  3. Resolve create-vs-update by `Id` exactly like `MemberCsvService.BuildMember` (fetch existing by id for its ETag, or create).
  4. Call `directory.Save(group, churchId, id, etag, cancellationToken)` — reuses all existing validation (name length, parent must itself be top-level, parent immutability, self-parent rejection).
  5. On success, if the saved group is top-level, add/update its `Name -> id` entry in the running map so later rows in the same batch can reference it as a parent.
  6. Catch `ApiException` per row, record `{row, id?, action: "error", errors}`; continue processing remaining rows (best-effort, not transactional).
  - Returns `{ created, updated, failed, results: [{ row, id?, action, errors? }] }` (same shape as `MemberImportResult`, reusing `MemberImportRowResult`'s structure or a parallel `GroupImportRowResult` — prefer a shared generic `ImportRowResult` type to avoid duplicating the record).

**New DTOs**: `GroupImportRow(string? Id, string? Name, string? ParentName)`; reuse the existing `MemberImportRowResult`/`MemberImportResult` shape generically (rename to `ImportRowResult`/`ImportResult<T>` or duplicate as `GroupImportRowResult`/`GroupImportResult` if generics add more complexity than value — decide during implementation based on how much duplication it actually removes).

**Routing (`Functions/ChurchApi.cs` `Dispatch`)**: special-case before the generic `Resource<Group>` id-slot matching, exactly like the Member routes:
- `GET /churches/{churchId}/groups/export`
- `GET /churches/{churchId}/groups/import-template`
- `POST /churches/{churchId}/groups/import`

Reuse the existing `RawText` response support and the raised-cap `ImportBody` reader added for Member import (same 5 MiB / 500-row caps, no change needed there beyond calling it for this route too).

**DI**: register `GroupCsvService` in `Configuration.cs` alongside `MemberCsvService`.

**OpenAPI**: add the 3 new routes + `GroupImportRow`/`GroupImportResult` (or shared generic) schemas to `openapi.json`, then regenerate `src/JcChurchMobile/src/api/generated.ts` via `npm run generate:api`.

## Mobile App (src/JcChurchMobile)

**`client.ts`**: add `importGroups(churchId, rows)` (POST JSON `{ rows }` to `.../groups/import`, mirrors `importMembers`). No new client primitives needed — reuses the existing `text()` method for export/template downloads.

**`api/types.ts`**: add `GroupImportRow`, `GroupImportResult` (or shared generic) types from the regenerated `generated.ts`.

**`csvSchema.ts`**: add `GROUP_CSV_FIXED_COLUMNS = ["Id", "Name", "ParentName"]` and a `splitGroupImportRow(row)` helper (much simpler than the member one — no dynamic custom-field columns to split out).

**New screen: `src/screens/GroupsImportExport.tsx`**, structurally a near-copy of `MembersImportExport.tsx`: same three actions (download all groups CSV, download template CSV, upload CSV to import), same web/native download-and-share and file-pick-and-parse patterns (Blob/`<input type=file>` on web, `File.pickFileAsync`/`Sharing` on native), same created/updated/failed summary + per-row error list.

Wire into `Groups.tsx` the same way `Members.tsx` was wired: a new `IconButton` (`swap-vertical-outline`, "Import or export CSV") in the `Page` `actions` slot, opening the sheet, invalidating the groups list query on success.

## Verification
1. Backend: add `tests/JChurch.Tests/GroupCsvServiceTests.cs` mirroring `MemberCsvServiceTests.cs` — template header, export order (parent before children), import create or update by id, unknown/ambiguous parent name, parent-immutability-on-update rejected as a row error, self-parent rejected, row limit exceeded, a batch that creates a parent and a child in the same call (proving the running name→id map works), mixed success/failure batch. Run `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
2. Mobile: `npm run typecheck`, `npm test` (add `splitGroupImportRow` cases + `importGroups` client test alongside the existing member CSV tests in `client.test.ts`), manual Expo web run to exercise upload/download.

## Scope boundaries
- Included: bulk create/update of Groups via CSV; export of all active groups; blank template generation.
- Excluded: archiving/deleting groups via CSV (no DELETE-by-CSV-row concept, matches the Member CSV feature); changing a group's parent via CSV (blocked by existing immutability rule, same as the single-group PUT endpoint); custom fields (Group has none).

## Open questions to confirm before implementation
1. Should `GroupImportRowResult`/`GroupImportResult` share a generic type with the Member equivalents, or duplicate the small records? (Affects `Domain`/`Services` code shape only, not behavior.)
2. Confirm the parent-before-child ordering requirement is acceptable UX (vs. a two-pass/topological resolution that would tolerate any row order) — two-pass is more forgiving but adds complexity; single-pass with documented ordering matches the Member CSV feature's "best effort per row" philosophy and is simpler to reason about and test.
