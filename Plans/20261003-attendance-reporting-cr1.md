# Plan: Multi-Level Attendance Reporting (Event / Session / Member / Group)

## TL;DR

Add attendance reporting across 4 levels. Backend gets **one new aggregated summary endpoint** (`GET /v1/churches/{churchId}/attendance/summary?groupBy=event|occurrence|member|group|day`) using Cosmos GROUP BY pushdown (mirrored in InMemory repo), reusing the existing raw `/attendance` endpoint for rosters/history lists and the existing `occurrence-check-in-counts` endpoint where applicable. Mobile app gets a **new visible "Reports" tab** with a hub screen drilling into 4 report screens, all read-only and available to **all signed-in roles**, with **CSV + PDF export** and **lightweight hand-built react-native-svg bar visuals** (no new dependencies). Date ranges are **unbounded** on the summary endpoint; the 93-day cap on the raw endpoint is relaxed when `memberId` is present (bounded single-member history).

## Decisions (confirmed with user)

- Audience: all signed-in roles, read-only. Backend stays anonymous; no new authz (roles remain client-enforced, matching existing pattern).
- Aggregation: new backend summary endpoint (not client-side paging over raw records).
- Exports: CSV + PDF on every report screen.
- Visuals: stat cards + tables + simple SVG bars via `react-native-svg` (already installed); no chart library.
- Date range: unlimited / multi-year on summary; raw-record 93-day cap relaxed only when `memberId` is present.
- Report date ranges are **inclusive of the whole end date**: `src/reports/range.ts` converts every preset/custom choice to the API's exclusive `[from, to)` convention with `from` = start of the first local day and `to` = start of the day AFTER the last local day — so a session at any time on the end date (including later today for 30d/90d/YTD) is included.
- Group reports group over `inclusiveGroupIds` snapshot (check-in-time membership — historically accurate, matches existing group filter semantics).
- `groupBy=day` buckets by UTC date of `checkedInAt` (ISO prefix). Session-level precision comes from `groupBy=occurrence`; day is trend-only. Documented in OpenAPI.
- No new npm dependencies (`react-native-svg`, `papaparse`, `expo-print`, `expo-sharing` all installed).
- Excluded scope: absence/expected-attendance modeling, streaks/badges, scheduled/email reports, chart library, saved report presets.

## Screens

### 1. Reports Hub (new visible tab)

```
┌─────────────────────────────────────┐
│  GRACE COMMUNITY CHURCH             │  ← eyebrow (church name)
│  Reports                            │
│  ┌───────────────────────────────┐  │
│  │ 📅  By Event               ›  │  │
│  │     Totals & per-session trend│  │
│  ├───────────────────────────────┤  │
│  │ 🕐  By Session             ›  │  │
│  │     Who checked in, by group  │  │
│  ├───────────────────────────────┤  │
│  │ 👤  By Member              ›  │  │
│  │     One person's history      │  │
│  ├───────────────────────────────┤  │
│  │ 👥  By Group               ›  │  │
│  │     Coverage & per-member     │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  🏠      👥      📅      ✅      📊 │
│ Home  Members Events Check-In Reports│
└─────────────────────────────────────┘
```

### 2. By Event

```
┌─────────────────────────────────────┐
│  REPORTS                            │
│  By Event                  ↓ Export │  ← Export opens Sheet: CSV / PDF
│  ┌─────────────────────────────┐    │
│  │ Event: Sunday Service    ▼  │    │  ← Select picker (required)
│  └─────────────────────────────┘    │
│  [30 days] [90 days] [YTD] [All]    │  ← SegmentedControl presets
│  ┌────────────┐ ┌────────────┐      │
│  │    486     │ │     12     │      │  ← StatGrid cards
│  │ Check-ins  │ │  Sessions  │      │
│  ├────────────┤ ├────────────┤      │
│  │    143     │ │    40.5    │      │
│  │  Unique    │ │ Avg/session│      │
│  └────────────┘ └────────────┘      │
│  PER SESSION                        │
│  Sep 28   ████████████████  52      │  ← SvgBars (chronological)
│  Sep 21   ██████████████    47      │
│  Sep 14   ███████████████   49      │
│  SESSIONS                           │
│  ┌───────────────────────────────┐  │
│  │ Sun, Sep 28 · 9:30 AM      ›  │  │  ← tap → By Session (pre-filled)
│  │ 52 checked in                 │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 3. By Session

```
┌─────────────────────────────────────┐
│  REPORTS                            │
│  By Session                ↓ Export │
│  ┌─────────────────────────────┐    │
│  │ Event: Sunday Service    ▼  │    │  ← cascading selects
│  │ Session: Sun, Sep 28 9:30▼  │    │
│  └─────────────────────────────┘    │
│  ┌────────────┐ ┌────────────┐      │
│  │     52     │ │      3     │      │
│  │ Checked in │ │   Groups   │      │
│  └────────────┘ └────────────┘      │
│  BY GROUP                           │
│  Kids       ██████████████  28      │
│  Youth      ████████        16      │
│  Volunteers ████             8      │
│  ROSTER                        🔍   │  ← SearchBox filters roster
│  ┌───────────────────────────────┐  │
│  │ ○  Emma Wilson                │  │  ← shared AttendanceRoster,
│  │    Kids · 9:12 AM             │  │    read-only (no undo)
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 4. By Member

```
┌─────────────────────────────────────┐
│  REPORTS                            │
│  By Member                 ↓ Export │
│  ┌─────────────────────────────┐    │
│  │ 🔍 Search members...        │    │  ← SearchBox; tap result to select
│  └─────────────────────────────┘    │
│  Selected: Emma Wilson          ✕   │
│  [30 days] [90 days] [YTD] [All]    │
│  ┌────────────┐ ┌────────────┐      │
│  │     18     │ │      2     │      │
│  │ Check-ins  │ │   Events   │      │
│  ├────────────┤ ├────────────┤      │
│  │  Jun 14    │ │  Sep 28    │      │
│  │ First seen │ │ Last seen  │      │
│  └────────────┘ └────────────┘      │
│  BY EVENT                           │
│  Sunday Service ████████████  12    │
│  Kids Club      ██████         6    │
│  HISTORY                            │
│  ┌───────────────────────────────┐  │
│  │ Sunday Service                │  │
│  │ Sun, Sep 28 · 9:12 AM         │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 5. By Group

```
┌─────────────────────────────────────┐
│  REPORTS                            │
│  By Group                  ↓ Export │
│  ┌─────────────────────────────┐    │
│  │ Group: Kids              ▼  │    │
│  │ Event: All events        ▼  │    │  ← optional event narrow-down
│  └─────────────────────────────┘    │
│  Include subgroups              ○── │  ← Toggle (default on)
│  [30 days] [90 days] [YTD] [All]    │
│  ┌────────────┐ ┌────────────┐      │
│  │    204     │ │     31     │      │
│  │ Check-ins  │ │   Unique   │      │
│  ├────────────┤ ├────────────┤      │
│  │     35     │ │    89%     │      │
│  │ Group size │ │  Coverage  │      │
│  └────────────┘ └────────────┘      │
│  DAILY TREND                        │
│  Sep 28   ████████████   28         │
│  BY MEMBER                          │
│  ┌───────────────────────────────┐  │
│  │ Emma Wilson           12  ›   │  │  ← tap → By Member (pre-filled)
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Export sheet (all 4 report screens)

```
┌─────────────────────────────────────┐
│ ▔▔▔▔▔ (drag handle)                 │
│  Export report                      │
│  [  📄  Download CSV  ]             │  ← papaparse → FileSystem/Sharing
│  [  🖨  PDF / Print    ]            │  ← expo-print; web opens print
└─────────────────────────────────────┘
```

**Interaction notes:**
- Drill-down chain: Hub → By Event → tap session → By Session (pre-filled); tap member in By Group → By Member (pre-filled). Filters stay visible at top to pivot without going back.
- Presets over calendars: 30/90/YTD/All are the default; explicit from/to `DateField`s appear only under a "Custom…" preset.
- No role gate: tab visible to all signed-in roles; all screens read-only (roster drops the undo button from the Check-In version).
- Empty ranges render `QueryState` empty state.

## Phase 1 — Backend: attendance summary endpoint

Blocks Phase 2. Steps sequential.

1. **Domain/contract**: add `AttendanceSummaryRow(string Key, int CheckedInCount, int UniqueMemberCount)` near `OccurrenceCheckInCount` in `src/jchurchFunction/Storage/IRepository.cs` (~L61).
2. **Repository interface**: add `Task<IReadOnlyList<AttendanceSummaryRow>> Summarize(Query query, string groupBy, CancellationToken ct)` to the Attendance repository interface (same interface declaring `ActiveCheckInCounts`, IRepository.cs ~L69). `groupBy` ∈ `event|occurrence|member|group|day`.
3. **Cosmos impl** (`src/jchurchFunction/Storage/CosmosRepository.cs`, follow `ActiveCheckInCounts` L179-L200): SQL from `Query` filters (churchId, kind='Attendance', active=true, eventId/occurrenceId/memberId/from/to on checkedInAt; groupId via `ARRAY_CONTAINS(c.inclusiveGroupIds, @groupId)` honoring includeSubgroups semantics from Search). GROUP BY: `eventId` / `occurrenceId` / `memberId` / `SUBSTRING(c.checkedInAt, 0, 10)` (day) / `JOIN g IN c.inclusiveGroupIds ... GROUP BY g` (group). `COUNT(1)` + `COUNT(DISTINCT c.memberId)` per group. Safety cap: 10,000 returned groups.
4. **InMemory impl** (`src/jchurchFunction/Storage/InMemoryRepository.cs`, mirror of L148-L161): LINQ GroupBy over the same filter predicate so contract tests cover both repos.
5. **Query parsing** (`src/jchurchFunction/Functions/Api/QueryParsing.cs`): add `ParseSummaryQuery` — allowed keys `groupBy, eventId, occurrenceId, memberId, groupId, includeSubgroups, from, to`; reject pagination keys and search; require valid `groupBy`; **no 93-day cap**; reuse Date/Flag helpers.
6. **Relax raw-endpoint cap**: in `ParseQuery` (L50-L51), skip 93-day validation when `query.MemberId is not null`. Keep cap for all other raw queries.
7. **API function** (`src/jchurchFunction/Functions/AttendanceApi.cs`): add `AttendanceSummary` function, route `v1/churches/{churchId}/attendance/summary`, GET-only, same style as `AttendanceList` (church existence check, `ApiExecutor.Execute`, returns `{ items = [...] }`).
8. **OpenAPI**: update `src/jchurchFunction/openapi.json` — new path + `AttendanceSummaryRow` schema (template: `occurrence-check-in-counts` at L129-L131, L214).
9. **Regen mobile types**: `npm run generate:api` in `src/JcChurchMobile`.
10. **Tests** (`tests/JChurch.Tests/RepositoryContract.cs`, near L57-L91): per-dimension grouping, active-only (undone excluded), includeSubgroups on/off, groupId filter via inclusiveGroupIds, >93-day summary accepted, memberId raw query >93 days accepted, unknown groupBy → 400.

## Phase 2 — Mobile: Reports tab + 4 report screens

Depends on Phase 1 (steps 8–9 for types). 2.1–2.2 first; screens 2.3–2.6 can parallelize.

### 2.1 Navigation + hub
- Add visible tab `app/church/[churchId]/reports.tsx` ("Reports", `bar-chart-outline`) in `src/JcChurchMobile/app/church/[churchId]/_layout.tsx` (L133-L156), after Check-In.
- Add 4 hidden tab routes (`href: null`): `report-event.tsx`, `report-session.tsx`, `report-member.tsx`, `report-group.tsx`, thin re-exports of screens (pattern: `members.tsx` → `src/screens/Members.tsx`).
- Hub `src/screens/Reports.tsx`: `Page` + 4 `Row` entries with descriptions, `router.push`. No role gate.

### 2.2 Shared report components (new under `src/JcChurchMobile/src/reports/`)
- `ReportFilters.tsx`: presets (Last 30 days, Last 90 days, Year to date, All time, Custom…) + optional from/to `DateField`s; emits `{from?, to?}`.
- `SvgBars.tsx`: horizontal bar list on `react-native-svg`: label, proportional bar, value label.
- `StatGrid.tsx`: 2-column stat cards (value + label) with existing `colors`/`styles`.
- `exportReport.ts`: `exportCsv(filename, rows)` via papaparse + expo-file-system/expo-sharing (pattern from `MembersImportExport.tsx` L28-L51 incl. web Blob branch); `exportPdf(title, headers, rows)` via expo-print HTML table (pattern from `src/ScanCode.tsx` L141).
- Hooks: `useQuery`/`api.get` for summary (single-shot `{items}`), `useAll<Attendance>` for rosters/history (pattern: `CheckIn.tsx` L293). Reference data (events/occurrences/members/groups) via existing `useAll` for pickers + id→label joins.

### 2.3 By Event — `src/screens/EventReport.tsx`
- Filters: event `Select` (required) + `ReportFilters`.
- Data: `occurrence-check-in-counts` (existing) + occurrences (existing) + `attendance/summary?groupBy=member&eventId=…` (unique-attendee total).
- Display: `StatGrid` (total, sessions with check-ins, unique attendees, avg/session), `SvgBars` per session (chronological), session `Row` table → tap deep-links to Session report with eventId+occurrenceId params.
- Export: CSV/PDF of session table.

### 2.4 By Session — `src/screens/SessionReport.tsx`
- Filters: event `Select` → occurrence `Select` (required; pre-filled when deep-linked).
- Data: `attendance/summary?groupBy=group&occurrenceId=…` + `useAll<Attendance>(…, {occurrenceId})` roster (partition-cheap).
- Display: `StatGrid` (checked-in, groups represented, first/last check-in), `SvgBars` per group, read-only roster. **Refactor**: extract roster UI from `AttendanceList` (`CheckIn.tsx` L527-L620) into shared `AttendanceRoster` with `readOnly` prop (hides undo); CheckIn switches to shared component (no visual regression).
- Export: CSV/PDF roster (name, groups, check-in time).

### 2.5 By Member — `src/screens/MemberReport.tsx`
- Filters: member picker (`SearchBox` + filtered list, select-on-tap) + `ReportFilters`.
- Data: `attendance/summary?groupBy=event&memberId=…` + `useAll<Attendance>(…, {memberId, from, to})` history (Phase-1 cap relaxation).
- Display: `StatGrid` (total, distinct events, first/last attended), `SvgBars` per event, chronological history (event name + session date + time; labels joined from events/occurrences).
- Export: CSV/PDF of history.

### 2.6 By Group — `src/screens/GroupReport.tsx`
- Filters: group `Select` (required), include-subgroups `Toggle` (default on), optional event `Select`, `ReportFilters`.
- Data: `attendance/summary?groupBy=member&groupId=…&includeSubgroups=…`, `groupBy=day` (trend), current group size via members endpoint count (existing `groupId` filter).
- Display: `StatGrid` (total, unique attendees, group size, coverage %), `SvgBars` daily trend (windowed top-N), per-member table sorted desc → tap deep-links to Member report.
- Export: CSV/PDF of per-member table.

## Phase 3 — Contextual deep links (optional polish; after 2.3–2.6)

1. Events `SessionList` rows (`Events.tsx` L568-L590): trailing action → Session report for that occurrence.
2. `MemberDetails` (`Members.tsx` L284-L298): "Attendance" action → Member report. Do NOT add an inline query inside the editor sheet (known gotcha: invalidating the member-detail query unmounts MemberEditor).
3. (Optional) `Groups.tsx` rows → Group report.

## Relevant files

**Backend**
- `src/jchurchFunction/Functions/AttendanceApi.cs` — add `AttendanceSummary`
- `src/jchurchFunction/Functions/Api/QueryParsing.cs` — `ParseSummaryQuery`; relax 93-day cap for memberId (L50-L51)
- `src/jchurchFunction/Storage/IRepository.cs` — `AttendanceSummaryRow` + `Summarize` (near L61-L69)
- `src/jchurchFunction/Storage/CosmosRepository.cs` — GROUP BY pushdown (template: `ActiveCheckInCounts` L179-L200)
- `src/jchurchFunction/Storage/InMemoryRepository.cs` — LINQ mirror (L148-L161)
- `src/jchurchFunction/Functions/EventOccurrencesApi.cs` L24-L31 — reference for counts endpoint shape (`{ items }`)
- `src/jchurchFunction/openapi.json` — new path/schema (template L129-L131, L214)
- `tests/JChurch.Tests/RepositoryContract.cs` L57-L91 — summary contract tests

**Mobile**
- `src/JcChurchMobile/app/church/[churchId]/_layout.tsx` L133-L156 — tabs
- New: `app/church/[churchId]/{reports,report-event,report-session,report-member,report-group}.tsx`
- New: `src/screens/{Reports,EventReport,SessionReport,MemberReport,GroupReport}.tsx`
- New: `src/reports/{ReportFilters,SvgBars,StatGrid,exportReport}.ts(x)`
- `src/JcChurchMobile/src/screens/CheckIn.tsx` L527-L620 — extract `AttendanceRoster` (readOnly prop)
- `src/JcChurchMobile/src/screens/MembersImportExport.tsx` L28-L51 — CSV pattern; `src/JcChurchMobile/src/ScanCode.tsx` L141 — PDF pattern
- `src/JcChurchMobile/src/api/hooks.ts` / `client.ts` — reuse; `src/api/generated.ts` regenerated
- Phase 3: `src/screens/Events.tsx` L568-L590, `src/screens/Members.tsx` L284-L298

## Verification

1. `dotnet build src/jchurchFunction` + `dotnet test tests/JChurch.Tests` — new contract tests green, no regressions.
2. Local `func start` + curl: each `groupBy` dimension with/without filters; >93-day summary succeeds; memberId raw query >93 days succeeds; unknown groupBy → 400; undone check-in excluded.
3. Extend `tests/http-smoke.mjs` with one summary call per dimension; run "HTTP smoke test" task.
4. Mobile: `npm run typecheck`, `npm run test` (vitest), `npm run generate:api` diff sanity.
5. Manual UX pass (web + one native): hub → each report → presets → drill-downs → CSV + PDF export both platforms; all roles see tab; empty states.
6. Playwright e2e: add one happy-path Reports flow (`npm run test:e2e`).

## Further considerations

1. Coverage % uses current group size (historical roster snapshots don't exist) — acceptable approximation; revisit if users need true rate-over-time.
2. Multi-year `groupBy=day` can return ~3650 rows — fine for table/PDF; UI windows the bar chart (e.g., last 60 buckets).
3. Cross-partition RU cost for unbounded church-wide summaries grows with data; if cost issues appear, add an optional max-range guard or per-event requirement later without breaking the API shape.
