# Plan: Increase member list page size to 200

## Goal
Raise the number of members fetched per page (before "Load more" is needed) on the Members
screen and the Check-in "Find members" tab from the current default of 50 to the backend's
max of 200. No other paginated lists (Events, Attendance/"Checked in" tab, Occurrences) are
affected.

## Steps
1. `src/JcChurchMobile/src/screens/Members.tsx` — add `pageSize: 200` to the
   `useList<Member>(path, { search, groupId })` filters object.
2. `src/JcChurchMobile/src/screens/CheckIn.tsx` — add `pageSize: 200` to the member-search
   `useList<Member>(churchPath(event.churchId, "members"), {...})` call (the "Find members" tab
   query). Leave the Events and Attendance/"Checked in" tab `useList` calls untouched.

## Relevant files
- `src/JcChurchMobile/src/screens/Members.tsx`, `src/JcChurchMobile/src/screens/CheckIn.tsx` — the
  two queries to change
- `src/JcChurchMobile/src/api/client.ts` — `api.page` spreads `filters` after its `pageSize: 50`
  default, so an explicit `pageSize` filter already overrides it; no client changes needed
- `src/JcChurchMobile/src/api/hooks.ts` — `useList` passes filters straight through; no change needed

## Verification
1. `npx tsc --noEmit` in `src/JcChurchMobile`.
2. Manually confirm Members screen loads up to 200 members before showing "Load more".
3. Manually confirm Check-in "Find members" tab behaves the same.
4. Confirm Events and Check-in's "Checked in" tab still page at 50 (unchanged).

## Decisions
- 200 is the backend's documented max page size; going higher requires a backend change (out of scope).
- Scope limited to member lists only — Events/Attendance/Occurrences unaffected.
