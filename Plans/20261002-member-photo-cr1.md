# Plan: Member profile photos (upload + display)

TL;DR: Add an optional photo to members. Upload from camera or photo library on the in-app member
edit screen; display avatars on the member list (directory), member detail/editor sheet, check-in
"Find members" rows, checked-in roster rows, and the scan-check-in confirmation. Photos live in a
new private `member-images` blob container proxied through Function endpoints; the `Member`
document gains a server-managed `ImageVersion` (GUID) and clients load images via
`GET .../members/{id}/image?v={imageVersion}`.

## Decisions (confirmed with user)
- Photo upload: in-app member editor only; public registration / member update web forms stay
  text-only.
- Check-in display: small circular avatar in all member rows + scan confirmation.
- Photo is optional everywhere — members without a photo keep working exactly as today:
  - `ImageVersion` nullable; existing members have it unset; no migration/backfill.
  - `Avatar` component falls back to the existing `person-outline` icon when `imageVersion` is
    absent (all surfaces).
  - `GET .../members/{id}/image` 404s when no photo; clients only build the URL when
    `imageVersion` is set (no wasted requests).
  - Member create/edit/archive flows unchanged when no photo is involved.
- Storage approach: blob container proxied through Function endpoints — NOT base64 in Cosmos (list
  payloads would balloon ~68 KB/member) and NOT SAS URLs (blobs stay private; managed identity;
  works identically against Azurite/InMemory locally).
- Upload format: base64 JSON body `{contentType, data}` (client downsizes to 512px JPEG first,
  typical 40-120 KB); server cap 1 MB decoded. Avoids multipart parsing in the isolated worker.
- `ImageVersion` is server-managed (new GUID per upload); `?v=` cache-busting makes immutable
  cache headers safe.
- Image endpoints are NOT ETag-gated (last-write-wins on the photo); the service retries the
  member Replace once on 412.
- Out of scope: public web forms, CSV import/export of photos, attendance reporting views.

## Steps

### Phase A — Backend: storage abstraction + image endpoints
1. Add `Azure.Storage.Blobs` NuGet to src/jchurchFunction/jchurchFunction.csproj.
2. New src/jchurchFunction/Storage/IMemberImageStore.cs — `Put(churchId, memberId, contentType,
   bytes)`, `Get(churchId, memberId)` → (bytes, contentType) | null, `Delete(churchId, memberId)`.
   Implementations:
   - `InMemoryMemberImageStore` (concurrent dictionary; `Storage:Provider=InMemory` local dev +
     tests)
   - `BlobMemberImageStore` (container `member-images`, blob name `{churchId}/{memberId}`,
     `DefaultAzureCredential`; blob URI from `Images:BlobServiceUri` config)
   - Wire in Configuration.AddChurchServices following the existing `Storage:Provider` switch.
3. src/jchurchFunction/Domain/Documents.cs — add `ImageVersion` (string?) to the `Member` record.
4. src/jchurchFunction/Services/DirectoryService.cs — in `Save<T>` `case Member`, carry
   `ImageVersion` over from `existing` (server-managed; `Save` rebuilds the doc from client input
   via `input with {...}`, so without this every normal member edit would drop the photo link).
5. New src/jchurchFunction/Services/MemberImageService.cs:
   - `Upload` — contentType ∈ {image/jpeg, image/png, image/webp}; base64 decode; decoded ≤ 1 MB;
     member must exist/active; `Put` blob; bump `ImageVersion = Guid.NewGuid()` via repository
     Replace with one retry on 412.
   - `GetImage` — blob bytes + contentType, or null.
   - `Delete` — remove blob, clear `ImageVersion` (same Replace+retry).
6. src/jchurchFunction/Functions/ChurchApi.cs — routes in `Dispatch`:
   - `PUT /churches/{churchId}/members/{memberId}/image` — body `{contentType, data}` → 200
     `{imageVersion}`; 400 validation_failed, 404 member, 413 too large.
   - `GET /churches/{churchId}/members/{memberId}/image` → 200 bytes + Content-Type +
     `Cache-Control: private, max-age=31536000, immutable` + ETag = imageVersion; 404 when none.
   - `DELETE /churches/{churchId}/members/{memberId}/image` → 204.
7. Scan responses — add `imageVersion` to the ScanMember projection in the scan-check-ins and
   scan-check-ins/status handlers (member already loaded via `CheckInService.ResolveScan`).
8. src/jchurchFunction/openapi.json — add `imageVersion` (nullable string, readOnly) to `Member`,
   add to `ScanMember`, document the three image paths (spec is a static bundled file).

### Phase B — Infra + local settings (parallel with A)
9. infra/main.bicep — add `member-images` container (`publicAccess: 'None'`) under the existing
   blob service. Deployment remains blocked per the existing approval gate — bicep change only.
10. src/jchurchFunction/local.settings.example.json — document `Images:BlobServiceUri` (Azurite:
    `http://127.0.0.1:10000/devstoreaccount1`). InMemory provider needs nothing.

### Phase C — Mobile: API client + Avatar component (depends on A)
11. src/JcChurchMobile: `npm run generate:api` (openapi-typescript → src/api/generated.ts);
    `Member` picks up `imageVersion` automatically.
12. src/JcChurchMobile/src/api/hooks.ts (or client.ts) — `memberImageUrl(churchId, member)` helper
    building `/api/.../members/{id}/image?v={imageVersion}`; `api.uploadMemberImage(churchId,
    memberId, {contentType, data})`; `api.deleteMemberImage(churchId, memberId)`.
13. src/JcChurchMobile/src/ui.tsx — new `Avatar` component: circular `Image`, sizes sm (~36) /
    lg (~96); fallback = `person-outline` icon in a pale circle; extend `Row` with optional
    `avatar?: ReactNode` leading slot (falls back to current `icon` rendering when absent).
14. src/JcChurchMobile/package.json — add `expo-image-picker` + `expo-image-manipulator`;
    app.json — add expo-image-picker plugin with `photosPermission` + `cameraPermission` text.

### Phase D — Mobile: MemberEditor photo section (depends on C)
15. New src/JcChurchMobile/src/MemberPhoto.tsx:
    - Current photo (Avatar lg) or placeholder; buttons: "Take photo" (native only), "Choose
      photo" (all platforms), "Remove photo" (when a photo exists).
    - Pick flow: `ImagePicker.launchCameraAsync` / `launchImageLibraryAsync` with
      `allowsEditing: true, aspect: [1,1]` → `ImageManipulator` resize 512px JPEG q0.7 → base64 →
      upload immediately (existing member) or stash in local state (new member; uploaded after
      create).
    - Remove → DELETE endpoint. Busy/error via `Notice`; invalidate member list + detail queries
      after success so `imageVersion` refreshes.
16. src/JcChurchMobile/src/screens/Members.tsx `MemberEditor` — render `<MemberPhoto>` at the top
    of the Sheet (view + edit modes; pickers disabled when view-only/archived). New-member flow:
    `save` mutation `onSuccess` uploads the stashed photo with the created member id, then
    `onSaved(false)`; photo failure → still close, notice "Member saved, but photo upload failed."
    No `domain.ts` change — photo lives in component state, not `MemberFormValues`.

### Phase E — Mobile: display surfaces (depends on C; parallel)
17. Members.tsx list rows (~line 148) — `avatar={<Avatar sm>}` (fallback keeps `person-outline`).
18. Member detail/editor Sheet header — covered by step 16 (large photo at top in view mode).
19. src/JcChurchMobile/src/screens/CheckIn.tsx "Find members" rows (~line 433) — avatar in `Row`.
20. CheckIn.tsx checked-in roster `CheckedInRow` (~line 616) — avatar (member already fetched).
21. src/JcChurchMobile/src/screens/ScanCheckIn.tsx scan result (~line 118) — restyle confirmation
    into a row with Avatar + name/status text; uses `result.member.imageVersion`.

### Phase F — Tests + verification (depends on all)
22. tests/JChurch.Tests — `MemberImageService` tests: reject bad content type, reject >1 MB,
    upload/get/delete round-trip via InMemoryMemberImageStore, ImageVersion bumped/cleared,
    member `Save` preserves ImageVersion, scan-check-in response includes `imageVersion`.
23. tests/http-smoke.mjs — PUT → GET → DELETE image round-trip against the local host.
24. Manual: `func start` + Expo — upload from camera and library, verify avatar on all five
    surfaces, web fallback (library only), remove photo, stale-cache check.

## Verification
1. `dotnet build src/jchurchFunction` (task: build functions) — compiles with new
   package/endpoints.
2. `dotnet test tests/JChurch.Tests` (task: test) — all new + existing tests pass.
3. `func start` + `node tests/http-smoke.mjs` (task: HTTP smoke test) — image round-trip passes.
4. `npm run generate:api` in src/JcChurchMobile + `npx tsc --noEmit` — types regenerated, no TS
   errors.
5. Expo run (iOS/Android): camera + library pick → photo shows in editor, directory list, member
   detail, check-in rows, scan confirmation; remove reverts to fallback icon.
6. Web run: library picker only; camera button hidden; avatars render.

## Relevant files
- src/jchurchFunction/Domain/Documents.cs — `Member` record (lines 33-61): add `ImageVersion`.
- src/jchurchFunction/Services/DirectoryService.cs — `Save<T>` Member case: preserve
  `ImageVersion` from `existing`.
- src/jchurchFunction/Functions/ChurchApi.cs — `Dispatch` routing + ScanMember projection.
- src/jchurchFunction/Configuration.cs — provider switch pattern for `IMemberImageStore`.
- src/jchurchFunction/openapi.json — Member/ScanMember schemas + image paths.
- infra/main.bicep — blob service; add `member-images` container.
- src/JcChurchMobile/src/screens/Members.tsx — list rows, `MemberDetails`, `MemberEditor`.
- src/JcChurchMobile/src/screens/CheckIn.tsx — Find members rows, `CheckedInRow`.
- src/JcChurchMobile/src/screens/ScanCheckIn.tsx — scan result Notice.
- src/JcChurchMobile/src/ui.tsx — `Row` component + new `Avatar`.
- src/JcChurchMobile/src/api/hooks.ts / client.ts — image URL helper + upload/delete methods.
- src/JcChurchMobile/app.json / package.json — picker plugin + new deps.
- tests/JChurch.Tests — MemberImageService tests; tests/http-smoke.mjs — round-trip.

## Further considerations
1. iOS HEIC handled implicitly — `expo-image-manipulator` transcodes to JPEG during resize, so the
   backend only accepts jpeg/png/webp.
2. If public forms later need photos, the anonymous endpoint needs hardening (rate limiting like
   the 120/min scan bucket, stricter size/type checks) — separate change request.
