# Plan: Church Management APIs

Based on [the requirements](../Prompts/functionapp-prompt.md) and your selections: **C#/.NET 10 isolated Azure Functions, Cosmos DB, member self-check-in, and a small pilot**. The current development/debugging phase uses unauthenticated HTTP APIs; authentication and authorization are deferred until before public or real-data use.

## 1. Foundation

- [x] Create the C#/.NET 10 isolated HTTP-triggered Function App under `src/jchurchFunction`, relative to the repository root, with its project file, startup code, HTTP functions, and application configuration in that folder.
- [x] Create the test project and local development configuration; point debug, build, and deployment configuration at `src/jchurchFunction`.
- [x] Define shared repository interfaces for directory, events, and attendance, with both in-memory and real Cosmos DB implementations; keep HTTP functions and business services independent of the storage provider. Defer identity-link repositories until authentication is introduced.
- [x] Select the repository implementation through configuration and dependency injection. Support local debugging with `InMemory` without Cosmos DB credentials or an emulator; use `CosmosDb` in deployed environments and reject in-memory configuration outside development/test. Never silently fall back to in-memory storage on Cosmos failures. Hosted execution is currently blocked entirely pending review.
- [x] Define versioned REST endpoints and an OpenAPI specification.
- [x] Standardize validation, errors, pagination, search filters, and concurrency handling.
- [x] Target Linux Flex Consumption, which supports .NET 10 isolated Functions. The infrastructure scaffold compiles but is not deployed.

## 2. Development Access And Deferred Security

- [x] Make HTTP triggers anonymous for the current development/debugging phase, without sign-in, JWT validation, function keys, or role checks. Do not require an identity provider to run locally.
- [x] Use explicit `churchId` and, where needed, `memberId` request values for debugging. Keep church-scoped queries and same-church relationship validation; these protect data consistency, not access control, because callers can choose IDs.
- [ ] Limit unauthenticated use to localhost or network-restricted development/test environments with synthetic data. Block public/production deployment while authentication is deferred and verify any hosted test environment is not publicly reachable.
- [x] Retain input validation, safe logging, and secure Cosmos DB credentials/managed identity; deferring caller authentication does not make the database public.
- [ ] Before public or real-data use, implement authentication, secure account-to-member linking, platform/church administrator and member permissions, authorized church access, and own-profile/attendance restrictions. Microsoft Entra External ID remains a proposed provider, not a current development dependency.

## 3. Repositories And Cosmos DB

- [x] Implement thread-safe in-memory repositories with singleton state shared across requests within one local host process. Keep data isolated by church, reset it on process restart, and document that it is neither durable nor shared across worker processes.
- [ ] Preserve repository contract behavior in both implementations: CRUD, search/filtering, pagination, optimistic concurrency, and atomic duplicate-safe check-in creation. Keep validation and church-scoped data access enabled with either provider while caller authentication is deferred; do not attempt to emulate Cosmos throughput, consistency, or distributed scaling.
- [ ] Create a directory container partitioned by `churchId`.
- [x] Model churches, groups, members, custom-field definitions, events, and occurrences as separate documents.
- [ ] Create an attendance container with hierarchical partition keys: `churchId`, then `occurrenceId`.
- [ ] Configure indexes around actual search/report filters, use continuation tokens, and protect updates with ETags.
- [ ] Monitor partition size, throughput, and hot events. One occurrence remains one logical partition, so larger workloads require reassessment.

## 4. Church Directory

- [x] Implement create, update, get, search, and delete APIs for churches, groups, subgroups, and members.
- [x] Represent subgroups using `parentGroupId`; initially support one subgroup level and reject invalid relationships.
- [x] Support assigning each member to multiple groups/subgroups.
- [x] Require first and last name; support optional middle name, birth date, school, phone, and email.
- [x] Add church-defined optional custom fields with types, validation, and definition-management APIs.
- [x] Define archive/delete behavior that prevents dangling memberships and preserves attendance history. DELETE archives without physical erasure or reactivation.

## 5. Events

- [x] Implement event management APIs for one-time and recurring events. Event schedules are immutable; rename events, override future occurrences, or create replacement events.
- [x] Store timezone-aware recurrence definitions and concrete occurrences with UTC start/end times.
- [x] Use a maintained recurrence library; test daylight-saving transitions.
- [x] Generate occurrences over a rolling window with retry-safe background processing. Timer implementation is disabled in the default storage-free local profile; host-storage-backed execution remains to be exercised.
- [x] Support occurrence cancellation and overrides without rewriting historical attendance.

## 6. Self-Check-In

- [x] Provide event discovery, self-check-in, and check-in status APIs.
- [x] For development, accept an explicit `memberId` for check-in and status lookup, and validate that the member and occurrence belong to the requested church. Document that this does not verify the caller's identity; defer identity-derived self-service (`me`) endpoints until authentication is implemented.
- [x] Allow active members to attend any active event within their church, regardless of group membership.
- [x] Allow check-in regardless of occurrence start/end times; retain cancellation checks and server-time attendance timestamps (updated requirement).
- [x] Prevent duplicates with a deterministic member/occurrence identity and atomic Cosmos document creation. Cosmos-specific execution remains pending.
- [x] Return confirmation only after persistence; repeated requests return the existing receipt.
- [ ] Handle throttling, retries, and uncertain network outcomes without double-counting. Recovery and bounded SDK retries are implemented; real Cosmos failure injection remains pending.

## 7. Attendance

- [x] Provide paginated attendance filtered by event, occurrence, group/subgroup, member, and date range.
- [x] Record group membership at check-in time so later reassignment does not alter historical reports.
- [x] Support subgroup-inclusive reporting without counting the same attendance twice.
- [x] Start with indexed, bounded queries; introduce asynchronous reporting projections only if measurements justify them. Index definitions are in the undeployed Bicep scaffold.

## 8. Verification And Deployment

- [x] Test validation, church-scoped data access, recurrence, deletion, unrestricted check-in timing, and cancellation rejection. Verify local HTTP calls work without tokens or function keys; defer permission tests until authentication/authorization is implemented, and require them before public or real-data use.
- [ ] Run shared repository contract tests against both implementations, including tenant isolation, stale-version updates, filtering/pagination, and concurrent duplicate check-ins. Keep Cosmos integration and hosted load tests for database-specific behavior; in-memory tests do not replace them.
- [x] Document local debug profiles for `InMemory` and `CosmosDb`, optional synthetic development fixtures, reset-on-restart behavior, and unauthenticated sample requests with explicit church/member IDs. Verify an end-to-end local API flow without Cosmos connectivity or identity-provider setup; document any separate Functions host storage/emulator requirements for background triggers.
- [x] Send 100 simultaneous duplicate check-ins and verify exactly one attendance record. Verified through the local HTTP host with in-memory storage.
- [x] Test timeout-after-save recovery and simultaneous check-ins across multiple churches. Verified using an in-memory fault-injection wrapper; hosted network failures remain pending.
- [ ] Proposed pilot benchmark: three churches, 500 members each, plus a 50-request/second burst; measure latency, failures, throttling, and cost.
- [ ] Provision environments using Bicep, managed identity, and approved CI/CD deployments. Until authentication is implemented, permit only network-restricted development/test deployments with synthetic data and block public/production releases.
- [ ] Configure telemetry without personal data, audit trails, backups, restore testing, retention, and rollback.
- [ ] Complete an end-to-end development pilot with synthetic data and publish API/setup documentation. Complete authentication, authorization, and access-control tests before a real-data or public pilot.

## Order And Scope

Foundation and development access safeguards come first; authentication is not a prerequisite for local feature development. Directory and event development can then proceed in parallel; check-in depends on both, and attendance verification depends on check-in. Infrastructure and tests progress alongside implementation. Authentication and authorization are required before public or real-data use.

The current development phase defers authentication, authorization, and identity linking. The initial release excludes frontend/mobile apps, offline synchronization, kiosks, guardian check-in, and cross-church attendance. The eventual authentication provider, retention policy, and numerical performance targets are recommendations for approval. The local application, tests, documentation, build-only CI, and disabled private-network infrastructure scaffold are implemented. No Azure resources have been created.

## Implementation Verification

See [the setup and API guide](../README.md). Local verification: 23 passing automated tests and one explicitly skipped Cosmos integration test; the real Functions-host smoke test passes, including 100 concurrent duplicate check-ins. OpenAPI validation, Release publishing, and Bicep compilation pass. Cosmos contract execution, hosted network/identity verification, background-trigger host storage, performance/cost measurements, telemetry/auditing, restore/rollback exercises, and public/real-data security gates remain open. Startup and editor deployment safeguards deliberately block hosted execution until reviewed.