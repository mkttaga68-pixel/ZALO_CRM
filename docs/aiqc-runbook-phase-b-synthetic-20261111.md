# Runbook Phase B — shadow chỉ với dữ liệu synthetic (REVIEW ONLY, CHƯA THỰC THI)

Điều kiện vào: Phase A đã ổn định ≥ 7 ngày, và các cổng G10, G11, G12, G13, G16 trong `aiqc-release-gates-20261111.md` đều PASS. Phase B **không** đọc CRM thật, **không** gọi OpenAI, **không** bật auto-monitoring.

Overlay: `docker-compose.ai-qc-phase-b-synthetic.review.yml`. Ngày 11/11 đã sửa overlay này để chỉ mount `C:/ProgramData/ZaloCRM/AIQC/runtime`; bản cũ mount cả thư mục chứa `backups/*.dump`.

## 1. Chuẩn bị bắt buộc trước Phase B (môi trường cô lập, không phải production)

### 1.1 Full CRM startup + login trên DB synthetic PG16 (G10)

Cluster sandbox hiện có (`native-ai-qc-runtime/mvxj0im3/postgres-data`) là **PostgreSQL 18**, khác production **16.15**, và đã dừng từ 03/11 do hết dung lượng đĩa. Không dùng cluster này làm bằng chứng.

1. Tạo cluster mới bằng image `postgres:16` hoặc binary PG16 cùng minor version với production, `--network none` hoặc chỉ loopback, data dir trong `C:\Zalo CRM\aiqc-e2e-pg16-<ngày>\`. Kiểm tra `SELECT version()` cho ra 16.x.
2. Áp schema bằng migration của chính commit candidate (`prisma migrate deploy` trên **DB synthetic** này), sau đó chạy `node scripts/verify-native-ai-qc-migration.cjs`.
3. Seed tổ chức/tài khoản synthetic theo vai trò ở runbook A §6 (owner, admin có grant, member chỉ có `access`, tenant B). Email dạng `*@sandbox.invalid`; mật khẩu sinh ngẫu nhiên lưu ngoài repo.
4. Khởi động backend của image candidate với `NODE_ENV=production`, `DATABASE_URL` trỏ tới cluster synthetic, Zalo/OpenAI/Ollama tắt, MinIO giả lập cục bộ. Kiểm tra: `/health` 200 và `db=connected`; login từng vai trò; `GET /api/v1/ai-quality-control/status` đúng với cờ; log không có lỗi.
5. Artifact cần lưu: `version()`, digest image, các migration đã áp, kết quả smoke (đã ẩn danh).

### 1.2 Browser E2E trên candidate cuối (G11)

`scripts/aiqc-browser-e2e.cjs` (Playwright, chặn mọi host ngoài `127.0.0.1:5174/3091`) chạy trên stack ở 1.1. Tiêu chí: mọi bước PASS; 0 request bị chặn ra ngoài; 0 lỗi console/page; ma trận quyền của runbook A §6 khớp hoàn toàn. Lưu kết quả JSON kèm digest image.

### 1.3 Benchmark Ollama (G13)

Chỉ chạy trên host **cô lập**, tương đương production (cùng GPU class, RAM ≥ 16 GiB), không chạy CRM production song song. **Không** chạy trên host production hiện tại: host này chỉ còn khoảng 1–2 GiB RAM trống, dưới ngưỡng guard 3 GiB.

| Bước | Chi tiết |
|---|---|
| Telemetry | `scripts/aiqc-ollama-resource-monitor.ps1` ghi vào `…\AIQC\runtime\host-resources.json` mỗi 2 giây |
| Tải | 68 ca semantic + 3 lần lặp; concurrency = 1 (cố định trong code), hàng đợi tối đa 2 |
| Đồng thời | Smoke CRM (login, danh sách hội thoại, gửi tin synthetic) trên cùng host trong lúc benchmark |
| Đạt khi | p95 ≤ 15 giây/ca; 0 timeout; RAM trống tối thiểu ≥ 3 GiB; VRAM trống ≥ 2 GiB; p95 smoke CRM tăng ≤ 20% so với baseline; kill switch dừng inference trong ≤ 2 giây |

### 1.4 Semantic (G12)

Lệnh: `node scripts/evaluate-aiqc-semantic-holdout.mjs <results.json> --out <report>`. Ngưỡng Phase B (đã cố định trong script): JSON/schema/citation hợp lệ 100%, 0 timeout, FPR regression ≤ 5%, FNR regression = 0, holdout 3-state ≥ 95%. Kết quả v3 hiện tại **FAIL**: FPR 7,14% với 2 FP `product-question` và `ambiguous-irony`; 3-state 26/28.

## 2. Kiểm soát khi chạy

| Kiểm soát | Cơ chế (code) | Kiểm tra |
|---|---|---|
| Kill switch | File `C:\ProgramData\ZaloCRM\AIQC\runtime\STOP` (container thấy là `/run/aiqc-runtime/STOP`). Kiểm tra trước mỗi request và mỗi giây trong khi chạy | Tạo file → request kế tiếp lỗi `OLLAMA_RESOURCE_KILL_SWITCH` |
| Concurrency | 1 inference; hàng đợi 2; chờ tối đa 60 giây; timeout provider 120 giây | `GET /api/v1/ai-quality-control/ollama/runtime` (cần `edit`) |
| Resource guard | RAM ≥ 3 GiB, CPU < 90%, VRAM trống ≥ 2048 MiB, telemetry ≤ 15 giây tuổi | Telemetry cũ hoặc thiếu → từ chối |
| Circuit breaker | 3 lỗi liên tiếp → mở 30 giây | metrics `circuit` |
| Chỉ synthetic | Ollama provider từ chối nguồn khác `SERVER_SYNTHETIC`; real-data cần thêm khóa pilot | test native |
| Dashboard | Chỉ user có grant `ai_quality_control.access`; không chấm điểm/kỷ luật nhân viên (`employeeScoring: DISABLED`) | ma trận A §6 |
| Dung lượng | `capacity` trong `/workspace`; purge qua `POST /retention/purge-expired` sau khi tenant đặt `retentionDays` | theo dõi hằng ngày |

## 3. Tiêu chí dừng (bất kỳ điều kiện nào → tạo file STOP, rồi quay về Phase A)

- p95 latency CRM tăng > 20% hoặc `/health` lỗi.
- RAM trống < 3 GiB liên tục 1 phút, hoặc GPU 100% liên tục 5 phút.
- Xuất hiện run có nguồn khác `SERVER_SYNTHETIC`, hoặc có request ra ngoài host Ollama.
- Bất kỳ lỗi kiểm tra tenant/ACL nào, hoặc citation không hợp lệ.
- Workspace `atCapacity=true` mà chưa có chính sách retention.

## 4. Áp dụng (sau phê duyệt riêng)

1. `node scripts/verify-aiqc-compose-flags.mjs --phase B docker-compose.yml docker-compose.override.yml docker-compose.ai-qc.yml docker-compose.ai-qc-phase-b-synthetic.review.yml` phải PASS. Hiện FAIL vì chưa có `AI_QC_PHASE_B_IMAGE`.
2. Khởi động resource monitor; xác nhận file STOP **chưa** tồn tại.
3. `up -d --no-deps --no-build app` với 4 file trên.
4. Chạy các bước kiểm tra sau deploy của runbook A §4, rồi chạy 1 dataset synthetic và xác nhận citation hợp lệ.
5. Rollback: tạo file STOP, sau đó áp lại cấu hình Phase A.
