# Bounded synthetic OpenAI test — 2026-11-02

Result: **FAIL / project access blocked**. One actual POST to `https://api.openai.com/v1/responses` returned HTTP 401 with sanitized error code `invalid_project`. Requested project: `proj_6yDB6qP8X45ofaQO99BW2Bqy`; requested model: `gpt-6-luna`. No alternative project/model was attempted. Project membership, key acceptance in this project, and model availability remain unverified.

The owner explicitly waived rotation for this run. AGENTS.md does not impose mandatory rotation. Existing CurrentUser Windows DPAPI secret was decrypted only in process memory and sent to the short-lived Node child over stdin. No plaintext secret file, command argument, frontend value, credential log, or production injection was created.

## Executed checks

- Isolated PostgreSQL identity verified: loopback 59941, `ai_qc_sandbox_knowledge_mvxj0im3`, data directory `C:/Zalo CRM/native-ai-qc-runtime/mvxj0im3/postgres-data`. All queries ran in a READ ONLY transaction.
- Existing E2E fixture organization `fce47a81-5420-47c3-8d66-95fd218b1358`; no ASLAN customer records were read.
- Retrieval selected one previously approved fixture document, revision 1, with four valid chunks. Its scheduled revision 2 (effective 2034-12-31T17:00:00Z) and DRAFT documents were excluded. No document was approved or modified by this test. This is fixture knowledge, not proof of production Vault activation.
- Existing OpenAIProvider and current source retrieval reused through a standalone CLI acceptance runner; no new service/server or application bootstrap.
- Five offline assertions PASS: sixth request blocked, stop marker, session expiry, rate limit, CRM source denied.
- Live session: **1 of maximum 5 requests** consumed, staff-insult synthetic scenario. Provider returned `OPENAI_AUTHENTICATION_FAILED`; HTTP evidence identified `invalid_project`. Remaining scenarios NOT_RUN.
- No completed model response, Structured Output validation, returned model ID, citation output, or usage was obtained. Zero usage observed is not actual usage confirmation; estimated cost is unavailable, not a billing claim.
- Dashboard and Browser E2E NOT_RUN. No analysis result was written into the CRM database.

## Session controls

The runner has a persistent non-resetting request ledger, 30-minute expiry, concurrency 1, at least 12.5 seconds between dispatches, 15-second network timeout, output limit 4096, request body limit 64 KiB, and exact POST endpoint restriction with public DNS/IP pinning, certificate verification and no redirects. SDK retries are disabled; any provider-level retry is subject to the same ledger/rate checks. Only approved effective tenant-scoped fixture chunks and synthetic messages can be sent.

An explicit factory injection scopes this session independently of the production monetary guard, as authorized. The production guard and all runtime feature flags were unchanged. The `STOP` marker was created after failure; this run cannot silently resume. No production restart, Docker overlay, Cloudflare change, real customer outbound, or auto-monitoring activation occurred.

Evidence: `C:/Zalo CRM/aiqc-semantic-session-20261102/sandbox-preflight.json`, `bounded-session.json`, `bounded-api-results.json`, `STOP`. The older rotation-preflight.json records the earlier blocked attempt and predates the owner's waiver.

Git baseline: `ba4c821365c25d6e5dbe8af3767922fd4d6ff032`; working tree already contained uncommitted changes and was preserved. New runner symbols were absent from GitNexus (impact UNKNOWN); no existing business symbol was edited.

Next action: confirm that the configured project ID is correct and that the existing key is authorized for that exact project in OpenAI Platform. Do not send keys in chat. Reopen a bounded session only after that discrepancy is resolved; do not omit the project header or automatically switch projects/models.
