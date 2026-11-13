# Ollama AI Quality Control — 02/11/2026

**Kết luận: sandbox tích hợp được; production NO-GO do chất lượng ngữ nghĩa chưa đạt.**

Repository: `C:\Zalo CRM\ZL-CRM`. Không commit, deploy hoặc restart production. Đã đọc AGENTS.md; người dùng cho phép phân tích tĩnh callers/imports thay GitNexus impact trong phiên này. Phạm vi ảnh hưởng: provider factory → Conversation Analyzer → Training Center/routes → Dashboard; registry retrieval dùng chung với phân tích và tra cứu lịch sử. Mức rủi ro trung bình trong module QC. Các thay đổi khác có sẵn trong working tree được giữ nguyên.

## PASS/FAIL

| Hạng mục | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| POST `/api/chat` thực tế từ container | PASS | HTTP 200, model `qwen3:4b-instruct`, JSON `{"ok":true}`. Container tạm dùng image sẵn có; không pull model. |
| Provider abstraction | PASS | `OllamaProvider` qua `AIProviderService.forSettings`, dùng Conversation Analyzer hiện có. |
| Registry Obsidian hiện có | PASS — synthetic | Live retrieval chỉ nhận APPROVED, đúng tenant/ACL, còn hiệu lực, hash khớp. Sáu kiểm tra loại DRAFT, khác tenant, tương lai, hết hạn, sửa hash và revoked đều PASS. Tra cứu lịch sử có timestamp rõ ràng giữ tương thích với lịch sử approval/revocation. |
| JSON/evidence validation | PASS | 20/20 output được backend chấp nhận sau kiểm tra schema, message IDs, citations, hash và applicability. Không dùng đầu ra model để tạo excerpt hoặc rule identity. |
| Ngữ nghĩa tiếng Việt | **FAIL** | Khớp nhãn mục tiêu 15/20, gồm 2 cảnh báo nhầm và 3 bỏ sót. Không coi JSON hợp lệ là phân tích đúng. |
| Dashboard sandbox | PASS | Đã append 20 run synthetic vào database sandbox được kiểm chứng danh tính. Chrome headless xác nhận 20 hàng `ollama`, tất cả SERVER_SYNTHETIC, evidence API HTTP 200 và có structured observations. |
| Backend regression | PASS | 124/124, gồm 7 kiểm tra mới: factory, endpoint/source gate, schema sai, ID bịa, citation giả, timeout và structured excerpts. |
| Frontend regression | PASS | 7/7. |
| TypeScript | PASS cuối cùng | Backend build/typecheck và frontend vue-tsc đã chạy thành công. Có một lần backend compiler OOM và một lần frontend test OOM khi chạy đồng thời inference; chạy lại tuần tự thành công. |
| Production | **NO-GO / chưa triển khai** | Chưa đạt chất lượng ngữ nghĩa; chưa kiểm chứng vault/tenant production, tải đồng thời và dữ liệu thật. |

## Thực thi và hợp đồng

Backend dùng `OLLAMA_BASE_URL=http://host.docker.internal:11434`, `OLLAMA_MODEL=qwen3:4b-instruct`; provider từ chối endpoint/model khác. POST với `stream:false`, `think:false`, schema ở trường `format`, temperature 0, timeout 120 giây và không tự retry. Không cài Ollama, không tải model, không gọi OpenAI.

`AI_QC_OLLAMA_ENABLED=true` và `AI_QC_ENABLED=true` là hai điều kiện bật nhánh Ollama. Mặc định Ollama tắt. Provider và analyzer chỉ cho `SERVER_SYNTHETIC`; CRM và mẫu người dùng tự xác nhận synthetic bị chặn. Để chạy harness dùng cấu hình synthetic trong `scripts/test-aiqc-ollama.mjs`. Sandbox Windows hiện tại vẫn giữ network guard cũ; chưa bật gọi Ollama trực tiếp từ nút UI. Kết quả container đã được đưa vào Dashboard để xem/review. Không nới network guard để bỏ qua giới hạn này.

GET `/api/v1/ai-quality-control/runs/:id` và POST `/datasets/:id/analyze` trả thêm `observations`, mỗi phần tử có:

```json
{
  "conversation_id": "synthetic-conversation-id",
  "observation_category": "INSULT",
  "evidence_message_ids": ["verified-message-id"],
  "evidence_excerpts": ["Nội dung synthetic từ snapshot backend"],
  "rule_id": "approved-rule-id",
  "rule_revision": 1,
  "explanation": "Nhận xét cần quản lý xem xét",
  "review_status": "PENDING"
}
```

Không có quy tắc thì rule_id/revision có thể null; không có evidence thì danh sách rỗng. Rule và excerpt được dựng từ snapshot đã kiểm chứng, không lấy trực tiếp từ model. Trạng thái finding, citation đầy đủ và missingContext vẫn nằm trong `output.findings`. Không tự xác nhận vi phạm hoặc chấm điểm nhân viên.

Registry sử dụng synthetic Markdown và rule records trong MemoryWorkspaceRepository để chạy container; tests hiện có kiểm tra connector Obsidian thật bằng fixture vault trên filesystem. Chưa quét/publish vault production. Các quy tắc synthetic đã được sao chép vào workspace sandbox cùng snapshot để evidence/replay hoạt động. Không ghi vào vault hay database production.

## 20 tình huống và lỗi ngữ nghĩa

Đã chạy: xúc phạm trực tiếp, xúc phạm gián tiếp, xua đuổi khách, từ chối lịch sự, khách xúc phạm, trích dẫn báo cáo, phủ định, xin lỗi, kiến thức sai, kiến thức đúng, hỏi lại về sản phẩm, phủ định thông tin sai, thiếu actor, bot, ngày nghỉ, thiếu coverage, chưa trả lời, prompt injection, mỉa mai mơ hồ và trích dẫn để sửa thông tin.

Nhãn kỳ vọng do harness định nghĩa cho một category mục tiêu mỗi tình huống. Tỷ lệ 15/20 là độ khớp nhãn mục tiêu trên bộ nhỏ này, không phải độ chính xác tổng quát hoặc đánh giá đủ bốn category trên mọi hội thoại.

| Ca lỗi | Kỳ vọng | Quan sát |
|---|---|---|
| direct-insult | INSULT cần xem xét | ABSTAIN; bỏ sót |
| semantic-insult | INSULT cần xem xét | Không cảnh báo; bỏ sót |
| apology | Không cảnh báo COURTESY | Cảnh báo nhầm |
| product-question | Không cảnh báo KNOWLEDGE_MISMATCH | Cảnh báo nhầm |
| unanswered | UNRESOLVED_REQUEST cần xem xét | Không cảnh báo; bỏ sót |

Prompt dùng phân tích ngữ nghĩa; các rule trong harness có `matchTerms:[]`. Các ca không chạy qua MockAIProvider. Analyzer hiện pseudonymize và bỏ work/off-day intervals trước provider; đây là giới hạn thông tin quan trọng khi đánh giá SLA/ngữ cảnh, cần xử lý trước production. Không đổi nhãn hoặc sửa kết quả để tăng tỷ lệ PASS.

## Hiệu năng và tài nguyên

| Chỉ số | Đo được |
|---|---|
| Tổng 20 lượt tuần tự | 383,02 giây |
| Trung bình / median | 19,14 / 18,36 giây |
| P95 / lớn nhất | 21,50 / 26,63 giây |
| Timeout thực tế | 0/20; nhánh timeout có test riêng PASS |
| Output JSON được backend chấp nhận | 20/20 = 100% |
| Client container peak RSS | 99,27 MiB |
| Host llama-server peak working set quan sát | 4.986.331.136 byte ≈ 4,64 GiB |
| Host Ollama service peak working set quan sát | 61.419.520 byte ≈ 58,57 MiB |
| llama-server CPU trong cửa sổ mẫu | 291,34 CPU giây / 289,38 giây; khoảng 100,68% một logical CPU, 6,29% tổng 16 logical CPU |

Cửa sổ lấy mẫu host: 15:07:36–15:12:25 giờ Asia/Bangkok (08:07:36–08:12:25 UTC), 4 giây/lần; bắt đầu sau các ca đầu nên không phải số đo toàn bộ batch. Đây là số liệu process host dùng chung, không phải benchmark tải độc lập, không đo GPU/VRAM và không chứng minh đủ capacity production. Các lỗi OOM trong lúc build/test đồng thời là điều kiện cần xem xét dù các lần chạy lại đã PASS.

## Dashboard và evidence

- Dashboard: http://localhost:5173/ai-quality-control — tab phân tích hội thoại, provider `ollama`.
- `evidence/ollama-20261102/results.json`: 20 kết quả, snapshots và structured observations.
- `metrics.json`, `host-resources.json`: tổng hợp và mẫu CPU/RAM.
- `unit-results.json`, `frontend-results.json`: kết quả kiểm thử cô lập.
- `dashboard.png`, `dashboard-verification.json`: ảnh và xác minh trình duyệt.
- `source-inventory.json`: SHA-256 các file triển khai liên quan.

Lượt inference đã hoàn tất trước khi bổ sung gate opt-in và điều chỉnh tương thích tra cứu lịch sử; các gate này được kiểm thử bằng unit tests và final build. Các run dùng quy tắc APPROVED hiện hành nên thay đổi tương thích lịch sử không thay đổi tập quy tắc của batch. Structured observations trong evidence được dựng lại từ snapshot bằng serializer backend, không sửa đầu ra model hay kết quả nhãn.

## Điều kiện còn thiếu trước production

1. Sửa và tái kiểm thử 5 ca ngữ nghĩa lỗi; mở rộng bộ gold tiếng Việt được người có thẩm quyền duyệt, xác định ngưỡng FP/FN/abstain chấp nhận được.
2. Bảo toàn metadata cần cho SLA/ngữ cảnh mà không suy diễn attribution hoặc thời gian; kiểm chứng xử lý thiếu thông tin.
3. Kiểm chứng vault tenant thực: nội dung APPROVED, ACL, hash, revision, hiệu lực và quy trình revoke/publish; synthetic fixtures không thay thế nghiệm thu này.
4. Kiểm thử tải đồng thời, hàng đợi/concurrency limit, RAM headroom, timeout và khả năng vận hành cùng CRM; xử lý tình trạng OOM đã quan sát.
5. Có thiết kế network allowlist cho runtime thực, retention/privacy và quyền sử dụng dữ liệu thật được duyệt. Hiện nhánh Ollama cố ý từ chối dữ liệu CRM thật; production chưa thể bật chỉ bằng đổi flag.
6. Review release, migration/runtime isolation, rollback và cho phép deployment riêng. Chưa chạy acceptance dữ liệu thật hoặc deploy production.

Production `zalo-crm-app` vẫn running, StartedAt `2026-11-01T09:31:11.772638502Z`, trước phiên này. Container test tự xóa khi hoàn tất. Không đổi Cloudflare Tunnel, không mở cổng 11434, không gửi hội thoại khách hàng thật.
