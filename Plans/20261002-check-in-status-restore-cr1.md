# Plan: Restore check-in status when returning to the check-in screen

**Branch:** `feature/check-in-status-restore`
**Date:** 2026-10-02
**Scope:** Mobile app only — no backend changes.

## Problem

On the check-in screen ("Find members" tab), the per-member check-in status
("Checked in" badge, hidden "Check in" button) is tracked only in local
`useState` (`receipts`) inside `ActiveCheckIn`
(`src/JcChurchMobile/src/screens/CheckIn.tsx`). The state is wiped whenever the
screen unmounts — tab switch, navigation away, app restart, or the
`key={churchId/occurrenceId}` remount — so members who were already checked in
appear unchecked when the user returns.

The "Checked in" tab (`AttendanceList`) does not have this problem because it is
server-backed via `GET /churches/{churchId}/attendance?occurrenceId=...`
(`src/jchurchFunction/Functions/ChurchApi.cs`, route at ~L115), which returns
active attendance records only (`ActiveOnly` default in `ParseQuery`).

## Approach

Derive per-member status in the "Find members" tab from the same
server-authoritative attendance list, merged with local `receipts` for
in-session "Already checked in" labeling and error/uncertain retry states.

Rejected alternatives:

- **Per-member status endpoint** (`GET .../check-ins/{memberId}`) — N+1 requests.
- **AsyncStorage persistence** — stale data, wrong for multi-device check-in.
- **Keeping the screen mounted** — fragile, does not survive app restart.

## Changes (`src/JcChurchMobile/src/screens/CheckIn.tsx`)

1. Import `useMemo` from React.
2. In `ActiveCheckIn`, add an attendance query next to the existing member/group
   hooks:
   `useAll<Attendance>(churchPath(event.churchId, "attendance"), { occurrenceId: occurrence.id })`
   (`useAll` fetches all pages at pageSize 200; queryKey
   `[path, "all", filters]`).
3. Memoize `checkedInByMember = Map<memberId, Attendance>` from
   `attendance.data`.
4. In the member row render:
   - Effective receipt: `receipts[member.id]?.receipt ?? checkedInByMember.get(member.id)`.
   - Badge: "Already checked in · time" only for in-session re-checks
     (`state.already`); otherwise "Checked in · {checkedInAt in event.timeZone}".
   - Hide the "Check in" button when the effective receipt exists.
5. Disable check-in buttons while the attendance query is initially pending
   (fold `attendance.isPending` into `blocked`) to avoid a flicker where an
   already-checked-in member shows an enabled button before status loads.
   Check-in is idempotent server-side regardless (returns 200 + `already`).
6. Add a "Refresh status" `IconButton` (`refresh-outline`) in the header row
   (before "Change session") that re-fetches the latest status on demand:
   - `attendance.refetch()` — refresh per-member check-in status
   - `query.refetch()` — refresh the member list
   - invalidate `events/{eventId}/occurrence-check-in-counts` — refresh counts
   - prune stale local `receipts` entries (keep only entries with a confirmed
     `receipt`; drop error-only/uncertain entries so refreshed server state
     replaces them)
   - Disabled while `attendance.isRefetching`, a check-in is pending, or the
     scan view is locked.

## Sync behavior (no new code required)

- Check-in mutation `onSuccess` invalidates `[churchPath(churchId, "attendance")]`,
  which prefix-matches the new `useAll` key (React Query default
  `exact: false`) — status stays fresh after each check-in.
- `ScanCheckIn.tsx` (~L59) already invalidates the same prefix after scans.
- Undo (`AttendanceRow` `onSuccess`) invalidates the same prefix — after
  refetch, the member's "Check in" button reappears. `onUndo` also clears the
  member's local receipt entry, removing any stale error state.

## Verification

1. `npx tsc --noEmit` in `src/JcChurchMobile`.
2. Manual (Expo app against local `func start` backend):
   - Check in a member → switch tabs → return → "Checked in · time" badge
     persists, no "Check in" button.
   - Kill/restart the app → open the same session → status still shown.
   - "Checked in" tab → Undo → back to "Find members" → "Check in" button
     reappears after refetch.
   - Scan a code in the Scan tab → back to "Find members" → member shows
     checked in.
   - Re-tap "Check in" before attendance resolves → idempotent 200 →
     "Already checked in" badge, no duplicate record in "Checked in" tab.
   - Tap the header "Refresh status" icon → latest check-ins appear in
     "Find members" without leaving the screen.
3. `dotnet test tests/JChurch.Tests` (backend untouched; sanity only).

## Notes / further considerations

- Multi-device live sync: optionally add `refetchInterval: 30000` to the new
  attendance query (matches the event/occurrence polling). Not included in this
  change; 15s `staleTime` + focus-manager foreground refetch is the baseline.
- Very large sessions: `useAll` pages through all check-ins (200/request).
  Acceptable today; consider a bulk status endpoint if sessions grow into
  thousands of check-ins.
- Out of scope: persisting transient Scan-tab result cards; "Checked in" tab
  behavior (already server-backed).
