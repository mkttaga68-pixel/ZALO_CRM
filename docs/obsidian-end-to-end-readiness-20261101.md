# Obsidian Brain end-to-end readiness — 2026-11-01

> Subsequent source patch: scheduled revision handling is fixed and verified in sandbox (117 backend tests plus real synthetic PostgreSQL concurrency). See [patch and monitoring scope](knowledge-revision-fix-and-monitoring-plan-20261101.md). The findings below record the earlier state; browser acceptance and production deployment remain pending.

Status: NOT accepted for production activation. Browser evidence is pending, and future-effective revision publication has a reproduced defect. No production restart/replacement, customer-data request, Cloudflare change, real-provider request or auto-monitoring activation occurred in this review.

`AGENTS.md` was read. The working tree includes earlier uncommitted security/auth/posting/QC work; no commit or reset was made. Current architecture is the native `backend/src/modules/ai-quality-control` module, not the removed Sprint 1–5 implementation. GitNexus tools are unavailable; no existing runtime function/class/method was edited.

## A. Browser E2E evidence

Exact frontend route: `/ai-quality-control`, name `AIQualityControl`, guarded by authentication and `ai_quality_control.access`, included only with `VITE_AI_QC_ENABLED=true`. Obsidian Brain is tab index 5 inside `AIQualityControlDashboard.vue`, not a separate route. The tab selection is component state; the URL alone does not select it.

Current loopback sandbox probes: `http://127.0.0.1:3091/health` returned 200 JSON; `http://127.0.0.1:5174/ai-quality-control` returned 200 HTML. Neither proves browser rendering or successful login. No production HTTP target was probed in this review.

Browser E2E: NOT RUN. This session exposes no browser tool, workspace has no `frontend/node_modules/@playwright/test` or `backend/node_modules/playwright`, and no installed browser cache was found at the checked `LOCALAPPDATA/ms-playwright` location. Chrome and Edge executables exist. Starting a browser requires execution outside the sandbox, for which no matching approval was established. No browser launch or dependency installation was attempted.

Exact requested permission/target for the next browser run:

- Run headless Chrome/Edge through a dedicated local automation runner outside the filesystem/process sandbox, with a fresh profile under `C:\Zalo CRM\obsidian-e2e-readiness-20261101`; no existing browser profile/cookies.
- If needed, install a pinned browser runner in that evidence directory only; separate registry download access is needed. Use the installed browser to avoid an additional browser download.
- Allow browser requests only to `http://127.0.0.1:5174` and the verified synthetic backend `http://127.0.0.1:3091`; never 5173, 3080, a CRM domain or external hosts. Disable/block external requests, including OpenAI.
- First verify the existing sandbox's identity, database provenance, real-data/API flags and workers-off state; stop if any boundary is unproven. Use only its synthetic login. Do not print or save its password/token.
- Use a dedicated synthetic test Vault, not the Windows production Vault. The sandbox backend must allowlist that test directory. Request sandbox-only configuration/restart permission if its current allowlist cannot expose the fixture. No production restart is included.
- Exercise login, route/tab, preview/sync, revision/hash/status, denied administrator controls, synthetic analysis and displayed citations. Capture screenshots, console errors and redacted request/status assertions. Publication tests must use explicitly identified disposable synthetic documents; never auto-approve actual Obsidian policies.

Existing 7 frontend tests are SSR with mocked API, not browser E2E. Prior 101 backend tests are isolated service/API/provider tests, not browser evidence. Screenshots, trace and click-workflow acceptance remain missing.

## B. Revision/sync verification

Executed `node scripts/verify-obsidian-revision-workflow.mjs` against existing compiled native services and Fastify injection. The new harness uses memory storage, a fresh synthetic Vault inside the workspace evidence directory, fixture-only authentication/approval actions, no listener, no database client, no real provider and no real Vault access.

Verified PASS:

- Initial DRAFT is excluded from retrieval.
- Synthetic fixture revision 1 is published through the existing API workflow.
- Editing only the synthetic file changes hash and creates DRAFT revision 2; retrieval still selects approved revision 1.
- Repeat sync creates no additional revision.
- Read-only actor is denied sync (403).
- After publishing fixture revision 2 and reaching its effective time, retrieval selects revision 2.

Reproduced defect: publish revision 2 with `effectiveFrom` tomorrow. `KnowledgeApprovalService.publish` immediately sets the previous version to REPLACED. Retrieval now returns no document before tomorrow instead of keeping revision 1 active. Evidence records `expectedRevision:1`, `actualRevisions:[]`. Script exits 2 for this blocked result; this is not an all-pass run. Runtime repair was not attempted in this verification scope. Fix and regression verification are required before scheduled publication is accepted.

Evidence: `C:\Zalo CRM\obsidian-e2e-readiness-20261101\revision-workflow.json`. Earlier real-Vault mount verification is in `obsidian-vault-sandbox-evidence-20261101/result.json`; that earlier test used a separate network-disabled Docker process and did not configure live production.

## C. Tenant/ACL verification

Current fixture tests: a different tenant and an actor outside the approved department retrieve zero chunks; reader-only sync is 403. Earlier isolated tests cover tenant/path allowlists, content hash and invalid citations. These do not establish production employee group configuration.

Server configuration accepts exact absolute paths under `AI_QC_VAULT_ROOTS_BY_TENANT[orgId]`. Vault preview/sync additionally require `edit` and `view_all`; publication requires `approve`, document ACL and valid hash. A browser setting cannot add a server allowlist entry. Front matter cannot grant approval. A missing/deleted source file does not automatically revoke a published snapshot.

The live organization ID and grants were deliberately not queried in this review. Production allowlist is therefore not approved/resolved here.

## D. Production integration readiness

Source/target proposal (sandbox read verification already passed; production mount authorization is still pending):

| Item | Value |
| --- | --- |
| Windows source | `C:/Users/ADMIN/Downloads/ZALO_CRM_AI_BRAIN` |
| Existing app container target | `/knowledge/obsidian` |
| Access | Bind, read-only, `create_host_path:false` |
| Tenant | Exact separately authorized organization ID; never wildcard/all tenants |
| New infrastructure | None; existing app/image/auth/database only |

Prepared, unapplied diff: `docker-compose.obsidian.activation.yml`. It adds only the mount/tenant map and explicitly forces `AI_QC_ENABLED`, real-data, provider API and outbound approvals OFF. It preserves the selected image and unrelated app volume/settings. Current local overrides already enable AI QC and CRM real reads from an earlier authorization; this review did not change those settings. Applying the new disabled overlay would temporarily turn those features off and requires explicit release approval.

Preflight, after authorization:

1. Complete browser acceptance and repair/retest the effective-date defect. Review the complete uncommitted release diff if rebuilding; do not silently include unrelated edits.
2. Confirm authorized org and filesystem ownership; protect Vault ancestors against replacement. Record current image/container ID, source inventory, sanitized resolved flags/mounts and original QC vault setting. Preserve current overrides and a verified database backup if workspace state will be changed.
3. Confirm Docker Desktop can read the exact source. Check the merged config without exposing env/secrets; require the existing `file_storage` volume and unchanged database/MinIO/tunnel services. Placeholder/missing `OBSIDIAN_ORG_ID` must fail.
4. Validate read-only mounting in a separate network-disabled CLI container using the intended image. Assert `.Mounts[].RW=false`, read Markdown, reject an existing-file write handle, compare hashes; do not create a probe file in the real Vault.
5. Reserve a proposed 10–15 minute operator-attended maintenance window, subject to measured startup time. No time has been booked. App recreation briefly interrupts sessions/sockets; database/MinIO/tunnel need no restart. There is no Vault schema migration in this mount-only plan.
6. Only in that approved window, apply the final reviewed overlay to app alone with `--no-deps --no-build`. No such command was executed here. First keep runtime flags OFF, then approve feature enablement separately; never infer permission for provider calls or monitoring from mount approval.

Post-deployment acceptance: container health and `/health`; original CRM login/profile; anonymous QC denial; authorized QC status/workspace; expected storage and disabled outbound/scoring flags; scoped Vault preview; explicit DRAFT sync only if approved. Manual document approvals are a separate workflow. Test a non-admin account and verify ordinary CRM navigation. Do not read customer content as a health probe.

Rollback: preserve the preflight compose/image/settings record. Recreate app using the recorded previous config without the Vault overlay, restore the previous QC vault path through an authorized settings operation, and recheck health/login. Retain audit/revision snapshots; do not drop a table, delete documents or restore the whole live database for a mount-only rollback. Restart discards memory repositories; application-mode workspace persists and still requires source mount/allowlist after each restart. Reverting the host Markdown does not itself revert approved snapshots.

## E. Auto-monitoring pipeline status

| Stage | Status established in this review |
| --- | --- |
| Message ingestion | Existing CRM source persists messages in `chat/message-handler.ts`; no live ingestion replay/customer access was performed. |
| Ingestion → QC enqueue | No native AI QC hook found. Existing automation/contact scoring hooks are not an AI QC integration. |
| Analysis queue | No native QC queue producer/consumer found. |
| AI worker | No native QC background worker found. Analyzer is invoked by manual HTTP/dataset actions; Mock works in isolated tests, real OpenAI stays OFF. |
| Warning persistence | Manual analysis stores run/findings/review/audit in `native_ai_qc_workspace`; no automatic warning pipeline was found. Current revision harness uses memory only. Earlier application-mode persistence evidence is historical, not a new production test. |
| Dashboard notification | QC workspace displays manually loaded runs; no native QC notification/socket wiring found. Existing `/notifications` computes unreplied-conversation, appointment and Zalo-disconnection items, not AI QC warnings. |

Auto-monitoring is not implemented end to end. No queue/worker or monitoring switch was added/enabled, and no employee violation was confirmed. Designs or removed Sprint files must not be reported as running modules.

## F. Exact next action

Next execution gate is approval for the scoped headless-browser runner and, if needed, its installation plus synthetic-sandbox Vault configuration described in A. Targets: only 5174/3091, fixture Vault and evidence directory. In parallel, a separate code-fix task must resolve scheduled publication, with repository-required impact tooling available before editing runtime symbols. Production activation remains blocked until both checks pass, org/mount scope is confirmed and the maintenance/restart is separately authorized. Do not run production `compose up` as the next action.
