# Plan: Social Login (Google + Microsoft) via Microsoft Entra External ID

## Approach
Use Microsoft Entra External ID (CIAM) as the single OIDC identity provider — matches the
"proposed provider" already named in Plans/church-management-api-plan.md. Google and Microsoft
sign-in are configured as federated identity providers *inside* the CIAM tenant, so the app only
ever talks to one OIDC endpoint (CIAM authorize/token/jwks) and users pick Google or Microsoft on
the CIAM-hosted sign-in page. Backend (isolated Azure Functions) validates the resulting JWT via
custom worker middleware (no ASP.NET Core pipeline available). Mobile/web (Expo) performs
Authorization Code + PKCE via `expo-auth-session`. Authorization/roles (User<->Member linking) is
explicitly OUT of scope per user decision — this plan only proves "who is this caller" via a
verified JWT and exposes claims; endpoints remain functionally open to any authenticated user
until a follow-up authorization plan is written. The current hard production-blocking safety gate
in Configuration.cs stays in place by default and is only relaxed by an explicit, reviewed
Auth:Enabled flag path (Phase 4) — not automatically.

## Phase 1 — Entra External ID tenant setup (manual, external prerequisite)
1. Create/obtain a Microsoft Entra External ID (CIAM) tenant (Azure portal action, not Bicep —
   directory-level resource). *No code changes.*
2. Register two app registrations in the CIAM tenant:
   - **API app registration** ("jchurch-api") — exposes a scope (e.g. `access_as_user`); note its
     Application (client) ID → becomes `Auth:Audience`. Note tenant's OIDC well-known config URL
     (issuer/authority) → becomes `Auth:Authority`.
   - **Client app registration** ("jchurch-mobile") — public client (mobile/web), configure
     redirect URIs for Expo (`jcchurchmobile://redirect` for native, the web dev/prod origin +
     `/redirect` for web via `expo-auth-session`'s `makeRedirectUri`). Grant it delegated
     permission to the API app's `access_as_user` scope.
3. In the CIAM tenant's user flow / sign-in experience, add **Google** and **Microsoft** as
   external identity providers (Google requires a Google Cloud OAuth client ID/secret; Microsoft
   personal/work accounts are natively supported). Enable both on the sign-up/sign-in user flow.
4. Record 4 values needed by later phases: Authority URL, API audience (client ID or App ID URI),
   mobile client ID, redirect URI scheme. Store non-secret values in repo config/docs; treat any
   client secret (only needed if a confidential client is ever added) as a deployment secret, not
   committed.

## Phase 2 — Backend: JWT validation middleware (Functions isolated worker)
*Depends on Phase 1 values.*
1. Add NuGet packages to [jchurchFunction.csproj](../src/jchurchFunction/jchurchFunction.csproj):
   `Microsoft.IdentityModel.Protocols.OpenIdConnect` and `System.IdentityModel.Tokens.Jwt` (or
   `Microsoft.Identity.Web` if it supports isolated-worker middleware cleanly — verify current
   package version compatibility with .NET 10 isolated worker before choosing).
2. Add new `Auth:Authority` and `Auth:Audience` config keys, read in
   [Configuration.cs](../src/jchurchFunction/Configuration.cs). Add a new `Auth:Enabled` boolean
   (default `false`) gating whether validation middleware is active — keeps local dev unauthenticated
   by default (matches `InMemory` synthetic-data dev flow) while allowing it to be turned on
   per-environment.
3. Create `Auth/JwtValidationMiddleware.cs` (new file under `src/jchurchFunction/`) implementing
   `IFunctionsWorkerMiddleware`: when `Auth:Enabled` is true, extract `Authorization: Bearer <token>`
   from the HTTP request, validate signature via CIAM's JWKS (via
   `ConfigurationManager<OpenIdConnectConfiguration>` caching the discovery doc), validate
   `iss`/`aud`/`exp`, and on success attach a `ClaimsPrincipal` to `FunctionContext.Items` for
   handlers to read (e.g. `oid`, `email`, `name` claims) — but do NOT enforce role/church
   authorization yet (explicitly deferred). On failure return 401 short-circuit.
4. Register the middleware in [Program.cs](../src/jchurchFunction/Program.cs) via
   `builder.UseMiddleware<JwtValidationMiddleware>()`, conditional on `Auth:Enabled`.
5. Leave `AuthorizationLevel.Anonymous` on the `[HttpTrigger]` attributes in
   [ChurchApi.cs](../src/jchurchFunction/Functions/ChurchApi.cs) — the custom middleware is the real
   guard, function-key auth is orthogonal and unnecessary.
6. Add a lightweight `GET /me` diagnostic endpoint returning the validated caller's claims (oid,
   email, name) — useful for manual/mobile verification without needing the full authorization
   model.

## Phase 3 — Mobile app: login UI + token handling
*Can start in parallel with Phase 2 once Phase 1 values exist; final wiring depends on Phase 2's `/me` endpoint for verification.*
1. Add dependencies to [package.json](../src/JcChurchMobile/package.json): `expo-auth-session`,
   `expo-web-browser`, `expo-secure-store` (secure token storage on native; web falls back to
   `localStorage`/`sessionStorage` with a documented XSS-exposure caveat — call this out, do not
   silently treat it as equally secure).
2. Create `src/auth/authConfig.ts` — CIAM authority/discovery URL, mobile client ID, scopes
   (`openid profile offline_access <api-scope>`), redirect URI via
   `AuthSession.makeRedirectUri()`.
3. Create `src/auth/AuthContext.tsx` (new provider, mounted in
   [providers.tsx](../src/JcChurchMobile/src/providers.tsx) alongside existing
   `QueryClientProvider`/`SafeAreaProvider`): wraps `expo-auth-session`'s
   `useAuthRequest`/`exchangeCodeAsync` for Authorization Code + PKCE, stores
   access/refresh/id tokens via `expo-secure-store` (native) with an abstraction for web, exposes
   `{ user, accessToken, signIn(), signOut(), isLoading }`.
4. Add a login gate: new `app/login.tsx` screen; update
   [_layout.tsx](../src/JcChurchMobile/app/_layout.tsx) to redirect unauthenticated users to
   `/login` before reaching `/church/[churchId]/**` routes (Expo Router redirect pattern, similar
   to existing Stack setup).
5. Update [client.ts](../src/JcChurchMobile/src/api/client.ts) to attach
   `Authorization: Bearer <accessToken>` to every request (read from `AuthContext`), and handle
   `401` by attempting a silent token refresh once via the stored refresh token, then signing the
   user out if that also fails.
6. Add a "Sign out" action to [settings.tsx](../src/JcChurchMobile/app/settings.tsx) calling
   `signOut()` (clear stored tokens, revoke session).
7. Update `generate:api`/OpenAPI-derived types if the new `/me` endpoint should be reflected in
   [generated.ts](../src/JcChurchMobile/src/api/generated.ts) (regenerate via existing
   `npm run generate:api` script).

## Phase 4 — Relax the production safety gate (explicit, reviewed step)
*Depends on Phases 1–3 being verified end-to-end in a dev/test environment first.*
1. Modify `Configuration.ValidateSafety` in
   [Configuration.cs](../src/jchurchFunction/Configuration.cs#L15-L17): replace the unconditional
   `environment is not ("Development" or "Test")` throw with a check that also allows a
   non-dev environment **only when** `Auth:Enabled == true` and `Auth:Authority`/`Auth:Audience`
   are both set to valid HTTPS/non-empty values. Keep throwing otherwise. This is the single
   "relaxation" point in the codebase — do not add other bypasses.
2. Add a code comment referencing this plan/decision so future readers know this was a deliberate,
   reviewed change, not an oversight.
3. This phase should be its own PR/commit, reviewed separately from Phases 1–3, and only merged
   after manual verification (Phase 5) passes against a real (non-InMemory) environment with
   `Auth:Enabled=true`.

## Phase 5 — Infra (Bicep) + verification
1. Update [infra/main.bicep](../infra/main.bicep) Function App `appSettings` (around line 137) to
   include `Auth__Enabled`, `Auth__Authority`, `Auth__Audience` as new params (non-secret; no
   client secret is needed for the public-client/PKCE flow chosen here).
2. Update [infra/dev.bicepparam](../infra/dev.bicepparam) with placeholder/dev values.
3. Manual verification steps:
   - Run `func start` locally with `Auth:Enabled=false` (default) — confirm existing anonymous
     flows still work unchanged (regression check).
   - Run `func start` locally with `Auth:Enabled=true` and real Phase 1 values — call `/me`
     without a token (expect 401), then with a valid CIAM-issued token obtained via the mobile
     app's dev build or a manual OAuth code exchange (expect 200 with claims).
   - From the Expo web app (`npm run web`), sign in via Google, then via Microsoft, confirm both
     land on an authenticated screen and `/me` returns matching claims.
   - Confirm sign-out clears tokens and returns the user to `/login`.
   - Run `dotnet test tests/JChurch.Tests/JChurch.Tests.csproj` — add new tests for
     `JwtValidationMiddleware` (valid token, expired token, wrong audience, wrong issuer, missing
     header) using a self-signed test JWKS/token, following the existing test patterns in
     [ServiceTests.cs](../tests/JChurch.Tests/ServiceTests.cs)/[SafetyTests.cs](../tests/JChurch.Tests/SafetyTests.cs).
   - Run `node tests/http-smoke.mjs` against a running host to confirm unauthenticated smoke
     tests still pass when `Auth:Enabled=false`.

## Relevant files
- `src/jchurchFunction/Configuration.cs` — safety gate (Phase 4), new Auth config keys (Phase 2)
- `src/jchurchFunction/Program.cs` — register JWT middleware (Phase 2)
- `src/jchurchFunction/Functions/ChurchApi.cs` — add `/me` endpoint (Phase 2)
- `src/jchurchFunction/Auth/JwtValidationMiddleware.cs` — new file (Phase 2)
- `src/jchurchFunction/jchurchFunction.csproj` — new NuGet packages (Phase 2)
- `src/JcChurchMobile/package.json` — new auth deps (Phase 3)
- `src/JcChurchMobile/src/auth/authConfig.ts`, `AuthContext.tsx` — new files (Phase 3)
- `src/JcChurchMobile/src/providers.tsx` — mount AuthContext (Phase 3)
- `src/JcChurchMobile/app/_layout.tsx`, `app/login.tsx` — login gate (Phase 3)
- `src/JcChurchMobile/app/settings.tsx` — sign-out action (Phase 3)
- `src/JcChurchMobile/src/api/client.ts` — Authorization header + 401 refresh (Phase 3)
- `infra/main.bicep`, `infra/dev.bicepparam` — new app settings (Phase 5)
- `tests/JChurch.Tests/*` — new middleware tests (Phase 5)

## Decisions
- Identity provider: Microsoft Entra External ID (CIAM), federating Google + Microsoft — chosen
  over raw custom OAuth or SWA EasyAuth per user selection.
- Scope: full stack (backend + mobile) — no web-only/backend-only split.
- Authorization model (User<->Member linking, church roles/permissions) is explicitly deferred to
  a future plan; this plan only delivers verified authentication (valid JWT → claims), not
  access control. Endpoints stay functionally open to any authenticated caller for now.
- Production/non-dev safety gate relaxation is a distinct, reviewed Phase 4 step gated on
  `Auth:Enabled` + valid authority/audience — never an automatic side effect of adding auth code.
- No client secret is stored/needed since the mobile/web client uses public-client PKCE flow.

## Further Considerations
1. Web token storage on `localStorage` is XSS-exposed compared to native `SecureStore` — acceptable
   for this dev-phase app per existing "synthetic data only" posture, but should be revisited
   before any real-data pilot (tie-in to the existing Plans/church-management-api-plan.md gates).
2. Google as a federated IdP inside CIAM requires a separate Google Cloud Console OAuth client
   (client ID/secret) — this is an external, one-time manual setup step in Phase 1, not a code
   change; flag it early since it needs a Google account with billing/consent-screen setup.
