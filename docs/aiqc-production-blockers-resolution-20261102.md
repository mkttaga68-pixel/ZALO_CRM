# AIQC production blockers — resolution evidence (2026-11-02)

## Decision

**Phase A: NO-GO.** This work changed sandbox source/configuration and reviewed artifacts only. No production restart, deploy, CRM-data analysis, Cloudflare change, or rule approval occurred. The production app remains on image digest `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`.

## Feature flag findings

Production container inspection found `AI_QC_ENABLED=true` and `AI_QC_REAL_DATA_ENABLED=true`; `AI_QC_OLLAMA_ENABLED` and `AI_QC_AUTO_MONITOR_ENABLED` were unset. Real API and outbound approval flags were false. The active Compose files `docker-compose.override.yml` and `docker-compose.ai-qc.yml` set the first two flags true. `providerEnvironment()` reads flags during bootstrap; `bootstrap.ts` conditionally registers monitoring and retention at startup. AIQC routes are mounted but guarded by the startup environment; the CRM read adapter is enabled by `AI_QC_REAL_DATA_ENABLED`.

This is an unsafe configuration for an AI-off phase because authorized AIQC routes can access CRM conversations. At inspection time Ollama was disabled/unset, no model was resident (`ollama ps` empty), automatic monitoring was not registered, the AIQC workspace had zero rows, and no active AI inference was evidenced. Therefore this is a **configuration exposure, not evidence of ongoing model processing**. Do not interpret it as proof that no authorized/manual reads could occur.

Turning these flags off in production requires an approved app recreation because they are captured at startup. No change was made. `docker-compose.ai-qc-phase-a.review.yml` prepares `AI_QC_ENABLED=false`, `AI_QC_OLLAMA_ENABLED=false`, `AI_QC_REAL_DATA_ENABLED=false`, monitoring/manual/outbound flags false, and the tenant allowlist/read-only vault mount. This overlay is review-only and has an unset image placeholder; applying it is not authorized here.

## Obsidian registry

- Vault: `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN`.
- Tenant target: ASLAN GLOBAL / `a236afea-cc9c-4de8-81c0-ee5923385b2e`.
- Manifest `00_BAT_DAU/MANIFEST_SHA256.md`: **21/21 hashes match** on recheck.
- All 20 documents remain version 0.1, DRAFT, `UNASSIGNED`; none is an active approved rule. Sixteen policy candidates are listed for an administrator in [the approval register](aiqc-obsidian-approval-register-20261102.md); four governance/template/synthetic-test documents are excluded from the policy registry.
- The UX-001 manifest entry was repaired to the file's verified SHA-256; rule content was not changed. This does not approve, assign, revise, or set effectivity.
- Review Compose overlays mount only the vault root read-only and map it to the ASLAN org ID. Production currently has no such mount or tenant allowlist.

## Backup, restore and rollback

- Available production DB dumps inspected were from Oct 24–26; latest was `pre-bot-auto-permission_20261026_180209.sql` (7,944 bytes), too stale for a deployment backup.
- A PostgreSQL 16 isolated restore rehearsal completed from `pre-migration-crm-tag-events_20261025_171415.sql` in a disposable `--network none` container with a read-only backup mount. It restored 73 tables. **This proves only that this stale dump can be restored in isolation; it is not a current backup and does not prove production recovery.**
- Rollback review overlay pins the currently running image digest and has AI/data/outbound flags off. It has not been applied or exercised. No fresh protected DB/config backup, restore rehearsal from that backup, or end-to-end rollback test exists. Rollback gate: **FAIL / NOT READY**.
- Current migration `20261101120000_native_ai_quality_control` is applied and its workspace table is empty. This does not replace compatibility review against the exact reviewed release image.
- Before any restart, verify Zalo sessions, in-memory queues and callbacks are drained or recoverable. Their quiet-state was not verified. A maintenance window is not approved.

## Resource protection and tests

Sandbox implementation now gates Ollama behind `AI_QC_OLLAMA_ENABLED=true` plus required telemetry/kill-switch configuration, limits concurrency to 1 and queued requests to 2, has a 60-second queue wait, 120-second provider timeout, circuit breaker, telemetry freshness/resource thresholds, and an inference kill switch. Added host resource monitor and review-only synthetic phase-B overlay. Unit coverage verifies disabled-without-guard, serialization, queue bound, circuit breaker, low RAM and kill switch.

| Validation | Result |
|---|---:|
| TypeScript build | PASS |
| Native AIQC isolated suite | 139/139 PASS |
| Guarded AIQC/manual isolated suite | 190/190 PASS |
| Targeted chat/auth regression tests | 44/44 PASS |
| Broad default backend suite after fixture fixes | 653 passed; 31 test/guard failures remain because guarded control/manual cases require their isolated runner; use the dedicated runner above |
| Isolated restore rehearsal | PASS for stale 2026-10-25 dump only |
| Resource monitor smoke | PASS; host sample ~20.3% CPU, ~5.47 GiB available RAM, RTX 3060 ~10.8 GiB free VRAM, ~5% utilization |
| CRM core + Ollama concurrent load | NOT RUN; Ollama inference on the CRM host risks contention and no safe isolated production-equivalent host was available |
| Production backup/rollback | FAIL / NOT RUN |

No Ollama load was generated during the resource smoke. Earlier 4B inference evidence in the shared environment showed available RAM falling to ~2.42 GiB and GPU utilization reaching 100%; the new 3 GiB RAM floor would block inference at that observed minimum. The isolated unit tests do not establish safe concurrent operation with production CRM.

## Test runner note

The raw full `npm test` invocation includes OpenAI-control/manual-real tests that deliberately fail closed without `QC_TEST_ROOT`. They passed under `node scripts/run-openai-control-tests.cjs`, which uses the isolated controlled transport; no OpenAI API was called. The media regression fixture now stubs `downloadMediaBuffer`; the targeted regression run did not contact MinIO. An earlier synthetic media route run reached the configured MinIO endpoint and received `403 SignatureDoesNotMatch`; no object was downloaded or written. The test now uses the stub.

## Remaining blockers / approvals

1. Approve a maintenance window and restart/quiet-state procedure before applying the AI-off phase-A overlay.
2. Produce and protect a fresh DB/config backup, verify integrity, restore it in isolation, and test rollback using the exact immutable candidate.
3. Review and approve the scoped release source. The working tree contains broad unrelated modifications; do not build a production image from it until source scope is clean and approved.
4. Have the tenant's authorized administrator review the 16 draft policy candidates, assign tenant/ACL/effective dates and publish exact revisions through the Knowledge Registry. No draft is approved by this report.
5. Verify production dashboard roles/audit behavior and exact migration compatibility.
6. Run CRM-core/Ollama contention and latency monitoring on a production-equivalent isolated host; validate CPU/RAM/GPU thresholds under representative synthetic load.
7. Complete Zalo session, in-memory queue and callback quiet-state checks in the approved maintenance window.

Until these gates pass, **do not deploy phase A or enable real-data processing**. Phases B and C remain not run.
