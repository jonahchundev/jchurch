# Plan: Public child/adult registration forms + QR codes

## Goal
Two public, unauthenticated registration pages that reuse the existing anonymous
member-create and check-in APIs:
1. General registration at `/register/{churchId}` — creates a member only.
2. Session registration at `/register/{churchId}/{eventId}/{occurrenceId}` — creates the
   member, then auto-checks them in for that session.

Both forms support **child or adult** via a member-type toggle. When "Child" is selected,
guardian1 name/phone/email are required via a new, stricter front-end-only zod schema (kept
separate from the relaxed staff-facing `memberSchema`). When "Adult" is selected, no
guardian/school fields are shown, matching existing adult member rules. Add "New registration"
QR-code icon buttons to the Members screen (general link) and Check-in screen (session link,
only once a session is selected). Add a new `EXPO_PUBLIC_REGISTRATION_BASE_URL` env var.

## Steps

### Phase A — Env & config
1. `src/JcChurchMobile/.env` / `.env.example` — add `EXPO_PUBLIC_REGISTRATION_BASE_URL`
   (dev default `http://localhost:8081`, matching the Expo web dev server).
2. New `registrationBaseUrl()` helper in `src/JcChurchMobile/src/api/api-url.ts`, reading
   `process.env.EXPO_PUBLIC_REGISTRATION_BASE_URL` with a `window.location.origin` fallback on web.

### Phase B — Public registration schema + screen
3. `src/JcChurchMobile/src/domain.ts` — new `publicRegistrationSchema` and `publicMemberInput()`:
   child/adult toggle; guardian1 firstName/lastName/phone/email required only for child; adult
   forbids guardian/school (mirrors `memberSchema`'s existing child/adult split).
4. New `src/JcChurchMobile/src/screens/PublicRegister.tsx` — standalone form (no tab chrome):
   fetches Church for branding, renders the child/adult toggle + fields, submits via
   `api.save<Member>`, then `api.checkIn(...)` if a session was provided, and shows a
   confirmation screen.
5. New routes `app/register/[churchId]/index.tsx` and
   `app/register/[churchId]/[eventId]/[occurrenceId].tsx`, registered in `app/_layout.tsx`'s
   `<Stack>` with `headerShown:false`, outside the authenticated `church/[churchId]` Tabs layout.

### Phase C — QR code + "New registration" buttons
6. New `src/JcChurchMobile/src/RegistrationCode.tsx` (mirrors `ScanCode.tsx`'s `ScanCard`):
   given `{ url, title }`, renders a Sheet with a bwip-js QR SVG encoding `url`, the plain URL
   text, and share/print buttons.
7. `src/JcChurchMobile/src/screens/Members.tsx` — add an `IconButton` ("New registration") to
   `Page actions`, opening `RegistrationCode` with `url = ${registrationBaseUrl()}/register/${churchId}`.
8. `src/JcChurchMobile/src/screens/CheckIn.tsx` — add a matching `IconButton`, rendered only
   once a session (`occurrenceId`) is selected, opening `RegistrationCode` with
   `url = ${registrationBaseUrl()}/register/${churchId}/${eventId}/${occurrenceId}`.

### Phase D — Tests & docs
9. `src/JcChurchMobile/tests/client.test.ts` — cases for `publicRegistrationSchema`: child
   missing guardian1 fields rejected; fully-filled child accepted; adult with no guardian/school
   accepted; adult with guardian1 present rejected.
10. `README.md` — document the new public registration URLs and env var.
11. No backend changes required — existing anonymous member-create and check-in endpoints are
    reused as-is.

## Relevant files
- `src/JcChurchMobile/.env`, `.env.example`
- `src/JcChurchMobile/src/api/api-url.ts`
- `src/JcChurchMobile/src/domain.ts`
- `src/JcChurchMobile/src/screens/PublicRegister.tsx` (new)
- `src/JcChurchMobile/src/RegistrationCode.tsx` (new)
- `src/JcChurchMobile/app/register/[churchId]/index.tsx` (new)
- `src/JcChurchMobile/app/register/[churchId]/[eventId]/[occurrenceId].tsx` (new)
- `src/JcChurchMobile/app/_layout.tsx`
- `src/JcChurchMobile/src/screens/Members.tsx`, `src/JcChurchMobile/src/screens/CheckIn.tsx`
- `src/JcChurchMobile/tests/client.test.ts`
- `README.md`

## Verification
1. `npx tsc --noEmit` and `npm test` in `src/JcChurchMobile`.
2. Manually open `/register/{churchId}`, submit child without guardian1 phone/email → blocked
   client-side; fully filled → member appears in Members list immediately.
3. Manually open `/register/{churchId}/{eventId}/{occurrenceId}`, submit → member created AND
   shows checked-in on the Check-in screen's "Checked in" tab.
4. QR codes on Members/Check-in screens resolve to the correct URLs; Check-in's icon hidden
   until a session is chosen.

## Decisions
- Member is saved active immediately — no pending/approval workflow.
- No new rate limiting added to the public endpoints.
- Check-in's registration QR requires a session to already be selected.
- Env var kept as `EXPO_PUBLIC_REGISTRATION_BASE_URL` (Expo requires the `EXPO_PUBLIC_` prefix).
- Adults can register for a session too (same create-then-check-in flow as children).

## Further considerations
- The public API is anonymous today; `Configuration.ValidateSafety` already restricts the whole
  app to Development/Test environments. This feature doesn't change that, but call it out before
  a real public launch (no rate limiting, no dedupe on repeated registrations).
