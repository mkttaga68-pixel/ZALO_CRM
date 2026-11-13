# AI QC on the existing CRM origin — 2026-11-02

Owner decision: the operational AI QC UI is `http://localhost:3080/ai-quality-control`, on the current CRM backend, current CRM accounts/database and existing RBAC. Synthetic test services on 5173/3091 are not an additional login/control layer for normal CRM users. No production account/password/grant was copied to or created in the sandbox.

Verified on the running CRM: the UI path returns HTTP 200 HTML; anonymous `/api/v1/ai-quality-control/status` returns 401. This confirms the existing route and authentication boundary, not approval of the latest image/Vault/OpenAI deployment. No production login/password or customer data was used by these probes. The current production image already contains the earlier shared-backend QC module; the latest revision/secret/budget candidate has not been deployed and the real Vault is still unmounted there.

Existing controls reused without changing their code:

- Frontend route requires auth and `ai_quality_control.access`; menu uses the same access grant.
- API uses CRM authMiddleware/current persisted account checks. QC bootstrap resolves current `userHasGrant` for access/create/edit/approve/delete/view_all and current department membership scoped to the account's org.
- Services apply action permissions and tenant/department/document/conversation ACLs; hiding a button is not the security boundary.
- AI Quality Control is already present in the CRM permission-group editor. Owner retains the existing owner bypass; ordinary staff should receive only their required grants.

Action meanings: access opens the module, create permits analysis/training creation, edit permits configuration/sync subject to additional Vault-admin checks, approve permits approval/review subject to service checks, delete permits approved retention/deletion workflows, view_all broadens visibility inside the permitted organization subject to remaining resource/privacy checks. No new permission was automatically assigned to any staff member. Do not equate approving a finding for follow-up with confirming an employee violation.

Prepared `docker-compose.ai-qc.single-origin.review.yml`, NOT_APPLIED. Merge last after the final closure overlay. Its only effective difference from that reviewed deployment is AI_QC_ENABLED=false→true. It adds no port or service and keeps real API, real-data read/outbound and automatic monitoring flags false. The existing image/RO Vault/ASLAN allowlist/secret/budget mounts remain governed by the final reviewed closure overlay.

Compose render PASS: published ports unchanged, other services unchanged, exactly one flag changes. Sanitized evidence: `C:\Zalo CRM\aiqc-readiness-closure-20261102\single-origin-review.json`.

This request establishes one-origin architecture and permission management. It does not waive the owner's explicit withheld restart/maintenance permission or approve sending customer/employee data to OpenAI. The existing module can be opened on 3080 now with the real CRM account; deploying the tested new Obsidian/OpenAI code and mounting Vault still needs the reviewed app-only release decision. No container restart, overlay application, database write, grant mutation, OpenAI request or Cloudflare change occurred in this turn.
