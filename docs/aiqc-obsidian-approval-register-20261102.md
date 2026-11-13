# Obsidian AIQC approval register — 02/11/2026

**Target tenant (not assigned here):** ASLAN GLOBAL / `a236afea-cc9c-4de8-81c0-ee5923385b2e`.

The vault contains 20 rule/governance/test documents plus the `GUIDE-001` onboarding README: 21 Markdown documents with frontmatter total. All 21 are version `0.1`, status `draft`, and `tenant_scope: UNASSIGNED`. None is an active Knowledge Registry rule. An authorized ASLAN administrator must review policy content, define ACL/tenant/effectivity/revision in the Registry, then approve each applicable policy. This register does not publish or assign any document.

## Policy candidates requiring administrator review

| ID | Version | Document | Intended review scope |
|---|---|---|---|
| UX-001 | 0.1 | Không xúc phạm khách hàng | Conduct policy; scope, evidence, quote/negation exceptions |
| UX-002 | 0.1 | Lịch sự, lắng nghe và đồng cảm | Courtesy policy and neutral/brief responses |
| UX-003 | 0.1 | Xử lý phàn nàn và tình huống căng thẳng | Complaint handling and respectful escalation |
| CSKH-001 | 0.1 | Lịch chăm sóc sau mua | Customer care intervals and exclusions |
| CSKH-002 | 0.1 | Yêu cầu chưa được giải quyết | Assignment, coverage, work calendar and SLA |
| SLA-001 | 0.1 | Định nghĩa chỉ số phản hồi | KPI definitions and eligible-turn denominator |
| SLA-002 | 0.1 | Bảng ngưỡng SLA cần phê duyệt | Thresholds/approval needed before any SLA rule |
| CA-001 | 0.1 | Hoạt động tin nhắn trong ngày nghỉ | Working/off-day intervals and attribution |
| CA-002 | 0.1 | Bàn giao và phân công khách hàng | Assignment and handoff evidence |
| SP-001 | 0.1 | Nguyên tắc tư vấn sản phẩm | Source of truth and allowed assertions |
| SP-002 | 0.1 | Biểu mẫu thông tin sản phẩm đã xác minh | Must be populated/verified by product owner before use |
| TH-001 | 0.1 | Phân biệt lời xúc phạm và lời trích dẫn | Direct/indirect insult; quotation and reporting exceptions |
| TH-002 | 0.1 | Khách chờ, chăm sóc và ngày nghỉ | Conversation examples only after label/evidence review |
| AI-001 | 0.1 | Chứng cứ, UNKNOWN và ABSTAIN | Evidence rules and abstention boundaries |
| AI-002 | 0.1 | Cảnh báo và quản lý đối soát | Human review, correction and audit workflow |
| AI-003 | 0.1 | Phân quyền và an toàn bộ não RAG | Tenant/ACL, retrieval and prompt-injection controls |

All rows above remain `DRAFT / UNASSIGNED`; target tenant/effectivity is **pending administrator decision**.

## Keep out of the production policy registry

| ID | Version | Document | Handling |
|---|---|---|---|
| DUYET-001 | 0.1 | Quy trình phê duyệt tài liệu | Governance procedure; administrator review, not an AI finding rule |
| DUYET-002 | 0.1 | Biểu mẫu quyết định phê duyệt | Approval form/template; not a rule |
| TEST-001 | 0.1 | Bộ hội thoại synthetic để kiểm thử | Synthetic fixture only; no policy authority |
| TEST-002 | 0.1 | Biểu mẫu kết quả kiểm thử | Test report template; no policy authority |
| GUIDE-001 | 0.1 | README hướng dẫn sử dụng | Onboarding guide; keep out of the policy registry unless an administrator separately classifies it |

## Hash manifest repair

Only `01_QUY_TAC_UNG_XU/UX-001_KHONG_XUC_PHAM.md` differed from the SHA-256 manifest. The vault file timestamp is 01/11/2026 17:16:52, later than the vault's 17:05 setup files; the manifest still contained its earlier hash `86b55f4d621025db3224ef1cd0b475dba993d2c51ea6cb9836716f8ea81ae7ff`. Its verified current SHA-256 is `5f45c357e891c6baf99d5dc8ab8ea0f112cf01190ee4a2850847b1b3469ad7dc`. The manifest entry was updated after checking that 20 other entries matched. **The rule content was not edited.** This repairs file integrity only; it is not an approval, revision, tenant assignment, or effective date.

## Read-only mount proposal

The review overlays map the host vault to `/run/aiqc/obsidian` with `read_only: true` and allowlist that root only for the ASLAN organization ID. This directory mapping does not change frontmatter. Registry retrieval must continue to reject the existing draft/unassigned documents. Do not activate a policy until its separate Registry approval and hash/revision/effective-time checks pass.
