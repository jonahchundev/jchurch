# Plan: Checked-in roster + By Member report sort and filter parity with Find member

## Goal
Give the checked-in member list (the "Checked in" tab on Check-in, and the read-only roster on
the Session report) and the By Member report's member picker the same sort/filter controls as
Find member: a group/subgroup multi-select filter, name order (A-Z / Z-A), and created-date
order (Off / Newest / Oldest), all inside a sort/filter Sheet opened from the search row.

## Decisions
- Group filtering is server-side via the existing `groupIds` query parameter on
  `GET /churches/{churchId}/attendance`, matching the check-in-time group snapshot
  (`groupIds`, not `inclusiveGroupIds`) — the same direct-match semantics as the member list.
  No backend changes required; `QueryParsing` and both repositories already support it.
- Name and created-date ordering are client-side. Attendance receipts do not denormalize member
  names, so server-side ordering would require a snapshot model change plus two-phase pagination
  for legacy receipts. A per-occurrence roster is bounded, so the roster now loads all receipts
  (`useAll`) and all member details (`useQueries`, same cache keys as before) up front, then
  orders with the same rules as the member list: optional created-date phase (undated members
  always last), then last name / first name / id in the requested direction.
- The comparator lives in a pure module (`src/reports/rosterSort.ts`) so it is vitest-testable,
  mirroring how `duplicates.ts` is structured.
- The "Load more check-ins" pagination button is removed: correct cross-page ordering requires
  the full roster anyway.
- By Member report (`MemberReport.tsx`): the member picker (`useList`, pageSize 5) is a
  members-list query, so all three controls wire straight into server-side filters — the same
  `groupIds`/`nameSort`/`createdOnSort` params the Members screen uses. No client-side ordering
  needed here.
- By Group report (`GroupReport.tsx`): the "By member" list is built client-side from the
  attendance summary plus the already-loaded members, so it gets the search text box plus a
  sort/filter Sheet with name order and created date (group filter omitted — the report is
  already scoped to one group). Ordering reuses `compareRosterMembers`; when no sort is
  selected the list keeps its default check-in-count ordering.

## Steps
1. Add `src/JcChurchMobile/src/reports/rosterSort.ts` with `compareRosterMembers`.
2. Rework `src/JcChurchMobile/src/reports/AttendanceRoster.tsx`:
   - state: `groupIds`, `nameSort` (default `asc`), `createdOnSort` (default off), `sortOpen`;
   - `useAll<Attendance>` with `occurrenceId`, debounced `search`, and `groupIds`;
   - `useAll<Group>` for the checklist; `useQueries` member details per receipt;
   - search row gains the `swap-vertical-outline` IconButton ("Sort and filter checked-in
     members"); Sheet contains the group Toggle checklist, "Name order" and "Created date"
     SegmentedControls, same as Members.tsx;
   - `RosterRow` receives the preloaded `member` as a prop (no per-row query).
3. Add `tests/rosterSort.test.ts` (name order, tie-breaks, created-date phases, undated-last,
   unloaded-member rows) and include it in the `npm test` script.
4. Add a mocked Playwright test ("checked-in roster sorts and filters like the member list")
   asserting default A-Z order, Z-A reversal, created-date ordering, and that the group filter
   sends `groupIds` to the attendance endpoint and narrows the list.
5. `MemberReport.tsx` By Member picker: add `groupIds`/`nameSort`/`createdOnSort`/`sortOpen`
   state, wire into the `useList<Member>` query (server-side), fetch groups via `useAll`, and
   render the same search-row IconButton + Sheet. Add a mocked Playwright test ("by-member
   report picker sorts and filters like the member list") asserting the params reach the
   members endpoint and the group filter narrows results.
6. `GroupReport.tsx` By member list: add search text box + sort/filter Sheet (name order,
   created date), filter rows client-side by member name, order with `compareRosterMembers`,
   keep count-descending as the default when no sort selected. Add a mocked Playwright test
   ("by-group report searches and sorts its member list").

## Verification
- `npm run typecheck` clean; `npx vitest run tests/rosterSort.test.ts` 6/6 pass.
- Playwright: new roster test, new by-member picker test, "attendance reports drill from the
  hub to a read-only session roster", and "guide screenshots: check-in flow and undo" all pass.
- Gotcha discovered: Metro CI mode caches bundles — after changing screens, restart the dev
  server (`expo start --clear`) or e2e tests run against stale code and fail confusingly.
- Note: `tests/client.test.ts` has 4 pre-existing guardian-validation failures on main,
  unrelated to this change.
