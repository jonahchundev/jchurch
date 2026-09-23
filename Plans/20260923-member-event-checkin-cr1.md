# Plan: Member, Event, And Check-In Usability

Improve required-field clarity, member form layout, QR/barcode configuration, event date/time handling, occurrence generation, and check-in screen space usage.

## Current Status

Core implementation is complete and verified by the Function App build, 54 backend test cases with one intentionally skipped Cosmos integration case, mobile typecheck, and 20 mobile unit tests. Remaining unchecked items are limited to focused edge-case coverage that has not yet been added, manual responsive/UI verification, HTTP smoke testing, and Playwright E2E testing. They are not blockers for the implemented code path, but they remain release verification work.

## Decisions
- [x] Required-field indicators apply to all forms.
- [x] Birthday appears immediately below the member last name.
- [x] QR/barcode configuration is persisted per church, not per device.
- [x] The church setting selects one format: QR or Barcode.
- [x] Groups and Custom Fields remain inline but use a compact layout.
- [x] The Check-In change targets the page header, not member-row details.
- [x] Past one-time event creation remains allowed.
- [x] A past one-time event may generate its occurrence if it is within the existing seven-day historical window and no occurrence exists.
- [x] Invalid, ambiguous, or nonexistent local timezone values remain rejected.
- [x] Invalid, ambiguous, or nonexistent local timezone values remain rejected.

## 1. Required-Field Indicators
- [x] Extend the shared `Field` component in `src/JcChurchMobile/src/ui.tsx` with a `required` prop.
- [x] Display a consistent visual required marker and accessible required metadata.
- [x] Apply markers to required fields in member, event, group, custom-field, and other forms.
- [x] Add equivalent required support to `Select`, `DateField`, and `TimeField` controls.
- [x] Add equivalent required support to `Select`, `DateField`, and `TimeField` controls.
- [x] Ensure optional fields do not display the required marker.
- [x] Preserve existing validation messages and accessibility labels.
- [x] Update `src/JcChurchMobile/src/screens/Members.tsx` so the birthday field appears immediately below last name.

## 2. Member Birthday Placement

- [x] Update `src/JcChurchMobile/src/screens/Members.tsx` so the birthday field appears immediately below last name.
- [x] Keep the existing date validation and future-date restriction.
- [x] Add a church-level selected scan format, such as `scanCodeFormat: "qr" | "code128"`.
- [x] Add a church-level enable/disable switch for QR/barcode functionality.
- [x] Define a backward-compatible default for existing churches as QR and enabled.
- [x] Validate the setting in `DirectoryService`.
- [x] Expose the setting through the existing church GET/PUT contract.

### Function App And API

- [x] Add the setting to the existing church settings/manage flow.
- [x] Allow a church manager to enable/disable scanning and choose QR or Barcode.
- [x] Validate the setting in `DirectoryService`.
- [x] Expose the setting through the existing church GET/PUT contract.
- [x] Preserve exact ETag handling for church updates.
- [x] Load the selected church format in `Members.tsx`.
- [x] Hide scan-code entry when scan functionality is disabled or unavailable.
- [x] Hide scan-code generation, scanning, format selection, and card display when hidden.

### Church Settings UI

- [x] Load the selected church format in `CheckIn.tsx`.
- [x] Hide the Scan tab when scan functionality is unavailable.
- [x] Hide scanner controls and scan-specific recovery UI when unavailable.
- [x] Configure the scanner to accept only the selected symbol format.

### Member Screen

- [x] Keep both sections inline in the member form.
- [x] Reduce section heading spacing and padding.
- [x] Reduce toggle and custom-field row height where appropriate.
- [x] Ensure hiding the controls does not accidentally modify persisted scan-code values.
- [x] Use the selected format for new card rendering and issuance.
- [x] Preserve existing stored scan values when the church changes its preferred format.
- [x] Normalize local date/time and IANA timezone values consistently before validation and submission.
### Check-In Screen

- [x] Load the selected church format in `CheckIn.tsx`.
- [x] Update `EventService.Generate()` in `src/jchurchFunction/Services/EventService.cs`.
- [x] Allow a one-time event within the seven-day historical window to generate its occurrence when none exists.
- [x] Keep recurring generation focused on the next upcoming occurrence.
- [x] Preserve deterministic occurrence IDs and idempotence.
- [x] Do not create duplicate occurrences when one already exists.

## 4. Compact Groups And Custom Fields

- [x] Reduce header padding, heading size, and vertical gaps.
- [x] Replace the tall header with a compact one-row or two-row event/session summary.
- [x] Avoid changing global spacing unless a shared component requires it.
- [x] Preserve group hierarchy and archived-group warnings.
- [x] Preserve custom-field type controls and validation.
- [ ] Verify labels, errors, and long values do not overlap on mobile or web.

## 5. Event Date/Time Validation

- [ ] Reproduce the error through the actual date picker, time picker, timezone selector, and form update path.
- [x] Inspect `localToUtc()` in `src/JcChurchMobile/src/domain.ts`.
- [x] Inspect `updateStart()` and event form state in `src/JcChurchMobile/src/screens/Events.tsx`.
- [x] Normalize local date/time and IANA timezone values consistently before validation and submission.
- [x] Preserve rejection of invalid dates, DST gaps, and ambiguous local times.
- [x] Keep past event creation allowed because past one-time occurrence generation is required.
- [x] Add client tests for valid dates and times in supported timezones.
- [x] Add regression tests for DST gaps, ambiguous times, and date/time control updates.
- [x] Add backend coverage to ensure valid timezone values continue to save.

## 6. Past One-Time Occurrence Generation

- [x] Update `EventService.Generate()` in `src/jchurchFunction/Services/EventService.cs`.
- [x] Allow a one-time event within the seven-day historical window to generate its occurrence when none exists.
- [x] Keep recurring generation focused on the next upcoming occurrence.
- [x] Preserve deterministic occurrence IDs and idempotence.
- [x] Do not create duplicate occurrences when one already exists.
- [x] Confirm behavior for one-time events older than the historical window.
- [ ] Add tests for:
  - [x] A past one-time event with no occurrence.
  - [x] A one-time event whose occurrence already exists.
  - [ ] A future recurring event.
  - [ ] A recurring event with no upcoming occurrence in the generation window.
  - [ ] A one-time event outside the supported historical window.
- [ ] Update HTTP smoke coverage if it owns event-generation assertions.

## 7. Compact Check-In Header

- [x] Update `src/JcChurchMobile/src/screens/CheckIn.tsx`.
- [x] Reduce header padding, heading size, and vertical gaps.
- [x] Replace the tall header with a compact one-row or two-row event/session summary.
- [x] Keep the event name and session time visible.
- [x] Keep session switching available through a compact action with an accessible label.
- [x] Remove duplicated title space while retaining page context.
- [x] Preserve Find Members, Scan, and Checked In tabs.
- [x] Apply QR/barcode setting behavior to the Scan tab.
- [ ] Confirm the compact header does not overlap tabs, search, or member content at mobile and desktop sizes.
- [ ] Add focused Playwright coverage for the compact header layout.

## 8. Contract And Generated Types

- [x] Update the Function App OpenAPI schema for the church scan-format setting.
- [x] Regenerate types with:

```bash
npm run generate:api --prefix src/JcChurchMobile
```

- [x] Update API aliases or request mappers if generated types require it.
- [x] Confirm the OpenAPI document describes the legacy default and supported formats.

## 9. Verification Checklist

- [x] Run `dotnet build src/jchurchFunction/jchurchFunction.csproj`.
- [x] Run `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj`.
- [x] Run `npm run generate:api --prefix src/JcChurchMobile`.
- [x] Run `npm run typecheck --prefix src/JcChurchMobile`.
- [x] Run `npm test --prefix src/JcChurchMobile`.
- [ ] Run `node tests/http-smoke.mjs` with the Functions host running.
- [ ] Run focused E2E tests with the API and Metro running.
- [ ] Verify required markers across representative forms.
- [ ] Verify birthday placement below last name.
- [ ] Verify QR/barcode setting persistence and UI visibility.
- [ ] Verify compact Groups and Custom Fields layout.
- [ ] Verify valid event creation in supported timezones.
- [x] Verify past one-time occurrence generation.
- [ ] Verify the Check-In header gives more space to member selection.

## Relevant Files

- `src/jchurchFunction/Domain/Documents.cs`
- `src/jchurchFunction/Services/DirectoryService.cs`
- `src/jchurchFunction/Services/EventService.cs`
- `src/jchurchFunction/openapi.json`
- `src/JcChurchMobile/src/ui.tsx`
- `src/JcChurchMobile/src/domain.ts`
- `src/JcChurchMobile/src/screens/Members.tsx`
- `src/JcChurchMobile/src/screens/Churches.tsx`
- `src/JcChurchMobile/src/screens/Events.tsx`
- `src/JcChurchMobile/src/screens/CheckIn.tsx`
- `src/JcChurchMobile/src/screens/ScanCheckIn.tsx`
- `tests/JChurch.Tests/ServiceTests.cs`
- `src/JcChurchMobile/tests/client.test.ts`
- `src/JcChurchMobile/tests/e2e`
