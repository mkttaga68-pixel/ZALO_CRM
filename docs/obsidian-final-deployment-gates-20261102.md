# ASLAN GLOBAL — deployment decision review, 2026-11-02

Decision: NO-GO at present. The owner confirmed organization and API project, but explicitly withheld production restart permission. No service was restarted, no overlay applied, no AI request dispatched, no customer messages read and no automatic monitoring activated. Cloudflare is unchanged.

## Confirmed scope

- CRM organization: ASLAN GLOBAL, `a236afea-cc9c-4de8-81c0-ee5923385b2e`. The previous exact-account read-only lookup returned active owner access. The owner has now explicitly confirmed the Vault allocation; no additional tenant is allowed.
- Vault source: `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN`; target `/knowledge/obsidian`, read-only, no auto-created host path.
- OpenAI project supplied by owner: Default project, `proj_6yDB6qP8X45ofaQO99BW2Bqy`. Status OWNER_CONFIRMED, not authenticated/verified against OpenAI. A project ID's syntax or existence in chat does not prove current key access or billing configuration.
- Model: `gpt-6-luna`, no substitution. Only synthetic conversations and approved, effective, tenant-authorized retrieved knowledge excerpts may leave the backend via POST `https://api.openai.com/v1/responses`. Never the whole Vault, DRAFT/REVOKED rules, real employee/customer data, models-list or admin endpoint calls.
- Budget: 2 USD/day and 30 USD/month; these requirements are NOT yet enforced/configured in the running backend or verified on Platform.

## Checks performed in this turn

| Check | Actual result |
| --- | --- |
| Docker target | PASS: context desktop-linux, project zl-crm, service app, container zalo-crm-app, port 3080→3000 |
| Container identity | Unchanged: `928c614f7c09ffad354a17efd4f384d249e56ddf193aee2eb1322d480e5a9f03` |
| Image | `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`, tag zl-crm-app:ai-qc-shared-20261101 |
| App startup time | Unchanged: 2026-11-01T09:31:11.772638502Z |
| Pre-change health | PASS: HTTP 200, status ok, db connected; app and PostgreSQL Docker health healthy |
| Active Compose files | docker-compose.yml, docker-compose.override.yml, docker-compose.ai-qc.yml, in that order |
| Production Vault mount | NOT_CONFIGURED. Only persistent file_storage is currently mounted into app |
| Proposed ASLAN overlay | PASS render-only: exact Vault/source/target, read_only=true, create_host_path=false, exact single-org allowlist |
| Other services | Rendered candidate/rollback leave PostgreSQL, MinIO and backup service definitions unchanged |
| Configuration backup | PASS: current three Compose files, .env, resolved config, runtime environment/mounts captured as CurrentUser DPAPI ciphertext |
| Backup recovery | PASS: decrypt in RAM, byte/hash comparison, Compose re-render, app environment and volume semantics preserved |
| Rollback image | PASS: available locally; entrypoint JS passes syntax check in ephemeral read-only, network-none container |
| Actual rollback/startup | NOT_RUN. This is not a claim of a full restored CRM/database boot |
| PostgreSQL/customer changes | No task-issued database connections/writes, schema changes or customer queries in this turn; database container not restarted |
| OpenAI key/project in runtime | Absent; no /run/secrets mount. No key decrypted or printed |
| Live API requests | 0. Model returned: unavailable; usage/cost from an API response: NOT_RUN |
| Post-restart health | NOT_RUN, because restart was not permitted |

Backup evidence is at `C:\Zalo CRM\obsidian-production-preflight-20261102\config-backup-verification.json`. The private backup location is referenced there; its directory ACL is restricted to the current Windows user and SYSTEM. It is Windows-account-bound, not a portable disaster-recovery backup. Config values never appear in the public report. No plaintext recovery files were written.

Additional evidence: `rollback-config-verification.json`, `aslan-compose-review.json`, `health-before.json`, `openai-controlled-test-status.json`. Earlier filesystem-only verification of the exact production image successfully read 22 Markdown documents, denied a write handle and matched unchanged host/container SHA-256; production itself remains unmounted. See `obsidian-production-preflight-20261101/vault-readonly.json`. No document was approved or published by this task.

The first rollback harness attempts failed on Windows stdin encoding and a JSON-property-order volume comparison. They were corrected using UTF-8 bytes, --no-interpolate and semantic volume comparison, then rerun successfully. These were verification-tool defects, not evidence of an actual production rollback or secret failure.

## Message queues and Zalo sessions

The app is shared by the CRM; a tenant-scoped Vault does not restrict restart interruption to that tenant. SIGTERM stops Zalo listeners/message sync, closes Fastify and forces exit after 8 seconds. HTTP/Socket.IO disconnect; clients reconnect. JWT_SECRET is configured and must be preserved, along with ENCRYPTION_KEY and the database. No JWT rotation, logout or Zalo session mutation was performed.

Committed messages and saved credentials remain on the existing database volume. However, the automation event bus is in-memory/setImmediate, and message persistence followed by async automation is not one durable drain/transactional-outbox operation. Pending in-memory events or in-flight work can be interrupted. A lossless queue/session restart guarantee has NOT been established. Do not represent existing reconnect/backfill as complete recovery for every message/side effect. No production Zalo/network test or customer-content inspection was run.

Before maintenance, require a quiet interval and operator confirmation that sends/uploads/jobs have settled, use graceful SIGTERM rather than kill, and preserve credentials/volumes/secrets. Afterward check connection statuses without exposing credentials or reading message bodies; if reconnection fails, restore the pinned image/config first and let an authorized operator handle saved-session reconnect or QR login. Reconcile interrupted sends through the authorized CRM workflow; do not blindly resend because a network timeout can follow a successful send. Durable drain/ingestion improvements would require a separately reviewed writer/lifecycle change. If strict zero-loss is mandatory, this gap blocks deployment until such a mechanism is verified.

## Prepared change and rollback

`docker-compose.obsidian.aslan.review.yml` is new and NOT_APPLIED. It adds the exact binding/allowlist, leaves QC available for synthetic administration, and sets REAL_DATA_ENABLED, REAL_DATA_OUTBOUND_APPROVED, REAL_API_ENABLED, OUTBOUND_TEST_APPROVED and AUTO_MONITOR_ENABLED false. It requires an explicitly supplied immutable candidate image. It does not contain an API key or unsupported budget variables. Compose syntax was rendered using the current pinned image only to validate the file; that image is not represented as the fixed release candidate.

The current production knowledge/analyzer files differ from the local tested revision patch. Build/validate a scoped immutable candidate with that fix before applying the proposed overlay. Do not bundle unrelated working-tree changes. No build, migration or image download occurred here.

`docker-compose.obsidian.rollback.review.yml` is new and NOT_APPLIED. Merge after the ORIGINAL three active files, excluding the Vault overlay. It pins the current image and keeps QC/API/real-data/monitoring OFF. That removes the new binding by using the pre-mount base configuration, preserves file_storage and avoids restoring the older real-data read flag. Do not run down, down -v or restart unrelated services. The rollback file was render-checked, but no actual app rollback was performed.

Before a maintenance execution, compare the final candidate/config against the encrypted snapshot and validate health, backup freshness and recovery. This turn backs up configuration, not customer data. A fresh database backup/isolated restore remains a prerequisite for the final release decision; do not claim that the configuration DPAPI test verifies database recovery.

## OpenAI readiness and actual test result

Official OpenAI Docs confirms Responses and Structured Outputs for gpt-6-luna; this is a documented model capability, not proof that Default project has access. Existing provider uses Responses, store:false, strict schema validation and bounded timeout/retry. Current container lacks key/project configuration and the container-compatible secret bridge is not implemented. Do not put a key in environment files/source/Compose or reuse Windows DPAPI as if Linux could decrypt it. Prepare a backend secret-manager/file mechanism with masked local entry; never ask for key text in chat.

Current budget logic is token/rate based, not a USD hard stop. Before any real request, implement and regression-test a durable project-wide cost ledger with atomic pre-dispatch reservations, concurrency/retry accounting, uncertain-charge retention, restart persistence, day/month boundaries and fail-closed unknown model/pricing/usage. Enforce the 2/30 ceilings across connection tests, analyses, manager/training paths and all permitted tenants sharing the project. A per-tenant counter or a final usage estimate does not establish the requested cap. No claim is made that these tests have run; the USD mechanism is NOT_IMPLEMENTED in the current provider.

Set and independently verify 30 USD monthly hard limit on the correct OpenAI project, with early alerts. OpenAI documents that hard-limit enforcement can lag slightly; application reservations remain needed for the owner's strict dispatch budget. Platform management access is not connected, so no project/billing settings were changed or verified. Default project can have other workloads; app-local accounting cannot silently assert knowledge of their charges. Confirm isolated key usage/project workload accounting before representing the backend limit as a project-wide spending guarantee.

The existing native-sandbox guarded fetch is not proof of production enforcement. Validate the container-compatible provider egress path, TLS/DNS/redirect controls and approved synthetic/knowledge contract without changing ordinary CRM Zalo routing or Cloudflare. Only Responses POST is authorized; no GET models or administrative project calls were sent. No secret or paid API call is required for the checks completed here.

Therefore model/project availability test, Responses connection test, approved UX-001 analysis, usage/cost/citation and Dashboard result are all NOT_RUN. Zero requests were dispatched by this task; project-wide historical spend is UNKNOWN. Do not fabricate a successful response or change to another model. API testing remains blocked by missing secret integration, enforced budgets, project/Platform verification and verified egress, plus the separate runtime maintenance decision.

## Proposed window and final decision

Proposed start: **2026-11-03 00:30:00 Asia/Ho_Chi_Minh (UTC+07:00)**.

Proposed end: **2026-11-03 00:45:00 Asia/Ho_Chi_Minh (UTC+07:00)**.

This is a proposal, not a scheduled job or authorization. Expected HTTP outage 1–3 minutes is an estimate; Zalo reconnection may take longer. If prerequisites are still missing before the start, cancel/defer rather than enter the window. No autonomous timed deployment is configured.

Suggested execution gates once technically ready: before 00:30 verify fresh backup/recovery, candidate, scoped diff, operator quiet-state and rollback; at 00:30 recreate app only with --no-deps --no-build; by 00:33 require health/auth/storage/mount/ACL checks; initiate rollback on failed checks instead of enabling APIs; use the remaining window for operator Zalo/Socket verification. Never mark post-restart checks PASS beforehand. A mount-only decision must remain separate from permission to flip the OpenAI flags.

Do not ask for unconditional deployment approval yet. Complete the missing scoped candidate, backup/queue-risk acceptance and API safety gates, then present the immutable image/diff/evidence and exact window for the owner's final decision. ASLAN's organization and OpenAI project's supplied identifiers do not need to be requested again.

References:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/spend-limits

Files added this turn: two scripts for encrypted config backup and offline rollback verification, two review-only Compose overlays and this report. Existing production files/code were not changed. No commit was made.
