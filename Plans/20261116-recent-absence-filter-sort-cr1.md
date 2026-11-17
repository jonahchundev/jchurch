# Plan: Recent absence filters and sorting

## Confirmed decisions
- Extend By Group Attendance Sequence only. Default stays All members/member order.
- Recently absent is optional: latest eligible session absent, ordered by current
  absence streak, then misses in the last five sessions, then member order.
- Count started sessions, including ongoing ones, and identify in-progress sessions.
- All metrics and last-attended labels are scoped to the selected report dates.
- Exclude future, canceled, pre-registration and unknown-eligibility cells. Members
  with no eligible sessions must not match absence filters.

## Implementation
1. Pure helpers derive eligible count, latest absence, absence streak, recent misses
   and actual sample size, last attended session start and in-progress status.
2. Single-choice filters: All members; Absent at latest eligible session; Consecutive
   absences (minimum default 2); Missed recently (at least 3 of last 5 by default);
   No attendance in selected dates. Validate positive integers and missed <= window.
3. Sort by member order, current absence streak, misses in last N, or longest since
   last attendance in selected dates. No attendance in range sorts before known
   attendance for last-attended order; no eligible history sorts last.
4. Existing sheet gains draft settings with Apply/Cancel/Reset. Presets populate
   visible settings; edits indicate Custom. Search stays independent. Show active
   summary and matching count outside sheet, plus a clear action for zero matches.
5. Add per-member missed-recent and scoped last-attended context. Preserve wrapped
   squares and latest-streak text. Started-session and late-check-in refreshes
   recompute filter membership and ordering.
6. CSV/PDF use displayed members/order with active settings and new metrics; retain
   full selected session history. No extra API calls, backend or infrastructure work.

## Tests
Pure metric/filter/sort/validation tests, including fewer than N sessions, no
eligible history, future trailing cells, last session versus receipt time and ties.
Desktop/mobile tests cover each filter/sort, preset/reset, numeric Apply/Cancel,
search, empty state, filtered export, in-progress/late-check-in updates and layout.
Run typecheck, focused unit tests, sequence browser tests and old Totals workflow.
Document unrelated existing unit failures separately.

## Results
- Implemented pure helpers, draft Apply/Cancel/Reset sheet, optional preset,
   active summaries/counts, zero-result clear action, per-member recent/last-attended
   context and in-progress indicators. Totals controls remain independent.
- Sequence exports use filtered rows/order with recent metrics and settings while
   retaining all selected sessions. No extra API calls or backend changes.
- Typecheck and 37 focused unit tests passed (six new filter helper tests).
   Ten sequence browser tests passed across desktop/mobile,
   including late-check-in filter membership changes. Both existing Totals search/sort
   browser tests passed. Desktop and portrait screenshots inspected with no overflow.
- Full frontend unit suite: 76 passed, four pre-existing guardian/registration
   fixture tests fail because they omit required gender; left unchanged.
- Changes remain uncommitted on `fix/member-merge-completion`, alongside the prior
   merge and sequence work. No infrastructure changes or deployment.