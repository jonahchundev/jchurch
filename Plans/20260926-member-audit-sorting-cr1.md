# Plan: Member Audit Timestamps and Sorting

## Goal

Add server-managed document audit timestamps, identify recently created members using a per-church configurable window, add paginated member sorting by name and creation date, and reclaim Check-in screen space by removing visible timezone labels.

## Scope

- Add nullable `CreatedOn` and `UpdatedOn` UTC timestamps to the shared backend `Document` model.
- Stamp timestamps in both repository implementations. Creates set both timestamps to server time; updates preserve the stored `CreatedOn` and set `UpdatedOn` to server time. Client values are never trusted.
- Add per-church `NewMemberDays`, default 6; zero disables the new-member indicator.
- Support name ascending/descending plus created-date off/newest/oldest sorting through the member list API.
- Show a new-member icon in Members and Check-in rows, display `CreatedOn` beside the member name on member details, and provide compact sort controls in a bottom sheet.
- Remove visible timezone labels from Check-in while preserving timezone-aware time formatting.

## Decisions

- Existing documents without audit values remain unknown. Do not infer `CreatedOn` from Cosmos `_ts` or `UpdatedOn`.
- Unknown member creation dates do not trigger the new-member icon and sort after dated members in either date direction.
- Cosmos member sorting uses two ordered query phases for a date sort: defined/non-null `createdOn` first in selected date order, then missing/null `createdOn` records in selected name order. Continuation state includes the current phase and that phase's Cosmos continuation token, while the normal query fingerprint binds filters and sort choices.
- Name ascending is the default; created-date sorting is off by default. With a date sort selected, creation date is primary, followed by the selected name direction, then member ID for stable ordering.
- `CreatedOn` and `UpdatedOn` are shared read-only response fields and are rejected when supplied in request bodies; repository writes independently replace submitted values with authoritative values.
- Sort controls use a sort icon button that opens a Sheet with two compact segmented rows. Search/filter/list headers remain uncluttered on narrow devices.

## Implementation Steps

1. Extend `Document` and repository write behavior. Inject `TimeProvider` into repositories and preserve `CreatedOn` from the stored document during ETag-protected replacements, including the transactional member path. Keep duplicate create idempotency. Cover internal writes and legacy null timestamps.
2. Add and validate the six-day `NewMemberDays` Church setting, including mobile church form defaults and validation.
3. Add list query sort properties, request parsing/validation, matching Cosmos and in-memory order, and continuation-token handling. Add the required Cosmos composite indexes to both deployment templates.
4. Update OpenAPI response and request schemas, regenerate mobile API types, and pass sort settings through the shared paginated list hook.
5. Implement member indicator/detail-date UI, sort sheets in both screens, and remove visible timezone labels from Check-in and its shared session-selection rendering without changing event-time conversion.
6. Add backend and mobile tests for write semantics, unknown dates, query/sort/pagination, configuration, and responsive screen behavior.

## Key Files

- Backend model and writes: `src/jchurchFunction/Domain/Documents.cs`, `src/jchurchFunction/Storage/IRepository.cs`, `src/jchurchFunction/Storage/CosmosRepository.cs`, `src/jchurchFunction/Storage/InMemoryRepository.cs`.
- API and configuration: `src/jchurchFunction/Functions/ChurchApi.cs`, `src/jchurchFunction/Services/DirectoryService.cs`, `src/jchurchFunction/openapi.json`.
- Mobile: `src/JcChurchMobile/src/domain.ts`, `src/JcChurchMobile/src/screens/Churches.tsx`, `src/JcChurchMobile/src/screens/Members.tsx`, `src/JcChurchMobile/src/screens/CheckIn.tsx`, `src/JcChurchMobile/src/screens/Events.tsx`, `src/JcChurchMobile/src/api/hooks.ts`, and generated API types.
- Infrastructure: `infra/main.bicep` and `infra/copymain.bicep`.
- Tests: `tests/JChurch.Tests/RepositoryTests.cs`, `RepositoryContract.cs`, `ServiceTests.cs`, `MemberCsvServiceTests.cs`, `SafetyTests.cs`, `CosmosContractTests.cs`, and mobile tests under `src/JcChurchMobile/tests/`.

## Validation

- `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
- `npm --prefix src/JcChurchMobile run typecheck` and `npm --prefix src/JcChurchMobile test`.
- Regenerate API types from OpenAPI and validate the OpenAPI document.
- Build both Bicep templates and confirm their Cosmos indexing policies stay equivalent.
- Run relevant Playwright coverage or manually verify the sort sheet and member details at narrow widths, new-member window boundaries, sort order across pages, and all Check-in states without visible timezone labels.
- Cosmos integration tests require the existing opt-in synthetic-data account; template compilation alone does not prove the new composite indexes have finished building or that runtime query plans succeed.