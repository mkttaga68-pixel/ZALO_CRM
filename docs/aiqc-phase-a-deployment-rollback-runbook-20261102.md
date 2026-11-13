# AIQC Phase A deployment / rollback runbook (review only)

## Intended state

Phase A keeps the dashboard artifact in the already deployed immutable image but disables all AIQC analysis, Ollama, OpenAI, real-data reads, monitoring, and manual analysis. No Obsidian vault is mounted because every local policy remains DRAFT/UNASSIGNED. The pinned image is the current production image `zl-crm-app@sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`; the exact image booted successfully against the isolated restore copy with AI flags OFF.

This is a configuration-only review artifact, not a deployable release approval. The image has no verified source commit/build attestation, and the current working tree contains 261 changed/untracked file paths. Do not build from that tree or apply this runbook until the source/release review is complete.

Manifest: `docker-compose.ai-qc-phase-a.pinned.review.yml`.

## Pre-deploy gates

1. Obtain a maintenance window and explicit restart authorization. Confirm a single-app interruption is acceptable; do not restart database, MinIO, storage-init, or other CRM services.
2. At the start of the window, rerun read-only Zalo account/session and durable queue/callback counts. The 2026-11-02 snapshot showed seven archived accounts, no stored Zalo sessions, no automation task in a running/pending state, no Chao-hang jobs/results, and no Redis container. A fresh check is required because these values can change.
3. Confirm a new protected backup exists, checksum matches the approved manifest, restore test is recent, and rollback image is present locally. Current verified DB backup: `C:\ProgramData\ZaloCRM\AIQC\backups\aiqc-prod-preflight-20261102T101049Z-pg16.dump`, SHA-256 `36d56fb46123c3e2d1b2fe3d85b0b26417cc9f2d5820277ffbaa86cb122d2616`. Configuration snapshot with `.env` and container spec is under `C:\ProgramData\ZaloCRM\AIQC\configs\preflight-20261102` with ACL restricted to the operator, Administrators, and SYSTEM.
4. Verify the `20261101120000_native_ai_quality_control` migration remains applied and its checksum matches the source migration. Do not run `db push` or migrations during Phase A. The optional monitoring migration is not applied and monitoring stays disabled.
5. Confirm the review overlay renders valid Compose configuration and its effective app flags are all `false`; preserve the three active Compose files and their order. Ensure the immutable image resolves to the pinned digest and no build stanza is present.
6. Keep `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN` unmounted until the tenant administrator publishes approved revisions with tenant, ACL, and effectivity. No DRAFT/UNASSIGNED rule is eligible for inference.

## Commands for the approved maintenance window

First render-check without printing secrets:

```powershell
docker compose -p zl-crm `
  -f docker-compose.yml `
  -f docker-compose.override.yml `
  -f docker-compose.ai-qc.yml `
  -f docker-compose.ai-qc-phase-a.pinned.review.yml `
  config --quiet
```

After explicit maintenance/restart authorization and all gates pass, recreate only the app service:

```powershell
docker compose -p zl-crm `
  -f docker-compose.yml `
  -f docker-compose.override.yml `
  -f docker-compose.ai-qc.yml `
  -f docker-compose.ai-qc-phase-a.pinned.review.yml `
  up -d --no-deps app
```

Do not run either command in this document until those conditions are approved. Do not run `down`, do not omit `--no-deps`, do not run migrations, and do not change Cloudflare or Ollama listener bindings.

## Post-deploy smoke checks

- Confirm `zalo-crm-app` uses the pinned digest and reaches Docker `healthy`.
- `GET /health` returns `200` and `db=connected`.
- An unauthenticated AIQC status request is denied by auth; an authorized AIQC request returns `503 AI_QC_DISABLED`.
- Confirm runtime environment has `AI_QC_ENABLED=false`, `AI_QC_OLLAMA_ENABLED=false`, `AI_QC_REAL_DATA_ENABLED=false`, `AI_QC_AUTO_MONITOR_ENABLED=false`, all outbound/manual flags false, and `AI_QC_OPENAI_REMOVED=true`.
- Confirm no new AIQC workspace observations, no Ollama request, and no change in pending CRM jobs. Keep the AIQC dashboard hidden from users without explicit RBAC grant.
- If any CRM health/login/chat/media smoke fails, stop the rollout and execute the rollback procedure below. Preserve the failure evidence.

## Rollback procedure

Rollback is also a controlled app-only recreation, never a production database restore. The verified rollback image is the current immutable digest above. Use the active Compose files plus `docker-compose.obsidian.rollback.review.yml`, which pins that digest and keeps AI/data/outbound flags OFF:

```powershell
docker compose -p zl-crm `
  -f docker-compose.yml `
  -f docker-compose.override.yml `
  -f docker-compose.ai-qc.yml `
  -f docker-compose.obsidian.rollback.review.yml `
  up -d --no-deps app
```

Then repeat health, login, customer-chat, media, session, and queue checks. If the pinned image cannot start or data compatibility is in doubt, keep AIQC off and escalate; do not restore the production database as an ad hoc rollback. The rollback simulation passed only for a disposable isolated PostgreSQL restore and does not prove a production interruption/recovery window.

## Approval still required

- Maintenance window and production app restart.
- Authorized source/release review and image provenance attestation.
- Dashboard RBAC grants for named tenant administrators through the normal access governance process.
- Obsidian policy approval, tenant/ACL/effectivity, and Registry publication by the tenant administrator.
- A separate future synthetic Ollama resource/load gate on a production-equivalent isolated host before any phase enabling Ollama.
