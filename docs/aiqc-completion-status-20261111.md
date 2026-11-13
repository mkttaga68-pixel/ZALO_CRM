# AIQC — trạng thái hoàn thiện và cổng phát hành (11/11/2026)

> **Đã được thay thế** bởi `aiqc-release-gates-20261111.md` (lượt 2). Các mục "manual-retention xóa audit", "monitoring không purge" và "4 lỗi user-routes-authz" dưới đây đã được xử lý trong lượt 2.

**Khuyến nghị: PRODUCTION NO-GO (giữ nguyên).** Lần này chỉ sửa mã nguồn và test trong workspace. Không deploy/restart, không đổi DB/compose production, không gọi OpenAI/Zalo/Ollama thật, không đọc dữ liệu khách hàng. Không commit.

## 1. Thay đổi mã nguồn

| File | Thay đổi | Lý do |
|---|---|---|
| `backend/src/modules/ai-quality-control/repository.ts` | Xuất `WORKSPACE_LIMITS`, `AUDIT_HARD_LIMIT` (10.500), `workspaceCapacity()`. `bounded()` có cơ chế capacity relief: mutation làm giảm dung lượng (byte), không thêm document/run/dataset, được ghi audit vượt trần mềm 10.000 cho tới trần cứng. | Trước đây, khi audit đạt 10.000 thì **mọi** mutation, kể cả `RETENTION_PURGE`, đều bị từ chối → không thể purge được nữa. |
| `backend/src/modules/ai-quality-control/retention.ts` (mới) | `purgeExpiredRuns()`: purge hàng loạt trong phạm vi tenant các run đã quá hạn retention được duyệt. Cần quyền `delete` + `view_all`, có lý do; xóa kèm evaluations; ghi đúng 1 audit `RETENTION_PURGE_BULK` (số lượng, cutoff, tombstone digest, lý do đã redact). Nếu không có gì để purge thì không ghi. | Trước đây chỉ có xóa từng run một; chưa có thao tác retention cho operator. |
| `backend/src/modules/ai-quality-control/routes.ts` | `POST /api/v1/ai-quality-control/retention/purge-expired`; `GET /workspace` trả `capacity` cho người có quyền `edit` (các vai trò khác nhận `null`). | Operator chủ động thực hiện purge và theo dõi dung lượng. Không có scheduler tự động. |
| `backend/tests/native-ai-quality-control.test.ts` | Bổ sung 5 test (retention thành công + audit/redact; phân quyền đặt policy và purge; purge hàng loạt theo tenant/quyền/hết hạn/idempotent; purge không bị deadlock khi audit đầy, tăng trưởng thường vẫn bị chặn nguyên tử; capacity chỉ hiện cho editor). Cô lập 6 test Ollama bằng telemetry tổng hợp. | 6 test Ollama fail theo RAM trống thực tế của máy (`os.freemem()` khoảng 1,0 GiB, dưới ngưỡng 3 GiB), nên không tái lập được kết quả "139/139 PASS" trong tài liệu ngày 02/11. |

Blast radius (GitNexus MCP/CLI không có trong phiên; dùng grep thay thế, **sai lệch so với AGENTS.md**): `bounded` là private, có 2 caller nhưng nằm trên mọi đường ghi AIQC → MEDIUM. Hành vi chỉ thay đổi khi trạng thái vượt trần. `OllamaProvider`: không sửa code production. Route mới: thêm vào, LOW.

## 2. Kiểm chứng (bằng chứng: `C:\Zalo CRM\aiqc-completion-20261111\`)

| Lệnh | Kết quả |
|---|---|
| Baseline `node scripts/run-native-ai-qc-tests.cjs` (trước khi sửa) | 133/139, **6 FAIL** (OLLAMA_RESOURCE_LIMIT do RAM của host) |
| `node scripts/run-native-ai-qc-tests.cjs` (sau khi sửa) | **144/144 PASS** (`native-aiqc-results.json`) |
| `node scripts/run-openai-control-tests.cjs` (OpenAI-control + native + manual, transport có kiểm soát) | **195/195 PASS** (`guarded-openai-control-results.json`) |
| `node scripts/run-native-ai-qc-monitoring-tests.cjs` | **19/19 PASS** (chỉ mock) |
| Frontend: `--frontend` cho 3 runner | 7/7, 6/6, 13/13 PASS |
| `tsc --noEmit -p backend/tsconfig.json` (chỉ `src`) | PASS |
| `tsc` cho file test native (tsconfig tạm) | 4 lỗi kiểu **có sẵn từ trước** ở dòng 341/355/362/456 (tuple của `mock.calls`); test mới không có lỗi |
| Regression CRM backend (env đã lọc, DB không kết nối được, loại trừ 4 suite có runner riêng) | **798/802**; 4 FAIL trong `user-routes-authz` (HTTP 500: mock Prisma chưa theo kịp `writeSubordinate` của strict-RBAC 03/11). Không thuộc AIQC; chưa sửa. |

Chưa chạy: browser E2E trên candidate cuối, khởi động CRM đầy đủ với DB tổng hợp, benchmark/inference Ollama (RAM trống của host hiện khoảng 1 GiB, guard sẽ chặn), đánh giá lại chất lượng semantic, bất kỳ thao tác nào với production.

## 3. Trạng thái các cổng

| Hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|
| Test AIQC cô lập | Tài liệu ghi PASS, thực tế 6 FAIL | PASS, xác định được kết quả | |
| Retention/purge | Chỉ xóa từng run; deadlock khi đầy audit; chưa test trường hợp thành công | Có purge hàng loạt, relief, đã test | Chưa có purge tự động; audit không bao giờ bị xóa (trừ manual-retention, xem rủi ro) |
| Giới hạn lưu trữ | Ẩn | Hiển thị cho editor | Khi đạt 10.000 audit, workspace chỉ còn ghi được thao tác purge cho tới khi có quyết định lưu trữ audit |
| Phân quyền API (retention/delete/settings) | Một phần | Có test | Quyền dashboard production với tài khoản thật: **CHƯA** |
| Full CRM/browser acceptance trên candidate | NOT RUN | NOT RUN | |
| Backup/restore mới | FAIL | FAIL | |
| Quiet-state/khôi phục Zalo | BLOCKED | BLOCKED | |
| Policy tenant (Obsidian) | 20 DRAFT/UNASSIGNED | Không đổi | |
| Billing limit | NOT VERIFIED | Không áp dụng khi giữ `AI_QC_OPENAI_REMOVED=true`; bắt buộc nếu bật lại OpenAI | |
| Benchmark inference | NOT RUN | NOT RUN | |
| Chất lượng semantic v3 | 2 FP/40, 2 mismatch/28 | Không đổi | |
| Runtime flags production | `AI_QC_ENABLED=true`, `AI_QC_REAL_DATA_ENABLED=true` trong override/ai-qc compose | Không đổi (chỉ đọc file) | |

## 4. Rủi ro còn lại / phát hiện mới

1. `docker-compose.override.yml` và `docker-compose.ai-qc.yml` vẫn đặt `AI_QC_REAL_DATA_ENABLED=true`. Lần recreate tiếp theo sẽ giữ cấu hình này.
2. Overlay phase-A tắt backend nhưng vẫn build UI với `VITE_AI_QC_ENABLED: "true"`: menu hiển thị, API trả 503. Cần quyết định có chủ đích.
3. `manual-retention.ts` xóa luôn audit của các run bị purge, không nhất quán với `RETENTION_PURGE` (vẫn giữ audit). Cần quyết định về chính sách.
4. `PostgresMonitoringRepository.mutate` chỉ upsert, không xóa row → monitoring không thể purge và sẽ chạm `MONITORING_CAPACITY_REACHED` (5.000 job). Hiện module bị khóa ở `NODE_ENV=test`; là cổng chặn trước khi bật monitoring.
5. Lưu trữ audit dài hạn (archive) chưa được thiết kế. Khi chạm trần, các thao tác ghi thông thường bị chặn theo hướng fail-closed.
6. Working tree trộn AIQC với strict-RBAC và các thay đổi khác; 4 test RBAC đang fail.

## 5. Việc operator/tenant cần làm (theo thứ tự)

1. **Chủ sở hữu release**: tách phạm vi AIQC khỏi RBAC/khác, review và commit candidate. Đội RBAC sửa mock/logic của `user-routes-authz` (4 FAIL).
2. **Operator hạ tầng**: tạo backup DB và cấu hình mới, kiểm tra integrity, restore vào DB cô lập.
3. **Owner/operator**: chốt maintenance window, xác nhận quiet-state của Zalo và queue in-memory theo `aiqc-zalo-restart-checklist-20261102.md`.
4. **Owner**: duyệt phase A (AI tắt, `REAL_DATA=false`, quyết định `VITE_AI_QC_ENABLED`) với image digest bất biến; áp dụng trong window, kiểm tra sau triển khai.
5. **Admin tenant ASLAN**: duyệt 16 policy trong Registry (tenant, ACL, hiệu lực); đặt `retentionDays` (người có quyền `approve`); quyết định chính sách lưu trữ audit và manual-retention.
6. **Owner + admin tenant**: xác minh quyền dashboard bằng tài khoản thật (access-only, editor, approver, delete+view_all).
7. **Operator**: chạy benchmark Ollama trên host tương đương production đủ RAM (≥3 GiB trống); đánh giá lại semantic; sau đó mới đến phase B.
8. Chỉ cân nhắc phase C khi có cơ sở pháp lý cho dữ liệu, cấu hình billing (nếu dùng OpenAI) và GO riêng.
