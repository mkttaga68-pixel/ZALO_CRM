# AI Quality Control production preflight — 02/11/2026

## Kết luận

**PRODUCTION NO-GO. Không triển khai giai đoạn A hoặc B trong lần kiểm tra này.** Có các blocker về cấu hình đang chạy, policy Obsidian, giới hạn tài nguyên/inference, backup/rollback, bảo trì và chưa xác minh quyền Dashboard. Không bật giai đoạn C. Không restart container hay thay đổi production.

## 1. Pre-deployment gates

| Gate | Trạng thái | Bằng chứng / lý do |
|---|---|---|
| AGENTS.md và semantic-v3 | PASS | Đọc `AGENTS.md` và `docs/aiqc-ollama-semantic-v3-20261102.md`. Semantic-v3 vẫn có 2 FP/40 regression và 2 mismatch ba trạng thái/28 holdout; không coi là production-ready. |
| Phân tích 42 test failures | PASS, có điều kiện | 31 test fail khi chạy `npm test` trực tiếp do hai suite `manual-real-analysis`/`openai-control` yêu cầu `QC_TEST_ROOT` và runner cô lập. Runner đúng `node scripts/run-openai-control-tests.cjs` chạy 186/186 PASS, không cho phép network. 9 user-route failures là Prisma mock thiếu `user.findFirst`; 2 chat-forward failures là mock thiếu `zaloAccount.findFirst`/`app.policy`, sau đó lộ downloader còn dùng storage SDK thật trong unit test. Đã sửa test fixtures để mô phỏng lookup/policy và mock `downloadMediaBuffer`; targeted CRM regression đạt 31/31. Default suite sau sửa: 653 passed, 31 guarded-test failures (không phải lỗi nghiệp vụ mới). |
| Production app/DB health | PASS | `zalo-crm-app` healthy, image `zl-crm-app:ai-qc-shared-20261101`, digest `sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`, started `2026-11-01T09:31:11Z`; PostgreSQL 16.15 healthy và `pg_isready` PASS. Migration `20261101120000_native_ai_quality_control` đã hoàn tất; bảng workspace tồn tại nhưng có 0 rows. |
| Runtime config an toàn | **FAIL** | Container đang có `AI_QC_ENABLED=true` và `AI_QC_REAL_DATA_ENABLED=true`; `AI_QC_OLLAMA_ENABLED` chưa đặt, `AI_QC_AUTO_MONITOR_ENABLED` chưa đặt, `AI_QC_REAL_API_ENABLED=false`. `docker-compose.override.yml` và `docker-compose.ai-qc.yml` đều opt-in AIQC/real-data. Cấu hình này trái target A (AI disabled). Ollama hiện chưa bật trong container. |
| Cấu hình Compose/image | **BLOCKED** | Compose labels xác nhận project `zl-crm`, service `app`, dùng `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.ai-qc.yml`. Image đang chạy được gắn ngày 01/11; semantic-v3 source/evaluation là 02/11 nên chưa xác minh image production chứa đúng Analyzer đã kiểm thử. Không build/publish image mới. |
| Backup và rollback | **FAIL** | Backup service healthy, nhưng backup hiện có gần nhất là 26/10 (các bản còn lại 24–25/10), không đủ làm pre-deploy backup hiện hành. Image cũ `zl-crm-app:latest` còn local nhưng chưa kiểm tra tương thích DB, khôi phục database hay replay cấu hình. Rollback chưa được thực thi/kiểm chứng. |
| Zalo sessions/queue/restart safety | **BLOCKED** | Read-only DB aggregate: 7 tài khoản Zalo đều `disconnected`; manual jobs: 2 `DONE`, 1 `FAILED`; automation tasks: 3 `done`, 8 `skipped`; không thấy hàng chờ/running trong các bảng đã kiểm tra. Tuy nhiên chưa kiểm tra trạng thái pool trong RAM, pending callback/event hoặc các luồng đang chạy. Redis container không chạy; app có event bus/in-memory work. Checklist restart yêu cầu xác nhận operator quiet-state và maintenance window; chưa có xác nhận đó. |
| Obsidian/tenant/revision/hash | **FAIL** | Vault được yêu cầu không được mount vào app container; app chỉ mount `file_storage` với RW. `AI_QC_VAULT_ROOTS_BY_TENANT` unset. 20 tài liệu policy tại vault đều `draft`, `tenant_scope: UNASSIGNED`, không có hiệu lực/approver; không có rule APPROVED áp dụng cho tenant ASLAN `a236afea-cc9c-4de8-81c0-ee5923385b2e`. Manifest có 21 file entry; 1 hash mismatch: `UX-001_KHONG_XUC_PHAM.md`. Không đồng bộ hoặc tự approve tài liệu. |
| Ollama/resource/concurrency | **FAIL** | `qwen3:4b-instruct` đã có trên host; không chạy inference hoặc gửi dữ liệu thật trong preflight. Container chưa có `OLLAMA_BASE_URL`/`OLLAMA_MODEL`, và Ollama feature flag chưa bật. V3 đo được RAM trống thấp nhất 2.42 GiB, GPU 100%, VRAM trống thấp nhất 6,768 MiB. Không tìm thấy Ollama-specific bounded queue, global concurrency=1, resource-triggered stop hoặc runtime kill switch; inference provider có timeout nhưng không giới hạn song song toàn hệ thống. |
| Dashboard/access/evidence | **BLOCKED** | Sandbox dashboard được xác minh ở `http://localhost:5173/ai-quality-control` với 128 rows synthetic-only. Production DB workspace trống; production owner login, role/access matrix, save/delete/audit/evidence retention và dashboard production chưa được kiểm tra. |
| Maintenance window | **BLOCKED** | Checklist có đề xuất 03/11 00:30–00:45 Asia/Ho_Chi_Minh, nhưng ghi rõ đó không phải lịch/ủy quyền. Attachment yêu cầu xác nhận riêng nếu cần restart; chưa có xác nhận thời gian gián đoạn. |

## 2. Nguyên nhân 42 test fail và retest

Full-suite trước khi fixture được chỉnh: 642 passed / 42 failed. Phân rã:

- 30 `openai-control` + 1 `manual-real-analysis`: runner thường không cấp `QC_TEST_ROOT`; đây là suite được bảo vệ để chỉ chạy qua isolated runner. Khi chạy `node scripts/run-openai-control-tests.cjs`, cả 35 OpenAI-control, 16 manual synthetic và 135 native AIQC test đều PASS (**186/186**). Test dùng controlled transport; không gọi OpenAI API.
- 9 `user-routes-authz`: mock Prisma không khai báo `user.findFirst`, trong khi route kiểm tra target role trước khi cập nhật. Bổ sung mock trả target role member; 9 test PASS.
- 2 `chat-operations-routes`: mock không mô phỏng `zaloAccount.findFirst` và policy check mới, nên bị 404 trước khi chạy route. Bổ sung mock quyền. Media test sau đó đã cố dùng storage SDK thật tới `localhost:9000` và nhận `SignatureDoesNotMatch`; không trả file. Dừng thử nghiệm truy cập đó, thay bằng mock downloader tổng hợp; không chạy lại request MinIO. Hai test PASS.
- Sau fixture fixes, targeted chat/auth suite **31/31 PASS**. `npm test` mặc định vẫn fail 31 test guard vì suite manual/OpenAI không được chạy qua isolated harness; các suite riêng đúng runner PASS. Bản JSON: `evidence/ollama-semantic-v3-20261102/backend-full-suite-after-fixture-fixes.json`.

Không có bằng chứng rằng 42 failure là lỗi AIQC model. Riêng 2 chat failure từng tương tác với MinIO do test không cô lập downloader; đây là lỗi test isolation và đã được chặn cho các lần chạy tiếp theo. `SignatureDoesNotMatch` không chứng minh credential production sai; production bucket/file chưa được thử tải.

## 3. Production hiện tại

- Compose project `zl-crm`; service/container `app` / `zalo-crm-app`; healthy; image digest nêu trên. PostgreSQL `zalocrm` healthy. `native_ai_qc_workspace` có 0 record.
- AIQC flags hiện tại không khớp giai đoạn A: `AI_QC_ENABLED=true`, `AI_QC_REAL_DATA_ENABLED=true`, còn Ollama flag chưa bật. Các tên biến trong code là `AI_QC_ENABLED`, `AI_QC_OLLAMA_ENABLED`, `AI_QC_REAL_DATA_ENABLED`, `AI_QC_AUTO_MONITOR_ENABLED`; `AI_PROVIDER`, `AIQC_ENABLED`, `AIQC_AUTO_MONITOR` không phải tên runtime được tìm thấy. Không thay đổi env/Compose vì cần app recreation và chưa có cửa sổ bảo trì.
- Ollama trên host có `qwen3:4b-instruct` (2.5 GB trong `ollama list`); `ollama ps` báo không có model đang resident lúc kiểm tra. Kết nối inference từ production container chưa được thử vì image/config/tenant/rule và safety gates chưa đạt.
- AIQC code khi bật đang chọn `AI_QC_STORAGE=application`; DB table migration đã có nhưng workspace chưa khởi tạo. Đây không thay thế Registry Obsidian APPROVED.
- Local vault hash: 20 policy docs đều draft/unassigned; manifest 21 file có 1 sai lệch hash. Không có mount read-only/tenant allowlist trong app hiện tại.
- Production Dashboard URL/access chưa xác minh; sandbox dashboard không được xem là production dashboard.

## 4. Trạng thái deployment

- **A — production deploy, AI disabled: NOT RUN.** Blocker gồm runtime config thực tế đang cho phép AIQC/real-data, image semantic-v3 chưa được pin/xác nhận, backup/restore chưa đạt, thiếu bảo trì được duyệt và restart safety chưa xác nhận.
- **B — production shadow synthetic: NOT RUN.** Phụ thuộc A; cần bật đúng Ollama flag có kiểm soát, synthetic tenant/rule độc lập, Obsidian policy APPROVED/hash/tenant/effective, bounded queue/concurrency/kill-switch, dashboard access và resource/load test. Hiện vault không đủ điều kiện.
- **C — pilot real data: NOT RUN / không được phê duyệt trong tài liệu.** Cần consent/data-processing basis, retention/access policy, load test đạt, đánh giá false positives và GO riêng. Không được dùng AIQC làm KPI/kỷ luật.

## 5. Điều kiện còn thiếu trước khi tiếp tục

1. Owner/operator xác nhận maintenance window cụ thể và chấp nhận thời lượng gián đoạn; xác nhận quiet-state qua workflow vận hành.
2. Đặt tất cả runtime flags về trạng thái AI tắt theo đúng tên biến (`AI_QC_ENABLED=false`, `AI_QC_OLLAMA_ENABLED=false`, `AI_QC_REAL_DATA_ENABLED=false`, `AI_QC_AUTO_MONITOR_ENABLED=false`, các outbound/manual flags false); rà Compose effective config và build-time UI flag. Chỉ áp dụng trong change đã review.
3. Chốt image/source digest có Analyzer semantic-v3, SBOM/config manifest và rollback image; xác minh DB compatibility.
4. Tạo backup database + cấu hình mới trong nơi lưu trữ được bảo vệ, kiểm tra integrity và restore vào isolated DB. Backup mới nhất hiện tại quá cũ.
5. Chủ sở hữu Obsidian duyệt policy qua Registry, gán đúng tenant/hiệu lực, sửa hash manifest bằng quy trình kiểm duyệt, kiểm tra revision/hash; mount vault read-only và allowlist đúng ASLAN.
6. Bổ sung bounded inference queue, concurrency=1, resource guard, kill switch riêng và xác nhận Ollama outbound chỉ tới host bridge. Load-test CRM/Ollama đồng thời trên synthetic data.
7. Chạy isolated test harness chuẩn và regression CRM cần thiết. Giữ các fail guard trong suite mặc định được xử lý bằng runner đúng; không tắt guard để làm xanh `npm test`.
8. Xác minh owner login/roles/dashboard/audit/delete/retention bằng tài khoản được cấp phép; post-deploy checks phải được thực hiện trong maintenance window.
9. Sau A/B mới có thể đề xuất C; cần chấp thuận pháp lý/quyền dữ liệu và GO riêng. Giữ mọi AI observation ở NEEDS_REVIEW.

## Thay đổi trong sandbox lần này

Chỉ sửa test fixtures để không bỏ qua `user.findFirst`, quyền forward và downloader bên ngoài; không sửa logic CRM production, không build/deploy image. Evidence full suite, test JSON và báo cáo semantic-v3 nằm trong `evidence/ollama-semantic-v3-20261102/`. Không restart production, không gọi OpenAI, không đổi Cloudflare và không phân tích hội thoại khách hàng thật.
