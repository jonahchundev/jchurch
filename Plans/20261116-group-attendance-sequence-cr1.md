# Plan: Group attendance sequence

## Agreed behavior
- Add Totals / Attendance sequence views to Report by Group. Preserve Totals.
- Sequence requires one event and a finite date range of at most 93 days.
- Include current active group members and optionally subgroup members, even with
  no attendance. This is a current roster view, not historical membership tracking.
- Blue means active check-in. Red means no check-in once the session starts.
  Late check-ins change red to blue; undone receipts count as missing.
- Upcoming sessions, pre-registration sessions and unknown legacy eligibility are
  neutral. Exclude canceled sessions. Include persisted sessions with zero check-ins.
- Date range appears once above the list. Only squares wrap, chronologically left
  to right then top to bottom. Columns adapt to measured container width, with the
  same positions for every member. No fixed column count or horizontal paging.
- Each member shows name, `Latest streak: Absent 3 in a row` or
  `Latest streak: Attended 4 in a row`, squares, and attended/absent totals.
- Streaks span visual row breaks and cover eligible started sessions in the selected
  range. Tap a square for read-only session/status/check-in details.

## Implementation
1. Pure sequence model and tests: ordering, eligibility, status, totals, latest
   streak, layout columns, cancellation, future/early/late receipts and undo.
2. Read-only data hook: page actual event occurrences in the range and receipts per
   occurrence, at most four concurrent requests. Do not filter by check-in timestamp
   or historical receipt group membership. Never render incomplete loads as absence.
3. Responsive component using existing UI tokens/icons, 44px touch targets and
   compact colored square glyphs with check/minus icons. Shared width measurement,
   search/sort controls, neutral legend and session detail sheet.
4. GroupReport integration with event/range prerequisites, independent error/empty
   states, focus/manual refresh and session-start clock updates.
5. Textual CSV/PDF exports including dates, statuses, totals, streak and current-roster
   basis; use long-form session rows to keep PDFs readable at large session counts.
6. Unit/type checks and desktop/mobile Playwright tests for wrapping, resize,
   zero-attendance members, details, filter changes and loading/error safety.

## Limits
No new backend endpoints, stored absence records, historical membership reconstruction,
excused-absence model, infrastructure or changes to the earlier merge work. A red
square means no recorded check-in, not proof of an excused/unexcused absence.
Missing legacy creation dates are unknown until the first recorded attended session.
Current membership does not establish when someone joined a group. The report does
not generate missing historical event sessions from recurrence rules.

## Verification
- Implemented in GroupReport with the pure model, bounded paged loader and responsive
  AttendanceSequenceView. No backend or infrastructure changes.
- Seven focused unit tests pass; frontend typecheck passes.
- Eight new desktop/mobile Playwright checks pass: responsive wrapping and resize,
  zero-attendance members, details, subgroup toggle, search/absence sorting, CSV,
  failed-load safety, finite ranges, session-start rollover and late check-in refresh.
- Two pre-existing desktop/mobile By Group Totals search/sort checks pass.
- Desktop and portrait screenshots inspected: identical member row breaks at each
  width, no horizontal overflow, responsive square-only wrapping and latest streaks.
- Full frontend unit suite: 70 pass, 4 pre-existing guardian/registration tests fail
  because fixtures omit required gender. Those unrelated fixtures remain unchanged.
- Earlier merge changes remain intact on the existing branch; no commit was made.