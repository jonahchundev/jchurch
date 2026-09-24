# Plan: Member CSV Import/Export

## Decisions (confirmed with user)
- Import create-or-update: row with matching `Id` updates that member; otherwise creates (client-supplied id if given, else server-generated).
- CSV parsing/validation logic lives on the backend via a new bulk endpoint (not just client-side loops).
- ScanCode/ScanCodeFormat excluded entirely from CSV schema (import + export) — redacted in list API, not worth per-member GET fetches.
- Custom field CSV columns keyed by `CustomField.Name` (assumes admins keep names unique; duplicate name at import time is an error for that field).
- Guardian1/Guardian2 flattened into prefixed columns: `Guardian1FirstName`, `Guardian1MiddleName`, `Guardian1LastName`, `Guardian1Relationship`, `Guardian1OtherRelationship`, `Guardian1Phone`, `Guardian1Email` (same for Guardian2).
- Groups column: single `Groups` column containing group **Names** (not IDs), colon-separated when a member has multiple groups (e.g. `Youth:Choir`). Subgroups rendered as `Parent / Child` to match existing `groupNames()` display convention in Members.tsx.

## CSV Column Schema (fixed order)
`Id, MemberType, FirstName, MiddleName, LastName, BirthDate, School, Phone, Email, AllergyDetail, Groups, Guardian1FirstName, Guardian1MiddleName, Guardian1LastName, Guardian1Relationship, Guardian1OtherRelationship, Guardian1Phone, Guardian1Email, Guardian2FirstName, Guardian2MiddleName, Guardian2LastName, Guardian2Relationship, Guardian2OtherRelationship, Guardian2Phone, Guardian2Email, <one column per active CustomField.Name>`

- `Id` blank → create; filled & matches existing member → update; filled & no match → create with that id.
- `BirthDate` format `yyyy-MM-dd`.
- Empty guardian columns are fine for adults; for children, Guardian1 required (existing validation still enforced via `DirectoryService.Save`).
- Custom field cell values are raw strings; backend converts per `CustomField.FieldType` (text/number/boolean/date) using the same rules as `DirectoryService.Save`.

## Backend (src/jchurchFunction)

**New service: `Services/MemberCsvService.cs`** (registered as singleton in `Configuration.cs`, DI'd into `ChurchApi`)
- `BuildColumns(customFields: IReadOnlyList<CustomField>) -> string[]`: shared ordered header list (fixed schema + one column per active custom field name). Used by both export and template.
- `ExportCsv(churchId, cancellationToken) -> string`: loads active Groups + active CustomFields once (id→name maps), pages through `repositories.Members.Search` (pageSize 200, follow `ContinuationToken`, `ActiveOnly=true`), maps each `Member` to a CSV row (Groups joined by `:` using `Parent / Child` naming to match `groupNames()`; CustomFields dict (fieldId→JsonElement) rendered back through name map and per-type formatting), writes RFC4180-quoted CSV text.
- `ImportTemplate(churchId, cancellationToken) -> string`: `BuildColumns()` only, header row, no data rows.
- `Import(churchId, rows: List<MemberImportRow>, cancellationToken) -> ImportResult`: preloads Group name→id map (case-sensitive exact match on `Parent / Child` or plain `Name`; duplicate/ambiguous name → row error) and CustomField name→(id, type) map. Cap: max 500 rows per call (`ApiException(400, "too_many_rows", ...)` if exceeded — mirrors the existing 500-occurrence generation cap pattern). For each row (best-effort, not transactional — continue on row failure):
  1. Parse fixed fields into a `Member` record; parse `Groups` (split `:`, trim, resolve each name to id); build `Guardian1`/`Guardian2` from flattened columns (null if all blank); parse `CustomFields` dict from row's dynamic columns via name→id map, converting string values per `FieldType` (int/decimal for number, bool for boolean, string as-is for text/date).
  2. Resolve create-vs-update: if `Id` non-blank, try `directory.Get<Member>(churchId, id)`; if found, capture its `_etag` and call `directory.Save(member, churchId, id, etag)` (update path); if not found, call `directory.Save(member, churchId, id, null)` (create with that id). If `Id` blank, call `directory.Save(member, churchId, null, null)` (create, server id).
  3. Reuses existing `DirectoryService.Save` validation — no duplicated validation logic.
  4. Catch `ApiException` per row → record `{row index, errors: [message]}`; catch unexpected errors similarly (don't abort the whole batch).
  - Returns summary: `{ created: int, updated: int, failed: int, results: [{ row, id?, action: "created"|"updated"|"error", errors?: string[] }] }`.

**New DTO**: `MemberImportRow` (record) — string-based fields matching the CSV schema plus `Dictionary<string,string> CustomFields` (Name→raw value) built by the client from any CSV column not in the fixed set.

**Routing (`Functions/ChurchApi.cs` `Dispatch`)**: before falling into the generic `Resource<Member>` 4-segment match, special-case `route is ["churches", _, "members", "export"]` (GET), `["churches", _, "members", "import-template"]` (GET), `["churches", _, "members", "import"]` (POST) — since these collide with the `{memberId}` slot. Response `Content-Type: text/csv; charset=utf-8` for export/template (raw string body, bypass the JSON serializer path used for other results — extend `Result`/response-writing to support a raw string body, or add a small branch in `Run()`).

**Body size**: the generic `Body<T>` helper caps requests at 64 KiB (`ChurchApi.cs` line ~192) — too small for bulk import. Add a separate raw-body reader for the import route with a larger cap (propose 5 MB) and its own row-count cap (500) as the real throttle; do not change the 64 KiB limit for existing single-object endpoints.

**DI**: register `MemberCsvService` in `Configuration.cs` alongside `DirectoryService`/`EventService`/`CheckInService`.

**OpenAPI**: add the 3 new routes to `src/jchurchFunction/openapi.json` (used by mobile app's `openapi-typescript` codegen for `api/types.ts`).

## Mobile App (src/JcChurchMobile)

**New dependencies**: `papaparse` (+ `@types/papaparse`) for CSV parsing on import; `expo-document-picker` for native file selection. (`expo-file-system` and `expo-sharing` already installed and used in `ScanCode.tsx` for the web-vs-native file save pattern — reuse that pattern.)

**API client** (`src/api/client.ts`): add
- `async text(path): Promise<string>` — GET returning raw text (for export/template), bypassing the JSON-parsing branch in `request()`.
- `async importMembers(churchId, rows): Promise<ImportResult>` — POST JSON `{ rows }` to `/churches/{churchId}/members/import`, reuses existing `request()` JSON path.

**New types** (`src/api/types.ts`): `ImportResult`, `ImportRowResult` matching backend response shape.

**New screen: `src/screens/MembersImportExport.tsx`**, reachable via a new `IconButton` in the `actions` slot of the `Page` header in `Members.tsx` (or a new route `app/church/[churchId]/members-import-export.tsx` pushed from Members). Contents (three actions, modeled after `Page`/`Sheet`/`Notice`/`QueryState` patterns in `ui.tsx`):
1. **Download all members (CSV)** — `api.text(.../members/export)`, then platform-specific save: web → Blob + `<a download>`; native → write via `expo-file-system` to a temp file + `Sharing.shareAsync` (mirrors `ScanCode.tsx` `output()`).
2. **Download import template (CSV)** — same download mechanism against `.../members/import-template`.
3. **Upload CSV to import** — file selection: web → `<input type="file" accept=".csv">` + `FileReader`; native → `expo-document-picker` + `expo-file-system` read-as-string. Parse with `Papa.parse(text, { header: true, skipEmptyLines: true })`. Split each parsed row into fixed columns + `customFields` (any header not in the fixed-column set, non-empty value). POST via `api.importMembers`. Render a results summary (`created`/`updated`/`failed` counts) and a scrollable list of per-row errors (row number + message) using `Notice`/`Row` components so the admin can fix and re-upload just the failed rows.

**Shared column-name constant**: define the fixed CSV column list once in a small shared module (e.g. `src/csvSchema.ts`) so the client's "what counts as a custom field column" logic doesn't drift from the backend's fixed schema.

## Verification
1. Backend: `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj` — add new test file `tests/JChurch.Tests/MemberCsvServiceTests.cs` covering: template header generation, export round-trip (create members/groups/custom fields in `InMemoryRepository`, export, assert CSV rows), import create/update/error paths (unknown group name, unknown custom field name, invalid custom field type value, child missing guardian1, row limit exceeded, mixed success/failure batch).
2. Manual: `func start` (task "func: host start") + run the "HTTP smoke test" task or manual curl for the 3 new routes.
3. Mobile: `npm run typecheck`, `npm test` (add unit tests for CSV row parsing/serialization helpers if extracted into `csvSchema.ts`), manual run via Expo web to exercise upload/download using the file-picker/download flows.

## Scope boundaries
- Included: bulk create/update of Members only (not Groups/CustomFields/Events) via CSV; export of all active members; blank template generation.
- Excluded: ScanCode import/export; archived-member export (could add `?includeArchived=true` later, not in v1); transactional all-or-nothing import (v1 is best-effort per-row, matching the app's existing idempotent/non-transactional patterns); import via Cosmos directly (skip and rely on `DirectoryService.Save` reuse); UI for editing a row inline before resubmit (user just fixes CSV and re-uploads).

## Further Considerations
1. Ambiguous group names: if two groups share the same `Name` (not enforced unique in domain model), export uses `Parent / Child` disambiguation already in `groupNames()`; import rejects ambiguous plain names not matching any group unless the "Parent / Child" form is used. Recommend documenting this in the template/README rather than adding new uniqueness constraints to `Group`.
2. Row cap of 500 per import call — church admins with rosters >500 will need multiple CSV chunks/imports. Acceptable since Occurrence generation already caps at 500 per window as a precedent; can raise later if needed.
