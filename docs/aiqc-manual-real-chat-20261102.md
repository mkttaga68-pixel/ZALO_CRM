# Manual real-chat testing on CRM 3080 — 2026-11-02

Implementation and isolated tests are complete for the manual conversation workflow. **Not activated in production. No real OpenAI call or customer conversation read was performed by this task.** Owner authorized testing a selected real chat, chose 7-day evidence retention and reported that the OpenAI Platform monthly hard limit has not been set/checked. Prior separate app-maintenance approval is still pending.

## What was implemented

The existing CRM page gains a manual analysis panel under Conversation Analysis, using the same relative API, CRM login, grants, tenant and conversation privacy/access checks. No extra user account, listener, service, dependency or database migration was added.

1. User explicitly loads permitted conversations and selects one. No list, preview or analysis request is triggered by mounting the new panel.
2. User chooses the latest 10/20/50 messages and optional extra literal redactions (up to 20 terms, 2–128 characters each).
3. Backend loads only the selected conversation through the existing authorized CRM adapter, minimizes the outbound excerpt and masks email/phone/identifier/secret/URL patterns, IDs and timestamps. Additional terms can hide names/addresses. Regex redaction does not guarantee detection of every personal detail; the owner must review the exact preview.
4. Preview displays the outbound chat, approved/effective/ACL-filtered rule citations, selected model and retention requirement. It creates an opaque, actor/org/conversation/content/knowledge-bound 5-minute ticket. It does not call OpenAI or approve any rule.
5. User checks the explicit consent box and submits. Backend rejects no provider selection, no consent, wrong actor/tenant/grant, stale/expired/replayed ticket, changed chat/rules and missing seven-day policy. Only OpenAI is accepted for the new manual-real CRM endpoint mode; legacy Mock training remains available separately.
6. A successful synthetic connection test with the current key/model is required before real-chat dispatch. That proof is process-local, expires after 24 hours and is lost after restart. Credential change requires a new synthetic test. Credential fingerprints are private in memory, not exposed in audit/API/frontend.
7. Backend mints a private content-bound transport permit only after checking the preview. Transport strips it before sending to OpenAI. Arbitrary CRM-shaped JSON cannot bypass this gate. At most two transport uses allow the provider's existing bounded retry; each actual dispatch reserves its own cost.
8. Existing controlled Responses client enforces the exact endpoint/project/model, Standard tier, no tools/stream/background features, DNS/public-IP/TLS/redirect controls, timeout, global project budget, concurrency and rate/token bounds. No new provider or global network hook was created.
9. Existing evidence/citation/review services persist the redacted run for review. Missing actor attribution, coverage, history or applicable rules remains UNKNOWN/ABSTAIN. The result does not confirm a violation or score/punish an employee.

## Seven-day evidence policy

Owner chose **7 days**. New manual runs have immutable expiry metadata included in their evidence hash. API access hides expired runs at the exact deadline. An explicitly enabled retention hook checks only ASLAN QC workspace records every 60 seconds while the app runs and purges expired manual runs, evaluations and linked review/audit text, retaining a minimal count-only purge audit. It does not scan CRM messages or trigger AI analysis. Legacy records without the new manual retention marker are not deleted by this hook.

App downtime postpones physical cleanup; startup catches up. During rollback, keep QC disabled and ensure the approved retention process can resume; old code must not be treated as a verified seven-day purge worker. Backup retention is separate from online workspace retention. No cleanup/deletion job ran against production in this task.

Retention configuration requires both edit and approve grants. The UI offers an explicit seven-day action only to such users. An analyst with create can analyze only after an authorized policy decision, existing conversation access and the reviewed preview. Default provider remains unchanged; a manual submission explicitly selects OpenAI.

## Test evidence

- **166 backend tests PASS**: 117 native regressions, 33 OpenAI controls, 16 fabricated CRM manual-workflow tests. Latest: `aiqc-readiness-closure-20261102/tests-1793587205278/results.json`.
- **13 frontend SSR tests PASS**: 7 existing and 6 manual UI/access/no-auto-request tests. `tests-1793586535753/frontend-results.json` under the same evidence parent.
- **19 monitoring Mock regressions PASS**: `tests-1793586321225/monitoring-results.json`. No real monitoring was enabled.
- Backend TypeScript and Vue type checks PASS; frontend Vite production build PASS, using an empty env directory and scrubbed environment. Existing bundle-size warnings remain.
- **12 checks PASS in the final candidate container**, including packaged frontend/backend hashes, auth/RBAC, no provider call on preview, consent/replay/change detection, permit stripping and seven-day hide/purge. `aiqc-manual-real-test-20261102/candidate-tests.json`.
- Containers use network none/read-only root/tmpfs; actual chat fixtures and rule publication are fabricated in memory. Browser E2E/full production login and actual OpenAI model access are NOT_RUN. A seeded fake connection proof in tests is not a successful real connection.
- A transient Windows atomic-rename lock failure was encountered during stress testing. The ledger now retries only the same atomic rename for up to 30 ms on Windows; no ledger deletion/reset/refund. The injected-lock regression and final suites pass.

## Built candidate and exact proposed activation

Image: `zl-crm-app:manual-real-review-20261102-c6b3b1205d`.

Digest: `sha256:7d7fa0a5ddf0fd82debfdea7972f94520e78b0acf0134b8381bb33ac1d7118b2`.

The candidate derives from the tested closure image, copies the changed QC modules and packages a frontend build from the current working tree. Source/compiled/frontend hashes and parent image/commit are in `aiqc-manual-real-test-20261102/candidate-image.json` and `/app/aiqc-manual-manifest.json`. Source is still uncommitted; the full frontend build requires scoped review rather than claiming only one static chunk changed. No image was pushed or substituted for production. Image defaults are OFF.

Prepared `docker-compose.ai-qc.manual-real-test.review.yml`, NOT_APPLIED. Exact file order for future review: the three existing base/override/ai-qc files, `docker-compose.obsidian.closure.review.yml`, then this new manual overlay. The final overlay requires an explicit `AI_QC_MANUAL_REAL_TEST_APPROVED` value; it is not enabled by existing shell defaults. Render verification used true only in the config subprocess, never runtime.

The proposed mode enables QC/controlled API/manual-real read/outbound and the independent retention hook, pins the tested image, and keeps AUTO_MONITOR_ENABLED=false. It inherits the read-only Vault bind, ASLAN-only allowlist, server project/model, persistent private budget volume and secret tmpfs. Port 3080 and unrelated services/mounts remain unchanged. Only the explicit per-conversation permit can authorize real outbound. This is separate from automatic monitoring/whole-CRM scans.

Sanitized diff is `aiqc-manual-real-test-20261102/activation-diff.json`. Production container ID/image/StartedAt stayed unchanged and health remained 200. No production database, grants, customer content, Cloudflare or container runtime was modified.

## What still blocks actual API activation

1. **No stored key** was found at the final metadata check. A visible PowerShell Store prompt was launched for masked entry. Store writes DPAPI ciphertext only; it does not call APIs, inject into a container or restart anything. Do not enter the synthetic CRM password as an API key, paste a key into chat or use InjectAfterMaintenance now.
2. **Platform hard limit not set/verified**, per owner answer. In the confirmed Default project, set Monthly spend limit=30 USD and enable Enforce a hard limit; save and confirm. Backend cap is already enforced in tested code but does not configure Platform or account for unrelated Default-project workloads. Platform enforcement may lag. No management API permission/credential was assumed.
3. **No accepted-key/model/project response** exists. Run the already-authorized synthetic test first once valid secret, budget and egress scope are verified. Stop on authentication/model/quota error; do not substitute a model or send a real chat to discover key validity.
4. **Production activation needs the owner's app-only maintenance decision.** No restart is scheduled by this implementation. The prior proposed 03/11/2026 00:30–00:45 Asia/Ho_Chi_Minh window remains unapproved. Existing backup/rollback and Zalo in-flight/recovery conditions still apply.
5. **Approved knowledge must exist.** The owner must configure `/knowledge/obsidian`, preview/sync DRAFTs and approve valid/effective/ACL-correct rules through the existing workflow. The agent does not auto-approve UX-001 or any document. Without approved applicable knowledge, the manual preview/send remains unavailable and no analysis is fabricated.

## Operator sequence after the release is separately approved

- Preserve current secrets, DB/storage/budget volumes and rollback image. Apply only the reviewed app configuration during the approved window; do not restart PostgreSQL or change Cloudflare.
- Initialize the new child control directory only if never used; never reset a ledger. Review/enable policy and dispatch marker only after the required budget checks. Keep the automatic monitoring flag false.
- Inject the DPAPI-stored key into the reviewed container tmpfs using the explicit InjectAfterMaintenance action. The helper now validates manual mode and retention flags and refuses an old/wrong image. No key is printed or baked into the frontend/image.
- Sign in at `http://localhost:3080/ai-quality-control` with the normal CRM account, set/approve the seven-day policy and chosen model, and perform the synthetic connection test. Check the returned model, usage and actual sanitized error before proceeding.
- In Obsidian Brain, choose `/knowledge/obsidian`, preview/sync and explicitly publish applicable rules. No API call substitutes for knowledge approval.
- In Conversation Analysis, load permitted conversations, select one, choose 10/20/50 messages, add redactions, inspect both chat and rule quotes, confirm, and submit. Review the run/citations and UNKNOWN/ABSTAIN context rather than treating an AI observation as a confirmed violation.
- Disable new dispatch using the tested control marker if needed; do not delete budget history. Rollback keeps QC/API/data/monitoring OFF and preserves volumes. Do not blindly resend an interrupted/ambiguous API or Zalo operation.

If the Store window is not visible, the operator can run this locally (Store only):

```powershell
powershell -NoProfile -File "C:\Zalo CRM\ZL-CRM\scripts\prepare-aiqc-project-secret.ps1" -Action Store
```

Until these conditions are satisfied, actual OpenAI requests remain 0, production activation remains NOT_RUN, and the previous NO-GO is not silently changed to GO.

## Source change set

New backend: `manual-real-consent.ts`, `manual-retention.ts`; updates to analysis, providers/control, routes, bootstrap and the optional run contract. New frontend manual panel, dashboard integration and status type. New backend/frontend tests/config and isolated build/test scripts. Updated secret-injection validation. New review-only manual activation overlay. No migrations, dependency changes, message writer/Zalo queue edits, CRM auth/router/menu changes or account/grant mutations.

AGENTS.md impact checks preceded existing method edits. Analyze/testConnection were CRITICAL and warned; unresolved new symbols were UNKNOWN and checked through source/tests. No commit was made.

Platform control reference: https://developers.openai.com/api/docs/guides/spend-limits .

## Secret storage update

The owner-provided project key has now been saved as Windows CurrentUser DPAPI ciphertext at the backend secret path. Encrypted read/decrypt roundtrip PASS; DACL is restricted to the current Windows account and SYSTEM. No plaintext credential file, key value in tool arguments/output, API request or production mutation was created. Evidence: aiqc-manual-real-test-20261102/secret-storage-verification.json. This supersedes the earlier missing-secret check; OpenAI acceptance, Platform hard limit and production activation remain NOT_RUN/unverified. The key appeared in chat and the owner shell before storage, so replacement is recommended before activation.
