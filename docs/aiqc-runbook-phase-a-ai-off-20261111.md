# Runbook Phase A — AIQC tắt hoàn toàn (REVIEW ONLY, CHƯA THỰC THI)

Bổ sung cho `aiqc-phase-a-deployment-rollback-runbook-20261102.md` và `aiqc-zalo-restart-checklist-20261102.md`; lệnh compose dùng lại từ hai tài liệu đó. Mục tiêu: tắt mọi đường AIQC, gồm cả đường đọc CRM hiện đang mở (`REAL_DATA=true`), mà không thay đổi DB, MinIO hay backup. **Không chạy bất kỳ lệnh nào dưới đây khi chưa có phê duyệt window bằng văn bản.**

## 1. Chọn image (owner quyết định một trong hai)

| Lựa chọn | Image | Ưu | Điều kiện |
|---|---|---|---|
| **A1 (khuyến nghị cho lần đầu)** | `zl-crm-app@sha256:875af855e10402bf3da8c74eefd53f257584156397dbaf0934c6846ab0092989`, đang chạy, overlay `docker-compose.ai-qc-phase-a.pinned.review.yml` | Không đổi code; rollback chỉ là đổi cấu hình | Code cũ không có cổng hai khóa nên **tất cả cờ phải false** (đã PASS bằng checker). Bundle frontend cũ build với `VITE_AI_QC_ENABLED=true` nên menu AIQC vẫn hiện với user có grant; API trả `503 AI_QC_DISABLED`. |
| A2 | Image mới build từ phạm vi release ở `aiqc-release-gates-20261111.md` §5 | Có cổng hai khóa, retention, monitoring purge | Phải đạt thêm G8 (commit đã review), G10 và G11, cùng SBOM/digest. Chưa sẵn sàng. |

## 2. Cổng trước window (T-24h → T-0)

| # | Kiểm tra | Lệnh / cách làm | Tiêu chí đạt |
|---|---|---|---|
| A-1 | Effective flags | `node scripts/verify-aiqc-compose-flags.mjs --phase A docker-compose.yml docker-compose.override.yml docker-compose.ai-qc.yml docker-compose.ai-qc-phase-a.pinned.review.yml` | `"result": "PASS"`; ghi JSON vào evidence |
| A-2 | Render compose, không in secret | `docker compose -p zl-crm -f … config --quiet` (4 file như trên) | exit 0 |
| A-3 | Biến môi trường trên host deploy | `Get-ChildItem Env: \| Where-Object Name -like 'AI_QC*'` trong shell sẽ chạy compose | Không có biến AIQC nào ghi đè |
| A-4 | Image rollback có sẵn | `docker image inspect zl-crm-app@sha256:875af…` | tồn tại |
| A-5 | Backup DB mới | Dịch vụ backup hoặc `pg_dump -Fc` theo quy trình hiện có, lưu vào `C:\ProgramData\ZaloCRM\AIQC\backups\`, ghi SHA-256 | Tạo trong vòng 24 giờ; ACL chỉ cho admin/SYSTEM |
| A-6 | Restore rehearsal | `postgres:16` dùng một lần với `--network none`, mount backup read-only, `pg_restore` | Số bảng và row count của các bảng chính khớp; `native_ai_qc_workspace` tồn tại |
| A-7 | Migration | Kiểm tra read-only checksum của `20261101120000_native_ai_quality_control` | applied, checksum khớp; **không** chạy migrate |
| A-8 | Quiet-state Zalo | Checklist `aiqc-zalo-restart-checklist-20261102.md` §Before | Operator ký xác nhận |
| A-9 | Phê duyệt | Owner duyệt image, diff, giờ bắt đầu/kết thúc | Có văn bản |

Bất kỳ mục nào FAIL → hủy window.

## 3. Thực thi (chỉ app)

Dùng lệnh `up -d --no-deps app` với 4 file đúng thứ tự trong runbook 02/11, thêm `--no-build`. Không dùng `down`, không restart DB/MinIO, không migrate.

## 4. Kiểm tra sau deploy (T+0 → T+30')

| # | Kiểm tra | Đạt khi |
|---|---|---|
| P-1 | `docker inspect` image/StartedAt | digest đúng; chỉ `app` có StartedAt mới |
| P-2 | `GET /health` | 200, `db=connected` |
| P-3 | `docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' zalo-crm-app \| Select-String '^AI_QC_'` | `ENABLED`, `REAL_DATA`, `REAL_API`, `OUTBOUND*`, `AUTO_MONITOR`, `MANUAL*` và `OLLAMA` đều false; `OPENAI_REMOVED=true` |
| P-4 | AIQC không đăng nhập | 401 |
| P-5 | AIQC đăng nhập (owner) `GET /api/v1/ai-quality-control/status` và `/crm/conversations` | `503 AI_QC_DISABLED`; không trả nội dung |
| P-6 | Đăng nhập, chat, media, tạo KH thử bằng tài khoản owner theo smoke hiện có | PASS |
| P-7 | Zalo reconnect / Socket.IO | Các tài khoản trở về trạng thái trước window; ca nào cần QR thì ghi lại |
| P-8 | Không có run/observation AIQC mới, không có request Ollama | Đếm read-only bảng `native_ai_qc_workspace`: không đổi |

FAIL ở P-1 đến P-7 → rollback ngay (§5).

## 5. Rollback

Dùng 3 file gốc + `docker-compose.obsidian.rollback.review.yml` như runbook 02/11 (`up -d --no-deps app`). Không restore DB để rollback. Nếu nghi ngờ tương thích dữ liệu, giữ AIQC tắt và escalate.

## 6. Ma trận quyền dashboard cần kiểm tra bằng tài khoản thật (G16)

Thực hiện sau Phase A với image A2 (A1 trả 503 cho tất cả). Kết quả mong đợi theo code:

| Vai trò / grant | `/workspace` | Settings (`edit`) | `retentionDays` (`approve`) | Purge (`delete`+`view_all`) | Capacity |
|---|---|---|---|---|---|
| Không đăng nhập | 401 | 401 | 401 | 401 | — |
| Không có grant | 403 | 403 | 403 | 403 | — |
| `access` | 200 (chỉ run của mình, đúng phòng ban) | 403 | 403 | 403 | `null` |
| `access`+`edit` | 200 | 200 | 403 | 403 | hiện |
| `access`+`approve`+`edit` | 200 | 200 | 200 | 403 | hiện |
| `access`+`delete` (không có `view_all`) | 200 | 403 | 403 | xóa từng run: được; bulk: 403 | `null` |
| Đủ grant | 200 | 200 | 200 | 200 | hiện |
| Tenant khác | Chỉ thấy dữ liệu tenant mình; run của tenant kia trả 404 | | | | |

Mỗi ô ghi: tài khoản (đã ẩn danh), thời điểm, HTTP status. Không chụp nội dung hội thoại.
