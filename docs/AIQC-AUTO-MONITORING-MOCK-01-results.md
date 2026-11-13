# AIQC-AUTO-MONITORING-MOCK-01 — actual implementation results

> Subsequent separately authorized refresh/browser phase: the native sandbox is now refreshed and 16 browser cases PASS. See [actual browser evidence and limits](aiqc-sandbox-browser-e2e-20261101.md). The implementation-phase results below remain historical; production is unchanged.

Implemented in the existing CRM source tree and verified with synthetic fixtures, the proven sandbox PostgreSQL database, and a temporary loopback Socket.IO test listener. No separate application/server was deployed. Production was not accessed/restarted; no browser was launched.

## Authorization and migration

Read `AGENTS.md` and the approved change set. Native revision files were preserved; only the existing QC bootstrap, test exclusion config and QC dashboard were extended. Existing message writer, production router/menu, socket auth/handlers, Cloudflare and compose flags were not edited.

The owner separately approved `20261101180000_native_ai_qc_monitoring_mock` for **only** `ai_qc_sandbox_knowledge_mvxj0im3` at loopback 59941. The script checked database name, port and server data_directory against the recorded synthetic cluster before writes. Exactly three tables were created: monitoring job, warning and delivery. Other migrations executed: zero. The migration script never loads dotenv or uses ambient DATABASE_URL, applies no other migration, performs no production operation and refuses a second apply against existing tables; `--check` verifies source column shape. This is a sandbox release artifact, not a production migration runner or full production drift verifier. No Prisma migration-history table was created/modified.

## Functions built

- **Synthetic event adapter:** validates server-synthetic provenance and current create grant, atomically stores the source-message snapshot with its job, then uses the existing automation bus for a wakeup. This is not a hook into CRM's production Message writer. The durable source receipt is the snapshot in the monitoring job, not a new write to the CRM messages table.
- **Durable queue:** PostgreSQL tenant advisory locks, deterministic event keys, duplicate-payload conflict checks, leases/generation fencing, restart/reclaim, four attempts, exponential backoff and dead-letter state. No Redis dependency or memory fallback in runtime.
- **Mock worker:** fresh actor/tenant/department authorization, approved effective revision retrieval, existing ConversationAnalyzerService forced to Mock, authority/scope recheck and warning/outbox atomic completion. It does not read CRM conversations or use stored real-provider settings.
- **Warning engine:** conduct observations, unresolved request, eligible unanswered/SLA and insufficient evidence. Each carries source IDs, attribution or UNKNOWN, immutable analysis snapshot/hash, knowledge citations/revisions, coverage, timestamps, review version/history. No confirmed violation or discipline status exists.
- **SLA scheduler:** separate minute tick, approved SLA and verified working intervals/assignment/coverage; repeated evaluation within a tick uses a stable snapshot. Existing analytics calculate eligibility/denominators. No due event is fabricated when context is missing.
- **Notifications:** isolated namespace `/ai-qc-monitoring` on the existing Socket.IO server; fresh token/account/RBAC resolution in runtime. Per-socket/current-content authorization, minimal delivery/warning ID plus version, persisted per-user ACK, bounded retransmission delay and reconnect dedup. No warning/chat content broadcast to a public or org room.
- **Warning Center:** existing QC page embeds an opt-in lazy component with open/category counts, warning list, evidence drawer, citations, authorized review actions and queue health. Empty/error/OFF states and denied health access are explicit. The component is not loaded when its build flag is OFF.
- **Sandbox composition:** runtime verifies synthetic proof, database identity and table presence before creating routes/worker/scheduler. It rediscovers tenants with persisted jobs after restart. It is not registered in ordinary production with the default OFF flag.

## Changed file inventory

New backend module files under `backend/src/modules/ai-quality-control/monitoring/`:

`contracts.ts`, `settings.ts`, `repository.ts`, `synthetic-message-adapter.ts`, `queue.ts`, `worker.ts`, `warning-engine.ts`, `notification-outbox.ts`, `health.ts`, `sla-scheduler.ts`, `routes.ts`, `runtime.ts` (composition helper).

Other new files:

- `backend/prisma/schema/native-ai-qc-monitoring.prisma`
- `backend/prisma/migrations/20261101180000_native_ai_qc_monitoring_mock/migration.sql`
- `backend/prisma/migrations/20261101180000_native_ai_qc_monitoring_mock/migration.manifest.json`
- `backend/tests/native-ai-qc-monitoring.test.ts`
- `backend/vitest.native-ai-qc-monitoring.config.ts`
- `frontend/src/api/ai-qc-monitoring.ts`
- `frontend/src/views/ai-quality-control/AIWarningCenter.vue`
- `frontend/tests/native-ai-qc-monitoring.test.ts`
- `frontend/vitest.native-ai-qc-monitoring.config.mjs`
- `scripts/run-native-ai-qc-monitoring-tests.cjs`
- `scripts/run-native-ai-qc-monitoring-integration.cjs`
- `scripts/verify-native-ai-qc-monitoring-sandbox.mjs`
- `scripts/native-ai-qc-monitoring-migrate.cjs`
- This results document.

Modified: `backend/src/modules/ai-quality-control/bootstrap.ts`, `backend/vitest.config.ts`, `frontend/src/views/ai-quality-control/AIQualityControlDashboard.vue`, and change-set status in `docs/AIQC-AUTO-MONITORING-MOCK-01.md`. PostgreSQL integration is a dedicated guarded script instead of a default-discoverable Vitest DB suite. Source hashes are recorded in the evidence inventory.

## Actual tests

| Check | Result |
| --- | --- |
| New backend monitoring tests | 19/19 PASS |
| New frontend monitoring SSR/event-contract tests | 6/6 PASS |
| Existing native QC backend regressions | 117/117 PASS |
| Existing QC frontend SSR regressions | 7/7 PASS |
| Backend TypeScript build | PASS |
| Frontend vue-tsc build | PASS |
| Approved sandbox migration and schema check | PASS |
| PostgreSQL + real Socket.IO integration | PASS |
| Browser E2E / full running CRM monitoring activation | NOT RUN |

Backend tests cover OFF, invalid production/unverified enablement, committed synthetic snapshot/job, event conflict/dedup, Mock evidence/outbox, stale lease/reconstructed worker, retry/backoff/DLQ, tenant/current-scope denial, unknown actor, incomplete coverage, future/DRAFT/revoked rules, evidence tampering, due/unknown SLA context, warning HTTP authorization/versioned review and notification contracts. All external networking is denied in unit tests. Scope is rechecked again before warning persistence, including a department grant revoked during processing.

The programmatic integration uses a scrubbed child process and exact cluster identity checks, then persists QC snapshots and jobs/warnings on the synthetic knowledge DB. It proves concurrent duplicate commit → one job; concurrent claim → one lease; reconstructed worker reclaims an expired lease; stale completion rejected; warnings/evidence/outbox persisted; rollback leaves original warnings; retry exhaustion reaches DEAD; OFF creates no job; wrong tenant sees no warnings. The worker restart test reconstructs worker/repository instances against stored data and advances the injected lease clock; it is not an OS process-kill test.

It also starts a temporary `127.0.0.1` HTTP/Socket.IO fixture on an ephemeral port, attaches the actual notification adapter and socket.io-client, proves authenticated delivery/invalid-token denial/cross-tenant isolation, ACK persistence and reconnect dedup, and closes the fixture. Runtime JWT/account validation is wired to existing services in source; fixture connections use synthetic token resolution, not real CRM credentials. The integration permits TCP only to the verified synthetic PG port and its temporary Socket.IO port; fetch/TLS outbound probes are denied. No production port/domain is used.

One regression failure was found and fixed: eager Warning Center import loaded browser router dependencies into legacy SSR even with the flag OFF. Lazy loading restored all 7 legacy frontend tests. No currently failing test remains in the executed suites.

## Flags and limitations

New flags default to backend monitoring OFF and frontend warning center OFF. Synthetic-only is enforced; enabling the backend flag outside a proven test runtime is rejected. Real API/data/outbound must be false for monitoring startup. No production environment value was changed in this task.

Current limits and unverified items:

- The source is built/tested but the existing server on 3091 and UI on 5174 have not been refreshed with monitoring enabled. No claim of a running warning center in the browser.
- Browser layout/click workflows and full CRM bootstrap/start/stop lifecycle remain unverified; Browser E2E was explicitly excluded.
- PostgreSQL repository serializes and reads/upserts bounded per-tenant state (5,000 jobs/10,000 warnings, 32 MiB). It is a durable sandbox implementation, not production-scale SQL queue optimization. Capacity needs retention/archival review.
- Crashed analyzer attempts can leave orphan run snapshots; atomic job completion prevents duplicate warnings. Only successfully completed attempt run IDs are linked on the job. Evidence is retained, not silently deleted.
- CUSTOMER_CARE_OVERDUE is a category contract, but no authoritative orders/care-history adapter exists, so the engine never invents overdue-care warnings. Unsupported context remains unavailable/insufficient evidence.
- Processing SLO/load tests, scheduler timing under sustained load, production ingestion and production deployment are not accepted by these tests.
- GitNexus bootstrap impact was UNKNOWN due to dynamic import; source confirmed app startup calls it. Notification class impact was CRITICAL through broad callback flows. Warnings were reported before edits. No shared Socket.IO or production message-path edits were made.

## Evidence and next integration

Evidence root: `C:\Zalo CRM\aiqc-monitoring-test-evidence-20261101`, including `monitoring-results.json`, `monitoring-frontend-results.json`, `monitoring-integration.json`, its log, migration/schema results, regression copies and source manifest.

Next: review this source/evidence, then separately approve refreshing/configuring the existing synthetic sandbox with `AI_QC_AUTO_MONITOR_ENABLED=true`, `AI_QC_AUTO_MONITOR_SYNTHETIC_ONLY=true` and `VITE_AI_QC_MONITORING_ENABLED=true`, while all real-data/provider flags stay false. Inject synthetic fixture events only. Browser E2E requires its own approval; production writer/migration/overlay/restart remains a separate future scope.
