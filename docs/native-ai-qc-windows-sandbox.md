# Windows development sandbox — running existing CRM with native AI QC

The frontend originally used the default proxy target on port 3080, where the native development-only API is not registered. Enabling the frontend flag alone cannot add that backend API.

The existing CRM now has a verified synthetic startup profile, separate from production. It uses the same backend entry point, frontend, authentication, RBAC and Prisma code. No second CRM implementation or separate AI server was created.

## Current running instance

- UI: `http://127.0.0.1:5174/ai-quality-control`.
- Backend: loopback `127.0.0.1:3091`.
- PostgreSQL 18: loopback `127.0.0.1:59941`.
- Runtime root at this delivery: `C:\Zalo CRM\native-ai-qc-runtime\mvxj0im3`. Check `latest.json` under its parent after a later start.
- Login: `ai-qc@sandbox.invalid`. Its generated synthetic password is in `SYNTHETIC-LOGIN.txt` under that runtime root. Do not use production credentials here.
- Browser storage is separate from the frontend on port 5173. Log in with the synthetic account, then open the AI QC menu/path.

The sandbox has one synthetic owner, zero CRM contacts/messages/Zalo accounts, four Markdown versions staged as DRAFT and one server-generated polite conversation. No policy was automatically approved. The administrator must explicitly approve a synthetic rule/type/effective date before expecting a substantive mock analysis. Without approved rules the correct result is NOT_EVALUABLE/ABSTAIN.

## Boundaries proven during startup

The launcher creates a new cluster inside its own unique runtime directory, then verifies `data_directory`, database name, loopback address and port before any schema operation. The application database and QC workspace database have distinct `ai_qc_sandbox_*` names. The CRM schema is pushed only into that fresh empty disposable database; only the native QC migration is applied to the separate workspace database. No production schema/migration is run.

Environment inheritance uses an OS-variable allowlist; no dotenv is loaded. JWT/encryption/database credentials are generated for this instance. OpenAI, Zalo, CRM real-data and outbound approval flags remain false. API key material is not inherited.

Before importing the app, a network guard denies fetch, HTTP, HTTPS, TLS, UDP and non-loopback DNS; outgoing TCP is restricted to the sandbox PostgreSQL port. The external-host probe is blocked before connecting. This is Node-process isolation, not a host firewall claim.

The sandbox profile is rejected without guard proof, a matching loopback sandbox database, test NODE_ENV and disabled real-data/API flags. Existing production behavior remains unchanged when that profile is absent. The profile skips startup workers/cron/event processing, bucket probes, bootstrap-admin creation and Zalo reconnect. Existing auth can seed its lead-scoring configuration in this disposable organization; that is unrelated to AI employee scoring, which remains disabled.

Actual runtime probes passed: database health; existing CRM login/profile; authenticated native status/workspace; anonymous access blocked; staging DRAFT documents; creating/analyzing a synthetic dataset with missing policies correctly returning ABSTAIN; persistent PostgreSQL run retrieval; snapshot replay; real-data/API paths blocked; frontend proxy -> native backend. QC writes use the separate PostgreSQL workspace store. This is a smoke test, not complete PostgreSQL concurrency/constraint or browser E2E acceptance.

Evidence: `runtime-evidence.json`, `http-smoke-evidence.json`, `cluster-identity.json`, `backend-isolation.json` and logs in the runtime root. The backend regression suite now has 80 PASS; the frontend suite has 6 PASS. Backend typecheck/build passed with this profile.

The live PostgreSQL check exposed an object-key ordering bug: JSONB can reorder keys, so plain JSON.stringify-based conversation/snapshot hashes changed after a database round trip. Logical JSON hashes and citation-object equality now use recursively sorted object keys; array order and exact strings remain significant. Raw Markdown hashes still use original UTF-8 bytes. Two regression tests cover reordered conversation provenance, stored snapshot replay and tampering. Old failed-run fixtures/evidence were retained; the corrected demo uses a fresh database and does not rewrite prior snapshots.

## Start and stop

```powershell
# From repository root; build first when backend source changes.
npm --prefix backend run build
node scripts/start-native-ai-qc-sandbox.cjs

# Authenticated synthetic HTTP smoke, persistence, replay and disabled outbound paths.
node scripts/verify-native-ai-qc-sandbox.cjs

# Stops only the recorded sandbox after checking process/data-directory identity.
node scripts/stop-native-ai-qc-sandbox.cjs
```

Windows may require permission for pg_ctl to create a restricted process token; do not bypass filesystem/process controls. The launcher rejects occupied ports and never replaces another process. Each successful fresh start uses a new data directory; it does not reuse or overwrite a previous database. Stop retains all synthetic data/evidence; no recursive deletion is performed. `latest.json` under `native-ai-qc-runtime` records the most recently started instance.

The earlier failed startup attempts are retained as evidence. Corrections were limited to Windows daemon stdio handles, canonical IP representation and file-URL syntax for Node's pre-import option. Each failed attempt's own cluster was stopped; the first attempt was prevented from starting by Windows permissions.

Production/Cloudflare configuration and port 5173 were not changed. Real API/data, production AI QC, employee scoring and violation confirmation remain disabled. G1–G10 are not closed by this runtime smoke test.
