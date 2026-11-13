# Biên bản: bật AIQC phân tích dữ liệu thật bằng Ollama local — 11/11/2026

**Quyết định của owner** (trong phiên làm việc):
- Dùng Ollama local `qwen3:4b-instruct`, phân tích thủ công từng hội thoại.
- Owner chấp nhận các rủi ro: chất lượng chưa đạt ngưỡng (FP ~7%); policy còn DRAFT; kết quả giữ 7 ngày; owner chịu trách nhiệm về cơ sở pháp lý xử lý dữ liệu.
- Lần triển khai này **vượt qua cổng Phase B/C** đã ghi trong `aiqc-release-gates-20261111.md`, theo quyết định của owner.

Triển khai lúc 03:43:00Z. App healthy lúc 03:43:12Z; DB, MinIO, backup không restart.

## Thay đổi mã nguồn (chưa commit)

| File | Nội dung |
|---|---|
| `providers.ts` | Khi `AI_QC_OPENAI_REMOVED=true`, real-data chỉ bật nếu đủ **3 khóa**: `AI_QC_REAL_DATA_ENABLED`, `AI_QC_REAL_DATA_PILOT_ORG_ID` (UUID), `AI_QC_OLLAMA_REAL_DATA_ENABLED`. Ngoài ra phải có resource guard; real API luôn false |
| `ollama-provider.ts` | Chỉ nhận nguồn `CRM` khi được tạo ở chế độ real-data đã duyệt; mặc định vẫn chỉ nhận synthetic |
| `analysis.ts` | Luồng thủ công cho Ollama: xem trước → token dùng 1 lần → phân tích; bắt buộc `retentionDays=7` do người có quyền `approve` đặt; run tự hết hạn sau 7 ngày. Mọi dữ liệu CRM không qua xem trước đều không bao giờ tới provider (kể cả Mock) |
| `crm-adapter.ts` | `timestampStatus=VERIFIED` khi `sentAt` (timestamp Zalo) hợp lệ và không ở tương lai |
| `routes.ts` | Cho phép `provider:'ollama'` với `confirmRealData:true`; `/status` trả `manualProvider` |
| `bootstrap.ts` | Tiến trình purge 7 ngày chạy cho tenant pilot |
| Frontend `ManualCrmAnalysis.vue`, Dashboard, kiểu `QcStatus` | Hiển thị và gửi đúng provider; nội dung xác nhận ghi rõ "model chạy cục bộ, dữ liệu không rời máy" |
| Test | Native 152, guarded 203, monitoring 27, frontend 7/6/13: tất cả PASS; `tsc` và `vue-tsc` PASS |

## Image và bằng chứng tương thích

`zl-crm-app:aiqc-ollama-real-20261111`, digest `sha256:feb19c21a24143d20a4de45cd9e7d712f49acac3788aae0a4b3626e160b27583`. Image dựng trên snapshot production `e3688c05…`, **chỉ thay** `dist/modules/ai-quality-control/**` và `static/**`. Build bằng `--network none`.

- **Phần còn lại của `/app`** (trừ `node_modules`, AIQC, `static`): hash `fb1d473a…` **giống hệt** snapshot.
- **Backend:** biên dịch working tree rồi so với `dist` production. Chỉ khác ở AIQC và strict-RBAC (03/11, **không** đưa lên). Các dependency AIQC import (prisma-client, active-session, auth-middleware, event-bus, safe-outbound-fetch, privacy/redact) giống từng byte; `userHasGrant` cùng chữ ký; đủ package npm. 34/34 module AIQC liên kết ESM thành công trong image.
- **Frontend:** working tree + 7 file RBAC lấy từ `rbac-strict-baseline-20261103` (bản trước 03/11) + `stores/rbac.ts`, `UserEditPanel.vue` từ HEAD. Bản đối chứng (thay AIQC bằng snapshot ngày 01/11) cho **113 chunk giống byte-for-byte** với production; `auth`/`index` chỉ khác thứ tự danh sách preload (cùng kích thước tuyệt đối). Chunk của candidate khác vì đổi tên export Vuetify khi AIQC dùng thêm component.

## Cấu hình chạy

Lệnh: `docker compose -p zl-crm -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.ai-qc.yml -f docker-compose.ai-qc-ollama-real.yml up -d --no-deps --no-build app`

Precheck: checker `--phase C` PASS (`aiqc-completion-20261111/compose-phaseC-ollama-real.json`); 60/60 biến không thuộc AIQC giống hệt; vault và runtime mount **read-only** (đã thử ghi và bị từ chối).

Kiểm tra sau deploy:
- Health 200; 4 API AIQC trả 401 khi chưa đăng nhập.
- Container đọc được telemetry và vault, gọi được Ollama 0.40.15 trên `127.0.0.1:11434` (không lộ ra LAN).
- Zalo tự kết nối lại (1 tài khoản, đồng bộ 226 bạn bè, 0 lỗi); log khởi động không có lỗi.

Resource monitor: `scripts/aiqc-ollama-resource-monitor.ps1`, PID ghi trong `C:\ProgramData\ZaloCRM\AIQC\runtime\monitor.pid`. **Không tự chạy lại sau khi reboot**; khi đó telemetry cũ nên Ollama từ chối (fail-closed).

## Vận hành

- **Kill switch:** tạo file `C:\ProgramData\ZaloCRM\AIQC\runtime\STOP`; xóa file để chạy lại.
- **Tắt AI hoàn toàn:** chạy lại với `docker-compose.ai-qc-phase-a.snapshot.yml` thay cho overlay ollama-real.
- Guard từ chối khi RAM trống < 3 GiB, CPU ≥ 90%, VRAM trống < 2 GiB, hoặc telemetry quá 15 giây.
- Quyền: owner có tất cả (fallback theo vai trò). Admin/member cần grant `ai_quality_control` trong nhóm quyền.
- Backup trước triển khai: `aiqc-phaseA-predeploy-20261111T030552Z-pg16.dump`.

## Cập nhật v2 — 04:27Z: hiển thị tên + lý do chặn cụ thể

- Image `zl-crm-app@sha256:ab60afe59d6cc608e7a18989282881dd329f2eea3cfdbeb54a46288b88548470`. Nền vẫn là snapshot `e3688c05…`; hash phần không thuộc AIQC trùng snapshot (`fb1d473a…`); 34/34 module liên kết.
- Nội dung:
  - danh sách hội thoại hiển thị tên nhóm/khách, loại hội thoại, nick Zalo, thời điểm tin cuối (14/14 hội thoại có tên);
  - bộ lọc nhân viên và cột Actor hiển thị tên nhân viên trong tenant;
  - bản xem trước trả `blockers` và giao diện nêu từng điều kiện còn thiếu.
- Test: native 155, guarded 206, monitoring 27, frontend 7/13; `tsc` và `vue-tsc` PASS.
- Owner yêu cầu deploy và kiểm tra.
  - Recreate app 04:27:09 → healthy 04:27:21; DB, MinIO, backup không restart.
  - `/health` 200, `db=connected`.
  - 5 API AIQC (`status`, `workspace`, `crm/conversations`, `ollama/runtime`, `retention/purge-expired`) trả 401 khi chưa đăng nhập.
  - Cờ giữ nguyên.
  - Container đọc telemetry (`blocked=false`) và gọi được Ollama 0.40.16.
  - Log: 0 lỗi.
  - Zalo: 1 tài khoản `connected`, đồng bộ 226 bạn bè, 0 lỗi.
- Rollback về v1: sửa `image:` trong overlay về `feb19c21…` rồi chạy lại cùng lệnh compose.

## Rà soát ổn định v3 (chuẩn bị xong, CHỜ DEPLOY)

Nguyên nhân "test không có kết quả" đã xác minh trên hệ thống:
1. **Vault trống** nên lệnh đồng bộ đã nạp 4 tài liệu mẫu synthetic. Hai quy tắc được publish đều là synthetic (và gán sai loại), mà synthetic không bao giờ được dùng làm căn cứ cho dữ liệu CRM. Retention chưa đặt. Chưa có lần phân tích nào (0 run). Vault thật quét bình thường: 22 tài liệu, đều DRAFT, không synthetic.
2. **Bộ bảo vệ tài nguyên tự hủy phiên chạy của chính nó.** Ngưỡng 3 GiB áp dụng cả khi đang chạy: model nạp vào làm RAM trống tụt xuống, vòng kiểm tra mỗi giây hủy luôn. Trong lúc model còn nằm trong RAM (5 phút), mọi lần thử sau đều bị chặn. Phép thử cô lập trên v2: lần 1 hủy sau 7 giây, lần 2 bị từ chối ngay.
3. **Một phát hiện thiếu bằng chứng làm mất cả lần chạy.** Model tự kết luận KNOWLEDGE_MISMATCH dù không có quy tắc nào cho loại này, nên `MISSING_MODEL_EVIDENCE` loại bỏ luôn các phát hiện INSULT/COURTESY đúng.

Sửa trong v3 (`zl-crm-app@sha256:d0e878e8ac4f8cfab668dc52008d06e2fc601b192c830fcc2da994901622194f`):
- **Resource guard 2 ngưỡng:**
  - nhận việc: ≥3 GiB khi model chưa nạp, ≥1,5 GiB khi model đã nạp (kiểm tra `/api/ps`);
  - khi đang chạy: chỉ hủy nếu RAM < 1 GiB;
  - cờ `blocked` của monitor nay chỉ là sàn cứng (< 1 GiB, CPU ≥ 98%, VRAM < 1 GiB).
- **Kiểm tra tài nguyên trước khi tiêu token xem trước:** khi thiếu tài nguyên thì trả 503, không lưu run rỗng; người dùng bấm lại được ngay.
- **Phát hiện thiếu bằng chứng chỉ bị hạ riêng** (`MODEL_EVIDENCE_INCOMPLETE`). Loại chưa có quy tắc đã duyệt thì **không gọi model** mà trả ngay `APPROVED_RULE_NOT_AVAILABLE`.
- **Vault mặc định** là vault thật của tenant (`/run/aiqc/obsidian`), không còn là fixture synthetic.
- **Timeout** 180 giây; thông báo lỗi tiếng Việt; bản xem trước báo trước tình trạng RAM.

Kiểm chứng:
- Test: native 164, guarded 215, monitoring 27, frontend 7/13; `tsc` và `vue-tsc` PASS.
- Image: hash phần không thuộc AIQC trùng `fb1d473a…`; 34/34 module liên kết.
- Phép thử end-to-end cô lập với Ollama thật (quy tắc từ vault thật, hội thoại giả lập):
  - xúc phạm → INSULT và COURTESY `POTENTIAL_ISSUE`, 7,7 giây;
  - lịch sự → `NO_ISSUE_OBSERVED`, 8,2 giây;
  - cả hai chạy khi RAM trống 2,2 GiB (model đã nạp).
- Precheck: checker `--phase C` PASS, compose render OK, 80/80 biến môi trường giống hệt.
- Overlay đã trỏ sang v3 (ghi chú rollback v2/v1). Monitor đã được khởi động lại với ngưỡng mới (PID trong `monitor.pid`).

Giới hạn còn lại (đúng thiết kế):
- UNRESOLVED_REQUEST luôn trả "không kết luận" vì chưa có dữ liệu lịch làm việc và độ phủ đồng bộ.
- KNOWLEDGE_MISMATCH cần quy tắc sản phẩm được duyệt.
- Dữ liệu thật hiện có **0 tin nhắn gắn nhân viên** (nhân viên trả lời bằng điện thoại), nên INSULT/COURTESY trên hội thoại thật sẽ trả "không kết luận" (`VERIFIED_EMPLOYEE_NOT_AVAILABLE`) cho tới khi nhân viên trả lời qua màn Tin nhắn của CRM.
