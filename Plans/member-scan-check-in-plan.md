# Plan: Member QR And Barcode Check-In

## Implementation Status

The user approved implementation. Phases 1-5 are implemented for synthetic local development; Phase 6 remains a release gate. Detailed acceptance checkboxes below are conservative: hardware, permissions, distributed consistency, and pilot acceptance are not established by local tests.

- Implemented: atomic assignment/replacement, legacy-field preservation, detail-only code exposure, church-scoped scan/check-in and read-only status endpoints, member draft scanning/generation, confirmed card print/share, and automatic scan mode with uncertainty recovery.
- Selected contract: QR and Code 128 encode the same 8-64 ASCII-character value. Generated values contain 130 random bits (`JC` plus 26 Crockford Base32 characters). No retired-code history is stored.
- Cosmos resolution explicitly requests Strong reads and fails closed when the account cannot support them. A Strong-consistency account and successful cross-instance contract/failure tests are prerequisites; no account settings were changed. A scan resolved before reissue may finish afterward.
- The local limiter allows 120 scan/status requests per minute per process, not per authenticated staff member. Production requires an authorized, distributed limiting policy.
- Uncertain scan writes receive one automatic status lookup, then explicit status-only recovery honoring `Retry-After`. The client never automatically repeats the write or resolves a pending operation against another member. Camera activation is explicit; typed/keyboard-wedge input is available on web.
- Verified: 48 backend tests passed, 1 opt-in Cosmos test skipped; 14 client tests; 12 desktop/mobile-browser cases; live HTTP scan lifecycle smoke; TypeScript; web/iOS/Android exports. ZXing independently decodes rendered QR and Code 128 images, including a 64-character barcode at 3x density. Synthetic screenshots were inspected; they are not real member cards.
- Still unverified: native camera/permission/background behavior, physical scanners, print/share delivery and PDF cleanup on devices, paper/screen readability across devices (especially long barcodes), real Cosmos consistency/concurrency, the two-second performance target, and production security. Browser tests do not establish these gates.
- The local API was restarted with user approval to activate the endpoints; its previous in-memory data was cleared. Do not issue real cards against this ephemeral store.

## 1. Goal And Scope

Extend the [mobile app plan](reactnative-ui-plan.md) with issued member scan codes and automatic check-in. Keep the existing member-search/manual check-in workflow available.

- [ ] Support camera scanning of QR codes and Code 128 barcodes on iOS and Android.
- [ ] Give each issued member exactly one current scan-code value, independent of their permanent member ID. Existing/unissued members may have no code and continue using manual check-in.
- [ ] Let authorized staff type, scan, or generate a code from the member update screen.
- [ ] Reissue by replacing the current value. Remove the old lookup; do not archive old codes or keep a code-history collection.
- [ ] Automatically submit check-in on an exact valid match, with no per-member selection, confirmation, or Check In button press.
- [ ] Keep explicit church, event, session selection and Begin Check-In before enabling automatic scanning.
- [ ] Allow check-in before and after the session's scheduled time. Cancelled sessions reject new check-ins; existing active-resource and church-isolation safeguards remain.

Implementation was separately approved; deployment, public API exposure, and removal of existing security gates were not. Initial development uses synthetic data. Authenticated staff and server-enforced church permissions are required before real-data use. Member self-service apps, offline check-in, batch card printing, and unattended public kiosks are outside this phase.

## 2. Code Identity And Issuance

### Proposed Format

- Store one nullable `scanCode` string and a presentation choice, `scanCodeFormat: "qr" | "code128"`, on the member. Neither is the member's `id`.
- QR and barcode are representations of the same identifier, not separate credentials. Changing presentation does not issue a second identifier. Lookup uses the decoded value, not the scanner-reported symbology.
- Generate codes using a cryptographically secure random generator with at least 128 bits of entropy. A proposed interoperable form is `JC` followed by 26 uppercase Crockford Base32 characters; validate encoding length and entropy during implementation.
- Proposed typed/imported-code contract: 8-64 ASCII letters, digits, or hyphens; trim surrounding whitespace and scanner terminators, normalize ASCII letters to uppercase, and preserve leading zeroes. Reject embedded whitespace, control characters, URLs, oversized input, and unsupported characters. Never parse a code as a number.
- Apply the same canonicalization on the server for every write and scan request. Do not use fuzzy matching, substring search, names, phone numbers, or member IDs as fallback identifiers.
- Enforce canonical-value uniqueness within the selected church, including codes assigned to archived members. Separate churches may use the same value; scans never search across churches.
- Generated values must differ from the member ID and current code. Saving the unchanged current value is a no-op, not reissuance.

The typed-code format and initial barcode symbology are proposed defaults to confirm before implementation. Code 128 supports the same alphanumeric payload as QR; EAN/UPC support should not be assumed.

### Replacement Semantics

- Save the new value and replace its lookup atomically. The old code remains valid until the save commits; after commit, new resolutions using the old value fail.
- If validation, uniqueness, ETag checks, or persistence fail, keep the existing code and lookup unchanged.
- Never create a second member or change the member ID when reissuing. Attendance remains linked to the original member ID.
- Do not retain an old-code field, archived code document, or raw previous code in application logs. Code-change audit events may record actor, member ID, timestamp, and operation outcome without old/new raw values.
- Issue fresh cards and remove/destroy replaced cards. Because old codes are not retained, the server cannot permanently detect reuse of every previously issued value. Deliberately assigning a retired value to another member would make that old physical card valid again. Prefer generated values; permanent never-reuse enforcement would require a separately approved retained fingerprint registry and is outside this no-history design.

## 3. Backend And Storage Design

Relevant existing code: [member documents](../src/jchurchFunction/Domain/Documents.cs), [directory service](../src/jchurchFunction/Services/DirectoryService.cs), [check-in service](../src/jchurchFunction/Services/CheckInService.cs), and [repositories](../src/jchurchFunction/Storage/Repositories.cs).

- [ ] Extend member validation and writable inputs with the nullable code and format. Existing documents deserialize without a code; there is no automatic code backfill or card issuance.
- [ ] Preserve the existing code when an older client omits scan fields on a profile update. Distinguish omitted fields from explicit values before deserializing into a replacement member document, so old clients cannot silently erase assignments.
- [ ] Route every code-changing member write through a dedicated repository operation that updates the member and lookup together. The existing single-document repository methods cannot guarantee uniqueness across concurrent assignments.
- [ ] In the existing Cosmos `directory` container, keep lookup documents in the same `/churchId` partition as their member. Use a reserved ID prefix plus a SHA-256 digest of the canonical code for deterministic point lookup, with a distinct document kind and member ID reference.
- [ ] Use a same-partition transactional batch to create the new lookup, replace the member with its exact ETag, and physically delete the old lookup. Creation with an initial code must also be atomic. Do not upsert a lookup owned by a different member.
- [ ] Treat lookup-create collisions as conflicts, not as the existing repository's generic duplicate-create success. Return `409 scan_code_in_use`; stale member edits return `412`, and missing `If-Match` returns `428`.
- [ ] Implement equivalent atomicity in the in-memory repository using shared church-scoped synchronization for all code-changing writes. An unlocked query-before-save uniqueness check is insufficient.
- [ ] Resolve by church partition and deterministic lookup ID, then load the referenced member and verify that its current canonical code still matches and that it is active. Missing, inconsistent, or ambiguous ownership must fail closed; never choose the first match.
- [ ] Keep codes out of general name search text, list responses where not needed, attendance documents, analytics, and persistent client caches. Authorized member detail responses may contain the current code for card rendering and editing.

### Proposed API Contract

Routes are relative to `/api/v1`; update the [OpenAPI contract](../src/jchurchFunction/openapi.json) and regenerate mobile API types.

| Operation | Contract |
| --- | --- |
| Issue at member creation | Extend `POST /churches/{churchId}/members` with optional `scanCode` and `scanCodeFormat`. |
| Assign/reissue in member edit | Extend `PUT /churches/{churchId}/members/{memberId}` with these fields and exact `If-Match`; save profile and code changes in one atomic operation. |
| Scan and check in | Add `POST /churches/{churchId}/occurrences/{occurrenceId}/scan-check-ins` with `{ "scanCode": "..." }`. Server resolves the member and performs check-in; the client does not download a directory to match locally. |
| Confirm uncertain scan result | Add read-only `POST /churches/{churchId}/occurrences/{occurrenceId}/scan-check-ins/status` with the code in its body, returning `checkedIn` and the receipt when present. Use POST to avoid raw codes in URLs and access logs. |
| Existing manual operations | Preserve the current member-ID check-in and status routes unchanged. |

- [ ] Return `201` for a new attendance receipt and `200` for an existing receipt, with minimal member display information and the receipt. Unknown or no-longer-current codes return a generic `404 scan_code_not_found`; malformed input returns `400`.
- [ ] Reuse `CheckInService.CheckIn` after server resolution, preserving deterministic occurrence/member receipt IDs, group snapshots, duplicate safety, and time-independent eligibility.
- [ ] Preserve existing duplicate semantics: an already-recorded attendance may be returned after cancellation; this must not create new attendance. New check-ins to cancelled or archived resources remain blocked.
- [ ] Define the resolution boundary: a scan accepted immediately before a concurrent reissue may finish for the member it resolved. Scans resolved after replacement commit must reject the old code. Directory replacement and attendance writes are in separate containers and must not be described as one Cosmos transaction.
- [ ] Ensure cross-instance reads meet this post-reissue rule; explicitly validate the configured consistency model. If it cannot guarantee the required freshness, choose a supported consistency/serialization design before release rather than relying on an app-local cache or lock.
- [ ] Add rate limits, standard Problem responses, cancellation tokens, request correlation IDs, and `Retry-After` handling. Never log request bodies containing codes.

## 4. Member Update And Card Workflow

Extend the existing [Members screen](../src/JcChurchMobile/src/screens/Members.tsx), form schema, API types, and writable-payload helper.

- [ ] Add a Scan Code section with current assignment state, an editable text field, QR/Barcode presentation control, and icon actions for Scan and Generate/Reissue.
- [ ] Typing and camera scanning update the same draft field. Scanning here only edits the member draft; it must never trigger attendance.
- [ ] Before replacing an issued code, show a confirmation explaining that the old card stops working after Save Member. Cancel leaves the persisted assignment untouched.
- [ ] Keep code changes in the existing form's dirty-state, unsaved-change warning, validation, busy state, and stale-edit recovery. Save once for both profile and code; do not partially save one and report the whole form successful.
- [ ] On duplicate-code conflict, retain the draft and let staff enter or generate another value. Do not silently move a code from another member.
- [ ] On uncertain save outcome, reload the member and reconcile its current code/ETag before generating a replacement or issuing a card. Do not automatically generate a different value on retry.
- [ ] Render the persisted current code as QR or Code 128 with its human-readable text and member/church name. Offer single-card print/share/export using maintained encoding libraries; never hand-draw or fake barcodes.
- [ ] Do not issue/export a draft code before server confirmation. Test contrast, quiet zones, sizing, and scanning from both paper and phone displays, including the longest permitted barcode value.
- [ ] Keep save notices transient, following the current Members focus-reset behavior.

## 5. Automatic Scan Check-In

Extend the existing [Check-In screen](../src/JcChurchMobile/src/screens/CheckIn.tsx) with a Scan mode alongside Find Members and Checked In. Preserve the pinned church/event/session context.

1. Staff select church, event, and dated session, then Begin Check-In and choose Scan mode.
2. Camera decodes an allowed symbol, or a connected keyboard-wedge scanner completes input with Enter.
3. Validate and canonicalize the full value, synchronously acquire a single-request latch, and snapshot church/session/generation before the first asynchronous operation.
4. Submit the code to the server scan-check-in endpoint automatically. A successful exact match requires no member click.
5. On confirmed persistence, show the member's name, Checked In or Already Checked In, and timestamp. Use distinguishable visual feedback with optional sound/haptics.
6. Automatically resume capture for the next member. Keep manual search available for unreadable or unissued cards.

### Scanner And Request Lifecycle

- [ ] Use an Expo-SDK-compatible maintained camera scanner, initially `expo-camera`, enabling only QR and Code 128. Request camera permission when Scan is opened; provide denied/permanently-denied recovery and manual fallback.
- [ ] Support camera switch and torch where available. Stop capture on backgrounding, tab blur, session/church change, navigation away, or member-edit scanning.
- [ ] Support hardware keyboard-wedge scanners through a dedicated focused input and Enter terminator. Do not submit partial keystrokes or steal focus from ordinary form fields. Typed fallback can use Enter; camera decoding does not require any click.
- [ ] Process one request at a time, with no unbounded scan queue. Pause capture or visibly signal Busy while processing so another member is not silently dropped or misattributed.
- [ ] Suppress repeated camera callbacks for the same visible code; use a short configurable per-code cooldown and require a new detection cycle where supported. Different codes should be accepted immediately when ready. Server idempotency remains authoritative across devices and retries.
- [ ] On unknown code, show No matching member and return to capture after brief feedback. Do not show unrelated candidates or automatically assign an unknown code.
- [ ] On timeout or connection loss, show Confirmation pending, pause new submissions, and query scan status. Retry only the same pending code/session; honor `429 Retry-After`, bound automatic attempts, and offer explicit recovery if still uncertain.
- [ ] If a code is reissued while confirmation is pending, an old-code status lookup may no longer resolve. Do not infer that attendance failed; use the existing authorized attendance view/manual member status recovery before attempting another check-in. Never reassign a pending retry to a different member using cached data.
- [ ] Invalidate callbacks and discard late UI responses when church/session changes. Abort transport where possible, but do not claim this cancels a server write already accepted. Do not move an unresolved operation silently to the new session.
- [ ] Stop scanning when the server reports a cancelled or inactive session. Do not enforce a time-window restriction in the client.
- [ ] Clear transient feedback, decoded values, and scanner locks when leaving the flow. Keep raw codes out of local storage, screenshots used as artifacts, and telemetry.

Web preview should support typed/hardware input. Browser camera support is an optional capability gated by library/browser compatibility, permissions, and a secure context; do not claim native support from browser tests alone.

## 6. Security And Operational Boundaries

- [ ] Treat a scan code as a copyable member identifier, not proof of identity or a login token. A photographed card can be replayed; attendance deduplication prevents duplicate records, not impersonation.
- [ ] Require authenticated church-scoped check-in permission for scan endpoints and separate member-management permission for issuance/reissue before real-data use. Hide controls for usability, but enforce permissions on the server.
- [ ] Do not accept a scan payload's church, session, URL, or member ID as navigation or authorization input. Only the explicitly selected staff context determines the target session.
- [ ] Minimize displayed member information on shared screens. Restrict card export/sharing to authorized staff and use approved delivery channels.
- [ ] Existing in-memory mode loses assignments on API restart. Durable approved storage and restart verification are prerequisites for a real card issuance pilot; do not issue real cards against ephemeral test storage.
- [ ] Preserve current localhost/network and deployment restrictions. Physical-device camera tests require approved development connectivity and synthetic data.

## 7. Delivery Checklist

- [x] Phase 1: confirm code alphabet/length, church-scoped uniqueness, Code 128 choice, no-history reuse limitation, and concurrent scan/reissue semantics.
- [x] Phase 2: implement member fields, atomic assignment/replacement, exact resolution, legacy-client preservation, and in-memory/Cosmos repository contracts.
- [x] Phase 3: implement scan check-in/status endpoints, OpenAPI updates, generated types, and regression coverage for existing manual check-in.
- [x] Phase 4: add member typing/scanning/generation, ETag conflict handling, persisted card rendering, and single-card output.
- [x] Phase 5: add Check-In Scan mode, automatic submission, duplicate suppression, scanner lifecycle, and uncertain-outcome recovery.
- [ ] Phase 6: verify native cameras and hardware scanners, concurrency and consistency, security gates, card readability, and pilot readiness.

## 8. Acceptance And Verification

- [ ] Existing members without codes still support manual search/check-in; older profile updates preserve an assigned code.
- [ ] A member has only one current code after initial assignment and every reissue, whether entered by typing, scanning, or generation.
- [ ] A QR card and a Code 128 card each decode to the expected exact payload; leading zeroes and canonicalization survive typing, rendering, and scanning.
- [ ] After a committed reissue, the new code resolves to the same member and the old code does not resolve; no archived old-code document remains. Existing attendance is unchanged.
- [ ] Concurrent staff assigning one code to different members produce exactly one winner; stale reissues leave the original member and lookup consistent, with no orphan lookup after rollback.
- [ ] Archived members cannot receive new scan attendance, and their assigned code cannot be silently transferred to another member.
- [ ] A recognized scan creates attendance without a per-member tap after the session is armed. Unknown, malformed, wrong-church, and inconsistent lookup cases create none.
- [ ] Repeated camera callbacks, simultaneous devices, and manual-plus-scan check-in create exactly one receipt per member/session.
- [ ] Past and future non-cancelled sessions accept scans; cancelled sessions reject new attendance. Returning an existing receipt does not bypass this rule for new members.
- [ ] Timeouts before and after persistence, reissue during recovery, cancellation during scanning, `429`, offline mode, and session switching never show unconfirmed success or submit to the wrong session.
- [ ] Automated backend tests cover atomic replacement, uniqueness, conflicts, exact lookup, permissions, and existing manual behavior; run applicable contracts against both storage implementations.
- [ ] Frontend tests cover scan-to-auto-submit, member-form scanning without attendance, duplicate callbacks, lifecycle cleanup, notices, permission errors, and draft preservation. Browser tests use synthetic scanner events plus real HTTP tests where appropriate.
- [ ] Physical iOS/Android tests cover QR and Code 128 on paper/screens, low light, camera rotation, denied permission, background/resume, accessibility, and hardware-scanner terminators/focus. Bundle compilation alone is not acceptance.
- [ ] Proposed performance target: at least 95% of valid scans show a confirmed receipt within two seconds after decode on the agreed test network. Record end-to-end latency and errors without raw codes or personal information; agree realistic throughput before pilot.

Primary journey: edit member -> issue and save a scan code -> render card -> choose church/event/session -> Begin Check-In -> scan card -> automatic confirmed attendance -> reissue on member update -> old card rejected -> new card resolves to the same member without duplicate attendance.