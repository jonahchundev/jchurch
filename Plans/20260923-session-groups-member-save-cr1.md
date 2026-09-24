# Plan: Session Groups And Member Save Fixes

Add event-level group targeting copied into generated occurrences, allow per-occurrence overrides, filter Check-In members, reduce empty member-form sections, and fix adult member saves.

## Current Status

Core backend and mobile implementation is complete. The Function App build and 55 backend tests pass with one intentionally skipped Cosmos integration test; mobile typecheck passes and 21 mobile tests pass. HTTP smoke and Playwright E2E verification remain open.

## Decisions

- [x] Group selection is stored on the event and copied to generated occurrences.
- [x] Individual occurrences can override the inherited group selection.
- [x] No selected groups means all church members.
- [x] Multiple groups use union behavior: members in any selected group appear.
- [x] Empty Groups and Additional details sections hide their empty content.
- [x] Adult-save remediation includes both client and server changes.

## 1. Event And Occurrence Group Contracts

- [x] Add `GroupIds` to `ChurchEvent` as the event-level default check-in filter.
- [x] Add `GroupIds` to `Occurrence` as the effective session filter.
- [x] Preserve empty-array semantics: no selected groups means all church members.
- [x] Update event, occurrence, and override OpenAPI schemas.
- [x] Regenerate mobile API types.
- [x] Validate event group IDs against active groups in the selected church.
- [x] Deduplicate group IDs before persistence.
- [x] Reject missing or archived group IDs.
- [x] Copy event group IDs to each generated occurrence.
- [x] Preserve deterministic occurrence IDs and attendance behavior.

## 2. Per-Occurrence Group Overrides

- [x] Extend `OverrideRequest` in `src/jchurchFunction/Functions/ChurchApi.cs` with group IDs.
- [x] Define request semantics:
  - [x] Omitted `groupIds` preserves the occurrence filter.
  - [x] `groupIds: []` clears the filter and shows all church members.
  - [x] A populated array replaces the occurrence filter.
- [x] Validate occurrence group IDs against active church groups.
- [x] Preserve existing schedule, cancellation, archive, and ETag rules.
- [x] Keep event schedule immutability unchanged.
- [x] Add tests for inheritance, replacement, clearing, invalid groups, archived groups, and stale ETags.

## 3. Session Detail Group Editing

- [x] Update `SessionEditor` in `src/JcChurchMobile/src/screens/Events.tsx`.
- [x] Load and display hierarchical active/assigned groups.
- [x] Show the occurrence’s effective group selection.
- [x] Allow group selection to be edited for eligible sessions.
- [ ] Distinguish inherited event groups from an occurrence override where practical.
- [x] Add a Check-In action to open the selected session detail editor.
- [x] Preserve session context when navigating to and from the editor.
- [x] Handle save, cancel, stale ETag, and lifecycle restrictions consistently.

## 4. Check-In Group Filtering

- [x] Add server-side member query support for multiple group IDs.
- [x] Use union behavior: members in any selected group are returned.
- [x] Omit the group filter when the occurrence has no selected groups.
- [x] Preserve active-member filtering, search, pagination, and church isolation.
- [x] Pass the occurrence’s effective group IDs from `CheckIn.tsx` to the member query.
- [x] Display selected group names beside the Check-In session label.
- [x] Display `All members` when no groups are selected.
- [x] Add an accessible `Edit session` action on the Check-In page.
- [ ] Add tests for union filtering, no-filter behavior, pagination, group labels, and navigation.

## 5. Reduce Empty Member Sections

- [x] In `src/JcChurchMobile/src/screens/Members.tsx`, hide the Groups section when no groups exist.
- [x] Hide Additional details when no custom-field definitions exist.
- [x] Keep assigned archived groups visible when they require cleanup.
- [x] Keep existing custom values visible when their definitions are archived or otherwise needed for editing.
- [x] Remove blank headings and unnecessary spacing for empty sections.
- [x] Preserve group hierarchy, archived-group warnings, custom-field controls, and validation.
- [ ] Add UI coverage for members with no groups/custom fields.
- [ ] Add UI coverage for members with assigned or archived values.

## 6. Fix Adult Member Save

### Mobile

- [x] Make adult member type authoritative before resolver validation.
- [x] Clear `school`, `guardian1`, and `guardian2` in form state when switching to adult.
- [x] Map adult child-only fields to explicit null values where supported by the API.
- [x] Prevent stale guardian objects from reaching adult validation.
- [x] Point errors to the specific stale field or member type with a clear message.
- [ ] Add tests for adult creation and child-to-adult conversion.

### Function App

- [x] Normalize omitted/null child-only fields for adult requests before conditional validation.
- [x] Continue rejecting genuinely populated school or guardian data for adults.
- [x] Do not silently retain stale child data.
- [x] Preserve atomic update behavior when validation fails.
- [ ] Add tests for omitted fields, explicit nulls, stale guardian objects, and failed updates.

## 7. API, Types, And Tests

- [x] Update `src/jchurchFunction/Domain/Documents.cs`.
- [x] Update `src/jchurchFunction/Services/EventService.cs`.
- [x] Update `src/jchurchFunction/Services/DirectoryService.cs`.
- [x] Update `src/jchurchFunction/Functions/ChurchApi.cs`.
- [x] Update repository query contracts and implementations as required.
- [x] Update `src/jchurchFunction/openapi.json`.
- [x] Run:

```bash
npm run generate:api --prefix src/JcChurchMobile
```

- [x] Add backend tests in `tests/JChurch.Tests/ServiceTests.cs` and repository contract tests.
- [x] Add client tests in `src/JcChurchMobile/tests/client.test.ts`.
- [ ] Add Playwright E2E tests for session groups, Check-In filtering, session navigation, empty sections, and adult save.

## 8. Verification

- [x] Run `dotnet build src/jchurchFunction/jchurchFunction.csproj`.
- [x] Run `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
- [x] Run `npm run generate:api --prefix src/JcChurchMobile`.
- [x] Run `npm run typecheck --prefix src/JcChurchMobile`.
- [x] Run `npm test --prefix src/JcChurchMobile`.
- [ ] Run `node tests/http-smoke.mjs` with the Functions host running.
- [ ] Run `npm run test:e2e --prefix src/JcChurchMobile` with API and Metro running.
- [x] Verify event groups are inherited by generated occurrences.
- [x] Verify occurrence group overrides can be set and cleared.
- [ ] Verify Check-In shows only members in selected groups.
- [ ] Verify no selected groups shows all church members.
- [ ] Verify Check-In displays the selected group names.
- [ ] Verify the Check-In session editor action works.
- [ ] Verify empty member sections do not consume unnecessary space.
- [x] Verify adult members save successfully without school or guardian data.
- [ ] Verify failed invalid updates leave the existing member unchanged.

## Relevant Files

- `src/jchurchFunction/Domain/Documents.cs`
- `src/jchurchFunction/Services/EventService.cs`
- `src/jchurchFunction/Services/DirectoryService.cs`
- `src/jchurchFunction/Functions/ChurchApi.cs`
- `src/jchurchFunction/Storage/Repositories.cs`
- `src/jchurchFunction/openapi.json`
- `src/JcChurchMobile/src/screens/Events.tsx`
- `src/JcChurchMobile/src/screens/CheckIn.tsx`
- `src/JcChurchMobile/src/screens/Members.tsx`
- `src/JcChurchMobile/src/domain.ts`
- `tests/JChurch.Tests/ServiceTests.cs`
- `src/JcChurchMobile/tests/client.test.ts`
- `src/JcChurchMobile/tests/e2e`
