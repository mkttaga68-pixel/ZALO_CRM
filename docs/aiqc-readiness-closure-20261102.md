# Final production readiness closure — 2026-11-02

This report supersedes the implementation-gap statements in `obsidian-final-deployment-gates-20261102.md`; it does not change historical test evidence. **Recommendation remains NO-GO for production execution.** No restart/deploy, production database write, real customer read, auto-monitoring activation or Cloudflare change occurred. Real OpenAI requests in this task: **0**.

## A. Revision image — READY as isolated candidate, release-source approval pending

Verified baseline: Docker context desktop-linux, Compose project zl-crm, service app, container zalo-crm-app. Production ID `928c614f7c09ffad354a17efd4f384d249e56ddf193aee2eb1322d480e5a9f03`, image `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`, StartedAt `2026-11-01T09:31:11.772638502Z`. It was not replaced or retagged.

Built local candidate with network disabled and no dependency download:

- Tag: `zl-crm-app:obsidian-readiness-20261102-3153449f88`
- Image ID: `sha256:5e4283c273552a4fa92e5b00d0f35bcae63967633d4744158389fd9dcbe5e42a`
- Docker-reported digest reference: `zl-crm-app@sha256:5e4283c273552a4fa92e5b00d0f35bcae63967633d4744158389fd9dcbe5e42a`

This is a local image artifact, not a claim that it was pushed/published. It derives from the verified existing image and copies only compiled `analysis`, `knowledge`, `providers`, `training`, new `openai-control`, and one explicit operator initialization CLI. It inherits the app entrypoint, static frontend, SDK 7.47.0, shared helpers and all unrelated CRM modules. Monitoring bootstrap is inherited; the new sandbox monitoring implementation is not activated/copied into this candidate. No production router/menu, message writer, schema or migration changed.

HEAD is `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`. QC source remains uncommitted/untracked in the existing working tree; the revision fix is **not claimed to be in a canonical release commit**. `candidate-image.json` records the parent HEAD and SHA-256 for every patched source/compiled file; the same manifest is embedded in the image. A scoped source review/commit/release decision remains outstanding. Existing unrelated changes were not reset or bundled into the image.

Actual candidate tests verify old revision unchanged after future publication, APPROVED/published-but-scheduled revision, before/exact/after transition, historical lookup, scheduled revocation cancellation, effective revocation exclusion, tenant isolation, valid citation and immutable evidence replay. Host regressions also cover overlap/concurrency/timezone and other revision cases.

Evidence root for this phase: `C:\Zalo CRM\aiqc-readiness-closure-20261102`. Files: `candidate-image.json`, `image-build.log`, `candidate-test-results.json`, `candidate-test.log`, per-context manifest/Dockerfile/patch files. Image tests verify the embedded compiled hashes.

## B. OpenAI model and secret readiness

Project: owner-confirmed Default project, `proj_6yDB6qP8X45ofaQO99BW2Bqy`. Model: `gpt-6-luna`; no fallback/substitution. Official OpenAI Docs confirms Responses and Structured Outputs. Actual project/key/model authorization remains **BLOCKED/NOT_RUN**; documentation and mocked SDK serialization are not authenticated access evidence. No GET models/admin endpoint calls were made.

Implemented in the existing provider, not a second provider:

- `OPENAI_API_KEY_FILE` backend-only loader rejects invalid, linked, oversized or unavailable files without echoing contents. Missing secret does not break Mock administration/status; actual key use still fails closed.
- Default SDK client always uses controlled transport, maxRetries=0, 15-second timeout and SDK logs OFF. Existing provider adds at most one short 429 retry; every dispatched attempt is independently budgeted.
- Exact destination POST `https://api.openai.com/v1/responses`, forced project header and Standard service tier. Redirects, extra request features/tools/streaming, wrong models/projects and real conversation sources are rejected. Reuses the existing public-DNS validation/IP-pinning/TLS/response-size helper, whose image code was verified identical to source. No global fetch/network changes to CRM.
- Approved retrieval/citation/current-ACL checks stay in existing services. Actual API analysis and connection-test actors are restricted to the configured ASLAN organization; default real client additionally requires that exact organization, project and controlled configuration. Manager-schema calls are intentionally not authorized by this synthetic-analysis transport.

Prepared `scripts/prepare-aiqc-project-secret.ps1`:

- `Store` (default): masked local prompt, CurrentUser DPAPI ciphertext outside the repository, ACL limited to current user/SYSTEM. No app/container/API operation. Refuses overwriting an existing secret.
- `InjectAfterMaintenance`: refuses the currently deployed old image; requires the exact reviewed candidate, correct project and disabled real-data/monitoring scope. Sends the decrypted key through process stdin into a 0400 file on verified container tmpfs. No key in arguments/environment/logs, no API call or flag change. The key disappears after container recreation and must be injected again.

Secret script syntax and loader behavior were checked. **No real key was entered, stored or injected; the real secret workflow is NOT_RUN.** There is no claim that the current container can read a valid secret. It remains unchanged with no OpenAI key/project runtime configuration. Source scripts contain no real key.

## C. Budget enforcement — IMPLEMENTED and TESTED in Sandbox, not enabled in production

New durable project ledger and policy under a dedicated control directory:

| Control | Enforcement |
| --- | --- |
| Daily USD ceiling | At most 2 USD in reserved upper bounds per Asia/Ho_Chi_Minh calendar day |
| Monthly USD ceiling | At most 30 USD per local calendar month |
| Concurrency | One OPEN attempt per shared project ledger |
| Rate | At most 5 attempts/minute; policy can lower it |
| Token budget | At most 50,000 conservative serialized-byte/output/overhead reservation units per day; existing per-tenant rate/token gates also apply |
| Request bounds | Body ≤65,536 bytes, max output 256–4096 tokens, no tool/stream/background/fast-tier requests |
| Kill switch | DISABLED/missing enabled marker or enabled=false policy stops new dispatch without restart; existing in-flight request is not retroactively unsent |
| Persistence | Atomic exclusive directory lock, fsync/rename ledger, no automatic reset/refund; shared local Docker volume across app recreation |

All callers of the default real SDK client go through the transport, including connection tests. Tests use injected stubs only. A manager call is blocked rather than bypassing its scope. ASLAN-only actor authorization is tested before provider dispatch. Daily/monthly money checks happen before the network transport, with integer nano-USD arithmetic.

Reservation deliberately assumes the full documented 1,050,000-token context at conservative upper-bound rates of $0.50/million input and $1/million output, ignoring discounts. At 256–4096 output tokens this holds **$0.525256–$0.529096 per dispatch**. These are safety reserves, NOT reported actual charges. Reservations are never automatically refunded, even after success, authentication errors, timeout, invalid output or ambiguous outcome. This may stop much earlier than real spend: no more than three such reservations fit in the daily cap. Each retry consumes another reservation. Normal per-tenant token budgets can reject sooner.

Actual API usage tokens, when returned, are recorded separately from the reserved amount. Ledger `estimatedNano` is a conservative token-based estimate, not an invoice total. Existing per-run costUsd is settings-based or UNKNOWN_RATE and is not trusted for enforcement. No actual usage/cost response exists in this task; all SDK responses in tests are synthetic. Zero real requests were dispatched; project-wide existing spend is UNKNOWN.

Unknown charges carry into future periods. Midnight-crossing completions count toward both periods. Persisted OPEN entries after a process crash fail closed rather than silently freeing capacity; abandoned locks, corrupt/missing ledger, unknown settings, clock rollback or invalid usage block dispatch. Recovery needs operator investigation, not deletion/reset of the ledger. This trades availability for the approved spending ceiling.

Policy initialization is explicit and defaults DISABLED; app startup never creates or resets a ledger. `initialize-aiqc-openai-control.cjs --initialize-disabled <absolute-new-directory>` refuses an existing directory. In the proposed volume, the directory is `/var/lib/zalo-crm/aiqc-openai-control/project` (a new child of the mounted volume, not the mount root). After separate authorization, the operator must initialize that child, review policy and explicitly enable it. No initializer/kill-switch command was run in production.

Platform billing is independent: no authenticated Platform management access was available and only Responses POST egress was authorized. The project's 30 USD monthly hard limit/alerts remain **NOT_CONFIGURED/NOT_VERIFIED by this task**. OpenAI documents enforcement delay; the backend reserve gate remains required. The ledger controls this CRM's requests on one shared Docker-host volume, not unrelated workloads using Default project. Confirm external project usage/isolation and Platform limits before representing the cap as project-wide. Revalidate applicable pricing/capability information before a real API test.

## D. Zalo session recovery

Checklist created at `docs/aiqc-zalo-restart-checklist-20261102.md`, with pre/post steps, rollback triggers and explicit recovery risks.

In-memory event bus/setImmediate work and interval callbacks are not a durable drain. Clearing message-sync intervals does not wait for work already running. Committed messages/saved sessions persist in the untouched DB, but this does not guarantee completion of pending sends, media mirroring or post-commit automation. Existing SDK saved-session reconnect, backoff and backfill are available; real session restoration/reconciliation was **NOT_RUN**. No customer body, pending-send queue or session credential was inspected. No zero-loss promise is made. If zero loss is mandatory, durable drain/outbox verification remains a separate implementation/acceptance gate; no writer was altered here.

Preserve JWT_SECRET/ENCRYPTION_KEY and volumes. Schedule quiet operation, verify pending work through approved operator views, allow graceful shutdown and reconcile ambiguous sends without blind retries. Rollback cannot recreate lost in-memory events.

## E. Sandbox evidence and test results

| Suite/check | Actual result |
| --- | --- |
| Native QC regressions | 117 PASS |
| New OpenAI control tests | 32 PASS |
| Existing synthetic monitoring regressions | 19 PASS (mock only) |
| Backend TypeScript compile | PASS, isolated output directory |
| Final candidate image checks | 22 PASS on exact final digest |
| Candidate Vault filesystem | 22 Markdown files; read-only/write-handle denial, hash match, host unchanged PASS |
| Full CRM startup against synthetic database | NOT_RUN in this image phase |
| Real production JWT/password/Zalo recovery | NOT_RUN |
| Browser E2E on final candidate | NOT_RUN; prior synthetic browser evidence is historical, not transferred to this image |
| Real OpenAI model/project/API analysis | NOT_RUN |

Latest source suite: `tests-1793583889407/results.json` and execution.log. Monitoring: `tests-1793556372689/monitoring-results.json`. Image checks exercise actual compiled modules, in-memory synthetic registry and mock analysis, Fastify injection with synthetic authentication, two independent child processes sharing tmpfs ledger, crashed-process OPEN reservation and kill switch. They do not start the production app or validate real JWT login. Candidate filesystem-only Vault test does not sync/approve real documents.

All test runners scrub inherited secrets and use dedicated network-denying setup; candidate containers use network none/read-only filesystem with /tmp tmpfs and no CRM database/volume mounts. The Vault-only test mounts precisely the owner-approved Vault read-only. No documents were approved outside synthetic in-memory fixtures. Earlier harness DB-name assertion and TypeScript narrowing errors were corrected and rerun; final executed suites above pass. Logs of earlier attempts are retained in separate test directories.

## F. Exact production diff — PREPARED, NOT_APPLIED

`docker-compose.obsidian.closure.review.yml` is the final prepared overlay. Merge last after the currently active base/override/ai-qc files, under project zl-crm. It pins the final digest and never pulls automatically. Rendered sanitized diff: `production-compose-diff.json` in the evidence root.

- Exact Vault bind `/knowledge/obsidian`, read_only=true, create_host_path=false; only ASLAN UUID allowlisted.
- Preserve existing file_storage volume; add a dedicated named `aiqc_openai_control` volume for ledger/policy. Do not delete that volume in rollback.
- Add private noexec/nosuid 16-KiB tmpfs `/run/secrets`; no host plaintext key file or key environment variable.
- Configure project/model/ASLAN scope, model capabilities, backend secret path and control-directory path. These values do not enable API access or approve documents.
- QC_ENABLED, REAL_API_ENABLED, OUTBOUND_TEST_APPROVED, REAL_DATA_ENABLED, REAL_DATA_OUTBOUND_APPROVED and AUTO_MONITOR_ENABLED are all false. Image defaults and policy are also OFF. Any later enabling decision must be explicit.
- PostgreSQL, MinIO and backup service definitions are unchanged. No new volume was created or mounted in production.

The reviewed diff will set production's currently observed REAL_DATA_ENABLED=true to false when, and only when, it is separately applied. It has not been changed now. This task did not read or process real customer data; normal existing CRM activity was not stopped.

Configuration backup references remain `obsidian-production-preflight-20261102/config-backup-verification.json` and `rollback-config-verification.json`: DPAPI roundtrip, restored file hashes, Compose environment/volume replay and local old-image checks PASS. Actual DB restore and live rollback remain NOT_RUN. Use the original three files plus `docker-compose.obsidian.rollback.review.yml`, excluding all new activation overlays, for app-only rollback to the old pinned image with QC/API/data/monitoring OFF. Preserve DB, file_storage and budget volumes. Current private database backup/restore freshness still requires operator verification; this task did not read a new customer-data dump.

## G. Exact remaining blockers

1. A valid project-scoped key has not been supplied via the masked secret mechanism. Default project's authenticated model/schema access, actual Responses usage/cost and Obsidian synthetic citation output remain untested. No model substitution is permitted.
2. Platform monthly hard limit/alerts and Default project's other workload usage are unverified. The local CRM gate is tested; it is not remote billing configuration.
3. Candidate modules pass isolated tests, but full CRM startup/login/browser acceptance against an isolated synthetic database is not proven for this derivative image. Static frontend/entrypoint are inherited; no new production frontend build is claimed.
4. Patch source is still uncommitted; the source-hash manifest is reviewable but not a canonical release commit. Source/release approval remains required.
5. Fresh private DB backup/restore, pending-work/quiet-state acceptance and Zalo recovery readiness require approved operational verification. No durable zero-loss drain has been established.
6. Final app-only maintenance/restart approval is explicitly withheld. No autonomous deployment is scheduled.

## H. GO / NO-GO

**Keep NO-GO.** The revision image, controlled-client code, USD reserve mechanism, secret tooling, read-only Vault evidence and default-OFF Compose diff are concrete and tested within their stated sandbox limits. This is not sufficient evidence to enable production API/data or restart the service.

Proposed maintenance remains **03/11/2026 00:30–00:45 Asia/Ho_Chi_Minh (UTC+07)**. Cancel/defer if gates are incomplete. Expected HTTP interruption 1–3 minutes is an estimate; Socket.IO/Zalo can take longer. Final approval must reference the immutable image/diff and operational checklist, not merely the proposed time. No timed job has been created.

## I. Single next action

Operator runs **Store only** in a local PowerShell terminal and enters the project key at the hidden prompt:

```powershell
powershell -NoProfile -File "C:\Zalo CRM\ZL-CRM\scripts\prepare-aiqc-project-secret.ps1" -Action Store
```

Do not paste the key in chat or run InjectAfterMaintenance now. Store creates only DPAPI ciphertext outside the repository and makes no container/API call. Report only that Store completed. Validating the credential/model with a controlled synthetic request remains conditional on verified Platform/network/budget scope; Store success alone is not API success or permission to restart.

## Files changed in this closure

Existing source patched: `backend/src/modules/ai-quality-control/providers.ts`, `analysis.ts`. New runtime module: `openai-control.ts`. Existing revision `knowledge.ts` and `training.ts` were reused in the candidate, not rewritten in this turn.

New tests/config: `backend/tests/openai-control.test.ts`, `backend/vitest.openai-control.config.ts`. New scripts: `run-openai-control-tests.cjs`, `build-aiqc-readiness-candidate.cjs`, `test-aiqc-readiness-candidate.cjs`, `verify-aiqc-candidate.mjs`, `verify-aiqc-candidate-vault.cjs`, `initialize-aiqc-openai-control.cjs`, `prepare-aiqc-project-secret.ps1`. New final overlay and two readiness/checklist documents. No migration, shared helper, production writer/router/menu, dependency/lockfile or Cloudflare file was edited.

AGENTS.md impact analysis was run before existing method edits. OpenAIProvider MEDIUM (6 direct uses), request LOW (2); analyzer/testConnection CRITICAL through broad graph flows was explicitly warned before adding tenant checks. New symbols returned UNKNOWN; source callers and actual tests were used to establish their bounded scope. Provider status had UNKNOWN graph edges; route callers were inspected directly. No commit was made.

Official references checked through OpenAI Docs:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/spend-limits

No live API PASS, production mount, actual billing total, full-image browser PASS or lossless Zalo restart is claimed.
