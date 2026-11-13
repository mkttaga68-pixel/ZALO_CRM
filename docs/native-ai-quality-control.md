# Native AI Quality Control — development delivery

> This document records the initial sandbox delivery. Current code also supports
> the existing backend/database via an explicit deployment opt-in; see
> [shared-backend release notes](native-ai-qc-shared-backend-deploy.md).
> The running production container has not been updated by that code preparation.

This is a new module in the existing Fastify/Prisma and Vue/Vuetify application. It does not restore the removed AI QC Sprint schemas or services. Status: DEVELOPMENT / SYNTHETIC VALIDATION; not production acceptance.

## Baseline and authorization

- Repository: `C:\Zalo CRM\ZL-CRM`, branch `main`, HEAD `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`.
- Existing security/manual posting changes remain uncommitted and are outside the new module delivery. No reset, checkout, commit, push or deployment was performed for this task.
- The user explicitly approved the GitNexus exception for this new module: static caller/import/dependency tracing, backup and isolated synthetic tests. It does not authorize production integration or real API calls.
- Pre-edit copies of existing integration files are in `C:\Zalo CRM\native-ai-qc-baseline-20261101`. Tests and the final hashed source inventory are in `C:\Zalo CRM\native-ai-qc-test-evidence-20261101`.

## Delivery by phase

| Phase | Delivered code / integration | Verification / limit |
|---|---|---|
| A | Current message, auth, RBAC, privacy and policy contracts audited | Native self messages without `repliedByUserId` stay UNKNOWN. Account owner is not actor. Customer read receipts are not staff-read proof. |
| B | `backend/src/modules/ai-quality-control/{contracts,repository,routes,bootstrap}.ts` | Injected services, tenant workspace, current JWT/auth and explicit resource grants; no production plugin registration. |
| C | `knowledge.ts`, four synthetic Markdown fixtures | Read-only allowlisted vault scan, DRAFT staging, immutable revision/hash, ACL, atomic epoch/index publication and revocation, exact UTF-8 citations, lexical local RAG. |
| D | `providers.ts`, official `openai` SDK in backend dependencies | Responses API strict JSON schema, fixed official endpoint, configurable approved model, timeout, bounded 429 retry, usage and optional price metadata. SDK transport is stubbed in tests. |
| E | `analysis.ts`, `analytics.ts`, `crm-adapter.ts` | Evidence/actor/citation validation; working-time response metrics; missing real orders/calendar/history/coverage remain NOT_AVAILABLE/UNKNOWN. CRM adapter is opt-in read-only, not exercised against real data. |
| F | Existing Vue route `/ai-quality-control`, same layout/auth/Vuetify | Ten development tabs; route/menu require DEV, `VITE_AI_QC_ENABLED=true` and `ai_quality_control.access`. Production build omits this route. |
| G | `training.ts`, synthetic datasets, label history, FP/FN/abstain evaluation, review/replay, manager assistant | Extractive local assistant by default; separate explicit OpenAI action uses a strict answer schema and verified run/citation references. Human review does not confirm violations. |
| H | Dedicated backend tests, frontend SSR tests and scrubbed test runner | 76 backend tests PASS; 5 frontend SSR tests PASS. Backend/frontend typecheck/build PASS. Offline Prisma validation PASS. |
| I | Real OpenAI synthetic request | NOT RUN / BLOCKED: no real key was read; no explicit outbound test approval. |
| J | Production integration/deployment | NOT AUTHORIZED / NOT PERFORMED. Cloudflare Tunnel and production containers remain untouched. |

## Contracts and safety

`ai_quality_control` actions: `access`, `create`, `edit`, `approve`, `delete`, `view_all`. A route must pass existing authentication and the required action. Owner bypass follows existing RBAC behavior; no grants are backfilled to employees automatically.

Knowledge publication requires exact draft content hash, explicit effective interval, department ACL, rule ID/type and approver. A department-scoped approver cannot publish organization-wide policy. Vault administration additionally requires `edit` and `view_all`, because a whole-vault scan is not a department-filtered read. Symlinks/junctions, hardlinks, invalid UTF-8, oversized files and detected scan races are rejected. Vault root and host filesystem permissions must remain administrator controlled; users must not be allowed to swap ancestor directories concurrently. Front matter cannot approve a document. A later revision's restricted ACL also protects historical versions. Removed files do not silently revoke policy; the administrator must explicitly revoke the approved version.

Active retrieval uses approved, effective, ACL-visible documents only. Synthetic documents cannot be used for CRM analysis. Approved thresholds are explicit input, not invented policy. Match terms are a deterministic test aid, not a semantic model. Declared rule/conflict-group overlaps are blocked. Undeclared semantic contradictions still require an authorized reviewer; this implementation cannot prove arbitrary Markdown policies are consistent.

Analysis output includes four types, message references, exact citations, explanations and missing-context reasons. Unsupported references/schema/hash/actor evidence force NOT_EVALUABLE or ABSTAIN. Rules that became effective after the cited messages cannot justify a finding. Human review has optimistic version checks and an append-only audit trail; snapshots are not changed by review. Replay verifies stored hashes/citations offline and does not reactivate revoked policy or reproduce stochastic model output.

Manager OpenAI answers use only accessible completed runs whose knowledge is still approved/effective; aliases replace run identifiers in outbound input. Returned references and citations are checked again locally. Historical extractive summaries are explicitly labeled as saved observations. Neither assistant changes rules, evaluates penalties or scores employees.

The CRM adapter requires the real-data server flag before any read; it checks tenant/account access, privacy/PIN, contact scope and policies. Workspace/assistant/evidence endpoints recheck current CRM access for previously stored CRM runs. Real adapter runtime behavior has not been accepted. No CRM writer was changed.

PII minimization removes common email, phone, numeric identifier, secret and URL patterns, aliases staff/messages and shifts outbound conversation timestamps. This is not a complete PII detector; names, addresses and re-identification need additional review before real-data outbound. Arbitrary imported samples are user-attested, not server-proven synthetic, and cannot bypass the separate real-data outbound gate.

## Configuration (names only; no secret values in this document)

| Variable | Default / purpose |
|---|---|
| `AI_QC_ENABLED` | false; backend development registration only |
| `VITE_AI_QC_ENABLED` | false; development UI integration only |
| `AI_QC_REAL_API_ENABLED` | false |
| `AI_QC_REAL_DATA_ENABLED` | false |
| `AI_QC_OUTBOUND_TEST_APPROVED` | false; additional explicit outbound guard |
| `AI_QC_REAL_DATA_OUTBOUND_APPROVED` | false; separate real-data permission |
| `OPENAI_API_KEY` | ENV/secure injection only; never sent to browser or saved in DB |
| `OPENAI_MODEL` | optional server default; admin model setting overrides |
| `AI_QC_MODEL_CAPABILITIES` | server-reviewed JSON map: model ID -> `{responses:true,structuredOutputs:true}`; no model ID is hardcoded |
| `AI_QC_STORAGE` | `memory` (ephemeral) or explicit `postgres-sandbox` |
| `AI_QC_SANDBOX_DATABASE_URL` | separate loopback database named `ai_qc_sandbox_*`; cannot be the app database |
| `AI_QC_VAULT_ROOTS_BY_TENANT` | server-controlled map of tenant ID to absolute permitted vault roots; built-in synthetic root is allowed |
| `AI_QC_SANDBOX_MIGRATION_APPROVED` | false; required by the isolated migration script's explicit `--apply` branch |

Settings API accepts metadata, not key material. API test buttons are never called on page load. Unknown model rates produce UNKNOWN_RATE and null cost, not zero cost. Price metadata must be supplied by the operator if cost calculations are needed. Token reservations conservatively use UTF-8 input bytes plus output allowance and overhead; this is not an exact tokenizer. Failed/uncertain calls keep their reservation. Connection tests and manager calls share the same tenant budget. Rate windows are per minute; daily budget is UTC. There is no background scheduler, ingestion worker or automatic analysis.

Disabling `AI_QC_ENABLED` and restarting the development backend unregisters the API; disabling the frontend development flag hides the route/menu. Real API/data flags can remain false while mock tests run. These are backend process settings, not browser-controlled switches.

OpenAI implementation reference: [Responses API](https://developers.openai.com/api/reference/typescript/resources/responses), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). API integration is implemented, but real provider/model compatibility and real refusal/timeout behavior remain unverified until approved synthetic outbound testing.

## API and UI

All endpoints below are under `/api/v1/ai-quality-control` and authenticated:

- GET `/status`, `/workspace` (employee/from/to filters).
- PUT `/settings`; POST `/connection/test` (explicit outbound gate).
- POST `/knowledge/preview`, `/knowledge/sync`, `/knowledge/:id/publish`, `/knowledge/:id/revoke`, `/knowledge/:id/citation`.
- POST `/datasets`, `/datasets/:id/labels`, `/datasets/:id/analyze`, `/evaluate`.
- GET `/runs/:id`; POST `/runs/:id/replay`, `/runs/:id/review`; DELETE `/runs/:id` (approved retention policy, elapsed period and reason required).
- POST `/assistant` (`provider=mock` by default, explicit `openai` optional).
- GET `/crm/conversations`; POST `/crm/conversations/:id/analyze` (real-data disabled by default).

Development workflow, once the existing CRM itself has a separately isolated development database/account environment:

1. Enable only backend/frontend development UI flags; keep all real-data/API/outbound flags false. Do not start a second CRM process with inherited production `.env`, workers or credentials.
2. Log into the existing CRM with a sandbox account having QC grants; open `/ai-quality-control`.
3. In Obsidian Brain select the built-in fixture vault, preview and sync DRAFT documents. Publish the synthetic examples explicitly with the matching analysis type and a chosen effective interval. Set SLA only when intentionally approving the synthetic test value; no SLA is preapproved.
4. Create a server-generated synthetic scenario in Training Center; the simulated timeline begins after sample creation, not a claim of real elapsed time. Run Mock analysis, inspect messages/citations and replay hash.
5. Add gold labels, evaluate denominators and perform human review. Later revisions/runs can be compared by authority epoch, index and rule revision.
6. A real API connection test is a separate step after safe key injection and outbound approval. Do not use customer data for that test.

## Database and migrations

New schema: `backend/prisma/schema/native-ai-quality-control.prisma`. New migration: `20261101120000_native_ai_quality_control`. It creates only `native_ai_qc_workspace`, with tenant primary key, optimistic version, JSONB state and timestamp. No existing table or removed AI QC migration is changed. **Migration NOT APPLIED.** No production connection was made.

The development store is deliberately bounded: 1,000 document versions, 500 runs, 500 datasets, 10,000 audit entries and 8 MiB per tenant workspace. It rejects over-capacity writes rather than silently deleting evidence. PostgreSQL publication/review/evaluation/audit use a serializable transaction plus version predicate. Tests verify the transaction contract with a stub; real DB constraints/concurrency/rollback have NOT RUN. This aggregate JSON store needs a separate scale/retention review before production. It is not a replacement for production normalized history or a tamper-proof external audit store.

`node scripts/native-ai-qc-sandbox-migrate.cjs --plan` only prints the native migration ID/hash and operations. The separate `--apply` path requires explicit sandbox migration approval, a validated separate loopback target and a live database identity match. It refuses existing tables for drift review and never runs other pending migrations. **Do not run generic `prisma db push` or apply the full historical migration chain as part of this feature.** No database/container was created in this delivery.

Retention purge is explicit and limited to analysis runs/evaluations; shared approved knowledge and label/audit history are not automatically deleted. Organization-wide erasure, expired mapping deletion and backup erasure remain unimplemented and block real-data rollout. No raw PII mapping is persisted for outbound aliases; message/run identity mapping stays local to the request/evidence store.

## Verification and rollback

Run isolated suites with:

```powershell
node scripts/run-native-ai-qc-tests.cjs
node scripts/run-native-ai-qc-tests.cjs --frontend
```

The runner creates a scrubbed environment from a small OS-variable allowlist, uses a dummy unreachable database target, does not load dotenv, loads no app/bootstrap/CRM adapter and replaces HTTP/HTTPS/TCP/TLS/UDP/DNS/fetch with deny stubs in the test process. API tests use Fastify injection, MemoryWorkspaceRepository and synthetic auth actors. The default backend Vitest config excludes this dedicated suite; direct execution without its scrubbed runner fails closed. This is test-process isolation evidence, not proof of host firewall/container isolation.

Backend: 76/76 PASS. Frontend SSR: 5/5 PASS, including ten tabs, no automatic real data requests, unavailable states, HTML escaping and API failure. SSR lifecycle is adapted to await the normal loader; it is not a browser click/E2E test. Backend/frontend production builds and Prisma validation PASS; the frontend existing large-chunk warning remains. Production output has no QC route chunk. No browser screenshots were captured.

Initial backend run was 62 PASS / 2 FAIL. One test could not create a Windows file symlink without OS privilege; the final test uses a permitted Windows junction and verifies its rejection. The other found bot/human timestamps causing an eligible KPI turn to be excluded; bot/system events now cannot create that ambiguity. The initial JSON report is retained separately.

Static impact: app registration -> development bootstrap -> QC routes -> isolated services/repository. Frontend development menu -> RBAC route -> dashboard -> existing authenticated Axios instance -> QC endpoints. Existing message/order/BotAuto writers, production router registrations, Cloudflare configuration, real `.env` and current security patch files are not edited by the native module. Shared impact is limited to app's guarded registration, RBAC resource catalog, frontend guarded route/menu and permission label, SDK dependency/lock and the default test config exclusion for the dedicated native suite. Full unrelated CRM regression tests were not run.

Rollback for this uncommitted delivery: turn off the development flags, preserve a new working-tree backup, then review only the native paths and compare existing integration files with the baseline copies. Do not reset the repository, overwrite current security fixes or drop any database table. A future applied sandbox table requires its own data retention/removal decision; no automatic drop is included.

## Remaining delivery gates

- PostgreSQL integration: NOT RUN; requires a proven disposable database and explicit migration/test scope.
- Full CRM development/browser workflow: NOT RUN; requires isolated existing CRM auth/database/runtime setup. Do not use the currently running production container as a test target.
- Real CRM adapter, real vault and OpenAI calls: NOT RUN; separate opt-in and evidence required. Common-pattern PII redaction alone is insufficient for real-data authorization.
- Purchase/assignment-history/calendar/coverage adapters: unavailable in current repository, not fabricated.
- Production deploy/runtime, employee scoring and violation confirmation: DISABLED / NOT AUTHORIZED.
- G1–G10 remain NO-GO. No old Sprint acceptance or new operational gate is closed by this delivery.
