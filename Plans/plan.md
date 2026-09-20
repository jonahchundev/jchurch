# Plan: Groups And Subgroups Management

## Implementation Status

Implemented for synthetic local development. Settings opened from a selected church and church Home both expose Manage Groups. The Groups route is hidden from the bottom tab bar.

- Verified: 49 backend tests passed, 1 opt-in Cosmos integration test skipped; 14 client tests; TypeScript; 16 desktop/phone-sized browser cases, including the live API group lifecycle. Desktop/mobile hierarchy screenshots were inspected.
- Contract decisions: reuse existing group CRUD endpoints and exact ETags. Parent relationships are immutable; create a replacement group to change hierarchy. Archive active subgroups before their parent; no cascade or restore.
- Preserve existing multiple member assignments in one Groups section. The original single-selection assumption was incorrect; existing memberships must not be silently dropped.
- Fetch all group pages with the existing group loader, then filter names locally so subgroup search retains its parent context. This fetches group definitions only, never the member directory.
- Member counts are deferred because the API has no aggregate count contract. Archive confirmation always warns about retained memberships and history.
- Still unverified: native iOS/Android accessibility, back/keyboard behavior, and real Cosmos integration. Authentication and production release gates remain unchanged.

## 1. Goal And Scope

Add church-scoped screens for managing groups and subgroups in the mobile app Settings experience. Groups organize members for filtering, check-in context, and administration; they should not crowd the daily-operation tabs unless later usage proves they are a primary workflow.

- [x] Add a Groups management entry from Settings and the selected church Home admin area.
- [x] Support creating, editing, and archiving top-level groups.
- [x] Support creating, editing, and archiving subgroups beneath one parent group.
- [x] Keep existing multiple assignments in one Groups section using labels such as `Parent / Subgroup`.
- [x] Preserve existing Members, Events, and Check-In tab behavior.

This plan extends the [React Native mobile app plan](reactnative-ui-plan.md) and uses the existing group API listed there. It does not authorize production deployment, authentication changes, or broader permission relaxation.

## 2. User Experience

Groups belong in a settings/admin area because they shape how a church is organized rather than being a repeated check-in task.

Recommended flow:

1. Staff select a church.
2. Staff open Settings or the church Home admin section.
3. Staff choose Groups.
4. The Groups screen shows top-level groups as primary rows, with subgroups visually nested underneath each parent.
5. Staff can add a top-level group from the screen header.
6. Staff can add a subgroup from a parent group row.
7. Create and edit actions open the same modal `Sheet` pattern used by church, member, and event editors.

Use a two-level hierarchy for the first version. Avoid drag-and-drop or arbitrary deep nesting until there is a proven operational need.

## 3. Screen Design

The Groups screen should follow existing compact management screens rather than a dashboard layout.

- [x] Show a search field for group and subgroup names, retaining parent context for matches.
- [x] Render each top-level group as a row with its name, edit action, and separate Add Subgroup action.
- [x] Render subgroups indented under their parent with the same edit/archive affordances.
- [x] Use labels like `Parent / Subgroup` anywhere a flat option label is needed.
- [x] Show empty, loading, retry, conflict, and unavailable-service states using the existing query UI patterns.
- [x] Warn before every archive about retained memberships and attendance history, without claiming counts.

If member counts are not available from the current API, defer counts rather than adding client-side directory scans or broad cached member downloads.

## 4. Editor Behavior

The group editor should be intentionally small.

- [x] Name: required, trimmed, and limited to 200 characters.
- [x] Parent group: absent for top-level creation; preset and read-only for subgroup creation/editing.
- [x] Archive action: destructive, explicitly labeled Archive Group or Archive Subgroup.
- [x] Save and archive with exact ETags.
- [x] Preserve draft values after validation, conflict, throttling, or network errors; confirm before discarding.
- [x] On stale-version conflict, offer reload and review rather than silently overwriting.
- [x] After uncertain writes, block repeat submission. Reload existing groups; for uncertain creation, close the draft and refresh the list before creating another record. Do not automatically retry creation.

Subgroups should not be assignable as parents in the first version. This keeps the hierarchy to two visible levels and prevents accidental deep trees.

## 5. Member Assignment Integration

The existing member editor already consumes groups and displays parent/child labels. Keep that mental model.

- [x] Preserve existing multiple assignments using toggles in one Groups section.
- [x] Include both top-level groups and subgroups as assignable choices.
- [x] Use flat `Parent / Subgroup` labels in assignment controls, filters, and member subtitles.
- [x] Exclude archived groups from new assignments.
- [x] Show assigned archived groups with an archived label. Require their removal or replacement before saving, matching server validation; do not silently clear them.

## 6. Backend And Contract Considerations

The API already supports GET/POST on `/churches/{churchId}/groups` and GET/PUT/DELETE on `/churches/{churchId}/groups/{id}`. No backend production code or OpenAPI changes were needed.

- [x] Confirm group document shape: `id`, `churchId`, `name`, optional `parentGroupId`, `active`, and `_etag`.
- [x] Confirm API support for creating top-level groups and subgroups.
- [x] Confirm names can change while parent relationships are immutable.
- [x] Confirm API support for archiving groups and subgroups; archive children first.
- [x] Verify server rejection of self-parenting, parent changes, and deeper-than-two-level nesting.
- [x] Verify church isolation, stale ETags, retained memberships, and archived-assignment rejection in service tests.

Existing network, anonymous-development, and deployment safeguards are unchanged.

## 7. Implementation Touchpoints

Implemented mobile touchpoints:

- [x] [Churches](../src/JcChurchMobile/src/screens/Churches.tsx) - Settings' existing screen exposes Groups when a church is selected; global church management remains available without a selection.
- [x] [Church Home](../src/JcChurchMobile/app/church/[churchId]/index.tsx) - add Manage Groups.
- [x] [Groups route](../src/JcChurchMobile/app/church/[churchId]/groups.tsx) and [church layout](../src/JcChurchMobile/app/church/[churchId]/_layout.tsx) - register the church-scoped screen without adding a visible tab.
- [x] [Groups screen](../src/JcChurchMobile/src/screens/Groups.tsx) - hierarchy, search, forms, archives, refresh, and recovery.
- [x] [Members](../src/JcChurchMobile/src/screens/Members.tsx) - hierarchical subtitles and actionable archived-assignment validation.

Existing generated API types, domain documents, directory service, and generic group routes were reused unchanged. Added regression coverage in [service tests](../tests/JChurch.Tests/ServiceTests.cs) and [browser workflows](../src/JcChurchMobile/tests/e2e/workflows.spec.ts).

## 8. Delivery Phases

- [x] Phase 1 - Contract check: verify existing group write APIs, document shape, hierarchy rules, and ETag behavior.
- [x] Phase 2 - Backend gaps: existing support is sufficient; extend lifecycle regression tests.
- [x] Phase 3 - Mobile screen: add route, list, nested display, create/edit sheet, archive confirmation, and query invalidation.
- [x] Phase 4 - Member integration: ensure assignment options reflect the hierarchy and archived-group rules.
- [x] Phase 5 - Verification: backend tests, mobile typecheck/client tests, and desktop/phone-sized browser e2e coverage pass.

## 9. Acceptance Checklist

- [x] Groups opens from selected-church Settings and Home.
- [x] Top-level groups and subgroups can be created for the selected church.
- [x] A clear two-level hierarchy survives pagination and subgroup-only search results.
- [x] Name editing, dirty-draft protection, stale-edit reload, and uncertain-write recovery work in browser tests.
- [x] Archives require explicit confirmation; live API coverage rejects parent archive until its active child is archived.
- [x] Archived groups are unavailable for new member assignments and remain visible on existing assignments until explicitly removed.
- [x] Members can be assigned to top-level groups or subgroups without losing support for multiple memberships.
- [x] Member filters and labels use `Parent / Subgroup` display text.
- [x] Church switching isolates group data; route state is keyed by church and queries use church-scoped keys and cancellation signals.
- [x] Backend tests cover church isolation, parent validation, cycle prevention, archive behavior, and conflict handling.
- [x] Browser tests cover groups navigation, create/edit/archive flows, member assignments, pagination/search, recovery, and phone-sized layout.
- [ ] Native iOS/Android device verification and real Cosmos integration remain release gates, not established by browser tests.

Primary journey: select church -> open Groups -> create a parent group -> add a subgroup -> edit a member -> assign the subgroup -> return to Members and see the `Parent / Subgroup` label -> archive the subgroup -> confirm it is unavailable for new assignments.