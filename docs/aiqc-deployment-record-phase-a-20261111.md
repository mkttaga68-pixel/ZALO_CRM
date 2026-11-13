# Biên bản triển khai Phase A (AIQC tắt) — 11/11/2026

**Kết quả: ĐÃ TRIỂN KHAI, các kiểm tra tự động đều PASS.** Theo quyết định của owner trong phiên làm việc: Phase A1, tạo backup mới, restart ngay khi đã xác nhận quiet-state.

## Thời gian (UTC)

| Thời điểm | Sự kiện |
|---|---|
| 03:05:52 | Backup `aiqc-phaseA-predeploy-20261111T030552Z-pg16.dump` |
| 03:10 | Snapshot image |
| 03:14:53 | `compose up -d --no-deps --no-build app` |
| 03:15:00 | Container mới khởi động |
| 03:15:09 | Healthy |

Gián đoạn HTTP khoảng 15 giây.

## Phát hiện chặn và cách xử lý

Image gốc của container (config `sha256:875af855e104…`) **đã bị xóa khỏi image store**. Tag `zl-crm-app:ai-qc-shared-20261101` đã bị **build đè ngày 03/11** (`sha256:5712fcb848ca…`, chưa review). Hệ quả: overlay `docker-compose.ai-qc-phase-a.pinned.review.yml` không resolve được, và runbook rollback cũ cũng không còn image để quay về.

Cách xử lý (owner đã duyệt): `docker export` container đang chạy (`docker diff` = 0), sau đó `docker import` thành `zl-crm-app:prod-snapshot-20261111-875af`, digest `sha256:e3688c05dc3d785c0e7ce4667c3338d34e99d0aeb50896e3a790cad7fa6de5c4`.
- Hash 28.058 file trong `/app` khớp với container cũ: `baa730bc…54fe`.
- Env của image chỉ gồm `PATH`, `NODE_VERSION`, `YARN_VERSION`; **không chứa secret**.
- Healthcheck gốc được khôi phục trong overlay.
- SHA-256 của file tar export: `af581308…e28a`.

## Precheck

| # | Kết quả |
|---|---|
| A-1 checker `--phase A` (4 file, overlay `docker-compose.ai-qc-phase-a.snapshot.yml`) | PASS (`aiqc-completion-20261111/compose-phaseA-snapshot.json`) |
| A-2 `compose config --quiet` | PASS |
| So sánh env | 60/60 biến không thuộc AIQC giống hệt container cũ (so bằng hash); cùng port 3080, cùng volume `file_storage` |
| A-4 image rollback | PASS (snapshot) |
| A-5 backup | PG 16.15, 78 bảng có dữ liệu, SHA-256 `9cfcf145dc7fb74feb4535c730bfd5a9922b862ae249be84f33770882c6c0e24` (khớp giữa container và host) |
| A-6 restore rehearsal | `postgres:16-alpine`, `--network none`: restore exit 0, 78/78 bảng, hash số row từng bảng khớp production (`49d96274…`). Container diễn tập đã xóa. |
| A-7 migration | `native_ai_qc_workspace` tồn tại, 0 row; không chạy migrate |
| A-8 quiet-state | Owner xác nhận. Aggregate: 7 tài khoản Zalo đã lưu trữ/ngắt; automation 6 done / 8 skipped; manual posting 2 DONE / 1 FAILED; không có job đang chờ |

## Kiểm tra sau deploy

| # | Kết quả |
|---|---|
| P-1 | App dùng image `e3688c05…`, RestartCount 0. DB, MinIO, backup **không restart** (StartedAt vẫn là 02:18:50) |
| P-2 | `/health` 200, `db=connected` |
| P-3 | `AI_QC_ENABLED`, `REAL_DATA`, `REAL_API`, `OUTBOUND*`, `AUTO_MONITOR`, `MANUAL*`, `OLLAMA` đều false; `OPENAI_REMOVED=true` |
| P-4 | AIQC `status`, `workspace`, `crm/conversations` khi không đăng nhập: 401 |
| P-5 | **PASS** (owner xác nhận qua ảnh chụp, ngày 11/11): đăng nhập thật qua `localhost:5173` (Vite proxy tới `:3080`), trang AIQC hiện `AI_QC_DISABLED` và không tải dữ liệu |
| P-7b | Sau deploy, owner đồng bộ lại Zalo: 1 tài khoản `connected`, 6 tài khoản đã lưu trữ/ngắt (đếm tổng hợp) |
| P-6 | **CHƯA KIỂM TRA**: login, chat, media bằng tài khoản thật |
| P-7 | Không có phiên Zalo nào cần khôi phục (cả 7 tài khoản đã lưu trữ từ trước); log khởi động không có lỗi |
| P-8 | `native_ai_qc_workspace` = 0 row; không có request Ollama |

## Rollback (nếu P-5/P-6 lỗi)

```powershell
docker compose -p zl-crm -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ai-qc.yml -f docker-compose.ai-qc-rollback.snapshot.yml up -d --no-deps --no-build app
```

Lệnh trên khôi phục cùng code và cờ AIQC cũ (gồm `REAL_DATA=true`). Không restore DB.

## Cảnh báo vận hành (quan trọng)

- **Mọi lệnh `docker compose` cho app từ nay phải có đủ 4 file**, với `docker-compose.ai-qc-phase-a.snapshot.yml` đứng cuối. Nếu chạy `docker compose up` chỉ với các file mặc định, Compose sẽ dùng image chưa review `5712fcb848ca` **và** bật lại `AI_QC_ENABLED/REAL_DATA=true`.
- Khuyến nghị (cần owner quyết định): đổi tên tag `ai-qc-shared-20261101` của image 03/11 thành tag khác để tránh nhầm, và cập nhật `docker-compose.override.yml` sang cờ false trong một change có review.
- Image chạy production là bản snapshot không có provenance build. Release A2 cần build có thể tái lập từ commit đã review.
