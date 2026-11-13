# AIQC — cổng phát hành theo giai đoạn (cập nhật 11/11/2026, lượt 2)

Thay thế phần trạng thái trong `aiqc-completion-status-20261111.md`. **Quyết định: NO-GO cho mọi giai đoạn production.** Phase A *có thể* trở thành GO sau khi đạt đủ các cổng vận hành ở mục 4; Phase B và pilot real-data (C) bị chặn bởi cổng chất lượng và tài nguyên.

Không có thao tác production nào trong công việc này: không kết nối DB production, không đọc nội dung khách hàng, không sửa compose/runtime production, không restart/deploy/migration, không gọi OpenAI/Zalo/Ollama, không commit.

Bằng chứng: `C:\Zalo CRM\aiqc-completion-20261111\` (digest file sửa đổi: `changed-files.sha256`).

## 1. Thay đổi lượt này

| Hạng mục | File | Nội dung |
|---|---|---|
| Real-data hai khóa | `backend/src/modules/ai-quality-control/providers.ts`, `routes.ts` | `realData` chỉ bật khi `AI_QC_REAL_DATA_ENABLED=true` **và** `AI_QC_REAL_DATA_PILOT_ORG_ID` là UUID hợp lệ (khớp `AI_QC_OPENAI_ORG_ID` nếu có). Các route CRM từ chối mọi tenant khác bằng `AI_QC_REAL_DATA_TENANT_NOT_APPROVED`, trước khi gọi CRM adapter. |
| Chính sách audit thống nhất | `manual-retention.ts` | Purge manual-retention **không xóa audit nữa**. Thay vào đó ghi một audit `MANUAL_RETENTION_PURGE` gồm run IDs và tombstone. Thao tác idempotent, có kiểm tra tenant. |
| Monitoring purge | `monitoring/retention.ts` (mới), `monitoring/repository.ts`, `monitoring/routes.ts`, `monitoring/health.ts` | Purge theo retention đã duyệt: cần quyền `delete`+`view_all` và lý do. Ghi audit trước khi xóa, xóa theo ID, kiểm tra lại điều kiện trong lock. Không bao giờ xóa job đang chạy, warning OPEN hay notification chưa giao. Repository PostgreSQL nay xóa được row bị loại, chỉ trong tenant đang giữ lock. Health báo dung lượng so với trần 5.000 job. |
| Lượt 1 (giữ nguyên) | `repository.ts`, `retention.ts` | Purge workspace hàng loạt và capacity relief cho audit. |
| Cấu hình hiệu lực | `scripts/verify-aiqc-compose-flags.mjs` (mới) | Đọc tĩnh các file compose theo thứ tự, không chạy Docker và không in giá trị `.env`. Kiểm tra yêu cầu của phase A/B. |
| Đánh giá semantic | `scripts/evaluate-aiqc-semantic-holdout.mjs` (mới) | Tính lại FP/FN từ output đã ghi, đối chiếu với tóm tắt đã lưu, áp ngưỡng định trước. Không chạy inference. |
| Ngoài AIQC (RBAC), có đánh giá | `backend/tests/user-routes-authz.test.ts` | 4 lỗi trước đây là fixture drift. Mock nay mô phỏng transaction + advisory lock + dữ liệu authority; **logic strict-RBAC thật vẫn chạy**. Thêm 3 ca âm/kiểm tra lock. Không sửa code route. |
| Overlay phase B làm lộ backup | `docker-compose.ai-qc-phase-b-synthetic.review.yml`, `scripts/aiqc-ollama-resource-monitor.ps1`, checker | Bản cũ mount `C:/ProgramData/ZaloCRM/AIQC`, thư mục chứa `backups/*.dump` (dump DB production), vào container. Nay chỉ mount `…/AIQC/runtime`. Checker FAIL nếu có overlay nào mount thư mục gốc hoặc `backups`. |
| Đồng bộ script | `scripts/verify-aiqc-manual-candidate.mjs` | Thêm biến pilot vào môi trường synthetic để khớp cổng mới. |

Phân tích tác động: công cụ GitNexus mà AGENTS.md yêu cầu **không khả dụng** trong phiên này (không có MCP; CLI cần tải từ mạng). Tôi dùng call-site/source review thay thế, **không tuyên bố đã chạy gitnexus**.

| Symbol | Caller | Rủi ro |
|---|---|---|
| `providerEnvironment` | bootstrap, monitoring worker, 2 test, 1 script | **HIGH**: cố ý tắt real-data với compose hiện tại ở lần deploy tới |
| `PostgresMonitoringRepository.mutate` | runtime monitoring (chỉ chạy khi `NODE_ENV=test`) | MEDIUM: nếu một mutation lỗi làm rỗng state thì row cũng bị xóa; trước đây vô hại |
| `purgeExpiredManualRuns` | bootstrap (cờ OFF), 1 test, 1 script | LOW |
| Route mới | — | LOW, thêm mới |

## 2. Kiểm chứng (đã chạy thật)

| Lệnh | Kết quả | Artifact |
|---|---|---|
| `node scripts/run-native-ai-qc-tests.cjs` | **146/146 PASS** | `native-aiqc-results.json` |
| `node scripts/run-openai-control-tests.cjs` (controlled transport, chặn mạng) | **197/197 PASS** | `guarded-openai-control-results.json` |
| `node scripts/run-native-ai-qc-monitoring-tests.cjs` | **27/27 PASS** (19 cũ + 8 mới) | `monitoring-results.json` |
| 3 runner với `--frontend` | 7/7, 6/6, 13/13 PASS | log trên console |
| Regression CRM backend: vitest với env đã lọc, DB không kết nối được, loại trừ 4 suite có runner riêng | **805/805 PASS** (trước đó 798/802) | `backend-crm-regression.json` |
| `tsc --noEmit` cho `backend/src` | PASS | — |
| `tsc` cho 4 file test đã sửa | Chỉ còn lỗi kiểu có sẵn từ trước, ở các dòng không sửa | — |
| **Phạm vi release tối thiểu**: HEAD đã commit + module AIQC + 2 dòng `ai_quality_control` trong `permission-types.ts` | `tsc` **PASS** | bản xuất ra scratchpad, đã gỡ |
| Compose hiện hành theo yêu cầu phase A | **FAIL**: `AI_QC_ENABLED=true`, `REAL_DATA=true`, thiếu `OPENAI_REMOVED`, image không pin | `compose-current-as-phaseA.json` |
| Compose + `docker-compose.ai-qc-phase-a.pinned.review.yml` | **PASS** | `compose-phaseA-pinned.json` |
| Compose + overlay phase B synthetic | **FAIL**: chưa có image digest (`AI_QC_PHASE_B_IMAGE`) | `compose-phaseB.json` |
| Đánh giá lại semantic v3 (68 ca đã ghi) | Tính lại khớp tóm tắt. Phase B **FAIL**, pilot **FAIL** | `semantic-v3-reevaluation.json` |

Chưa chạy, kèm lý do:
- **Full CRM startup và browser E2E**: cluster sandbox local là PostgreSQL **18** trong khi production là **16.15**. Backend local đã dừng từ 03/11 do lỗi `No space left on device`; hiện ổ C còn khoảng 63 GB. Cần môi trường PG16 mới (xem runbook B, mục chuẩn bị).
- **Benchmark Ollama**: máy này là host production dùng chung, chỉ còn khoảng 1–2 GiB RAM trống, dưới ngưỡng guard 3 GiB. Cần host cô lập đủ tài nguyên.
- **Dashboard với tài khoản thật, backup/restore mới, quiet-state Zalo, duyệt policy tenant**: cần operator hoặc tenant thực hiện.

## 3. Bảng cổng (trước → sau)

| # | Cổng | Trước (11/11 lượt 1) | Sau | Bằng chứng | Chặn bởi | Owner |
|---|---|---|---|---|---|---|
| G1 | Test AIQC cô lập | PASS 144 | **PASS 146** | `native-aiqc-results.json` | — | Dev |
| G2 | Guarded OpenAI/manual | PASS 195 | **PASS 197** | `guarded-openai-control-results.json` | — | Dev |
| G3 | Monitoring mock | PASS 19 | **PASS 27** | `monitoring-results.json` | — | Dev |
| G4 | Retention/purge: workspace, monitoring, manual | Một phần | **PASS (code + test)** | 3 file test ở trên | Tenant đặt `retentionDays` | Admin tenant |
| G5 | Chính sách audit thống nhất | Mâu thuẫn | **PASS**: không purge nào xóa audit | `manual-real-analysis.test.ts` | Tenant ký chính sách | Admin tenant |
| G6 | Chặn real-data bật ngoài ý muốn | FAIL (compose bật) | **PASS trong code**. Compose vẫn đặt `true` | test native; `compose-current.json` | Image cũ `875af…` chưa có cổng này | Owner release |
| G7 | Regression CRM | 798/802 | **805/805** | `backend-crm-regression.json` | — | Dev/RBAC |
| G8 | Phạm vi release tách được | Chưa | **PASS (biên dịch)** | mục 5 | Review và commit | Owner release |
| G9 | Effective flags phase A | Chưa đo | **PASS với overlay pinned** | `compose-phaseA-pinned.json` | Áp dụng trong window | Operator |
| G10 | Full CRM startup + login, DB PG16 synthetic | NOT RUN | **NOT RUN** (có kế hoạch) | runbook B | Môi trường PG16 | Dev/Operator |
| G11 | Browser E2E trên candidate cuối | NOT RUN | **NOT RUN** (có kế hoạch) | runbook B | G10 + image candidate | Dev |
| G12 | Semantic (holdout có nhãn) | 2 FP/40; 2 mismatch/28 | **FAIL theo ngưỡng** | `semantic-v3-reevaluation.json` | Sửa prompt/rule, holdout ≥ 90 ca | Dev + chủ policy |
| G13 | Benchmark Ollama | NOT RUN | **NOT RUN** | — | Host cô lập ≥ 3 GiB RAM trống | Operator |
| G14 | Backup/restore mới | FAIL | **FAIL** (bản gần nhất 02/11, đã 9 ngày) | metadata file | Backup mới + restore cô lập | Operator hạ tầng |
| G15 | Quiet-state và khôi phục Zalo | BLOCKED | **BLOCKED** | `aiqc-zalo-restart-checklist-20261102.md` | Window bảo trì | Owner/Operator |
| G16 | Quyền dashboard với tài khoản thật | NOT RUN | **NOT RUN** (đã có ma trận) | runbook A §6 | Tài khoản thật | Owner + admin tenant |
| G17 | Duyệt policy tenant (Obsidian) | 20 DRAFT | **BLOCKED** | approval register | Admin tenant | Admin tenant |
| G18 | Giới hạn billing | N/A khi `OPENAI_REMOVED` | N/A (bắt buộc nếu bật lại OpenAI) | — | — | Owner |
| G19 | Window bảo trì | Chưa duyệt | Chưa duyệt | — | — | Owner |

## 4. Tiêu chí GO/NO-GO

- **Phase A (AI tắt)** — GO khi: G1–G9 PASS (đã đạt); G14 có backup mới trong vòng 24 giờ trước window, khôi phục được vào DB PG16 cô lập; G15 quiet-state được xác nhận trong window; G19 đã duyệt; chọn image phase A (xem runbook A §1). G10/G11 không bắt buộc nếu dùng image đang chạy `875af…`, **bắt buộc** nếu dùng image mới. Mọi bước kiểm tra sau deploy phải PASS, nếu không thì rollback.
- **Phase B (synthetic shadow)** — GO khi: Phase A đã ổn định ≥ 7 ngày; G10, G11, G13 PASS; G12 đạt ngưỡng phase B; G16 PASS; có image digest đã review.
- **Phase C (pilot real-data)** — GO khi: B đã chạy ≥ 14 ngày không chạm tiêu chí dừng; G12 đạt ngưỡng pilot; G17 PASS; mọi mục trong checklist C đã ký.

## 5. Phạm vi release nhỏ nhất (đề xuất)

**Thuộc AIQC — đưa vào release:**
- `backend/src/modules/ai-quality-control/**`
- `backend/prisma/schema/native-ai-quality-control.prisma` và migration `20261101120000_native_ai_quality_control`
- `backend/fixtures/ai-quality-control/**`
- Các test `native-ai-quality-control*`, `openai-control`, `manual-real-analysis`, `native-ai-qc-monitoring` cùng các `vitest.*` config tương ứng
- `frontend/src/api/ai-quality-control.ts`, `frontend/src/views/ai-quality-control/**`
- Các runner `scripts/run-*-tests.cjs` và 2 script kiểm tra mới

**Thuộc AIQC — tách thành change riêng (chưa áp dụng):** schema và migration monitoring `20261101180000_native_ai_qc_monitoring_mock`. Monitoring chỉ chạy khi `NODE_ENV=test`.

**File trộn — cần tách theo hunk:**
- `permission-types.ts`: chỉ 2 dòng `ai_quality_control`
- `app.ts`: block `registerNativeAiQualityControl` và `syntheticQcSandbox`
- `core/build-context.ts`: dòng `isolatedQc`
- `docker-compose.yml`: các dòng `AI_QC_*` và `VITE_AI_QC_ENABLED`, đều mặc định false
- `docker/Dockerfile`: các dòng `VITE_AI_QC`
- `frontend/src/router/index.ts`, `DefaultLayout.vue`, `PermissionGroupsView.vue`: các dòng AIQC
- `backend/package.json`: 2 script `db:ai-qc`
- `backend/vitest.config.ts`: dòng exclude

**Ngoài AIQC — release riêng:** strict-RBAC, auth/credential-version, socket, storage, chat forward, manual-posting, `contact_data_purge`, cùng các test `user-routes-authz`, `strict-module-access`, `security-*`, `socket-auth`.

**Không đưa vào release:**
- `.env*`, `frontend/.env.development.local`
- Các overlay `docker-compose.*.review.yml` và `docker-compose.obsidian.*.yml` (đây là tài liệu review)
- `docker-compose.override.yml`, `docker-compose.ai-qc.yml`: cấu hình runtime production, xử lý qua runbook
- `evidence/`
- Thư mục `ai-qc-schema-removal-20261101-e7713c3d` (backup lịch sử; không cần schema cũ: module native chỉ dùng bảng `native_ai_qc_workspace`)

## 6. Rủi ro còn lại

1. Image đang chạy (`875af…`) **không có** cổng real-data hai khóa. Với `docker-compose.override.yml` hiện tại (`REAL_DATA=true`, không giới hạn tenant), user ở **bất kỳ tenant nào** có grant `ai_quality_control.access` đều có thêm một đường đọc hội thoại CRM qua AIQC. Đường đọc này vẫn bị giới hạn trong tenant của chính user và quyền CRM/privacy/scope hiện có (`crm-adapter.ts`), và việc phân tích dữ liệu thật vẫn bị chặn bởi `REAL_DATA_OUTBOUND_APPROVED=false`. Đây là rủi ro hiện hữu trên production, đúng phạm vi đã nêu, cho tới khi áp dụng Phase A.
2. Semantic chưa đạt. Holdout quá nhỏ: 6 positive, 22 negative; cận trên Wilson của FPR là 14,9%.
3. Monitoring Postgres xóa row theo state: một lỗi logic trong mutation có thể xóa dữ liệu. Có lock theo tenant và test; vẫn cần review trước khi bật.
4. Audit không bao giờ bị xóa. Khi chạm trần 10.000 (cứng 10.500), workspace chỉ còn ghi được thao tác purge. Cần chính sách lưu trữ audit dài hạn (export có ký số) trước khi chạy dài hạn.
5. Idempotency của monitoring chỉ đảm bảo trong cửa sổ retention: replay sự kiện cũ hơn retention có thể tạo lại job.
6. Working tree vẫn trộn nhiều workstream; nếu không tách theo §5 thì image build ra sẽ không review được.
