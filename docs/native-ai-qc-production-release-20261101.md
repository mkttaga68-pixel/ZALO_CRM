# AI QC deployed to CRM — 2026-11-01

## Subsequent owner-authorized real-data enablement

On 2026-11-01 the owner requested real CRM data. Both local compose overrides now set `AI_QC_REAL_DATA_ENABLED=true`; app was recreated with the same image, without a build or database migration. Provider API and both outbound approvals remain false. Employee scoring and automatic violation confirmation remain disabled.

Post-change read-only smoke: health healthy, profile/status/workspace 200, anonymous status 401, CRM list 200 with 12 visible conversations for the checked owner. No conversation names or contents were printed or saved. List coverage remains limited to 50 candidates; each selected conversation loads at most 200 messages with unknown coverage/assignment/time certainty. No automatic analysis job was enabled. Evidence: `real-data-read-smoke.json` in the release evidence directory. The synthetic-only checks below record the earlier deployment state.

User authorized deployment for functional testing. Existing `zalo-crm-app` was replaced with `zl-crm-app:ai-qc-shared-20261101`, image ID `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`. Node 22 is used throughout the Dockerfile to satisfy installed SDK/dependency engine requirements.

The normal local compose override now retains the release image, frontend opt-in and synthetic-only backend flags, plus the existing manual-posting setting. Database, MinIO and tunnel were not replaced. This image includes existing workspace security/auth changes; old sessions may need a fresh login.

## Database release

Before migration, the production database was backed up in PostgreSQL custom format and successfully restored using `pg_restore --exit-on-error` into an isolated, network-disabled, disposable PG16 container. Backup SHA-256: `4f883a3cd0a23891801e1f5482baba18c5cd10a54e5b3b268d76486079eda6f7`.

Only `20261101120000_native_ai_quality_control` was applied. Checks moved from `PENDING_NEW_TABLE` to `UP_TO_DATE`; other migrations executed: zero. Existing container environment values were compared before replacement; no overlapping non-QC environment differences were found.

## Post-release checks

- CRM health: connected database; Docker health: healthy.
- Authenticated profile, QC status and workspace: HTTP 200. Internal read-only smoke used a 60-second owner token; neither token nor account credentials were printed or saved. This does not substitute for browser password login testing.
- Anonymous QC status: 401. Real CRM conversation access: 403.
- Storage: application; synthetic-only: true; real provider API: false.
- Employee scoring and violation confirmation: DISABLED.
- Frontend production build contains the QC dashboard chunk. Backend/frontend image builds passed; 36 targeted auth/socket/readiness regressions passed. Dedicated QC 101 backend and 7 frontend tests passed in the preceding review.

Open `http://localhost:5173/ai-quality-control`, refresh, and sign in again if the old session is rejected. Start with Training Center, create a server synthetic scenario, then run Mock analysis. Real provider calls remain disabled.

Evidence and backup: `C:\Zalo CRM\native-ai-qc-production-release-20261101`. The backup contains CRM data and must remain private. Remaining capacity/retention and browser acceptance gaps are tracked in `native-ai-qc-review-20261101.md`.

## Rollback

Previous image: `zl-crm-app:posting-rbac-20261101`, image ID `sha256:bc7e35e12621ba903aef4e0e91cee6618f47263c307b0cbec93585f0e5debdf1`. To roll back, use a final compose override selecting this image, setting QC backend/frontend flags false, then recreate only app with `--no-deps --no-build`. Retain the additive QC table and backup; no rollback table deletion is needed. Do not include the enabling `docker-compose.ai-qc.yml` after a rollback override.
