# Obsidian + OpenAI production preflight — 2026-11-01

Checked at 21:12–21:14 Asia/Bangkok. Status: BLOCKED before production mutation. This report supersedes assumptions in older sandbox notes; it does not mark old tests as tests of the deployed image.

## A. Production preflight result

Read AGENTS.md and the connector, activation overlays, revision, monitoring, browser and prior release reports. HEAD: `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`. Working tree contains existing tracked changes and untracked QC code; none were reset or overwritten. No runtime symbol was patched in this preflight.

Docker context `desktop-linux`; Compose project `zl-crm`, service `app`, container `zalo-crm-app`, published port 3080 → 3000. Runtime labels identify exactly these files, in order:

1. `C:\Zalo CRM\ZL-CRM\docker-compose.yml`
2. `C:\Zalo CRM\ZL-CRM\docker-compose.override.yml`
3. `C:\Zalo CRM\ZL-CRM\docker-compose.ai-qc.yml`

Image tag `zl-crm-app:ai-qc-shared-20261101`; actual image `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`. Container `928c614f7c09ffad354a17efd4f384d249e56ddf193aee2eb1322d480e5a9f03`, StartedAt `2026-11-01T09:31:11.772638502Z`, Docker health healthy.

Production differs from the current local source. SHA-256 comparisons show compiled `knowledge.js` and `analysis.js` differ; `providers.js` matches the local compiled provider. Do not carry the scheduled-revision regression PASS across to this deployed image. Release a reviewed candidate with the revision fix before activation.

## B. Obsidian mount status

Production: NOT_CONFIGURED. Its only app mount is `zl-crm_file_storage` → `/var/lib/zalo-crm/files`. No tenant Vault allowlist is configured. Both Obsidian overlays are preparation files, not applied configuration.

TESTED separately: Windows source `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN` exists and Docker Desktop can read it at `/knowledge/obsidian`. The test used a disposable container from the exact production image with networking disabled, no database, no port, no inherited secrets, read-only root filesystem and read-only Vault mount. Production app was not recreated.

## C. Read-only and hash verification

PASS: 22 Markdown files; host/container SHA-256 match; host hashes unchanged before/after. Opening an existing mounted file with `r+` was denied. No file write was performed, no Vault was created or moved. Evidence: `C:\Zalo CRM\obsidian-production-preflight-20261101\vault-readonly.json`. The test intentionally does not approve, publish, sync or revoke any document.

## D. Knowledge registry status

Production registry content/UX-001 approval: NOT_RUN. No production workspace/database was read. A Markdown file or APPROVED front matter does not establish a published CRM revision. The authorized tenant ID and administrative account must be supplied before tenant-scoped verification.

Current source reuses existing Fastify auth and `ai_quality_control` permissions. Vault administration requires access/edit/view_all; publishing also requires approve. Retrieval applies current tenant/department ACL, publication/effective time and citation checks. Local revision tests cover before/exact/after transition, historical lookups, revocation, overlaps, tenant isolation, concurrent publication and replay. Their production applicability is blocked by image mismatch.

Prior evidence (not rerun in this preflight): backend QC 117 PASS, monitoring 19 PASS, frontend QC 7 PASS, monitoring 6 PASS, final synthetic browser E2E 16/16 PASS. Browser evidence is under `aiqc-browser-e2e-20261101/run-1793532804872`. These tests used Mock and synthetic fixtures; no production/browser/OpenAI PASS is claimed here.

## E. OpenAI connection test

Existing backend OpenAIProvider is CONFIGURED IN CODE, not ENABLED in production. It uses `responses.create`, `store:false`, strict `text.format` JSON schema plus local validation, 15-second timeout, no SDK retries and at most one short 429 retry. Rate and daily token reservations exist; defaults are 5 requests/minute and 20,000 daily budget units, max output 1,000 tokens. Reservations conservatively use serialized input byte size plus output allowance; they are not exact tokenizer counts. Usage and calculated cost are recorded only when rates are configured, otherwise UNKNOWN_RATE. Explicit daily/monthly USD hard limits are NOT_IMPLEMENTED in the inspected settings/budget gate.

Production currently has no OPENAI_API_KEY environment entry, no OPENAI_API_KEY_FILE configuration and no OPENAI_MODEL entry. No OpenAI key was opened or printed. Windows CurrentUser DPAPI launcher is native-Windows tooling, not a Docker Linux secret bridge. Container-safe secret injection must be prepared and reviewed; merely mounting a secret file will not work while the provider only reads OPENAI_API_KEY. No second provider is needed.

No authorized model, capability settings, price rates, daily/monthly dollar ceilings or specific egress authorization are established for this deployment. Required egress proposal: synthetic-only POST `https://api.openai.com/v1/responses`, approved model, `store:false`, bounded request/output, no redirects or tools, no real customer data. This proposal has NOT been activated. Connection test: NOT_RUN. Older native test documentation reports HTTP 401; it does not prove a usable production key.

Protocol reference checked through OpenAI Docs: https://developers.openai.com/api/docs/guides/structured-outputs . Application validation and citation checks remain necessary beyond schema conformance.

## F. Obsidian + OpenAI synthetic analysis

NOT_RUN. Planned inputs: customer “Sao đơn hàng của tôi chưa đến?”; staff “Hỏi mãi thế, không biết chờ à?”. Require explicitly approved, effective, tenant-authorized UX-001 before analysis; otherwise report missing rule and abstain. Require real Responses success, provider/model/usage, message references and revision/hash/byte-accurate citations, then NEEDS_REVIEW. Never confirm employee violations. No policy was approved by this task.

## G. Dashboard result

Production Obsidian/OpenAI result: NOT_RUN. Existing synthetic Mock dashboard/browser evidence is TESTED separately. Local source frontend remains at localhost:5173 with native synthetic backend 3091; production Docker remains port 3080. Port 5173 success does not prove Docker activation. Mock monitoring is synthetic-only; production ingestion is not implemented by this release and its worker cannot simply be switched to real data/OpenAI.

## H. Real data activation readiness

BLOCKED. Observed production flags: AI_QC_ENABLED=true, AI_QC_STORAGE=application, AI_QC_REAL_DATA_ENABLED=true, AI_QC_REAL_DATA_OUTBOUND_APPROVED=false, AI_QC_REAL_API_ENABLED=false, AI_QC_OUTBOUND_TEST_APPROVED=false. Monitoring flag absent (defaults OFF). This corrects the assumption that every real-data flag was already OFF. The current read flag does NOT prove data was accessed; no real customer data was read in this preflight. It has not been changed without the required maintenance window.

Before any API activation, set real-data read/outbound flags false in the approved app deployment and verify the effective runtime configuration. Live monitoring additionally needs explicit tenant/data/outbound permission, approved retention, review of PII minimization (existing regex/pseudonyms are not a proof of complete redaction), access logging, durable production ingestion, retention/capacity/load acceptance and a rollback switch. No whole-CRM scan is authorized or enabled here.

## I. Production changes and rollback

Production changes: NONE. No restart, database operation, migration, Cloudflare change or outbound AI call. Production app identity/image/StartedAt were identical before/after filesystem verification.

Rendered, unapplied Compose diff is saved at `C:\Zalo CRM\obsidian-production-preflight-20261101\compose-diff.json`. Validated using a conspicuous zero-UUID placeholder only; this is NOT an authorized tenant. Overlay `docker-compose.obsidian.activation.yml` preserves the app image and file_storage volume, adds exactly the designated read-only Vault bind with create_host_path=false, sets the tenant allowlist, AI_QC_ENABLED true→false and AI_QC_REAL_DATA_ENABLED true→false. Other services are unchanged. OpenAI flags remain false. Because this preparation overlay disables QC entirely, it is not a usable final UI/API activation overlay without a separately reviewed enabling stage. It also retains the old image, so applying it alone does not deploy the revision fix.

Database is `postgres:16-alpine`, container `zalo-crm-db`, host loopback port 5433, volume `zl-crm_pg_data`. Backup sidecar is running and mounts repository `backups` at `/backups`. A prior private release dump exists (454,056 bytes) and prior restore report exists; dump contents were not read. This does not verify a fresh backup or scheduled-backup freshness. A current backup plus isolated restore validation is required before the maintenance change; backup data must remain private.

Rollback target for THIS deployment is the current image ID above, current three-file Compose configuration, and existing persistent volume. Preserve a sanitized config diff and a private recoverable deployment snapshot; do not print secrets. Disable QC/OpenAI/real-data flags in the reviewed rollback overlay, remove the new Vault binding/allowlist if needed, recreate app only with --no-deps --no-build and the pinned existing image, then check health/auth/storage. No database rollback/drop or restart of PostgreSQL is planned. Existing native source processes are separate.

## J. Exact remaining actions

1. Owner supplies the exact organization UUID authorized for this Vault, administrative test account and a maintenance window (Asia/Bangkok). No org was guessed or extracted from customer data.
2. Select the OpenAI model, capability settings, token/rate limits, price rates and daily/monthly USD ceilings; authorize the synthetic-only egress endpoint/scope explicitly. Enter a valid key through a masked local secure mechanism, never chat/frontend/commit. Do not reuse the Windows secret as if it were already available in Docker.
3. Prepare and review a container-secret bridge and USD cost-limit gap patch, with impact analysis and sandbox regressions, reusing the existing provider. Prepare an immutable candidate image containing the verified revision fix; avoid bundling unrelated working-tree changes. No image build or dependency download was triggered here.
4. Validate candidate revision/ACL/citation regressions and approved UX-001 workflow in isolation; prepare the final image/mount/flags/secret Compose diff and current backup/restore evidence. The current overlay diff is reviewable but not ready for activation.
5. During the authorized window, recreate ONLY app using the reviewed explicit Compose files and candidate image, with real data/outbound false. Check image, mount RW=false, tenant allowlist, file hashes, health/auth/RBAC/storage. Admin syncs DRAFT and explicitly approves any needed rule; no automatic approval.
6. Only after specific egress approval and secret validation, run one synthetic Responses connection request, then the UX-001 analysis and dashboard verification. On failure keep provider Mock/API OFF and report the actual sanitized error. Live-data readiness remains a separate gate.

New files from this preflight: `scripts/preflight-obsidian-production.cjs` and this report. External evidence: `vault-readonly.json`, `compose-diff.json`. No existing code/overlay was edited and no commit was made.
