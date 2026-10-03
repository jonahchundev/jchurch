# Plan: Google Sign-In on Login Screen (Direct Google OAuth)

## TL;DR
Add a "Continue with Google" option to the existing login screen using `expo-auth-session`
(Authorization Code + PKCE directly against Google, no Entra tenant). The temporary admin
username/password login stays as a dev fallback. Works on web + iOS + Android. Backend token
validation is explicitly deferred — the Functions API remains anonymous; this is a client-side
identity gate with a real Google identity, same enforcement posture as today's temporary login.

## User decisions
- Direct Google OAuth (not Entra External ID federation; supersedes the unimplemented
  [20260923-social-login-google-microsoft-cr1.md](20260923-social-login-google-microsoft-cr1.md)
  approach for now)
- No backend JWT validation yet — API stays anonymous
- Keep both auth methods: Google + temporary admin credentials
- Platforms: web, iOS, Android

## Steps

### Phase 1 — Google Cloud Console setup (manual, external prerequisite, no code)
1. Create a Google Cloud project + OAuth consent screen (External, app name "JChurch",
   scopes: openid, email, profile).
2. Create OAuth 2.0 client IDs:
   - **Web client** ✅ DONE (2026-10-02):
     `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=432952284943-i6q7ve5evfiekdklt2fa2supr2v4oi3j.apps.googleusercontent.com`
     (also used for Expo Go dev flow). Authorized JavaScript origins configured:
     `http://localhost:8081` and the deployed web origin
     `https://green-sea-06c08980f.3.azurestaticapps.net`. Authorized redirect URIs:
     `http://localhost:8081/redirect` (verify against `AuthSession.makeRedirectUri` web output
     in Phase 2 step 4) and the deployed origin equivalent.
   - **iOS client** — TODO: requires a bundle identifier (see Phase 2 step 3).
   - **Android client** — TODO: requires package name + debug SHA-1 signing-certificate
     fingerprint.
3. Record the three client IDs (non-secret; safe in `EXPO_PUBLIC_` env vars). Web client ID is
   now known (above); iOS/Android still pending.

### Phase 2 — Dependencies, config, app identity
*Depends on Phase 1 client IDs for final values; code can be written with placeholders.*
1. `npx expo install expo-auth-session expo-web-browser expo-secure-store` in
   src/JcChurchMobile (expo-crypto already present for PKCE).
2. Add to `.env` and `.env.example`:
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=432952284943-i6q7ve5evfiekdklt2fa2supr2v4oi3j.apps.googleusercontent.com`
     (real value in `.env`; placeholder in `.env.example`)
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` — placeholders
     until Phase 1 iOS/Android clients are created.
   All optional; Google button hidden/disabled when the platform's client ID is absent —
   fail closed like temporary-auth does.
3. Add `ios.bundleIdentifier` and `android.package` to `app.json` (currently missing; required
   for native Google client IDs). Scheme `jchurch` already exists — reuse for native redirect
   (`jchurch://redirect`).
4. Verify the actual `makeRedirectUri` web output matches the Google Cloud web client's
   authorized redirect URIs; update Google Cloud if it differs.

### Phase 3 — Auth module
*Depends on Phase 2.*
1. New `src/auth/google-auth.ts`: reads the three env client IDs; exports Google discovery
   config, scopes (`openid profile email`), `useGoogleAuthRequest()` built on
   `AuthSession.useAuthRequest` with PKCE (S256, via expo-crypto), per-platform client ID
   selection, redirect URI via `AuthSession.makeRedirectUri({ scheme: "jchurch" })`,
   `exchangeCodeAsync` for the code→token exchange, and a minimal ID-token payload decoder
   (base64url JSON; extract email/name/picture — signature verification deferred with backend
   work, documented).
2. Extend `src/auth/AuthContext.tsx` (keep existing shape, add):
   - Session model: replace single AsyncStorage marker with a stored session object
     `{ provider: "google" | "admin", user?: { email, name, picture }, tokens?: {...} }`.
     Migrate: legacy marker value still counts as an `admin` session.
   - Storage: `expo-secure-store` on native for Google tokens; AsyncStorage on web (web has no
     SecureStore — document XSS caveat, consistent with existing posture).
   - New API: `signInWithGoogle(): Promise<boolean>`, `user` (profile or null). Keep
     `login(username, password)` and `logout()`; `logout()` also clears Google tokens
     (optionally `AuthSession.revokeAsync` the access token, best-effort).
3. No changes needed to `app/_layout.tsx` — `authenticated` gate already covers both providers.

### Phase 4 — Login UI + logout
*Depends on Phase 3.*
1. Update `src/screens/Login.tsx`: "Continue with Google" Button (icon `logo-google`, busy
   state, error Notice on failure/cancel) above a divider; retitle screen "Sign in" from
   "Admin login" (also the `Stack.Screen` title in app/_layout.tsx); existing admin form
   remains below, labeled as admin/development access.
2. Update logout in `src/screens/Churches.tsx` (Settings manage screen) only if needed to show
   the signed-in Google user (email/name) — optional polish; `logout()` already wired.

### Phase 5 — Tests, docs, verification
*Depends on Phase 4.*
1. Vitest (tests/client.test.ts or new tests/google-auth.test.ts): client-ID platform
   selection, fail-closed when client ID missing, session migration from legacy marker,
   ID-token payload decoding fixture, logout clearing.
2. Playwright (tests/e2e/workflows.spec.ts): login screen renders Google button; existing
   admin-login e2e flows keep passing unchanged. Full Google OAuth cannot be automated without
   a real Google account — assert button presence/config gating only.
3. Update src/JcChurchMobile/README.md: Google setup steps, env vars, explicit warning that
   the API is still anonymous and this is UI-level identity only.
4. `npm run typecheck`, `npm test`, focused then full Playwright, `npm run export:web`
   (confirm dist/staticwebapp.config.json still present).
5. Manual: web (`npm run web`) Google sign-in → church selector → reload stays signed in →
   logout → login; native via Expo Go/dev build on iOS + Android; admin fallback still works;
   deployed SWA origin added to Google web client before shipping web.

## Relevant files
- `src/JcChurchMobile/src/auth/google-auth.ts` — new: Google OAuth config + PKCE flow
- `src/JcChurchMobile/src/auth/AuthContext.tsx` — extend: dual-provider session,
  signInWithGoogle, user profile
- `src/JcChurchMobile/src/auth/temporary-auth.ts` — reused as-is (admin fallback)
- `src/JcChurchMobile/src/screens/Login.tsx` — add Google button, retitle
- `src/JcChurchMobile/app/_layout.tsx` — retitle login screen only; guards unchanged
- `src/JcChurchMobile/src/screens/Churches.tsx` — optional: show signed-in user near logout
- `src/JcChurchMobile/app.json` — add ios.bundleIdentifier / android.package
- `src/JcChurchMobile/package.json` — expo-auth-session, expo-web-browser, expo-secure-store
- `src/JcChurchMobile/.env` / `.env.example` — Google client IDs
- `src/JcChurchMobile/tests/client.test.ts`, `tests/e2e/workflows.spec.ts` — coverage
- `src/JcChurchMobile/README.md` — docs

## Verification
1. `npx tsc --noEmit` and `npm test` (vitest) pass.
2. Focused Playwright auth specs, then full suite — admin flows unaffected.
3. `npm run export:web`; `dist/staticwebapp.config.json` remains present.
4. Manual web: fresh load → Sign in → Continue with Google → real Google account → church
   selector; reload persists; logout returns to sign-in; admin/abc123 still works.
5. Manual native (Expo Go or dev build): same flow on iOS and Android with per-platform
   client IDs.
6. `/register/**` and `/update/**` public routes remain reachable while logged out.

## Scope boundary / decisions
- No backend changes: Functions API stays anonymous; no JWT validation middleware, no
  Authorization headers. Deferred follow-up (the 2026-09-23 plan's Phase 2 can be adapted to
  validate Google-issued tokens directly instead of CIAM).
- **Implicit `id_token` flow (Option B), not Authorization Code + PKCE.** Google's Web client
  type is a confidential client: the token-exchange step requires a `client_secret`, which
  cannot be embedded in a public browser client (confirmed: `token` endpoint returns 400
  `client_secret is missing`). The app therefore requests the ID token directly
  (`response_type=id_token` + `nonce`) with no code exchange. Consequences: no access/refresh
  token, so the user re-signs-in when the ID token expires (~1 hour), and no silent refresh.
  A server-side exchange endpoint (`POST /auth/google/exchange` holding the secret as a
  Function app setting) is the future upgrade path and dovetails with the backend JWT phase.
- ID-token signature is not verified client-side (documented); the `nonce` round-trip is
  validated to prevent token-replay/substitution. Real signature verification lands with the
  backend phase.
- Google OAuth client secret is not used.
- Web token storage (AsyncStorage/localStorage) is XSS-exposed vs native SecureStore —
  acceptable under current synthetic-data posture; revisit before real-data pilot.

## Further considerations
1. Expo Go vs dev build: native Google sign-in via expo-auth-session works in Expo Go using
   the Expo auth proxy, but a dev build (`npx expo run:ios` / `run:android`) with owned
   `jchurch://redirect` scheme is more robust and required before store submission.
2. Future Microsoft login: adding it later means either a second direct-OAuth provider or
   revisiting Entra External ID federation — cheap to defer now, non-trivial migration later.
