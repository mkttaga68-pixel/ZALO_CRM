# AI QC sandbox refresh and browser E2E — 2026-11-01

Final browser run: **16 PASS, 0 FAIL, 0 NOT_RUN**. This is real Chrome/Playwright evidence against the refreshed native sandbox, not SSR or mocked API responses. Production activation remains outside scope.

## A. Sandbox refresh result

Read `AGENTS.md`; recorded HEAD/working tree and preserved existing uncommitted edits. Verified the recorded native process command lines, listening ports, exact PostgreSQL names/data_directory, empty synthetic CRM customer/message/account tables and existing monitoring tables before refresh. Created fresh synthetic organizations, owner/read-only/other-tenant users and a copy of repository synthetic Markdown fixtures. No real Windows Obsidian Vault was read or changed in this run.

Refreshed only the verified backend/frontend processes. PostgreSQL was retained. Backend uses the existing CRM app entry point with the pre-import outbound-denying synthetic guard. Frontend uses existing Vue/Vite source with a sandbox-only cache directory and CI mode. No Docker Compose command or production container mutation was performed.

Ready endpoints: `http://127.0.0.1:3091/health` and `http://127.0.0.1:5174/ai-quality-control`; authenticated monitoring health also passed directly and through the frontend proxy.

## B. Frontend/backend version

- Git HEAD: `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`; working source is uncommitted, so HEAD alone does not identify the patch.
- Backend PID at final refresh: 23960; compiled native CRM backend, port 3091.
- Frontend PID at final refresh: 28436; Vite 8.0.2, port 5174, proxy explicitly 3091; isolated cache under the evidence directory.
- Database: PostgreSQL 18 synthetic cluster, loopback 59941; `ai_qc_sandbox_crm_mvxj0im3` and `ai_qc_sandbox_knowledge_mvxj0im3`.
- Browser: installed Chrome `156.0.8078.74`; Playwright Core `1.56.1`. The owner separately approved that one npm download. Registry metadata identified `microsoft/playwright`, exact npm tarball and matching package-lock SHA-512 integrity. Install scripts were disabled; no browser binary was downloaded and CRM dependencies were not changed.
- Backend monitoring/frontend build opt-in ON only in sandbox process environments; real data, real provider and both outbound approvals OFF. Ordinary CRM workers/Zalo reconnect stay disabled by the verified synthetic profile; the explicitly opted-in Mock monitoring worker is running.

Exact source/compiled hashes and process metadata: `version-manifest.json` in the final evidence directory. No API key, password or token appears there.

## C. Browser E2E results

| Case | Actual result |
| --- | --- |
| 1. Open QC and synthetic login | PASS, fresh browser storage and real login form |
| 2. Obsidian Brain list/state | PASS, allowlisted synthetic Vault preview and 4 DRAFT documents |
| 3. DRAFT exclusion | PASS, Mock run NOT_EVALUABLE and empty knowledge snapshot |
| 4. Approve synthetic fixture via UI | PASS, explicit hash/revision/effective-date workflow |
| 5. Mock analysis/citation | PASS, COMPLETED, exact approved revision/hash/quote displayed |
| 6. Scheduled revision | PASS, edited only fixture copy; hash changes, revision 2 approved for 2035 and SCHEDULED shown |
| 7. Keep predecessor effective | PASS, new analysis still selects revision 1, not scheduled revision 2 |
| 8. Synthetic source snapshot/queue | PASS, fixture producer persisted one durable job; not a production Message writer hook |
| 9. Running worker/warning | PASS, actual background worker recorded Mock evidence and warning without manually calling tick |
| 10. Realtime dashboard | PASS, browser received actual Socket.IO invalidations and warning row appeared without manual reload |
| 11. Evidence drawer | PASS, warning detail, source messages, quote, revision and evidence/content hashes displayed |
| 12. Reviewer UI | PASS, read-only actor can view allowed evidence, has no review button |
| 13. Reviewer API denial | PASS, attempted review returned 403 |
| 14. Tenant isolation | PASS, other tenant list empty and foreign warning detail 404 |
| 15. No OpenAI/Zalo outbound | PASS within instrumented browser/backend boundaries; runtime flags OFF and backend outbound guard denies external network |
| 16. Version/health/errors | PASS, Mock health, DONE job and no browser page exceptions |

Each context started without personal/production profile, cookies or credentials. Browser HTTP/WebSocket routing allows only localhost/127.0.0.1 ports 5174 and 3091; service workers are blocked. Node/browser environments are scrubbed. Raw login bodies/headers, Socket.IO authentication frames, storage state and traces containing credentials were deliberately not persisted. Playwright closes its disposable browser profile at completion.

## D. Obsidian Brain UI

The existing route is `/ai-quality-control` → Obsidian Brain tab, not a new route. Browser saved the synthetic allowlisted path, previewed and synchronized four draft fixtures. It created a server synthetic dataset and analyzed it before approval, confirming no draft knowledge was used.

An authorized synthetic owner explicitly approved the insult fixture through the UI. A new Mock analysis displayed a rule quote, UTF-8 byte range, revision 1 and SHA-256. The fixture file was then edited, synced to revision 2 and published with future effectiveFrom through the same UI. Its SCHEDULED marker was visible; subsequent analysis retained revision 1. Real Vault policy was not approved or edited.

## E. Auto-monitoring E2E

The fixture producer runs outside the backend process, uses only the identity-verified synthetic knowledge database, and atomically persists a server-generated synthetic conversation snapshot with its job through `SyntheticMessageAdapter`. There is no browser enqueue button and no production ingestion hook; this test intentionally combines browser observation with that approved programmatic fixture producer.

Actual job ID: `job-d399e8a8d638af1a6c84f2a271c8f6192b385be064bfcc22d5447cfc41027945`; final state DONE, one attempt. The running backend discovered the new tenant/job without receiving the producer's in-memory wakeup event, executed Mock analysis and stored two warnings: CONDUCT_NEEDS_REVIEW plus INSUFFICIENT_EVIDENCE for other unavailable rules/context. These are observations, not confirmed employee violations.

Evidence IDs, analysis run IDs, source/evidence hashes, chosen knowledge revision and outbox ACKs are saved in `queue-worker-evidence.json`. No CRM customer/message rows or real conversation were used by the fixture producer.

## F. Realtime dashboard result

The browser captured four `qc:warning-updated` frames across the authorized owner and read-only contexts, containing only delivery ID, warning ID and version. The Warning Center refreshed automatically. Detail rendering and unauthorized review were checked through actual browser/API requests. The other-tenant context received no accessible warning content. Persisted delivery/recipient ACKs were collected afterward.

This verifies the real CRM runtime JWT/account/grant composition as well as the namespace adapter. It is stronger than the earlier programmatic Socket.IO test using fixture token resolution.

## G. Failed attempts, fixes and remaining limits

Earlier attempts are retained in separate run directories, not relabeled PASS. Failures included a Vuetify combobox click selector, ambiguous SCHEDULED text, a test-harness UTF-8 rewrite mistake (restored), and dev-server connection/reset/reload interference. Final harness uses keyboard combobox selection, exact status text and waits for actual UI completion. Vite sandbox now has an isolated cache/CI launcher. Dependency-optimization reloads were observed in Vite logs; the final clean fixture run completed after the cache was warmed.

One monitoring defect was fixed within the approved change set: durable jobs for a tenant not yet known at startup could wait indefinitely if no in-process bus wakeup arrived. Runtime now rediscovers persisted tenant jobs on each poll. SLA fixture authorization failures are isolated per job so an obsolete fixture cannot abort processing of other tenants. GitNexus impact was attempted before the runtime edit; the graph returned UNKNOWN/target-not-found even after refresh, so the sandbox-only bootstrap caller was checked directly and the fix was validated against the actual running process/browser. No production/shared writer/router edit was made.

Final run has **zero page exceptions**, but does not claim zero console/network errors: 17 console resource errors were recorded. These correspond to blocked external font requests and expected 401 anonymous/pre-login background requests, 403 review/health permission probes and the cross-tenant 404. Navigation also aborted some unrelated dashboard requests. Six attempted Google Fonts requests were blocked before browser dispatch; fonts were not fetched. No unexpected QC 5xx response was observed in the final run. This is process/browser policy evidence, not a claim of OS-wide packet capture/firewall enforcement.

Not implemented/not exercised: browser-native enqueue control, integration with the production CRM Message writer, real AI provider, real-data monitoring, authoritative overdue-care data, sustained-load/SLO acceptance and production activation. Browser approval-state coverage here is DRAFT/APPROVED/SCHEDULED; revoked-rule exclusion remains covered by backend tests, not an additional revoke click in this browser scenario.

## H. Production isolation and evidence

Production remains Docker `zalo-crm-app`, image `zl-crm-app:ai-qc-shared-20261101`, port 3080. Sandbox is native and separate; no production volume/container was used. Production container ID/image/StartedAt were compared before refresh and after browser completion and match exactly. No production database connection was opened. No Cloudflare/public CRM URL was accessed.

Final evidence root: `C:\Zalo CRM\aiqc-browser-e2e-20261101\run-1793532804872`:

- `results.json`: per-case PASS/FAIL, sanitized API/request/console failures, blocked attempts and Socket.IO event records.
- `02-draft-list.png`, `03-draft-excluded.png`, `05-rule-citation.png`, `06-scheduled-revision.png`.
- `10-realtime-warning.png`, `11-warning-evidence.png`, `12-reader-no-review.png`, `14-other-tenant-empty.png`.
- `queue-worker-evidence.json`, `version-manifest.json`, `production-after.json`, `evidence-secret-scan.json`.
- Regression rerun copies: monitoring backend 19 PASS, monitoring frontend 6 PASS, existing backend 117 PASS, existing frontend 7 PASS.

Parent evidence directory also contains refresh result, frontend cache/version metadata, isolated logs, fixture IDs and package-lock provenance. JSON evidence scan found neither the synthetic password nor a JWT. API key material was never read. Screenshots contain synthetic fixtures only.

Source changes in this phase: the small runtime polling/isolation fix plus sandbox/test scripts `refresh-aiqc-e2e-sandbox.cjs`, `aiqc-e2e-vite.mjs`, `start-aiqc-e2e-vite.cjs`, `aiqc-e2e-inject.mjs`, `aiqc-browser-e2e.cjs`, `collect-aiqc-e2e-evidence.cjs` and this report. Existing uncommitted changes were retained; no commit was made.

## I. Exact next action

The verified sandbox is left running at `http://127.0.0.1:5174/ai-quality-control`. Manual review can use the E2E owner account listed in `E2E-LOGIN-INSTRUCTIONS.txt` in the parent evidence directory; it references the existing synthetic password file without duplicating the password. The original sandbox account belongs to another synthetic organization and will not see this test tenant's warnings.

Next is owner acceptance of the screenshots, rule workflow and warning behavior. Production Vault mount/tenant configuration, production ingestion, retention/scale work and any production deployment remain separate approvals. This result does not enable OpenAI or authorize real monitoring.
