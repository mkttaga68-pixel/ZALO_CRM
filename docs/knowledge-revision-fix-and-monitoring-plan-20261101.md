# Knowledge revision patch and monitoring scope — 2026-11-01

## A. Revision bug root cause and impact

`KnowledgeApprovalService.publish` marked the old version REPLACED immediately. `KnowledgeRetrievalService.retrieve` accepted only APPROVED, so a future-effective successor left no active rule. Analyzer/assistant post-request checks also used direct APPROVED/date checks and could miss a wall-clock transition without another write.

Read `AGENTS.md` and the GitNexus impact skill. Located cached GitNexus CLI 1.6.12, indexed the current repository using index-only mode into `C:\Zalo CRM\gitnexus-sandbox`, with no agent/skill injection and no embeddings/FTS download. Ran upstream impact before runtime edits for publish, revoke, retrieve, analyze and ask. Publication/revocation/assistant: LOW; retrieval/analyzer: HIGH. Direct callers include native QC routes and training analysis; affected flows include native registration, manual conversation/dataset analysis and assistant grounding. Some dynamic receivers/process walks were unresolved/truncated: graph results are not proof of complete impact coverage. No auth/message writer/router/menu was edited by this patch.

Whole-worktree detect-changes was also run: CRITICAL, 28 tracked files/76 symbols/20 processes, including pre-existing auth/posting changes. It does not isolate this patch and does not fully represent already-untracked native files. No commit, production build or deployment was performed.

## B. Patch files and semantics

| File | Change |
| --- | --- |
| `backend/src/modules/ai-quality-control/knowledge.ts` | Preserve published predecessors; select exactly one effective revision; dated revocation, cancellation and effective overlap checks. |
| `backend/src/modules/ai-quality-control/contracts.ts` | Optional `revokedAt` in JSON workspace metadata; no schema migration. |
| `backend/src/modules/ai-quality-control/analysis.ts` | Revalidate the effective winner at commit, including transitions during analysis. |
| `backend/src/modules/ai-quality-control/training.ts` | Use the same effective winner for manager grounding and final recheck. |
| `frontend/src/api/ai-quality-control.ts` | Optional approval timestamp type. |
| `frontend/src/views/ai-quality-control/AIQualityControlDashboard.vue` | Selected document shows effective interval and SCHEDULED marker for approved future versions. No route/menu change. |
| `backend/tests/native-ai-quality-control.test.ts` | 16 added regression cases. |
| `scripts/verify-obsidian-revision-workflow.mjs` | Existing fixture verifier now reports PASS only when predecessor remains available; no stale failure text on success. |
| `scripts/verify-knowledge-revision-postgres.mjs` | New guarded synthetic PostgreSQL concurrency/rollback/transition verification. |

Publication remains APPROVED; scheduled is derived from effectiveFrom, without a new database status or timer that rewrites versions. Before a transition the predecessor wins; exactly at transition and after it, the higher published revision wins. Within one document, effective intervals are implicitly cut by the next started revision. Publication rejects equal/backward transition times; declared overlaps across distinct documents/rules are checked against their effective ends. Expiration/revocation never silently resurrects an older revision.

Revoking before effectiveFrom cancels the scheduled transition; the current predecessor continues. Revoking an active rule blocks it at revokedAt; earlier effective-time lookup remains possible under CURRENT ACLs. Legacy revoked versions without revokedAt remain unavailable. Legacy REPLACED versions can participate in historical lookup; no existing records are rewritten. A rollback requires another approved higher revision, optionally restoring old Markdown. No automatic rollback/approval exists.

Times require an explicit Z/offset on publication and normalize to UTC. Intervals use inclusive start/exclusive end. Historical lookup is valid-time lookup under current access rights, not restoration of old permissions or a claim about what a reviewer knew at that time. It does not bypass newer ACL restrictions. Saved run/knowledge snapshots remain unchanged. No production state migration or automatic repair of prior payloads is included.

## C. Regression results

- Dedicated backend: **117/117 PASS** (101 existing + 16 new).
- Existing frontend SSR: **7/7 PASS**; backend TypeScript build and frontend vue-tsc build PASS.
- New cases: before/exactly/after boundary; historical/legacy lookup; unapproved/hash-invalid revision; timezone; active revocation and scheduled cancellation; no fallback after expiry; overlap/order; duplicate publication; tenant/latest ACL; rollback and snapshot replay; transition during in-flight analysis; historical cross-document overlap and abutting revocation boundary.
- Real PostgreSQL on identity-verified loopback synthetic knowledge DB: concurrent publication ONE COMMIT/ONE REJECTION, one publication audit, persisted scheduled transition PASS, transaction rollback PASS. No production connection or real provider request.
- Existing Fastify synthetic revision workflow now PASS, including original gap reproduction. The real Obsidian Vault was not read/changed by this patch's tests.

Evidence root: `C:\Zalo CRM\obsidian-revision-fix-evidence-20261101`; API fixture evidence also at `C:\Zalo CRM\obsidian-e2e-readiness-20261101\revision-workflow.json`. PostgreSQL tests use the pre-existing proven sandbox and a unique synthetic organization; they do not start/restart an app or worker. Backend network-denied tests use stub providers even where their fixture permission flags simulate enabled API access.

## D. Browser E2E

NOT RUN; awaiting separate approval. Existing target is `/ai-quality-control` → Obsidian Brain tab (index 5), at 5174/3091 only. Backend source/compiled patch was not loaded into a restarted sandbox server in this task; a browser acceptance run needs an explicitly approved sandbox refresh/restart and verified synthetic identity/flags first.

Approved-run checklist: fresh Chrome/Edge profile, loopback-only network allowlist (localhost/127.0.0.1 ports 5174 and 3091), no external fetches, synthetic login/test Vault only, no production cookies. Exercise list/status/revision/hash/sync, fixture-only approval and citations, Mock analysis, review authorization, empty/error states, console/API failures. Capture redacted screenshots/trace/logs. Runner installation (if needed), browser launch and sandbox-only configuration/restart remain separate permissions. See the earlier E2E readiness document for exact directory/target scope. SSR/API results are not browser evidence.

## E. Auto-monitoring gap matrix

| Stage | Current code and gap |
| --- | --- |
| Message committed | `chat/message-handler.ts` persists message and updates related state, then emits automation events in an async block and returns HandleMessageResult. Message create exists around line 290; generic event emission around line 544. No atomic QC outbox. No live ingestion test performed. |
| Event bus | `automation/engine/event-bus.ts` is in-memory EventEmitter/setImmediate; useful for synthetic injection, not durable delivery across crashes. |
| Durable queues | BullMQ/Redis producer/worker patterns exist under Facebook integrations. They are not QC jobs. Optional shared Redis can fall back to memory, unsuitable for a durability claim. |
| Conversation | Existing tenant/account/privacy-filtered CRM adapter and immutable run snapshot. CRM coverage/assignment/calendar remain unknown; do not invent eligibility. |
| Analyzer | Existing manual ConversationAnalyzerService, MockAIProvider, approved retrieval, budget gates, snapshot/review storage. Real Responses provider remains OFF. |
| Warning persistence | Runs/findings/audits exist in bounded JSON workspace. No monitoring job state, independent durable warning idempotency or delivery outbox exists. |
| Realtime | Authenticated Socket.IO/account/org infrastructure exists. No QC warning event or dashboard subscriber. Org-only routing alone does not enforce per-document/conversation ACLs. |
| RBAC | Existing `ai_quality_control` actions and current account/tenant/department/privacy checks can be reused; worker needs explicit execution identity and reauthorization. |
| Schedulers | Existing node-cron/automation/scoring schedulers. No QC due-time scheduler for unanswered turns/SLA. |

Minimum proposed implementation reuses this backend, Prisma/PostgreSQL, analyzer, auth and Socket.IO. Prefer a PostgreSQL job/outbox table and transactional message+job write, avoiding an additional mandatory Redis service. Existing BullMQ patterns remain a reference; use BullMQ only if durable Redis is explicitly provisioned and the transactional outbox problem is addressed.

Proposed flow: message transaction/outbox → leased durable job → current-ACL/effective-knowledge check → Mock analyzer → warning/evidence plus notification-outbox transaction → authorized dashboard invalidation. Reuse current backend scheduler lifecycle; no separate app/server.

## F. Mock pipeline status and exact change set needing approval

NOT IMPLEMENTED. The current approval covers the revision fix and monitoring preparation; no specific monitoring schema/worker/dashboard change set has been accepted. No real ingestion hook, new job consumer, warning emitter, scheduler or auto-monitoring flag was added.

Proposed sandbox-only change set, for explicit approval:

1. New `backend/prisma/schema/native-ai-qc-monitoring.prisma` and feature-only migration for tenant-scoped job/lease, warning and notification-outbox records. Apply only to an identity-verified disposable DB initially.
2. New `backend/src/modules/ai-quality-control/monitoring/{contracts,settings,queue,worker,warning-engine,notification-outbox,health,sla-scheduler}.ts`.
3. Synthetic-only event adapter/fixture runner in `scripts/`; no edits to live message ingestion in the first mock change set. Later production ingestion requires separate impact review and authorization to create message/outbox atomically.
4. Inject existing analyzer with MockAIProvider only. No bootstrap registration in production. Proposed flags `AI_QC_AUTO_MONITOR_ENABLED=false` and `AI_QC_AUTO_MONITOR_SYNTHETIC_ONLY=true`; OFF must enqueue/start/emit nothing. These flags are proposals, not currently implemented switches.
5. Jobs contain tenant/conversation/message revision references and snapshot hashes, not raw chat in logs. Unique enqueue key includes tenant, message revision and event kind. Warning uniqueness includes tenant, source event, knowledge revision and finding type. Retry reuses the same job identity. Claim with lease expiry/fencing; crash recovery must not duplicate warning/outbox records.
6. Proposed retry: bounded exponential backoff, four attempts, dead-letter state after exhaustion; invalid tenant/permission/hash is terminal. Persist heartbeat/oldest pending age/lease age/retry/DLQ counts. No memory fallback when durability is required.
7. Notify authorized recipients with minimal invalidation IDs; recheck current permissions before delivery and on fetch. Client deduplicates notification IDs. Do not broadcast full findings/chat to an org room.
8. Reuse existing QC dashboard view through injected sandbox-only transport to show warnings/processing health. No production router/menu edits. Add integration tests covering restart, retry/DLQ, dedup, revision boundary, ACL and evidence.

No pipeline PASS is claimed for new-message enqueue, duplicate-warning suppression, worker restart, retry/DLQ or dashboard delivery: those components do not yet exist. Unknown-actor/incomplete-coverage handling remains covered by existing analyzer/analytics unit tests, not an auto-monitoring E2E test.

## G. Security, KPI and SLA boundaries

All current tests use synthetic data; only the dedicated synthetic concurrency test writes to a proven disposable database. Zero production writes, real customer reads, real OpenAI calls, production restarts/overlays, Cloudflare changes or employee violation confirmations were performed.

Current-ACL historical lookups remain tenant/department filtered. Provider-bound evidence is revalidated after the request and before commit. Evidence replay verifies saved snapshots and does not reactivate revoked rules. Latest scope revocation can still deny reading an old snapshot; historical lookup never restores revoked permissions.

Business KPI/SLA evaluation should run in a separate due-time scheduler within the same backend, not be inferred from queue latency. Reuse EmployeeResponseAnalyticsService: response rate = eligible answered request-turns / eligible request-turns; median/P90 use verified human answers and verified working seconds. Missing actor, sync coverage, assignment/calendar or approved SLA yields UNKNOWN/NOT_AVAILABLE with exclusion reasons. A scheduler evaluates only when the eligibility deadline is reached and stores the rule/version, evaluation time and denominator. AI findings remain potential issues requiring review.

Proposed processing SLO for later measurement: enqueue-to-start P95 ≤30s and event-to-dashboard P95 ≤60s under an agreed fixture load; due-SLA checks within one scheduler tick (proposed 60s). These are design targets, not measured results or approved employee thresholds. Operational metrics: lag, completion latency, retries, DLQ, heartbeat and duplicate suppression, separate from business KPIs.

## H. Exact next action

Review the sandbox revision patch and its evidence. Separately approve the scoped browser runner plus synthetic-sandbox refresh/configuration; then run browser acceptance on 5174/3091 and record results. Separately approve or revise the exact mock monitoring change set in F before implementing it. No production deployment/restart is the next action; the current Docker image still contains the earlier revision behavior until a separately approved release.
