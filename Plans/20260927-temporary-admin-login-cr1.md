# Plan: Temporary admin login gate

## Goal
Add a development-only client-side login page using exact, case-sensitive credentials supplied
through Expo public environment variables:

```dotenv
EXPO_PUBLIC_ADMIN_USERNAME=admin
EXPO_PUBLIC_ADMIN_PASSWORD=abc123
```

Persist only an authenticated marker in AsyncStorage until explicit logout. Protect staff routes
(`/`, `/settings`, `/church/**`) while keeping public registration routes (`/register/**`) open.
This is a UI gate only: the password is compiled into the client bundle and the anonymous API
remains directly callable.

## Steps

### Phase A — Temporary authentication state
1. Add the two variables to `src/JcChurchMobile/.env` and `.env.example`.
2. Add `src/JcChurchMobile/src/auth/temporary-auth.ts`:
   - Export an AsyncStorage session key.
   - Read `EXPO_PUBLIC_ADMIN_USERNAME` / `EXPO_PUBLIC_ADMIN_PASSWORD`.
   - Fail closed when either is missing or blank.
   - Validate credentials exactly and case-sensitively.
3. Add `src/JcChurchMobile/src/auth/AuthContext.tsx`:
   - Hydrate the session marker from AsyncStorage.
   - Expose `{ ready, authenticated, login, logout }` via `useAuth()`.
   - Store only the authenticated marker, never the password.
4. Wrap app content with `AuthProvider` in `src/providers.tsx`.

### Phase B — Login and protected routing
5. Add `src/screens/Login.tsx` and `app/login.tsx`:
   - Username and secure password fields using existing UI controls.
   - Generic invalid-credentials error.
   - Successful login opens the root church selector.
6. Update `app/_layout.tsx`:
   - Wait for both font and auth hydration.
   - Protect `index`, `settings`, and `church/[churchId]` with `Stack.Protected`.
   - Make `login` available only while logged out.
   - Leave all `register/**` routes outside the guards.

### Phase C — Logout
7. Update `src/screens/Churches.tsx`:
   - Add a Logout icon next to Create church only on the Settings (`manage`) screen.
   - Cancel and clear React Query, then remove the persisted session via `logout()`.

### Phase D — Tests and docs
8. Update `tests/client.test.ts` for exact credentials, wrong values/case, and missing config.
9. Update `tests/e2e/workflows.spec.ts`:
   - Establish an authenticated marker for existing staff workflows.
   - Cover login failure/success, persistence, protected-route redirects, logout, and public
     registration access while logged out.
10. Update `src/JcChurchMobile/README.md` with temporary credentials, persistence behavior, and
    an explicit warning that this does not secure the API or real data.

## Verification
1. `npx tsc --noEmit` and `npm test`.
2. Focused Playwright auth tests, then the full Playwright suite.
3. `npm run export:web`; confirm `dist/staticwebapp.config.json` remains present.
4. Manual web check: fresh load → Login; `admin` / `abc123` → church selector; reload remains
   logged in; Settings Logout → Login; registration URLs remain public.

## Scope boundary
No Authorization headers, JWTs, backend login endpoint, password hashing, roles, or API middleware
are added. The Expo public password is discoverable and must not be represented as production
security.
