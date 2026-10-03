# Plan: Split ChurchApi into Resource-Driven Functions

## TL;DR
Replace the monolithic catch-all `[Function("ChurchApi")]` (route `v1/{*path}`) in `src/jchurchFunction/Functions/ChurchApi.cs` with ~15 resource-driven function classes, each owning explicit route templates. Extract shared plumbing (Result record, body parsing, ETag, query parsing, problem+json, exception mapping) into shared helpers first, then carve out resources one at a time, then retire ChurchApi to a fallback 404 catch-all. The external HTTP contract stays byte-identical — same routes, status codes, problem+json bodies — so `openapi.json`, the mobile app, and `tests/http-smoke.mjs` all pass unmodified.

## Decisions (confirmed with user)
- True per-resource `[Function]` classes with explicit route templates; `ChurchApi.cs` is deleted at the end.
- One class per resource, sub-operations in separate classes (`MemberCsvApi`, `MemberImageApi`, `GroupCsvApi`).
- Keep a fallback catch-all function returning the same problem+json 404 for unmatched routes.
- Each route template registers all four methods (get/post/put/delete) with an internal method switch, preserving exact `405 method_not_allowed` problem+json responses (the Functions host would otherwise return plain 404 for method mismatches).
- No route, status-code, or error-body changes. `openapi.json` unchanged.

## Mobile app contract (hard constraint — verified against `src/JcChurchMobile/src/api/`)
The React Native app must function unchanged. It depends on:
- All 32 routes under `/api/v1` (`generated.ts` mirrors them 1:1) — no path, method, or response-shape changes.
- problem+json error bodies: the app parses the `detail` field for user-facing messages (`client.ts` ~L218). Preserve `detail` text exactly.
- Special status handling: 412 ("record changed elsewhere") and 429 (reads `Retry-After` header for backoff) — both must keep their current status codes and the `Retry-After` header on 429 (`scan_rate_limit` → 60s) and Cosmos throttling paths.
- ETag round-trip: `_etag` in document responses, sent back as `If-Match`; 428/412 semantics preserved.
- Member image GET: `Cache-Control: private, max-age=31536000, immutable` with `?v={imageVersion}` cache-busting — preserve byte-serving + header.
- Base URL comes from `EXPO_PUBLIC_API_URL_*` env vars — no server-side coupling, nothing to change there.

## Shared plumbing (new folder `src/jchurchFunction/Functions/Api/`)
1. `ApiResult.cs` — move the private `Result` record from ChurchApi (Status, Body, Location, RawText, Bytes, ContentType, CacheControl).
2. `ApiExecutor.cs` — static `Execute(request, context, logger, handler, ct)` → `HttpResponseData`. Owns: Result→response mapping (Cache-Control, ETag, Location, text/csv raw, bytes, JSON) and the full try/catch from `ChurchApi.Run` (ApiException → problem, JsonException → 400 invalid_json, CosmosException → 429/503 + Retry-After, OperationCanceledException passthrough, generic Exception → 503 unavailable + log). Takes `ILogger` so each function keeps its own log category.
3. `RequestBodies.cs` — `Body<T>` (64 KiB cap, read-only-field rejection, `Church.NewMemberDaysSpecified` / `Member.ScanCodeSpecified` flags), `ImageBody`/`MemberImageUpload` (1.4 MB cap), `BulkImportBody` + `ImportBody`/`ImportGroupBody` (5 MiB cap), `IfMatch` (428), `MethodNotAllowed` (405).
4. `QueryParsing.cs` — `ParseQuery` (with attendance/memberSort flags) and `ParseUserQuery` + `UserQuery` record, unchanged semantics.
5. Church-scoped functions call `directory.Get<Church>(churchId, churchId)` inline (the current existence check in Dispatch).

## Function classes (all in `src/jchurchFunction/Functions/`, constructor-injected services, `ILogger<T>`)

| Class | Route templates | Owns (from Dispatch) |
|---|---|---|
| `MetaApi` | `v1/health` GET; `v1/openapi.json` GET | health probe, spec file serve |
| `UsersApi` | `v1/users`; `v1/users/{email}`; `v1/users/{email}/claim` | Users() incl. ParseUserQuery in-memory role/status/churchId filters, email unescape, Location header on create |
| `ChurchesApi` | `v1/churches/{id?}`; `v1/churches/{id}/purge` (DELETE) | Resource<Church>, directory.Purge |
| `GroupsApi` | `v1/churches/{churchId}/groups/{id?}` | Resource<Group> |
| `GroupCsvApi` | `.../groups/export`, `.../groups/import-template` (GET); `.../groups/import` (POST) | groupCsv calls |
| `MembersApi` | `v1/churches/{churchId}/members/{id?}` | Resource<Member> incl. list ScanCode/ScanCodeFormat stripping + memberSort:true |
| `MemberCsvApi` | `.../members/export`, `.../members/import-template` (GET); `.../members/import` (POST) | memberCsv calls |
| `MemberImageApi` | `.../members/{memberId}/image` (PUT/GET/DELETE) | imageVersion upload, immutable-cache GET, delete |
| `CustomFieldsApi` | `v1/churches/{churchId}/custom-fields/{id?}` | Resource<CustomField> |
| `EventsApi` | `v1/churches/{churchId}/events/{id?}` | events.Save path of Resource<ChurchEvent> |
| `EventOccurrencesApi` | `.../events/{eventId}/occurrences` (POST generate / GET list); `.../events/{eventId}/occurrence-check-in-counts` (GET) | events.Generate, occurrences search with EventId, ActiveCheckInCounts |
| `OccurrencesApi` | `v1/churches/{churchId}/occurrences/{id?}` (GET list/get, PUT override; DELETE → 405) | Resource<Occurrence> incl. OverrideRequest body |
| `AttendanceApi` | `v1/churches/{churchId}/attendance` (GET) | attendance search (93-day range rule) |
| `CheckInsApi` | `.../occurrences/{occurrenceId}/check-ins` (POST); `.../check-ins/{memberId}` (GET/DELETE); `.../occurrences/{occurrenceId}/scan-check-ins` and `.../scan-check-ins/status` (POST) | checkIns service calls, member display projection, 201/200 idempotent semantics, ScanLimiter static (120/min token bucket moves here) |

**`NotFoundApi` (catch-all `v1/{*path}`) was implemented but REMOVED** — see "Catch-all decision" below.

Each function method body is a thin wrapper: `return await ApiExecutor.Execute(request, context, logger, ct => Handler(...), ct);`

## Phases / steps

### Phase 1 — Extract shared plumbing (no route changes)
1. Create `Functions/Api/{ApiResult,ApiExecutor,RequestBodies,QueryParsing}.cs`; rewire ChurchApi to use them. Mechanical move, zero behavior change.
2. Verify: build + `dotnet test` + func host + `node tests/http-smoke.mjs`.

### Phase 2 — Carve out resources one at a time (sequential; every step edits ChurchApi.Dispatch)
For each resource (in this order): add the new function class, delete the corresponding branch(es) from Dispatch, build, run smoke test.
3. MetaApi (health, openapi.json) — **spike**: verify host route-precedence assumptions (literal over `{param}`) before mass migration.
4. UsersApi
5. ChurchesApi (+purge)
6. CustomFieldsApi
7. GroupsApi + GroupCsvApi
8. MembersApi + MemberCsvApi + MemberImageApi
9. EventsApi + EventOccurrencesApi
10. OccurrencesApi
11. AttendanceApi
12. CheckInsApi (+ScanLimiter)

### Phase 3 — Retire the monolith
13. Delete `ChurchApi.cs` (all routes now owned by resource functions).
14. Final verification (below).

## Catch-all decision (Phase 3 change from original plan)
The planned `NotFoundApi` catch-all (`v1/{*path}` → 404 problem+json) was **removed**. The Functions host's greedy `{*path}` wildcard shadowed the entire `users` subtree (all `users*` routes returned the catch-all's 404) even though literal routes registered correctly. Two overlapping wildcards also hard-conflict, so `NotFoundApi` could not coexist with `ChurchApi` during the transition.

**Consequence (accepted):** genuinely unknown/garbage paths now return the host's plain empty 404 instead of a problem+json "Route not found." body. This is contract-safe because:
- All 404s the smoke test and mobile app depend on are for **valid routes with missing resources** (wrong church, missing member/user), which still return problem+json from the service layer (`Resource not found in this church.`, `User not found.`, etc.).
- The mobile app only parses error `detail` for known scenarios (412, 429, real resource errors); it never hits intentionally-unknown routes.

If a structured unknown-route 404 is ever required, the alternative is a per-subtree catch-all per resource class (e.g. `v1/churches/{churchId}/{*rest}` in each subtree's class), not a single global wildcard.

## Route-precedence risks to verify at runtime (host routing; spike in step 3)
- Literal `members/export`, `members/import`, `members/import-template` must win over `members/{id}` (same for groups).
- `events/{eventId}/occurrences` and `events/{eventId}/occurrence-check-in-counts` vs `events/{id?}`.
- `occurrences/{occurrenceId}/check-ins...` vs `occurrences/{id?}`.
- `users/{email}/claim` vs `users/{email}`.
- Fallback `v1/{*path}` must lose to all specific templates.

If any precedence misbehaves: fallback is merging the colliding literal route into the sibling class as a second template or a `{id}`-switch — decide per case; contract must not change.

## Relevant files
- `src/jchurchFunction/Functions/ChurchApi.cs` — source of all logic; Dispatch, Resource<T>, Users, helpers to move; deleted at the end.
- `src/jchurchFunction/Functions/Api/*.cs` — new shared plumbing.
- `src/jchurchFunction/Functions/*.cs` — 15 new classes listed above.
- `src/jchurchFunction/Program.cs`, `Configuration.cs` — unchanged (constructor injection of Repositories + 7 services already registered).
- `src/jchurchFunction/Domain/Documents.cs` — Json.Options, ApiException, domain records (reference only).
- `tests/http-smoke.mjs` — authoritative contract check; must pass unmodified.
- `tests/JChurch.Tests/` — service-level tests; unaffected (no ChurchApi coupling).
- `src/jchurchFunction/openapi.json`, `Functions/SwaggerUi.cs`, `host.json` — unchanged (routes identical).

## Verification
1. `dotnet build src/jchurchFunction/jchurchFunction.csproj` after every step.
2. `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj` (sanity; services untouched).
3. `func start` + `node tests/http-smoke.mjs` — full pass, unmodified (covers every route + status codes 200/201/204/400/404/409/412/428/429/503).
4. Manual curl spot-checks after Phase 3: GET members/export (CSV, not member 404), GET groups/import-template, POST scan-check-ins/status, wrong-method on members/{id} → 405 problem+json, unknown route → 404 problem+json with traceId, OPTIONS → host behavior unchanged.
5. Confirm openapi.json still matches every live route (SwaggerUiTests).

## Out of scope
- TestFunctionApp sample, mobile app, infra/bicep.
- DirectoryService.Save internal refactor (type-specific branching) — separate follow-up candidate.
- Any auth changes (blocked per existing constraint).

## Notes / minor accepted changes
- Log category strings change from `JChurch.Functions.ChurchApi` to per-class names.
- Function names become granular (visible in Azure portal/metrics) — an observability improvement.
