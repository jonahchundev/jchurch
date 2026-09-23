# Plan: Member Type, Allergy, School, And Guardian Information

Extend member records and the member-management workflow with an explicit child/adult type, allergy detail, child-only school information, and structured guardian information. The Function App remains the source of truth for the data contract and business rules; the mobile app mirrors those rules for user feedback.

## 1. Approved Requirements

- [x] Add `memberType` as the first member-form choice with values `child` and `adult`.
- [x] Add optional allergy detail for both children and adults.
- [x] Show and persist school name for children only.
- [x] Show and persist guardian information for children only.
- [x] Require Guardian 1 for child members.
- [x] Allow Guardian 2 to be optional.
- [x] Hide guardian fields for adult members.
- [x] Clear school and guardian data when a member is changed from child to adult.
- [ ] Backfill existing members without `memberType` as `child`.
- [ ] Report legacy child records that do not have Guardian 1 so they can be completed.

Allergy detail is optional. Guardian phone and email use the existing member validation conventions unless a later requirement changes them.

## 2. Guardian Data Contract

Add a reusable guardian value type to [the domain documents](../src/jchurchFunction/Domain/Documents.cs). Guardian 1 and Guardian 2 use the same shape.

```json
{
  "firstName": "Maria",
  "middleName": "A.",
  "lastName": "Santos",
  "relationship": "Mother",
  "otherRelationship": null,
  "phone": "555-0100",
  "email": "maria@example.com"
}
```

### Guardian fields

- `firstName`: required, maximum 200 characters.
- `middleName`: optional, maximum 200 characters.
- `lastName`: required, maximum 200 characters.
- `relationship`: required enum:
  - `Mother`
  - `Father`
  - `Grandmother`
  - `Grandfather`
  - `Others`
- `otherRelationship`: optional normally; required and non-empty when relationship is `Others`, maximum 200 characters.
- `phone`: required for every supplied guardian, maximum 50 characters.
- `email`: required for every supplied guardian, valid email address, maximum 254 characters.

The API should use nullable guardian objects so an adult can explicitly clear `guardian1` and `guardian2`.

## 3. Function App Domain Model

Update [Documents.cs](../src/jchurchFunction/Domain/Documents.cs):

- [x] Add `MemberType` to `Member`.
- [x] Add optional `AllergyDetail`.
- [x] Add nullable `Guardian1` and `Guardian2`.
- [x] Add a `Guardian` record with the fields defined above.
- [x] Preserve existing scan-code, group, custom-field, attendance, and archive properties.
- [x] Confirm JSON naming follows the existing web serializer convention, producing `memberType`, `allergyDetail`, `guardian1`, and `guardian2`.
- [x] Keep the guardian type limited to member profile data; do not duplicate guardian data into attendance records.

The model should not infer child/adult from birth date. `memberType` is an explicit user-selected value.

## 4. Function App Validation And Persistence

Update the `Member` branch of `Save()` in [DirectoryService.cs](../src/jchurchFunction/Services/DirectoryService.cs).

### Common member validation

- [x] Require `memberType` to be exactly `child` or `adult`.
- [x] Validate and trim first and last names using the existing `Name()` rules.
- [x] Validate middle name and allergy detail length.
- [x] Validate birth date, member email, groups, custom fields, and scan code using the existing rules.
- [x] Require guardian phone and email for every supplied guardian, using the same limits and email parser used for member contact data.
- [x] Normalize guardian name and relationship text consistently before persistence.

### Child rules

- [x] Require `guardian1`.
- [x] Allow `guardian2` to be null.
- [x] Validate every supplied guardian object.
- [x] Allow and persist school.
- [x] Reject an empty guardian object instead of treating it as a valid guardian.

### Adult rules

- [x] Reject requests containing non-null `guardian1` or `guardian2`.
- [x] Reject requests containing non-empty school data.
- [x] Ensure the client clears school and guardian values when converting an existing child to an adult.
- [x] Persist the adult record without child-only data.

The server must enforce these rules even when requests do not originate from the mobile app. Client-side validation is for usability, not authorization of the data contract.

## 5. HTTP Request And Update Semantics

The existing generic member routes in [ChurchApi.cs](../src/jchurchFunction/Functions/ChurchApi.cs) should remain the transport surface:

- `POST /api/v1/churches/{churchId}/members`
- `PUT /api/v1/churches/{churchId}/members/{memberId}`

No guardian-specific endpoint is required.

- [x] Confirm the OpenAPI request schema includes the new fields.
- [x] Preserve the existing exact ETag requirement for member updates.
- [x] Preserve omitted scan-code behavior: an older client that omits scan-code fields must not unintentionally remove the current scan code.
- [ ] Use explicit `null` values for `school`, `guardian1`, and `guardian2` when clearing child-only data.
- [ ] Add tests for stale ETags and failed validation to confirm the existing member remains unchanged.
- [ ] Ensure invalid adult conversion cannot partially update the record.

Example child request:

```json
{
  "memberType": "child",
  "firstName": "Jordan",
  "middleName": null,
  "lastName": "Lee",
  "birthDate": "2017-04-10",
  "school": "North Elementary",
  "allergyDetail": "Peanuts",
  "guardian1": {
    "firstName": "Maria",
    "middleName": null,
    "lastName": "Lee",
    "relationship": "Mother",
    "otherRelationship": null,
    "phone": "555-0100",
    "email": "maria@example.com"
  },
  "guardian2": null,
  "groupIds": [],
  "customFields": {}
}
```

Example adult conversion request:

```json
{
  "memberType": "adult",
  "firstName": "Jordan",
  "middleName": null,
  "lastName": "Lee",
  "birthDate": "1998-04-10",
  "school": null,
  "allergyDetail": null,
  "guardian1": null,
  "guardian2": null,
  "groupIds": [],
  "customFields": {}
}
```

## 6. OpenAPI And Mobile Contract

Update the Function App OpenAPI schema and regenerate the mobile client types.

- [x] Add `memberType` enum metadata.
- [x] Add `allergyDetail` as optional nullable text.
- [x] Add reusable guardian schema metadata.
- [x] Add relationship enum metadata.
- [x] Document the conditional rules in descriptions because OpenAPI alone may not express "Guardian 1 is required when memberType is child" cleanly.
- [x] Regenerate [generated.ts](../src/JcChurchMobile/src/api/generated.ts) using the repository generation command.
- [ ] Update [api/types.ts](../src/JcChurchMobile/src/api/types.ts) only if generated type aliases require changes.

## 7. Legacy Data Migration

Existing member documents do not contain `memberType`. Add a controlled, repeatable migration or maintenance script after checking the repository's available deployment/data tooling.

- [ ] Query only member documents that lack `memberType`.
- [ ] Set `memberType` to `child`.
- [ ] Leave existing school, contact, group, custom-field, and scan-code values unchanged.
- [ ] Count and report records where Guardian 1 is missing.
- [ ] Make the operation idempotent; rerunning it must not overwrite completed guardian information or modify already-classified members.
- [ ] Use ETag or equivalent optimistic concurrency so a concurrently edited member is not silently overwritten.
- [ ] Test the migration against in-memory fixtures before running against Cosmos DB.
- [ ] Run the migration in development first and preserve the result count for the deployment record.

The migration must not run automatically on every API request. Incomplete legacy child records should be visible for follow-up rather than bypassing the new child validation indefinitely.

## 8. Mobile Form Dependencies

After the API contract is updated, modify [domain.ts](../src/JcChurchMobile/src/domain.ts) and [Members.tsx](../src/JcChurchMobile/src/screens/Members.tsx).

- [x] Render member type as the first member-form control.
- [x] Render school only when `memberType === "child"`.
- [x] Render Guardian 1 and Guardian 2 only for children.
- [x] Render `otherRelationship` only when the selected relationship is `Others`.
- [x] Validate Guardian 1 for children and Guardian 2 only when populated.
- [x] Clear school, guardian 1, and guardian 2 in draft state when switching to adult.
- [x] Map cleared child-only fields to omitted/null-equivalent values in the request.
- [ ] Preserve existing group, scan-code, birth-date, and custom-field behavior.
- [ ] Keep labels and error messages accessible and consistent with existing form controls.

## 9. Backend Test Coverage

Extend [ServiceTests.cs](../tests/JChurch.Tests/ServiceTests.cs) and repository contract coverage as needed.

- [x] Create a valid child with Guardian 1.
- [ ] Reject a child without Guardian 1.
- [ ] Create a child with Guardian 1 and no Guardian 2.
- [ ] Create a child with both guardians.
- [ ] Reject missing guardian first or last name.
- [x] Reject missing or invalid guardian phone/email and oversized phone/name values.
- [ ] Accept each supported relationship value.
- [ ] Reject an unsupported relationship.
- [x] Require `otherRelationship` for `Others`.
- [ ] Reject an unnecessary or invalid `otherRelationship` according to the selected contract.
- [x] Create a valid adult without school or guardians.
- [x] Reject an adult with guardian data.
- [x] Reject an adult with school data.
- [ ] Update a child to adult with explicit null values and verify child-only data is removed.
- [ ] Verify failed adult conversion leaves the previous member unchanged.
- [ ] Verify existing scan-code preservation still works when new fields are added.
- [ ] Verify group and custom-field validation remains unchanged.

## 10. Mobile Test Coverage

Extend [client.test.ts](../src/JcChurchMobile/tests/client.test.ts) and the existing member E2E coverage.

- [x] Validate `memberType` enum values.
- [x] Validate optional allergy detail and its maximum length.
- [x] Require Guardian 1 for children.
- [x] Allow Guardian 2 to be empty.
- [x] Require custom relationship when `Others` is selected.
- [x] Reject guardian fields for adults.
- [ ] Verify member type renders before all other member fields.
- [ ] Verify adult forms hide school and guardian fields.
- [ ] Verify child forms show school and both guardian sections.
- [x] Verify switching child to adult clears hidden values from the outgoing payload.
- [ ] Verify both guardian records are mapped correctly.

## 11. Security And Privacy Boundaries

- [ ] Treat guardian and allergy data as personal/sensitive profile information.
- [ ] Do not add guardian or allergy data to `SearchText`, scan-code lookups, attendance documents, URLs, or logs.
- [ ] Keep existing church-scoped validation and ETag protections.
- [ ] Preserve the current local synthetic-data and unauthenticated-development restrictions.
- [ ] Require approved authentication and authorization before real member or guardian data is used in a hosted environment.
- [ ] Avoid returning guardian details in list/search responses if the existing API can return a reduced member projection; confirm the current response contract before changing it.

## 12. Delivery Order

1. [x] Confirm field names, JSON names, nullable behavior, and relationship enum values.
2. [x] Add the domain records and server validation.
3. [x] Add backend tests and run them before changing the client.
4. [x] Update OpenAPI and regenerate client types.
5. [x] Add client validation and request mapping.
6. [x] Update the mobile member editor and conditional state clearing.
7. [ ] Add mobile unit and E2E tests.
8. [ ] Implement and test the legacy migration in a non-production environment.
9. [ ] Run the complete verification suite and inspect the generated OpenAPI document.

## 13. Verification Commands

From the repository root:

```bash
dotnet build src/jchurchFunction/jchurchFunction.csproj
dotnet test tests/JChurch.Tests/JChurch.Tests.csproj
npm run generate:api --prefix src/JcChurchMobile
npm run typecheck --prefix src/JcChurchMobile
npm test --prefix src/JcChurchMobile
```

For integrated verification:

```bash
npm run test:e2e --prefix src/JcChurchMobile
node tests/http-smoke.mjs
```

Before declaring the feature complete, verify that:

- A child cannot be saved without Guardian 1.
- An adult cannot retain school or guardian information.
- Switching child to adult removes persisted child-only data.
- A legacy member is classified as a child by the migration and is reported if Guardian 1 is missing.
- Existing scan-code, group, custom-field, attendance, and archive behavior continues to pass.
