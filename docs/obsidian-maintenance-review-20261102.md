# Organization verification and app maintenance proposal — 2026-11-02

Status: review only. No maintenance window has been authorized. No production restart, overlay application, OpenAI request or customer/message query was performed. Existing changes remain untouched; HEAD is `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`.

## Verified organization

The owner supplied an exact administrator email. A parameterized query executed in `BEGIN READ ONLY`, with a 5-second statement timeout, returned only the organization UUID/name and account role/active flag. It joined only `users` and `organizations`, did not select password hashes, tokens, contact details or conversations, and rolled back the read-only transaction. No login endpoint was invoked (login has bootstrap/seed side effects).

| Organization UUID | Organization | Account role | Active |
| --- | --- | --- | --- |
| a236afea-cc9c-4de8-81c0-ee5923385b2e | ASLAN GLOBAL | owner | true |

The current schema has a globally unique email and one orgId per user, rather than multiple organization memberships. Exactly one matching account/organization was returned. Current RBAC has the owner fallback. This establishes this account's organization scope; it does not automatically approve a Vault binding or invent access to other organizations. Owner confirmation of this UUID is still pending.

Evidence: `C:\Zalo CRM\obsidian-production-preflight-20261102\organization-lookup.json` (no email/password/token stored).

## Target and impact

Docker context `desktop-linux`, project `zl-crm`, service `app`, container `zalo-crm-app`, port 3080→3000. The active Compose file order is base, override, then ai-qc overlay. App and database remain healthy; app ID/image/StartedAt match the prior preflight. Production is separate from source frontend localhost:5173 and synthetic backend 3091.

Only app must be recreated to add a mount or change startup flags. A plain process restart does not add the mount. Do not restart PostgreSQL, MinIO, backup, or modify Cloudflare. The app serves the whole CRM, so the restart interrupts all users on that backend even though the Vault allowlist will contain only one organization.

Inspected deployed code without bootstrapping the app: SIGTERM handler calls Zalo pool shutdown then Fastify close and forces process exit after 8 seconds. Pool shutdown stops listeners and message sync. Docker has no explicit custom stop timeout; allow the existing graceful path and do not force-kill it. Evidence: `restart-code-evidence.json` in the evidence directory above.

HTTP requests and Socket.IO connections will be interrupted; clients must reconnect. JWT_SECRET is configured and persisted through deployment environment. Existing unexpired tokens should survive if JWT_SECRET, credential state and database are preserved, but no production session-reuse test was run. Do not rotate JWT_SECRET/ENCRYPTION_KEY during this release.

Committed database messages remain on the existing PostgreSQL volume. A message handler can still be mirroring media, persisting a message or executing subsequent async automation work during shutdown. There is no verified durable drain for all those stages. Do not guarantee lossless/replay-safe handling of in-flight work. Zalo reconnect/backfill exists but is not evidence that every in-flight message or automation side effect will recover. Schedule quiet time, pause manual sends/uploads and let active work settle. No live queue/message inspection was performed here.

Estimated HTTP interruption: 1–3 minutes after an image is prebuilt locally. Reserve a 10–15 minute maintenance window for verification and rollback. Zalo reconnection can take longer or require operator action. These are planning estimates, not measured downtime or an SLA. Abort rather than start if candidate image, backup, secrets or rollback prerequisites are missing; do not build/download dependencies during the outage.

## Proposed Vault binding (not applied)

Source: `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN`. Target: `/knowledge/obsidian`, bind read_only=true and create_host_path=false. Preserve `zl-crm_file_storage` at `/var/lib/zalo-crm/files`. No Downloads parent mount or directory move.

After owner confirms the organization, the proposed exact allowlist is:

```json
{"a236afea-cc9c-4de8-81c0-ee5923385b2e":["/knowledge/obsidian"]}
```

The November 1 container filesystem test verified all 22 Markdown hashes match Windows and an existing file cannot be opened for writing. That was an ephemeral, network-disabled container, not a production mount. Recheck hashes and production Mounts.RW=false after deployment. Scan/sync produces DRAFT only; the owner/reviewer must explicitly approve/publish revisions. Do not auto-approve UX-001 or any document.

The existing activation overlay is not ready to run blindly: it disables AI_QC_ENABLED and retains the older production image. The deployed knowledge/analyzer hashes differ from the local compiled revision patch. A final reviewed overlay must pin an immutable candidate containing the revision fix, preserve all unrelated app settings, and keep AI_QC_REAL_DATA_ENABLED=false, AI_QC_REAL_DATA_OUTBOUND_APPROVED=false, AI_QC_AUTO_MONITOR_ENABLED=false. API flags stay false until the separately authorized controlled request gate passes. No migration is planned as part of the mount operation; if a patch requires a migration, obtain separate approval.

## Health checks and rollback

Before the window: prepare candidate from a reviewed scoped source manifest (working tree includes unrelated edits), run revision/ACL/citation and budget/secret/egress regressions in isolation, validate the final merged Compose diff, verify a current private backup by isolated restore, retain the exact current image/config/volume references. Existing earlier backup evidence does not replace this fresh preflight.

During the approved window: recreate app only using the explicit approved file list, prebuilt image, --no-deps and --no-build. Preserve the current secrets and DB/storage configuration. Check Docker health (15-second interval, 5-second timeout, 30-second start period, 3 retries), `/health` database-connected status, owner authentication and anonymous denial, storage configuration, correct image digest, mount source/target/read-only flag, tenant allowlist and unchanged host hashes. Use synthetic content for QC tests; do not inspect customer messages. Do not activate live ingestion or automatic monitoring.

Rollback trigger: unhealthy startup, auth/storage regression, incorrect mount/tenant, hash change, revision/citation failure, secret/egress/budget gate failure. Restore pinned image `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`, remove the new Vault binding/allowlist if needed, apply reviewed disabling flags and recreate app only. Preserve database and file_storage volumes; no drop/down -v. Recheck health/auth/storage. Rollback deliberately keeps OpenAI and real-data flags false rather than re-enabling the older real-data read flag. If live flags ever require an off switch later, environment changes need another app recreation; a verified no-restart kill switch is not yet demonstrated.

## Controlled OpenAI configuration and remaining gates

Owner authorized only POST `https://api.openai.com/v1/responses`, from the verified backend, for synthetic conversations and tenant-authorized approved/effective retrieved excerpts. No full Vault, DRAFT/REVOKED content or real employee/customer data. No model substitution. This approval is recorded, but network scope verification and runtime activation remain pending.

Official model documentation confirms `gpt-6-luna` supports Responses and Structured Outputs. The Standard short-context prices checked are $0.10 per million input and $0.50 per million output tokens; use the applicable tier/context rates and conservatively ignore caching discounts when reserving costs. Model/project access is NOT_VERIFIED: the Docker app has neither key nor project configuration, and no real API request was made. A CLI's available Luna model is not proof of the API project's access.

Approved maximums are 2 USD/day and 30 USD/month. These are requirements, not already enforced settings. The existing backend implements request-rate/daily token reservations and usage estimates, but not durable USD day/month hard caps. Before enabling API, implement and test atomic durable cost reservations covering concurrent calls, retries and uncertain timeout outcomes, persisted through restarts, with no release of uncertain charges and no bypass through connection tests or manager/training calls. Reject unknown prices/model/tier, missing ledger/configuration or exhausted quota before dispatch. Define calendar boundaries explicitly; proposal is Asia/Bangkok for backend day/month and UTC for Platform billing, enforcing both independently. Missing/invalid usage must fail closed. Tenant counters alone are insufficient if multiple tenants share the approved project budget.

No nonfunctional budget environment variables were added. No claim is made that editing a settings file alone enforces these ceilings. Durable budget/secret/egress patches can be developed and tested without production activation; they are not present in this review-only change.

OpenAI Platform control: use the intended project's Limits → Spend → Monthly spend limit=30 USD and enable Enforce a hard limit, with alerts below the cap. Confirm the exact project and scope before saving so unrelated workloads are not affected. Platform hard enforcement is not instantaneous and can slightly exceed tracked spend; it does not replace the backend daily/monthly pre-dispatch gate. No Platform setting was changed: no authenticated Platform management connection/project ID is available. Do not request an organization admin API key in chat to work around this.

The current Windows DPAPI mechanism is not a Linux-container secret bridge. Prepare a backend secret-file reader or secret-manager injection compatible with the existing provider, masked key entry and tightly scoped host permissions. Never store key text in Compose/source/frontend or print it. Verify the intended API project using project-scoped credentials/explicit project configuration without granting new GET/admin endpoint egress. Only Responses POST was authorized; do not silently call models/project-management endpoints. The first approved minimal synthetic Responses result must establish model/schema access; stop and report 401/403/404 instead of falling back.

Docker network connectivity alone does not enforce a POST/path allowlist. The native sandbox's guarded transport cannot be assumed active in production. Validate a container-compatible destination/method/path guard, TLS/DNS/redirect controls and synthetic/knowledge scope before dispatch; preserve existing CRM Zalo traffic while restricting the QC provider path. No network or Cloudflare policy was changed.

After all gates and the maintenance decision: first perform a minimal synthetic connection request, then synthetic conversation analysis with approved/effective UX-001 if available. Record backend/container/project/model, request attempts, input/output tokens, conservative cost, response ID, rule revision/hash/citation and NEEDS_REVIEW result. If no approved effective UX-001 exists, report missing rule without publication. Do not fabricate a Dashboard/OpenAI PASS.

## Current results and next confirmation

TESTED: exact-account read-only organization lookup; deployed shutdown-code inspection; metadata/healthy containers. DOCUMENTED: model capability and price. PREPARED: maintenance/mount/allowlist/health/rollback proposal. NOT_RUN: restart, overlay, Platform limits, model-project request, OpenAI synthetic analysis, production Dashboard acceptance. Missing implementation gates: container secret integration, USD budget enforcement, verified QC egress.

Owner is asked to confirm ASLAN GLOBAL UUID above and propose a specific 10–15 minute window in Asia/Bangkok, plus identify the OpenAI API project (project ID/name only, never key). The window confirmation authorizes scheduling, not bypassing the remaining technical gates. Until those gates pass, do not use the window to activate API. No production application code/config was edited in this phase.

References checked via OpenAI Docs:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/spend-limits

This phase adds this report and sanitized evidence only; it does not mark the requested budgets CONFIGURED/ENABLED.
