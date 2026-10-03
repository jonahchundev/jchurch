# Plan: Three-role user management (Global Admin / Church Admin / User)

TL;DR: Add a `User` document (email-keyed, role + church assignments) to the Functions backend with
anonymous `/api/v1/users` CRUD endpoints (structural validation only, no authz), then add mobile role
resolution (temp "admin" login = built-in global admin; Google login matched by email) with client-side
church filtering and a Users management screen for admins. Invites are pre-provisioned records — no
email is sent — with invite status tracked (invited → active on first login claim).

## Decisions (confirmed with user)
- Scope: backend + mobile UI.
- Invite = pre-provision by email; when the person signs in with Google, matching email activates
  their role. No email infrastructure.
- Email is the identity key. `User.Id` = normalized lowercase email; email immutable after creation.
- Temp "admin" login (env credentials) is a built-in global admin with NO stored record; global
  admin sees all churches implicitly.
- Church filtering happens client-side (backend stays anonymous).
- Unprovisioned Google users (no matching active user record) are blocked at sign-in: Login.tsx
  checks `GET /users/{email}` before establishing a session and shows an "ask an administrator to
  invite you" notice instead of logging in.
- Invite UI offers all three roles to global admins (including global-admin, which hides the
  church picker and sends empty ChurchIds); church admins only see church-admin/user options
  scoped to their own churches.
- Invite status is tracked: `Status` = "invited" | "active". New users start as "invited"; after
  Google sign-in, if the record still shows "invited", the app calls `POST /users/{email}/claim`
  and the backend stamps Status="active" + `ClaimedOn` (idempotent — claiming an already-active
  user returns 200, not an error).

## Steps

### Phase A — Backend data model & storage
1. Add `User : Document` record in src/jchurchFunction/Domain/Documents.cs
   - Fields: `Email` (normalized lowercase; `Id` == `Email`), `Role` ("global-admin" |
     "church-admin" | "user"), `ChurchIds` (string[], empty for global-admin), `DisplayName`
     (nullable), `InvitedBy` (string, email or "admin"), `Status` ("invited" | "active"; default
     "invited" on create), `ClaimedOn` (DateTimeOffset?, set on claim).
   - `ChurchId` base property set to sentinel `"global"` on every User (single logical partition;
     Users live in the existing "directory" container automatically since CosmosRepository routes
     everything except Attendance there).
2. Extend src/jchurchFunction/Storage/Repositories.cs: new `IRepository<User> Users` constructor
   param/property + `For<T>()` switch case.
3. No Configuration.cs change (generic `IRepository<>` registration covers User); verify
   `SafetyTests`/document-type validation accepts the new Kind.

### Phase B — Backend service & API (depends on A)
4. New src/jchurchFunction/Services/UserService.cs following DirectoryService patterns:
   - `Save(input, etag?)`: normalize/validate email (trim, lowercase, basic format), validate role
     value, require ≥1 ChurchIds for church-admin/user and empty ChurchIds for global-admin, verify
     each referenced church exists & is active via `directory.Get<Church>(id, id)`, create → 409 on
     duplicate email and Status="invited"; replace requires exact ETag; email immutable (reject
     change); Status transitions rejected (claim-only).
   - `Claim(email)`: fetch active user, if Status=="invited" set Status="active" + ClaimedOn=now
     and Replace with ETag (retry once on 412 concurrency); return the user; 404 if missing, 409 if
     archived.
   - `Archive(email, etag)`: soft-delete (`Active=false`), matching existing archive semantics.
   - `Get` / `Search` (search text over email/display name, optional role, status, and churchId
     filters via Query model).
5. Extend Dispatch in src/jchurchFunction/Functions/ChurchApi.cs: add a `users` branch before the
   `"churches"` guard falls through (today non-"churches" roots 404 at ChurchApi.cs ~line 77).
   - `GET /api/v1/users` (search, role, status, churchId, pageSize, continuationToken)
   - `POST /api/v1/users` (create/invite) → 201 + Location + ETag
   - `GET /api/v1/users/{email}` (URL-encoded email) → login-time lookup for the app
   - `PUT /api/v1/users/{email}` (If-Match; role/ChurchIds/DisplayName only; Status not editable —
     claim is the only transition)
   - `DELETE /api/v1/users/{email}` (If-Match; archive)
   - `POST /api/v1/users/{email}/claim` — idempotent invited→active transition; stamps
     Status="active" + ClaimedOn on first claim, returns 200 with the user either way; 404 if no
     such user, 409 if archived
   - Inject `UserService` into ChurchApi constructor.
6. Manually update src/jchurchFunction/openapi.json: `/users` paths + User schema (spec is a static
   bundled file, not generated).
7. New tests/JChurch.Tests/UserServiceTests.cs (xUnit + InMemoryRepository + TestClock patterns
   from ServiceTests.cs): email normalization, role validation, church existence, global-admin
   church constraint, duplicate-email 409, etag replace, archive, search filters, claim transition
   (invited→active stamps ClaimedOn, second claim no-op/200, claim archived → 409, claim missing →
   404, PUT cannot change Status).
8. Extend tests/http-smoke.mjs with a users CRUD + claim + validation-failure pass against the
   local host.

### Phase C — Mobile role resolution & church filtering (depends on B; parallel with D prep)
9. Add `User`/`AppRole` types to src/JcChurchMobile/src/api/types.ts (mirror backend schema; keep
   vitest-importable).
10. New src/JcChurchMobile/src/auth/roles.ts (pure, vitest-importable):
    - `resolveRole(authUser, userRecord)` → `{ role, churchIds }`; provider "admin" → global-admin
      without a backend call; Google + 404 → "unprovisioned".
    - `filterChurches(churches, roleInfo)` helper for client-side filtering.
11. New `RoleProvider` (or extend AuthContext) in src/JcChurchMobile/src/providers.tsx: React Query
    fetch of `GET /users/{email}` for Google users; if the returned record has Status=="invited",
    fire `POST /users/{email}/claim` once (mutation, then invalidate the user query); expose
    `{ roleReady, role, churchIds, userStatus }` via `useRole()`.
12. Update src/JcChurchMobile/src/screens/Churches.tsx: global-admin keeps existing paginated list;
    other roles fetch via `useAll` and filter by assigned ids (church counts are small);
    unprovisioned → Notice "ask an administrator to invite you". Users (church-admin/user) with
    exactly one assigned church skip the chooser: the screen auto-selects it and routes straight to
    `/church/{id}` (ref-guarded against Strict Mode double-fire; Settings/manage view unaffected).
    Settings/manage view unchanged for global admin only.

### Phase D — Mobile user-management UI (depends on C)
13. New src/JcChurchMobile/src/screens/Users.tsx + route src/JcChurchMobile/app/users.tsx:
    - List users (global-admin: all; church-admin: client-filtered to users whose ChurchIds
      intersect theirs), each row showing email, role, churches, and a status badge (Invited in
      amber / Active; archive toggle reuses existing `includeArchived` pattern).
    - Invite/edit Sheet modal following the MemberEditor pattern in Members.tsx (React Hook Form +
      Zod; email, role Select, church multi-select via Toggle list, display name). Church choices:
      all churches for global-admin, own churches for church-admin.
    - Archive with ETag via `api.archive`.
14. Add "Users" entry on the Settings (manage) screen, visible only to global-admin/church-admin.
15. Update src/JcChurchMobile/app/_layout.tsx: add `users` route inside the authenticated guard;
    role-gate inside the screen (Stack.Protected is boolean-only) with a not-authorized Notice
    fallback.
16. Hooks in src/JcChurchMobile/src/api/hooks.ts: `useUsers` (list w/ filters), `useUser(email)`,
    save/archive mutations with React Query invalidation.

### Phase E — Tests & docs (depends on C, D)
17. Extend src/JcChurchMobile/tests/client.test.ts (import only from api/auth/domain modules —
    screens are not vitest-importable): role resolution matrix, church filtering, email
    normalization expectations.
18. Extend src/JcChurchMobile/tests/e2e/workflows.spec.ts: temp admin sees all churches + Users
    screen; invite a church admin/user (row shows Invited); simulated Google login for that email
    triggers claim (row shows Active); church-admin-scoped invite; filtered church list;
    unprovisioned Google user state (mocked session).
19. Update src/JcChurchMobile/README.md (roles, pre-provisioned invites, no-authz caveat) and root
    README if it describes access; note `.env.example` needs no change.

## Relevant files
- src/jchurchFunction/Domain/Documents.cs — add `User` record (base `Document`:
  Id/ChurchId/Kind/ETag/Active/SearchText/timestamps)
- src/jchurchFunction/Storage/Repositories.cs — add `Users` + `For<T>()` case
- src/jchurchFunction/Services/UserService.cs — new; mirror DirectoryService validation/etag
  patterns
- src/jchurchFunction/Functions/ChurchApi.cs — Dispatch routing; constructor injection;
  Result/Problem helpers reused
- src/jchurchFunction/Storage/CosmosRepository.cs — no change (non-Attendance → "directory"
  container); confirm partition key = ChurchId sentinel "global"
- src/jchurchFunction/openapi.json — manual spec update
- tests/JChurch.Tests/UserServiceTests.cs — new; follow ServiceTests.cs `Memory()` fixture pattern
- tests/http-smoke.mjs — extend
- src/JcChurchMobile/src/api/types.ts, src/api/hooks.ts, src/api/client.ts — types + hooks (client
  needs no auth-header change)
- src/JcChurchMobile/src/auth/roles.ts — new pure helpers (vitest-safe)
- src/JcChurchMobile/src/auth/AuthContext.tsx, src/providers.tsx — role provider wiring
- src/JcChurchMobile/src/screens/Churches.tsx — filtering + unprovisioned Notice
- src/JcChurchMobile/src/screens/Users.tsx + app/users.tsx — new management screen/route
- src/JcChurchMobile/app/_layout.tsx — route guard
- src/JcChurchMobile/tests/client.test.ts, tests/e2e/workflows.spec.ts — tests

## Verification
1. `dotnet build src/jchurchFunction/jchurchFunction.csproj` and
   `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj` (existing 48 + new UserService tests).
2. Local host (`func start` from src/jchurchFunction) + `node tests/http-smoke.mjs`; curl pass:
   create church-admin user → GET by email → claim → GET shows active + ClaimedOn → PUT churchIds
   with ETag → DELETE archive → confirm archived semantics; duplicate POST → 409.
3. `npm --prefix src/JcChurchMobile run typecheck` and `npm --prefix src/JcChurchMobile test`.
4. `npm --prefix src/JcChurchMobile run test:e2e` (Metro :8081 + API :7071).
5. Manual web check: login as admin → all churches + Users entry → invite church admin scoped to
   one church → simulate Google session for that email → only assigned church visible → invite form
   offers only own churches for church admin.

## Scope boundary
- No Authorization headers, JWT validation, or backend caller checks — endpoints stay
  `AuthorizationLevel.Anonymous`; role rules are enforced in the client only.
- No email sending, invite links; global-admin assignment is available in the UI only to signed-in
  global admins; no reactivation of archived users (matches existing archive semantics).
- No Microsoft/Entra wiring (remains in the deferred social-login plans).

## Further considerations
1. When backend auth lands (Entra/JWT per Plans/20260923-social-login-google-microsoft-cr1.md), map
   role claims to endpoint authorization and re-key lookups from email path param to the
   authenticated identity.
2. Sentinel partition "global" is fine at expected user counts; revisit partitioning if user volume
   grows.
3. If invite re-notification is needed later (resend timestamp/count), extend the claim design with
   an invite-audit field — no email infrastructure exists today.
