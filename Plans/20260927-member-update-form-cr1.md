# Plan: Public member self-service update form + QR code

## Goal
A public, unauthenticated page at `/update/{churchId}/{memberId}` where a member/guardian can
edit their own contact/personal details and guardians, reusing the existing
`publicRegistrationSchema`/`publicMemberInput` (child requires guardian1 name/phone/email; adult
forbids guardian/school). Prefilled from the current member record, submitted as `PUT` with the
fetched `_etag` for optimistic concurrency (same pattern as the staff `MemberEditor`). A new
"Update link" QR icon on the member detail page opens the link/QR via the existing
`RegistrationCode` component.

## Steps

### Phase A — Shared domain helper
1. `src/JcChurchMobile/src/domain.ts` — add `publicRegistrationDefaults(member?: Member): PublicRegistrationFormValues`,
   scoped to public-safe fields (memberType, firstName/middleName/lastName, birthDate, school,
   allergyDetail, guardian1/guardian2). Used by both `PublicRegister.tsx` (no member → blank form)
   and the new `PublicUpdate.tsx` (fetched member → prefilled form). `publicRegistrationSchema` /
   `publicMemberInput` stay unchanged.

### Phase B — Shared form UI
2. New `src/JcChurchMobile/src/screens/PublicMemberForm.tsx` — extract the memberType toggle,
   personal-detail fields, and guardian1/guardian2 fields (currently inline in
   `PublicRegister.tsx`) into a shared component reused by both screens.
3. Refactor `PublicRegister.tsx` to use the shared component and `publicRegistrationDefaults()`
   (no behavior change).

### Phase C — Public update screen + route
4. New `src/JcChurchMobile/src/screens/PublicUpdate.tsx`:
   - Props: `{ churchId: string; memberId: string }`.
   - Fetches Church (branding) and the Member (anonymous GET) for prefill + `_etag`.
   - If `!member.active`, shows an archived `Notice` above the form but still renders the form.
   - Form uses `publicRegistrationSchema` + `publicRegistrationDefaults(member)`, Child/Adult
     remains editable.
   - Submit: `api.save<Member>(churchPath(churchId, "members/{memberId}"), publicMemberInput(values), member._etag)`.
   - On success: warm confirmation screen, no "update again" loop.
   - On `412` (stale): notice + "Reload latest and try again" button that refetches and resets
     the form, matching the staff `MemberEditor`'s `reload` mutation.
5. New route `app/update/[churchId]/[memberId].tsx`, registered in `app/_layout.tsx`'s `<Stack>`
   with `headerShown:false`.

### Phase D — QR button on member detail page
6. `src/JcChurchMobile/src/screens/Members.tsx` (`MemberEditor`) — add an "Update link"
   `IconButton` next to "Edit member", shown whenever editing an existing member (regardless of
   archived state). Opens `RegistrationCode` with `url = {registrationBaseUrl()}/update/{churchId}/{member.id}`.

### Phase E — Tests
7. `src/JcChurchMobile/tests/client.test.ts` — cases for `publicRegistrationDefaults()`: child
   member with guardian1 prefills correctly; adult member prefills with `guardian1: undefined`.

## Relevant files
- `src/JcChurchMobile/src/domain.ts`
- `src/JcChurchMobile/src/screens/PublicMemberForm.tsx` (new)
- `src/JcChurchMobile/src/screens/PublicRegister.tsx`
- `src/JcChurchMobile/src/screens/PublicUpdate.tsx` (new)
- `src/JcChurchMobile/app/update/[churchId]/[memberId].tsx` (new)
- `src/JcChurchMobile/app/_layout.tsx`
- `src/JcChurchMobile/src/screens/Members.tsx`
- `src/JcChurchMobile/tests/client.test.ts`

## Verification
1. `npx tsc --noEmit` and `npm test` in `src/JcChurchMobile`.
2. From an existing member's detail page, open "Update link", confirm the public page loads
   prefilled with that member's current data.
3. Edit a field and submit → member record updates; simulate a stale `_etag` (edit as staff
   concurrently) → shows reload-and-retry notice instead of a raw error.
4. Confirm an archived member's update link still opens the form and shows the archived notice.
5. Confirm switching Child ↔ Adult applies the same guardian-required/forbidden rules as
   registration.

## Decisions
- No extra per-member update token — the member ID alone (unguessable GUID) gates the link, same
  trust model as the registration URLs.
- Child/Adult is editable on the update form (not locked).
- The "Update link" QR button is always shown, including for archived members; the public page
  itself displays an archived notice rather than blocking the form.

## Further considerations
- No audit trail distinguishing public vs. staff edits.
- No rate limiting or staff notification on public updates, consistent with the registration
  feature's current posture.
