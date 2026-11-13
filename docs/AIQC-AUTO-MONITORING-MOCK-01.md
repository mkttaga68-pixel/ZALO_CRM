# AIQC-AUTO-MONITORING-MOCK-01

Status: **OWNER APPROVED; IMPLEMENTED AND TESTED IN ISOLATED SYNTHETIC RESOURCES**.

> The owner approved code/tests and subsequently approved the specific three-table migration on `ai_qc_sandbox_knowledge_mvxj0im3` only. See [implementation and actual evidence](AIQC-AUTO-MONITORING-MOCK-01-results.md). The proposal below records the original review scope; browser E2E and activation of the running sandbox UI/backend are not claimed.

This is a separate, reviewable sandbox-only change set prepared from the owner's attached NEXT PHASE request. That request explicitly requires approval before feature edits. Earlier authorization for the knowledge revision fix, production manual QC testing and real CRM reads does not authorize this monitoring change set or a new production deployment. Browser execution remains a separate approval.

## A. Revision patch review and baseline

- Branch: `main`; HEAD: `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`.
- Read `AGENTS.md` and `knowledge-revision-fix-and-monitoring-plan-20261101.md`.
- All 9 files in the recorded revision source manifest match their recorded SHA-256 hashes. No recorded patch file was overwritten in this preparation.
- Re-read publication, effective retrieval and analyzer commit checks. The fix preserves predecessor publication data, selects the effective revision and revalidates the winner before recording analysis. Scheduled revocation cancellation and current-ACL historical lookup are deliberate semantics, not restored historical permissions.
- Current rerun: 117 backend tests and 7 frontend SSR tests PASS. These test results do not prove browser acceptance or automatic monitoring.
- Recorded PostgreSQL evidence remains PASS for one commit/one rejected concurrent publication, one audit, persisted transition and transaction rollback. The PostgreSQL test was not rerun in this preparation; no database was contacted.
- Working tree has pre-existing auth/posting/storage edits and untracked native QC files. Hash equality establishes only the recorded patch baseline; it cannot certify every unrelated edit. Whole-worktree GitNexus review from the previous phase was CRITICAL and is not an approval to deploy the workspace.
- Current source schema contains `NativeAiQcWorkspace`, a tenant-keyed versioned JSON workspace. No native monitoring schema/directory exists. Live production schema was not introspected.
- Local compose source currently enables manual QC and real CRM reads from earlier authorization; real provider/outbound approvals remain false. These are source configuration observations, not fresh container/environment checks. No `AI_QC_AUTO_MONITOR_ENABLED` implementation exists yet.

## B. Approval boundary

Approval requested: implement and test exactly this change set against verified disposable synthetic resources using the existing CRM backend/frontend. No separate app or server; reuse existing analyzer, effective knowledge lookup, RBAC and Socket.IO code. Preserve all unrelated workspace edits. Run GitNexus impact before modifying existing symbols.

Included: synthetic message persistence/event integration, PostgreSQL durable jobs, Mock worker, warnings/evidence/review history, sandbox warning dashboard/realtime invalidation, due-time scheduler, fixtures and dedicated tests.

Excluded: production writer/router/menu changes; production migration/overlay/restart; real customer reads; real Vault changes/approvals; real OpenAI; actual monitoring enablement; Cloudflare; automatic violation confirmation. Browser runner installation/launch, profile creation and sandbox process restart are NOT included in a code-only approval.

## C. Exact proposed files

Paths below are proposed; none of the feature files listed as new have been created by this preparation.

| Action | Path | Purpose |
| --- | --- | --- |
| New | `backend/prisma/schema/native-ai-qc-monitoring.prisma` | Tenant-scoped durable job/lease, warning and notification-outbox models. Warning review history is append-only JSON with an optimistic version. |
| New | `backend/prisma/migrations/20261101180000_native_ai_qc_monitoring_mock/{migration.sql,migration.manifest.json}` | Proposed feature-only DDL, constraints/checksum; reserve/check the migration ID before implementation. Never apply the historical migration chain. |
| New | `backend/src/modules/ai-quality-control/monitoring/contracts.ts` | Job, warning/category/status, review, evidence and health contracts. |
| New | `backend/src/modules/ai-quality-control/monitoring/settings.ts` | OFF by default; require a proven synthetic runtime and explicit mock-only mode. |
| New | `backend/src/modules/ai-quality-control/monitoring/repository.ts` | Tenant predicates, transactions, unique keys, leases/fencing, warning/outbox atomic commit. |
| New | `backend/src/modules/ai-quality-control/monitoring/synthetic-message-adapter.ts` | Persist fixture message plus durable job atomically in the disposable DB, then emit a wakeup event through the existing bus. Never import into the live writer. |
| New | `backend/src/modules/ai-quality-control/monitoring/queue.ts` | Job claim, completion, delayed retries and dead-letter state. |
| New | `backend/src/modules/ai-quality-control/monitoring/worker.ts` | Authorization, snapshot/provenance checks, existing analyzer forced to Mock, structured validation and idempotent warning commit. |
| New | `backend/src/modules/ai-quality-control/monitoring/warning-engine.ts` | Evidence-based observations and insufficient-context handling, no confirmed violations. |
| New | `backend/src/modules/ai-quality-control/monitoring/notification-outbox.ts` | Authorized delivery of minimal warning IDs/version invalidations; never raw content broadcast. |
| New | `backend/src/modules/ai-quality-control/monitoring/health.ts` | Heartbeat, queue/lease age, retries/DLQ, counts and latency metrics. |
| New | `backend/src/modules/ai-quality-control/monitoring/sla-scheduler.ts` | Separate due-time evaluator; reuse existing analytics, approved thresholds and verified working intervals. |
| New | `backend/src/modules/ai-quality-control/monitoring/routes.ts` | Sandbox-only warning list/detail/review and health handlers; current auth/RBAC, tenant and document/privacy checks. |
| Modify | `backend/src/modules/ai-quality-control/bootstrap.ts` | Register/inject monitoring only inside a proven synthetic profile with explicit opt-in. No production monitoring route/worker registration. Requires impact review. |
| New | `frontend/src/api/ai-qc-monitoring.ts` | Typed sandbox warning/health client. |
| New | `frontend/src/views/ai-quality-control/AIWarningCenter.vue` | Counts/categories, list/detail, evidence drawer, citations, review and processing health. |
| Modify | `frontend/src/views/ai-quality-control/AIQualityControlDashboard.vue` | Embed sandbox warning center behind explicit frontend opt-in and verified backend synthetic capability. No router/menu edits. |
| New | `backend/tests/native-ai-qc-monitoring.test.ts` | Unit/service/authorization/dedup/warning/scheduler tests. |
| New | `backend/tests/native-ai-qc-monitoring-postgres.test.ts` | Disposable PG transactions, concurrency/restart/retry/DLQ/rollback/outbox evidence. |
| New | `backend/vitest.native-ai-qc-monitoring.config.ts` | Dedicated isolated runner; no dotenv/application startup. |
| Modify | `backend/vitest.config.ts` | Exclude monitoring suites from uncontrolled default test runs, matching native QC isolation. |
| New | `frontend/tests/native-ai-qc-monitoring.test.ts` | UI rendering, authorization, evidence, empty/error/health and realtime dedup. SSR is not browser E2E. |
| New | `frontend/vitest.native-ai-qc-monitoring.config.mjs` | Dedicated frontend isolation. |
| New | `scripts/run-native-ai-qc-monitoring-tests.cjs` | Scrubbed environment and denied external networking. |
| New | `scripts/verify-native-ai-qc-monitoring-sandbox.mjs` | Proven synthetic DB/message/event → worker → warning/outbox → sandbox client assertions. |
| New | `scripts/native-ai-qc-monitoring-migrate.cjs` | Feature-only artifact/identity checks and explicit application only to the verified disposable DB in this change set. |

Do not modify `chat/message-handler.ts`, `app.ts`, frontend router/menu, notification routes, shared socket auth or existing socket handlers in this scope. If implementation proves one of these edits necessary, stop that dependent part and submit the exact additional symbols/files for separate approval. Existing mock/revision code changes beyond dependency injection likewise require a revised scope.

## D. Queue and worker acceptance — not yet executed

Use PostgreSQL job leases/outbox to avoid adding a mandatory Redis service. Existing in-memory bus is a wakeup mechanism only; losing it must not lose jobs. Existing Facebook BullMQ patterns are references, not existing QC infrastructure.

- Job unique key: tenant + message ID + message revision + event kind. Only committed synthetic fixtures enter this adapter; flag OFF must create no job/worker/event delivery.
- Claim with a lease generation/fencing token. Expired leases are reclaimable. Worker restart must preserve job identity and reject stale completion.
- Four bounded attempts with exponential backoff; terminal authorization/provenance/validation failures do not retry. Exhaustion enters durable dead-letter state with redacted reason and explicit replay permission.
- Worker reauthorizes against the current tenant/department/account/privacy scope; never inject an unrestricted production owner identity. Only references/synthetic snapshots enter jobs, and no secret or real chat appears in logs.
- Force MockAIProvider regardless of stored provider settings. Verify zero outbound calls independently. Record analysis time, observation time, event revision and chosen knowledge revisions; revalidate authority before warning commit.
- Make warning/outbox publication idempotent despite a crash between analyzer snapshot creation and job completion. Orphaned attempt snapshots may remain as evidence, but must not create duplicate warnings/delivery. Record attempt-to-run mappings.
- Warning and notification-outbox commit together. Delivery is at least once with stable event IDs and client dedup; do not promise exactly-once Socket.IO transport.

Proposed flags (not currently implemented): `AI_QC_AUTO_MONITOR_ENABLED=false`, `AI_QC_AUTO_MONITOR_SYNTHETIC_ONLY=true`, frontend `VITE_AI_QC_MONITORING_ENABLED=false`. Production source flags/settings are not changed by this preparation.

## E. Warning Engine acceptance — not yet executed

Supported category contracts: CONDUCT_NEEDS_REVIEW, UNANSWERED_CONVERSATION, SLA_BREACH, CUSTOMER_CARE_OVERDUE, UNRESOLVED_REQUEST, INSUFFICIENT_EVIDENCE.

Each warning carries tenant/conversation ID, verified employee attribution or UNKNOWN, source message IDs, immutable snapshot/hash, rule IDs/revisions/citations, coverage, timestamps, status/version and review history. Warning dedup includes source event, tenant, knowledge revision and finding kind; retries keep the same identity. Review changes status/history, never the original evidence.

Conduct/unresolved observations require validated findings and exact approved citations. SLA/unanswered require verified eligibility/deadline/calendar/assignment/coverage and an approved threshold. Do not manufacture CUSTOMER_CARE_OVERDUE from missing order/care data: fixtures may demonstrate a supplied authoritative context, but otherwise emit only INSUFFICIENT_EVIDENCE with reasons. Unknown actor must not be assigned to a real employee. No inference of intent and no confirmed violations.

## F. Dashboard acceptance — not yet executed

AI Warning Center exists only after approval/implementation. It must show authorized total open/category counts, unanswered/SLA/conduct/missing-context groups, queue health, detail/evidence/citations and permitted reviews. Missing data and OFF state must be explicit.

Reuse authenticated Socket.IO via injected sandbox transport. Notifications contain minimal event IDs, never raw conversation/finding bodies on a public/org-wide broadcast. Current recipients must satisfy tenant and content ACLs at delivery and fetch; tenant-only rooms are insufficient. Replay/reconnect and duplicated invalidations must not duplicate list entries. Existing production notification endpoint is untouched.

## G. Browser E2E approval — separate and pending

Headless installed Chrome/Edge, fresh profile in workspace evidence directory; origins only `http://localhost:5174` and `http://localhost:3091` (or their explicit 127.0.0.1 equivalents). No Internet resources, public CRM/Cloudflare URLs, personal profile, production credentials/cookies or real data. If a runner must be installed, installation/network permission is separately scoped; offline launch must not fetch dependencies.

Sandbox refresh/restart is separately authorized only after identity/database provenance, workers and outbound OFF checks. New test Vault contains synthetic Markdown only. Browser acceptance covers Obsidian/revision, Mock analysis, warning list/detail/realtime and reviewer permissions. Save screenshots, console/request failures and redacted logs. No browser PASS exists now.

## H. Test evidence and completion gates

Current evidence: revision manifest 9/9 hashes match; fresh baseline backend 117/117 and frontend SSR 7/7 PASS. Historical synthetic PG evidence was inspected, not rerun. Source schema inspected; live production schema and customer records not queried.

Future monitoring test matrix must separately report actual executions of: committed message enqueue; duplicate event/warning suppression; restart/fencing; retry/backoff/DLQ; wrong tenant/current ACL; unknown actor; future/revoked rule; incomplete coverage; evidence tamper detection; warning/outbox atomicity; socket isolation/reconnect; flag OFF; denied provider/network; zero production access. No queue/worker/warning/dashboard tests have run because the feature does not exist yet.

Dedicated runner must verify loopback address, synthetic database name AND server data_directory before schema/write operations, then load a scrubbed environment. Do not run a broad default CRM integration suite against ambient DATABASE_URL. Migration is feature-only and disposable-only; keep evidence/source manifest and preserved original snapshots.

## I. Security and compatibility

No feature code, schema, app configuration, production resource or Cloudflare change was made during preparation. No database or Vault access was needed. Existing unrelated edits remain intact. Code-review/test success does not authorize deployment of the whole uncommitted tree.

Before any future existing-symbol edit, refresh/check GitNexus index and run impact analysis with warnings for HIGH/CRITICAL. Preserve current JWT, RBAC, tenant/privacy behavior. Reuse existing scheduler lifecycle; separate business SLA due-time evaluation from queue latency. Missing coverage remains UNKNOWN; employee scoring/confirmed violation stays disabled.

## J. Exact next approval

Owner may approve **AIQC-AUTO-MONITORING-MOCK-01: code and tests only**, including the exact file list above, disposable synthetic PG schema/data, fixture-only event/job execution and sandbox UI source integration; exclude production and browser execution. This enables implementation/testing without another request for routine reversible work inside that boundary.

Separately approve **browser E2E** (runner provisioning if needed, fresh profile, only 5174/3091 and synthetic resources) and **sandbox refresh/configuration** when ready. No production approval is requested or inferred. If scope is changed, amend this document before dependent feature edits.
