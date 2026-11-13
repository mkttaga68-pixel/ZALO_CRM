# App restart and Zalo recovery checklist — NOT EXECUTED

Proposed window: **03/11/2026 00:30–00:45 Asia/Ho_Chi_Minh (UTC+07)**. This is not a scheduled task or approval. Only service app may be recreated after a separate final decision. PostgreSQL, MinIO, backup and Cloudflare stay unchanged.

## Verified code and limits

| Area | Evidence | Limit |
| --- | --- | --- |
| Shutdown | app SIGTERM → Zalo shutdownAll → Fastify close; 8-second forced exit | Not a durable global drain |
| Automation events | `backend/src/modules/automation/engine/event-bus.ts`: EventEmitter/setImmediate | Pending memory work does not survive restart |
| Incoming messages | `chat/message-handler.ts`: DB message write followed by async downstream work | Commit does not prove every subsequent side effect finished |
| Message sync | `zalo/zalo-message-sync.ts`: intervals held in a Map; stop clears interval | Clearing interval does not wait for a callback already running |
| Saved Zalo session | pool reconnect reads persisted sessionData and uses SDK reconnect/backoff | No saved session or rejected session can require operator QR login |
| Reconciliation | periodic sync/backfill and existing duplicate IDs exist | Not evidence of complete exactly-once recovery for every send/automation |
| QC mock queue | Dedicated synthetic durable tests pass | Not a substitute for production Zalo send/ingestion durability |

No production pending-send list, session secret, customer message or Zalo outbound call was read/run in this task. Queue counts and current connections are NOT_VERIFIED. No promise of zero message loss is made. If a strict zero-loss guarantee is mandatory, a separately reviewed durable drain/outbox change and fault-injection acceptance are required before GO.

## Before restart — all pending

- [ ] Owner approves exact immutable image, scoped diff, organization and start/end time; do not act on the proposed window alone.
- [ ] Operator confirms quiet state: no active manual sends/uploads, bulk posting or automation actions. Pause new sends through the approved CRM/operator workflow. Do not infer idle merely from HTTP health.
- [ ] Record minimal operational counters/statuses through an authorized view; do not export customer message bodies or session credentials into evidence.
- [ ] Verify current private database backup/isolated restore and configuration recovery. Existing DPAPI configuration roundtrip does not verify database restore.
- [ ] Keep the current image locally and preserve original Compose files, runtime secrets, PostgreSQL/file_storage volumes. Never rotate JWT_SECRET or ENCRYPTION_KEY in this change.
- [ ] Verify candidate image/source manifest and rollback overlay; build/download nothing during the outage.
- [ ] Check `/health` HTTP 200 with db connected and Docker healthy before the window.
- [ ] Preserve the dedicated budget volume across rollback/recreation. Never reinitialize a previously used ledger to recover API access.
- [ ] Keep all QC/API/real-data/monitoring flags OFF in the default deployment. A mount-only decision is not API enablement permission.

## Authorized app-only recreation — not run

- [ ] Use explicit project zl-crm, the original three Compose files and the single reviewed final overlay. Use prebuilt pinned image, --no-deps and --no-build; do not use down/down -v or restart the database.
- [ ] Allow graceful SIGTERM. Do not use kill to meet the estimate. Document if shutdown exceeds the expected budget.
- [ ] Expected HTTP interruption 1–3 minutes is an estimate, not a measurement or SLA. Socket.IO clients disconnect/reconnect; Zalo reconnection may take longer.

## After restart — all pending

- [ ] Verify exact image ID/digest, app-only new StartedAt, unchanged DB/MinIO/backup identities, Docker health and `/health` db connected.
- [ ] Verify auth with owner's approved login; anonymous QC denial. Preserve JWT/signing secrets and credential state; do not fabricate or borrow a production token.
- [ ] Verify upload/storage settings and existing file_storage volume; use approved synthetic checks.
- [ ] Inspect Vault source/target and RW=false, exact ASLAN allowlist, unchanged hashes. Preview/sync only as DRAFT; approval remains a human action.
- [ ] Verify Socket.IO reconnect and operational Zalo connection statuses. Do not claim tests of Zalo sessions from the isolated mock image checks.
- [ ] If reconnect fails, roll back the image/config first; an authorized operator can use saved-session reconnect or QR login. Do not mass-reset sessions/credentials.
- [ ] Reconcile interrupted sends and sync coverage through the authorized CRM workflow. Do not blindly resend a timeout: Zalo may already have accepted it.
- [ ] Confirm all default API/data/monitor flags remain OFF and no automatic scan began.

## Rollback — prepared, not executed

On unhealthy startup, auth/storage failure, wrong mount/tenant or failed revision/citation checks, recreate app only using the ORIGINAL three Compose files plus `docker-compose.obsidian.rollback.review.yml`, excluding the new mount overlay. It pins current image `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989` and keeps QC/API/data/monitoring OFF. Preserve all volumes, including the new budget volume if it has been created. No table deletion or PostgreSQL restart.

Offline configuration replay, encrypted backup roundtrip, local rollback image availability and entry syntax have PASS evidence under `obsidian-production-preflight-20261102`. Actual rollback, real JWT login/session recovery and post-restart health remain NOT_RUN. Rollback restores application code/configuration; it cannot recreate lost in-memory events. Defer the deployment if those risks are unacceptable or prerequisites are incomplete.
