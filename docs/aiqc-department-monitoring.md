# AIQC theo phòng ban — bật/tắt quét theo yêu cầu

## Trạng thái hiện tại

Trang AI Quality Control có tab **Giám sát phòng ban**. Quản trị viên tenant có thể lưu loại phân tích, người nhận cảnh báo, mã tham chiếu policy/phê duyệt, cửa sổ dữ liệu tối đa 72 giờ và giới hạn tối đa 500 hội thoại mỗi lượt. Mọi thay đổi được ghi audit; nội dung lý do dừng khẩn cấp không được lưu nguyên văn.

Tab có thể chạy **một lượt quét thử local có người bấm**: tối đa 5 hội thoại trong 50 hội thoại gần nhất mà người đăng nhập vốn đã được CRM cho phép xem. Hệ thống chỉ giữ tin customer cùng tin human có `repliedByUserId` thuộc phòng ban hiện tại trong cửa sổ đã cấu hình; tin UNKNOWN và nhân viên phòng ban khác bị loại. UI hiển thị bản đã ẩn danh, rule/policy áp dụng và yêu cầu người dùng xác nhận cả batch trước khi gọi Ollama. Run lưu theo manual retention 7 ngày và phải được quản lý review.

**Quét liên tục (cập nhật 11/11):** khi `AI_QC_CONTINUOUS_LOCAL_ENABLED=true`, bật công tắc phòng ban sẽ chuyển sang chế độ tự quét: worker `continuous-runtime.ts` cứ 2 giây tìm tin nhân viên mới (từ lúc bật), xếp hàng đợi idempotent `ai_qc_continuous_job`, phân tích bằng Ollama local và chạy liên tục cho tới khi tắt công tắc, sửa cấu hình hoặc dừng khẩn cấp. Khi có nội dung cần xem xét, server gửi gợi ý không kèm nội dung qua namespace `/aiqc-observers`. Chuông **Cảnh báo AI** (`frontend/src/components/AiqcAlertBell.vue`) nằm trên thanh trên cùng của mọi trang CRM, cả desktop và mobile. Chuông hiện số chưa đọc, toast, tiếng báo và thông báo trên máy khi tab ẩn (nếu người dùng đã cho phép). Bấm vào cảnh báo sẽ mở thẳng bằng chứng. Không có socket thì chuông tự polling mỗi 60 giây. Thứ tự bật: backup DB → `node scripts/aiqc-department-migrate.cjs --apply` → bỏ comment cờ trong overlay → build/recreate app → tắt rồi bật lại công tắc phòng ban (migration buộc opt-in lại).

Khi chưa bật cờ trên: Công tắc lưu trạng thái `enabled` riêng cho từng phòng ban. Khi bật, hệ thống cho phép xem trước và xác nhận một lượt quét. Khi tắt, những hội thoại chưa gửi trong lô bị chặn; yêu cầu đã gửi tới model có thể hoàn tất.

Đổi phạm vi cấu hình tự tắt AI và tăng phiên bản. Phiên bản và thành viên phòng ban được gắn với bản xem trước để bản cũ không thể dùng sau khi bật/tắt hoặc đổi thành viên. Trước mỗi hội thoại, backend kiểm tra lại quyền người dùng, công tắc, dừng khẩn cấp và thành viên hiện tại.

Quét thử chỉ mở khi `AI_QC_DEPLOYMENT_TIER=local-test`, `AI_QC_DEPT_MONITOR_LOCAL_TEST_ENABLED=true`, Ollama local, tenant gate, retention 7 ngày và quy tắc thật đã duyệt còn hiệu lực đúng phòng ban. Công tắc hiển thị các điều kiện còn thiếu. Việc bật cổng local không tự bật phòng ban hoặc gửi hội thoại đến model.

Đã cập nhật local ngày 11/11: hai migration đã áp dụng; app cổng 3080 dùng image `zl-crm-app:aiqc-department-local-20261111` (digest `sha256:01c3a7f01e358bdbdacfe2b2e0de96dd357b23c786fcabfd80e03e65a59a4b84`). App healthy, health báo DB connected, API phòng ban trả 401 khi chưa đăng nhập. Metadata: 4 phòng ban, 3 quy tắc thật đã duyệt còn hiệu lực; chưa lưu cấu hình phòng ban, chưa bật phòng ban, chưa khởi chạy quét dữ liệu thật. Backup trước migration: `C:\Zalo CRM\aiqc-department-local-20261111\database-before.dump`.

Overlay local mới `docker-compose.aiqc-department-local.yml` phải được đặt cuối, sau các file compose đang dùng. Giữ overlay này khi recreate local để không quay về image cũ. Không dùng overlay local để triển khai production. Package ở `C:\Zalo CRM\aiqc-department-local-20261111\package`; manifest trong thư mục cha là hồ sơ build trước khi gắn tag local và không phải hồ sơ trạng thái triển khai.

## Cài đặt local sau khi được phép

1. Tạo phòng ban và gán nhân viên tại **Settings → RBAC → Departments**.
2. Duyệt chính sách doanh nghiệp thật trong Obsidian Brain, gán đúng tenant/phòng ban và ngày hiệu lực. Không dùng fixture synthetic.
3. Backup DB và kiểm tra hai migration `20261111140000_ai_qc_department_monitor_config`, `20261111163000_ai_qc_department_controls`. Script `scripts/aiqc-department-migrate.cjs --check|--apply` chạy tường minh, có transaction/checksum/lock và từ chối schema cũ không có ledger. Không chạy migration khi app khởi động.
4. Cập nhật backend/frontend local, đăng nhập bằng tenant admin có quyền `ai_quality_control.edit` và `ai_quality_control.approve`, rồi mở `/ai-quality-control` → **Giám sát phòng ban**.
5. Chọn phòng ban, nội dung kiểm tra, người phụ trách, giới hạn và mã tham chiếu phê duyệt. Lưu cấu hình rồi bật **AI phân tích phòng ban** khi không còn điều kiện thiếu. Mỗi lần lưu cấu hình sẽ đưa AI về tắt để người dùng kiểm tra lại.
6. Chỉ sau khi policy, tenant/legal/DPO và retention được duyệt, operator mới đặt `AI_QC_DEPLOYMENT_TIER=local-test` và `AI_QC_DEPT_MONITOR_LOCAL_TEST_ENABLED=true` trong môi trường local cô lập có Ollama local. Không đưa hai cờ này vào production. Bấm **Xem trước quét local**, đọc toàn bộ nội dung/rule hiển thị, rồi xác nhận batch để chạy tối đa 5 hội thoại.

## Điều kiện để xây dựng và bật worker thật

- Hoàn tất toàn bộ Phase A/B/C gates trong `aiqc-release-gates-20261111.md` và có xác nhận ký trong checklist Phase C.
- Tạo worker durable riêng để thay cho nút quét thử: checkpoint/inbox idempotent, retry có giới hạn, tenant/dept fencing, chỉ lấy tin nhắn mới và chỉ xử lý nhân viên có `repliedByUserId` xác minh; kiểm tra membership hiện tại trước khi xử lý.
- Đưa quyền xem hội thoại/privacy của CRM vào worker service account; hiện adapter AIQC thủ công dựa trên quyền của request user và không thể dùng trực tiếp cho quét nền.
- Chỉ dùng local Ollama hoặc Mock, policy APPROVED/hiệu lực đúng phòng ban; kết quả luôn là cảnh báo cần review, không dùng làm kết luận/kỷ luật/chấm điểm.
- Bổ sung lifecycle cho recipient, notification outbox, review/audit API, retention/purge, metric về coverage/skip và kill switch được worker thực sự kiểm tra.
- Thêm integration test PostgreSQL cho tenant isolation, revoke membership, attribution UNKNOWN, retry/idempotency, retention và phân quyền; review migration và backup/restore trước khi rollout.

## API nháp

- `GET /api/v1/ai-quality-control/department-monitoring`: danh sách phòng ban và cấu hình nháp trong tenant hiện tại.
- `PUT /api/v1/ai-quality-control/department-monitoring/departments/:id`: lưu cấu hình, luôn buộc tắt.
- `PUT /api/v1/ai-quality-control/department-monitoring/departments/:id/enabled`: bật/tắt, yêu cầu `{enabled:boolean,version:string}`; bật cần đủ điều kiện, tắt vẫn khả dụng khi runtime chưa sẵn sàng.
- `POST /api/v1/ai-quality-control/department-monitoring/kill-switch`: dừng local scan của tenant, lưu trạng thái dừng và audit.
- `POST /api/v1/ai-quality-control/department-monitoring/resume`: mở khóa quét thử; các phòng ban vẫn tắt cho tới khi được bật lại riêng.
- `POST /api/v1/ai-quality-control/department-monitoring/departments/:id/scan-preview`: tạo preview local, không gọi model.
- `POST /api/v1/ai-quality-control/department-monitoring/departments/:id/scan`: chạy batch đã preview/xác nhận qua Ollama local.

Các API yêu cầu tenant admin cùng grant `edit` và `approve`. Không gửi nội dung hội thoại cho model trong bất kỳ API cấu hình nào.
