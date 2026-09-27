# Plan: Make guardian info optional + incomplete indicator + member description

## Goals
1. Guardian info is no longer required for a child member (backend + mobile validation).
2. If guardian1's name, phone, or email is missing for a child, show a danger indicator on
   the member row in both the Check-in screen and the Members list screen.
3. On the Members screen, show a description line (age, school, groups) below the member
   name, matching the format already used on the Check-in screen.

## Phase A — Backend validation relax
1. `src/jchurchFunction/Services/DirectoryService.cs`
   - Remove the `Require(member.Guardian1 is not null, "guardian1 is required for child members.")`
     check.
   - Change `ValidateGuardian` to accept `Guardian?`, return `null` when null/empty, and only
     validate format/length of fields that are non-empty (firstName/lastName/phone: length only;
     email: format+length only if non-empty; relationship: enum-check + Others/otherRelationship
     linkage only if non-empty).
   - For child members, call the relaxed `ValidateGuardian` for both `Guardian1` and `Guardian2`
     without a required pre-check.
2. `src/jchurchFunction/openapi.json`
   - `GuardianInput`: drop `firstName`, `lastName`, `phone`, `email`, `relationship` from
     `required`; mark corresponding properties `nullable: true`.
   - `MemberInput`: update `guardian1`/`memberType` descriptions to no longer say guardian1 is
     required for children.
3. Regenerate `src/JcChurchMobile/src/api/generated.ts` via `npm run generate:api`.

## Phase B — Backend test updates
4. `tests/JChurch.Tests/ServiceTests.cs` — update
   `ChildGuardiansRequireContactDetailsAndLimitOtherRelationship`:
   - Child with `Guardian1 = null` saves successfully.
   - Partial guardian (e.g., only firstName+phone) saves successfully.
   - Invalid email format on a provided guardian still throws.
   - otherRelationship-too-long still throws when relationship is provided.
5. `tests/JChurch.Tests/MemberCsvServiceTests.cs` — update
   `ImportReportsPerRowErrorsAndContinues`: the "missing guardian" child row now succeeds;
   update `Created`/`Failed` counts and per-row `action` assertions.

## Phase C — Frontend domain/validation
6. `src/JcChurchMobile/src/domain.ts`
   - `guardianSchema`: relax `firstName`, `lastName`, `phone` to optional text; relax `email` to
     the same optional-email pattern already used for `memberSchema.email`.
   - Remove the `superRefine` issue requiring `guardian1` for child members.
   - Add exported `guardianIncomplete(member)` helper: true only when `memberType === "child"`
     and guardian1 is missing or any of firstName/lastName/phone/email is blank.

## Phase D — Frontend UI
7. `src/JcChurchMobile/src/screens/Members.tsx`
   - `GuardianFields`: drop the `required` marker on firstName/lastName/phone/email fields and
     the relationship select.
   - Headings: `"Guardian 1"` → `"Guardian 1 (optional)"`.
   - List row: subtitle mirrors Check-in's composition
     (`Age X · School · Group/Subgroup`, filtering blanks).
   - Add `badge`/`badgeTone="danger"` using `guardianIncomplete(member)`.
8. `src/JcChurchMobile/src/screens/CheckIn.tsx`
   - Add `badge`/`badgeTone="danger"` using `guardianIncomplete(member)` on the member row.

## Verification
1. `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj` passes.
2. Save a child with no guardian info — succeeds.
3. Save a child with guardian1 firstName only (no phone/email) — succeeds; both Members list and
   Check-in rows show a red "Guardian info incomplete" badge; fully filled guardian1 shows none.
4. Members list row shows "Age X · School · Group/Subgroup" subtitle matching Check-in's format.
5. `npm run generate:api` regenerates cleanly.
