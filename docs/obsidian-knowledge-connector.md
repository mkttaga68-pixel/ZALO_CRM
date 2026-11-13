# Obsidian Knowledge Connector — verified 2026-11-01

## Architecture and scope

Read `AGENTS.md` and inspected the current native module under `backend/src/modules/ai-quality-control`. The implementation uses existing Fastify routes/auth/RBAC, Vue administration, knowledge services, workspace repository and provider. Removed Sprint 1–5 modules are not dependencies.

The running CRM backend is Docker (`zalo-crm-app`, port 3080), not a Windows-native backend. Windows Vault paths must be bind-mounted to a Linux path. Merely saving a Windows path in the browser does not expose that directory to Docker.

Flow: Windows Markdown → read-only mount `/knowledge/obsidian` → tenant allowlist → preview → sync DRAFT revisions into workspace → explicit approval → ACL/effective-date-filtered retrieval → analysis with byte-accurate citations. Obsidian remains the authoring source; CRM stores reviewed snapshots. Editing Markdown or front matter never auto-approves a policy. Missing files do not automatically revoke an approved snapshot; use explicit revocation.

No app/server, listener, production router, customer-data operation or Cloudflare change was added in this task. No existing function/class/method was edited. GitNexus tools required by `AGENTS.md` are unavailable in this session; this work reused existing runtime symbols and added verification/configuration/documentation only. No commit was made.

## Real Vault verification

Host: `C:\Users\ADMIN\Downloads\ZALO_CRM_AI_BRAIN`.

Run from repository root with Docker access:

```powershell
node scripts/verify-obsidian-vault-sandbox.cjs
```

The runner uses the exact image ID of the running CRM, overrides its entrypoint, disables networking, publishes no port, mounts the Vault and test script read-only, makes the container root filesystem read-only and uses only ephemeral memory plus `/tmp`. It does not import app/bootstrap/database singletons, load dotenv or inherit keys. Existing routes are exercised with Fastify injection and synthetic authentication. CRM container identity/start time are compared before and after.

Actual results: 22 Markdown files, zero scan issues. Existing-file write handles denied by mount; all Markdown content hashes unchanged. PASS: DRAFT excluded, approved retrieval, revoked excluded, wrong permissions, tenant and path, wrong publication hash, changed revision, invalid citation hash/revision/quote, repeat sync adding zero revisions, synthetic Mock analysis with Vault knowledge snapshot, real provider request denied. Approval/revocation of a real Vault document occurred only in the disposable in-memory workspace, not in the Vault or CRM database. Revision-change verification wrote only a disposable synthetic file in `/tmp`.

The existing dedicated suites were also rerun: 101 backend tests and 7 frontend SSR tests PASS. SSR is not browser interaction testing. Evidence: `C:\Zalo CRM\obsidian-vault-sandbox-evidence-20261101\result.json`.

## Administration and retrieval

The existing `Obsidian Brain` tab provides vault path, preview, DRAFT sync, document revision/hash, approval and revocation. `Trung tâm huấn luyện` creates server synthetic datasets and runs Mock analysis. No new production route or UI deployment was needed for these existing features. Live browser connection to this Windows Vault has not been performed by this task.

Vault administration requires `access`, `edit` and `view_all`; publication additionally requires `approve`. Department restrictions are enforced by the existing publishing and retrieval services. Tenant paths are server-controlled via `AI_QC_VAULT_ROOTS_BY_TENANT`; a user cannot grant themselves filesystem access through settings.

Retrieval is local lexical chunk ranking, not embeddings/vector search. It selects at most 12 chunks from approved, effective, authorized document versions and records source revision, SHA-256 and UTF-8 byte offsets. Retrieval quality for arbitrary semantic queries remains an acceptance task. The aggregate workspace's existing capacity/retention limits still apply.

## Provider and secrets

The existing backend `OpenAIProvider` uses official SDK `responses.create`, strict JSON output schema, `store:false`, a fixed official API endpoint and explicit budget/model/outbound gates. The protocol was checked against [official Responses documentation](https://developers.openai.com/api/docs/guides/migrate-to-responses). The test calls no real provider and reads no real key. Backend key injection uses `OPENAI_API_KEY`; key material is never accepted by QC settings or returned in API responses. Existing Windows secret-launch tooling is separate from the Linux container; no key was migrated, validated or stored by this task.

Keep `AI_QC_REAL_API_ENABLED=false`, `AI_QC_OUTBOUND_TEST_APPROVED=false` and `AI_QC_REAL_DATA_OUTBOUND_APPROVED=false` until a separately authorized provider test. Mounting this Vault does not authorize external transmission of its content.

## Remaining activation conditions

Sandbox connector verification succeeded. The running production app does not yet mount this Vault. Live integration still needs a separate authorization to add the read-only mount and tenant allowlist to that existing app and recreate it. `docker-compose.obsidian.example.yml` is an unapplied configuration example: replace `REPLACE_WITH_ORGANIZATION_ID` with the authorized organization's actual ID; preserve existing app volumes/flags and inspect the merged configuration. `create_host_path:false` refuses silently creating a wrong host path.

Once the backend has that mount/allowlist, a permitted administrator can save `/knowledge/obsidian`, preview and sync DRAFTs, then explicitly approve selected revisions with rule metadata and effective dates. No production workspace setting or policy was written here. This is intentionally not a claim that the live CRM is already connected to the Vault.
