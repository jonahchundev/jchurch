# JChurch Development API

C#/.NET 10 isolated Azure Functions for church directories, recurring events, check-in, and historical attendance. HTTP APIs are **anonymous and for synthetic data only**. Explicit church/member IDs do not authenticate anyone or authorize access.

## Run Locally

Prerequisites: .NET 10 SDK and Azure Functions Core Tools v4. Node 20+ is needed only for the HTTP smoke test. The default HTTP-only in-memory profile needs no Azure account, identity provider, Cosmos connectivity, Azurite, or function keys.

```sh
dotnet test tests/JChurch.Tests/JChurch.Tests.csproj
cd src/jchurchFunction
func start --address 127.0.0.1 --port 7071
```

The initial workspace includes local settings. After a fresh clone, copy `src/jchurchFunction/local.settings.example.json` to `src/jchurchFunction/local.settings.json` before starting. The latter is ignored by Git and excluded from publish output.

Base URL: `http://localhost:7071/api/v1`. Health: `/health`. OpenAPI: `/openapi.json`. Use F5 to attach the C# debugger; install the recommended Functions and C# extensions first. VS Code builds, debug tasks, and publish paths all target `src/jchurchFunction`.

Swagger UI: **http://localhost:7071/api/swagger** (also `/api/swagger/index.html`). Browse, filter, and execute API operations with "Try it out". CSS and JavaScript are served locally from the pinned Swagger UI package; no CDN is required. Requests use the current host and port. The UI is anonymous and subject to the same synthetic-data-only development safeguards as the API.

Run the end-to-end synthetic-data flow from another terminal at the repository root:

```sh
node tests/http-smoke.mjs
```

It covers church/group/member/custom-field CRUD, validation, ETags, cross-church rejection, occurrence generation, 100 concurrent duplicate check-ins, scan-code assignment/replacement and receipt recovery, reporting, and archival. It only accepts a localhost URL. Set `JCHURCH_URL` if using a different local port. Fixture records are archived on success and disappear on host restart with in-memory storage.

Core Tools 4.14 may emit a host-storage health warning when `AzureWebJobsStorage` is absent even though HTTP functions work. `/health` is a process health endpoint, not a Cosmos or host-storage readiness probe. `func start --no-build` from the source directory can fail extension discovery; use the normal command above.

## Storage Profiles

`Storage__Provider=InMemory` registers singleton, thread-safe repositories. Data is scoped by church but lives only in the current worker process. Restarting clears everything. Multiple workers, machines, or deployments do not share it. This mode emulates the repository contract, not Cosmos throughput, consistency, or scaling.

For a local Cosmos-backed host, change the ignored local settings values:

```json
{
  "Storage__Provider": "CosmosDb",
  "Cosmos__Endpoint": "https://YOUR-ACCOUNT.documents.azure.com:443/",
  "Cosmos__Database": "jchurch"
}
```

Use `DefaultAzureCredential` with a developer identity having Cosmos **data-plane** access to the synthetic-data database. The application uses no database keys. Containers must already exist: `directory` with `/churchId`, and `attendance` with hierarchical keys `/churchId`, `/occurrenceId` (MultiHash v2). The infrastructure template defines indexes. No container or account is created at application startup. Cosmos failures never switch the app to in-memory storage.

Shared provider contract tests are opt-in for Cosmos. They require a pre-provisioned synthetic-data database with both containers, network connectivity, and a developer identity with data-plane access. Tests use unique church partitions and delete only their fixture documents, never the database. Do not enable them against a real-data account. In-memory results do not establish Cosmos correctness under throttling, consistency changes, failover, or distributed load.

```sh
JCHURCH_RUN_COSMOS_TESTS=true \
JCHURCH_COSMOS_ENDPOINT=https://YOUR-TEST-ACCOUNT.documents.azure.com:443/ \
JCHURCH_COSMOS_DATABASE=jchurch-contracts \
dotnet test tests/JChurch.Tests/JChurch.Tests.csproj --filter Category=CosmosIntegration
```

## API Examples

Create a church, then use the returned `id` as `churchId`:

```sh
curl -sS http://localhost:7071/api/v1/churches \
  -H 'Content-Type: application/json' \
  -d '{"name":"Synthetic Community Church"}'
```

```http
POST /api/v1/churches/{churchId}/members
Content-Type: application/json

{"firstName":"Synthetic","lastName":"Member","groupIds":[]}

POST /api/v1/churches/{churchId}/events
Content-Type: application/json

{"name":"Sunday Service","localStart":"2026-09-20T09:00:00","timeZone":"America/New_York","durationMinutes":90,"recurrenceRule":"FREQ=WEEKLY;BYDAY=SU"}

POST /api/v1/churches/{churchId}/events/{eventId}/occurrences

POST /api/v1/churches/{churchId}/occurrences/{occurrenceId}/check-ins
Content-Type: application/json

{"memberId":"member_..."}

GET /api/v1/churches/{churchId}/occurrences/{occurrenceId}/check-ins/{memberId}
GET /api/v1/churches/{churchId}/attendance?eventId={eventId}&groupId={groupId}&includeSubgroups=true
```

Collections: `churches`, and church-scoped `groups`, `members`, `custom-fields`, `events`, `occurrences`, `attendance`. Directory collections support POST/GET and item GET/PUT/DELETE. A subgroup is a group with `parentGroupId`; only one level is allowed. Members may belong to multiple groups. Custom-field types are `text`, `number`, `boolean`, and `date`; member custom-field dictionary keys are definition IDs. The OpenAPI file documents every route and request shape.

## Behavior And Limits

- Members may have one current `scanCode` and `scanCodeFormat` (`qr` or `code128`). Codes are church-unique, 8-64 ASCII letters/digits/hyphens, trimmed and uppercased with leading zeroes retained. Member IDs are not scan codes. Legacy updates omitting scan fields preserve them; explicit null removes an assignment. Reissue atomically replaces the lookup without keeping old-code history. Archived members retain their reservation. Member lists redact codes; member details contain the current value.
- `POST /churches/{churchId}/occurrences/{occurrenceId}/scan-check-ins` accepts `{ "scanCode": "..." }` and returns a minimal member, receipt, and `already` flag (201 new, 200 duplicate). The `/status` suffix is a read-only POST for uncertain outcomes. Unknown/currently inactive assignments return 404. Codes stay in request bodies, not URLs. A local process-wide limiter allows 120 scan/status requests per minute and returns 429 with `Retry-After`; this is not a production distributed/authenticated rate policy.
- Cosmos member/lookup writes share a transactional batch. Scan resolution requests Strong consistency to reject retired codes across instances. Accounts not configured to support it fail closed; run the opt-in contracts and distributed failure tests on an approved Strong-consistency test account before use. A scan resolved immediately before replacement may finish afterward; directory and attendance writes are not one transaction. Never repeat an uncertain scan write against a reassigned identifier: confirm status or review attendance first.
- PUT fully replaces mutable fields and requires the last `_etag` in `If-Match`. Missing ETag: 428; stale: 412. Server-managed fields must not appear in request bodies. JSON bodies are limited to 64 KiB.
- DELETE permanently archives the document; it does not erase it or allow reactivation. Retained documents prevent dangling references and preserve attendance history. Archive subgroups before their parent. Archived group memberships/custom-field values remain on existing members; remove them before updating that member. Archiving a church/event/member blocks new check-ins. Previously saved receipts remain recoverable.
- Group parents, custom-field types, and event schedules are immutable. Use a new definition to change them; events can still be renamed. Future occurrences may be overridden/cancelled with PUT, but started/historical occurrences cannot be rewritten. This conservative policy prevents concurrent generation from rewriting attendance-linked schedules.
- Ical.Net expands daily, weekly, monthly, and yearly RRULEs. Sub-day modifiers are rejected. Generation covers seven days back through 90 days ahead, with deterministic IDs, a 500-occurrence bound, and a 1,000-unmatched-increment evaluation limit. Initial DST gaps/ambiguous times are rejected; use a different initial time. Duration is elapsed minutes. Generated occurrences, cancellations, and overrides are never overwritten by retries.
- Generate occurrences explicitly for the HTTP-only profile. The six-hour timer is disabled by default. To enable it, set `AzureWebJobs.OccurrenceMaintenance.Disabled=false` and configure **Functions host storage separately**, for example `AzureWebJobsStorage=UseDevelopmentStorage=true` with Azurite running. Cosmos configuration does not replace host storage.
- Check-in is allowed before, during, or after the occurrence's start/end times; cancelled occurrences still reject new check-ins. Active members can attend any active event in their church. Server time records when check-in happened. A deterministic occurrence/member identity plus atomic create permits one receipt. The first response is 201; repeats return 200 with the saved receipt. Retry the same IDs after 429, 503, or an uncertain network outcome, honoring `Retry-After`. Never treat an error as confirmation.
- Group membership and subgroup ancestry are snapshotted at check-in. Group-inclusive reporting uses array membership, not joins, so a record is counted once even if the member belonged to both parent and subgroup.
- Reports filter by event, occurrence, member, group, and `[from,to)` check-in date. Maximum report window: 93 days; default: UTC midnight 30 days ago through tomorrow. These are pages of raw receipts, not totals or projections.
- Page size is 1-200. Pass the opaque, URL-encoded continuation token with identical filters and page size until it is null. Cosmos may return an empty page with a continuation token. Tokens are not authentication and are not stable across providers/restarts. Queries are not snapshot-isolated across pages.
- Relationship validation spans documents, not a distributed transaction. An archive concurrent with an already-running operation can race; retained references remain valid. Hard deletion, strict cross-document serialization, real-data retention, identity linking, and authorization are intentionally not implemented.

## Deployment Is Blocked

`Configuration.ValidateSafety` rejects Production/unknown environments and any Azure-hosted instance. The VS Code pre-deploy task fails deliberately. CI builds/tests/packages but contains **no deployment job or Azure credentials**. There is no authentication toggle that makes this suitable for public use.

`infra/main.bicep` is an **undeployed infrastructure scaffold**, not an approved deployment: Linux Flex Consumption (.NET 10), system-assigned identity, Cosmos data role, storage roles, hierarchical attendance partitions, continuous backups, a VNet, private endpoints/DNS, and public network access disabled. It creates the Function App **disabled**. Only `dev`/`test` are allowed. It also defines monitoring resources, but telemetry wiring is deferred pending privacy review. Do not enable the app or relax startup guards just to get a deployment working.

Before a hosted synthetic pilot: approve the region/cost, validate the template against the subscription, provide a private-network deployment runner/VPN, verify public ingress is denied externally, validate private DNS and managed-identity access, review telemetry for personal data, and approve a scoped replacement for the hosted startup block. This work requires Azure access and was not executed locally.

Before any public or real-data use: implement authentication, secure account/member linking, church authorization, roles and own-profile/attendance restrictions; add access-control tests, audited administration, approved retention/erasure rules, backup restore tests, rollback, and approved release gates. Authentication remains deliberately deferred, not implicitly implemented by church scoping.

## Verification Status

Local tests cover repository isolation, ETags, filtering/pagination, defensive copies, 100 concurrent duplicates, multi-church check-in, timeout-after-save recovery, DST, unrestricted check-in timing, cancellation rejection, archival relationships, immutable history, and startup safeguards. The HTTP smoke exercises the actual Functions host without Cosmos connectivity or tokens.

Still required: real Cosmos contract execution, emulator/database-specific failure injection, network-isolation verification, managed-identity verification, restore/rollback exercises, and hosted load/cost measurements. The proposed three-church, 500-member-per-church, 50-request/second pilot is a benchmark to run after environment approval, not a measured capacity claim. Monitor Cosmos RU consumption, 429s, latency, failures, partition sizes, and hot occurrences; an occurrence remains one logical partition.