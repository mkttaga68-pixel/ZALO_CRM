# AI QC on the existing CRM backend

> Deployment update 2026-11-01: the owner subsequently authorized real CRM reads. Current local overrides enable `AI_QC_REAL_DATA_ENABLED`; provider outbound stays disabled. See [actual release record](native-ai-qc-production-release-20261101.md). Synthetic-only instructions below describe the initial release preparation.

## What changed

AI QC is now a feature of the existing Fastify backend and Vue application. It shares the existing login/JWT validation, permission groups, organization/department scope and Prisma connection. It does not require the separate development ports 3091/5174, an extra backend, a new login account or an additional database service.

After an approved release, the current frontend on 5173 can use its existing `/api` proxy to backend 3080. The deployed CRM domain uses the same `/ai-quality-control` page and backend `/api/v1/ai-quality-control/*` namespace. No Cloudflare changes are required.

`AI_QC_STORAGE=application` stores documents, datasets, runs and review/audit history in `native_ai_qc_workspace`, using the existing extended Prisma singleton and tenant primary key. Publication/review writes remain transactional and version checked. It is the same bounded development workspace model (8 MiB per organization, 500 runs, 500 datasets, 1000 document versions, 10000 audit entries); a scale/retention review remains necessary before broad use.

The module can register with NODE_ENV=production. Every handler still requires auth, RBAC and `AI_QC_ENABLED=true`. A disabled feature does not read or create QC state. Missing native table/columns returns `AI_QC_SCHEMA_NOT_READY` for the feature; configuration errors are isolated to QC handlers rather than applying a migration or starting a second server. Ordinary CRM routes/writers are unchanged.

Frontend production inclusion requires the explicit build opt-in `VITE_AI_QC_ENABLED=true`; default builds keep the page/menu out. The menu and route reuse `ai_quality_control.access`, with separate create/edit/approve/delete/view_all actions. Owners follow existing RBAC bypass rules; other groups must be granted access deliberately. No employee grants are backfilled automatically.

## Deployment files

- `docker/Dockerfile`: opt-in frontend build argument, packaged synthetic vault and native migration CLI. Startup still does not migrate or run db push.
- `docker-compose.ai-qc.yml`: explicitly opt in on the existing app service, with a separate release image tag for rollback. Real customer data/API outbound remain OFF in this override.
- `scripts/native-ai-qc-migrate.cjs`: feature-only release script; does not load dotenv or run other pending migrations.
- `backend/prisma/migrations/20261101120000_native_ai_quality_control/{migration.sql,migration.manifest.json}`: exact native DDL and checksum.

The Windows DPAPI sandbox key is not automatically copied to a Linux Docker container. Existing backend environment/secret injection must supply a valid key if real API is later enabled. Never place key values in source/compose/Git or command arguments. The last actual OpenAI test failed authentication (401); this integration does not make that key valid.

## Release sequence — prepared, NOT executed against production

Keep the current local compose override when merging, since it may carry posting and storage settings. If `docker-compose.override.yml` exists, include it before `docker-compose.ai-qc.yml`. If it does not exist, omit that one file. No existing override was modified in this task.

1. Record the running image ID, resolved non-sensitive settings and a verified restorable database backup. Review the whole uncommitted release change set: there are earlier security patches in this workspace in addition to AI QC. An image built from the working tree includes those patches; auth changes can require users to log in again. No isolated AI-QC-only commit was created.
2. Build a new image/tag using the existing app service and explicit native override, without replacing the running container:

```powershell
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ai-qc.yml build app
```

3. Use that built image as a one-off CLI container. Do not start its app/worker entry point. First run `node scripts/native-ai-qc-migrate.cjs --check` with the existing app's DATABASE_URL. A status `PENDING_NEW_TABLE` has exit code 2, not success. After production migration authorization, apply only this feature:

```text
node scripts/native-ai-qc-migrate.cjs --apply --expected-database <DB_NAME> --backup-file <MOUNTED_CUSTOM_DUMP_PATH> --backup-sha256 <VERIFIED_SHA256>
```

Use a read-only backup-file mount in the one-off container. The script requires a nonempty PostgreSQL custom-format PGDMP backup and matching SHA-256, plus the explicit database name. It verifies the connected database identity, locks the feature release, verifies columns/defaults/primary/check constraints/indexes and checks migration history. Only this migration is recorded. Untracked preexisting native tables require `--adopt-existing` and exact structural verification; drift is refused. It does not repair or overwrite a drifted table automatically.

4. Run the feature `--check` again; require `UP_TO_DATE`. Never use production `prisma db push` or apply the full historical Sprint migration chain.
5. Only after release approval, update the existing app container, leaving database/MinIO/Cloudflare untouched:

```powershell
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ai-qc.yml up -d --no-deps app
```

6. Verify both ordinary CRM readiness/login and authenticated `/api/v1/ai-quality-control/status`, then `/workspace` and RBAC. Refresh the frontend on 5173 or use the deployed domain. Production API behavior has not been tested in this task. The prepared override enables only synthetic analysis; real-data flags and API outbound remain false.

The module namespace is registered even when disabled and returns `AI_QC_DISABLED`, making a missing feature distinguishable from an old backend image returning 404. Frontend errors also distinguish a missing schema from a disabled module. The current running container remains the old build until the release steps are approved and performed.

## Verification performed

- 101 backend synthetic tests PASS; 7 frontend SSR tests PASS.
- Backend TypeScript build PASS.
- Existing auth routes plus the native bootstrap were exercised under NODE_ENV=production in a process with a scrubbed environment against the verified loopback synthetic CRM database: existing login/profile, application Prisma persistence, authenticated/anonymous access, snapshot replay and real-data/API denial PASS. No full app, workers or production database was started/accessed by that harness.
- Feature migration was applied only to a newly created database on the proven disposable cluster. Actual PG dump/restore, missing/wrong backup denial, wrong target denial, apply, repeated apply, read-only check, unique/version/JSON constraints, transaction rollback, drift rejection, unrelated sentinel/history preservation all PASS. Other migrations executed: 0.
- The initial release-runner verification caught PostgreSQL 18 catalog NOT NULL entries; requiredness is now checked via pg_attribute and PG18-only duplicate catalog entries are excluded from check/primary verification, retaining compatibility with the existing PG16 deployment. Live migration tests were on PG18, not the production PG16 server.
- Production frontend opt-out and opt-in builds are checked separately; their evidence is stored with this release's source manifest.

Evidence root: `C:\Zalo CRM\native-ai-qc-shared-backend-evidence-20261101`; application-mode smoke output is in the recorded synthetic runtime directory. No Docker daemon/build/deploy command or production migration was run in this task.

## Rollback and limitations

Disable the feature/backend and frontend build flags, redeploy the recorded previous app image if needed, and retain the additive native table for evidence. No automatic table drop or evidence deletion is included. Never reset or overwrite unrelated working-tree/security changes.

Real orders, assignment history, work/off-day calendars, staff-read proof and sync coverage are still unavailable/unverified in the current CRM adapter. Keep NOT_AVAILABLE/UNKNOWN. This integration changes deployment topology, not business rules or evidence certainty. Employee scoring and automatic violation confirmation remain disabled; G1–G10 are not closed. A failed API authentication remains a separate blocker for actual OpenAI analysis.
