# JChurch Mobile

Expo React Native client for iOS and Android, with a browser preview for local development. Implements the [mobile plan](../../Plans/reactnative-ui-plan.md).

## Development Only

Use synthetic data only. The existing API is unauthenticated; selecting a church is not access control. Authentication, staff permissions, church-management permissions, and approved backend access remain release prerequisites. This project does not change backend deployment or network safeguards.

## Run

Use a current Node version supported by Expo SDK 57 and npm. From this folder:

```sh
npm ci
npm run web
```

Open <http://localhost:8081>. Keep the existing API running on `127.0.0.1:7071`. The Metro development proxy forwards `/api/v1/` to that loopback address, avoiding browser CORS changes. It is not included in exported builds. When 8081 is occupied, use `npm run web -- --port 8082` and adjust the Playwright base URL if running tests there.

For native development:

```sh
npm run ios
npm run android
```

iOS requires Xcode, its command-line tools, and an installed simulator. Android requires Android Studio, an emulator, and `adb`. With the localhost-only Metro server, use `adb reverse tcp:8081 tcp:8081` for an Android emulator/device that needs the Metro loopback URL. Use an Expo Go version compatible with SDK 57, or a development build with compatible native dependencies.

### API Addresses

| Target | Default API URL |
| --- | --- |
| Web preview | `/api/v1` via the local Metro proxy |
| iOS simulator | `http://127.0.0.1:7071/api/v1` |
| Android emulator | `http://10.0.2.2:7071/api/v1` |

Override the URL with `EXPO_PUBLIC_API_URL` in a local environment file or terminal environment. The example file documents its format; do not set the web preview to a cross-origin URL unless that endpoint supports browser requests. Restart Metro after changing environment values. Public Expo environment values are bundled into the client and must never contain secrets.

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