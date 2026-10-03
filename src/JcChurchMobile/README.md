# JChurch Mobile

Expo React Native client for iOS and Android, with a browser preview for local development. Implements the [mobile plan](../../Plans/reactnative-ui-plan.md).

## Development Only

Use synthetic data only. The existing API is unauthenticated; selecting a church is not access control. Authentication, staff permissions, church-management permissions, and approved backend access remain release prerequisites. This project does not change backend deployment or network safeguards.

The staff UI has two sign-in options, both client-side only:

1. **Google sign-in** — "Continue with Google" uses `expo-auth-session` (Authorization Code +
   PKCE) directly against Google. Configure `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and optionally
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` for native). The
   button is hidden when the platform's client ID is not set. Signed-in Google profile (name /
   email) is shown in Settings. See `Plans/20261002-google-login-cr1.md` for Google Cloud
   Console setup steps.
2. **Temporary admin login** — fallback credentials via `EXPO_PUBLIC_ADMIN_USERNAME` and
   `EXPO_PUBLIC_ADMIN_PASSWORD` (the checked-in development example uses `admin` / `abc123`).

Either method persists locally until Logout is selected in Settings. Public registration and
update pages remain accessible without signing in.

### Roles and user management

The app has three roles, resolved client-side from the signed-in identity:

- **Global admin** — the temporary `admin` login is a built-in global admin with no stored
  record; it sees all churches and can invite anyone. Global admins are not created via the UI.
- **Church admin** — sees only their assigned churches; can invite users and church admins, but
  only associate them with churches the church admin belongs to.
- **User** — sees only their assigned churches; no management UI.

Admins pre-provision accounts on the Settings → Manage users screen by entering an email, role,
and church assignments. No email is sent. When that person later signs in with Google (matching
email), the app calls `POST /users/{email}/claim` to flip their record from **Invited** to
**Active** (shown as a badge in the user list). A Google sign-in whose email has no matching active
user record is refused at the sign-in screen with an "ask an administrator to invite you" notice —
uninvited users cannot log in.

The backend `/api/v1/users` endpoints remain anonymous: they validate structure (role values,
church existence, email format) but not the caller. Role rules are enforced in the client only
until backend authorization lands.

This is **not security**: Expo public environment values are embedded in the client bundle, the
anonymous API remains directly callable without the app, and Google ID-token signatures are not
verified client-side. Do not use this gate with real member data or represent it as production
authentication — backend token validation is a deferred follow-up.

## Run

Use a current Node version supported by Expo SDK 57 and npm. From this folder:

```sh
npm ci
npm run web
```

Open <http://localhost:8081>. Keep the existing API running on `127.0.0.1:7071`. The Metro development proxy forwards `/api/v1/` to the base configured by `EXPO_PUBLIC_API_URL_WEB`, avoiding browser CORS changes. It is not included in exported builds. Exported web builds call `EXPO_PUBLIC_API_URL_WEB` directly and require the Function App to allow the Static Web App origin through CORS. When 8081 is occupied, use `npm run web -- --port 8082` and adjust the Playwright base URL if running tests there.

For native development:

```sh
npm run ios
npm run android
```

iOS requires Xcode, its command-line tools, and an installed simulator. Android requires Android Studio, an emulator, and `adb`. With the localhost-only Metro server, use `adb reverse tcp:8081 tcp:8081` for an Android emulator/device that needs the Metro loopback URL. Use an Expo Go version compatible with SDK 57, or a development build with compatible native dependencies.

### API Addresses

| Target | Environment variable | Default API URL |
| --- | --- |
| Web preview | `EXPO_PUBLIC_API_URL_WEB` | `http://127.0.0.1:7071/api/v1` via the local Metro proxy |
| iOS simulator | `EXPO_PUBLIC_API_URL_IOS` | `http://127.0.0.1:7071/api/v1` |
| Android emulator | `EXPO_PUBLIC_API_URL_ANDROID` | `http://10.0.2.2:7071/api/v1` |

Set each value to a complete HTTP(S) API base, with or without a path prefix. `/api/v1`, `/api/v2`, and custom paths are all valid; the local Functions defaults use `/api/v1`. Local web development keeps browser requests at `/api/v1` and Metro proxies the remaining resource path to `EXPO_PUBLIC_API_URL_WEB`. Exported web builds call `EXPO_PUBLIC_API_URL_WEB` directly, so set it before `npm run export:web` and configure the Function App CORS origin. iOS and Android call their selected URL directly. Restart Metro after changing environment values. Public Expo environment values are bundled into the client and must never contain secrets.

`EXPO_PUBLIC_REGISTRATION_BASE_URL` is the base origin used to build public registration links and QR codes (see Public Registration below). Defaults to `http://localhost:8081` for local web development; set it to the deployed Static Web App hostname (or a custom domain) before `npm run export:web`.

Physical phones cannot use the computer's localhost address. Testing on physical phones requires an explicitly approved, network-restricted development endpoint and connectivity arrangement. Do not expose the anonymous API publicly or relax its guards to make a phone connection work. Release builds require an approved HTTPS API.

## Workflows

- Church picker first, with Settings available even for an empty directory.
- Settings: create, rename, or delete/archive a church. Archival requires confirmation and retains history.
- Home: member management, focused member search, events, and check-in.
- Members: paginated name search, direct group/subgroup filter, profile editing, optional personal details, group assignments, typed custom fields, and archival.
- Events: create one-time or recurring definitions, rename/archive, explicitly generate sessions, reschedule/cancel future sessions, and open check-in for a chosen session.
- Check-in: select event and session, confirm, find members, receive persisted receipts, retry uncertain submissions with the same IDs, and view paginated attendance.
- Member scan cards: type, scan, or generate one code in member editing; choose QR or Code 128 and save. Replacing a saved code requires confirmation. Reopen the member to print the confirmed card or share a PDF on native devices. Drafts cannot be exported; temporary PDFs are deleted after sharing returns.
- Scan check-in: select a session, Begin Check-In, then choose Scan. Enter a complete code with Enter or activate the native camera. Recognized codes submit automatically with no per-member tap. Unknown codes do not create attendance. Uncertain results pause scanning and use read-only status recovery, never automatic repeat writes.

Native camera support uses `expo-camera` and requires a compatible development build/Expo Go runtime and camera permission. Rebuild development binaries after changing native plugins. The web preview supports typing and keyboard-wedge scanners, not browser camera capture. Check permission denial, background/resume, print/share, and QR/Code 128 readability on real devices before a pilot. Long barcodes can be dense on small displays; prefer QR or a tested printed card. Codes are copyable identifiers, not authentication. Reissue deletes the previous lookup without retaining history; intentionally reusing a retired value can make an old card valid again.

### Public Registration

The "New registration" icon on the Members screen and the Check-in screen (once a session is
selected) opens a QR code and link for self-service registration, at:

- `{EXPO_PUBLIC_REGISTRATION_BASE_URL}/register/{churchId}` — general registration; saves a
  new member (child or adult) only.
- `{EXPO_PUBLIC_REGISTRATION_BASE_URL}/register/{churchId}/{eventId}/{occurrenceId}` — session
  registration; saves the member and immediately checks them in for that occurrence.

Examples, using the local dev default (`EXPO_PUBLIC_REGISTRATION_BASE_URL=http://localhost:8081`):

```text
http://localhost:8081/register/church_a1b2c3
http://localhost:8081/register/church_a1b2c3/event_sunday/occ_9f2a1c
```

And against a deployed Static Web App (or custom domain) base URL:

```text
https://swa-jchurch-prod-qzapi27pwztpy.azurestaticapps.net/register/church_a1b2c3
https://swa-jchurch-prod-qzapi27pwztpy.azurestaticapps.net/register/church_a1b2c3/event_sunday/occ_9f2a1c
```

Both pages are public and unauthenticated (same as the rest of this anonymous API) and support a
Child/Adult toggle. Choosing Child requires guardian1 name, phone, and email; choosing Adult hides
guardian/school fields entirely. There is no pending/approval step — registrations are saved as
active members immediately, and there is no rate limiting on these endpoints, consistent with the
project's current development-only safety posture (see Development Only above).

Event schedules are immutable. Recurrence generation uses the backend's seven-days-back/90-days-ahead window. DST gaps and ambiguous initial times are rejected. Existing custom recurrence rules are preserved when renaming events.

Attendance is filtered by **check-in timestamp**, not occurrence timestamp. The Checked in tab defaults to today's UTC date and allows a different date. A person checked in today for an old or future session appears under today's check-in date.

The app stores only the last selected church ID on-device. Member data and receipts remain in memory. There is no offline write queue, automatic retry of resource creation, undo check-in, or restore archived resource action. Group and custom-field definitions are consumed from the API; their administration is not part of this mobile release.

## Structure

- `app/`: Expo Router entry screens and church-scoped bottom tabs.
- `src/screens/`: church, member, event/session, and check-in workflows.
- `src/ui.tsx`: accessible native controls, forms, dialogs, and design tokens.
- `src/api/`: generated OpenAPI types, document adapters, HTTP client, and query hooks.
- `src/domain.ts`: form schemas, custom-field conversion, and timezone utilities.
- `tests/`: API/domain tests and browser workflow tests.

The OpenAPI responses expose generic documents, so resource-specific response types combine generated input schemas with document metadata; occurrence and attendance response fields are explicitly modeled. Regenerate types when the API contract changes.

## Verification

```sh
npm run generate:api
npm run typecheck
npm test
npm run export:web
npm run export:native
npx expo install --check
npx playwright install chromium
npm run test:e2e
```

Browser tests require the Expo preview at `localhost:8081`. The live workflow additionally requires the existing API host at port 7071. It creates uniquely named `Mobile QA` synthetic churches and archives those churches afterward; related synthetic history is retained by the API. Other browser tests intercept requests with synthetic fixtures to exercise failure states without touching the backend.

Verified during implementation: 14 API/domain tests; 12 desktop and phone-sized browser cases for church/member/event management, check-in, stale edits, draft retention, pagination, church switching, cancellation, scan-code reissue, automatic scans, throttled uncertain recovery, and independent rendered QR/barcode decoding; TypeScript; and web/iOS/Android bundle export. Browser screenshots use synthetic fixtures under ignored `test-results/`. Browser mobile emulation is not native-device verification.

### Remaining Gates

- Native iOS/Android interaction tests, physical-device networking, Dynamic Type, VoiceOver/TalkBack, keyboard/back behavior, and signed builds remain unverified. The local machine's `simctl` was unavailable.
- The local API was restarted with approval for scan endpoints. In-memory restarts lose all member assignments and attendance; durable storage and restart tests are required before issuing real cards.
- `npm audit` currently reports 16 moderate advisories through dependencies. Review upstream compatible fixes before release; do not run a forced SDK downgrade. No high/critical advisories were reported in this audit.
- TypeScript is pinned to 5.9 for the OpenAPI generator's declared peer compatibility and excluded from Expo's TypeScript-version recommendation. Strict compilation and all three bundle targets pass with this configuration.
- Authentication, authorization, secure token storage, privacy review, and release approval remain pending. No resources were deployed and no production readiness is claimed.

### Deployment to Azure Static Website

The web build copies the repository-level `user-guide/` folder into the static
site and renders it at `/user-guide`. Markdown remains the guide's source
format; the app fetches and renders it at runtime.

```sh
npm install
npm run export:web
```

npx @azure/static-web-apps-cli deploy .\dist --deployment-token {deploymentToken} --env production

`public/staticwebapp.config.json` (copied verbatim into `dist/` by the Expo web export) sets a
`navigationFallback` so deep links to client-side routes — e.g. `/register/{churchId}` — serve
`index.html` instead of a 404. This is required because `swa deploy` on a pre-built `dist` folder
skips Azure's automatic SPA framework detection, which only runs during a Static Web Apps-managed
build. Without it, any URL that isn't a literal file in `dist/` returns "File not found".